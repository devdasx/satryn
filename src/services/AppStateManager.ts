/**
 * AppStateManager — Centralized app state lifecycle manager.
 *
 * Single source of truth for:
 *  - isLoggedIn()        — whether a wallet exists and is unlocked
 *  - hasWallet()         — whether a wallet exists at all
 *  - resetAll()          — nuclear reset of ALL stores + SecureStorage + AsyncStorage + caches
 *  - assembleFullState() — gather everything for iCloud backup
 *  - restoreFullState()  — restore from an expanded backup payload
 *
 * This is a static service module, NOT a Zustand store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { File, Directory, Paths } from 'expo-file-system';
import { SecureStorage } from './storage/SecureStorage';
import { CacheManager } from './cache/CacheManager';
import { SensitiveSession } from './auth/SensitiveSession';
import { MarketAPI } from './api/MarketAPI';
import { BackupService, type BackupPayload } from './backup/BackupService';
import { CanonicalSnapshotBuilder } from './storage/CanonicalSnapshotBuilder';
import { PreservedArchiveService } from './storage/PreservedArchiveService';
import { PreserveDataSession } from './auth/PreserveDataSession';
import { ElectrumAPI } from './electrum/ElectrumAPI';
import { WalletDatabase } from './database/WalletDatabase';
import ElectrumPool from './electrum/ElectrumPool';
import { WalletEngine } from './sync/WalletEngine';
import { ServerCacheManager } from './electrum/ServerCacheManager';
import { BinanceWebSocket } from './api/BinanceWebSocket';
import { ICloudService } from './backup/iCloudService';
import type { CanonicalWalletSnapshot } from './sync/types';
import { useWalletStore } from '../stores/walletStore';
import { useSettingsStore, resetSettingsLoaded } from '../stores/settingsStore';
import { useMultiWalletStore, resetMultiWalletLoaded } from '../stores/multiWalletStore';
import { useContactStore } from '../stores/contactStore';
import { useContactStatsStore } from '../stores/contactStatsStore';
import { usePriceStore } from '../stores/priceStore';
import { useUTXOStore } from '../stores/utxoStore';
import { useTransactionLabelStore } from '../stores/transactionLabelStore';
import { useAccountRegistryStore, resetAccountRegistryLoaded } from '../stores/accountRegistryStore';
import { useAddressBookStore, resetAddressBookLoaded } from '../stores/addressBookStore';
import { useSyncStore } from '../stores/syncStore';
import { useDeepLinkStore } from '../stores/deepLinkStore';
import { ADDRESS_TYPES } from '../constants';
import type { Contact } from '../types/contacts';
import type { CustomElectrumServer, ThemePreference } from '../types';

// ============================================
// TYPES
// ============================================

/** Settings snapshot for backup (serializable, no functions) */
export interface BackupSettings {
  denomination?: string; // BitcoinUnit — kept as string for backward-compatible backup parsing
  currency?: string;
  autoLockTimeout?: number;
  biometricsEnabled?: boolean;
  hapticsEnabled?: boolean;
  theme?: ThemePreference;
  feePreference?: string;
  customFeeRate?: number;
  customElectrumServer?: CustomElectrumServer | null;
  useCustomElectrum?: boolean;
  defaultCurrencyDisplay?: string;
  gapLimit?: number;
  walletMode?: string;
  walletName?: string;
  // Backup & preservation
  preserveDataOnDelete?: boolean;
  iCloudBackupEnabled?: boolean;
  autoBackupEnabled?: boolean;
  // Privacy & analytics
  analyticsEnabled?: boolean;
  inAppAlertsEnabled?: boolean;
  // Nearby
  nearbyNickname?: string;
  // Fee caps (021 Enhancement Pack)
  maxFeeRateSatPerVb?: number | null;
  maxFeeTotalSats?: number | null;
  feeCapRequireConfirmation?: boolean;
  defaultFeeTier?: string;
  rememberLastFeeTier?: boolean;
  defaultCustomFeeRate?: number | null;
  // Privacy send preferences
  privacyModeDefault?: boolean;
  avoidConsolidation?: boolean;
  preferSingleInput?: boolean;
  avoidUnconfirmedDefault?: string;
  // Large amount thresholds
  largeAmountWarningPct?: number;
  largeAmountConfirmPct?: number;
  // Tag presets
  tagPresets?: string[];
}

/** Expanded full backup payload — includes all app state */
export interface ExpandedFullBackupPayload {
  type: 'full_backup';
  version: number;
  backupName: string;
  backupDate: number;
  wallets: BackupPayload[];
  /** Canonical wallet snapshots — chain state + user metadata (v3+) */
  walletSnapshots?: CanonicalWalletSnapshot[];
  contacts?: Contact[];
  settings?: BackupSettings;
  /** Legacy tx labels — kept for backward compat with v2 backups */
  transactionLabels?: Record<string, unknown>;
  /** Legacy UTXO metadata — kept for backward compat with v2 backups */
  utxoMetadata?: Record<string, unknown>;
  /** Whether the payload was gzip compressed before encryption */
  compressed?: boolean;
}

// ============================================
// CONSTANTS
// ============================================

/** Every AsyncStorage key that must be removed on full reset */
const ALL_ASYNC_KEYS = [
  // Zustand persisted stores
  'wallet-storage',
  'multi-wallet-storage',
  'settings-storage',
  'utxo-metadata-storage',
  'price-storage',
  'account-registry-storage',
  'contacts-storage',
  'transaction-labels',
  'address-book-storage',
  // Migration flags
  'multi_wallet_migration_v2_complete',
  // Market API caches
  'market_data_cache',
  'chart_data_cache',
  // PIN policy / lockout
  'pin_policy',
  'pin_failed_attempts',
  'pin_lockout_until',
  // NOTE: 'electrum_server_ccache' is intentionally NOT listed here.
  // Server reputation data must survive wallet resets and logouts.
] as const;

/** Initial address indices (matching walletStore) */
const INITIAL_ADDRESS_INDICES = {
  native_segwit: { receiving: 0, change: 0 },
  wrapped_segwit: { receiving: 0, change: 0 },
  legacy: { receiving: 0, change: 0 },
  taproot: { receiving: 0, change: 0 },
};

// ============================================
// APP STATE MANAGER
// ============================================

export class AppStateManager {
  // ------------------------------------------
  // AUTH QUERIES
  // ------------------------------------------

  /**
   * Whether the app has a wallet and the user is unlocked.
   * For non-React contexts (services, deep link handlers).
   */
  static isLoggedIn(): boolean {
    const { walletId, isLocked, isInitialized } = useWalletStore.getState();
    return isInitialized && walletId !== null && !isLocked;
  }

  /**
   * Whether a wallet exists at all (even if locked).
   */
  static hasWallet(): boolean {
    const { walletId, isInitialized } = useWalletStore.getState();
    return isInitialized && walletId !== null;
  }

  // ------------------------------------------
  // NUCLEAR RESET
  // ------------------------------------------

  /** Global reset mutex — prevents concurrent saves during reset */
  private static resetInProgress = false;

  /** Check if a reset is currently in progress (for write guards) */
  static isResetting(): boolean {
    return this.resetInProgress;
  }

  /**
   * Complete reset: wipes ALL wallet data and returns app to fresh-install state.
   *
   * Ordering (critical):
   *  1. Stop writers first (Electrum, sync, timers)
   *  2. Delete files before clearing stores (prevents ghost re-creation)
   *  3. Clear Keychain before AsyncStorage (seeds more sensitive)
   *  4. Reset in-memory state LAST (triggers UI routing)
   *
   * Each step is wrapped in try/catch — failures logged but don't abort reset.
   */
  static async resetWalletToFreshInstall(options: {
    pin?: string;
    deleteCloudBackups?: boolean;
  } = {}): Promise<void> {
    const { pin, deleteCloudBackups = false } = options;

    // Step 0: Global reset mutex
    if (this.resetInProgress) {
      throw new Error('Reset already in progress');
    }
    this.resetInProgress = true;

    try {
      const resetStart = Date.now();
      const logStep = (step: string, startMs: number) => {
      };

      // Step 1: Stop all sync & networking
      let stepStart = Date.now();
      await this.stopAllSyncAndNetworking();
      logStep('Step 1 (stop networking)', stepStart);

      // Collect wallet IDs before clearing stores
      const walletIds = useMultiWalletStore.getState().wallets.map(w => w.id);

      // Step 2: Preserve-on-delete — archive ONLY if not already archived recently.
      // ContinuousArchivalManager keeps archives up-to-date in the background,
      // so we only need to re-archive if the manifest is missing or stale (>5 min).
      // This avoids redundant archival per wallet during reset.
      stepStart = Date.now();
      const preservePassword = PreserveDataSession.getPassword();
      if (preservePassword && useSettingsStore.getState().preserveDataOnDelete) {
        try {
          const manifest = await PreservedArchiveService.readManifest();
          const manifestAge = manifest ? Date.now() - manifest.preservedAt : Infinity;
          const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

          if (!manifest || manifestAge > STALE_THRESHOLD) {
            await PreservedArchiveService.archiveFullState(preservePassword);
          } else {
          }
        } catch (e) {
        }
      } else {
      }
      logStep('Step 2 (preserve-on-delete)', stepStart);

      // Step 3a: Clear all database rows
      stepStart = Date.now();
      try {
        WalletDatabase.shared().resetAllData();
      } catch (e) {
      }
      logStep('Step 3a (clear DB rows)', stepStart);

      // Step 3a-ii: Close connection + delete SQLite file (non-fatal if file delete fails)
      stepStart = Date.now();
      try {
        WalletDatabase.deleteDatabase();
      } catch (e) {
      }
      logStep('Step 3a-ii (delete DB file)', stepStart);

      // Step 3b: Delete wallet files & directories
      stepStart = Date.now();
      this.deleteWalletDirectoriesAndFiles();
      logStep('Step 3b (delete wallet files)', stepStart);

      // Step 4: Clear SecureStore / Keychain
      stepStart = Date.now();
      await this.clearSecureStoreWalletKeys(walletIds);
      logStep('Step 4 (clear SecureStore)', stepStart);

      // Step 5: Clear AsyncStorage
      stepStart = Date.now();
      await this.clearPersistentStores(walletIds);
      logStep('Step 5 (clear AsyncStorage)', stepStart);

      // Step 6: Optional iCloud backup deletion
      if (deleteCloudBackups) {
        stepStart = Date.now();
        this.deleteAllCloudBackups(walletIds);
        logStep('Step 6 (delete iCloud backups)', stepStart);
      }

      // Step 7: Clear in-memory state
      stepStart = Date.now();
      this.clearInMemoryState();
      logStep('Step 7 (clear in-memory)', stepStart);

      // Step 8: Verify fresh-install state
      stepStart = Date.now();
      const verifyResult = this.verifyFreshInstallState();
      if (!verifyResult.ok) {
      }
      logStep('Step 8 (verify fresh state)', stepStart);

    } finally {
      this.resetInProgress = false;
    }
  }

  /**
   * @deprecated Use resetWalletToFreshInstall() — this thin wrapper exists for backward compat.
   */
  static async resetAll(pin?: string): Promise<void> {
    return this.resetWalletToFreshInstall({ pin });
  }

  // ------------------------------------------
  // RESET HELPERS (private)
  // ------------------------------------------

  /** Step 1: Disconnect Electrum, stop sync, cancel timers */
  private static async stopAllSyncAndNetworking(): Promise<void> {

    // Disconnect Electrum API (all networks) — stops client + pool
    try { ElectrumAPI.disconnectAll(); } catch (e) {
    }

    // Shutdown Electrum pool (all networks) — stops health check timers
    try { ElectrumPool.shutdownAll(); } catch (e) {
    }

    // Cancel WalletEngine active syncs + clear loaded wallet cache
    try { WalletEngine.shared().clearAll(); } catch (e) {
    }

    // Force disconnect BinanceWebSocket (price feed)
    try { BinanceWebSocket.forceDisconnect(); } catch {}

    // Brief delay to let in-flight callbacks settle
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  /** Step 3: Delete the entire wallets/ directory and all its files */
  private static deleteWalletDirectoriesAndFiles(): void {
    try {
      const walletsDir = new Directory(Paths.document, 'wallets');
      if (walletsDir.exists) {
        // Delete all files in directory first (defensive)
        try {
          for (const entry of walletsDir.list()) {
            try { if (entry instanceof File) entry.delete(); } catch {}
          }
        } catch {}

        // Delete the directory itself
        try { walletsDir.delete(); } catch (e) {
        }
      }
    } catch (e) {
    }
  }

  /** Step 4: Clear all Keychain/SecureStore wallet keys */
  private static async clearSecureStoreWalletKeys(walletIds: string[]): Promise<void> {
    let t = Date.now();

    // Delete all legacy single-wallet keys + PIN + biometric
    try { await SecureStorage.deleteWallet(); } catch (e) {
    }

    // Delete per-wallet encrypted data (seeds, xprvs, descriptors, etc.)
    try { await SecureStorage.deleteAllWalletData(walletIds); } catch (e) {
    }

    // Delete local cosigner seeds (indices 0-14)
    try { await SecureStorage.clearLocalCosignerSeeds(); } catch (e) {
    }

    // Delete preserved archives (if NOT preserving)
    if (!useSettingsStore.getState().preserveDataOnDelete) {
      try { await PreservedArchiveService.deleteAllArchives(); } catch {}
    }

    // Clear preserve_data_on_delete flag
    try {
      await SecureStore.deleteItemAsync('preserve_data_on_delete', {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {}
  }

  /** Step 5: Clear all AsyncStorage keys (static + per-wallet dynamic) */
  private static async clearPersistentStores(walletIds: string[]): Promise<void> {

    // Per-wallet dynamic keys
    const perWalletKeys: string[] = [];
    for (const id of walletIds) {
      perWalletKeys.push(
        `wallet_cache_${id}`, `wallet_data_${id}`, `wallet_avatar_id_${id}`,
        `address_stats_cache_${id}`, `addr_cache_${id}`, `tx_cache_${id}`,
      );
    }

    // CacheManager per-wallet caches
    for (const id of walletIds) {
      try { await CacheManager.clearWalletCaches(id); } catch {}
    }

    // Remove all static + dynamic keys
    const allKeys = [...ALL_ASYNC_KEYS, ...perWalletKeys];
    try {
      await AsyncStorage.multiRemove(allKeys);
    } catch {
      // Fallback: remove one by one
      for (const key of allKeys) {
        try { await AsyncStorage.removeItem(key); } catch {}
      }
    }
  }

  /** Step 6 (optional): Delete iCloud backups for all wallets */
  private static deleteAllCloudBackups(walletIds: string[]): void {
    try {
      // Delete per-wallet backups
      for (const walletId of walletIds) {
        try { ICloudService.deleteBackup(walletId); } catch {}
      }

      // Delete full backups
      try {
        const fullBackups = ICloudService.listFullBackups();
        for (const backup of fullBackups) {
          try { ICloudService.deleteFullBackup(backup.backupId); } catch {}
        }
      } catch {}

      // Clear backup history from settings
      useSettingsStore.getState().clearICloudBackupHistory();
    } catch (e) {
    }
  }

  /** Step 7: Clear all in-memory state (stores, caches, sessions, singletons) */
  private static clearInMemoryState(): void {

    // Invalidate PIN session
    SensitiveSession.invalidate();

    // Clear API caches (Electrum caches cleared via disconnectAll in step 1)
    try { MarketAPI.clearCache(); } catch {}

    // Clear WalletEngine
    try { WalletEngine.shared().clearAll(); } catch {}

    // Reset ServerCacheManager in-memory records
    try { ServerCacheManager.shared().reset(); } catch {}

    // Reset persisted Zustand stores
    useMultiWalletStore.getState().setWallets([]);
    useMultiWalletStore.setState({ activeWalletId: null, isInitialized: false });
    useSettingsStore.getState().resetToDefaults();
    useContactStore.setState({ contacts: [], _initialized: false });
    useTransactionLabelStore.setState({ labels: {} });
    useUTXOStore.setState({ utxoMetadata: {} });
    useAddressBookStore.setState({ entries: [] });
    useAccountRegistryStore.setState({ accounts: [], activeAccountId: null });

    // Reset DB-loaded flags so stores re-hydrate from DB on next app start
    resetSettingsLoaded();
    resetMultiWalletLoaded();
    resetAddressBookLoaded();
    resetAccountRegistryLoaded();
    usePriceStore.setState({
      price: null,
      currency: 'USD',
      change24h: 0,
      lastUpdated: null,
      isLoading: false,
      error: null,
      lastFetched: null,
    });

    // Reset ephemeral stores
    try { useContactStatsStore.getState().clearStats(); } catch {}
    try { useSyncStore.getState().resetSyncState(); } catch {}
    try { useDeepLinkStore.getState().clearPending(); } catch {}
    // Reset wallet store LAST — triggers routing to onboarding
    useWalletStore.setState({
      isInitialized: true,
      isLocked: false, // false = routes to onboarding, not lock screen
      walletId: null,
      addresses: [],
      balance: { confirmed: 0, unconfirmed: 0, total: 0 },
      utxos: [],
      lastSync: null,
      addressIndices: { ...INITIAL_ADDRESS_INDICES },
      preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
      trackedTransactions: new Map(),
      usedAddresses: new Set(),
      transactions: [],
      isMultisig: false,
      multisigConfig: null,
      network: 'mainnet',
      error: null,
      isLoading: false,
      isRefreshing: false,
    });
  }

  /** Step 8: Verify that the app is in a fresh-install state */
  private static verifyFreshInstallState(): { ok: boolean; failures: string[] } {
    const failures: string[] = [];

    // wallets/ directory should not exist (or be empty)
    try {
      const walletsDir = new Directory(Paths.document, 'wallets');
      if (walletsDir.exists) {
        const entries = walletsDir.list();
        if (entries.length > 0) {
          failures.push(`wallets/ still has ${entries.length} file(s)`);
        }
      }
    } catch {}

    // walletId should be null
    if (useWalletStore.getState().walletId !== null) {
      failures.push('walletId is not null');
    }

    // multiWalletStore should be empty
    if (useMultiWalletStore.getState().wallets.length > 0) {
      failures.push('multiWalletStore still has wallets');
    }

    return { ok: failures.length === 0, failures };
  }

  // ------------------------------------------
  // FULL STATE BACKUP
  // ------------------------------------------

  /**
   * Assemble the complete app state for an iCloud backup.
   * Includes wallets, contacts, settings, tx labels, UTXO metadata, pending txs.
   */
  /** Yield to the event loop so React can update the UI (spinner, progress). */
  private static yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  static async assembleFullState(
    pin: string,
    backupName: string,
  ): Promise<ExpandedFullBackupPayload | null> {
    const store = useMultiWalletStore.getState();
    const wallets = store.wallets;
    if (wallets.length === 0) {
      console.warn('[AppStateManager] assembleFullState: no wallets found');
      return null;
    }

    // Assemble wallet payloads
    const payloads: BackupPayload[] = [];
    for (const wallet of wallets) {
      try {
        const payload = await BackupService.assemblePayload(wallet.id, pin);
        if (payload) payloads.push(payload);
        else console.warn(`[AppStateManager] assemblePayload returned null for wallet ${wallet.id}`);
      } catch (e: any) {
        console.error(`[AppStateManager] assemblePayload failed for wallet ${wallet.id}:`, e?.message);
      }
      // Yield to UI between wallet assembly calls
      await this.yieldToUI();
    }
    if (payloads.length === 0) {
      console.warn('[AppStateManager] assembleFullState: all wallet payloads failed');
      return null;
    }

    // Gather contacts
    const contacts = useContactStore.getState().contacts;

    // Snapshot settings (exclude functions and ephemeral fields)
    const s = useSettingsStore.getState();
    const settings: BackupSettings = {
      denomination: s.denomination,
      currency: s.currency,
      autoLockTimeout: s.autoLockTimeout,
      biometricsEnabled: s.biometricsEnabled,
      hapticsEnabled: s.hapticsEnabled,
      theme: s.theme,
      feePreference: s.feePreference,
      customFeeRate: s.customFeeRate,
      customElectrumServer: s.customElectrumServer,
      useCustomElectrum: s.useCustomElectrum,
      defaultCurrencyDisplay: s.defaultCurrencyDisplay,
      gapLimit: s.gapLimit,
      walletMode: s.walletMode,
      walletName: s.walletName,
      preserveDataOnDelete: s.preserveDataOnDelete,
      iCloudBackupEnabled: s.iCloudBackupEnabled,
      autoBackupEnabled: s.autoBackupEnabled,
      analyticsEnabled: s.analyticsEnabled,
      inAppAlertsEnabled: s.inAppAlertsEnabled,
      nearbyNickname: s.nearbyNickname,
      maxFeeRateSatPerVb: s.maxFeeRateSatPerVb,
      maxFeeTotalSats: s.maxFeeTotalSats,
      feeCapRequireConfirmation: s.feeCapRequireConfirmation,
      defaultFeeTier: s.defaultFeeTier,
      rememberLastFeeTier: s.rememberLastFeeTier,
      defaultCustomFeeRate: s.defaultCustomFeeRate,
      privacyModeDefault: s.privacyModeDefault,
      avoidConsolidation: s.avoidConsolidation,
      preferSingleInput: s.preferSingleInput,
      avoidUnconfirmedDefault: s.avoidUnconfirmedDefault,
      largeAmountWarningPct: s.largeAmountWarningPct,
      largeAmountConfirmPct: s.largeAmountConfirmPct,
      tagPresets: s.tagPresets,
    };

    // Gather tx labels
    const txLabels = useTransactionLabelStore.getState().labels;

    // Gather UTXO metadata
    const utxoMeta = useUTXOStore.getState().utxoMetadata;

    // Build canonical snapshots for each wallet (from DB)
    // Yield to UI between wallets so the spinner/progress stays responsive.
    const walletSnapshots: CanonicalWalletSnapshot[] = [];
    for (const wallet of wallets) {
      try {
        // Yield before each heavy synchronous DB read
        await this.yieldToUI();
        const snapshot = CanonicalSnapshotBuilder.extractFromDatabase(wallet.id);
        if (snapshot) {
          const trimmed = CanonicalSnapshotBuilder.trimForBackup(snapshot);
          walletSnapshots.push(trimmed);
        }
      } catch (e: any) {
        console.error(`[AppStateManager] extractFromDatabase failed for wallet ${wallet.id}:`, e?.message);
        // Best effort — continue with other wallets
      }
    }

    return {
      type: 'full_backup',
      version: 3,
      backupName,
      backupDate: Date.now(),
      wallets: payloads,
      walletSnapshots: walletSnapshots.length > 0 ? walletSnapshots : undefined,
      contacts: contacts.length > 0 ? contacts : undefined,
      settings,
      // Keep legacy fields for backward compat
      transactionLabels: Object.keys(txLabels).length > 0 ? txLabels : undefined,
      utxoMetadata: Object.keys(utxoMeta).length > 0 ? utxoMeta : undefined,
    };
  }

  // ------------------------------------------
  // FULL STATE RESTORE
  // ------------------------------------------

  /**
   * Restore all app state from an expanded backup payload.
   * Backward compatible — v1 payloads only restore wallets + contacts.
   */
  static async restoreFullState(
    payload: ExpandedFullBackupPayload,
    pin: string,
  ): Promise<string[]> {
    // 1. Restore wallets via BackupService
    const restoredIds: string[] = [];
    for (const walletPayload of payload.wallets) {
      const walletId = await BackupService.restoreFromPayload(walletPayload, pin);
      if (walletId) restoredIds.push(walletId);
    }

    // 2. Restore contacts
    if (payload.contacts && payload.contacts.length > 0) {
      useContactStore.getState().importContacts(payload.contacts);
    }

    // 3. Restore settings (v2 only)
    if (payload.settings && (payload.version ?? 1) >= 2) {
      const s = payload.settings;
      const store = useSettingsStore.getState();
      if (s.denomination) {
        // Map legacy denomination values to new BitcoinUnit type
        const denomMap: Record<string, string> = { sats: 'sat', fiat: 'sat' };
        const mapped = denomMap[s.denomination] || s.denomination;
        const validUnits = ['btc', 'mbtc', 'ubtc', 'sat', 'cbtc', 'dbtc'];
        if (validUnits.includes(mapped)) store.setDenomination(mapped as any);
      }
      if (s.currency) store.setCurrency(s.currency);
      if (s.theme) store.setTheme(s.theme);
      if (s.feePreference) store.setFeePreference(s.feePreference as 'fast' | 'medium' | 'slow' | 'custom');
      if (s.customFeeRate !== undefined) store.setCustomFeeRate(s.customFeeRate);
      if (s.customElectrumServer !== undefined) store.setCustomElectrumServer(s.customElectrumServer);
      if (s.useCustomElectrum !== undefined) store.setUseCustomElectrum(s.useCustomElectrum);
      if (s.defaultCurrencyDisplay) store.setDefaultCurrencyDisplay(s.defaultCurrencyDisplay as any);
      if (s.gapLimit !== undefined) store.setGapLimit(s.gapLimit);
      if (s.walletMode) store.setWalletMode(s.walletMode as 'hd' | 'simple');
      if (s.walletName) store.setWalletName(s.walletName);
      if (s.hapticsEnabled !== undefined) store.setHapticsEnabled(s.hapticsEnabled);
      if (s.biometricsEnabled !== undefined) store.setBiometricsEnabled(s.biometricsEnabled);
      if (s.autoLockTimeout !== undefined) store.setAutoLockTimeout(s.autoLockTimeout);
      // Restore new settings fields
      if (s.preserveDataOnDelete !== undefined) store.setPreserveDataOnDelete(s.preserveDataOnDelete);
      if (s.iCloudBackupEnabled !== undefined) store.setICloudBackupEnabled(s.iCloudBackupEnabled);
      if (s.autoBackupEnabled !== undefined) store.setAutoBackupEnabled(s.autoBackupEnabled);
      if (s.analyticsEnabled !== undefined) store.setAnalyticsEnabled(s.analyticsEnabled);
      if (s.inAppAlertsEnabled !== undefined) store.setInAppAlertsEnabled(s.inAppAlertsEnabled);
      if (s.nearbyNickname !== undefined) store.setNearbyNickname(s.nearbyNickname);
      if (s.maxFeeRateSatPerVb !== undefined) store.setMaxFeeRateSatPerVb(s.maxFeeRateSatPerVb);
      if (s.maxFeeTotalSats !== undefined) store.setMaxFeeTotalSats(s.maxFeeTotalSats);
      if (s.feeCapRequireConfirmation !== undefined) store.setFeeCapRequireConfirmation(s.feeCapRequireConfirmation);
      if (s.defaultFeeTier) store.setDefaultFeeTier(s.defaultFeeTier as any);
      if (s.rememberLastFeeTier !== undefined) store.setRememberLastFeeTier(s.rememberLastFeeTier);
      if (s.defaultCustomFeeRate !== undefined) store.setDefaultCustomFeeRate(s.defaultCustomFeeRate);
      if (s.privacyModeDefault !== undefined) store.setPrivacyModeDefault(s.privacyModeDefault);
      if (s.avoidConsolidation !== undefined) store.setAvoidConsolidation(s.avoidConsolidation);
      if (s.preferSingleInput !== undefined) store.setPreferSingleInput(s.preferSingleInput);
      if (s.avoidUnconfirmedDefault) store.setAvoidUnconfirmedDefault(s.avoidUnconfirmedDefault as any);
      if (s.largeAmountWarningPct !== undefined) store.setLargeAmountWarningPct(s.largeAmountWarningPct);
      if (s.largeAmountConfirmPct !== undefined) store.setLargeAmountConfirmPct(s.largeAmountConfirmPct);
      if (s.tagPresets) store.setTagPresets(s.tagPresets);
    }

    // 4. Restore canonical wallet snapshots (v3+)
    //    Apply chain state, user metadata, address cache, etc. to the DB.
    //    This is the primary restore path for v3 payloads.
    if (payload.walletSnapshots && payload.walletSnapshots.length > 0) {
      for (const snapshot of payload.walletSnapshots) {
        try {
          // Find the matching restored wallet ID
          const matchedId = restoredIds.find(id => {
            const walletPayload = payload.wallets.find(w => w.walletId === snapshot.walletId);
            if (walletPayload) {
              const originalIndex = payload.wallets.indexOf(walletPayload);
              return restoredIds[originalIndex] === id;
            }
            return false;
          });

          const targetWalletId = matchedId || snapshot.walletId;
          // Apply snapshot data to DB via CanonicalSnapshotBuilder
          try {
            const snapshotForDb = { ...snapshot, walletId: targetWalletId };
            CanonicalSnapshotBuilder.applyToDatabase(snapshotForDb);
          } catch (e) {
          }
        } catch {
          // Best effort — continue with other snapshots
        }
      }
    }

    // 5. Restore legacy transaction labels (v2 fallback — only if no canonical snapshots)
    if (
      payload.transactionLabels &&
      (payload.version ?? 1) >= 2 &&
      (!payload.walletSnapshots || payload.walletSnapshots.length === 0)
    ) {
      useTransactionLabelStore.setState({ labels: payload.transactionLabels as Record<string, any> });
    }

    // 6. Restore legacy UTXO metadata (v2 fallback — only if no canonical snapshots)
    if (
      payload.utxoMetadata &&
      (payload.version ?? 1) >= 2 &&
      (!payload.walletSnapshots || payload.walletSnapshots.length === 0)
    ) {
      useUTXOStore.setState({ utxoMetadata: payload.utxoMetadata as Record<string, any> });
    }

    return restoredIds;
  }
}
