import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

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
  };
  private initialized = false;
  private initPromise: Promise<void> | null = null;

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
    await this._saveStreams();

    // Clean up references
    if (this.settings.defaultStreamId === id) {
      this.settings.defaultStreamId = this.streams[0]?.id || null;
    }
    this.settings.multiViewStreamIds = this.settings.multiViewStreamIds.filter(
      sid => sid !== id
    );
    await this._saveSettings();

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

      await Promise.all([this._saveStreams(), this._saveSettings()]);
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to parse import data' };
    }
  }

  async clearAllData(): Promise<void> {
    this.streams = [];
    this.streams = [];
    this.settings = {
      defaultStreamId: null,
      multiViewStreamIds: [],
      maxMultiViewStreams: MAX_MULTI_VIEW_STREAMS
    };
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.STREAMS),
      AsyncStorage.removeItem(STORAGE_KEYS.SETTINGS),
      AsyncStorage.removeItem(STORAGE_KEYS.INITIALIZED),
    ]);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async _saveStreams(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.STREAMS, JSON.stringify(this.streams));
    } catch (error) {
      console.error('Failed to save streams:', error);
    }
  }

  private async _saveSettings(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
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
  });
  const [refreshKey, setRefreshKey] = useState(0);

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
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Stream operations
  const addStream = useCallback(
    async (name: string, url: string, isLive = false, isFavorite = false) => {
      const stream = await streamStorage.addStream(name, url, isLive, isFavorite);
      refresh();
      return stream;
    },
    [refresh]
  );

  const updateStream = useCallback(
    async (id: string, updates: Partial<Omit<StreamConfig, 'id' | 'createdAt'>>) => {
      const result = await streamStorage.updateStream(id, updates);
      refresh();
      return result;
    },
    [refresh]
  );

  const deleteStream = useCallback(
    async (id: string) => {
      const result = await streamStorage.deleteStream(id);
      refresh();
      return result;
    },
    [refresh]
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      const result = await streamStorage.toggleFavorite(id);
      refresh();
      return result;
    },
    [refresh]
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
      refresh();
    },
    [refresh]
  );

  const setMultiViewStreams = useCallback(
    async (ids: string[]) => {
      await streamStorage.setMultiViewStreams(ids);
      refresh();
    },
    [refresh]
  );

  const setMaxMultiViewStreams = useCallback(
    async (max: number) => {
      await streamStorage.setMaxMultiViewStreams(max);
      refresh();
    },
    [refresh]
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
      if (result.success) refresh();
      return result;
    },
    [refresh]
  );

  const clearAllData = useCallback(async () => {
    await streamStorage.clearAllData();
    refresh();
  }, [refresh]);

  return {
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
  };
}
