// Native (iOS/Android): expo-video's own nativeControls prop already draws
// a working scrub bar, so this overlay isn't needed. See
// StreamVideoControls.web.tsx for the web-specific implementation.
export function StreamVideoControls(_props: { player: unknown }) {
  return null;
}
