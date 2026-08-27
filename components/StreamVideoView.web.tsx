import type { WebStreamVideoPlayer } from '@/hooks/useStreamVideoPlayer.web';
import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

type ContentFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

type StreamVideoViewProps = {
  style?: any;
  player: WebStreamVideoPlayer | null;
  contentFit?: ContentFit;
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

  const flatStyle = StyleSheet.flatten(style) || {};

  return (
    <video
      ref={videoRef}
      style={{
        ...flatStyle,
        objectFit: contentFit === 'fill' ? 'fill' : contentFit,
        backgroundColor: '#000',
      }}
      controls={nativeControls}
      disablePictureInPicture={allowsPictureInPicture === false}
      playsInline
    />
  );
}
