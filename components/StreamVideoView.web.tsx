import type { WebStreamVideoPlayer } from '@/hooks/useStreamVideoPlayer.web';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

type ContentFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

type StreamVideoViewProps = {
  style?: any;
  player: WebStreamVideoPlayer | null;
  contentFit?: ContentFit;
  // Uses the browser's own native <video controls> chrome rather than a
  // custom-built bar — it's the browser's well-tested UI, and it avoids
  // the whole class of bug where a custom DOM control layer competes with
  // react-native-gesture-handler for pointer events (see ZoomableVideo in
  // app/index.tsx, which only mounts its GestureDetector while zoom is
  // actually active so it can't intercept these controls otherwise).
  nativeControls?: boolean;
  allowsPictureInPicture?: boolean;
  // Accepted for API parity with expo-video's VideoView; fullscreen is left
  // to the browser's native <video> controls on web.
  fullscreenOptions?: { enable?: boolean };
};

// Renders the real <video> element a WebStreamVideoPlayer attaches hls.js
// to. Kept deliberately close to expo-video's <VideoView> prop surface so
// the two call sites in app/index.tsx don't need platform branching.
/**
 * Performance optimization: StreamVideoView is wrapped in React.memo to prevent
 * unnecessary component re-renders when parent components update during playback
 * or log updates. Wrapper div and video inline styles are memoized with useMemo
 * to eliminate repeated StyleSheet.flatten() evaluations and object allocations.
 */
export const StreamVideoView = memo(function StreamVideoView({
  style,
  player,
  contentFit = 'contain',
  nativeControls = true,
  allowsPictureInPicture,
}: StreamVideoViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !player) return;
    player.attach(video);
    return () => player.detach(video);
  }, [player]);

  const divStyle = useMemo(() => {
    const flatStyle = StyleSheet.flatten(style) || {};
    return {
      ...flatStyle,
      position: flatStyle.position ?? 'relative',
      overflow: 'hidden',
    };
  }, [style]);

  const videoStyle = useMemo(() => {
    return {
      position: 'absolute' as const,
      inset: 0,
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: contentFit === 'fill' ? ('fill' as const) : contentFit,
      objectPosition: 'center',
      backgroundColor: '#000',
    };
  }, [contentFit]);

  return (
    <div style={divStyle}>
      <video
        ref={videoRef}
        style={videoStyle}
        controls={nativeControls}
        disablePictureInPicture={allowsPictureInPicture === false}
        playsInline
      />
    </div>
  );
});
