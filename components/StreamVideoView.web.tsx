import type { WebStreamVideoPlayer } from '@/hooks/useStreamVideoPlayer.web';
import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

type ContentFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

type StreamVideoViewProps = {
  style?: any;
  player: WebStreamVideoPlayer | null;
  contentFit?: ContentFit;
  // Kept for API parity with expo-video's <VideoView>; on web the scrub bar
  // is rendered separately by <StreamVideoControls> (see app/index.tsx),
  // outside of any gesture-handling wrapper, so this component never draws
  // its own controls.
  nativeControls?: boolean;
  allowsPictureInPicture?: boolean;
  // Accepted for API parity with expo-video's VideoView; fullscreen is left
  // to the browser's native <video> controls on web.
  fullscreenOptions?: { enable?: boolean };
};

// Renders the real <video> element a WebStreamVideoPlayer attaches hls.js
// to. Kept deliberately close to expo-video's <VideoView> prop surface so
// the two call sites in app/index.tsx don't need platform branching.
export function StreamVideoView({
  style,
  player,
  contentFit = 'contain',
  allowsPictureInPicture,
}: StreamVideoViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !player) return;
    player.attach(video);
    return () => player.detach(video);
  }, [player]);

  const flatStyle = StyleSheet.flatten(style) || {};

  return (
    <div
      style={{
        ...flatStyle,
        position: flatStyle.position ?? 'relative',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: contentFit === 'fill' ? 'fill' : contentFit,
          objectPosition: 'center',
          backgroundColor: '#000',
        }}
        controls={false}
        disablePictureInPicture={allowsPictureInPicture === false}
        playsInline
      />
    </div>
  );
}
