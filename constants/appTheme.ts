import { Platform } from 'react-native';

/**
 * Centralized theme configuration for Stream Debugger
 * Used across all components for consistent styling
 */
export const theme = {
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

export type Theme = typeof theme;

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
