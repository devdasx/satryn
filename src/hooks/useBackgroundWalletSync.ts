/**
 * useBackgroundWalletSync
 * Hook for syncing all wallet balances in the background
 * Runs every 30 seconds to keep wallet switcher balances up to date.
 * Also manages Electrum connection health on app foreground.
 */

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useMultiWalletStore } from '../stores/multiWalletStore';
import { useWalletStore } from '../stores/walletStore';
import { WalletManager } from '../services/wallet/WalletManager';
import { ElectrumAPI } from '../services/electrum';
import { SyncLogger } from '../services/SyncLogger';

// Sync interval: 60 seconds (increased from 30s to reduce network contention)
const SYNC_INTERVAL = 60 * 1000;

// Maximum concurrent background syncs (limits peak Electrum requests)
const MAX_CONCURRENT_SYNCS = 2;

// Minimum time between syncs (prevent rapid syncing)
const MIN_SYNC_GAP = 10 * 1000;

export function useBackgroundWalletSync() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<number>(0);
  const isSyncingRef = useRef<boolean>(false);

  const wallets = useMultiWalletStore((state) => state.wallets);
  const activeWalletId = useMultiWalletStore((state) => state.activeWalletId);
  const isLocked = useWalletStore((state) => state.isLocked);

  /**
   * Ensure Electrum connection is healthy.
   * Called on app foreground and before sync cycles.
   */
  const ensureConnectionHealth = async () => {
    try {
      const api = ElectrumAPI.shared('mainnet');
      const isConnected = api.isClientConnected();

      if (!isConnected) {
        SyncLogger.warn('background-sync', 'Electrum disconnected — reconnecting');
        await api.connect();
        SyncLogger.log('background-sync', 'Electrum reconnected successfully');
      }

      // Ensure health monitor is running
      api.startHealthMonitor();
    } catch (err: any) {
      SyncLogger.error('background-sync', `Electrum reconnect failed: ${err?.message || err}`);
    }
  };

  // Sync all inactive wallets (active wallet is synced by walletStore)
  const syncInactiveWallets = async () => {
    // Don't sync if locked or already syncing
    if (isLocked || isSyncingRef.current) {
      return;
    }

    // Check minimum gap between syncs
    const now = Date.now();
    if (now - lastSyncRef.current < MIN_SYNC_GAP) {
      return;
    }

    // Capture the active wallet at the start of this sync cycle
    const syncStartActiveId = useMultiWalletStore.getState().activeWalletId;

    // Get wallets that are not the active one
    const inactiveWallets = wallets.filter(w => w.id !== syncStartActiveId);

    if (inactiveWallets.length === 0) {
      return;
    }

    isSyncingRef.current = true;
    lastSyncRef.current = now;

    try {
      // Ensure connection is healthy before syncing
      await ensureConnectionHealth();

      // Initialize Electrum pool for parallel syncing
      const api = ElectrumAPI.shared('mainnet');
      await api.initializePool(Math.min(inactiveWallets.length, 3));

      // Filter wallets that are not already syncing
      const walletsToSync = inactiveWallets.filter(w => w.syncStatus !== 'syncing');

      // Sync wallets with concurrency limit to prevent 500+ parallel Electrum requests
      // Process MAX_CONCURRENT_SYNCS at a time
      for (let i = 0; i < walletsToSync.length; i += MAX_CONCURRENT_SYNCS) {
        const chunk = walletsToSync.slice(i, i + MAX_CONCURRENT_SYNCS);
        const chunkPromises = chunk.map(async (wallet) => {
          // Stale wallet guard: if the active wallet changed during this cycle, skip
          const currentActiveId = useMultiWalletStore.getState().activeWalletId;
          if (currentActiveId !== syncStartActiveId) {
            return;
          }

          try {
            await WalletManager.syncWallet(wallet);
          } catch (error) {
            // Failed to sync wallet
          }
        });

        await Promise.all(chunkPromises);
      }
    } finally {
      isSyncingRef.current = false;

      // Trigger continuous archival after background sync completes
      try {
        const { ContinuousArchivalManager } = require('../services/storage/ContinuousArchivalManager');
        ContinuousArchivalManager.triggerIfNeeded();
      } catch {
        // Non-critical — skip if archival fails
      }
    }
  };

  // Start/stop interval based on app state
  useEffect(() => {
    const startInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      // Initial connection health check + sync after a short delay
      const initialTimeout = setTimeout(async () => {
        await ensureConnectionHealth();
        syncInactiveWallets();
      }, 5000);

      // Set up periodic sync
      intervalRef.current = setInterval(() => {
        syncInactiveWallets();
      }, SYNC_INTERVAL);

      return () => {
        clearTimeout(initialTimeout);
      };
    };

    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // App foreground/background handler — runs for ALL users (single or multi-wallet)
    const appStateSubscription = !isLocked ? AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && !isLocked) {
        // App came to foreground — immediately verify connection health
        SyncLogger.log('background-sync', 'App became active — checking connection');
        ensureConnectionHealth();
      } else if (state === 'background') {
        // App going to background — stop health monitor to save battery
        SyncLogger.log('background-sync', 'App going to background');
        try {
          const api = ElectrumAPI.shared('mainnet');
          api.stopHealthMonitor();
        } catch {}
      }
    }) : null;

    // Multi-wallet background sync (only when > 1 wallet)
    if (!isLocked && wallets.length > 1) {
      const cleanup = startInterval();

      return () => {
        cleanup?.();
        stopInterval();
        appStateSubscription?.remove();
      };
    } else {
      stopInterval();
    }

    return () => {
      stopInterval();
      appStateSubscription?.remove();
    };
  }, [isLocked, wallets.length, activeWalletId]);

  return { syncInactiveWallets, ensureConnectionHealth };
}
