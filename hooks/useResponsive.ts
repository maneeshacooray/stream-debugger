import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Hook to provide responsive layout information based on window dimensions.
 * Optimized with useMemo to ensure referential stability, preventing unnecessary
 * re-renders in components that consume this hook's data.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
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
  }, [width, height]);
}
