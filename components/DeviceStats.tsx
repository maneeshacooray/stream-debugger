import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { Dimensions, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';

import { monoFont, Theme } from '../constants/appTheme';

// ============================================================================
// Types
// ============================================================================
interface DeviceInfo {
  platform: string;
  osVersion: string | number;
  appName: string;
  appVersion: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  fontScale: number;
}

interface PerformanceMetrics {
  jsHeapSize: number | null;
}

// ============================================================================
// Helpers
// ============================================================================
const getInitialDeviceInfo = (): DeviceInfo => {
  const { width, height } = Dimensions.get('window');
  return {
    platform: Platform.OS,
    osVersion: Platform.Version,
    appName: Constants.expoConfig?.name || 'Stream Debugger',
    appVersion: Constants.expoConfig?.version || '1.0.0',
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    pixelRatio: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
  };
};

const formatMemory = (bytes: number | null): string => {
  if (bytes === null) return '--';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
};

// ============================================================================
// Component
// ============================================================================
interface DeviceStatsProps {
  theme: Theme;
}

export const DeviceStats = memo(function DeviceStats({ theme }: DeviceStatsProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);

  /**
   * Performance optimization: Lazy state initialization avoids a redundant
   * re-render on mount by calculating initial device info immediately
   * instead of setting it in a useEffect.
   */
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(getInitialDeviceInfo);

  /**
   * Performance optimization: Removed unused 'timestamp' from state to
   * avoid unnecessary object allocations and updates.
   */
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    jsHeapSize: null,
  });

  // Listen for dimension changes
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDeviceInfo(prev => ({
        ...prev,
        screenWidth: Math.round(window.width),
        screenHeight: Math.round(window.height),
      }));
    });

    return () => subscription.remove();
  }, []);

  // Update performance metrics periodically
  useEffect(() => {
    // Optimization: Skip interval entirely if performance.memory is unsupported
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return;
    }

    const interval = setInterval(() => {
      const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
      const heapSize = memory?.usedJSHeapSize ?? null;

      // Optimization: Bail out if metrics haven't changed to prevent re-render
      setMetrics(prev => {
        if (prev.jsHeapSize === heapSize) return prev;
        return { jsHeapSize: heapSize };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="hardware-chip-outline" size={14} color={theme.accent.primary} />
        <Text style={styles.headerText}>Device Info</Text>
      </View>

      {/* Device Info Grid */}
      <View style={styles.grid}>
        {/* Platform */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Platform</Text>
          <Text style={styles.statValue}>{deviceInfo.platform}</Text>
        </View>

        {/* OS Version */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>OS Version</Text>
          <Text style={styles.statValue}>{deviceInfo.osVersion}</Text>
        </View>

        {/* Screen */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Screen</Text>
          <Text style={styles.statValue}>
            {deviceInfo.screenWidth}x{deviceInfo.screenHeight}
          </Text>
        </View>

        {/* Pixel Ratio */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Pixel Ratio</Text>
          <Text style={styles.statValue}>{deviceInfo.pixelRatio.toFixed(1)}x</Text>
        </View>

        {/* Font Scale */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Font Scale</Text>
          <Text style={styles.statValue}>{deviceInfo.fontScale.toFixed(2)}</Text>
        </View>

        {/* App Version */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>App Version</Text>
          <Text style={styles.statValue}>{deviceInfo.appVersion}</Text>
        </View>

        {/* JS Heap (if available) */}
        {metrics.jsHeapSize !== null && (
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>JS Heap</Text>
            <Text style={styles.statValue}>{formatMemory(metrics.jsHeapSize)}</Text>
          </View>
        )}
      </View>
    </View>
  );
});

// ============================================================================
// Styles
// ============================================================================
const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.bg.card,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text.primary,
  },
  loadingText: {
    fontSize: 11,
    color: theme.text.muted,
    textAlign: 'center',
    paddingVertical: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statBox: {
    backgroundColor: theme.bg.tertiary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.border,
    minWidth: '30%',
    flex: 1,
  },
  statLabel: {
    fontSize: 8,
    color: theme.text.muted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.text.primary,
    fontFamily: monoFont,
  },
});

export default DeviceStats;
