import { Ionicons } from '@expo/vector-icons';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { monoFont, qualityColors } from '../constants/appTheme';

// ============================================================================
// Types
// ============================================================================
export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline';

export interface NetworkStats {
  quality: NetworkQuality;
  downloadSpeed: number | null; // Mbps
  latency: number | null; // ms
  packetLoss: number | null; // percentage
  jitter: number | null; // ms
  bufferHealth: number; // 0-1 (buffer ahead / target buffer)
  stallCount: number;
  lastStallDuration: number | null; // ms
}

interface NetworkQualityIndicatorProps {
  bitrate: number | null; // Current video bitrate in bps
  bufferedPosition: number; // Buffered time in seconds
  currentTime: number; // Current playback time
  isPlaying: boolean;
  isLive: boolean;
  latency: number | null; // Live stream latency
  onStatsUpdate?: (stats: NetworkStats) => void;
}

// ============================================================================
// Constants
// ============================================================================
const TARGET_BUFFER_SECONDS = 10; // Target buffer for VOD
const TARGET_LIVE_BUFFER_SECONDS = 4; // Target buffer for live

const QUALITY_LABELS: Record<NetworkQuality, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  offline: 'Offline',
};

// ============================================================================
// Helper Functions
// ============================================================================
function calculateQuality(
  bitrate: number | null,
  bufferHealth: number,
  latency: number | null,
  stallCount: number
): NetworkQuality {
  // If we've had multiple stalls recently, quality is poor
  if (stallCount >= 3) return 'poor';

  // Calculate score based on multiple factors
  let score = 0;

  // Bitrate score (0-40 points)
  if (bitrate !== null) {
    if (bitrate >= 8_000_000) score += 40;
    else if (bitrate >= 4_000_000) score += 30;
    else if (bitrate >= 1_500_000) score += 20;
    else if (bitrate >= 500_000) score += 10;
  } else {
    score += 20; // Neutral if unknown
  }

  // Buffer health score (0-40 points)
  score += Math.min(40, bufferHealth * 40);

  // Latency score for live streams (0-20 points)
  if (latency !== null) {
    if (latency <= 2) score += 20;
    else if (latency <= 5) score += 15;
    else if (latency <= 10) score += 10;
    else if (latency <= 20) score += 5;
  } else {
    score += 15; // Neutral if not live
  }

  // Stall penalty
  score -= stallCount * 10;

  // Convert score to quality
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

function formatSpeed(bps: number | null): string {
  if (bps === null) return '--';
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = bps / 1_000;
  return `${kbps.toFixed(0)} kbps`;
}

// ============================================================================
// Quality Badge Component
// ============================================================================
interface QualityBadgeProps {
  quality: NetworkQuality;
}

/**
 * Performance optimization: Isolated QualityBadge component to prevent
 * redundant re-renders of the signal bars and label when video stats
 * (like currentTime) update every 500ms, but the quality status is stable.
 */
const QualityBadge = memo(function QualityBadge({ quality }: QualityBadgeProps) {
  const isActive = (level: number) => {
    switch (quality) {
      case 'excellent': return level <= 3;
      case 'good': return level <= 2;
      case 'fair': return level <= 1;
      case 'poor': return level <= 0;
      default: return false;
    }
  };

  return (
    <View style={[styles.qualityBadge, styles[`badge_${quality}`]]}>
      <View style={styles.signalBars}>
        <View style={[styles.signalBar, styles.bar0, isActive(0) ? styles[`barActive_${quality}`] : styles[`barInactive_${quality}`]]} />
        <View style={[styles.signalBar, styles.bar1, isActive(1) ? styles[`barActive_${quality}`] : styles[`barInactive_${quality}`]]} />
        <View style={[styles.signalBar, styles.bar2, isActive(2) ? styles[`barActive_${quality}`] : styles[`barInactive_${quality}`]]} />
        <View style={[styles.signalBar, styles.bar3, isActive(3) ? styles[`barActive_${quality}`] : styles[`barInactive_${quality}`]]} />
      </View>
      <Text style={[styles.qualityText, styles[`text_${quality}`]]}>{QUALITY_LABELS[quality]}</Text>
    </View>
  );
});

// ============================================================================
// Component
// ============================================================================
export const NetworkQualityIndicator = memo(function NetworkQualityIndicator({
  bitrate,
  bufferedPosition,
  currentTime,
  isPlaying,
  isLive,
  latency,
  onStatsUpdate,
}: NetworkQualityIndicatorProps) {
  // Stall detection
  const [stallCount, setStallCount] = useState(0);
  const [lastStallDuration, setLastStallDuration] = useState<number | null>(null);
  const lastTimeRef = useRef(currentTime);
  const stallStartRef = useRef<number | null>(null);

  // Calculate buffer health
  const bufferAhead = bufferedPosition - currentTime;
  const targetBuffer = isLive ? TARGET_LIVE_BUFFER_SECONDS : TARGET_BUFFER_SECONDS;
  const bufferHealth = Math.min(1, Math.max(0, bufferAhead / targetBuffer));

  // Calculate quality
  const quality = useMemo(() => {
    if (!isPlaying && bufferHealth < 0.1) return 'offline';
    return calculateQuality(bitrate, bufferHealth, latency, stallCount);
  }, [bitrate, bufferHealth, latency, stallCount, isPlaying]);

  // Stall detection effect
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = currentTime;
      return;
    }

    const timeDiff = currentTime - lastTimeRef.current;
    const now = Date.now();

    // Detect stall: time hasn't moved in expected interval
    if (timeDiff <= 0 && lastTimeRef.current > 0) {
      if (stallStartRef.current === null) {
        stallStartRef.current = now;
      }
    } else {
      // Playback resumed
      if (stallStartRef.current !== null) {
        const stallDuration = now - stallStartRef.current;
        if (stallDuration > 500) { // Only count stalls > 500ms
          setStallCount(prev => prev + 1);
          setLastStallDuration(stallDuration);
        }
        stallStartRef.current = null;
      }
    }

    lastTimeRef.current = currentTime;
  }, [currentTime, isPlaying]);

  /**
   * Performance optimization: Isolated stall reset timer logic.
   * By moving this to a separate effect that only depends on stallCount,
   * we prevent the timer from being cleared and rescheduled every 500ms
   * during normal playback. This reduces JS timer churn and ensures the
   * stall count correctly recovers after 30 seconds of healthy playback.
   */
  useEffect(() => {
    if (stallCount > 0) {
      const timer = setTimeout(() => {
        setStallCount(0);
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [stallCount]);

  // Memoize formatted bitrate to avoid redundant string formatting every 500ms
  const formattedBitrate = useMemo(() => formatSpeed(bitrate), [bitrate]);

  // Report stats to parent - only if callback is provided
  useEffect(() => {
    if (!onStatsUpdate) return;

    const stats: NetworkStats = {
      quality,
      downloadSpeed: bitrate,
      latency: latency !== null ? latency * 1000 : null, // Convert to ms
      packetLoss: null, // Not available from expo-video
      jitter: null, // Not available from expo-video
      bufferHealth,
      stallCount,
      lastStallDuration,
    };
    onStatsUpdate(stats);
  }, [quality, bitrate, latency, bufferHealth, stallCount, lastStallDuration, onStatsUpdate]);

  return (
    <View style={styles.container}>
      {/* Quality Badge - Optimized to prevent re-renders */}
      <QualityBadge quality={quality} />

      {/* Stats Row */}
      <View style={styles.statsRow}>
        {/* Bitrate */}
        <View style={styles.statItem}>
          <Ionicons name="speedometer-outline" size={12} color="#94a3b8" />
          <Text style={styles.statValue}>{formattedBitrate}</Text>
        </View>

        {/* Buffer */}
        <View style={styles.statItem}>
          <View style={styles.bufferBarContainer}>
            <View style={[styles.bufferBar, styles[`buffer_bar_${quality}`], { width: `${bufferHealth * 100}%` }]} />
          </View>
          <Text style={styles.statValue}>{bufferAhead.toFixed(1)}s</Text>
        </View>

        {/* Latency (live only) */}
        {isLive && latency !== null && (
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={12} color="#94a3b8" />
            <Text style={styles.statValue}>{latency.toFixed(1)}s</Text>
          </View>
        )}

        {/* Stalls indicator */}
        {stallCount > 0 && (
          <View style={styles.statItem}>
            <Ionicons name="warning-outline" size={12} color={qualityColors.poor} />
            <Text style={[styles.statValue, { color: qualityColors.poor }]}>{stallCount}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
  },
  signalBar: {
    width: 3,
    borderRadius: 1,
  },
  bar0: { height: 4 },
  bar1: { height: 7 },
  bar2: { height: 10 },
  bar3: { height: 13 },
  qualityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: monoFont,
  },
  bufferBarContainer: {
    width: 30,
    height: 4,
    backgroundColor: '#252535',
    borderRadius: 2,
    overflow: 'hidden',
  },
  bufferBar: {
    height: '100%',
    borderRadius: 2,
  },
  // Performance optimization: Pre-calculate all quality-variant styles
  // to avoid dynamic string and object allocations in high-frequency render paths.
  badge_excellent: { backgroundColor: qualityColors.excellent + '20', borderColor: qualityColors.excellent },
  badge_good: { backgroundColor: qualityColors.good + '20', borderColor: qualityColors.good },
  badge_fair: { backgroundColor: qualityColors.fair + '20', borderColor: qualityColors.fair },
  badge_poor: { backgroundColor: qualityColors.poor + '20', borderColor: qualityColors.poor },
  badge_offline: { backgroundColor: qualityColors.offline + '20', borderColor: qualityColors.offline },

  text_excellent: { color: qualityColors.excellent },
  text_good: { color: qualityColors.good },
  text_fair: { color: qualityColors.fair },
  text_poor: { color: qualityColors.poor },
  text_offline: { color: qualityColors.offline },

  barActive_excellent: { backgroundColor: qualityColors.excellent },
  barActive_good: { backgroundColor: qualityColors.good },
  barActive_fair: { backgroundColor: qualityColors.fair },
  barActive_poor: { backgroundColor: qualityColors.poor },
  barActive_offline: { backgroundColor: qualityColors.offline },

  barInactive_excellent: { backgroundColor: qualityColors.excellent + '30' },
  barInactive_good: { backgroundColor: qualityColors.good + '30' },
  barInactive_fair: { backgroundColor: qualityColors.fair + '30' },
  barInactive_poor: { backgroundColor: qualityColors.poor + '30' },
  barInactive_offline: { backgroundColor: qualityColors.offline + '30' },

  buffer_bar_excellent: { backgroundColor: qualityColors.excellent },
  buffer_bar_good: { backgroundColor: qualityColors.good },
  buffer_bar_fair: { backgroundColor: qualityColors.fair },
  buffer_bar_poor: { backgroundColor: qualityColors.poor },
  buffer_bar_offline: { backgroundColor: qualityColors.offline },
});

export default NetworkQualityIndicator;
