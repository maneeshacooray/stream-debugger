import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ============================================================================
// Types
// ============================================================================
export interface StreamConfig {
  id: string;
  name: string;
  url: string;
  isLive: boolean;
  isFavorite: boolean; // Show in quick-switch bar
  createdAt: number;
  lastUsedAt?: number;
}

export interface StreamSettings {
  defaultStreamId: string | null;
  multiViewStreamIds: string[];
  maxMultiViewStreams: number;
  themeMode: 'system' | 'light' | 'dark';
}

/** Max streams allowed in multi-view mode (performance and layout). */
export const MAX_MULTI_VIEW_STREAMS = 8;

// ============================================================================
// Storage Keys
// ============================================================================
const STORAGE_KEYS = {
  STREAMS: '@stream_debugger/streams_v2',
  SETTINGS: '@stream_debugger/settings_v2',
  INITIALIZED: '@stream_debugger/initialized_v2',
} as const;

// ============================================================================
// Default initial streams (only used on first launch, then user controls all)
// ============================================================================
const INITIAL_STREAMS: Omit<StreamConfig, 'id' | 'createdAt'>[] = [
  {
    name: 'Test Stream',
    url: 'https://test-streams.mux.dev/x36xhzz/url_8/193039199_mp4_h264_aac_fhd_7.m3u8',
    isLive: false,
    isFavorite: true,
  },
];

// ============================================================================
// Stream Storage Class
// ============================================================================
class StreamStorage {
  private streams: StreamConfig[] = [];
  private settings: StreamSettings = {
    defaultStreamId: null,
    multiViewStreamIds: [],
    maxMultiViewStreams: MAX_MULTI_VIEW_STREAMS,
    themeMode: 'system',
  };
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private listeners: Set<() => void> = new Set();

  // Initialize storage - loads from AsyncStorage or sets up defaults
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      const [streamsJson, settingsJson, wasInitialized] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.STREAMS),
        AsyncStorage.getItem(STORAGE_KEYS.SETTINGS),
        AsyncStorage.getItem(STORAGE_KEYS.INITIALIZED),
      ]);

      // Load existing data
      if (streamsJson) {
        this.streams = JSON.parse(streamsJson);
      }
      if (settingsJson) {
        this.settings = { ...this.settings, ...JSON.parse(settingsJson) };
      }

      // First time setup - add initial streams
      if (!wasInitialized && this.streams.length === 0) {
        for (const stream of INITIAL_STREAMS) {
          await this.addStream(stream.name, stream.url, stream.isLive, stream.isFavorite);
        }
        // Set first stream as default
        if (this.streams.length > 0) {
          this.settings.defaultStreamId = this.streams[0].id;
          await this._saveSettings();
        }
        await AsyncStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize stream storage:', error);
      this.initialized = true;
    }
  }

  // ============================================================================
  // Reactivity
  // ============================================================================

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private _notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  // ============================================================================
  // Stream CRUD Operations
  // ============================================================================

  getAllStreams(): StreamConfig[] {
    return [...this.streams];
  }

  getFavoriteStreams(): StreamConfig[] {
    return this.streams.filter(s => s.isFavorite);
  }

  getStreamById(id: string): StreamConfig | undefined {
    return this.streams.find(s => s.id === id);
  }

  getStreamByUrl(url: string): StreamConfig | undefined {
    return this.streams.find(s => s.url === url);
  }

  getDefaultStream(): StreamConfig | undefined {
    if (this.settings.defaultStreamId) {
      const stream = this.getStreamById(this.settings.defaultStreamId);
      if (stream) return stream;
    }
    // Fallback to first favorite or first stream
    return this.getFavoriteStreams()[0] || this.streams[0];
  }

  getMultiViewStreams(): StreamConfig[] {
    return this.settings.multiViewStreamIds
      .map(id => this.getStreamById(id))
      .filter((s): s is StreamConfig => s !== undefined);
  }

  async addStream(
    name: string,
    url: string,
    isLive: boolean = false,
    isFavorite: boolean = false
  ): Promise<StreamConfig> {
    const id = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stream: StreamConfig = {
      id,
      name: name.trim(),
      url: url.trim(),
      isLive,
      isFavorite,
      createdAt: Date.now(),
    };

    this.streams.push(stream);
    await this._saveStreams();
    return stream;
  }

  async updateStream(
    id: string,
    updates: Partial<Omit<StreamConfig, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const index = this.streams.findIndex(s => s.id === id);
    if (index === -1) return false;

    this.streams[index] = {
      ...this.streams[index],
      ...updates,
      name: updates.name?.trim() ?? this.streams[index].name,
      url: updates.url?.trim() ?? this.streams[index].url,
    };
    await this._saveStreams();
    return true;
  }

  async deleteStream(id: string): Promise<boolean> {
    const index = this.streams.findIndex(s => s.id === id);
    if (index === -1) return false;

    this.streams.splice(index, 1);

    const needsSettingsCleanup = this.settings.defaultStreamId === id ||
      this.settings.multiViewStreamIds.includes(id);

    // Performance optimization: Avoid double notifications when settings cleanup is required.
    // Save streams without notifying listeners immediately.
    await this._saveStreams(!needsSettingsCleanup);

    // Clean up references if needed
    if (needsSettingsCleanup) {
      if (this.settings.defaultStreamId === id) {
        this.settings.defaultStreamId = this.streams[0]?.id || null;
      }
      this.settings.multiViewStreamIds = this.settings.multiViewStreamIds.filter(
        sid => sid !== id
      );
      await this._saveSettings(true);
    }

    return true;
  }

  async recordUsage(id: string): Promise<void> {
    const stream = this.getStreamById(id);
    if (stream) {
      await this.updateStream(id, { lastUsedAt: Date.now() });
    }
  }

  // ============================================================================
  // Settings Operations
  // ============================================================================

  getSettings(): StreamSettings {
    return { ...this.settings };
  }

  async setDefaultStream(id: string | null): Promise<void> {
    if (id && !this.getStreamById(id)) return;
    this.settings.defaultStreamId = id;
    await this._saveSettings();
  }

  async setMultiViewStreams(ids: string[]): Promise<void> {
    // Ensure we don't exceed the current limit
    const limit = this.settings.maxMultiViewStreams || MAX_MULTI_VIEW_STREAMS;
    const validIds = ids.filter(id => this.getStreamById(id));
    this.settings.multiViewStreamIds = validIds.slice(0, limit);
    await this._saveSettings();
  }

  async setMaxMultiViewStreams(max: number): Promise<void> {
    this.settings.maxMultiViewStreams = max;

    // Trim existing selection if it exceeds new limit
    if (this.settings.multiViewStreamIds.length > max) {
      this.settings.multiViewStreamIds = this.settings.multiViewStreamIds.slice(0, max);
    }

    await this._saveSettings();
  }

  async setThemeMode(mode: 'system' | 'light' | 'dark'): Promise<void> {
    this.settings.themeMode = mode;
    await this._saveSettings();
  }

  async toggleFavorite(id: string): Promise<boolean> {
    const stream = this.getStreamById(id);
    if (!stream) return false;
    await this.updateStream(id, { isFavorite: !stream.isFavorite });
    return true;
  }

  // ============================================================================
  // Import/Export
  // ============================================================================

  async exportData(): Promise<string> {
    return JSON.stringify({
      streams: this.streams,
      settings: this.settings,
      exportedAt: Date.now(),
    });
  }

  async importData(jsonString: string): Promise<{ success: boolean; error?: string }> {
    try {
      const data = JSON.parse(jsonString);
      if (!data.streams || !Array.isArray(data.streams)) {
        return { success: false, error: 'Invalid data format' };
      }

      this.streams = data.streams;
      if (data.settings) {
        this.settings = { ...this.settings, ...data.settings };
      }

      // Performance optimization: Save both streams and settings without notifying
      // individually, then dispatch exactly one notification at the end.
      await Promise.all([this._saveStreams(false), this._saveSettings(false)]);
      this._notifyListeners();
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to parse import data' };
    }
  }

  async clearAllData(): Promise<void> {
    this.streams = [];
    this.settings = {
      defaultStreamId: null,
      multiViewStreamIds: [],
      maxMultiViewStreams: MAX_MULTI_VIEW_STREAMS,
      themeMode: 'system'
    };
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.STREAMS),
      AsyncStorage.removeItem(STORAGE_KEYS.SETTINGS),
      AsyncStorage.removeItem(STORAGE_KEYS.INITIALIZED),
    ]);
    // Performance optimization: Notify listeners of data clear operation so that
    // active React hooks and UI components update automatically and remain in sync.
    this._notifyListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async _saveStreams(notify = true): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.STREAMS, JSON.stringify(this.streams));
      if (notify) {
        this._notifyListeners();
      }
    } catch (error) {
      console.error('Failed to save streams:', error);
    }
  }

  private async _saveSettings(notify = true): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
      if (notify) {
        this._notifyListeners();
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }
}

// Singleton instance
export const streamStorage = new StreamStorage();

// ============================================================================
// React Hook
// ============================================================================
export function useStreamConfig() {
  const [isLoading, setIsLoading] = useState(true);
  const [streams, setStreams] = useState<StreamConfig[]>([]);
  const [settings, setSettings] = useState<StreamSettings>({
    defaultStreamId: null,
    multiViewStreamIds: [],
    maxMultiViewStreams: MAX_MULTI_VIEW_STREAMS,
    themeMode: 'system',
  });

  // Initialize and load data
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await streamStorage.initialize();
      if (mounted) {
        setStreams(streamStorage.getAllStreams());
        setSettings(streamStorage.getSettings());
        setIsLoading(false);
      }
    };

    init();

    // Subscribe to updates from other hooks/instances.
    // Performance optimization: This subscription stays active for the lifetime
    // of the hook, completely eliminating resubscription overhead.
    const unsubscribe = streamStorage.subscribe(() => {
      if (mounted) {
        setStreams(streamStorage.getAllStreams());
        setSettings(streamStorage.getSettings());
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Performance optimization: refresh function is now a stable callback that
  // synchronously fetches the latest streams and settings from storage.
  const refresh = useCallback(() => {
    setStreams(streamStorage.getAllStreams());
    setSettings(streamStorage.getSettings());
  }, []);

  // Stream operations
  // Performance optimization: callbacks are fully stable (empty dependency array)
  // because we no longer call refresh() redundantly (the active storage subscription
  // automatically handles reactive updates). This prevents breaking downstream React.memo.
  const addStream = useCallback(
    async (name: string, url: string, isLive = false, isFavorite = false) => {
      const stream = await streamStorage.addStream(name, url, isLive, isFavorite);
      return stream;
    },
    []
  );

  const updateStream = useCallback(
    async (id: string, updates: Partial<Omit<StreamConfig, 'id' | 'createdAt'>>) => {
      const result = await streamStorage.updateStream(id, updates);
      return result;
    },
    []
  );

  const deleteStream = useCallback(
    async (id: string) => {
      const result = await streamStorage.deleteStream(id);
      return result;
    },
    []
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      const result = await streamStorage.toggleFavorite(id);
      return result;
    },
    []
  );

  const recordUsage = useCallback(
    async (id: string) => {
      await streamStorage.recordUsage(id);
    },
    []
  );

  // Settings operations
  const setDefaultStream = useCallback(
    async (id: string | null) => {
      await streamStorage.setDefaultStream(id);
    },
    []
  );

  const setMultiViewStreams = useCallback(
    async (ids: string[]) => {
      await streamStorage.setMultiViewStreams(ids);
    },
    []
  );

  const setMaxMultiViewStreams = useCallback(
    async (max: number) => {
      await streamStorage.setMaxMultiViewStreams(max);
    },
    []
  );

  const setThemeMode = useCallback(
    async (mode: 'system' | 'light' | 'dark') => {
      await streamStorage.setThemeMode(mode);
    },
    []
  );

  // Getters - depend on streams/settings state to return fresh data after updates
  const getDefaultStream = useCallback(() => {
    return streamStorage.getDefaultStream();
  }, [streams, settings.defaultStreamId]);

  const getFavoriteStreams = useCallback(() => {
    return streamStorage.getFavoriteStreams();
  }, [streams]);

  const getMultiViewStreams = useCallback(() => {
    return streamStorage.getMultiViewStreams();
  }, [streams, settings.multiViewStreamIds]);

  const getStreamById = useCallback((id: string) => {
    return streamStorage.getStreamById(id);
  }, [streams]);

  // Import/Export
  const exportData = useCallback(async () => {
    return streamStorage.exportData();
  }, []);

  const importData = useCallback(
    async (json: string) => {
      const result = await streamStorage.importData(json);
      return result;
    },
    []
  );

  const clearAllData = useCallback(async () => {
    await streamStorage.clearAllData();
  }, []);

  return useMemo(() => ({
    isLoading,
    streams,
    settings,
    // Stream operations
    addStream,
    updateStream,
    deleteStream,
    toggleFavorite,
    recordUsage,
    // Settings operations
    setDefaultStream,
    setMultiViewStreams,
    setMaxMultiViewStreams,
    setThemeMode,
    // Getters
    getDefaultStream,
    getFavoriteStreams,
    getMultiViewStreams,
    getStreamById,
    // Import/Export
    exportData,
    importData,
    clearAllData,
    // Utility
    refresh,
  }), [
    isLoading,
    streams,
    settings,
    addStream,
    updateStream,
    deleteStream,
    toggleFavorite,
    recordUsage,
    setDefaultStream,
    setMultiViewStreams,
    setMaxMultiViewStreams,
    setThemeMode,
    getDefaultStream,
    getFavoriteStreams,
    getMultiViewStreams,
    getStreamById,
    exportData,
    importData,
    clearAllData,
    refresh,
  ]);
}

/**
 * Performance optimization: A lightweight hook that only subscribes to the theme mode.
 * This prevents parent layouts or components from re-rendering on every stream configuration,
 * favorite, or usage update, completely isolating them from frequent changes.
 */
export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await streamStorage.initialize();
      if (mounted) {
        setThemeMode(streamStorage.getSettings().themeMode);
      }
    };

    init();

    const unsubscribe = streamStorage.subscribe(() => {
      if (mounted) {
        const mode = streamStorage.getSettings().themeMode;
        setThemeMode(prev => prev === mode ? prev : mode);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return themeMode;
}
