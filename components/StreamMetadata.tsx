import { Ionicons } from '@expo/vector-icons';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Theme } from '../constants/appTheme';

// ============================================================================
// Types
// ============================================================================
interface StreamMetadataProps {
  streamUrl: string;
  theme: Theme;
}

interface ParsedPlaylist {
  type: 'master' | 'media' | 'unknown';
  isLive: boolean;
  version?: number;
  targetDuration?: number;
  mediaSequence?: number;
  discontinuitySequence?: number;
  playlistType?: string;
  duration?: number;
  variants: VariantStream[];
  segments: Segment[];
  rawContent: string;
}

interface VariantStream {
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  frameRate?: number;
  uri: string;
}

interface Segment {
  duration: number;
  uri: string;
  title?: string;
  discontinuity?: boolean;
  programDateTime?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================
function formatBitrate(bps: number): string {
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(2)} Mbps`;
  }
  return `${(bps / 1000).toFixed(0)} kbps`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function parseHLSPlaylist(content: string, url: string): ParsedPlaylist {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);

  const result: ParsedPlaylist = {
    type: 'unknown',
    isLive: true,
    variants: [],
    segments: [],
    rawContent: content,
  };

  // Check if it's an HLS playlist
  if (!lines[0]?.startsWith('#EXTM3U')) {
    return result;
  }

  // Parse tags
  let currentVariant: Partial<VariantStream> | null = null;
  let currentSegmentDuration: number | null = null;
  let currentSegmentTitle: string | undefined;
  let hasDiscontinuity = false;
  let totalDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Version
    if (line.startsWith('#EXT-X-VERSION:')) {
      result.version = parseInt(line.split(':')[1], 10);
    }

    // Target duration
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      result.targetDuration = parseInt(line.split(':')[1], 10);
    }

    // Media sequence
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      result.mediaSequence = parseInt(line.split(':')[1], 10);
    }

    // Discontinuity sequence
    if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      result.discontinuitySequence = parseInt(line.split(':')[1], 10);
    }

    // Playlist type
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      result.playlistType = line.split(':')[1];
      if (result.playlistType === 'VOD') {
        result.isLive = false;
      }
    }

    // End list (VOD indicator)
    if (line === '#EXT-X-ENDLIST') {
      result.isLive = false;
    }

    // Stream info (master playlist)
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      result.type = 'master';
      const attrs = line.substring(18);
      currentVariant = {};

      // Parse bandwidth
      const bwMatch = attrs.match(/BANDWIDTH=(\d+)/);
      if (bwMatch) {
        currentVariant.bandwidth = parseInt(bwMatch[1], 10);
      }

      // Parse resolution
      const resMatch = attrs.match(/RESOLUTION=([^\s,]+)/);
      if (resMatch) {
        currentVariant.resolution = resMatch[1];
      }

      // Parse codecs
      const codecMatch = attrs.match(/CODECS="([^"]+)"/);
      if (codecMatch) {
        currentVariant.codecs = codecMatch[1];
      }

      // Parse frame rate
      const frMatch = attrs.match(/FRAME-RATE=([\d.]+)/);
      if (frMatch) {
        currentVariant.frameRate = parseFloat(frMatch[1]);
      }
    }

    // Segment info (media playlist)
    if (line.startsWith('#EXTINF:')) {
      result.type = 'media';
      const match = line.match(/#EXTINF:([\d.]+)(?:,(.*))?/);
      if (match) {
        currentSegmentDuration = parseFloat(match[1]);
        currentSegmentTitle = match[2] || undefined;
        totalDuration += currentSegmentDuration;
      }
    }

    // Discontinuity marker
    if (line === '#EXT-X-DISCONTINUITY') {
      hasDiscontinuity = true;
    }

    // Program date time
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      // Could store this if needed
    }

    // URI lines (not starting with #)
    if (!line.startsWith('#')) {
      if (currentVariant) {
        currentVariant.uri = line;
        result.variants.push(currentVariant as VariantStream);
        currentVariant = null;
      } else if (currentSegmentDuration !== null) {
        result.segments.push({
          duration: currentSegmentDuration,
          uri: line,
          title: currentSegmentTitle,
          discontinuity: hasDiscontinuity,
        });
        currentSegmentDuration = null;
        currentSegmentTitle = undefined;
        hasDiscontinuity = false;
      }
    }
  }

  // Set total duration for VOD
  if (!result.isLive && totalDuration > 0) {
    result.duration = totalDuration;
  }

  return result;
}

// ============================================================================
// Component
// ============================================================================
function StreamMetadataComponent({ streamUrl, theme }: StreamMetadataProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [playlist, setPlaylist] = useState<ParsedPlaylist | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const lastFetchedUrl = useRef<string>('');

  const fetchPlaylist = useCallback(async (url: string, force = false) => {
    if (!url) return;
    if (!force && url === lastFetchedUrl.current) return;

    setIsLoading(true);
    setError(null);
    lastFetchedUrl.current = url;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': '*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const content = await response.text();
      const parsed = parseHLSPlaylist(content, url);
      setPlaylist(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      setPlaylist(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (streamUrl) {
      fetchPlaylist(streamUrl);
    }
  }, [streamUrl, fetchPlaylist]);

  const handleRefresh = useCallback(() => {
    fetchPlaylist(streamUrl, true);
  }, [streamUrl, fetchPlaylist]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const toggleRaw = useCallback(() => {
    setShowRaw(prev => !prev);
  }, []);

  // Render nothing if no URL
  if (!streamUrl) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <Pressable style={styles.header} onPress={toggleExpanded}>
        <View style={styles.headerLeft}>
          <Ionicons name="document-text" size={16} color={theme.accent.primary} />
          <Text style={styles.headerTitle}>Playlist</Text>
          {playlist && (
            <View style={[
              styles.typeBadge,
              { backgroundColor: playlist.isLive ? theme.accent.error : theme.accent.success }
            ]}>
              <Text style={styles.typeBadgeText}>
                {playlist.isLive ? 'LIVE' : 'VOD'}
              </Text>
            </View>
          )}
          {playlist && (
            <View style={[
              styles.typeBadge,
              { backgroundColor: theme.bg.tertiary }
            ]}>
              <Text style={[styles.typeBadgeText, { color: theme.text.secondary }]}>
                {playlist.type === 'master' ? 'Master' : playlist.type === 'media' ? 'Media' : 'Unknown'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {isLoading && (
            <ActivityIndicator size="small" color={theme.accent.primary} />
          )}
          <Pressable onPress={handleRefresh} hitSlop={8}>
            <Ionicons name="refresh" size={16} color={theme.text.muted} />
          </Pressable>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.text.muted}
          />
        </View>
      </Pressable>

      {/* Content */}
      {isExpanded && (
        <View style={styles.content}>
          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={16} color={theme.accent.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : playlist ? (
            <>
              {/* Toggle Raw/Parsed */}
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleBtn, !showRaw && styles.toggleBtnActive]}
                  onPress={() => setShowRaw(false)}
                >
                  <Text style={[styles.toggleBtnText, !showRaw && styles.toggleBtnTextActive]}>
                    Parsed
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, showRaw && styles.toggleBtnActive]}
                  onPress={() => setShowRaw(true)}
                >
                  <Text style={[styles.toggleBtnText, showRaw && styles.toggleBtnTextActive]}>
                    Raw
                  </Text>
                </Pressable>
              </View>

              {showRaw ? (
                /* Raw Content View - Truncate to prevent crashes */
                <ScrollView
                  style={styles.rawContainer}
                  horizontal={false}
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                >
                  <ScrollView
                    horizontal={true}
                    showsHorizontalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    <Text style={styles.rawContent} selectable>
                      {playlist.rawContent.length > 15000
                        ? playlist.rawContent.substring(0, 15000) + '\n\n... [Truncated - Content too large (' + Math.round(playlist.rawContent.length / 1024) + ' KB)]'
                        : playlist.rawContent}
                    </Text>
                  </ScrollView>
                </ScrollView>
              ) : (
                /* Parsed Content View */
                <ScrollView style={styles.parsedContainer} nestedScrollEnabled={true}>
                  {/* Stream Info */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Stream Info</Text>
                    <View style={styles.infoGrid}>
                      {playlist.version && (
                        <View style={styles.infoItem}>
                          <Text style={styles.infoLabel}>HLS Version</Text>
                          <Text style={styles.infoValue}>{playlist.version}</Text>
                        </View>
                      )}
                      {playlist.targetDuration && (
                        <View style={styles.infoItem}>
                          <Text style={styles.infoLabel}>Target Duration</Text>
                          <Text style={styles.infoValue}>{playlist.targetDuration}s</Text>
                        </View>
                      )}
                      {playlist.mediaSequence !== undefined && (
                        <View style={styles.infoItem}>
                          <Text style={styles.infoLabel}>Media Sequence</Text>
                          <Text style={styles.infoValue}>{playlist.mediaSequence}</Text>
                        </View>
                      )}
                      {playlist.duration && (
                        <View style={styles.infoItem}>
                          <Text style={styles.infoLabel}>Duration</Text>
                          <Text style={styles.infoValue}>{formatDuration(playlist.duration)}</Text>
                        </View>
                      )}
                      {playlist.playlistType && (
                        <View style={styles.infoItem}>
                          <Text style={styles.infoLabel}>Playlist Type</Text>
                          <Text style={styles.infoValue}>{playlist.playlistType}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Variants (Master Playlist) */}
                  {playlist.variants.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        Quality Levels ({playlist.variants.length})
                      </Text>
                      {playlist.variants.map((variant, idx) => (
                        <View key={idx} style={styles.variantItem}>
                          <View style={styles.variantHeader}>
                            <Text style={styles.variantResolution}>
                              {variant.resolution || 'Audio Only'}
                            </Text>
                            <Text style={styles.variantBitrate}>
                              {formatBitrate(variant.bandwidth)}
                            </Text>
                          </View>
                          {variant.codecs && (
                            <Text style={styles.variantCodecs}>{variant.codecs}</Text>
                          )}
                          {variant.frameRate && (
                            <Text style={styles.variantFps}>{variant.frameRate} fps</Text>
                          )}
                          <Text style={styles.variantUri} numberOfLines={1}>
                            {variant.uri}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Segments (Media Playlist) */}
                  {playlist.segments.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        Segments ({playlist.segments.length})
                      </Text>
                      <View style={styles.segmentsList}>
                        {playlist.segments.slice(0, 20).map((segment, idx) => (
                          <View key={idx} style={styles.segmentItem}>
                            <Text style={styles.segmentIndex}>#{idx + 1}</Text>
                            <Text style={styles.segmentDuration}>
                              {segment.duration.toFixed(3)}s
                            </Text>
                            <Text style={styles.segmentUri} numberOfLines={1}>
                              {segment.uri}
                            </Text>
                            {segment.discontinuity && (
                              <View style={styles.discontinuityBadge}>
                                <Text style={styles.discontinuityText}>DISC</Text>
                              </View>
                            )}
                          </View>
                        ))}
                        {playlist.segments.length > 20 && (
                          <Text style={styles.moreSegments}>
                            ... and {playlist.segments.length - 20} more segments
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Empty state for master playlists without variants */}
                  {playlist.type === 'unknown' && (
                    <View style={styles.emptyState}>
                      <Ionicons name="help-circle" size={24} color={theme.text.muted} />
                      <Text style={styles.emptyText}>
                        Could not parse playlist format
                      </Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </>
          ) : isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.accent.primary} />
              <Text style={styles.loadingText}>Loading playlist...</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export const StreamMetadata = memo(StreamMetadataComponent);

// ============================================================================
// Styles
// ============================================================================
const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.bg.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: theme.text.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  content: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  toggleRow: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: theme.bg.tertiary,
  },
  toggleBtnActive: {
    backgroundColor: theme.accent.primary,
  },
  toggleBtnText: {
    color: theme.text.secondary,
    fontSize: 12,
    fontWeight: '500',
  },
  toggleBtnTextActive: {
    color: '#fff',
  },
  rawContainer: {
    maxHeight: 300,
    backgroundColor: theme.bg.primary,
  },
  rawContent: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.text.secondary,
    padding: 12,
    lineHeight: 14,
  },
  parsedContainer: {
    maxHeight: 350,
    padding: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: theme.text.primary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  infoItem: {
    minWidth: 100,
  },
  infoLabel: {
    color: theme.text.muted,
    fontSize: 10,
    marginBottom: 2,
  },
  infoValue: {
    color: theme.text.primary,
    fontSize: 13,
    fontWeight: '500',
  },
  variantItem: {
    backgroundColor: theme.bg.tertiary,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  variantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  variantResolution: {
    color: theme.text.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  variantBitrate: {
    color: theme.accent.info,
    fontSize: 12,
    fontWeight: '500',
  },
  variantCodecs: {
    color: theme.text.muted,
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  variantFps: {
    color: theme.text.secondary,
    fontSize: 11,
    marginBottom: 4,
  },
  variantUri: {
    color: theme.text.muted,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  segmentsList: {
    gap: 4,
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bg.tertiary,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  segmentIndex: {
    color: theme.text.muted,
    fontSize: 10,
    fontFamily: 'monospace',
    width: 30,
  },
  segmentDuration: {
    color: theme.accent.success,
    fontSize: 11,
    fontFamily: 'monospace',
    width: 60,
  },
  segmentUri: {
    color: theme.text.secondary,
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
  },
  discontinuityBadge: {
    backgroundColor: theme.accent.warning,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  discontinuityText: {
    color: '#000',
    fontSize: 8,
    fontWeight: '700',
  },
  moreSegments: {
    color: theme.text.muted,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  emptyText: {
    color: theme.text.muted,
    fontSize: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  errorText: {
    color: theme.accent.error,
    fontSize: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  loadingText: {
    color: theme.text.muted,
    fontSize: 12,
  },
});
