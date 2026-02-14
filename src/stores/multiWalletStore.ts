/**
 * Multi-Wallet Store — DB-backed
 *
 * Uses SQLite `wallets` table as the source of truth.
 * Zustand provides in-memory reactivity for React components.
 * On app start, `loadMultiWalletFromDB()` hydrates state from the database.
 * One-time migration from AsyncStorage (legacy) if DB has no wallets matching.
 *
 * Wallet list, active wallet, sync status — all derived from DB.
 * The `app_config` table stores `activeWalletId` (a single string key).
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { WalletDatabase } from '../services/database';
import type { WalletRow } from '../services/database';

// ============================================
// TYPES
// ============================================

export type WalletType =
  | 'hd'                  // BIP39 mnemonic HD wallet
  | 'imported_key'        // Single imported private key
  | 'imported_keys'       // Multiple imported keys (dumpwallet)
  | 'hd_xprv'            // Imported from extended private key
  | 'hd_seed'            // Imported from raw seed bytes
  | 'hd_descriptor'      // Imported from descriptor set
  | 'hd_electrum'        // Imported from Electrum seed/file
  | 'watch_xpub'         // Watch-only from xpub
  | 'watch_descriptor'   // Watch-only from descriptor
  | 'watch_addresses'    // Watch-only from address list
  | 'multisig';          // Multisig vault
export type SyncStatus = 'synced' | 'syncing' | 'not_synced' | 'error';

export interface WalletInfo {
  id: string;
  name: string;
  type: WalletType;
  createdAt: number;
  syncStatus: SyncStatus;
  syncError?: string;
  lastSyncedAt: number | null;
  balanceSat: number;
  unconfirmedSat: number;
}

interface MultiWalletState {
  // Core state
  wallets: WalletInfo[];
  activeWalletId: string | null;
  isInitialized: boolean;

  // Computed (for convenience)
  getActiveWallet: () => WalletInfo | null;
  getWallet: (id: string) => WalletInfo | undefined;
  hasMultipleWallets: () => boolean;

  // Actions
  initialize: () => Promise<void>;
  addWallet: (wallet: Omit<WalletInfo, 'id' | 'createdAt' | 'syncStatus' | 'lastSyncedAt' | 'balanceSat' | 'unconfirmedSat'> & { id?: string }) => Promise<WalletInfo>;
  removeWallet: (id: string) => Promise<void>;
  setActiveWallet: (id: string) => Promise<void>;
  renameWallet: (id: string, name: string) => Promise<void>;

  // Sync management
  updateWalletSync: (id: string, status: SyncStatus, balance?: number, unconfirmed?: number, error?: string) => void;
  updateWalletBalance: (id: string, balanceSat: number, unconfirmedSat?: number) => void;

  // Migration support
  setWallets: (wallets: WalletInfo[]) => void;
}

// ── Helper: convert DB WalletRow → WalletInfo ────────────────────────

function walletRowToInfo(row: WalletRow, syncStatus?: SyncStatus, syncError?: string, lastSyncedAt?: number | null): WalletInfo {
  return {
    id: row.walletId,
    name: row.name,
    type: row.walletType as WalletType,
    createdAt: row.createdAt,
    syncStatus: syncStatus ?? 'not_synced',
    syncError,
    lastSyncedAt: lastSyncedAt ?? null,
    balanceSat: row.confirmedBalanceSat + row.unconfirmedBalanceSat,
    unconfirmedSat: row.unconfirmedBalanceSat,
  };
}

// ============================================
// STORE IMPLEMENTATION
// ============================================

export const useMultiWalletStore = create<MultiWalletState>()(
  (set, get) => ({
    // Initial state
    wallets: [],
    activeWalletId: null,
    isInitialized: false,

    // Computed getters
    getActiveWallet: () => {
      const { wallets, activeWalletId } = get();
      if (!activeWalletId) return null;
      return wallets.find((w) => w.id === activeWalletId) || null;
    },

    getWallet: (id: string) => {
      return get().wallets.find((w) => w.id === id);
    },

    hasMultipleWallets: () => {
      return get().wallets.length > 1;
    },

    // Initialize store
    initialize: async () => {
      // Mark as initialized - actual migration happens in WalletMigration.ts
      set({ isInitialized: true });
    },

    // Add a new wallet — note: the actual DB insert happens in WalletManager/creation flow
    // This updates the in-memory Zustand list to match what's in DB
    addWallet: async (walletData) => {
      const now = Date.now();
      const newWallet: WalletInfo = {
        id: walletData.id || uuidv4(),
        name: walletData.name,
        type: walletData.type,
        createdAt: now,
        syncStatus: 'not_synced',
        lastSyncedAt: null,
        balanceSat: 0,
        unconfirmedSat: 0,
      };

      set((state) => {
        const wallets = [...state.wallets, newWallet];
        // If this is the first wallet, make it active
        const activeWalletId = state.wallets.length === 0 ? newWallet.id : state.activeWalletId;
        // Persist active wallet ID to DB
        _saveActiveWalletId(activeWalletId);
        return { wallets, activeWalletId };
      });

      // Trigger continuous archival after wallet add
      try {
        const { ContinuousArchivalManager } = require('../services/storage/ContinuousArchivalManager');
        ContinuousArchivalManager.triggerIfNeeded();
      } catch { /* non-critical */ }

      return newWallet;
    },

    // Remove a wallet
    removeWallet: async (id: string) => {
      set((state) => {
        const wallets = state.wallets.filter((w) => w.id !== id);
        let activeWalletId = state.activeWalletId;

        // If we're removing the active wallet, select the first remaining one
        if (state.activeWalletId === id) {
          activeWalletId = wallets.length > 0 ? wallets[0].id : null;
        }

        // Persist active wallet ID to DB
        _saveActiveWalletId(activeWalletId);
        return { wallets, activeWalletId };
      });

      // Trigger continuous archival after wallet remove
      try {
        const { ContinuousArchivalManager } = require('../services/storage/ContinuousArchivalManager');
        ContinuousArchivalManager.triggerIfNeeded();
      } catch { /* non-critical */ }
    },

    // Set active wallet
    setActiveWallet: async (id: string) => {
      const wallet = get().wallets.find((w) => w.id === id);
      if (!wallet) {
        return;
      }

      set({ activeWalletId: id });
      _saveActiveWalletId(id);
    },

    // Rename a wallet
    renameWallet: async (id: string, name: string) => {
      // Write to DB first
      try {
        const db = WalletDatabase.shared();
        db.updateWallet(id, { name });
      } catch { /* DB not ready */ }

      set((state) => ({
        wallets: state.wallets.map((w) =>
          w.id === id ? { ...w, name } : w
        ),
      }));
    },

    // Update wallet sync status — only remaps the changed wallet, not the entire array
    updateWalletSync: (id: string, status: SyncStatus, balance?: number, unconfirmed?: number, error?: string) => {
      set((state) => {
        const idx = state.wallets.findIndex(w => w.id === id);
        if (idx === -1) return state;
        const w = state.wallets[idx];
        const updated = {
          ...w,
          syncStatus: status,
          syncError: error,
          lastSyncedAt: status === 'synced' ? Date.now() : w.lastSyncedAt,
          balanceSat: balance !== undefined ? balance : w.balanceSat,
          unconfirmedSat: unconfirmed !== undefined ? unconfirmed : w.unconfirmedSat,
        };
        // Shallow compare: skip setState if nothing changed
        if (updated.syncStatus === w.syncStatus && updated.balanceSat === w.balanceSat &&
            updated.unconfirmedSat === w.unconfirmedSat && updated.lastSyncedAt === w.lastSyncedAt &&
            updated.syncError === w.syncError) return state;
        const wallets = [...state.wallets];
        wallets[idx] = updated;
        return { wallets };
      });
    },

    // Update wallet balance only — only remaps the changed wallet
    updateWalletBalance: (id: string, balanceSat: number, unconfirmedSat?: number) => {
      set((state) => {
        const idx = state.wallets.findIndex(w => w.id === id);
        if (idx === -1) return state;
        const w = state.wallets[idx];
        const newUnconfirmed = unconfirmedSat !== undefined ? unconfirmedSat : w.unconfirmedSat;
        // Skip if nothing changed
        if (w.balanceSat === balanceSat && w.unconfirmedSat === newUnconfirmed) return state;
        const wallets = [...state.wallets];
        wallets[idx] = { ...w, balanceSat, unconfirmedSat: newUnconfirmed };
        return { wallets };
      });
    },

    // For migration: set wallets directly
    setWallets: (wallets: WalletInfo[]) => {
      set({ wallets });
    },
  })
);

// ── Persist active wallet ID to DB ───────────────────────────────────

function _saveActiveWalletId(id: string | null): void {
  try {
    const db = WalletDatabase.shared();
    if (id) {
      db.setConfig('activeWalletId', id);
    } else {
      db.deleteConfig('activeWalletId');
    }
  } catch {
    // DB not ready — that's OK
  }
}

// ── Load from DB: hydrate Zustand from SQLite ────────────────────────

let _multiWalletLoaded = false;

export function loadMultiWalletFromDB(): boolean {
  if (_multiWalletLoaded) return true;

  try {
    const db = WalletDatabase.shared();
    const walletRows = db.getAllWallets();

    if (walletRows.length > 0) {
      // Build wallet info from DB rows + sync_state
      const wallets: WalletInfo[] = walletRows.map((row) => {
        // Read sync state for this wallet
        let syncStatus: SyncStatus = 'not_synced';
        let syncError: string | undefined;
        let lastSyncedAt: number | null = null;
        try {
          const syncRow = db.getSyncState(row.walletId);
          if (syncRow) {
            syncStatus = syncRow.status as SyncStatus;
            syncError = syncRow.lastError ?? undefined;
            lastSyncedAt = syncRow.lastSuccessfulSyncAt;
          }
        } catch {
          // sync_state might not exist yet
        }
        return walletRowToInfo(row, syncStatus, syncError, lastSyncedAt);
      });

      // Read active wallet ID
      const activeWalletId = db.getConfig('activeWalletId') ?? wallets[0]?.id ?? null;

      useMultiWalletStore.setState({ wallets, activeWalletId, isInitialized: true });
      _multiWalletLoaded = true;
      return true;
    }

    // No wallets in DB — try one-time migration from AsyncStorage
    _migrateMultiWalletFromAsyncStorage();
    return true;
  } catch {
    // DB not ready
    return false;
  }
}

// ── One-time migration from AsyncStorage ─────────────────────────────

async function _migrateMultiWalletFromAsyncStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('multi-wallet-storage');
    if (!raw) {
      _multiWalletLoaded = true;
      return; // Fresh install
    }

    const parsed = JSON.parse(raw);
    const legacyState = parsed?.state ?? parsed;
    const wallets: WalletInfo[] = legacyState?.wallets ?? [];
    const activeWalletId: string | null = legacyState?.activeWalletId ?? null;

    if (wallets.length > 0) {
      // Save active wallet ID to DB
      if (activeWalletId) {
        try {
          const db = WalletDatabase.shared();
          db.setConfig('activeWalletId', activeWalletId);
        } catch { /* DB not ready */ }
      }

      useMultiWalletStore.setState({ wallets, activeWalletId, isInitialized: true });
    }

    _multiWalletLoaded = true;

    // Clean up AsyncStorage (non-blocking)
    AsyncStorage.removeItem('multi-wallet-storage').catch(() => {});
  } catch {
    _multiWalletLoaded = true;
  }
}

// ── Unique wallet name helper ─────────────────────────────────────────

/**
 * Generate a unique wallet name by checking against existing wallet names.
 * If the base name already exists, appends " 2", " 3", etc.
 * Optionally excludes a wallet ID from the check (useful for rename).
 */
export function getUniqueWalletName(baseName: string, excludeWalletId?: string): string {
  const wallets = useMultiWalletStore.getState().wallets;
  const existingNames = new Set(
    wallets
      .filter(w => !excludeWalletId || w.id !== excludeWalletId)
      .map(w => w.name.toLowerCase())
  );

  // If the base name is available, use it
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  // Strip any trailing number from the base name for cleaner incrementing
  const stripped = baseName.replace(/\s+\d+$/, '');
  let counter = 2;
  while (existingNames.has(`${stripped} ${counter}`.toLowerCase())) {
    counter++;
  }
  return `${stripped} ${counter}`;
}

/**
 * Check whether a wallet name is already taken.
 * Optionally excludes a wallet ID from the check (useful for rename).
 */
export function isWalletNameTaken(name: string, excludeWalletId?: string): boolean {
  const wallets = useMultiWalletStore.getState().wallets;
  return wallets.some(
    w => w.name.toLowerCase() === name.toLowerCase() && (!excludeWalletId || w.id !== excludeWalletId)
  );
}

/** Reset the loaded flag (for testing or full app reset) */
export function resetMultiWalletLoaded(): void {
  _multiWalletLoaded = false;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a display label for wallet type
 */
export function getWalletTypeLabel(type: WalletType): string | null {
  switch (type) {
    case 'watch_xpub':
    case 'watch_descriptor':
    case 'watch_addresses':
      return 'Watch-only';
    case 'multisig':
      return 'Multisig';
    case 'hd':
    default:
      return null; // No badge for standard HD wallets
  }
}

/**
 * Get sync status display info
 */
export function getSyncStatusInfo(status: SyncStatus): { label: string; color: string } {
  switch (status) {
    case 'synced':
      return { label: 'Synced', color: '#30D158' };
    case 'syncing':
      return { label: 'Syncing...', color: '#FFD60A' };
    case 'error':
      return { label: 'Error', color: '#FF453A' };
    case 'not_synced':
    default:
      return { label: 'Not synced', color: '#8E8E93' };
  }
}

/**
 * Format relative time for last sync
 */
export function formatLastSyncTime(timestamp: number | null): string {
  if (!timestamp) return '';

  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 60) return 'a moment ago';
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins}m ago`;
  }
  if (diff < 86400) {
    const hrs = Math.floor(diff / 3600);
    return `${hrs}h ago`;
  }
  const days = Math.floor(diff / 86400);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
