import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_MULTI_VIEW_STREAMS, StreamConfig, useStreamConfig } from '../config/streams';
import { ABOUT } from '../constants/about';
import { defaultTheme, Theme, useAppTheme } from '../constants/appTheme';

// ============================================================================
// Theme (matching main screen)
// ============================================================================
// Theme imported from constants/appTheme

// ============================================================================
// Stream Editor Modal Component
// ============================================================================
interface StreamEditorProps {
  stream?: StreamConfig;
  onSave: (name: string, url: string, isLive: boolean, isFavorite: boolean) => void;
  onCancel: () => void;
  onDelete?: () => void;
  theme: Theme;
}

function StreamEditor({ stream, onSave, onCancel, onDelete, theme }: StreamEditorProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState(stream?.name || '');
  const [url, setUrl] = useState(stream?.url || '');
  const [isLive, setIsLive] = useState<boolean>(stream?.isLive ?? false);
  const [isFavorite, setIsFavorite] = useState<boolean>(stream?.isFavorite ?? true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');

  // Preview player - only created when showPreview is true and URL is valid
  const previewPlayer = useVideoPlayer(showPreview && url.trim() ? url.trim() : null, (player) => {
    if (player) {
      player.loop = true;
      player.muted = true;
      player.play();
    }
  });

  // Listen to preview player status
  useEffect(() => {
    if (!previewPlayer || !showPreview) return;

    let isMounted = true;
    setPreviewStatus('loading');

    const statusListener = previewPlayer.addListener('statusChange', ({ status, error }) => {
      if (!isMounted) return;
      if (status === 'readyToPlay') {
        setPreviewStatus('playing');
      } else if (status === 'error' || error) {
        setPreviewStatus('error');
      } else if (status === 'loading') {
        setPreviewStatus('loading');
      }
    });

    const playingListener = previewPlayer.addListener('playingChange', ({ isPlaying }) => {
      if (!isMounted) return;
      if (isPlaying) {
        setPreviewStatus('playing');
      }
    });

    return () => {
      isMounted = false;
      statusListener?.remove();
      playingListener?.remove();
      // Wrap in try-catch to handle player already being released
      try {
        previewPlayer.pause();
      } catch {
        // Player may have already been released
      }
    };
  }, [previewPlayer, showPreview]);

  // Stop preview when URL changes - use a ref to track previous URL
  const prevUrlRef = React.useRef(url);
  useEffect(() => {
    if (prevUrlRef.current !== url && showPreview) {
      setShowPreview(false);
      setPreviewStatus('idle');
    }
    prevUrlRef.current = url;
  }, [url, showPreview]);

  const handlePreview = () => {
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a stream URL first');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      Alert.alert('Error', 'URL must start with http:// or https://');
      return;
    }
    Keyboard.dismiss();
    setShowPreview(true);
    setPreviewStatus('loading');
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a stream name');
      return;
    }
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a stream URL');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      Alert.alert('Error', 'URL must start with http:// or https://');
      return;
    }
    Keyboard.dismiss();
    setShowPreview(false);
    onSave(name.trim(), url.trim(), isLive, isFavorite);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Stream',
      `Are you sure you want to delete "${stream?.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  const handleCancel = () => {
    setShowPreview(false);
    onCancel();
  };

  return (
    <ScrollView style={styles.editorContainer} contentContainerStyle={styles.editorScrollContent}>
      <View style={styles.editorHeader}>
        <Text style={styles.editorTitle}>
          {stream ? 'Edit Stream' : 'Add Stream'}
        </Text>
        <Pressable onPress={handleCancel} style={styles.editorCloseBtn}>
          <Ionicons name="close" size={24} color={theme.text.secondary} />
        </Pressable>
      </View>

      <View style={styles.editorField}>
        <Text style={styles.editorLabel}>Name / Alias</Text>
        <TextInput
          style={styles.editorInput}
          value={name}
          onChangeText={setName}
          placeholder="My Stream"
          placeholderTextColor={theme.text.muted}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.editorField}>
        <Text style={styles.editorLabel}>Stream URL</Text>
        <TextInput
          style={[styles.editorInput, styles.editorInputUrl]}
          value={url}
          onChangeText={setUrl}
          placeholder="https://example.com/stream.m3u8"
          placeholderTextColor={defaultTheme.text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          multiline
        />
      </View>

      {/* Preview Section */}
      <View style={styles.previewSection}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewLabel}>Preview</Text>
          {!showPreview && (
            <Pressable style={styles.previewBtn} onPress={handlePreview}>
              <Ionicons name="play" size={14} color={theme.accent.primary} />
              <Text style={styles.previewBtnText}>Test URL</Text>
            </Pressable>
          )}
        </View>

        {showPreview && (
          <View style={styles.previewContainer}>
            <View style={styles.previewPlayer}>
              {previewPlayer && (
                <VideoView
                  style={styles.previewVideo}
                  player={previewPlayer}
                  contentFit="contain"
                />
              )}
              {previewStatus === 'loading' && (
                <View style={styles.previewOverlay}>
                  <ActivityIndicator size="large" color={theme.accent.primary} />
                  <Text style={styles.previewStatusText}>Loading...</Text>
                </View>
              )}
              {previewStatus === 'error' && (
                <View style={styles.previewOverlay}>
                  <Ionicons name="alert-circle" size={32} color={theme.accent.error} />
                  <Text style={[styles.previewStatusText, { color: theme.accent.error }]}>
                    Failed to load stream
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.previewStatusBar}>
              <View style={[
                styles.previewStatusDot,
                {
                  backgroundColor: previewStatus === 'playing' ? theme.accent.success :
                    previewStatus === 'error' ? theme.accent.error :
                      theme.accent.warning
                }
              ]} />
              <Text style={styles.previewStatusLabel}>
                {previewStatus === 'playing' ? 'Stream OK' :
                  previewStatus === 'error' ? 'Stream Failed' :
                    'Testing...'}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.editorRow}>
        <View style={styles.editorToggle}>
          <Text style={styles.editorToggleLabel}>Live Stream</Text>
          <Switch
            value={isLive}
            onValueChange={setIsLive}
            trackColor={{ false: theme.bg.tertiary, true: theme.accent.error + '60' }}
            thumbColor={isLive ? theme.accent.error : theme.text.muted}
          />
        </View>

        <View style={styles.editorToggle}>
          <Text style={styles.editorToggleLabel}>Quick Access</Text>
          <Switch
            value={isFavorite}
            onValueChange={setIsFavorite}
            trackColor={{ false: theme.bg.tertiary, true: theme.accent.primary + '60' }}
            thumbColor={isFavorite ? theme.accent.primary : theme.text.muted}
          />
        </View>
      </View>

      <View style={styles.editorActions}>
        {stream && onDelete && (
          <Pressable style={styles.editorDeleteBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color={theme.accent.error} />
            <Text style={styles.editorDeleteText}>Delete</Text>
          </Pressable>
        )}
        <View style={styles.editorActionsSpacer} />
        <Pressable style={styles.editorCancelBtn} onPress={handleCancel}>
          <Text style={styles.editorCancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.editorSaveBtn} onPress={handleSave}>
          <Text style={styles.editorSaveText}>Save</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ============================================================================
// Stream List Item Component
// ============================================================================
interface StreamItemProps {
  stream: StreamConfig;
  isDefault: boolean;
  onPress: () => void;
  onSetDefault: () => void;
  onToggleFavorite: () => void;
  theme: Theme;
}

const StreamItem = memo(function StreamItem({ stream, isDefault, onPress, onSetDefault, onToggleFavorite, theme }: StreamItemProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable style={styles.streamItem} onPress={onPress}>
      <View style={styles.streamItemLeft}>
        <View style={styles.streamItemHeader}>
          <Text style={styles.streamItemName} numberOfLines={1}>
            {stream.name}
          </Text>
          {stream.isLive && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
          {isDefault && (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultText}>DEFAULT</Text>
            </View>
          )}
        </View>
        <Text style={styles.streamItemUrl} numberOfLines={1}>
          {stream.url}
        </Text>
      </View>
      <View style={styles.streamItemActions}>
        <Pressable
          style={styles.streamItemAction}
          onPress={onToggleFavorite}
          hitSlop={8}
        >
          <Ionicons
            name={stream.isFavorite ? 'star' : 'star-outline'}
            size={20}
            color={stream.isFavorite ? theme.accent.warning : theme.text.muted}
          />
        </Pressable>
        <Pressable
          style={styles.streamItemAction}
          onPress={onSetDefault}
          hitSlop={8}
        >
          <Ionicons
            name={isDefault ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={20}
            color={isDefault ? theme.accent.success : theme.text.muted}
          />
        </Pressable>
        <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
      </View>
    </Pressable>
  );
});

// ============================================================================
// Import Modal Component
// ============================================================================
interface ImportModalProps {
  visible: boolean;
  onImport: (json: string) => Promise<void>;
  onCancel: () => void;
  theme: Theme;
}

function ImportModal({ visible, onImport, onCancel, theme }: ImportModalProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [jsonText, setJsonText] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (visible) {
      setJsonText('');
      setIsImporting(false);
    }
  }, [visible]);

  const handleImport = async () => {
    if (!jsonText.trim()) return;

    setIsImporting(true);
    try {
      await onImport(jsonText);
      onCancel();
    } catch (error) {
      // Error handling is done in parent
    } finally {
      setIsImporting(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>Import Streams</Text>
        <Text style={styles.modalSubtitle}>
          Paste the JSON data exported from another device.
        </Text>

        <TextInput
          style={styles.modalInput}
          value={jsonText}
          onChangeText={setJsonText}
          placeholder='{"streams": [...], "settings": {...}}'
          placeholderTextColor={theme.text.muted}
          multiline
          numberOfLines={6}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.modalActions}>
          <Pressable style={styles.modalCancelBtn} onPress={onCancel}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.modalImportBtn, (!jsonText.trim() || isImporting) && styles.modalBtnDisabled]}
            onPress={handleImport}
            disabled={!jsonText.trim() || isImporting}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.modalImportText}>Import</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ============================================================================
// Theme Selector Component
// ============================================================================
interface ThemeSelectorProps {
  currentMode: 'system' | 'light' | 'dark';
  onSelectCallback: (mode: 'system' | 'light' | 'dark') => void;
  theme: Theme;
}

function ThemeSelector({ currentMode, onSelectCallback, theme }: ThemeSelectorProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const options: { label: string; value: 'system' | 'light' | 'dark'; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'System', value: 'system', icon: 'settings-outline' },
    { label: 'Light', value: 'light', icon: 'sunny-outline' },
    { label: 'Dark', value: 'dark', icon: 'moon-outline' },
  ];

  return (
    <View style={styles.themeSelectorContainer}>
      <View style={styles.sectionHeader}>
        <Ionicons name="color-palette-outline" size={18} color={theme.accent.primary} />
        <Text style={styles.sectionTitle}>Appearance</Text>
      </View>
      <View style={styles.themeOptionsRow}>
        {options.map((option) => {
          const isSelected = currentMode === option.value;
          return (
            <Pressable
              key={option.value}
              style={[
                styles.themeOptionBtn,
                isSelected && { backgroundColor: theme.accent.primary },
              ]}
              onPress={() => onSelectCallback(option.value)}
            >
              <Ionicons
                name={option.icon}
                size={20}
                color={isSelected ? '#fff' : theme.text.secondary}
              />
              <Text
                style={[
                  styles.themeOptionLabel,
                  isSelected && { color: '#fff', fontWeight: 'bold' },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================================
// Settings Screen
// ============================================================================
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  const {
    isLoading,
    streams,
    settings,
    addStream,
    updateStream,
    deleteStream,
    toggleFavorite,
    setDefaultStream,
    setMultiViewStreams,
    setMaxMultiViewStreams,
    exportData,
    importData,
    clearAllData,
    setThemeMode,
  } = useStreamConfig();

  const theme = useAppTheme(settings.themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [editingStream, setEditingStream] = useState<StreamConfig | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Toggle stream in multi-view selection
  const toggleMultiViewStream = useCallback((streamId: string) => {
    const currentIds = settings.multiViewStreamIds || [];
    const isSelected = currentIds.includes(streamId);

    if (isSelected) {
      // Remove from multi-view
      setMultiViewStreams(currentIds.filter(id => id !== streamId));
    } else {
      // Add to multi-view (max streams)
      const limit = settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS;
      if (currentIds.length >= limit) {
        Alert.alert('Limit Reached', `You can select up to ${limit} streams for multi-view mode.`);
        return;
      }
      setMultiViewStreams([...currentIds, streamId]);
    }
  }, [settings.multiViewStreamIds, settings.maxMultiViewStreams, setMultiViewStreams]);

  const handleIncrementLimit = useCallback(() => {
    const current = settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS;
    if (current < 16) setMaxMultiViewStreams(current + 1);
  }, [settings.maxMultiViewStreams, setMaxMultiViewStreams]);

  const handleDecrementLimit = useCallback(() => {
    const current = settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS;
    if (current > 1) setMaxMultiViewStreams(current - 1);
  }, [settings.maxMultiViewStreams, setMaxMultiViewStreams]);

  const handleSaveStream = useCallback(
    async (name: string, url: string, isLive: boolean, isFavorite: boolean) => {
      if (editingStream) {
        await updateStream(editingStream.id, { name, url, isLive, isFavorite });
      } else {
        await addStream(name, url, isLive, isFavorite);
      }
      setEditingStream(null);
      setIsAddingNew(false);
    },
    [editingStream, updateStream, addStream]
  );

  const handleDeleteStream = useCallback(async () => {
    if (editingStream) {
      await deleteStream(editingStream.id);
      setEditingStream(null);
    }
  }, [editingStream, deleteStream]);

  const handleExport = useCallback(async () => {
    try {
      const data = await exportData();
      await Share.share({
        message: data,
        title: 'Stream Debugger - Export',
      });
    } catch {
      Alert.alert('Error', 'Failed to export data');
    }
  }, [exportData]);

  const handleImport = useCallback(async (jsonText: string) => {
    const result = await importData(jsonText);
    if (result.success) {
      Alert.alert('Success', 'Data imported successfully');
    } else {
      Alert.alert('Error', result.error || 'Failed to import data');
      throw new Error(result.error); // Re-throw to keep modal open if needed, or handle differently
    }
  }, [importData]);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear All Data',
      'This will delete all your streams and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: clearAllData,
        },
      ]
    );
  }, [clearAllData]);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg.primary} />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  // Show editor overlay
  if (editingStream || isAddingNew) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg.primary} />
        <StreamEditor
          stream={editingStream || undefined}
          onSave={handleSaveStream}
          onCancel={() => {
            setEditingStream(null);
            setIsAddingNew(false);
          }}
          onDelete={editingStream ? handleDeleteStream : undefined}
          theme={theme}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg.primary} />

      <ImportModal
        visible={showImportModal}
        onImport={handleImport}
        onCancel={() => setShowImportModal(false)}
        theme={theme}
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.text.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <Pressable style={styles.addBtn} onPress={() => setIsAddingNew(true)}>
          <Ionicons name="add" size={24} color={theme.accent.primary} />
        </Pressable>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Streams Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="play-circle-outline" size={18} color={theme.accent.primary} />
            <Text style={styles.sectionTitle}>Streams</Text>
            <Text style={styles.sectionCount}>{streams.length}</Text>
          </View>

          {streams.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="albums-outline" size={48} color={theme.text.muted} />
              <Text style={styles.emptyText}>No streams configured</Text>
              <Text style={styles.emptySubtext}>
                Tap + to add your first stream
              </Text>
            </View>
          ) : (
            <View style={styles.streamList}>
              {streams.map(stream => (
                <StreamItem
                  key={stream.id}
                  stream={stream}
                  isDefault={settings.defaultStreamId === stream.id}
                  onPress={() => setEditingStream(stream)}
                  onSetDefault={() => setDefaultStream(stream.id)}
                  onToggleFavorite={() => toggleFavorite(stream.id)}
                  theme={theme}
                />
              ))}
            </View>
          )}
        </View>

        {/* Theme Selection */}
        <View style={styles.section}>
          <ThemeSelector
            currentMode={settings.themeMode || 'system'}
            onSelectCallback={setThemeMode}
            theme={theme}
          />
        </View>

        {/* Quick Access Info */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={theme.accent.primary} />
          <Text style={styles.infoText}>
            Streams marked with a star appear in the quick access bar on the main screen.
            The checkmark indicates the default stream that loads on startup.
          </Text>
        </View>

        {/* Multi-View Configuration */}
        {streams.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="grid-outline" size={18} color={theme.accent.primary} />
              <Text style={styles.sectionTitle}>Multi-View Streams</Text>
              <Text style={styles.sectionCount}>
                {settings.multiViewStreamIds?.length || 0}/{settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS}
              </Text>
            </View>

            <View style={styles.limitControl}>
              <Text style={styles.limitLabel}>Max Streams Allowed</Text>
              <View style={styles.limitStepper}>
                <Pressable
                  style={[styles.stepperBtn, (settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS) <= 1 && styles.stepperBtnDisabled]}
                  onPress={handleDecrementLimit}
                  disabled={(settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS) <= 1}
                >
                  <Ionicons name="remove" size={20} color={theme.text.primary} />
                </Pressable>
                <Text style={styles.limitValue}>{settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS}</Text>
                <Pressable
                  style={[styles.stepperBtn, (settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS) >= 16 && styles.stepperBtnDisabled]}
                  onPress={handleIncrementLimit}
                  disabled={(settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS) >= 16}
                >
                  <Ionicons name="add" size={20} color={theme.text.primary} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.multiViewDescription}>
              Select up to {settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS} streams to display simultaneously in multi-view mode.
            </Text>

            <View style={styles.multiViewList}>
              {streams.map((stream, index) => {
                const isSelected = settings.multiViewStreamIds?.includes(stream.id) || false;
                const selectionIndex = settings.multiViewStreamIds?.indexOf(stream.id) ?? -1;

                return (
                  <Pressable
                    key={stream.id}
                    style={styles.multiViewItem}
                    onPress={() => toggleMultiViewStream(stream.id)}
                  >
                    <View style={styles.multiViewItemLeft}>
                      {isSelected ? (
                        <View style={styles.multiViewIndex}>
                          <Text style={styles.multiViewIndexText}>{selectionIndex + 1}</Text>
                        </View>
                      ) : (
                        <View style={styles.multiViewCheckbox}>
                          <Ionicons name="add" size={14} color={theme.text.muted} />
                        </View>
                      )}
                      <Text
                        style={[
                          styles.multiViewItemName,
                          isSelected && styles.multiViewItemNameSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {stream.name}
                      </Text>
                      {stream.isLive && (
                        <View style={styles.multiViewLiveBadge}>
                          <Text style={styles.multiViewLiveText}>LIVE</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Data Management Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="folder-outline" size={18} color={theme.accent.primary} />
            <Text style={styles.sectionTitle}>Data Management</Text>
          </View>

          <View style={styles.actionList}>
            <Pressable style={styles.actionItem} onPress={handleExport}>
              <Ionicons name="share-outline" size={20} color={theme.text.secondary} />
              <Text style={styles.actionText}>Export Streams</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.text.muted} />
            </Pressable>

            <Pressable style={styles.actionItem} onPress={() => setShowImportModal(true)}>
              <Ionicons name="download-outline" size={20} color={theme.text.secondary} />
              <Text style={styles.actionText}>Import Streams</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.text.muted} />
            </Pressable>

            <Pressable style={styles.actionItem} onPress={handleClearAll}>
              <Ionicons name="trash-outline" size={20} color={theme.accent.error} />
              <Text style={[styles.actionText, { color: theme.accent.error }]}>
                Clear All Data
              </Text>
              <Ionicons name="chevron-forward" size={18} color={theme.text.muted} />
            </Pressable>
          </View>
        </View>

        {/* About / Developer Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={18} color={theme.accent.primary} />
            <Text style={styles.sectionTitle}>About</Text>
          </View>
          <View style={styles.aboutBox}>
            <Text style={styles.aboutAppName}>
              {Constants.expoConfig?.name ?? ABOUT.appName}
            </Text>
            <Text style={styles.aboutVersion}>
              Version {Constants.expoConfig?.version ?? ABOUT.version}
            </Text>
            <Text style={styles.aboutDeveloper}>{ABOUT.developer}</Text>
            <Text style={styles.aboutDescription}>{ABOUT.description}</Text>
          </View>
        </View>

        {/* Bottom padding */}
        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>
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
  themeSelectorContainer: {
    marginBottom: 8,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    backgroundColor: theme.bg.tertiary,
    borderRadius: 8,
    padding: 4,
    marginTop: 12,
  },
  themeOptionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
  },
  themeOptionLabel: {
    fontSize: 14,
    color: theme.text.secondary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: theme.text.muted,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text.primary,
  },
  addBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.text.primary,
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    color: theme.text.muted,
    backgroundColor: theme.bg.tertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  streamList: {
    gap: 8,
  },
  streamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bg.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  streamItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  streamItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  streamItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.text.primary,
    flexShrink: 1,
  },
  streamItemUrl: {
    fontSize: 11,
    color: theme.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  streamItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  streamItemAction: {
    padding: 4,
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
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.accent.error,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.accent.error,
  },
  defaultBadge: {
    backgroundColor: theme.accent.success + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.accent.success,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.bg.tertiary,
    padding: 12,
    borderRadius: 10,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: theme.text.secondary,
    lineHeight: 18,
  },
  multiViewDescription: {
    fontSize: 13,
    color: theme.text.secondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  limitControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bg.card,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  limitLabel: {
    fontSize: 15,
    color: theme.text.primary,
    fontWeight: '500',
  },
  limitStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.bg.tertiary,
    borderRadius: 8,
    padding: 4,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg.card,
    borderRadius: 6,
  },
  stepperBtnDisabled: {
    opacity: 0.5,
  },
  limitValue: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text.primary,
    width: 24,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
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
  multiViewList: {
    gap: 8,
  },
  multiViewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bg.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  multiViewItemSelected: {
    backgroundColor: theme.accent.primary + '15',
    borderColor: theme.accent.primary + '50',
  },
  multiViewItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  multiViewCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.bg.tertiary,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiViewIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiViewIndexText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  multiViewItemName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.text.secondary,
    flex: 1,
  },
  multiViewItemNameSelected: {
    color: theme.text.primary,
    fontWeight: '600',
  },
  multiViewLiveBadge: {
    backgroundColor: theme.accent.error + '20',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  multiViewLiveText: {
    fontSize: 8,
    fontWeight: '700',
    color: theme.accent.error,
  },
  actionList: {
    backgroundColor: theme.bg.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  actionText: {
    flex: 1,
    fontSize: 15,
    color: theme.text.primary,
  },
  // About section
  aboutBox: {
    backgroundColor: theme.bg.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 6,
  },
  aboutAppName: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.text.primary,
  },
  aboutVersion: {
    fontSize: 12,
    color: theme.text.muted,
    marginBottom: 4,
  },
  aboutDeveloper: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.accent.primary,
  },
  aboutDescription: {
    fontSize: 12,
    color: theme.text.secondary,
    lineHeight: 18,
    marginTop: 4,
  },
  // Editor styles
  editorContainer: {
    flex: 1,
  },
  editorScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  editorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.text.primary,
  },
  editorCloseBtn: {
    padding: 4,
  },
  editorField: {
    marginBottom: 20,
  },
  editorLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text.secondary,
    marginBottom: 8,
  },
  editorInput: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: theme.text.primary,
    borderWidth: 1,
    borderColor: theme.border,
  },
  editorInputUrl: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Preview styles
  previewSection: {
    marginBottom: 20,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text.secondary,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.accent.primary + '20',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.accent.primary + '40',
  },
  previewBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.accent.primary,
  },
  previewContainer: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
  },
  previewPlayer: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  previewVideo: {
    flex: 1,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewStatusText: {
    fontSize: 12,
    color: theme.text.secondary,
  },
  previewStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: theme.bg.tertiary,
  },
  previewStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewStatusLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text.secondary,
  },
  editorRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  editorToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bg.secondary,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  editorToggleLabel: {
    fontSize: 14,
    color: theme.text.primary,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 20,
  },
  editorDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
  },
  editorDeleteText: {
    fontSize: 15,
    color: theme.accent.error,
  },
  editorActionsSpacer: {
    flex: 1,
  },
  editorCancelBtn: {
    padding: 12,
    marginRight: 8,
  },
  editorCancelText: {
    fontSize: 15,
    color: theme.text.secondary,
  },
  editorSaveBtn: {
    backgroundColor: theme.accent.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  editorSaveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  // Modal Styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: theme.bg.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.text.primary,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.text.secondary,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: theme.bg.tertiary,
    borderRadius: 8,
    padding: 12,
    color: theme.text.primary,
    fontSize: 14,
    height: 120,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.bg.tertiary,
  },
  modalCancelText: {
    color: theme.text.primary,
    fontWeight: '600',
  },
  modalImportBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.accent.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  modalBtnDisabled: {
    opacity: 0.5,
  },
  modalImportText: {
    color: '#fff',
    fontWeight: '600',
  },
});
