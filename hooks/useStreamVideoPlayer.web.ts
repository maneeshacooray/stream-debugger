import Hls from 'hls.js';
import { useMemo } from 'react';

// ============================================================================
// Web video player backed by hls.js
// ============================================================================
// expo-video's web implementation sets a plain <video src="..."> and relies
// entirely on the browser's native HLS support, which only Safari has. Every
// other browser fails to play .m3u8 sources ("No video with supported format
// and MIME type found"). This module mirrors the small slice of expo-video's
// VideoPlayer API that app/index.tsx actually uses, backed by a real
// <video> element wired up to hls.js, so HLS streams play on Chrome/Firefox/
// Edge too. Safari (and anything else with native HLS support) still uses
// the browser's built-in player, since it's the more accurate reference.
//
// The instance is attached to a DOM <video> element by StreamVideoView.web.tsx
// via attach()/detach() when that component mounts/unmounts.

export type StreamVideoTrack = {
  id: string;
  size: { width: number; height: number };
  mimeType: string | null;
  isSupported: boolean;
  bitrate: number | null;
  frameRate: number | null;
};

export type StreamAudioTrack = {
  id: string;
  language: string;
  label: string;
};

type PlayerStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';

type Listener = (payload: any) => void;

export class WebStreamVideoPlayer {
  private uri: string | null;
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private timeUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private status: PlayerStatus = 'idle';

  private _loop = false;
  private _muted = false;
  private _volume = 1;
  private _playbackRate = 1;
  private _timeUpdateEventInterval = 0;

  /**
   * Performance optimization: Cache computed getter outputs (videoTrack and audioTrack)
   * using class instance fields and dirty flags invalidated on state changes
   * (e.g. track switch, metadata load, resize). This eliminates dynamic object allocations
   * during high-frequency player update paths (like 500ms timeUpdate ticks).
   */
  private _cachedVideoTrack: StreamVideoTrack | null | undefined = undefined;
  private _cachedAudioTrack: StreamAudioTrack | null | undefined = undefined;

  constructor(source: string | null) {
    this.uri = source;
  }

  // -- mutable playback properties (mirror expo-video's VideoPlayer API) --

  get loop() {
    return this._loop;
  }
  set loop(value: boolean) {
    this._loop = value;
    if (this.video) this.video.loop = value;
  }

  get muted() {
    return this._muted;
  }
  set muted(value: boolean) {
    this._muted = value;
    if (this.video) this.video.muted = value;
  }

  get volume() {
    return this._volume;
  }
  set volume(value: number) {
    this._volume = value;
    if (this.video) this.video.volume = value;
  }

  get playbackRate() {
    return this._playbackRate;
  }
  set playbackRate(value: number) {
    this._playbackRate = value;
    if (this.video) this.video.playbackRate = value;
  }

  get timeUpdateEventInterval() {
    return this._timeUpdateEventInterval;
  }
  set timeUpdateEventInterval(seconds: number) {
    this._timeUpdateEventInterval = seconds;
    this.restartTimeUpdateTimer();
  }

  // -- read-only playback info --

  get currentTime(): number {
    return this.video?.currentTime ?? 0;
  }

  get duration(): number {
    const d = this.video?.duration;
    return d && Number.isFinite(d) ? d : 0;
  }

  get isLive(): boolean {
    return !!this.video && !Number.isFinite(this.video.duration);
  }

  get bufferedPosition(): number {
    const buffered = this.video?.buffered;
    if (!buffered || buffered.length === 0) return 0;
    try {
      return buffered.end(buffered.length - 1);
    } catch {
      return 0;
    }
  }

  get videoTrack(): StreamVideoTrack | null {
    if (this._cachedVideoTrack !== undefined) {
      return this._cachedVideoTrack;
    }

    if (this.hls && this.hls.levels.length > 0 && this.hls.currentLevel >= 0) {
      const level = this.hls.levels[this.hls.currentLevel];
      if (level) {
        const frameRateAttr = level.attrs?.['FRAME-RATE'];
        this._cachedVideoTrack = {
          id: String(this.hls.currentLevel),
          size: { width: level.width || 0, height: level.height || 0 },
          mimeType: level.videoCodec ? `video/mp4; codecs="${level.videoCodec}"` : null,
          isSupported: true,
          bitrate: level.bitrate || null,
          frameRate: frameRateAttr ? Number(frameRateAttr) : null,
        };
        return this._cachedVideoTrack;
      }
    }
    if (this.video?.videoWidth) {
      this._cachedVideoTrack = {
        id: '0',
        size: { width: this.video.videoWidth, height: this.video.videoHeight },
        mimeType: null,
        isSupported: true,
        bitrate: null,
        frameRate: null,
      };
      return this._cachedVideoTrack;
    }
    this._cachedVideoTrack = null;
    return null;
  }

  get audioTrack(): StreamAudioTrack | null {
    if (this._cachedAudioTrack !== undefined) {
      return this._cachedAudioTrack;
    }

    if (this.hls && this.hls.audioTracks.length > 0 && this.hls.audioTrack >= 0) {
      const track = this.hls.audioTracks[this.hls.audioTrack];
      if (track) {
        this._cachedAudioTrack = { id: String(this.hls.audioTrack), language: track.lang || '', label: track.name || '' };
        return this._cachedAudioTrack;
      }
    }
    this._cachedAudioTrack = null;
    return null;
  }

  // -- controls --

  play() {
    this.video?.play().catch(() => {
      // Autoplay can be rejected by the browser (e.g. unmuted with no user
      // gesture yet); the statusChange/error listeners already surface this.
    });
  }

  pause() {
    this.video?.pause();
  }

  seek(time: number) {
    if (this.video) {
      this.video.currentTime = Math.max(0, time);
    }
  }

  addListener(event: string, callback: Listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
    return { remove: () => set!.delete(callback) };
  }

  private emit(event: string, payload?: any) {
    this.listeners.get(event)?.forEach((cb) => cb(payload));
  }

  // -- DOM wiring, called by StreamVideoView.web.tsx --

  attach(video: HTMLVideoElement) {
    this.video = video;
    video.loop = this._loop;
    video.muted = this._muted;
    video.volume = this._volume;
    video.playbackRate = this._playbackRate;
    video.playsInline = true;

    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('canplay', this.onCanPlay);
    video.addEventListener('loadedmetadata', this.onLoadedMetadata);
    video.addEventListener('resize', this.onResize);
    video.addEventListener('error', this.onError);

    this.loadSource();
    this.restartTimeUpdateTimer();
  }

  detach(video: HTMLVideoElement) {
    if (this.video !== video) return;

    video.removeEventListener('play', this.onPlay);
    video.removeEventListener('pause', this.onPause);
    video.removeEventListener('waiting', this.onWaiting);
    video.removeEventListener('canplay', this.onCanPlay);
    video.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    video.removeEventListener('resize', this.onResize);
    video.removeEventListener('error', this.onError);

    this._cachedVideoTrack = undefined;
    this._cachedAudioTrack = undefined;

    this.hls?.destroy();
    this.hls = null;
    this.video = null;

    if (this.timeUpdateTimer) {
      clearInterval(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
  }

  private onPlay = () => this.emit('playingChange', { isPlaying: true });
  private onPause = () => this.emit('playingChange', { isPlaying: false });
  private onWaiting = () => this.setStatus('loading');
  private onCanPlay = () => this.setStatus('readyToPlay');
  private onResize = () => {
    this._cachedVideoTrack = undefined;
  };

  private onLoadedMetadata = () => {
    this._cachedVideoTrack = undefined;
    this._cachedAudioTrack = undefined;
    this.emit('sourceLoad', {
      videoSource: this.uri,
      duration: this.duration,
      availableVideoTracks: this.videoTrack ? [this.videoTrack] : [],
      availableSubtitleTracks: [],
      availableAudioTracks: this.audioTrack ? [this.audioTrack] : [],
    });
    this.emit('videoTrackChange', { videoTrack: this.videoTrack });
  };

  private onError = () => {
    const mediaError = this.video?.error;
    this.setStatus('error', {
      message: mediaError?.message || `Video error${mediaError ? ` (code ${mediaError.code})` : ''}`,
    });
  };

  private setStatus(status: PlayerStatus, error?: { message: string }) {
    if (this.status === status && !error) return;
    const oldStatus = this.status;
    this.status = status;
    this.emit('statusChange', { status, oldStatus, error });
  }

  private restartTimeUpdateTimer() {
    if (this.timeUpdateTimer) {
      clearInterval(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
    if (!this.video || this._timeUpdateEventInterval <= 0) return;

    this.timeUpdateTimer = setInterval(() => {
      this.emit('timeUpdate', {
        currentTime: this.currentTime,
        currentLiveTimestamp: null,
        currentOffsetFromLive: this.isLive ? this.computeLiveOffset() : null,
        bufferedPosition: this.bufferedPosition,
      });
    }, this._timeUpdateEventInterval * 1000);
  }

  private computeLiveOffset(): number | null {
    if (this.hls?.liveSyncPosition != null && this.video) {
      return Math.max(0, this.hls.liveSyncPosition - this.video.currentTime);
    }
    return null;
  }

  private loadSource() {
    const video = this.video;
    if (!video) return;

    this._cachedVideoTrack = undefined;
    this._cachedAudioTrack = undefined;

    this.hls?.destroy();
    this.hls = null;

    if (!this.uri) {
      video.removeAttribute('src');
      return;
    }

    this.setStatus('loading');

    const looksLikeHls = /\.m3u8(\?|$)/i.test(this.uri);
    const hasNativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    if (looksLikeHls && !hasNativeHlsSupport && Hls.isSupported()) {
      const hls = new Hls();
      this.hls = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          this.setStatus('error', { message: `${data.type}: ${data.details}` });
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        this._cachedVideoTrack = undefined;
        this.emit('videoTrackChange', { videoTrack: this.videoTrack });
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
        this._cachedAudioTrack = undefined;
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this._cachedVideoTrack = undefined;
        this._cachedAudioTrack = undefined;
      });

      hls.loadSource(this.uri);
      hls.attachMedia(video);
    } else {
      // Safari (native HLS), or a non-HLS source (mp4 etc.) — let the
      // browser handle it directly.
      video.src = this.uri;
      video.load();
    }
  }
}

export function useStreamVideoPlayer(
  source: string | null,
  setup?: (player: WebStreamVideoPlayer) => void
): WebStreamVideoPlayer {
  return useMemo(() => {
    const player = new WebStreamVideoPlayer(source);
    setup?.(player);
    return player;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
}
