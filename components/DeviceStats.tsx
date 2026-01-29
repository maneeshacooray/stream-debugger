import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React, { memo, useEffect, useState } from 'react';
import { Dimensions, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';

import { monoFont, theme } from '../constants/appTheme';

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
  timestamp: number;
}

// ============================================================================
// Component
// ============================================================================
export const DeviceStats = memo(function DeviceStats() {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    jsHeapSize: null,
    timestamp: Date.now(),
  });

  // Get device info on mount
  useEffect(() => {
    const { width, height } = Dimensions.get('window');

    const info: DeviceInfo = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      appName: Constants.expoConfig?.name || 'Stream Debugger',
      appVersion: Constants.expoConfig?.version || '1.0.0',
      screenWidth: Math.round(width),
      screenHeight: Math.round(height),
      pixelRatio: PixelRatio.get(),
      fontScale: PixelRatio.getFontScale(),
    };

    setDeviceInfo(info);

    // Listen for dimension changes
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDeviceInfo(prev => prev ? {
        ...prev,
        screenWidth: Math.round(window.width),
        screenHeight: Math.round(window.height),
      } : prev);
    });

    return () => subscription.remove();
  }, []);

  // Update performance metrics periodically
  useEffect(() => {
    const interval = setInterval(() => {
      // Try to get JS heap size (available in some environments)
      let heapSize: number | null = null;
      if (typeof performance !== 'undefined' && 'memory' in performance) {
        const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
        heapSize = memory?.usedJSHeapSize ?? null;
      }

      setMetrics({
        jsHeapSize: heapSize,
        timestamp: Date.now(),
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const formatMemory = (bytes: number | null): string => {
    if (bytes === null) return '--';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  if (!deviceInfo) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading device info...</Text>
      </View>
    );
  }

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
const styles = StyleSheet.create({
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
