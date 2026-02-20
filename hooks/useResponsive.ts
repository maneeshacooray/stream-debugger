import { useWindowDimensions } from 'react-native';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  // Define breakpoints
  const isTablet = width >= 768; // Standard tablet breakpoint
  const isDesktop = width >= 1024;

  // Orientation states
  const isLandscape = width > height;
  const isPortrait = height >= width;

  // Determine if we should use a two-column or wide layout
  // We want to use a two-column layout if we are on a tablet, or if we rotate the phone to landscape
  // but only if there's enough room.
  const isLargeScreen = isTablet || isDesktop || (isLandscape && width >= 600);

  return {
    width,
    height,
    isTablet,
    isDesktop,
    isLandscape,
    isPortrait,
    isLargeScreen,
  };
}
