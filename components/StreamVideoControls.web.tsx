import type { WebStreamVideoPlayer } from '@/hooks/useStreamVideoPlayer.web';
import React, { useEffect, useState } from 'react';

const ACCENT = '#818cf8';

// A native <video controls> bar depends on MediaSource/hls.js correctly
// reporting duration, which is inconsistent across browsers for HLS — it
// often renders with no usable scrub bar at all. This is a minimal bar we
// fully control instead, so seeking always works for VOD sources.
//
// Rendered as a sibling OUTSIDE the pinch/pan GestureDetector that wraps the
// video in app/index.tsx, not layered on top of it — react-native-gesture-
// handler's web pointer handling otherwise swallows clicks/drags meant for
// these controls. stopPropagation on the wrapper is extra insurance in case
// a future caller nests this inside a gesture region again.
export function StreamVideoControls({ player }: { player: WebStreamVideoPlayer | null }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [muted, setMuted] = useState(player?.muted ?? false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  useEffect(() => {
    if (!player) return;

    const syncFromPlayer = () => {
      setDuration(player.duration);
      setIsLive(player.isLive);
    };
    syncFromPlayer();
    setMuted(player.muted);

    const listeners = [
      player.addListener('playingChange', ({ isPlaying: playing }: { isPlaying: boolean }) =>
        setIsPlaying(playing)
      ),
      player.addListener('timeUpdate', ({ currentTime: time }: { currentTime: number }) => {
        setCurrentTime(time);
        syncFromPlayer();
      }),
      player.addListener('sourceLoad', syncFromPlayer),
    ];
    return () => listeners.forEach((l) => l.remove());
  }, [player]);

  if (!player) return null;

  const togglePlay = () => (isPlaying ? player.pause() : player.play());
  const toggleMute = () => {
    const next = !muted;
    player.muted = next;
    setMuted(next);
  };

  const displayTime = scrubTime ?? currentTime;

  return (
    <div
      // Stop pointer events from reaching any ancestor gesture handler
      // before they reach our own buttons/slider.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
        fontFamily: 'system-ui, sans-serif',
        touchAction: 'auto',
      }}
    >
      <button
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        style={iconButtonStyle}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <span style={timeTextStyle}>{formatTime(displayTime)}</span>

      {isLive ? (
        <span style={liveBadgeStyle}>LIVE</span>
      ) : (
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={Math.min(displayTime, duration || 0)}
          disabled={!duration}
          onChange={(e) => setScrubTime(Number(e.target.value))}
          onMouseUp={() => {
            if (scrubTime != null) player.seek(scrubTime);
            setScrubTime(null);
          }}
          onTouchEnd={() => {
            if (scrubTime != null) player.seek(scrubTime);
            setScrubTime(null);
          }}
          style={{ flex: 1, accentColor: ACCENT, cursor: duration ? 'pointer' : 'default' }}
        />
      )}

      <span style={timeTextStyle}>{duration > 0 ? formatTime(duration) : '--:--'}</span>

      <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} style={iconButtonStyle}>
        {muted ? <MuteIcon /> : <VolumeIcon />}
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.5 2.5v11l10-5.5-10-5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3.5" y="2.5" width="3" height="11" />
      <rect x="9.5" y="2.5" width="3" height="11" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 6h2.5L8 3v10L4.5 10H2V6z" fill="currentColor" stroke="none" />
      <path d="M10.5 5.5a4 4 0 0 1 0 5M12.3 3.7a6.7 6.7 0 0 1 0 8.6" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 6h2.5L8 3v10L4.5 10H2V6z" fill="currentColor" stroke="none" />
      <path d="M10.5 5.5l4 5M14.5 5.5l-4 5" strokeLinecap="round" />
    </svg>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#f8fafc',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 4,
};

const timeTextStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  minWidth: 34,
  textAlign: 'center',
};

const liveBadgeStyle: React.CSSProperties = {
  flex: 1,
  color: '#f87171',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.5,
};
