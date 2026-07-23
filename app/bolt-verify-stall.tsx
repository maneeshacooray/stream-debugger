import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { NetworkQualityIndicator, NetworkStats } from '../components/NetworkQualityIndicator';

export default function BoltVerifyStall() {
  const [currentTime, setCurrentTime] = useState(5.0);
  const isPlaying = true;
  const [isForcingStall, setIsForcingStall] = useState(false);
  const [stats, setStats] = useState<NetworkStats | null>(null);

  const handleStatsUpdate = useCallback((newStats: NetworkStats) => {
    setStats(newStats);
  }, []);

  useEffect(() => {
    if (isPlaying && !isForcingStall) {
      const interval = setInterval(() => {
        setCurrentTime(prev => prev + 0.1);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, isForcingStall]);

  useEffect(() => {
    if (isPlaying && isForcingStall) {
      const interval = setInterval(() => {
        setCurrentTime(prev => prev - 0.0001);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, isForcingStall]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stall Optimization Verification</Text>
      <View style={styles.indicatorContainer}>
        <NetworkQualityIndicator
          bitrate={5000000}
          bufferedPosition={20}
          currentTime={currentTime}
          isPlaying={isPlaying}
          isLive={false}
          latency={null}
          onStatsUpdate={handleStatsUpdate}
        />
      </View>
      <View style={styles.controls}>
        <Pressable
          style={[styles.button, isForcingStall && styles.buttonActive]}
          onPress={() => setIsForcingStall(!isForcingStall)}
          testID="toggle-stall"
        >
          <Text style={styles.buttonText}>{isForcingStall ? 'Resume' : 'Stall'}</Text>
        </Pressable>
      </View>
      <View style={styles.stats}>
        <Text style={styles.statsText} testID="stall-count">Stalls: {stats?.stallCount ?? 0}</Text>
        <Text style={styles.statsText}>Time: {currentTime.toFixed(1)}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0a0a0f', justifyContent: 'center' },
  title: { fontSize: 20, color: '#f8fafc', textAlign: 'center', marginBottom: 30, fontWeight: '700' },
  indicatorContainer: { padding: 20, backgroundColor: '#141420', borderRadius: 12, marginBottom: 20, alignItems: 'center' },
  controls: { gap: 12, marginBottom: 30 },
  button: { backgroundColor: '#818cf8', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonActive: { backgroundColor: '#f87171' },
  buttonText: { color: '#fff', fontWeight: '600' },
  stats: { backgroundColor: '#1c1c28', padding: 15, borderRadius: 8 },
  statsText: { color: '#94a3b8', fontSize: 14, marginBottom: 5, fontFamily: 'monospace' },
});
