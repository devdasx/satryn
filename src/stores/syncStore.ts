/**
 * Sync Store
 * Centralized sync state management for wallet connection status
 */

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';

export type SyncState = 'synced' | 'syncing' | 'not_synced' | 'offline';

interface SyncStoreState {
  // State
  syncState: SyncState;
  lastSyncTime: number | null;
  serverHost: string | null;
  blockHeight: number | null;
  isNetworkConnected: boolean;
  syncError: string | null;

  // Actions
  startSyncing: () => void;
  completeSyncing: (blockHeight?: number, serverHost?: string) => void;
  failSyncing: (error: string) => void;
  setNetworkConnected: (connected: boolean) => void;
  setServerHost: (host: string) => void;
  setBlockHeight: (height: number) => void;
  initNetworkListener: () => () => void;
  resetSyncState: () => void;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  // Initial state
  syncState: 'not_synced',
  lastSyncTime: null,
  serverHost: null,
  blockHeight: null,
  isNetworkConnected: true, // Assume connected initially
  syncError: null,

  // Start syncing
  startSyncing: () => {
    const { isNetworkConnected } = get();
    if (!isNetworkConnected) {
      set({ syncState: 'offline' });
      return;
    }
    set({ syncState: 'syncing', syncError: null });
  },

  // Complete syncing successfully
  completeSyncing: (blockHeight?: number, serverHost?: string) => {
    set({
      syncState: 'synced',
      lastSyncTime: Date.now(),
      syncError: null,
      ...(blockHeight !== undefined && { blockHeight }),
      ...(serverHost !== undefined && { serverHost }),
    });
  },

  // Fail syncing with error
  failSyncing: (error: string) => {
    const { isNetworkConnected } = get();
    set({
      syncState: isNetworkConnected ? 'not_synced' : 'offline',
      syncError: error,
    });
  },

  // Set network connection status
  setNetworkConnected: (connected: boolean) => {
    const { syncState } = get();
    set({ isNetworkConnected: connected });

    // If we lose connection while synced, change to offline
    if (!connected && syncState === 'synced') {
      set({ syncState: 'offline' });
    }
    // If we regain connection while offline, change to not_synced
    else if (connected && syncState === 'offline') {
      set({ syncState: 'not_synced' });
    }
  },

  // Set server host
  setServerHost: (host: string) => {
    set({ serverHost: host });
  },

  // Set block height
  setBlockHeight: (height: number) => {
    set({ blockHeight: height });
  },

  // Initialize network listener - returns cleanup function
  // Connectivity is inferred from Electrum sync results:
  // - completeSyncing() sets connected = true
  // - failSyncing() with network errors sets connected = false
  // On foreground, we mark not_synced so the wallet triggers a re-sync
  initNetworkListener: () => {
    get().setNetworkConnected(true);

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const { syncState } = get();
        // When app returns to foreground, mark as not_synced so the
        // wallet store triggers a refresh via Electrum (not an external API)
        if (syncState === 'synced') {
          set({ syncState: 'not_synced' });
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  },

  // Reset sync state (e.g., on wallet delete)
  resetSyncState: () => {
    set({
      syncState: 'not_synced',
      lastSyncTime: null,
      serverHost: null,
      blockHeight: null,
      syncError: null,
    });
  },
}));

// Helper to get human-readable time since last sync
export function getTimeSinceLastSync(lastSyncTime: number | null): string {
  if (!lastSyncTime) return 'Never';

  const now = Date.now();
  const diffMs = now - lastSyncTime;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}
