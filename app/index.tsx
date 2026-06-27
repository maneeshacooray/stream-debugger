import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/useResponsive';

// Stream configuration
import { StreamConfig, useStreamConfig } from '../config/streams';

// Components
import { DeviceStats } from '../components/DeviceStats';
import { NetworkQualityIndicator } from '../components/NetworkQualityIndicator';
import { StreamMetadata } from '../components/StreamMetadata';

// Theme & About
import { ABOUT } from '../constants/about';
import { categoryColors, logColors, Theme, useAppTheme } from '../constants/appTheme';

// ============================================================================
// Constants
// ============================================================================
const MAX_LOGS = 500;
const LOG_ITEM_HEIGHT = 72; // Approximate height for FlatList optimization
const SCREEN_WIDTH = Dimensions.get('window').width;

// ============================================================================
// Types
// ============================================================================
type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogCategory = 'http' | 'player' | 'system';
type FilterCategory = 'all' | LogCategory;

interface LogEntry {
  id: string;
  timestamp: number;
  time: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================
const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const parseCodecName = (mimeType: string | null, theme: Theme): { name: string; fullName: string; color: string } => {
  if (!mimeType) return { name: '--', fullName: 'Unknown', color: theme.text.muted };

  const mime = mimeType.toLowerCase();

  // H.265 / HEVC
  if (mime.includes('hevc') || mime.includes('hvc1') || mime.includes('hev1') || mime.includes('h265') || mime.includes('x265')) {
    return { name: 'H.265', fullName: 'HEVC (H.265)', color: theme.accent.success };
  }
  // H.264 / AVC
  if (mime.includes('avc') || mime.includes('h264') || mime.includes('x264')) {
    return { name: 'H.264', fullName: 'AVC (H.264)', color: theme.accent.info };
  }
  // VP9
  if (mime.includes('vp9') || mime.includes('vp09')) {
    return { name: 'VP9', fullName: 'VP9', color: theme.accent.warning };
  }
  // VP8
  if (mime.includes('vp8')) {
    return { name: 'VP8', fullName: 'VP8', color: theme.accent.warning };
  }
  // AV1
  if (mime.includes('av1') || mime.includes('av01')) {
    return { name: 'AV1', fullName: 'AV1', color: '#ff6b9d' };
  }
  // MPEG-4
  if (mime.includes('mp4v') || mime.includes('mpeg4')) {
    return { name: 'MPEG-4', fullName: 'MPEG-4 Part 2', color: theme.text.secondary };
  }

  // Return the raw mime type if unknown
  return { name: mimeType.split('/').pop() || mimeType, fullName: mimeType, color: theme.text.secondary };
};

// ============================================================================
// Memoized Log Entry Component
// ============================================================================
interface LogEntryProps {
  log: LogEntry;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onCopy: (log: LogEntry) => void;
  theme: Theme;
  styles: any;
}

const LogEntryItem = memo(function LogEntryItem({ log, isExpanded, onToggleExpand, onCopy, theme, styles }: LogEntryProps) {
  const isMultiline = log.message.includes('\n') || log.message.length > 80;

  const handlePress = useCallback(() => {
    if (isMultiline) onToggleExpand(log.id);
  }, [isMultiline, onToggleExpand, log.id]);

  const handleLongPress = useCallback(() => {
    onCopy(log);
  }, [onCopy, log]);

  return (
    <Pressable
      style={[styles.logEntry, log.level === 'error' && styles.logEntryError]}
      onPress={handlePress}
      onLongPress={handleLongPress}
    >
      <View style={styles.logHeader}>
        <Text style={styles.logTime}>{log.time}</Text>
        <View style={[styles.logLevel, { backgroundColor: logColors[log.level] + '25' }]}>
          <Text style={[styles.logLevelText, { color: logColors[log.level] }]}>
            {log.level.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.logCategory, { backgroundColor: categoryColors[log.category] + '15' }]}>
          <Text style={[styles.logCategoryText, { color: categoryColors[log.category] }]}>
            {log.category}
          </Text>
        </View>
        {isMultiline && (
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.text.muted}
            style={styles.expandIcon}
          />
        )}
      </View>
      <Text
        style={[styles.logMessage, log.level === 'error' && styles.logMessageError]}
        numberOfLines={isExpanded ? undefined : 2}
      >
        {log.message}
      </Text>
    </Pressable>
  );
});

// ============================================================================
// Main Screen Tab Types and Configuration
// ============================================================================
type MainTabId = 'info' | 'playlist' | 'logs';

interface MainTabItem {
  id: MainTabId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MAIN_TABS: MainTabItem[] = [
  { id: 'info', label: 'Info', icon: 'information-circle-outline' },
  { id: 'playlist', label: 'Playlist', icon: 'list-outline' },
  { id: 'logs', label: 'Logs', icon: 'terminal-outline' },
];

// ============================================================================
// Main Tab Bar Component
// ============================================================================
interface MainTabBarProps {
  activeTab: MainTabId;
  onTabChange: (tab: MainTabId) => void;
  theme: Theme;
  bottomInset: number;
  styles: any;
}

const MainTabBar = memo(function MainTabBar({ activeTab, onTabChange, theme, bottomInset, styles }: MainTabBarProps) {
  return (
    <View style={[styles.mainTabBar, { paddingBottom: bottomInset }]}>
      {MAIN_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            style={[styles.mainTab, isActive && styles.mainTabActive]}
            onPress={() => onTabChange(tab.id)}
          >
            <Ionicons
              name={tab.icon}
              size={22}
              color={isActive ? theme.accent.primary : theme.text.muted}
            />
            <Text style={[styles.mainTabLabel, isActive && styles.mainTabLabelActive]}>
              {tab.label}
            </Text>
            {isActive && <View style={styles.mainTabIndicator} />}
          </Pressable>
        );
      })}
    </View>
  );
});

// ============================================================================
// Zoomable Video Component
// ============================================================================
interface ZoomableVideoProps {
  player: any;
  enabled: boolean;
  theme: Theme;
  styles: any;
}

/**
 * Memoized ZoomableVideo component to prevent unnecessary re-renders
 * when the main StreamDebugger component updates (e.g. during time updates or logging).
 */
const ZoomableVideo = memo(function ZoomableVideo({ player, enabled, theme, styles }: ZoomableVideoProps) {
  const scale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Reset check when disabled
  useEffect(() => {
    if (!enabled) {
      scale.value = withSpring(1);
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    }
  }, [enabled]);

  const pinchGesture = Gesture.Pinch()
    .enabled(enabled)
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(event.scale, 4));
      focalX.value = event.focalX;
      focalY.value = event.focalY;
    })
    .onEnd(() => {
      scale.value = withSpring(1);
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    });

  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .onUpdate((event) => {
      if (scale.value > 1) {
        translateX.value = event.translationX;
        translateY.value = event.translationY;
      }
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: enabled ? 999 : 0, // Ensure it's on top when zooming
  }));

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.video, animatedStyle]}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          allowsPictureInPicture
          fullscreenOptions={{ enable: false }}
          contentFit="contain"
          nativeControls // Show native controls (timeline, play/pause) at all times
        />
      </Animated.View>
    </GestureDetector>
  );
});

// ============================================================================
// Multi-View Player Component (lazy loaded)
// ============================================================================
interface MultiViewPlayerProps {
  streamUrl: string;
  label: string;
  onLog?: (message: string, level: 'info' | 'error') => void;
  onPress?: () => void;
  theme: Theme;
  styles: any;
}

const MultiViewPlayer = memo(function MultiViewPlayer({ streamUrl, label, onLog, onPress, theme, styles }: MultiViewPlayerProps) {
  const player = useVideoPlayer(streamUrl || null);
  const mountedRef = useRef(true);
  const loadStartRef = useRef(Date.now());
  const [loadTimeMs, setLoadTimeMs] = useState<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    loadStartRef.current = Date.now();
    setLoadTimeMs(null);

    if (!player) return;

    player.loop = false;
    player.muted = true; // Mute multi-view players by default

    const statusListener = player.addListener('statusChange', ({ status, error }) => {
      if (!mountedRef.current) return;
      if (status === 'readyToPlay') {
        const elapsed = Date.now() - loadStartRef.current;
        setLoadTimeMs(elapsed);
        onLog?.(`${label}: Ready in ${(elapsed / 1000).toFixed(1)}s`, 'info');
      } else if (status === 'error' && error) {
        onLog?.(`${label}: ${error}`, 'error');
      }
    });

    const playTimer = setTimeout(() => {
      if (mountedRef.current) {
        try {
          player.play();
        } catch (e) {
          // Ignore errors
        }
      }
    }, 300);

    return () => {
      mountedRef.current = false;
      statusListener?.remove();
      clearTimeout(playTimer);
      try {
        player.pause();
      } catch { }
    };
  }, [player, label, onLog]);

  return (
    <Pressable style={styles.multiViewCard} onPress={onPress}>
      <View style={[styles.multiViewVideoWrapper, { pointerEvents: 'none' }]}>
        {player && streamUrl && (
          <VideoView
            style={styles.video}
            player={player}
            contentFit="contain"
            nativeControls={false}
          />
        )}
      </View>
      <View style={styles.multiViewLabel}>
        <View style={styles.liveDot} />
        <Text style={styles.multiViewLabelText} numberOfLines={1}>
          {label}
        </Text>
        {loadTimeMs !== null ? (
          <Text style={styles.multiViewLoadTime}>{(loadTimeMs / 1000).toFixed(1)}s</Text>
        ) : (
          <Text style={styles.multiViewLoadTimePending}>...</Text>
        )}
      </View>
    </Pressable>
  );
});

// ============================================================================
// Info Tab Content Component
// ============================================================================
interface InfoTabContentProps {
  player: any;
  streamUrl: string;
  theme: Theme;
  isPlaying: boolean;
  styles: any;
}

/**
 * Isolated Info tab content to prevent frequent re-renders of the entire app
 * when video stats (currentTime, etc) update every 500ms.
 */
const InfoTabContent = memo(function InfoTabContent({ player, streamUrl, theme, isPlaying, styles }: InfoTabContentProps) {
  const [showStats, setShowStats] = useState(true);
  const [videoStats, setVideoStats] = useState<{
    currentTime: number;
    duration: number;
    bufferedPosition: number;
    isLive: boolean;
    currentOffsetFromLive: number | null;
    videoTrack: {
      width: number;
      height: number;
      bitrate: number | null;
      frameRate: number | null;
      mimeType: string | null;
    } | null;
    audioTrack: {
      label: string;
      language: string;
    } | null;
    playbackRate: number;
    volume: number;
    muted: boolean;
  }>({
    currentTime: 0,
    duration: 0,
    bufferedPosition: 0,
    isLive: false,
    currentOffsetFromLive: null,
    videoTrack: null,
    audioTrack: null,
    playbackRate: 1,
    volume: 1,
    muted: false,
  });

  useEffect(() => {
    if (!player) return;

    const listener = player.addListener('timeUpdate', ({ currentTime, bufferedPosition, currentOffsetFromLive }: { currentTime: number; bufferedPosition: number; currentOffsetFromLive: number | null }) => {
      setVideoStats(prev => ({
        ...prev,
        currentTime,
        bufferedPosition,
        duration: player.duration,
        isLive: player.isLive,
        currentOffsetFromLive,
        playbackRate: player.playbackRate,
        volume: player.volume,
        muted: player.muted,
        videoTrack: player.videoTrack ? {
          width: player.videoTrack.size.width,
          height: player.videoTrack.size.height,
          bitrate: player.videoTrack.bitrate,
          frameRate: player.videoTrack.frameRate,
          mimeType: player.videoTrack.mimeType,
        } : null,
        audioTrack: player.audioTrack ? {
          label: player.audioTrack.label,
          language: player.audioTrack.language,
        } : null,
      }));
    });

    return () => {
      listener?.remove();
    };
  }, [player]);

  return (
    <>
      {/* Network Quality Indicator */}
      <View style={styles.networkQualityRow}>
        <NetworkQualityIndicator
          bitrate={videoStats.videoTrack?.bitrate ?? null}
          bufferedPosition={videoStats.bufferedPosition}
          currentTime={videoStats.currentTime}
          isPlaying={isPlaying}
          isLive={videoStats.isLive}
          latency={videoStats.currentOffsetFromLive}
        />
      </View>

      {/* Stream Metadata / Playlist Viewer */}
      <StreamMetadata streamUrl={streamUrl} theme={theme} />

      {/* Video Stats Panel */}
      <Pressable style={styles.videoStatsHeader} onPress={() => setShowStats(v => !v)}>
        <View style={styles.videoStatsHeaderLeft}>
          <Ionicons name="analytics-outline" size={16} color={theme.accent.primary} />
          <Text style={styles.videoStatsTitle}>Video Stats</Text>
          {videoStats.isLive && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDotSmall} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          )}
        </View>
        <Ionicons name={showStats ? 'chevron-up' : 'chevron-down'} size={16} color={theme.text.secondary} />
      </Pressable>

      {
        showStats && (
          <View style={styles.videoStatsPanelInline}>
            {/* Time & Progress Row */}
            <View style={styles.videoStatsRow}>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Current Time</Text>
                <Text style={styles.videoStatValue}>{formatTime(videoStats.currentTime)}</Text>
              </View>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Duration</Text>
                <Text style={styles.videoStatValue}>{videoStats.duration > 0 ? formatTime(videoStats.duration) : '--:--'}</Text>
              </View>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Buffered</Text>
                <Text style={styles.videoStatValue}>{formatTime(videoStats.bufferedPosition)}</Text>
              </View>
            </View>

            {/* Live Stats Row (only shown for live streams) */}
            {videoStats.isLive && (
              <View style={styles.videoStatsRow}>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>Latency</Text>
                  <Text style={[styles.videoStatValue, { color: theme.accent.warning }]}>
                    {videoStats.currentOffsetFromLive !== null ? `${videoStats.currentOffsetFromLive.toFixed(1)}s` : '--'}
                  </Text>
                </View>
                <View style={[styles.videoStatBox, { flex: 2 }]}>
                  <Text style={styles.videoStatLabel}>Buffer Ahead</Text>
                  <Text style={styles.videoStatValue}>
                    {(videoStats.bufferedPosition - videoStats.currentTime).toFixed(1)}s
                  </Text>
                </View>
              </View>
            )}

            {/* Codec & Resolution Row */}
            {videoStats.videoTrack && (
              <View style={styles.videoStatsRow}>
                <View style={[styles.videoStatBox, styles.codecBox]}>
                  <Text style={styles.videoStatLabel}>Codec</Text>
                  <View style={styles.codecBadgeRow}>
                    <View style={[styles.codecBadge, { backgroundColor: parseCodecName(videoStats.videoTrack.mimeType, theme).color + '25', borderColor: parseCodecName(videoStats.videoTrack.mimeType, theme).color }]}>
                      <Text style={[styles.codecBadgeText, { color: parseCodecName(videoStats.videoTrack.mimeType, theme).color }]}>
                        {parseCodecName(videoStats.videoTrack.mimeType, theme).name}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>Resolution</Text>
                  <Text style={styles.videoStatValue}>
                    {videoStats.videoTrack.width}x{videoStats.videoTrack.height}
                  </Text>
                </View>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>FPS</Text>
                  <Text style={styles.videoStatValue}>
                    {videoStats.videoTrack.frameRate?.toFixed(1) ?? '--'}
                  </Text>
                </View>
              </View>
            )}

            {/* Bitrate & Quality Row */}
            {videoStats.videoTrack && (
              <View style={styles.videoStatsRow}>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>Bitrate</Text>
                  <Text style={styles.videoStatValue}>
                    {videoStats.videoTrack.bitrate
                      ? `${(videoStats.videoTrack.bitrate / 1000000).toFixed(2)} Mbps`
                      : '--'}
                  </Text>
                </View>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>Quality</Text>
                  <Text style={styles.videoStatValue}>
                    {videoStats.videoTrack.height >= 2160 ? '4K UHD' :
                      videoStats.videoTrack.height >= 1440 ? '1440p QHD' :
                        videoStats.videoTrack.height >= 1080 ? '1080p FHD' :
                          videoStats.videoTrack.height >= 720 ? '720p HD' :
                            videoStats.videoTrack.height >= 480 ? '480p SD' :
                              `${videoStats.videoTrack.height}p`}
                  </Text>
                </View>
                <View style={styles.videoStatBox}>
                  <Text style={styles.videoStatLabel}>Aspect</Text>
                  <Text style={styles.videoStatValue}>
                    {(videoStats.videoTrack.width / videoStats.videoTrack.height).toFixed(2)}
                  </Text>
                </View>
              </View>
            )}

            {/* Full Codec Info Row */}
            {videoStats.videoTrack?.mimeType && (
              <View style={styles.videoStatsRow}>
                <View style={[styles.videoStatBox, { flex: 1 }]}>
                  <Text style={styles.videoStatLabel}>Full Codec</Text>
                  <Text style={[styles.videoStatValue, styles.videoStatValueSmall]} numberOfLines={1}>
                    {parseCodecName(videoStats.videoTrack.mimeType, theme).fullName} - {videoStats.videoTrack.mimeType}
                  </Text>
                </View>
              </View>
            )}

            {/* Playback Row */}
            <View style={styles.videoStatsRow}>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Speed</Text>
                <Text style={styles.videoStatValue}>{videoStats.playbackRate}x</Text>
              </View>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Volume</Text>
                <Text style={styles.videoStatValue}>{Math.round(videoStats.volume * 100)}%</Text>
              </View>
              <View style={styles.videoStatBox}>
                <Text style={styles.videoStatLabel}>Muted</Text>
                <Ionicons
                  name={videoStats.muted ? 'volume-mute' : 'volume-high'}
                  size={16}
                  color={videoStats.muted ? theme.accent.error : theme.accent.success}
                />
              </View>
            </View>

            {/* Audio Track Row */}
            {videoStats.audioTrack && (
              <View style={styles.videoStatsRow}>
                <View style={[styles.videoStatBox, { flex: 1 }]}>
                  <Text style={styles.videoStatLabel}>Audio</Text>
                  <Text style={styles.videoStatValue}>
                    {videoStats.audioTrack.label} ({videoStats.audioTrack.language})
                  </Text>
                </View>
              </View>
            )}

            {/* Device Stats */}
            <View style={styles.deviceStatsContainer}>
              <DeviceStats theme={theme} />
            </View>
          </View>
        )
      }
    </>
  );
});

// ============================================================================
// Main Component
// ============================================================================
export default function StreamDebugger() {
  const insets = useSafeAreaInsets();
  const { isLargeScreen, isLandscape, width } = useResponsive();

  // Stream configuration
  const {
    isLoading: isConfigLoading,
    streams,
    settings,
    recordUsage,
    getDefaultStream,
    getFavoriteStreams,
    getMultiViewStreams,
    getStreamById,
    refresh: refreshStreams,
  } = useStreamConfig();

  const theme = useAppTheme(settings.themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Manage screen focus - pause player when leaving, resume when returning
  useFocusEffect(
    useCallback(() => {
      // Screen is focused - refresh streams and resume playback
      refreshStreams();

      // Cleanup when screen loses focus - pause player for efficiency
      return () => {
        if (playerRef.current) {
          try {
            playerRef.current.pause();
          } catch {
            // Player may already be released
          }
        }
      };
    }, [refreshStreams])
  );

  // State
  const [streamUrl, setStreamUrl] = useState('');
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<string>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');
  const [showPlayer, setShowPlayer] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [multiViewMode, setMultiViewMode] = useState(false);
  const [multiViewReloadKey, setMultiViewReloadKey] = useState(0);
  const [isImmersive, setIsImmersive] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<MainTabId>('info');

  // Get favorite streams for quick access bar - filter directly from streams state
  const favoriteStreams = useMemo(() => {
    return streams.filter(s => s.isFavorite);
  }, [streams]);

  // Initialize default stream from config
  useEffect(() => {
    if (!isConfigLoading && !streamUrl) {
      const defaultStream = getDefaultStream();
      if (defaultStream) {
        setStreamUrl(defaultStream.url);
        setCurrentStreamId(defaultStream.id);
      }
    }
  }, [isConfigLoading, streamUrl, getDefaultStream]);

  // Refs
  const logIdRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const playerRef = useRef<ReturnType<typeof useVideoPlayer> | null>(null);

  // Player - only create the main player (use null when no URL to prevent empty string issues)
  const player = useVideoPlayer(streamUrl || null);
  playerRef.current = player;

  // ============================================================================
  // Logging System
  // ============================================================================
  const addLog = useCallback((category: LogCategory, level: LogLevel, message: string) => {
    const now = new Date();
    const entry: LogEntry = {
      id: `${now.getTime()}-${++logIdRef.current}`,
      timestamp: now.getTime(),
      time: now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0'),
      level,
      category,
      message,
    };

    setLogs(prev => [...prev, entry].slice(-MAX_LOGS));
  }, []);

  // Stats
  const logStats = useMemo(() => {
    const stats = { total: logs.length, error: 0, warn: 0, info: 0, debug: 0 };
    logs.forEach(log => stats[log.level]++);
    return stats;
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (categoryFilter !== 'all') {
      result = result.filter(log => log.category === categoryFilter);
    }

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      result = result.filter(log =>
        log.message.toLowerCase().includes(lowerFilter) ||
        log.category.includes(lowerFilter) ||
        log.level.includes(lowerFilter)
      );
    }

    return result;
  }, [logs, filter, categoryFilter]);

  // ============================================================================
  // HTTP Logging
  // ============================================================================
  const fetchAndLogStream = useCallback(async (url: string) => {
    const startTime = Date.now();
    addLog('http', 'info', `[REQUEST] GET ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const duration = Date.now() - startTime;
      addLog('http', res.ok ? 'info' : 'warn', `[RESPONSE] ${res.status} ${res.statusText} (${duration}ms)`);

      // Log all headers
      const headers: string[] = [];
      res.headers.forEach((value, key) => {
        headers.push(`${key}: ${value}`);
      });
      if (headers.length > 0) {
        addLog('http', 'debug', `Headers:\n${headers.join('\n')}`);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('mpegurl') || url.endsWith('.m3u8')) {
        const text = await res.text();
        const lines = text.split('\n').filter(l => l.trim());
        addLog('http', 'info', `Manifest received: ${lines.length} lines, ${text.length} bytes`);

        // Parse and log manifest details
        const extLines = lines.filter(l => l.startsWith('#EXT'));
        extLines.forEach(line => {
          if (line.includes('BANDWIDTH') || line.includes('RESOLUTION') || line.includes('CODECS')) {
            addLog('http', 'debug', line);
          }
        });

        // Log segment URLs
        const segments = lines.filter(l => !l.startsWith('#') && l.trim());
        if (segments.length > 0) {
          addLog('http', 'debug', `Segments: ${segments.length} entries`);
        }
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addLog('http', 'error', `[ERROR] ${msg.includes('abort') ? 'Request timeout' : msg} (${duration}ms)`);
    }
  }, [addLog]);

  // ============================================================================
  // Player Management
  // ============================================================================
  const loadStream = useCallback((url: string, streamId?: string) => {
    if (!url.trim()) return;
    Keyboard.dismiss();
    const trimmedUrl = url.trim();
    addLog('system', 'info', `[LOAD] Stream: ${trimmedUrl}`);
    setStreamUrl(trimmedUrl);
    setCurrentStreamId(streamId || null);
    setInputUrl('');
    // Record usage if we have a stream ID
    if (streamId) {
      recordUsage(streamId);
    }
  }, [addLog, recordUsage]);

  // Load stream from config
  const loadStreamConfig = useCallback((stream: StreamConfig) => {
    loadStream(stream.url, stream.id);
  }, [loadStream]);

  // Navigate to settings
  const openSettings = useCallback(() => {
    router.push('/settings');
  }, []);

  // Show developer / about details (tap on app title or icon)
  const showAboutDeveloper = useCallback(() => {
    const appName = Constants.expoConfig?.name ?? ABOUT.appName;
    const version = Constants.expoConfig?.version ?? ABOUT.version;
    Alert.alert(
      appName,
      `Version ${version}\n\n${ABOUT.developer}\n\n${ABOUT.description}`,
      [{ text: 'OK' }]
    );
  }, []);

  useEffect(() => {
    addLog('system', 'info', 'Stream Debugger initialized');
    return () => { };
  }, [addLog]);

  useEffect(() => {
    if (!player) return;

    let isMounted = true;
    const listeners: ({ remove: () => void } | undefined)[] = [];

    addLog('player', 'info', 'Player initializing...');
    fetchAndLogStream(streamUrl);
    player.loop = false;
    player.timeUpdateEventInterval = 0.5; // Update stats every 500ms

    // Mute by default on web to allow autoplay
    if (Platform.OS === 'web') {
      player.muted = true;
    }

    listeners.push(
      player.addListener('playingChange', ({ isPlaying: playing }) => {
        if (!isMounted) return;
        setIsPlaying(playing);
        addLog('player', 'info', playing ? '[PLAY] Playback started' : '[PAUSE] Playback paused');
      }),
      player.addListener('statusChange', ({ status, error }) => {
        if (!isMounted) return;
        setPlayerStatus(status);
        const statusLabel = status === 'readyToPlay' ? '[READY]' : status === 'loading' ? '[LOADING]' : '[IDLE]';
        addLog('player', error ? 'error' : 'info', `${statusLabel} Status: ${status}${error ? ` - ${error}` : ''}`);
      }),
      player.addListener('sourceLoad', ({ duration, availableVideoTracks, availableAudioTracks }) => {
        if (!isMounted) return;
        addLog('player', 'info', `Source loaded: ${duration.toFixed(1)}s, ${availableVideoTracks.length} video tracks, ${availableAudioTracks.length} audio tracks`);
        if (availableVideoTracks.length > 0) {
          availableVideoTracks.forEach((track, i) => {
            addLog('player', 'debug', `Video track ${i}: ${track.size.width}x${track.size.height}, ${track.bitrate ? (track.bitrate / 1000000).toFixed(2) + ' Mbps' : 'unknown bitrate'}, ${track.frameRate ? track.frameRate + ' fps' : 'unknown fps'}`);
          });
        }
      }),
      player.addListener('videoTrackChange', ({ videoTrack }) => {
        if (!isMounted) return;
        if (videoTrack) {
          addLog('player', 'info', `Video track changed: ${videoTrack.size.width}x${videoTrack.size.height}, ${videoTrack.bitrate ? (videoTrack.bitrate / 1000000).toFixed(2) + ' Mbps' : 'unknown'}`);
        }
      }),
    );

    const playTimer = setTimeout(() => {
      if (!isMounted) return;
      try {
        player.play();
      } catch (e) {
        addLog('player', 'error', `Play failed: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }, 500);

    return () => {
      isMounted = false;
      listeners.forEach(l => l?.remove());
      clearTimeout(playTimer);
      try {
        player.pause();
      } catch { }
    };
  }, [player, streamUrl, addLog, fetchAndLogStream]);

  // Auto-scroll for ScrollView
  const lastLogCountRef = useRef(0);
  useEffect(() => {
    if (autoScroll && scrollRef.current && filteredLogs.length > lastLogCountRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      });
    }
    lastLogCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, autoScroll]);

  // Callback for multi-view players to log
  const handleMultiViewLog = useCallback((message: string, level: 'info' | 'error') => {
    addLog('system', level, message);
  }, [addLog]);

  // Handle multi-view mode changes - pause/resume main player for efficiency
  useEffect(() => {
    if (multiViewMode) {
      addLog('system', 'info', 'Multi-view mode: Enabled');
      // Pause main player when entering multi-view (it's not visible)
      if (playerRef.current) {
        try {
          playerRef.current.pause();
        } catch {
          // Player may already be released
        }
      }
    } else {
      // Resume main player when exiting multi-view
      if (playerRef.current && streamUrl) {
        try {
          playerRef.current.play();
          addLog('system', 'info', 'Multi-view mode: Disabled');
        } catch {
          // Player may not be ready
        }
      }
    }
  }, [multiViewMode, addLog, streamUrl]);

  // Handle navigating from multi-view to single view
  const handleMultiViewPress = useCallback((stream: StreamConfig) => {
    // 1. Exit Multi-view mode (this unmounts all multi-view players)
    setMultiViewMode(false);

    // 2. Load the selected stream into the main player
    loadStreamConfig(stream);
  }, [loadStreamConfig]);

  // ============================================================================
  // Actions
  // ============================================================================
  const clearLogs = useCallback(() => {
    setLogs([]);
    addLog('system', 'info', 'Logs cleared');
  }, [addLog]);

  const exportLogs = useCallback(async () => {
    const logText = filteredLogs.map(log =>
      `[${log.time}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}`
    ).join('\n');

    try {
      await Share.share({
        message: logText,
        title: 'Stream Debug Logs',
      });
    } catch {
      Alert.alert('Export Failed', 'Could not share logs');
    }
  }, [filteredLogs]);

  const copyLog = useCallback(async (log: LogEntry) => {
    try {
      await Share.share({
        message: `[${log.time}] [${log.level}] [${log.category}] ${log.message}`,
      });
    } catch { }
  }, []);

  const toggleLogExpand = useCallback((id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleImmersive = useCallback(() => {
    setIsImmersive(v => !v);
  }, []);


  // ============================================================================
  // Render Helpers
  // ============================================================================
  const renderCategoryTab = (cat: FilterCategory, label: string) => (
    <Pressable
      key={cat}
      style={[styles.categoryTab, categoryFilter === cat && styles.categoryTabActive]}
      onPress={() => setCategoryFilter(cat)}
    >
      <Text style={[styles.categoryTabText, categoryFilter === cat && styles.categoryTabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );

  const getStatusColor = () => {
    switch (playerStatus) {
      case 'readyToPlay': return theme.accent.success;
      case 'loading': return theme.accent.warning;
      case 'error': return theme.accent.error;
      default: return theme.text.muted;
    }
  };

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <View style={[styles.container, { paddingTop: isImmersive ? 0 : insets.top, backgroundColor: isImmersive ? '#000' : theme.bg.primary }]}>
      <StatusBar barStyle="light-content" backgroundColor={isImmersive ? '#000' : theme.bg.primary} hidden={isImmersive} />

      {/* Header - Hidden in Immersive Mode */}
      {!isImmersive && (
        <View style={styles.header}>
          <Pressable style={styles.headerLeft} onPress={showAboutDeveloper} hitSlop={8}>
            <Ionicons name="bug" size={24} color={theme.accent.primary} />
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Stream Debugger</Text>
          </Pressable>
          <View style={styles.headerRight}>
            <Pressable
              style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20', borderColor: getStatusColor() }]}
              onPress={() => setShowPlayer(v => !v)}
            >
              <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
              <Text style={[styles.statusText, { color: getStatusColor() }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{playerStatus}</Text>
              {!isLargeScreen && <Ionicons name={showPlayer ? 'chevron-up' : 'chevron-down'} size={14} color={getStatusColor()} />}
            </Pressable>
            <Pressable
              style={[styles.settingsBtn, multiViewMode && { backgroundColor: theme.accent.primary + '20', borderRadius: 8 }]}
              onPress={() => setMultiViewMode(v => !v)}
            >
              <Ionicons
                name={multiViewMode ? 'grid' : 'grid-outline'}
                size={22}
                color={multiViewMode ? theme.accent.primary : theme.text.secondary}
              />
            </Pressable>
            <Pressable style={styles.settingsBtn} onPress={openSettings}>
              <Ionicons name="settings-outline" size={22} color={theme.text.secondary} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Main Content Wrapper for Adaptive Layout */}
      <View style={[styles.mainContentWrapper, isLargeScreen && !isImmersive && !multiViewMode && styles.mainContentWrapperLarge]}>

        {/* Left/Top Column: Player & Multi-View */}
        <View style={[(isLargeScreen && !isImmersive && !multiViewMode) ? { flex: 1, maxWidth: Math.min(width * 0.6, 1200) } : { width: '100%', flex: (isImmersive || multiViewMode) ? 1 : undefined }]}>
          {/* Player Section */}
          {showPlayer && !multiViewMode && (
            <View style={isImmersive ? styles.playerSectionImmersive : styles.playerSection}>
              <View style={isImmersive ? styles.playerCardImmersive : styles.playerCard}>
                <View style={isImmersive ? styles.videoWrapperImmersive : styles.videoWrapper}>
                  {playerRef.current && !!streamUrl && (
                    <ZoomableVideo player={playerRef.current} enabled={isImmersive} theme={theme} styles={styles} />
                  )}


                  {/* Immersive Controls - ensure high Z-Index and Elevation */}
                  <View style={[StyleSheet.absoluteFill, { zIndex: 2000, pointerEvents: 'box-none' }]}>
                    {/* Toggle / Minimize Button */}
                    <Pressable
                      style={[styles.immersiveBtn, isImmersive && styles.immersiveBtnActive, { elevation: 20 }]}
                      onPress={toggleImmersive}
                    >
                      <Ionicons
                        name={isImmersive ? "contract" : "expand"}
                        size={20}
                        color="#fff"
                      />
                    </Pressable>

                    {/* Explicit Close Button (Top-Left) for Immersive Mode */}
                    {isImmersive && (
                      <Pressable
                        style={[styles.closeImmersiveBtn, { elevation: 20 }]}
                        onPress={toggleImmersive}
                      >
                        <Ionicons name="close" size={24} color="#fff" />
                      </Pressable>
                    )}
                  </View>
                </View>

                {/* Quick Access - Hidden in Immersive */}
                {!isImmersive && favoriteStreams.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.quickAccessBar}
                  >
                    {favoriteStreams.map(stream => (
                      <Pressable
                        key={stream.id}
                        style={[
                          styles.quickAccessBtn,
                          currentStreamId === stream.id && styles.quickAccessBtnActive,
                        ]}
                        onPress={() => loadStreamConfig(stream)}
                      >
                        {stream.isLive && <View style={styles.liveDotSmall} />}
                        <Text
                          style={[
                            styles.quickAccessText,
                            currentStreamId === stream.id && styles.quickAccessTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {stream.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* URL Input - Hidden in Immersive */}
              {!isImmersive && (
                <>
                  <View style={styles.urlRow}>
                    <TextInput
                      style={styles.urlInput}
                      placeholder="Enter stream URL..."
                      placeholderTextColor={theme.text.muted}
                      value={inputUrl}
                      onChangeText={setInputUrl}
                      onSubmitEditing={() => loadStream(inputUrl)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                    <Pressable style={styles.urlBtn} onPress={() => loadStream(inputUrl)}>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </Pressable>
                  </View>
                  <Text style={styles.currentUrl} numberOfLines={1}>{streamUrl}</Text>
                </>
              )}
            </View>
          )}

          {/* Multi-View Mode - Hidden in Immersive */}
          {!isImmersive && showPlayer && multiViewMode && (
            <View style={styles.multiViewSection}>
              <View style={styles.multiViewToolbar}>
                <Pressable
                  style={styles.multiViewReloadBtn}
                  onPress={() => setMultiViewReloadKey(k => k + 1)}
                >
                  <Ionicons name="refresh" size={16} color={theme.accent.primary} />
                  <Text style={styles.multiViewReloadBtnText}>Reload all</Text>
                </Pressable>
              </View>
              {(() => {
                const multiViewStreams = getMultiViewStreams();
                const rows: StreamConfig[][] = [];
                // Calculate how many columns to show based on width
                let columns = 2;
                if (width >= 1024) columns = 4;
                else if (width >= 768 || (isLandscape && width >= 600)) columns = 3;

                for (let i = 0; i < multiViewStreams.length; i += columns) {
                  rows.push(multiViewStreams.slice(i, i + columns));
                }
                return (
                  <View key={multiViewReloadKey} style={{ gap: 8 }}>
                    {rows.map((row, rowIndex) => (
                      <View key={`row-${rowIndex}`} style={styles.multiViewRow}>
                        {row.map((stream) => (
                          <MultiViewPlayer
                            key={`stream-${stream.id}`}
                            streamUrl={stream.url}
                            label={stream.name}
                            onLog={handleMultiViewLog}
                            onPress={() => handleMultiViewPress(stream)}
                            theme={theme}
                            styles={styles}
                          />
                        ))}
                        {/* Fill empty spots in the last row to maintain grid alignment */}
                        {Array.from({ length: columns - row.length }).map((_, i) => (
                          <View key={`empty-${rowIndex}-${i}`} style={{ flex: 1 }} />
                        ))}
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
          )}
        </View>

        {/* Right/Bottom Column: Scrollable Content & Tabs */}
        {!isImmersive && !multiViewMode && (
          <View style={[(isLargeScreen && !isImmersive && !multiViewMode) ? { flex: 1, borderLeftWidth: 1, borderLeftColor: theme.border } : { flex: 1 }]}>
            {/* Scrollable Content Area */}
            {!isImmersive && !multiViewMode && (
              <ScrollView
                ref={scrollRef}
                style={styles.scrollableContent}
                contentContainerStyle={styles.scrollableContentContainer}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled
              >


                {/* INFO TAB - Network Quality, Stream Metadata, Video Stats, Device Stats */}
                {activeMainTab === 'info' && (
                  <InfoTabContent
                    player={playerRef.current}
                    streamUrl={streamUrl}
                    theme={theme}
                    isPlaying={isPlaying}
                    styles={styles}
                  />
                )}

                {/* LOGS TAB - Category Tabs, Log Controls, Logs List */}
                {activeMainTab === 'logs' && (
                  <>
                    {/* Stats Bar */}
                    <View style={styles.statsBar}>
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{logStats.total}</Text>
                        <Text style={styles.statLabel}>Total</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: theme.accent.error }]}>{logStats.error}</Text>
                        <Text style={styles.statLabel}>Errors</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: theme.accent.warning }]}>{logStats.warn}</Text>
                        <Text style={styles.statLabel}>Warns</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: theme.accent.info }]}>{logStats.info}</Text>
                        <Text style={styles.statLabel}>Info</Text>
                      </View>
                    </View>

                    {/* Category Tabs */}
                    <View style={styles.categoryTabs}>
                      {renderCategoryTab('all', 'All')}
                      {renderCategoryTab('http', 'HTTP')}
                      {renderCategoryTab('player', 'Player')}
                      {renderCategoryTab('system', 'System')}
                    </View>

                    {/* Log Controls */}
                    <View style={styles.logControls}>
                      <View style={styles.filterRow}>
                        <Ionicons name="search" size={16} color={theme.text.muted} />
                        <TextInput
                          style={styles.filterInput}
                          placeholder="Filter logs..."
                          placeholderTextColor={theme.text.muted}
                          value={filter}
                          onChangeText={setFilter}
                        />
                        {filter !== '' && (
                          <Pressable onPress={() => setFilter('')}>
                            <Ionicons name="close-circle" size={18} color={theme.text.muted} />
                          </Pressable>
                        )}
                      </View>
                      <View style={styles.logActions}>
                        <Pressable
                          style={[styles.autoScrollBtn, autoScroll && styles.autoScrollBtnActive]}
                          onPress={() => setAutoScroll(v => !v)}
                        >
                          <Ionicons
                            name={autoScroll ? 'play' : 'pause'}
                            size={12}
                            color={autoScroll ? theme.accent.success : theme.text.muted}
                          />
                          <Text style={[styles.autoScrollText, autoScroll && styles.autoScrollTextActive]}>
                            {autoScroll ? 'Following' : 'Paused'}
                          </Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={exportLogs}>
                          <Ionicons name="share-outline" size={16} color={theme.text.secondary} />
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={clearLogs}>
                          <Ionicons name="trash-outline" size={16} color={theme.accent.error} />
                        </Pressable>
                      </View>
                    </View>

                    {/* Logs - Limited render for performance */}
                    {
                      filteredLogs.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Ionicons name="document-text-outline" size={48} color={theme.text.muted} />
                          <Text style={styles.emptyText}>No logs yet</Text>
                          <Text style={styles.emptySubtext}>Load a stream to start debugging</Text>
                        </View>
                      ) : (
                        <View style={styles.logsInline}>
                          {/* Only render last 100 logs for performance, full list available via export */}
                          {filteredLogs.slice(-100).map(log => (
                            <LogEntryItem
                              key={log.id}
                              log={log}
                              isExpanded={expandedLogs.has(log.id)}
                              onToggleExpand={toggleLogExpand}
                              onCopy={copyLog}
                              theme={theme}
                              styles={styles}
                            />
                          ))}
                          {filteredLogs.length > 100 && (
                            <Text style={styles.logsHiddenText}>
                              {filteredLogs.length - 100} older logs hidden (export to see all)
                            </Text>
                          )}
                        </View>
                      )
                    }

                    {/* Bottom padding for tab bar */}
                    <View style={{ height: 80 }} />
                  </>
                )}


                {/* PLAYLIST TAB - Playlist Viewer */}
                {activeMainTab === 'playlist' as any && (
                  <StreamMetadata streamUrl={streamUrl} theme={theme} standalone={true} />
                )}

                {/* Bottom padding for tab bar */}
                <View style={{ height: isLargeScreen ? 20 : 80 }} />
              </ScrollView>
            )}

            {/* Main Tab Bar - Bottom Docked (Hidden in Immersive or Multiview) */}
            {!isImmersive && !multiViewMode && (
              <MainTabBar
                activeTab={activeMainTab}
                onTabChange={setActiveMainTab}
                theme={theme}
                bottomInset={insets.bottom}
                styles={styles}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg.primary,
  },
  mainContentWrapper: {
    flex: 1,
    flexDirection: 'column',
  },
  mainContentWrapperLarge: {
    flexDirection: 'row',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text.primary,
    flexShrink: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  settingsBtn: {
    padding: 6,
  },
  playerSection: {
    padding: 12,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  playerCard: {
    backgroundColor: theme.bg.card,
    borderRadius: 12,
    overflow: 'hidden', // Ensure video and other content don't leak out
    borderWidth: 1,
    borderColor: theme.border,
  },
  videoWrapper: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    overflow: 'hidden', // CRITICAL: Enclose the video element on web
  },
  video: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent.error,
  },
  liveDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.accent.error,
  },
  quickAccessBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickAccessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: theme.bg.tertiary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  quickAccessBtnActive: {
    backgroundColor: theme.accent.primary + '25',
    borderColor: theme.accent.primary,
  },
  quickAccessText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text.secondary,
    maxWidth: 100,
  },
  quickAccessTextActive: {
    color: theme.accent.primary,
  },
  urlRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  urlInput: {
    flex: 1,
    backgroundColor: theme.bg.tertiary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: theme.text.primary,
    borderWidth: 1,
    borderColor: theme.border,
  },
  urlBtn: {
    backgroundColor: theme.accent.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  currentUrl: {
    fontSize: 10,
    color: theme.text.muted,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Multi-View Styles
  multiViewSection: {
    padding: 8,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 8,
  },
  multiViewToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
  },
  multiViewReloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: theme.accent.primary + '20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.accent.primary + '50',
  },
  multiViewReloadBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.accent.primary,
  },
  multiViewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  multiViewCard: {
    flex: 1,
    backgroundColor: theme.bg.card,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
  },
  multiViewVideoWrapper: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  multiViewLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: theme.bg.tertiary,
  },
  multiViewLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.accent.error,
    flexShrink: 1,
  },
  multiViewLoadTime: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.accent.success,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minWidth: 32,
  },
  multiViewLoadTimePending: {
    fontSize: 10,
    color: theme.text.muted,
    minWidth: 32,
  },
  scrollableContent: {
    flex: 1,
    backgroundColor: theme.bg.primary,
  },
  scrollableContentContainer: {
    flexGrow: 1,
  },
  multiViewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  networkQualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  multiViewToggleActive: {
    backgroundColor: theme.accent.primary + '15',
  },
  multiViewToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text.secondary,
  },
  multiViewToggleTextActive: {
    color: theme.accent.primary,
  },
  // Video Stats Panel Styles
  videoStatsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  videoStatsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  videoStatsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text.primary,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.accent.error + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.accent.error,
  },
  videoStatsPanel: {
    backgroundColor: theme.bg.card,
    maxHeight: 200,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  videoStatsPanelContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  videoStatsPanelInline: {
    backgroundColor: theme.bg.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 6,
  },
  deviceStatsContainer: {
    marginTop: 8,
  },
  logsInline: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  logsHiddenText: {
    textAlign: 'center',
    color: theme.text.muted,
    fontSize: 11,
    paddingVertical: 12,
    fontStyle: 'italic',
  },
  videoStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  videoStatBox: {
    flex: 1,
    backgroundColor: theme.bg.tertiary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  videoStatLabel: {
    fontSize: 9,
    color: theme.text.muted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  videoStatValue: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  videoStatValueSmall: {
    fontSize: 11,
  },
  codecBox: {
    alignItems: 'flex-start',
  },
  codecBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  codecBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  codecBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text.primary,
  },
  statLabel: {
    fontSize: 10,
    color: theme.text.muted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.border,
  },
  categoryTabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: theme.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  categoryTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.bg.tertiary,
  },
  categoryTabActive: {
    backgroundColor: theme.accent.primary + '25',
  },
  categoryTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text.muted,
  },
  categoryTabTextActive: {
    color: theme.accent.primary,
  },
  logControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    backgroundColor: theme.bg.primary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  filterRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bg.tertiary,
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  filterInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 13,
    color: theme.text.primary,
  },
  logActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: theme.bg.tertiary,
  },
  autoScrollBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: theme.bg.tertiary,
    borderWidth: 1,
    borderColor: theme.border,
  },
  autoScrollBtnActive: {
    backgroundColor: theme.accent.success + '15',
    borderColor: theme.accent.success + '40',
  },
  autoScrollText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.text.muted,
  },
  autoScrollTextActive: {
    color: theme.accent.success,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text.secondary,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: theme.text.muted,
    marginTop: 4,
  },
  logEntry: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  logEntryError: {
    borderLeftColor: theme.accent.error,
    backgroundColor: theme.accent.error + '08',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  logTime: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: theme.text.muted,
  },
  logLevel: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logLevelText: {
    fontSize: 9,
    fontWeight: '700',
  },
  logCategory: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logCategoryText: {
    fontSize: 9,
    fontWeight: '600',
  },
  expandIcon: {
    marginLeft: 'auto',
  },
  logMessage: {
    fontSize: 12,
    color: theme.text.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  logMessageError: {
    color: theme.accent.error,
  },
  // New Immersive Styles
  playerSectionImmersive: {
    flex: 1,
    padding: 0,
    backgroundColor: '#000',
    borderBottomWidth: 0,
  },
  playerCardImmersive: {
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  videoWrapperImmersive: {
    flex: 1,
    // No aspectRatio -> fills the container
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  immersiveBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  immersiveBtnActive: {
    top: 20,
    right: 20,
    backgroundColor: theme.accent.primary,
  },
  closeImmersiveBtn: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  // Main Tab Bar Styles - Bottom Docked
  mainTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: theme.bg.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingBottom: 0, // Will be set dynamically with safe area
    boxShadow: '0px -2px 8px rgba(0, 0, 0, 0.1)',
    elevation: 8,
  },
  mainTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 2,
    position: 'relative',
  },
  mainTabActive: {
    // Active tab styling handled by indicator
  },
  mainTabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: theme.text.muted,
  },
  mainTabLabelActive: {
    color: theme.accent.primary,
    fontWeight: '600',
  },
  mainTabIndicator: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: theme.accent.primary,
    borderRadius: 2,
  },
});
