import { useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';

/**
 * Performance optimization: Replace raw useWindowDimensions() subscription
 * with a custom Dimensions change listener that rounds the dimensions and
 * performs a state update bail-out check when rounded values are unchanged.
 * This prevents high-frequency layout re-renders on web during window resizing.
 * Additionally, uses lazy state initialization to prevent redundant
 * render -> useEffect -> update -> re-render cycles on component mount.
 */
export function useResponsive() {
  const [dimensions, setDimensions] = useState(() => {
    const window = Dimensions.get('window');
    return {
      width: Math.round(window.width),
      height: Math.round(window.height),
    };
  });

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const nextWidth = Math.round(window.width);
      const nextHeight = Math.round(window.height);

      setDimensions(prev => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    });

    return () => subscription.remove();
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
