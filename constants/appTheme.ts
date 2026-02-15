import { Platform, useColorScheme } from 'react-native';

/**
 * Centralized theme configuration for Stream Debugger
 * Used across all components for consistent styling
 */
export interface Theme {
  isDark: boolean;
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    card: string;
    elevated: string;
  };
  accent: {
    primary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  border: string;
}

export const defaultTheme = {
  isDark: true,
  bg: {
    primary: '#0a0a0f',
    secondary: '#101018',
    tertiary: '#18181f',
    card: '#141420',
    elevated: '#1c1c28',
  },
  accent: {
    primary: '#818cf8',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
  },
  text: {
    primary: '#f8fafc',
    secondary: '#94a3b8',
    muted: '#64748b',
  },
  border: '#252535',
} as const;

// Theme type is now defined explicitly above

/**
 * Hook to get the current app theme.
 * Uses Material 3 dynamic colors on Android 12+ if available.
 * Falls back to default dark theme on iOS or older Android.
 */
export function useAppTheme(mode?: 'system' | 'light' | 'dark'): Theme {
  const systemColorScheme = useColorScheme();

  // Determine effective color scheme
  const isSystem = !mode || mode === 'system';
  const effectiveScheme = isSystem ? systemColorScheme : mode;
  const isDark = effectiveScheme === 'dark';

  // Use simple, reliable light/dark themes
  if (isDark) {
    // Dark theme
    return {
      isDark: true,
      bg: {
        primary: '#0a0a0f',
        secondary: '#101018',
        tertiary: '#18181f',
        card: '#141420',
        elevated: '#1c1c28',
      },
      accent: {
        primary: '#818cf8',
        success: '#34d399',
        warning: '#fbbf24',
        error: '#f87171',
        info: '#60a5fa',
      },
      text: {
        primary: '#f8fafc',
        secondary: '#94a3b8',
        muted: '#64748b',
      },
      border: '#252535',
    };
  } else {
    // Light theme
    return {
      isDark: false,
      bg: {
        primary: '#ffffff',
        secondary: '#f8fafc',
        tertiary: '#f1f5f9',
        card: '#ffffff',
        elevated: '#f8fafc',
      },
      accent: {
        primary: '#6366f1',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
      },
      text: {
        primary: '#0f172a',
        secondary: '#475569',
        muted: '#94a3b8',
      },
      border: '#e2e8f0',
    };
  }
}

// Keep a static export for non-component usage (fallback)
export const theme = defaultTheme;

// Log level colors
export const logColors = {
  info: theme.accent.info,
  warn: theme.accent.warning,
  error: theme.accent.error,
  debug: theme.text.muted,
} as const;

// Log category colors
export const categoryColors = {
  http: '#22d3ee',
  player: '#a78bfa',
  system: '#94a3b8',
} as const;

// Network quality colors
export const qualityColors = {
  excellent: '#34d399',
  good: '#60a5fa',
  fair: '#fbbf24',
  poor: '#f87171',
  offline: '#64748b',
} as const;

// Font family helper
export const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
