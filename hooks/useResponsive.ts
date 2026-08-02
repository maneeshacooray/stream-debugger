import { useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';

/**
 * Helper to retrieve rounded window dimensions.
 */
const getRoundedDimensions = () => {
  const { width, height } = Dimensions.get('window');
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
};

/**
 * Hook to provide responsive layout information based on window dimensions.
 *
 * Performance optimization:
 * Replacing the raw useWindowDimensions() subscription with a custom Dimensions
 * change listener that rounds the width and height. By performing a state update
 * bail-out check when rounded values are unchanged, we prevent high-frequency
 * layout re-renders (especially on web during window resizing).
 * This reduces dynamic string allocations, layout re-calculations, and GC pressure
 * across the entire application tree.
 */
export function useResponsive() {
  const [dimensions, setDimensions] = useState(() => getRoundedDimensions());

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const roundedWidth = Math.round(window.width);
      const roundedHeight = Math.round(window.height);

      setDimensions(prev => {
        // State update bail-out: skip if rounded dimensions are identical
        if (prev.width === roundedWidth && prev.height === roundedHeight) {
          return prev;
        }
        return {
          width: roundedWidth,
          height: roundedHeight,
        };
      });
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const { width, height } = dimensions;

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
