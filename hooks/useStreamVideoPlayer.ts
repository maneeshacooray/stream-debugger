// Native (iOS/Android) implementation: expo-video already plays HLS
// natively via AVPlayer/ExoPlayer, so this is a thin passthrough.
// See useStreamVideoPlayer.web.ts for the web-specific implementation,
// which is needed because browsers (other than Safari) can't play HLS
// without hls.js.
export { useVideoPlayer as useStreamVideoPlayer } from 'expo-video';
