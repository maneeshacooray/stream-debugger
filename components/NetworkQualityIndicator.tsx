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

const QUALITY_THRESHOLDS = {
  excellent: { minBitrate: 8_000_000, maxLatency: 50, maxBufferRatio: 0.8 },
  good: { minBitrate: 4_000_000, maxLatency: 100, maxBufferRatio: 0.6 },
  fair: { minBitrate: 1_500_000, maxLatency: 200, maxBufferRatio: 0.4 },
  poor: { minBitrate: 0, maxLatency: Infinity, maxBufferRatio: 0 },
};

const QUALITY_COLORS = qualityColors;

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
  const stallResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Reset stall count after 30 seconds of good playback
    if (stallResetTimerRef.current) {
      clearTimeout(stallResetTimerRef.current);
    }
    stallResetTimerRef.current = setTimeout(() => {
      setStallCount(0);
    }, 30000);

    return () => {
      if (stallResetTimerRef.current) {
        clearTimeout(stallResetTimerRef.current);
      }
    };
  }, [currentTime, isPlaying]);

  // Report stats to parent
  useEffect(() => {
    if (onStatsUpdate) {
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
    }
  }, [quality, bitrate, latency, bufferHealth, stallCount, lastStallDuration, onStatsUpdate]);

  const color = QUALITY_COLORS[quality];

  return (
    <View style={styles.container}>
      {/* Quality Badge */}
      <View style={[styles.qualityBadge, { backgroundColor: color + '20', borderColor: color }]}>
        <View style={styles.signalBars}>
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={[
                styles.signalBar,
                {
                  height: 4 + i * 3,
                  backgroundColor:
                    (quality === 'excellent' && i <= 3) ||
                    (quality === 'good' && i <= 2) ||
                    (quality === 'fair' && i <= 1) ||
                    (quality === 'poor' && i <= 0)
                      ? color
                      : color + '30',
                },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.qualityText, { color }]}>{QUALITY_LABELS[quality]}</Text>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        {/* Bitrate */}
        <View style={styles.statItem}>
          <Ionicons name="speedometer-outline" size={12} color="#94a3b8" />
          <Text style={styles.statValue}>{formatSpeed(bitrate)}</Text>
        </View>

        {/* Buffer */}
        <View style={styles.statItem}>
          <View style={styles.bufferBarContainer}>
            <View style={[styles.bufferBar, { width: `${bufferHealth * 100}%`, backgroundColor: color }]} />
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
            <Ionicons name="warning-outline" size={12} color={QUALITY_COLORS.poor} />
            <Text style={[styles.statValue, { color: QUALITY_COLORS.poor }]}>{stallCount}</Text>
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
});

export default NetworkQualityIndicator;
