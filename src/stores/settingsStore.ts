/**
 * Settings Store — DB-backed
 *
 * Uses SQLite `app_config` table as the source of truth.
 * Zustand provides in-memory reactivity for React components.
 * On app start, `loadFromDB()` hydrates state from the database.
 * One-time migration from AsyncStorage (legacy) if DB has no settings yet.
 *
 * Write-through: every state change is debounced-written to DB.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { AppSettings, FeePreference, WalletMode, DefaultCurrencyDisplay, CustomElectrumServer, BitcoinUnit, ThemePreference } from '../types';
import { SECURITY, FORMATTING, DERIVATION } from '../constants';
import { WalletDatabase } from '../services/database';

type FeeOption = 'fast' | 'normal' | 'slow' | 'custom';

type UnconfirmedPolicy = 'confirmed_only' | 'allow_if_needed' | 'allow_always';

const PRESERVE_DATA_KEY = 'preserve_data_on_delete';

export interface BackupStatusInfo {
  isBackedUp: boolean;
  method: 'manual' | 'icloud' | null;
  lastBackupDate: number | null;
}

export interface ICloudBackupEntry {
  id: string;
  name: string;
  timestamp: number;
  walletCount: number;
  walletNames: string[];
}

interface SettingsState extends AppSettings {
  // Wallet name
  walletName: string;
  // Preserve wallet data when app is deleted
  preserveDataOnDelete: boolean;
  // Backup status per wallet
  backupStatus: Record<string, BackupStatusInfo>;
  // iCloud backup
  iCloudBackupEnabled: boolean;
  iCloudBackupHistory: ICloudBackupEntry[];
  // Auto backup (daily)
  autoBackupEnabled: boolean;
  autoBackupPassword: string | null;
  lastAutoBackupDate: number | null;
  // Rating prompt tracking
  ratingDismissedForever: boolean;
  ratingCompleted: boolean;
  totalUsageMs: number;
  lastSessionStart: number | null;
  ratingDismissCount: number;
  lastRatingDismissDate: number | null;
  // Privacy/Analytics
  analyticsEnabled: boolean;
  // In-App Alerts (black bar notifications)
  inAppAlertsEnabled: boolean;
  // Nearby nickname
  nearbyNickname: string;
  // Discreet Mode — hides balances and amounts across the app
  discreetMode: boolean;
  // Last input unit used in send flow (remembers fiat vs BTC unit choice)
  lastInputUnit: string | null;

  // ── 021 Enhancement Pack: Send Flow Preferences ──

  // Fee Caps (Feature 18)
  maxFeeRateSatPerVb: number | null;
  maxFeeTotalSats: number | null;
  feeCapRequireConfirmation: boolean;

  // Fee Presets (Feature 19)
  defaultFeeTier: FeeOption;
  rememberLastFeeTier: boolean;
  defaultCustomFeeRate: number | null;

  // Privacy (Feature 26–27)
  privacyModeDefault: boolean;
  avoidConsolidation: boolean;
  preferSingleInput: boolean;
  avoidUnconfirmedDefault: UnconfirmedPolicy;

  // Large Amount Thresholds (Feature 8)
  largeAmountWarningPct: number;
  largeAmountConfirmPct: number;

  // Tags (Feature 32)
  tagPresets: string[];

  // Actions
  setDenomination: (denomination: BitcoinUnit) => void;
  setCurrency: (currency: string) => void;
  setAutoLockTimeout: (timeout: number) => void;
  setBiometricsEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  // Network is always mainnet - no setter needed
  // New actions
  setFeePreference: (preference: FeePreference) => void;
  setCustomFeeRate: (rate: number) => void;
  setCustomElectrumServer: (server: CustomElectrumServer | null) => void;
  setUseCustomElectrum: (use: boolean) => void;
  setDefaultCurrencyDisplay: (display: DefaultCurrencyDisplay) => void;
  setGapLimit: (limit: number) => void;
  setWalletMode: (mode: WalletMode) => void;
  setWalletName: (name: string) => void;
  // Backup status actions
  markBackedUp: (walletId: string, method: 'manual' | 'icloud') => void;
  clearBackupStatus: (walletId: string) => void;
  getBackupStatus: (walletId: string) => BackupStatusInfo;
  // Data preservation
  setPreserveDataOnDelete: (enabled: boolean) => void;
  // iCloud backup actions
  setICloudBackupEnabled: (enabled: boolean) => void;
  addICloudBackup: (entry: ICloudBackupEntry) => void;
  removeICloudBackup: (id: string) => void;
  clearICloudBackupHistory: () => void;
  // Auto backup actions
  setAutoBackupEnabled: (enabled: boolean) => void;
  setAutoBackupPassword: (password: string | null) => void;
  setLastAutoBackupDate: (date: number | null) => void;
  // Rating actions
  setRatingDismissedForever: (dismissed: boolean) => void;
  setRatingCompleted: (completed: boolean) => void;
  addUsageTime: (ms: number) => void;
  startSession: () => void;
  setRatingDismissCount: (count: number) => void;
  setLastRatingDismissDate: (date: number | null) => void;
  // Privacy/Analytics actions
  setAnalyticsEnabled: (enabled: boolean) => void;
  // In-App Alerts actions
  setInAppAlertsEnabled: (enabled: boolean) => void;
  // Nearby nickname actions
  setNearbyNickname: (nickname: string) => void;
  // Discreet Mode
  setDiscreetMode: (enabled: boolean) => void;
  // Last input unit
  setLastInputUnit: (unit: string | null) => void;

  // 021 Enhancement Pack setters
  setMaxFeeRateSatPerVb: (rate: number | null) => void;
  setMaxFeeTotalSats: (sats: number | null) => void;
  setFeeCapRequireConfirmation: (require: boolean) => void;
  setDefaultFeeTier: (tier: FeeOption) => void;
  setRememberLastFeeTier: (remember: boolean) => void;
  setDefaultCustomFeeRate: (rate: number | null) => void;
  setPrivacyModeDefault: (enabled: boolean) => void;
  setAvoidConsolidation: (avoid: boolean) => void;
  setPreferSingleInput: (prefer: boolean) => void;
  setAvoidUnconfirmedDefault: (policy: UnconfirmedPolicy) => void;
  setLargeAmountWarningPct: (pct: number) => void;
  setLargeAmountConfirmPct: (pct: number) => void;
  setTagPresets: (presets: string[]) => void;

  resetToDefaults: () => void;
}

const DEFAULT_TAG_PRESETS = ['exchange', 'donation', 'income', 'savings', 'kyc', 'services'];

const defaultSettings = {
  network: 'mainnet' as const,
  denomination: 'sat' as BitcoinUnit,
  currency: FORMATTING.DEFAULT_CURRENCY,
  autoLockTimeout: SECURITY.DEFAULT_AUTO_LOCK,
  biometricsEnabled: false,
  hapticsEnabled: true,
  theme: 'system' as ThemePreference,
  feePreference: 'medium' as FeePreference,
  customFeeRate: 10,
  customElectrumServer: null as CustomElectrumServer | null,
  useCustomElectrum: false,
  defaultCurrencyDisplay: 'sat' as DefaultCurrencyDisplay,
  gapLimit: DERIVATION.GAP_LIMIT,
  walletMode: 'hd' as WalletMode,
  walletName: 'My Bitcoin Wallet',
  preserveDataOnDelete: false,
  backupStatus: {} as Record<string, BackupStatusInfo>,
  iCloudBackupEnabled: false,
  iCloudBackupHistory: [] as ICloudBackupEntry[],
  autoBackupEnabled: false,
  autoBackupPassword: null as string | null,
  lastAutoBackupDate: null as number | null,
  ratingDismissedForever: false,
  ratingCompleted: false,
  totalUsageMs: 0,
  lastSessionStart: null as number | null,
  ratingDismissCount: 0,
  lastRatingDismissDate: null as number | null,
  analyticsEnabled: false,
  inAppAlertsEnabled: true,
  nearbyNickname: '',
  discreetMode: false,
  lastInputUnit: null as string | null,

  // ── 021 Enhancement Pack defaults ──
  maxFeeRateSatPerVb: null as number | null,
  maxFeeTotalSats: null as number | null,
  feeCapRequireConfirmation: true,
  defaultFeeTier: 'normal' as FeeOption,
  rememberLastFeeTier: false,
  defaultCustomFeeRate: null as number | null,
  privacyModeDefault: false,
  avoidConsolidation: false,
  preferSingleInput: false,
  avoidUnconfirmedDefault: 'allow_if_needed' as UnconfirmedPolicy,
  largeAmountWarningPct: 50,
  largeAmountConfirmPct: 80,
  tagPresets: DEFAULT_TAG_PRESETS,
};

export const useSettingsStore = create<SettingsState>()(
  (set) => ({
    ...defaultSettings,

    setDenomination: (denomination) => set({ denomination }),

    setCurrency: (currency) => set({ currency }),

    setAutoLockTimeout: (autoLockTimeout) => set({ autoLockTimeout }),

    setBiometricsEnabled: (biometricsEnabled) => set({ biometricsEnabled }),

    setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),

    setTheme: (theme) => set({ theme }),

    // Network is always mainnet - no action needed

    // New setters
    setFeePreference: (feePreference) => set({ feePreference }),

    setCustomFeeRate: (customFeeRate) => set({ customFeeRate }),

    setCustomElectrumServer: (customElectrumServer) => set({ customElectrumServer }),

    setUseCustomElectrum: (useCustomElectrum) => set({ useCustomElectrum }),

    setDefaultCurrencyDisplay: (defaultCurrencyDisplay) => set({ defaultCurrencyDisplay }),

    setGapLimit: (gapLimit) => {
      set({ gapLimit: Math.min(gapLimit, DERIVATION.MAX_GAP_LIMIT) });
    },

    setWalletMode: (walletMode) => {
      set({ walletMode });
    },

    setWalletName: (walletName) => set({ walletName }),

    // Backup status
    markBackedUp: (walletId, method) => set((state) => ({
      backupStatus: {
        ...state.backupStatus,
        [walletId]: {
          isBackedUp: true,
          method,
          lastBackupDate: Date.now(),
        },
      },
    })),

    clearBackupStatus: (walletId) => set((state) => {
      const { [walletId]: _, ...rest } = state.backupStatus;
      return { backupStatus: rest };
    }),

    getBackupStatus: (walletId: string): BackupStatusInfo => {
      // This is a getter that reads from state directly - used outside React context
      const status = (useSettingsStore as any).getState?.()?.backupStatus?.[walletId];
      return status || {
        isBackedUp: false,
        method: null,
        lastBackupDate: null,
      };
    },

    // Data preservation — also stored in Keychain so the flag survives reinstall
    setPreserveDataOnDelete: (preserveDataOnDelete) => {
      set({ preserveDataOnDelete });
      // Mirror to Keychain so we can read it after reinstall
      if (preserveDataOnDelete) {
        SecureStore.setItemAsync(PRESERVE_DATA_KEY, 'true', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => {});
      } else {
        // Delete flag + wipe all preserved archives from Keychain
        SecureStore.deleteItemAsync(PRESERVE_DATA_KEY).catch(() => {});
        // Lazy-import to avoid circular dependency
        try {
          const { PreservedArchiveService } = require('../services/storage/PreservedArchiveService');
          PreservedArchiveService.deleteAllPreservedData().catch(() => {});
        } catch {
          // Non-critical — PreservedArchiveService may not be available
        }
      }
    },

    // iCloud backup actions
    setICloudBackupEnabled: (iCloudBackupEnabled) => set({ iCloudBackupEnabled }),
    addICloudBackup: (entry) => set((state) => ({
      iCloudBackupHistory: [entry, ...state.iCloudBackupHistory],
    })),
    removeICloudBackup: (id) => set((state) => ({
      iCloudBackupHistory: state.iCloudBackupHistory.filter((e) => e.id !== id),
    })),
    clearICloudBackupHistory: () => set({ iCloudBackupHistory: [] }),

    // Auto backup actions
    setAutoBackupEnabled: (autoBackupEnabled) => set({ autoBackupEnabled }),
    setAutoBackupPassword: (autoBackupPassword) => set({ autoBackupPassword }),
    setLastAutoBackupDate: (lastAutoBackupDate) => set({ lastAutoBackupDate }),

    // Rating actions
    setRatingDismissedForever: (ratingDismissedForever) => set({ ratingDismissedForever }),
    setRatingCompleted: (ratingCompleted) => set({ ratingCompleted }),
    addUsageTime: (ms) => set((state) => ({ totalUsageMs: state.totalUsageMs + ms })),
    startSession: () => set({ lastSessionStart: Date.now() }),
    setRatingDismissCount: (ratingDismissCount) => set({ ratingDismissCount }),
    setLastRatingDismissDate: (lastRatingDismissDate) => set({ lastRatingDismissDate }),

    // Privacy/Analytics actions
    setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),

    // In-App Alerts
    setInAppAlertsEnabled: (inAppAlertsEnabled) => set({ inAppAlertsEnabled }),

    // Nearby nickname
    setNearbyNickname: (nearbyNickname) => set({ nearbyNickname }),

    // Discreet Mode
    setDiscreetMode: (discreetMode) => set({ discreetMode }),

    // Last input unit
    setLastInputUnit: (lastInputUnit) => set({ lastInputUnit }),

    // 021 Enhancement Pack setters
    setMaxFeeRateSatPerVb: (maxFeeRateSatPerVb) => set({ maxFeeRateSatPerVb }),
    setMaxFeeTotalSats: (maxFeeTotalSats) => set({ maxFeeTotalSats }),
    setFeeCapRequireConfirmation: (feeCapRequireConfirmation) => set({ feeCapRequireConfirmation }),
    setDefaultFeeTier: (defaultFeeTier) => set({ defaultFeeTier }),
    setRememberLastFeeTier: (rememberLastFeeTier) => set({ rememberLastFeeTier }),
    setDefaultCustomFeeRate: (defaultCustomFeeRate) => set({ defaultCustomFeeRate }),
    setPrivacyModeDefault: (privacyModeDefault) => set({ privacyModeDefault }),
    setAvoidConsolidation: (avoidConsolidation) => set({ avoidConsolidation }),
    setPreferSingleInput: (preferSingleInput) => set({ preferSingleInput }),
    setAvoidUnconfirmedDefault: (avoidUnconfirmedDefault) => set({ avoidUnconfirmedDefault }),
    setLargeAmountWarningPct: (largeAmountWarningPct) => set({ largeAmountWarningPct }),
    setLargeAmountConfirmPct: (largeAmountConfirmPct) => set({ largeAmountConfirmPct }),
    setTagPresets: (tagPresets) => set({ tagPresets }),

    resetToDefaults: () => set(defaultSettings),
  })
);

// ── Helper: extract serializable data from state ──────────────────────
function extractSettingsData(state: SettingsState): Record<string, any> {
  const { setDenomination, setCurrency, setAutoLockTimeout, setBiometricsEnabled,
    setHapticsEnabled, setTheme, setFeePreference, setCustomFeeRate,
    setCustomElectrumServer, setUseCustomElectrum, setDefaultCurrencyDisplay,
    setGapLimit, setWalletMode, setWalletName, markBackedUp, clearBackupStatus,
    getBackupStatus, setPreserveDataOnDelete, setICloudBackupEnabled,
    addICloudBackup, removeICloudBackup, clearICloudBackupHistory,
    setAutoBackupEnabled, setAutoBackupPassword, setLastAutoBackupDate,
    setRatingDismissedForever, setRatingCompleted, addUsageTime, startSession,
    setRatingDismissCount, setLastRatingDismissDate, setAnalyticsEnabled,
    setInAppAlertsEnabled, setNearbyNickname, setMaxFeeRateSatPerVb,
    setMaxFeeTotalSats, setFeeCapRequireConfirmation, setDefaultFeeTier,
    setRememberLastFeeTier, setDefaultCustomFeeRate, setPrivacyModeDefault,
    setAvoidConsolidation, setPreferSingleInput, setAvoidUnconfirmedDefault,
    setLargeAmountWarningPct, setLargeAmountConfirmPct, setTagPresets,
    setDiscreetMode, setLastInputUnit, resetToDefaults,
    ...data } = state;
  return data;
}

// ── Write-through: mirror settings to SQLite app_config on every change ──
// Debounced to avoid excessive DB writes during rapid changes.
let _settingsWriteTimer: ReturnType<typeof setTimeout> | null = null;

let _lastSerializedSettings: string | null = null;

useSettingsStore.subscribe((state) => {
  if (_settingsWriteTimer) clearTimeout(_settingsWriteTimer);
  _settingsWriteTimer = setTimeout(() => {
    try {
      const db = WalletDatabase.shared();
      const data = extractSettingsData(state);
      const serialized = JSON.stringify(data);
      // Skip DB write if nothing actually changed
      if (serialized === _lastSerializedSettings) return;
      _lastSerializedSettings = serialized;
      db.setConfig('settings', serialized);
    } catch {
      // DB not ready yet — that's OK
    }
  }, 500);
});

// ── Apply legacy migrations to persisted data ────────────────────────
function applyMigrations(state: any): any {
  let s = { ...state };
  // Migrate denomination: 'sats' → 'sat', 'fiat' → 'sat'
  if (s.denomination === 'sats' || s.denomination === 'fiat') {
    s.denomination = 'sat';
  }
  // Migrate theme: old 'dark' → new 'midnight'
  if (s.theme === 'dark') {
    s.theme = 'midnight';
  }
  return s;
}

// ── Load from DB: hydrate Zustand from SQLite ────────────────────────
// Called once at app startup from AppStateManager or _layout.
let _settingsLoaded = false;

export function loadSettingsFromDB(): boolean {
  if (_settingsLoaded) return true;

  try {
    const db = WalletDatabase.shared();
    const raw = db.getConfig('settings');

    if (raw) {
      // DB has settings — parse and merge with defaults (for any new fields)
      const parsed = JSON.parse(raw);
      const migrated = applyMigrations(parsed);
      const merged = { ...defaultSettings, ...migrated };
      useSettingsStore.setState(merged);
      _settingsLoaded = true;
      return true;
    }

    // DB empty — try one-time migration from AsyncStorage
    _migrateFromAsyncStorage();
    return true;
  } catch {
    // DB not ready — store stays with defaults, will be populated on next write
    return false;
  }
}

// ── One-time migration from AsyncStorage ─────────────────────────────
async function _migrateFromAsyncStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('settings-storage');
    if (!raw) {
      _settingsLoaded = true;
      return; // No legacy data — fresh install, defaults are fine
    }

    const parsed = JSON.parse(raw);
    // Zustand persist wraps state in { state: {...}, version: N }
    const legacyState = parsed?.state ?? parsed;
    const migrated = applyMigrations(legacyState);
    const merged = { ...defaultSettings, ...migrated };

    // Write to DB
    try {
      const db = WalletDatabase.shared();
      db.setConfig('settings', JSON.stringify(merged));
    } catch {
      // DB not ready — will be written by the subscriber on next change
    }

    // Update Zustand
    useSettingsStore.setState(merged);
    _settingsLoaded = true;

    // Clean up AsyncStorage (non-blocking)
    AsyncStorage.removeItem('settings-storage').catch(() => {});
  } catch {
    _settingsLoaded = true;
    // Migration failed — keep defaults
  }
}

/** Reset the loaded flag (for testing or full app reset) */
export function resetSettingsLoaded(): void {
  _settingsLoaded = false;
}
