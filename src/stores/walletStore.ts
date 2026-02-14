import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { InteractionManager } from 'react-native';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import BIP32Factory from 'bip32';
import { Buffer } from 'buffer';
import { SecureStorage } from '../services/storage/SecureStorage';
import { WalletFileService } from '../services/storage/WalletFileService';
import { SeedGenerator, KeyDerivation } from '../core/wallet';

// Initialize ECC for bitcoinjs-lib (needed for taproot/p2tr)
bitcoin.initEccLib(ecc);
import { MultisigWallet } from '../core/wallet/MultisigWallet';
import { ElectrumAPI } from '../services/electrum';
import { useSettingsStore } from './settingsStore';
import { useMultiWalletStore } from './multiWalletStore';
import { usePriceStore } from './priceStore';
import { useUTXOStore } from './utxoStore';
import { useAccountRegistryStore } from './accountRegistryStore';
import { MarketAPI } from '../services/api/MarketAPI';
import { parseDescriptor } from '../utils/descriptor';
// Cache imports removed — database replaces cache layers
import type { WalletMetadata, AddressInfo, BalanceInfo, UTXO, AddressType, CosignerInfo, MultisigConfig as TypeMultisigConfig, DetailedTransactionInfo } from '../types';
import { DERIVATION, ADDRESS_TYPES, MULTISIG_SCRIPT_TYPES } from '../constants';
import { SensitiveSession } from '../services/auth/SensitiveSession';
import { WalletEngine } from '../services/sync/WalletEngine';
// WalletFileV2Service removed — database is the sole source of truth
import { ServerCacheManager } from '../services/electrum/ServerCacheManager';
import { SubscriptionManager } from '../services/electrum/SubscriptionManager';
import type { RealtimeUpdate } from '../services/electrum/SubscriptionManager';
import { WalletSyncManager } from '../services/sync/WalletSyncManager';
import { SyncLogger } from '../services/SyncLogger';
import { logger } from '../utils/logger';
import { WalletDatabase, V2MigrationService } from '../services/database';
import type { WalletRow } from '../services/database';
// addressToScripthash no longer needed — handled by AddressService.buildAddressRows
// Shared utilities — replace local duplicates
import { addressTypeToScript, scriptToAddressType, addressTypesToScripts, bipPresetToAddressType, ALL_ADDRESS_TYPES } from '../utils/addressTypeMap';
import { keyDerivationFromSecureStorage } from '../services/wallet/KeyDerivationFactory';
import { deriveAddressBatch, deriveAddressBatchAsync, buildAddressRows, deriveAndPersistAddresses, deriveSingleAddress } from '../services/wallet/AddressService';
import { loadWalletSnapshot, snapshotToStoreState } from '../services/wallet/WalletLoaderService';
import { createWalletInDB, generateXpubsAndDescriptors, storeWifOnAddresses } from '../services/wallet/WalletCreationService';
import type { WalletKeyMaterial as CreationKeyMaterial } from '../services/wallet/WalletCreationService';

// Event emitter for in-app transaction toasts (replaces OS notification system)
type TxReceivedListener = (amount: number, address: string, txid: string) => void;
const txReceivedListeners = new Set<TxReceivedListener>();
export const onTransactionReceived = (listener: TxReceivedListener): (() => void) => {
  txReceivedListeners.add(listener);
  return () => { txReceivedListeners.delete(listener); };
};

// Debug logging - set to false to silence all wallet store logs
const DEBUG = false;
const log = (..._args: any[]) => { if (DEBUG) console.log('[WalletStore]', ..._args); };

// Request ID gating — prevents race conditions during rapid wallet switching
let currentSwitchRequestId: string | null = null;

// Cache staleness threshold in milliseconds (5 minutes)
const CACHE_STALE_THRESHOLD = 5 * 60 * 1000;
const REFRESH_TIMEOUT = 90_000; // 90s safety net — if refresh runs longer, allow a new one
let refreshStartedAt: number = 0;

// Subscription cleanup functions
let subscriptionCleanups: Array<() => void> = [];

// Subscription sync debounce — collapses rapid subscription events (block gossip)
// into a single WalletSyncManager sync. In-memory UI updates stay instant.
let subscriptionSyncTimer: ReturnType<typeof setTimeout> | null = null;
const SUBSCRIPTION_SYNC_DEBOUNCE_MS = 5000;

/**
 * loadWalletFromDB — reads wallet data from SQLite and converts to Zustand store shape.
 * Delegates to WalletLoaderService for unified data loading.
 */
function loadWalletFromDB(walletId: string): {
  addresses: AddressInfo[];
  addressIndices: AddressIndices;
  preferredAddressType: AddressType;
  usedAddresses: Set<string>;
  balance: BalanceInfo;
  utxos: UTXO[];
  transactions: DetailedTransactionInfo[];
  trackedTransactions: Map<string, TrackedTransaction>;
  lastSync: number | null;
  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;
  network: 'mainnet' | 'testnet';
} | null {
  try {
    logger.perfStart('load-wallet-from-db');
    const snapshot = loadWalletSnapshot(walletId);
    if (!snapshot) {
      logger.perfEnd('load-wallet-from-db');
      return null;
    }
    const result = snapshotToStoreState(snapshot);
    logger.perfEnd('load-wallet-from-db');
    return result;
  } catch (e) {
    logger.perfEnd('load-wallet-from-db');
    return null;
  }
}

// Legacy aliases removed — use scriptToAddressType / addressTypeToScript directly

/**
 * Key material to store alongside wallet metadata in the DB.
 * Passed from the creation flow when secrets are still in memory.
 */
export interface WalletKeyMaterial {
  secretType: string;                // 'mnemonic' | 'xprv' | 'wif' | 'wif_set' | 'seed_hex' | 'watch_only'
  mnemonic?: string;                 // BIP39 mnemonic phrase
  passphrase?: string;               // BIP39 passphrase (25th word)
  masterXprv?: string;               // Master extended private key
  masterXpub?: string;               // Master extended public key
  seedHex?: string;                  // Raw seed bytes as hex
  keyDerivation?: KeyDerivation;     // For deriving WIFs per address
}

/**
 * Data needed to insert a new wallet directly into the database.
 */
export interface WalletCreationParams {
  walletId: string;
  name: string;
  walletType: string;
  importSource: string;
  fingerprint?: string | null;
  descriptor?: string | null;
  scriptTypes?: string[];
  preferredAddressType?: string;
  gapLimit?: number;
  isMultisig?: boolean;
  multisigConfig?: any;
  watchOnlyData?: any;
  addresses?: AddressInfo[];
  xpubs?: { xpub: string; derivationPath: string; scriptType: string; fingerprint?: string | null }[];
  descriptors?: { descriptor: string; isRange?: boolean; checksum?: string | null; internal?: boolean }[];
}

/**
 * Insert a new wallet directly into the SQLite database.
 * Delegates to WalletCreationService.createWalletInDB for unified DB insertion.
 *
 * @param params - Wallet metadata and derived data
 * @param keyMaterial - Optional key material to persist (mnemonic, xprv, WIFs, etc.)
 */
export function syncNewWalletToDb(params: WalletCreationParams, keyMaterial?: WalletKeyMaterial): void {
  try {
    createWalletInDB(params, keyMaterial);
  } catch (error) {
    // Non-fatal — wallet creation service logs internally
  }
}

/**
 * Backfill missing DB data for existing wallets.
 * Handles wallets created before syncNewWalletToDb was complete.
 * Checks each wallet in DB and fills in missing: xpubs, descriptors, scripthash_status,
 * and any LKG data (UTXOs, transactions, tx_details) that wasn't persisted.
 */
function ensureDbComplete(): void {
  try {
    const db = WalletDatabase.shared();
    const rawDb = db.getDb();

    // Step 0: Ensure ALL known wallets are in the DB
    // Run V2 migration for any wallets that have V2 files but no DB row.
    const multiState = useMultiWalletStore.getState();
    const knownWalletIds = multiState.wallets.map(w => w.id);
    for (const id of knownWalletIds) {
      const existing = db.getWallet(id);
      if (!existing) {
        // Wallet not in DB — try V2 migration service
        try {
          V2MigrationService.migrateWallet(id, db);
          SyncLogger.log('backfill', `Backfilled missing wallet row for ${id}`);
        } catch (e) {
        }
      }
    }

    // Backfill secretType if missing (from walletType) for existing DB wallets
    const wallets = rawDb.getAllSync<{ walletId: string; secretType: string | null; walletType: string }>(
      'SELECT walletId, secretType, walletType FROM wallets WHERE secretType IS NULL'
    );
    for (const { walletId, walletType } of wallets) {
      const walletTypeToSecretType: Record<string, string> = {
        hd_mnemonic: 'mnemonic',
        hd_xprv: 'xprv',
        hd_seed: 'seed_hex',
        imported_key: 'wif',
        imported_keys: 'wif_set',
        watch_only: 'watch_only',
        multisig: 'mnemonic',
      };
      const secretType = walletTypeToSecretType[walletType] || walletType;
      rawDb.runSync(
        'UPDATE wallets SET secretType = ? WHERE walletId = ?',
        [secretType, walletId]
      );
      SyncLogger.log('backfill', `Backfilled secretType='${secretType}' for ${walletId}`);
    }

    // Backfill wallet name if it looks like a raw ID (e.g., "hd-1702934872")
    // Existing wallets created before the name fix stored walletId as the name.
    // Pull the correct name from multiWalletStore (which has it) into the DB.
    const walletsWithIdAsName = rawDb.getAllSync<{ walletId: string; name: string; walletType: string }>(
      "SELECT walletId, name, walletType FROM wallets WHERE name LIKE 'hd-%' OR name LIKE 'multisig-%' OR name LIKE 'watch-%' OR name LIKE 'imported-%'"
    );
    for (const { walletId: wId, name: dbName, walletType: wType } of walletsWithIdAsName) {
      // Check if the name looks like a raw ID (starts with a type prefix followed by dash and numbers)
      if (/^(hd|multisig|watch|imported)-\d+$/.test(dbName)) {
        // Try to get the proper name from multiWalletStore
        const storeWallet = multiState.wallets.find(w => w.id === wId);
        if (storeWallet && storeWallet.name && storeWallet.name !== dbName) {
          rawDb.runSync('UPDATE wallets SET name = ? WHERE walletId = ?', [storeWallet.name, wId]);
          SyncLogger.log('backfill', `Backfilled wallet name: '${dbName}' → '${storeWallet.name}'`);
        } else {
          // No store name available — generate a default based on wallet type
          const typeToDefaultName: Record<string, string> = {
            hd_mnemonic: 'Bitcoin Wallet',
            hd_xprv: 'Imported Wallet',
            hd_seed: 'Imported Wallet',
            imported_key: 'Imported Key',
            multisig: 'Multisig Wallet',
            watch_xpub: 'Watch-Only Wallet',
            watch_descriptor: 'Watch-Only Wallet',
            watch_addresses: 'Watch-Only Wallet',
          };
          const defaultName = typeToDefaultName[wType] || 'Bitcoin Wallet';
          rawDb.runSync('UPDATE wallets SET name = ? WHERE walletId = ?', [defaultName, wId]);
          SyncLogger.log('backfill', `Backfilled wallet name: '${dbName}' → '${defaultName}' (default for ${wType})`);
        }
      }
    }

    // Backfill scripthash_status from DB addresses where missing
    const walletsInDb = rawDb.getAllSync<{ walletId: string }>('SELECT walletId FROM wallets');
    for (const { walletId } of walletsInDb) {
      try {
        const existingSh = rawDb.getFirstSync<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM scripthash_status WHERE walletId = ?', [walletId]
        );
        if ((existingSh?.cnt ?? 0) === 0) {
          const addrRows = db.getAddresses(walletId);
          const shEntries: { walletId: string; scripthash: string; address: string; status: string | null }[] = [];
          for (const addr of addrRows) {
            if (addr.scripthash) {
              shEntries.push({ walletId, scripthash: addr.scripthash, address: addr.address, status: null });
            }
          }
          if (shEntries.length > 0) {
            db.updateScripthashStatuses(shEntries);
            SyncLogger.log('backfill', `Backfilled ${shEntries.length} scripthash statuses for ${walletId}`);
          }
        }
      } catch (wErr) {
      }
    }
  } catch (error) {
  }
}

interface AddressIndices {
  native_segwit: { receiving: number; change: number };
  wrapped_segwit: { receiving: number; change: number };
  legacy: { receiving: number; change: number };
  taproot: { receiving: number; change: number };
}

interface TrackedTransaction {
  txid: string;
  confirmations: number;
  amount: number;
  address: string;
  isIncoming: boolean;
}

// Multisig cosigner info (for display, not secrets)
interface MultisigCosignerDisplay {
  name: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  isLocal: boolean;
}

// Multisig wallet configuration for store
interface MultisigConfig {
  m: number; // Required signatures
  n: number; // Total signers
  scriptType: string; // p2wsh, p2sh-p2wsh, p2sh
  cosigners: MultisigCosignerDisplay[];
  descriptor: string;
  walletName: string;
}

interface WalletState {
  // State
  isInitialized: boolean;
  isLocked: boolean;
  hasPinSet: boolean; // True when user has created a PIN (even without a wallet)
  wasManuallyLocked: boolean; // True when user manually locks wallet (suppress auto-biometric)
  network: 'mainnet' | 'testnet';
  walletId: string | null;
  addresses: AddressInfo[];
  balance: BalanceInfo;
  utxos: UTXO[];
  lastSync: number | null;
  isLoading: boolean;
  isRefreshing: boolean; // For background refreshes (doesn't show loading indicator)
  error: string | null;

  // Multi-address type support
  preferredAddressType: AddressType;
  addressIndices: AddressIndices;

  // Used addresses tracking (addresses that have received transactions)
  usedAddresses: Set<string>;

  // Transaction tracking for notifications
  trackedTransactions: Map<string, TrackedTransaction>;

  // Cached transaction history for instant display
  transactions: DetailedTransactionInfo[];

  // Multisig state
  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;

  // Actions
  initialize: () => Promise<void>;
  createWallet: (mnemonic: string, pin: string, passphrase?: string, derivationConfig?: import('../services/import/types').DerivationPathConfig, walletId?: string, name?: string) => Promise<boolean>;
  importWallet: (mnemonic: string, pin: string, passphrase?: string, derivationConfig?: import('../services/import/types').DerivationPathConfig) => Promise<boolean>;
  importPrivateKey: (wif: string, compressed: boolean, pin: string, name: string, scriptType: AddressType) => Promise<boolean>;
  importFromXprv: (xprv: string, pin: string, name: string, scriptType: AddressType, derivationConfig?: import('../services/import/types').DerivationPathConfig) => Promise<boolean>;
  importFromSeedBytes: (seedHex: string, pin: string, name: string, scriptType: AddressType, derivationConfig?: import('../services/import/types').DerivationPathConfig) => Promise<boolean>;
  createMultisigWallet: (config: MultisigConfig, pin: string) => Promise<boolean>;
  unlock: (pin: string) => Promise<boolean>;
  lock: (manualLock?: boolean) => void;
  reloadFromDB: () => boolean;
  refreshBalance: () => Promise<void>;
  deriveNewAddress: (pin: string, type?: AddressType) => Promise<AddressInfo | null>;
  getChangeAddress: (pin: string, type?: AddressType) => Promise<AddressInfo | null>;
  getFirstUnusedAddress: (type: AddressType) => AddressInfo | null;
  markAddressAsUsed: (address: string) => void;
  getUTXOs: () => Promise<UTXO[]>;
  setNetwork: (network: 'mainnet' | 'testnet') => Promise<void>;
  setPreferredAddressType: (type: AddressType) => void;
  detectBestAddressType: () => AddressType;

  // Gap limit management
  needsGapExtension: (type: AddressType) => boolean;
  extendAddressGap: (pin: string, type?: AddressType) => Promise<number>;
  deleteWallet: (options?: { pin?: string; deleteCloudBackups?: boolean }) => Promise<void>;
  clearError: () => void;
  clearManualLockFlag: () => void;

  // Multisig helper methods
  canSignMultisig: () => boolean;
  getLocalCosigners: () => MultisigCosignerDisplay[];
  getMultisigScriptTypeLabel: () => string;

  // Multi-wallet support
  switchToWallet: (walletId: string, pin?: string) => Promise<boolean>;

  // Transaction caching
  getCachedTransactions: () => DetailedTransactionInfo[];
  updateCachedTransactions: (transactions: DetailedTransactionInfo[]) => void;
  isCacheStale: () => boolean;
}

const initialAddressIndices: AddressIndices = {
  native_segwit: { receiving: 0, change: 0 },
  wrapped_segwit: { receiving: 0, change: 0 },
  legacy: { receiving: 0, change: 0 },
  taproot: { receiving: 0, change: 0 },
};

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      // Initial state
      isInitialized: false,
      isLocked: true,
      hasPinSet: false,
      wasManuallyLocked: false,
      network: 'mainnet',
      walletId: null,
      addresses: [],
      balance: { confirmed: 0, unconfirmed: 0, total: 0 },
      utxos: [],
      lastSync: null,
      isLoading: false,
      isRefreshing: false,
      error: null,
      preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
      addressIndices: { ...initialAddressIndices },
      usedAddresses: new Set<string>(),
      trackedTransactions: new Map<string, TrackedTransaction>(),
      transactions: [],

      // Multisig state
      isMultisig: false,
      multisigConfig: null,

      // Initialize - check if wallet exists
      initialize: async () => {
        try {
          logger.perfStart('store-initialize');
          // Initialize server cache manager for health-weighted server selection
          ServerCacheManager.initialize().catch(() => {});

          // Clean up orphan .tmp files from previous crashed writes
          // V2 file cleanup no longer needed — database is the sole source of truth

          // Initialize SQLite database + run schema migrations
          try {
            WalletDatabase.initialize();
          } catch (dbErr) {
            // Continue without DB — fall back to V2 paths
          }
          // One-time migration: V2 JSON wallet files → SQLite
          try {
            const migResult = V2MigrationService.migrateIfNeeded();
          } catch (migErr) {
          }

          // Backfill: ensure DB has all data for existing wallets
          // (fixes wallets created before syncNewWalletToDb was complete)
          try {
            ensureDbComplete();
          } catch (bfErr) {
          }

          const hasWallet = await SecureStorage.hasWallet();
          const hasMultisig = await SecureStorage.hasMultisigWallet();
          const hasPinSet = await SecureStorage.hasPinSet();

          // Check multi-wallet store for active wallet (more reliable than legacy Keychain checks)
          const multiWalletState = useMultiWalletStore.getState();
          const activeWallet = multiWalletState.getActiveWallet();
          const hasMultiWallets = multiWalletState.wallets.length > 0;

          // A wallet exists if we have PIN set AND (legacy keychain data OR multi-wallet entries)
          const walletExists = hasPinSet && (hasWallet || hasMultisig || hasMultiWallets);

          // Fresh install detection: Keychain has wallet but AsyncStorage is empty.
          // If "Preserve Data on Delete" is off, wipe orphaned Keychain data.
          if ((hasWallet || hasMultisig) && !hasMultiWallets) {
            const settingsData = await AsyncStorage.getItem('settings-storage');
            if (!settingsData) {
              // AsyncStorage is gone — this is a reinstall
              const preserveFlag = await SecureStore.getItemAsync('preserve_data_on_delete', {
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
              }).catch(() => null);

              if (preserveFlag !== 'true') {
                // User didn't opt in to preserve — clean up orphaned Keychain data
                await SecureStorage.deleteWallet().catch(() => {});
                set({
                  isInitialized: true,
                  isLocked: false,
                  walletId: null,
                  network: 'mainnet',
                });
                return;
              }

              // Preserve flag is set — reinstall with preserved data.
              // Route to onboarding where recovery sheet will detect the manifest.
              set({
                isInitialized: true,
                isLocked: false,
                walletId: null,
                network: 'mainnet',
              });
              return;
            }
          }

          const metadata = await SecureStorage.getWalletMetadata<{
            network: 'mainnet' | 'testnet';
            addressCount: number;
            preferredAddressType?: AddressType;
            isMultisig?: boolean;
            multisigConfig?: MultisigConfig;
          }>();

          // Use the actual active wallet ID from multi-wallet store if available,
          // otherwise fall back to legacy IDs
          const resolvedWalletId = activeWallet?.id
            ?? (hasMultisig ? 'multisig' : (hasWallet ? 'default' : null));


          set({
            isInitialized: true,
            isLocked: walletExists,
            hasPinSet,
            walletId: walletExists ? resolvedWalletId : null,
            network: 'mainnet', // Always use mainnet
            preferredAddressType: metadata?.preferredAddressType || ADDRESS_TYPES.NATIVE_SEGWIT,
            isMultisig: metadata?.isMultisig || false,
            multisigConfig: metadata?.multisigConfig || null,
          });
          logger.perfEnd('store-initialize');
        } catch (error) {
          logger.perfEnd('store-initialize');
          set({ error: 'Failed to initialize wallet' });
        }
      },

      // Create a new wallet
      createWallet: async (mnemonic: string, pin: string, passphrase: string = '', derivationConfig?: import('../services/import/types').DerivationPathConfig, walletId?: string, name?: string) => {
        set({ isLoading: true, error: null });

        try {
          // Validate mnemonic
          if (!SeedGenerator.validate(mnemonic)) {
            set({ isLoading: false, error: 'Invalid seed phrase' });
            return false;
          }

          // Store encrypted seed (and passphrase if provided)
          await SecureStorage.storeSeed(mnemonic, pin, passphrase);

          // Generate initial addresses for all types (with passphrase for key derivation)
          const seed = await SeedGenerator.toSeed(mnemonic, passphrase);

          const network = get().network;
          const keyDerivation = new KeyDerivation(seed, network);

          // Determine which address types to derive based on derivation config
          let addressTypes: AddressType[];
          if (!derivationConfig || derivationConfig.preset === 'hd') {
            addressTypes = ALL_ADDRESS_TYPES;
          } else {
            const selectedType = bipPresetToAddressType(derivationConfig.preset);
            addressTypes = [selectedType];
          }

          log(' Creating wallet - derivation config:', derivationConfig?.preset || 'hd (default)', 'types:', addressTypes.length);

          // Use gap limit from settings (user-configurable)
          const settingsGapLimit = useSettingsStore.getState().gapLimit;
          const CHANGE_ADDRESS_COUNT = 10;
          const accountIndex = derivationConfig?.accountIndex ?? 0;
          log(' Creating wallet - gapLimit:', settingsGapLimit, ', accountIndex:', accountIndex);

          // Use shared AddressService for async batch derivation (yields every 10 to keep UI responsive)
          const addresses = await deriveAddressBatchAsync(keyDerivation, {
            addressTypes,
            receivingCount: settingsGapLimit,
            changeCount: CHANGE_ADDRESS_COUNT,
            accountIndex,
          });

          // Determine preferred address type based on derivation config
          const preferredType = addressTypes.includes(ADDRESS_TYPES.NATIVE_SEGWIT)
            ? ADDRESS_TYPES.NATIVE_SEGWIT
            : addressTypes[0];

          // Store metadata (include derivation config for reference)
          await SecureStorage.storeWalletMetadata({
            network,
            addressCount: addresses.length,
            preferredAddressType: preferredType,
            createdAt: Date.now(),
          });

          // Extract fingerprint + master keys before cleanup
          let fingerprint: string | null = null;
          let masterXprv: string | null = null;
          let masterXpub: string | null = null;
          try {
            fingerprint = keyDerivation.getMasterFingerprint();
          } catch { /* fingerprint extraction optional */ }
          try {
            masterXprv = keyDerivation.getMasterXprv();
          } catch { /* xprv optional for watch-only */ }
          try {
            masterXpub = keyDerivation.getMasterXpub();
          } catch { /* xpub extraction optional */ }

          // Map address types to canonical script types using shared utility
          const scriptTypes = addressTypesToScripts(addressTypes);

          // Set up address indices - only track indices for derived address types
          const newIndices: AddressIndices = {
            native_segwit: addressTypes.includes(ADDRESS_TYPES.NATIVE_SEGWIT)
              ? { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT }
              : { receiving: 0, change: 0 },
            wrapped_segwit: addressTypes.includes(ADDRESS_TYPES.WRAPPED_SEGWIT)
              ? { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT }
              : { receiving: 0, change: 0 },
            legacy: addressTypes.includes(ADDRESS_TYPES.LEGACY)
              ? { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT }
              : { receiving: 0, change: 0 },
            taproot: addressTypes.includes(ADDRESS_TYPES.TAPROOT)
              ? { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT }
              : { receiving: 0, change: 0 },
          };

          const effectiveId = walletId || `hd-${Date.now()}`;

          // Generate xpubs + descriptors using shared utility
          const { xpubs: xpubEntries, descriptors: descriptorEntries, primaryDescriptor } = generateXpubsAndDescriptors(keyDerivation);

          // Insert wallet directly into SQLite database
          syncNewWalletToDb({
            walletId: effectiveId,
            name: name || effectiveId,
            walletType: 'hd_mnemonic',
            importSource: 'phrase',
            fingerprint,
            descriptor: primaryDescriptor,
            scriptTypes,
            preferredAddressType: preferredType,
            gapLimit: settingsGapLimit,
            addresses,
            xpubs: xpubEntries,
            descriptors: descriptorEntries,
          }, {
            secretType: 'mnemonic',
            mnemonic,
            passphrase: passphrase || undefined,
            masterXprv: masterXprv ?? undefined,
            masterXpub: masterXpub ?? undefined,
            seedHex: seed.toString('hex'),
            keyDerivation,
          });

          // Clean up key material AFTER DB sync (WIFs need keyDerivation)
          keyDerivation.destroy();

          set({
            isLoading: false,
            isLocked: false,
            walletId: effectiveId,
            addresses,
            addressIndices: newIndices,
            preferredAddressType: preferredType,
            // Clear stale data from previous wallet (DB-first: new wallet has no data yet)
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            transactions: [],
            utxos: [],
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map(),
            lastSync: null,
          });

          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to create wallet',
          });
          return false;
        }
      },

      // Import existing wallet
      importWallet: async (mnemonic: string, pin: string, passphrase: string = '', derivationConfig?: import('../services/import/types').DerivationPathConfig) => {
        // Same as create but with passphrase support
        return get().createWallet(mnemonic, pin, passphrase, derivationConfig);
      },

      // Import a single private key (WIF format)
      importPrivateKey: async (wif: string, compressed: boolean, pin: string, name: string, scriptType: AddressType) => {
        set({ isLoading: true, error: null });

        try {
          // Validate: uncompressed keys can only use Legacy addresses
          if (!compressed && scriptType !== ADDRESS_TYPES.LEGACY) {
            throw new Error('Uncompressed keys only support Legacy (P2PKH) addresses');
          }

          const ECPairLocal = ECPairFactory(ecc);
          const network = bitcoin.networks.bitcoin; // mainnet only

          // Decode the WIF to get the key pair
          const keyPair = ECPairLocal.fromWIF(wif, network);
          const pubkey = keyPair.publicKey;

          // Determine which address types this key supports
          // Compressed WIF: BIP84 (native_segwit) + BIP49 (wrapped_segwit) + BIP44 (legacy)
          // Uncompressed WIF: BIP44 (legacy) only
          // Note: Taproot (BIP86) is NOT supported for single WIF keys
          const supportedTypes: AddressType[] = compressed
            ? [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.LEGACY]
            : [ADDRESS_TYPES.LEGACY];

          // Helper to derive address for a given type
          const deriveAddressForType = (addrType: AddressType): string => {
            let addr: string | undefined;
            switch (addrType) {
              case ADDRESS_TYPES.NATIVE_SEGWIT:
                addr = bitcoin.payments.p2wpkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.WRAPPED_SEGWIT: {
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
                addr = bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address;
                break;
              }
              case ADDRESS_TYPES.LEGACY:
                addr = bitcoin.payments.p2pkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.TAPROOT: {
                const xOnlyPubkey = pubkey.subarray(1, 33);
                addr = bitcoin.payments.p2tr({ internalPubkey: xOnlyPubkey, network }).address;
                break;
              }
              default:
                addr = bitcoin.payments.p2wpkh({ pubkey, network }).address;
            }
            if (!addr) throw new Error('Failed to derive address from private key');
            return addr;
          };

          // Derive addresses for all supported types
          const allAddresses: AddressInfo[] = supportedTypes.map(addrType => ({
            address: deriveAddressForType(addrType),
            path: 'imported',
            index: 0,
            isChange: false,
            type: addrType,
          }));

          // Register in multiWalletStore and set as active
          const multiWallet = useMultiWalletStore.getState();
          const walletInfo = await multiWallet.addWallet({
            name,
            type: 'imported_key',
          });
          await multiWallet.setActiveWallet(walletInfo.id);

          // Store encrypted WIF in SecureStorage
          await SecureStorage.storeWalletPrivateKey(walletInfo.id, wif, pin);

          // Store backup-compatible WIF data
          await SecureStorage.storeImportedKeyWIF(walletInfo.id, {
            wif,
            compressed,
            scriptType,
          }, pin);

          // Ensure PIN hash exists (without storing a placeholder seed)
          await SecureStorage.ensurePinHashExists(pin);

          // Store metadata
          await SecureStorage.storeWalletMetadataById(walletInfo.id, {
            network: 'mainnet',
            addressCount: allAddresses.length,
            preferredAddressType: scriptType,
            isImportedKey: true,
            compressed,
            createdAt: Date.now(),
          });

          // Switch to this wallet
          set({
            isLoading: false,
            isLocked: false,
            walletId: walletInfo.id,
            addresses: allAddresses,
            preferredAddressType: scriptType,
            addressIndices: { ...initialAddressIndices },
            isMultisig: false,
            multisigConfig: null,
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            utxos: [],
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map<string, TrackedTransaction>(),
            transactions: [],
          });

          // Insert wallet directly into SQLite database
          // For WIF imports, we need to store the WIF on the address rows
          // since there's no keyDerivation to derive WIFs from path.
          syncNewWalletToDb({
            walletId: walletInfo.id,
            name: walletInfo.name,
            walletType: 'imported_key',
            importSource: 'wif',
            preferredAddressType: scriptType,
            gapLimit: 0,  // WIF wallets have fixed addresses, no gap limit concept
            addresses: allAddresses,
          }, {
            secretType: 'wif',
          });

          // Store WIF on each address row using shared utility
          storeWifOnAddresses(walletInfo.id, allAddresses, wif);

          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to import private key',
          });
          return false;
        }
      },

      // Import from extended private key (xprv/yprv/zprv)
      importFromXprv: async (xprv: string, pin: string, name: string, scriptType: AddressType, derivationConfig?) => {
        set({ isLoading: true, error: null });

        try {
          const bip32 = BIP32Factory(ecc);
          const network = bitcoin.networks.bitcoin;

          // Parse xprv
          const node = bip32.fromBase58(xprv, network);

          // Get gap limit from settings
          const settingsGapLimit = useSettingsStore.getState().gapLimit;
          const CHANGE_ADDRESS_COUNT = 10;

          // Determine if the xprv can derive all address types.
          // Depth 0 = master key → can derive all BIP purpose paths (44/49/84/86)
          // Depth 1 = purpose level → fixed to one type
          // Depth 2 = coin type level → fixed to one type
          // Depth 3 = account level → fixed to one type
          // Custom/bip32 presets also fix to single type.
          const canDeriveAllTypes = node.depth === 0
            && (!derivationConfig || !['custom', 'bip32'].includes(derivationConfig.preset));

          // All 4 address types we can derive
          const ALL_SCRIPT_TYPES: AddressType[] = [
            ADDRESS_TYPES.NATIVE_SEGWIT,
            ADDRESS_TYPES.TAPROOT,
            ADDRESS_TYPES.WRAPPED_SEGWIT,
            ADDRESS_TYPES.LEGACY,
          ];

          // Which types to derive at import time
          const typesToDerive = canDeriveAllTypes ? ALL_SCRIPT_TYPES : [scriptType];

          // Helper: derive account node + basePath for a given address type
          const getAccountNodeForType = (addrType: AddressType): { accountNode: any; basePath: string } => {
            if (derivationConfig) {
              if (derivationConfig.preset === 'custom' && derivationConfig.customPath) {
                const customPath = derivationConfig.customPath.replace(/^m\//, '').replace(/\/\d+\/\d+$/, '');
                return {
                  accountNode: customPath ? node.derivePath(customPath) : node,
                  basePath: derivationConfig.customPath.replace(/\/\d+\/\d+$/, ''),
                };
              } else if (derivationConfig.preset === 'bip32') {
                return { accountNode: node, basePath: '' };
              } else {
                // BIP44/49/84/86 preset — use preset purpose, not type-based
                const purposeMap: Record<string, number> = { bip44: 44, bip49: 49, bip84: 84, bip86: 86 };
                const purpose = purposeMap[derivationConfig.preset] || 84;
                const account = derivationConfig.accountIndex || 0;
                let current = node;
                const pathParts: string[] = [];
                switch (node.depth) {
                  case 0:
                    current = current.deriveHardened(purpose);
                    pathParts.push(`${purpose}'`);
                    current = current.deriveHardened(0);
                    pathParts.push(`0'`);
                    current = current.deriveHardened(account);
                    pathParts.push(`${account}'`);
                    break;
                  case 1:
                    current = current.deriveHardened(0);
                    pathParts.push(`0'`);
                    current = current.deriveHardened(account);
                    pathParts.push(`${account}'`);
                    break;
                  case 2:
                    current = current.deriveHardened(account);
                    pathParts.push(`${account}'`);
                    break;
                  case 3:
                    break;
                  default:
                    break;
                }
                return {
                  accountNode: current,
                  basePath: pathParts.length > 0 ? `m/${pathParts.join('/')}` : 'xprv',
                };
              }
            }

            // No derivationConfig: derive based on address type with standard BIP paths
            if (canDeriveAllTypes) {
              // Master key → derive full BIP path for each type
              const purposeMap: Record<AddressType, number> = {
                [ADDRESS_TYPES.LEGACY]: 44,
                [ADDRESS_TYPES.WRAPPED_SEGWIT]: 49,
                [ADDRESS_TYPES.NATIVE_SEGWIT]: 84,
                [ADDRESS_TYPES.TAPROOT]: 86,
              };
              const purpose = purposeMap[addrType] || 84;
              const current = node.deriveHardened(purpose).deriveHardened(0).deriveHardened(0);
              return {
                accountNode: current,
                basePath: `m/${purpose}'/0'/0'`,
              };
            }

            // Non-master key → treat as account-level
            return { accountNode: node, basePath: 'xprv' };
          };

          // Helper function to derive address from an account node
          const deriveAddressFromNode = (acctNode: any, basePath: string, chain: number, index: number, addrType: AddressType): AddressInfo => {
            const child = acctNode.derive(chain).derive(index);
            const pubkey = child.publicKey;
            let address: string | undefined;

            switch (addrType) {
              case ADDRESS_TYPES.NATIVE_SEGWIT:
                address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.WRAPPED_SEGWIT: {
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
                address = bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address;
                break;
              }
              case ADDRESS_TYPES.LEGACY:
                address = bitcoin.payments.p2pkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.TAPROOT: {
                const xOnlyPubkey = pubkey.subarray(1, 33);
                address = bitcoin.payments.p2tr({ internalPubkey: xOnlyPubkey, network }).address;
                break;
              }
              default:
                address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
            }

            if (!address) {
              throw new Error('Failed to derive address from extended key');
            }

            return {
              address,
              path: `${basePath}/${chain}/${index}`,
              index,
              isChange: chain === 1,
              type: addrType,
            };
          };

          // Derive addresses for all applicable script types
          const addresses: AddressInfo[] = [];
          const newIndices: AddressIndices = { ...initialAddressIndices };

          for (const addrType of typesToDerive) {
            const { accountNode, basePath } = getAccountNodeForType(addrType);
            log(' importFromXprv: deriving', settingsGapLimit, 'receiving +', CHANGE_ADDRESS_COUNT, 'change addresses for', addrType);

            for (let i = 0; i < settingsGapLimit; i++) {
              addresses.push(deriveAddressFromNode(accountNode, basePath, 0, i, addrType));
            }
            for (let i = 0; i < CHANGE_ADDRESS_COUNT; i++) {
              addresses.push(deriveAddressFromNode(accountNode, basePath, 1, i, addrType));
            }
            newIndices[addrType] = { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT };
          }

          // Get fingerprint
          let fingerprint: string | undefined;
          if (node.depth === 0) {
            fingerprint = Buffer.from(node.fingerprint).toString('hex');
          }

          // Register in multiWalletStore and set as active
          const multiWallet = useMultiWalletStore.getState();
          const walletInfo = await multiWallet.addWallet({
            name,
            type: 'hd_xprv',
          });
          await multiWallet.setActiveWallet(walletInfo.id);

          // Store encrypted xprv
          await SecureStorage.storeWalletXprv(walletInfo.id, xprv, pin);

          // Store backup-compatible xprv data
          await SecureStorage.storeImportedXprv(walletInfo.id, {
            xprv,
            scriptType,
            derivationConfig,
          }, pin);

          // Ensure PIN hash exists (without storing a placeholder seed)
          await SecureStorage.ensurePinHashExists(pin);

          await SecureStorage.storeWalletMetadataById(walletInfo.id, {
            network: 'mainnet',
            addressCount: addresses.length,
            preferredAddressType: scriptType,
            isImportedXprv: true,
            fingerprint,
            derivationConfig,
            createdAt: Date.now(),
          });

          set({
            isLoading: false,
            isLocked: false,
            walletId: walletInfo.id,
            addresses,
            preferredAddressType: scriptType,
            addressIndices: newIndices,
            isMultisig: false,
            multisigConfig: null,
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            utxos: [],
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map<string, TrackedTransaction>(),
            transactions: [],
          });

          // Generate xpubs + descriptors using shared utility
          let xpubEntries: WalletCreationParams['xpubs'] = [];
          let descriptorEntries: WalletCreationParams['descriptors'] = [];
          let primaryDescriptor: string | undefined;
          try {
            const kd = KeyDerivation.fromXprv(xprv, 'mainnet');
            const generated = generateXpubsAndDescriptors(kd);
            xpubEntries = generated.xpubs;
            descriptorEntries = generated.descriptors;
            primaryDescriptor = generated.primaryDescriptor ?? undefined;
            kd.destroy();
          } catch { /* xpub/descriptor extraction optional */ }

          // Insert wallet directly into SQLite database
          const xprvXpub = node.neutered().toBase58();
          syncNewWalletToDb({
            walletId: walletInfo.id,
            name: walletInfo.name,
            walletType: 'hd_xprv',
            importSource: 'xprv',
            fingerprint: fingerprint ?? null,
            descriptor: primaryDescriptor,
            scriptTypes: addressTypesToScripts(typesToDerive),
            preferredAddressType: scriptType,
            gapLimit: settingsGapLimit,
            addresses,
            xpubs: xpubEntries,
            descriptors: descriptorEntries,
          }, {
            secretType: 'xprv',
            masterXprv: xprv,
            masterXpub: xprvXpub,
          });

          log(' importFromXprv: successfully imported with', addresses.length, 'addresses across', typesToDerive.length, 'address types');
          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to import extended key',
          });
          return false;
        }
      },

      // Import from raw seed bytes (hex)
      importFromSeedBytes: async (seedHex: string, pin: string, name: string, scriptType: AddressType, derivationConfig?) => {
        set({ isLoading: true, error: null });

        try {
          const bip32 = BIP32Factory(ecc);
          const network = bitcoin.networks.bitcoin;

          // Create BIP32 root from seed
          const seedBuf = Buffer.from(seedHex, 'hex');
          const root = bip32.fromSeed(seedBuf, network);

          // Get gap limit from settings
          const settingsGapLimit = useSettingsStore.getState().gapLimit;
          const CHANGE_ADDRESS_COUNT = 10;

          // All 4 address types
          const ALL_SCRIPT_TYPES: AddressType[] = [
            ADDRESS_TYPES.NATIVE_SEGWIT,
            ADDRESS_TYPES.TAPROOT,
            ADDRESS_TYPES.WRAPPED_SEGWIT,
            ADDRESS_TYPES.LEGACY,
          ];

          // Determine if we can derive all types or are locked to one
          // Custom/bip32 presets lock to a single derivation path
          const canDeriveAllTypes = !derivationConfig || !['custom', 'bip32'].includes(derivationConfig.preset);
          const typesToDerive = canDeriveAllTypes ? ALL_SCRIPT_TYPES : [scriptType];

          // Purpose map for address types
          const purposeForType: Record<AddressType, number> = {
            [ADDRESS_TYPES.NATIVE_SEGWIT]: 84,
            [ADDRESS_TYPES.TAPROOT]: 86,
            [ADDRESS_TYPES.WRAPPED_SEGWIT]: 49,
            [ADDRESS_TYPES.LEGACY]: 44,
          };

          // Helper to get account node + basePath for a given type
          const getAccountNodeForType = (addrType: AddressType): { accountNode: any; basePath: string } => {
            if (derivationConfig?.preset === 'bip32') {
              return { accountNode: root, basePath: '' };
            } else if (derivationConfig?.preset === 'custom' && derivationConfig.customPath) {
              const customPath = derivationConfig.customPath.replace(/^m\//, '').replace(/\/\d+\/\d+$/, '');
              return {
                accountNode: customPath ? root.derivePath(customPath) : root,
                basePath: derivationConfig.customPath.replace(/\/\d+\/\d+$/, ''),
              };
            } else if (derivationConfig) {
              // Specific BIP preset from config
              const purposeMap: Record<string, number> = { bip44: 44, bip49: 49, bip84: 84, bip86: 86 };
              const purpose = purposeMap[derivationConfig.preset] || 84;
              const account = derivationConfig.accountIndex || 0;
              const acctNode = root.deriveHardened(purpose).deriveHardened(0).deriveHardened(account);
              return { accountNode: acctNode, basePath: `m/${purpose}'/0'/${account}'` };
            } else {
              // No config: derive standard BIP path for the address type
              const purpose = purposeForType[addrType] || 84;
              const acctNode = root.deriveHardened(purpose).deriveHardened(0).deriveHardened(0);
              return { accountNode: acctNode, basePath: `m/${purpose}'/0'/0'` };
            }
          };

          // Helper function to derive address
          const deriveAddressFromNode = (acctNode: any, basePath: string, chain: number, index: number, addrType: AddressType): AddressInfo => {
            const child = acctNode.derive(chain).derive(index);
            const pubkey = child.publicKey;
            let address: string | undefined;

            switch (addrType) {
              case ADDRESS_TYPES.NATIVE_SEGWIT:
                address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.WRAPPED_SEGWIT: {
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
                address = bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address;
                break;
              }
              case ADDRESS_TYPES.LEGACY:
                address = bitcoin.payments.p2pkh({ pubkey, network }).address;
                break;
              case ADDRESS_TYPES.TAPROOT: {
                const xOnlyPubkey = pubkey.subarray(1, 33);
                address = bitcoin.payments.p2tr({ internalPubkey: xOnlyPubkey, network }).address;
                break;
              }
              default:
                address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
            }

            if (!address) {
              throw new Error('Failed to derive address from seed');
            }

            return {
              address,
              path: basePath ? `${basePath}/${chain}/${index}` : `${chain}/${index}`,
              index,
              isChange: chain === 1,
              type: addrType,
            };
          };

          // Derive addresses for all applicable types
          const addresses: AddressInfo[] = [];
          const newIndices: AddressIndices = { ...initialAddressIndices };

          for (const addrType of typesToDerive) {
            const { accountNode, basePath } = getAccountNodeForType(addrType);
            log(' importFromSeedBytes: deriving', settingsGapLimit, 'receiving +', CHANGE_ADDRESS_COUNT, 'change addresses for', addrType);

            for (let i = 0; i < settingsGapLimit; i++) {
              addresses.push(deriveAddressFromNode(accountNode, basePath, 0, i, addrType));
            }
            for (let i = 0; i < CHANGE_ADDRESS_COUNT; i++) {
              addresses.push(deriveAddressFromNode(accountNode, basePath, 1, i, addrType));
            }
            newIndices[addrType] = { receiving: settingsGapLimit, change: CHANGE_ADDRESS_COUNT };
          }

          const fingerprint = Buffer.from(root.fingerprint).toString('hex');

          // Register in multiWalletStore and set as active
          const multiWallet = useMultiWalletStore.getState();
          const walletInfo = await multiWallet.addWallet({
            name,
            type: 'hd_seed',
          });
          await multiWallet.setActiveWallet(walletInfo.id);

          // Store encrypted seed hex
          await SecureStorage.storeWalletSeedHex(walletInfo.id, seedHex, pin);

          // Store backup-compatible seed data
          await SecureStorage.storeImportedSeedHex(walletInfo.id, {
            seedHex,
            scriptType,
            derivationConfig,
          }, pin);

          // Ensure PIN hash exists (without storing a placeholder seed)
          await SecureStorage.ensurePinHashExists(pin);

          await SecureStorage.storeWalletMetadataById(walletInfo.id, {
            network: 'mainnet',
            addressCount: addresses.length,
            preferredAddressType: scriptType,
            isImportedSeed: true,
            fingerprint,
            derivationConfig,
            createdAt: Date.now(),
          });

          set({
            isLoading: false,
            isLocked: false,
            walletId: walletInfo.id,
            addresses,
            preferredAddressType: scriptType,
            addressIndices: newIndices,
            isMultisig: false,
            multisigConfig: null,
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            utxos: [],
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map<string, TrackedTransaction>(),
            transactions: [],
          });

          // Generate xpubs + descriptors for DB
          let xpubEntries: WalletCreationParams['xpubs'] = [];
          let descriptorEntries: WalletCreationParams['descriptors'] = [];
          let primaryDescriptor: string | undefined;
          try {
            const kd = KeyDerivation.fromSeedHex(seedHex, 'mainnet');
            const generated = generateXpubsAndDescriptors(kd);
            xpubEntries = generated.xpubs;
            descriptorEntries = generated.descriptors;
            primaryDescriptor = generated.primaryDescriptor ?? undefined;
            kd.destroy();
          } catch { /* xpub/descriptor extraction optional */ }

          // Insert wallet directly into SQLite database
          const seedXpub = root.neutered().toBase58();
          const seedMasterXprv = root.toBase58();
          syncNewWalletToDb({
            walletId: walletInfo.id,
            name: walletInfo.name,
            walletType: 'hd_seed',
            importSource: 'seed_hex',
            fingerprint,
            descriptor: primaryDescriptor,
            scriptTypes: addressTypesToScripts(typesToDerive),
            preferredAddressType: scriptType,
            gapLimit: settingsGapLimit,
            addresses,
            xpubs: xpubEntries,
            descriptors: descriptorEntries,
          }, {
            secretType: 'seed_hex',
            seedHex,
            masterXprv: seedMasterXprv,
            masterXpub: seedXpub,
          });

          log(' importFromSeedBytes: successfully imported with', addresses.length, 'addresses across', typesToDerive.length, 'address types');
          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to import seed bytes',
          });
          return false;
        }
      },

      // Create a multisig wallet
      createMultisigWallet: async (config: MultisigConfig, pin: string) => {
        set({ isLoading: true, error: null });

        try {
          log(' Creating multisig wallet', {
            policy: `${config.m}-of-${config.n}`,
            scriptType: config.scriptType,
            walletName: config.walletName,
            cosignerCount: config.cosigners.length,
          });

          // Validate the configuration
          if (config.m < 1 || config.m > config.n) {
            throw new Error(`Invalid policy: ${config.m}-of-${config.n}`);
          }
          if (config.n < 2 || config.n > 15) {
            throw new Error(`Invalid signer count: ${config.n}`);
          }
          if (!config.descriptor) {
            throw new Error('Missing wallet descriptor');
          }
          if (config.cosigners.length !== config.n) {
            throw new Error(`Expected ${config.n} cosigners, got ${config.cosigners.length}`);
          }

          // Check if all cosigners have valid xpubs (not placeholders)
          const hasValidXpubs = config.cosigners.every(c => {
            if (!c.xpub) return false;
            // Check if it's a real xpub (starts with valid prefix and has proper length)
            const validPrefixes = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub', 'tpub', 'upub', 'vpub'];
            return validPrefixes.some(prefix => c.xpub.startsWith(prefix)) && c.xpub.length >= 100;
          });

          log(' Cosigner xpub validation:', {
            hasValidXpubs,
            cosigners: config.cosigners.map(c => ({
              name: c.name,
              xpubPrefix: c.xpub?.substring(0, 20),
              xpubLength: c.xpub?.length,
            })),
          });

          // Store the PIN hash for verification (multisig uses PIN but no mnemonic)
          // For multisig, we store the descriptor securely instead of a mnemonic
          await SecureStorage.storeMultisigDescriptor(config.descriptor, pin);

          // Map script type string to MULTISIG_SCRIPT_TYPES constant
          const getScriptType = (scriptType: string) => {
            switch (scriptType) {
              case 'p2wsh':
                return MULTISIG_SCRIPT_TYPES.P2WSH;
              case 'p2sh-p2wsh':
                return MULTISIG_SCRIPT_TYPES.P2SH_P2WSH;
              case 'p2sh':
                return MULTISIG_SCRIPT_TYPES.P2SH;
              default:
                return MULTISIG_SCRIPT_TYPES.P2WSH;
            }
          };

          const addresses: AddressInfo[] = [];
          const CHANGE_ADDRESS_COUNT = 10;

          // Try to derive addresses from descriptor if we have valid xpubs
          if (hasValidXpubs) {
            // Create MultisigWallet instance and derive real addresses
            log(' Initializing MultisigWallet with valid cosigner xpubs');

            // Build the internal MultisigConfig for MultisigWallet class
            const multisigWalletConfig: TypeMultisigConfig = {
              m: config.m,
              n: config.n,
              scriptType: getScriptType(config.scriptType),
              cosigners: config.cosigners.map((c, idx) => ({
                id: `cosigner_${idx}`,
                name: c.name,
                fingerprint: c.fingerprint,
                xpub: c.xpub,
                derivationPath: c.derivationPath,
                isLocal: c.isLocal,
              })),
              derivationPath: `m/48'/0'/0'/2'`, // BIP48 standard for multisig
              sortedKeys: true, // Use sortedmulti for consistent key ordering
            };

            const multisigWallet = MultisigWallet.fromConfig(multisigWalletConfig, 'mainnet');

            // Validate the wallet is complete
            if (!multisigWallet.isComplete()) {
              throw new Error('MultisigWallet configuration is incomplete');
            }

            log(' Deriving receiving addresses...');
            // Derive receiving addresses
            const msGapLimit = useSettingsStore.getState().gapLimit;
            const receivingAddresses = multisigWallet.deriveReceivingAddresses(msGapLimit, 0);
            for (const addr of receivingAddresses) {
              addresses.push({
                address: addr.address,
                path: addr.path,
                index: addr.index,
                isChange: false,
                type: addr.type,
              });
            }
            log(' First receiving address:', addresses[0]?.address);

            log(' Deriving change addresses...');
            // Derive change addresses
            const changeAddresses = multisigWallet.deriveChangeAddresses(CHANGE_ADDRESS_COUNT, 0);
            for (const addr of changeAddresses) {
              addresses.push({
                address: addr.address,
                path: addr.path,
                index: addr.index,
                isChange: true,
                type: addr.type,
              });
            }
          } else {
            // Fallback: Parse descriptor to extract keys and derive addresses
            // This handles the case where we have placeholder xpubs in cosigners
            // but the descriptor itself contains valid key information
            log(' Using descriptor-based address derivation (cosigners have placeholder xpubs)');

            try {
              const parsedDescriptor = parseDescriptor(config.descriptor);
              log(' Parsed descriptor:', {
                type: parsedDescriptor.type,
                scriptType: parsedDescriptor.scriptType,
                isMultisig: parsedDescriptor.isMultisig,
                threshold: parsedDescriptor.threshold,
                totalKeys: parsedDescriptor.totalKeys,
                keysCount: parsedDescriptor.keys.length,
              });

              // Extract xpubs from the parsed descriptor
              const descriptorKeys = parsedDescriptor.keys;
              if (descriptorKeys.length !== config.n) {
                throw new Error(`Descriptor has ${descriptorKeys.length} keys but expected ${config.n}`);
              }

              // Build cosigners from descriptor keys
              const cosignersFromDescriptor: CosignerInfo[] = descriptorKeys.map((key, idx) => ({
                id: `cosigner_${idx}`,
                name: config.cosigners[idx]?.name || `Signer ${idx + 1}`,
                fingerprint: key.fingerprint || config.cosigners[idx]?.fingerprint || '00000000',
                xpub: key.key,
                derivationPath: key.derivationPath || config.cosigners[idx]?.derivationPath || `m/48'/0'/0'/2'`,
                isLocal: config.cosigners[idx]?.isLocal || false,
              }));

              log(' Cosigners from descriptor:', cosignersFromDescriptor.map(c => ({
                name: c.name,
                fingerprint: c.fingerprint,
                xpubPrefix: c.xpub.substring(0, 20),
              })));

              // Build the internal MultisigConfig for MultisigWallet class
              const multisigWalletConfig: TypeMultisigConfig = {
                m: config.m,
                n: config.n,
                scriptType: getScriptType(config.scriptType),
                cosigners: cosignersFromDescriptor,
                derivationPath: `m/48'/0'/0'/2'`,
                sortedKeys: parsedDescriptor.type === 'sortedmulti',
              };

              const multisigWallet = MultisigWallet.fromConfig(multisigWalletConfig, 'mainnet');

              if (!multisigWallet.isComplete()) {
                throw new Error('MultisigWallet configuration is incomplete after parsing descriptor');
              }

              log(' Deriving receiving addresses from descriptor...');
              const msDescGapLimit = useSettingsStore.getState().gapLimit;
              const receivingAddresses = multisigWallet.deriveReceivingAddresses(msDescGapLimit, 0);
              for (const addr of receivingAddresses) {
                addresses.push({
                  address: addr.address,
                  path: addr.path,
                  index: addr.index,
                  isChange: false,
                  type: addr.type,
                });
              }
              log(' First receiving address:', addresses[0]?.address);

              log(' Deriving change addresses from descriptor...');
              const changeAddresses = multisigWallet.deriveChangeAddresses(CHANGE_ADDRESS_COUNT, 0);
              for (const addr of changeAddresses) {
                addresses.push({
                  address: addr.address,
                  path: addr.path,
                  index: addr.index,
                  isChange: true,
                  type: addr.type,
                });
              }
            } catch (parseError) {
              throw new Error(`Failed to derive addresses: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
            }
          }

          log(' Multisig wallet created with', addresses.length, 'addresses');
          log(' Sample addresses:', {
            first: addresses[0]?.address,
            second: addresses[1]?.address,
            firstChange: addresses.find(a => a.isChange)?.address,
          });

          // Store metadata
          await SecureStorage.storeWalletMetadata({
            network: 'mainnet',
            addressCount: addresses.length,
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
            createdAt: Date.now(),
            isMultisig: true,
            multisigConfig: {
              m: config.m,
              n: config.n,
              scriptType: config.scriptType,
              walletName: config.walletName,
              cosigners: config.cosigners,
            },
          });

          // Set up address indices based on actual multisig script type
          const msIndicesGapLimit = useSettingsStore.getState().gapLimit;
          const msAddrType = (() => {
            switch (config.scriptType) {
              case 'p2sh-p2wsh': return 'wrapped_segwit';
              case 'p2sh': return 'legacy';
              default: return 'native_segwit';
            }
          })();
          const newIndices: AddressIndices = {
            native_segwit: { receiving: 0, change: 0 },
            wrapped_segwit: { receiving: 0, change: 0 },
            legacy: { receiving: 0, change: 0 },
            taproot: { receiving: 0, change: 0 },
          };
          newIndices[msAddrType] = { receiving: msIndicesGapLimit, change: CHANGE_ADDRESS_COUNT };

          const msWalletId = `multisig-${Date.now()}`;

          // Also store per-wallet metadata so switchToWallet() can find the multisig config
          await SecureStorage.storeWalletMetadataById(msWalletId, {
            network: 'mainnet',
            addressCount: addresses.length,
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
            createdAt: Date.now(),
            isMultisig: true,
            multisigConfig: {
              m: config.m,
              n: config.n,
              scriptType: config.scriptType,
              walletName: config.walletName,
              cosigners: config.cosigners,
            },
          });

          set({
            isLoading: false,
            isLocked: false,
            walletId: msWalletId,
            addresses,
            addressIndices: newIndices,
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
            isMultisig: true,
            multisigConfig: config,
            // Clear stale data from previous wallet (DB-first: new wallet has no data yet)
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            transactions: [],
            utxos: [],
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map(),
            lastSync: null,
          });

          // Build multisig config for DB
          const dbMultisigConfig: TypeMultisigConfig = {
            m: config.m,
            n: config.n,
            scriptType: config.scriptType as any,
            cosigners: config.cosigners.map((c, i) => ({
              id: `cosigner-${i}`,
              name: c.name || `Cosigner ${i + 1}`,
              fingerprint: c.fingerprint || '',
              xpub: c.xpub || '',
              derivationPath: c.derivationPath || "m/48'/0'/0'/2'",
              isLocal: c.isLocal || false,
            })),
            derivationPath: "m/48'/0'/0'/2'",
            sortedKeys: true,
          };

          // Insert wallet directly into SQLite database
          syncNewWalletToDb({
            walletId: msWalletId,
            name: config.walletName || 'Multisig Wallet',
            walletType: 'multisig',
            importSource: 'descriptor',
            descriptor: config.descriptor,
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
            isMultisig: true,
            multisigConfig: dbMultisigConfig,
            addresses,
          }, {
            secretType: 'mnemonic',
          });

          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to create multisig wallet',
          });
          return false;
        }
      },

      // Unlock wallet with PIN
      unlock: async (pin: string) => {
        set({ isLoading: true, error: null });

        try {
          const isValid = await SecureStorage.verifyPin(pin);
          if (!isValid) {
            set({ isLoading: false, error: 'Invalid PIN' });
            return false;
          }

          // Cache PIN in session for wallet switching, xpub, descriptor flows
          if (pin) SensitiveSession.start(pin);

          // Get metadata for preferred address type
          const metadata = await SecureStorage.getWalletMetadata<{
            addressCount: number;
            network?: 'mainnet' | 'testnet';
            preferredAddressType?: AddressType;
          }>();

          // Unlock immediately — navigate first, derive addresses in background
          set({
            isLoading: false,
            isLocked: false,
            addresses: [],
            preferredAddressType: metadata?.preferredAddressType || ADDRESS_TYPES.NATIVE_SEGWIT,
          });

          // Helper: yield to JS event loop so UI can render frames (~1 frame at 60fps)
          const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 16));

          // Derive addresses after navigation animations complete
          InteractionManager.runAfterInteractions(async () => {
            try {
              // Check if the active wallet is a watch-only type.
              // If so, use switchToWallet which loads addresses from WalletManager data
              // instead of deriving from the HD seed.
              const activeWallet = useMultiWalletStore.getState().getActiveWallet();
              const activeType = activeWallet?.type;
              if (activeType === 'watch_xpub' || activeType === 'watch_addresses' || activeType === 'watch_descriptor') {
                await get().switchToWallet(activeWallet!.id, pin);
                return;
              }

              const network = get().network;
              const activeId = activeWallet?.id;

              // ─── DB FAST PATH: Load entire wallet state from SQLite ───
              if (activeId) {
                const v2State = loadWalletFromDB(activeId);
                if (v2State && v2State.addresses.length > 0) {
                  SyncLogger.log('wallet', `DB unlock: loaded ${v2State.addresses.length} addresses, balance=${v2State.balance.total} for ${activeId}`);

                  // CRITICAL FIX: Derive isMultisig from wallet type, NOT from V2 file
                  const isMultisigWallet = activeType === 'multisig';
                  const multisigConfigToUse = isMultisigWallet ? v2State.multisigConfig : null;

                  // Log warning if V2 file and wallet type disagree
                  if (v2State.isMultisig !== isMultisigWallet) {
                    SyncLogger.log('wallet', `unlock isMultisig MISMATCH: V2=${v2State.isMultisig}, walletType=${activeType}, using walletType=${isMultisigWallet}`);
                  }

                  set({
                    walletId: activeId,
                    addresses: v2State.addresses,
                    addressIndices: v2State.addressIndices,
                    preferredAddressType: v2State.preferredAddressType,
                    usedAddresses: v2State.usedAddresses,
                    balance: v2State.balance,
                    utxos: v2State.utxos,
                    transactions: v2State.transactions,
                    trackedTransactions: v2State.trackedTransactions,
                    lastSync: v2State.lastSync,
                    isMultisig: isMultisigWallet,
                    multisigConfig: multisigConfigToUse,
                  });
                  // Background refresh if stale (> 5 minutes)
                  const cacheAge = v2State.lastSync ? Date.now() - v2State.lastSync : Infinity;
                  if (cacheAge > CACHE_STALE_THRESHOLD) {
                    SyncLogger.log('wallet', `V2 data is stale (${Math.round(cacheAge / 1000)}s), refreshing in background`);
                    get().refreshBalance();
                  } else {
                  }
                  return;
                }
              }

              // Multisig wallets need MultisigWallet class for address derivation — delegate to switchToWallet
              if (activeId && (activeType === 'multisig' || activeId.startsWith('multisig-'))) {
                await get().switchToWallet(activeId, pin);
                return;
              }

              const mnemonic = await SecureStorage.retrieveSeed(pin);
              if (!mnemonic) {
                return;
              }

              const seed = await SeedGenerator.toSeed(mnemonic);
              const keyDerivation = new KeyDerivation(seed, network);

              const storedNetwork = metadata?.network;
              // Use gap limit from settings (user-configurable)
              const settingsGapLimit = useSettingsStore.getState().gapLimit;
              // metadata.addressCount is TOTAL across all types + change
              // Divide by number of types (4) and subtract change (10 each) to get per-type receiving count
              const totalStored = metadata?.addressCount || 0;
              const perTypeReceiving = totalStored > 0
                ? Math.ceil((totalStored - 40) / 4) // subtract 4 types x 10 change = 40
                : settingsGapLimit;
              // Clamp to reasonable range
              const addressCount = storedNetwork === network
                ? Math.max(settingsGapLimit, Math.min(perTypeReceiving, DERIVATION.MAX_GAP_LIMIT))
                : settingsGapLimit;

              const CHANGE_ADDRESS_COUNT = 10;

              SyncLogger.log('wallet', `Deriving ${addressCount} addresses per type (${ALL_ADDRESS_TYPES.length} types, gap=${settingsGapLimit})`);

              // Use shared AddressService for async batch derivation (yields every 10 to keep UI responsive)
              const addresses = await deriveAddressBatchAsync(keyDerivation, {
                addressTypes: ALL_ADDRESS_TYPES,
                receivingCount: addressCount,
                changeCount: CHANGE_ADDRESS_COUNT,
              });

              // Extract xpubs + descriptors using shared utility
              let pendingXpubEntries: { xpub: string; derivationPath: string; scriptType: string; fingerprint?: string | null }[] | null = null;
              let pendingDescriptorEntries: { descriptor: string; isRange?: boolean; internal?: boolean }[] | null = null;
              if (activeId) {
                try {
                  const generated = generateXpubsAndDescriptors(keyDerivation);
                  pendingXpubEntries = generated.xpubs;
                  pendingDescriptorEntries = generated.descriptors;
                  SyncLogger.log('wallet', `Extracted xpubs + descriptors for ${activeId} (will cache after V2 file exists)`);
                } catch (e) {
                }
              }

              keyDerivation.destroy();
              SyncLogger.log('wallet', `Address derivation complete: ${addresses.length} total addresses`);

              await SecureStorage.storeWalletMetadata({
                ...metadata,
                network,
                addressCount: addresses.length,
                preferredAddressType: metadata?.preferredAddressType || ADDRESS_TYPES.NATIVE_SEGWIT,
              });

              const newIndices: AddressIndices = {
                native_segwit: { receiving: addressCount, change: CHANGE_ADDRESS_COUNT },
                wrapped_segwit: { receiving: addressCount, change: CHANGE_ADDRESS_COUNT },
                legacy: { receiving: addressCount, change: CHANGE_ADDRESS_COUNT },
                taproot: { receiving: addressCount, change: CHANGE_ADDRESS_COUNT },
              };

              set({
                addresses,
                addressIndices: newIndices,
                ...(activeId ? { walletId: activeId } : {}),
              });

              // Backfill DB: update seedHex, descriptor, fingerprint, xpubs, descriptors if null
              if (activeId) {
                try {
                  const db = WalletDatabase.shared();
                  const dbWallet = db.getWallet(activeId);
                  if (dbWallet) {
                    const updates: Partial<WalletRow> = {};
                    if (!dbWallet.seedHex) {
                      updates.seedHex = seed.toString('hex');
                    }
                    if (!dbWallet.descriptor && pendingDescriptorEntries && pendingDescriptorEntries.length > 0) {
                      const primaryDesc = pendingDescriptorEntries.find(d => !d.internal)?.descriptor;
                      if (primaryDesc) updates.descriptor = primaryDesc;
                    }
                    if (!dbWallet.fingerprint && pendingXpubEntries && pendingXpubEntries.length > 0) {
                      updates.fingerprint = pendingXpubEntries[0].fingerprint;
                    }
                    if (Object.keys(updates).length > 0) {
                      db.updateWallet(activeId, updates);
                      SyncLogger.log('backfill', `Updated wallet DB row for ${activeId}: ${Object.keys(updates).join(', ')}`);
                    }
                    // Backfill xpubs if missing
                    if (pendingXpubEntries && db.getXpubs(activeId).length === 0) {
                      db.insertXpubs(pendingXpubEntries.map(x => ({
                        walletId: activeId, xpub: x.xpub, derivationPath: x.derivationPath,
                        scriptType: x.scriptType, fingerprint: x.fingerprint ?? null,
                      })));
                    }
                    // Backfill descriptors if missing
                    if (pendingDescriptorEntries && db.getDescriptors(activeId).length === 0) {
                      db.insertDescriptors(pendingDescriptorEntries.map(d => ({
                        walletId: activeId, descriptor: d.descriptor,
                        isRange: d.isRange ? 1 : 0, checksum: null, internal: d.internal ? 1 : 0,
                      })));
                    }
                  }
                } catch { /* DB backfill non-critical */ }
              }

              // Refresh balance now that addresses are available
              get().refreshBalance();
            } catch (error) {
              // Surface the error so the UI can inform the user instead of showing empty state
              set({
                error: error instanceof Error ? error.message : 'Address derivation failed',
              });
            }
          });

          return true;
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to unlock wallet',
          });
          return false;
        }
      },

      // Lock wallet
      // manualLock parameter indicates the user manually locked (vs auto-lock or initial load)
      // This is used to suppress auto-biometric prompt
      lock: (manualLock = false) => {
        SensitiveSession.invalidate();
        SecureStorage.clearKeyCache();
        set({
          isLocked: true,
          wasManuallyLocked: manualLock,
          // Clear sensitive data
          utxos: [],
        });
      },

      // Re-read wallet data from SQLite into Zustand (DB is source of truth)
      reloadFromDB: (): boolean => {
        const { walletId } = get();
        if (!walletId) return false;
        const dbState = loadWalletFromDB(walletId);
        if (!dbState) {
          SyncLogger.warn('reload', `reloadFromDB: wallet ${walletId} not found in DB`);
          return false;
        }
        set({
          addresses: dbState.addresses,
          addressIndices: dbState.addressIndices,
          balance: dbState.balance,
          utxos: dbState.utxos,
          transactions: dbState.transactions,
          usedAddresses: dbState.usedAddresses,
          lastSync: dbState.lastSync,
        });
        return true;
      },

      // Refresh balance from blockchain using Electrum
      refreshBalance: async () => {
        logger.perfStart('refresh-balance');
        log(' ========== refreshBalance START ==========');
        const { addresses, network, isLoading, isRefreshing, usedAddresses, lastSync, trackedTransactions } = get();
        SyncLogger.log('sync', `refreshBalance START — ${addresses.length} addresses, network=${network}, walletId=${get().walletId}, isMultisig=${get().isMultisig}`);

        if (addresses.length === 0) {
          SyncLogger.warn('sync', 'Skipping refresh — no addresses derived yet');
          return;
        }

        // Prevent concurrent refreshes (with stale-guard safety net)
        if (isLoading || isRefreshing) {
          const stuckDuration = Date.now() - refreshStartedAt;
          if (stuckDuration < REFRESH_TIMEOUT) {
            log(' Skipping refresh - already loading/refreshing');
            SyncLogger.warn('sync', 'Skipping refresh — already in progress');
            return;
          }
          // Refresh has been running too long — force-clear and allow a new one
          SyncLogger.warn('sync', `Refresh stuck for ${Math.round(stuckDuration / 1000)}s — force-clearing and retrying`);
          set({ isLoading: false, isRefreshing: false });
        }

        // Use isLoading for initial load (no lastSync), isRefreshing for background updates
        refreshStartedAt = Date.now();
        const isInitialLoad = lastSync === null;
        if (isInitialLoad) {
          set({ isLoading: true, error: null });
        } else {
          set({ isRefreshing: true, error: null });
        }

        // Update multiWalletStore with syncing status
        const { walletId } = get();
        if (walletId) {
          useMultiWalletStore.getState().updateWalletSync(walletId, 'syncing');
        }

        // ── DB Engine Path: delegate to WalletEngine (loads from SQLite DB) ──
        if (walletId) {
          try {
            const engine = WalletEngine.shared();
            engine.loadWallet(walletId);
            const outcome = await engine.syncWallet(walletId, { force: true });

            // Guard: if user switched wallets during async sync, discard stale results
            if (get().walletId !== walletId) {
              SyncLogger.warn('sync', `refreshBalance aborted — wallet switched from ${walletId} to ${get().walletId}`);
              set({ isLoading: false, isRefreshing: false });
              return;
            }

            if (outcome.ok) {
              // DB-first: engine already committed to SQLite, re-read from DB
              // Batch DB reload + loading flags into reloadFromDB to reduce set() calls
              const dbState = loadWalletFromDB(walletId);
              if (dbState) {
                set({
                  addresses: dbState.addresses,
                  addressIndices: dbState.addressIndices,
                  balance: dbState.balance,
                  utxos: dbState.utxos,
                  transactions: dbState.transactions,
                  usedAddresses: dbState.usedAddresses,
                  lastSync: dbState.lastSync,
                  isLoading: false,
                  isRefreshing: false,
                });
              } else {
                set({ isLoading: false, isRefreshing: false });
              }

              const { balance, utxos, transactions } = get();
              useMultiWalletStore.getState().updateWalletSync(
                walletId, 'synced', balance.total, balance.unconfirmed
              );
              logger.perfEnd('refresh-balance');
              SyncLogger.log('sync', `Sync OK (DB-first) — balance=${balance.total} sats, utxos=${utxos.length}, txs=${transactions.length}`);

              // Wire up real-time subscription listeners
              // Clean up any previous listeners first
              for (const cleanup of subscriptionCleanups) { cleanup(); }
              subscriptionCleanups = [];

              const subMgr = SubscriptionManager.shared();

              // On new transaction or balance change from subscriptions
              //
              // SubscriptionManager detects changes via scripthash subscriptions but:
              // 1. Does NOT have prevout resolution → wrong self-transfer direction/amounts
              // 2. May receive partial UTXO sets during race conditions (e.g. send address
              //    notified before change address) → DELETE+INSERT would wipe valid UTXOs
              //
              // Strategy:
              // - DO NOT write to the database from subscriptions (no commitSyncResults)
              // - Update Zustand state in-memory for instant UI feedback (balance + UTXOs)
              // - Trigger a proper WalletSyncManager sync which goes through the full
              //   SyncPipeline with prevout resolution → correct DB persistence
              const unsubTx = subMgr.onTransaction((update: RealtimeUpdate) => {
                const currentWalletId = get().walletId;
                if (currentWalletId !== walletId) return; // Stale wallet

                SyncLogger.log('realtime', `Subscription update: ${update.newTxids.length} new txs, balance=${update.balance.total}`);

                // Step 1: Update Zustand in-memory state for instant UI (no DB write)
                // Convert subscription UTXOs to the store's UTXO format
                const storeUtxos = update.utxos.map(u => ({
                  txid: u.txid,
                  vout: u.vout,
                  value: u.valueSat,
                  address: u.address,
                  scriptPubKey: u.scriptPubKey,
                  confirmations: u.confirmations,
                }));
                set({
                  balance: {
                    confirmed: update.balance.confirmed,
                    unconfirmed: update.balance.unconfirmed,
                    total: update.balance.total,
                  },
                  utxos: storeUtxos,
                });

                // Step 2: Update multiWalletStore with new balance
                useMultiWalletStore.getState().updateWalletSync(
                  walletId, 'synced', update.balance.total, update.balance.unconfirmed
                );

                // Step 3: Trigger a proper sync for DB persistence + correct tx data
                // Debounced to collapse rapid subscription events (block gossip) into one sync.
                // In-memory UI update (balance/UTXOs above) is already instant.
                if (update.newTxids.length > 0) {
                  SyncLogger.log('realtime', `${update.newTxids.length} new txs detected — scheduling debounced sync for DB persistence`);
                }
                if (subscriptionSyncTimer) clearTimeout(subscriptionSyncTimer);
                subscriptionSyncTimer = setTimeout(() => {
                  subscriptionSyncTimer = null;
                  WalletSyncManager.shared().onTransactionBroadcasted(walletId).catch(() => {});
                }, SUBSCRIPTION_SYNC_DEBOUNCE_MS);
              });
              subscriptionCleanups.push(unsubTx);

              // On block height change — update confirmations
              const unsubBlock = subMgr.onBlockHeight((_height: number) => {
                if (get().walletId !== walletId) return;
                SyncLogger.log('realtime', `New block at height ${_height}`);
              });
              subscriptionCleanups.push(unsubBlock);

              return;
            } else {
              // Engine sync failed — LKG preserved, data stays as loaded from DB
              logger.perfEnd('refresh-balance');
              SyncLogger.warn('sync', `Engine sync failed: ${outcome.error} — preserving DB data`);
              set({ isLoading: false, isRefreshing: false });
              useMultiWalletStore.getState().updateWalletSync(
                walletId, 'error', undefined, undefined, outcome.error
              );
              return;
            }
          } catch (engineErr) {
            logger.perfEnd('refresh-balance');
            SyncLogger.error('sync', `Engine error: ${engineErr instanceof Error ? engineErr.message : engineErr}`);
            set({ isLoading: false, isRefreshing: false });
            useMultiWalletStore.getState().updateWalletSync(
              walletId, 'error', undefined, undefined, engineErr instanceof Error ? engineErr.message : 'Sync failed'
            );
            return;
          }
        }

      },

      // Get first unused address of a specific type
      getFirstUnusedAddress: (type: AddressType) => {
        const { addresses, usedAddresses } = get();
        const walletMode = useSettingsStore.getState().walletMode;

        // Filter addresses by type and find first unused
        const addressesOfType = addresses.filter(a => a.type === type && !a.isChange);

        // Sort by index to ensure we get the lowest index first
        addressesOfType.sort((a, b) => a.index - b.index);

        // Simple mode: always return index-0 address
        if (walletMode === 'simple') {
          const firstAddress = addressesOfType[0] || null;
          log(' getFirstUnusedAddress (simple mode) type:', type, 'returning index-0:', firstAddress?.address?.slice(0, 15));
          return firstAddress;
        }

        // HD mode: find first address that's not in usedAddresses set
        const unusedAddress = addressesOfType.find(a => !usedAddresses.has(a.address));

        const usedCount = addressesOfType.filter(a => usedAddresses.has(a.address)).length;
        log(' getFirstUnusedAddress type:', type,
          'total:', addressesOfType.length,
          'usedCount:', usedCount,
          'found:', unusedAddress?.address?.slice(0, 15));

        // Check if gap limit extension is needed
        const settingsGapLimit = useSettingsStore.getState().gapLimit;
        const unusedCount = addressesOfType.length - usedCount;
        if (unusedCount < Math.min(5, settingsGapLimit)) {
          log(' ⚠️ Gap limit running low for', type, '- only', unusedCount, 'unused addresses remaining');
        }

        // If all addresses are used, return the last one
        // UI should call extendAddressGap to derive more when needed
        return unusedAddress || addressesOfType[addressesOfType.length - 1] || null;
      },

      // Mark an address as used (called when we detect a transaction to this address)
      markAddressAsUsed: (address: string) => {
        const { usedAddresses } = get();
        if (!usedAddresses.has(address)) {
          const newUsedAddresses = new Set(usedAddresses);
          newUsedAddresses.add(address);
          set({ usedAddresses: newUsedAddresses });
          log(' Marked address as used:', address.slice(0, 15));
        }
      },

      // Check if gap limit needs extension for a specific address type
      // Returns true if all derived addresses are used and we need more
      needsGapExtension: (type: AddressType) => {
        // WIF wallets never need gap extension — fixed set of addresses
        const activeWallet = useMultiWalletStore.getState().getActiveWallet();
        if (activeWallet?.type === 'imported_key' || activeWallet?.type === 'imported_keys') {
          return false;
        }

        const { addresses, usedAddresses } = get();
        const settingsGapLimit = useSettingsStore.getState().gapLimit;

        // Get all receiving addresses of this type
        const addressesOfType = addresses.filter(a => a.type === type && !a.isChange);
        if (addressesOfType.length === 0) return false;

        // Count unused addresses
        const unusedCount = addressesOfType.filter(a => !usedAddresses.has(a.address)).length;

        // If we have fewer than 5 unused addresses, we need more
        // This ensures we always have a buffer of unused addresses
        const needsMore = unusedCount < Math.min(5, settingsGapLimit);

        if (needsMore) {
          log(' needsGapExtension:', type, 'total:', addressesOfType.length, 'unused:', unusedCount, '→ needs extension');
        }

        return needsMore;
      },

      // Extend address gap by deriving a new batch of addresses for the specified type
      // Returns the number of addresses derived
      extendAddressGap: async (pin: string, type?: AddressType) => {
        const { network, addressIndices, addresses, preferredAddressType } = get();
        const addressType = type || preferredAddressType;
        const walletMode = useSettingsStore.getState().walletMode;
        const settingsGapLimit = useSettingsStore.getState().gapLimit;

        if (walletMode === 'simple') {
          log(' extendAddressGap (simple mode) - skipped');
          return 0;
        }

        try {
          const walletId = get().walletId;
          const activeWallet = walletId ? useMultiWalletStore.getState().getActiveWallet() : null;
          if (!walletId || !activeWallet) return 0;

          // WIF wallets have fixed addresses — gap extension not applicable
          if (activeWallet.type === 'imported_key' || activeWallet.type === 'imported_keys') {
            return 0;
          }

          // Multisig wallets use MultisigWallet for derivation — single-sig KeyDerivation is wrong
          if (activeWallet.type === 'multisig') {
            log(' extendAddressGap: skipping for multisig wallet (uses MultisigWallet derivation)');
            return 0;
          }

          // Use shared KeyDerivationFactory
          const kd = await keyDerivationFromSecureStorage(walletId, activeWallet.type, network, pin);
          const currentIndex = addressIndices[addressType].receiving;

          log(' extendAddressGap: deriving', settingsGapLimit, 'new', addressType, 'addresses starting at index', currentIndex);

          // Use shared AddressService for batch derivation + DB persistence
          const newAddresses = deriveAndPersistAddresses(walletId, kd, {
            addressTypes: [addressType],
            receivingCount: settingsGapLimit,
            changeCount: 0,
            startReceivingIndex: currentIndex,
          });

          kd.destroy();

          // Update indices
          const newIndices = { ...addressIndices };
          newIndices[addressType].receiving = currentIndex + settingsGapLimit;

          set({
            addresses: [...addresses, ...newAddresses],
            addressIndices: newIndices,
          });

          log(' extendAddressGap: derived', newAddresses.length, 'new addresses');
          return newAddresses.length;
        } catch (err) {
          log(' extendAddressGap error:', err);
          return 0;
        }
      },

      // Derive a new receiving address
      deriveNewAddress: async (pin: string, type?: AddressType) => {
        const { network, addressIndices, addresses, preferredAddressType } = get();
        const addressType = type || preferredAddressType;
        const walletMode = useSettingsStore.getState().walletMode;

        // Simple mode: don't derive new addresses, return index-0
        if (walletMode === 'simple') {
          log(' deriveNewAddress (simple mode) - returning existing index-0 address');
          return get().getFirstUnusedAddress(addressType);
        }

        try {
          const walletId = get().walletId;
          const activeWallet = walletId ? useMultiWalletStore.getState().getActiveWallet() : null;
          if (!walletId || !activeWallet) return null;

          // WIF wallets cannot derive new addresses — return the existing address for this type
          if (activeWallet.type === 'imported_key' || activeWallet.type === 'imported_keys') {
            return get().getFirstUnusedAddress(addressType);
          }

          // Multisig wallets use MultisigWallet for derivation — return existing address
          if (activeWallet.type === 'multisig') {
            log(' deriveNewAddress: skipping for multisig wallet (uses MultisigWallet derivation)');
            return get().getFirstUnusedAddress(addressType);
          }

          // Use shared KeyDerivationFactory
          const kd = await keyDerivationFromSecureStorage(walletId, activeWallet.type, network, pin);
          const currentIndex = addressIndices[addressType].receiving;

          // Use shared AddressService — derive + persist in one call
          const newAddress = deriveSingleAddress(walletId, kd, addressType, false, currentIndex);
          kd.destroy();

          // Update indices
          const newIndices = { ...addressIndices };
          newIndices[addressType].receiving = currentIndex + 1;

          await SecureStorage.storeWalletMetadata({
            network,
            addressCount: addresses.length + 1,
            preferredAddressType: preferredAddressType,
            updatedAt: Date.now(),
          });

          set({
            addresses: [...addresses, newAddress],
            addressIndices: newIndices,
          });

          return newAddress;
        } catch {
          return null;
        }
      },

      // Get a change address of the specified type
      getChangeAddress: async (pin: string, type?: AddressType) => {
        const { network, addressIndices, preferredAddressType } = get();
        const addressType = type || preferredAddressType;
        const walletMode = useSettingsStore.getState().walletMode;

        // Simple mode: send change back to the same receiving address (index-0)
        if (walletMode === 'simple') {
          log(' getChangeAddress (simple mode) - returning index-0 receiving address');
          return get().getFirstUnusedAddress(addressType);
        }

        try {
          const walletId = get().walletId;
          const activeWallet = walletId ? useMultiWalletStore.getState().getActiveWallet() : null;
          if (!walletId || !activeWallet) return null;

          // WIF wallets have no change addresses — return the receiving address of the preferred type
          if (activeWallet.type === 'imported_key' || activeWallet.type === 'imported_keys') {
            const { addresses } = get();
            return addresses.find(a => a.type === addressType && !a.isChange)
              || addresses.find(a => !a.isChange)
              || addresses[0] || null;
          }

          // Multisig wallets use MultisigWallet for derivation — return existing change address
          if (activeWallet.type === 'multisig') {
            log(' getChangeAddress: skipping for multisig wallet (uses MultisigWallet derivation)');
            const { addresses: msAddresses } = get();
            return msAddresses.find(a => a.isChange && a.type === addressType)
              || msAddresses.find(a => a.isChange)
              || msAddresses[0] || null;
          }

          // Use shared KeyDerivationFactory
          const kd = await keyDerivationFromSecureStorage(walletId, activeWallet.type, network, pin);
          const currentIndex = addressIndices[addressType].change;

          // Use shared AddressService — derive + persist in one call
          const changeAddress = deriveSingleAddress(walletId, kd, addressType, true, currentIndex);
          kd.destroy();

          // Update indices
          const newIndices = { ...addressIndices };
          newIndices[addressType].change = currentIndex + 1;

          // Check if this change address is already in the addresses array
          const { addresses } = get();
          const alreadyExists = addresses.some(a => a.address === changeAddress.address);

          if (alreadyExists) {
            set({ addressIndices: newIndices });
          } else {
            set({
              addresses: [...addresses, changeAddress],
              addressIndices: newIndices,
            });
          }

          return changeAddress;
        } catch (err: any) {
          SyncLogger.error('wallet', `getChangeAddress FAILED: ${err?.message || err}`);
          return null;
        }
      },

      // Get current UTXOs (DB-first: read from SQLite, never directly from Electrum)
      getUTXOs: async () => {
        const { utxos, walletId } = get();

        // If we have cached UTXOs in Zustand, return them
        if (utxos.length > 0) {
          return utxos;
        }

        // Otherwise re-read from DB (the single source of truth)
        if (walletId) {
          const db = WalletDatabase.shared();
          const rows = db.getUtxos(walletId);
          const dbUtxos: UTXO[] = rows.map(u => ({
            txid: u.txid,
            vout: u.vout,
            value: u.valueSat,
            address: u.address,
            scriptPubKey: u.scriptPubKey,
            confirmations: u.confirmations,
          }));
          if (dbUtxos.length > 0) {
            set({ utxos: dbUtxos });
          }
          return dbUtxos;
        }

        return utxos;
      },

      // Change network
      setNetwork: async (network: 'mainnet' | 'testnet') => {
        // Update stored metadata with new network
        try {
          const existingMetadata = await SecureStorage.getWalletMetadata<{
            addressCount: number;
            createdAt?: number;
            preferredAddressType?: AddressType;
          }>();

          await SecureStorage.storeWalletMetadata({
            ...existingMetadata,
            network,
            addressCount: existingMetadata?.addressCount || useSettingsStore.getState().gapLimit * 3,
          });
        } catch (error) {
        }

        set({
          network,
          // Reset state for new network - addresses will be re-derived on unlock
          addresses: [],
          balance: { confirmed: 0, unconfirmed: 0, total: 0 },
          utxos: [],
          lastSync: null,
          // Reset address indices for the new network
          addressIndices: { ...initialAddressIndices },
        });
      },

      // Detect the best default address type for imported wallets.
      // Priority: type with most balance → most transaction count → native_segwit
      detectBestAddressType: () => {
        const { addresses, utxos } = get();
        const types: AddressType[] = [
          ADDRESS_TYPES.NATIVE_SEGWIT,
          ADDRESS_TYPES.TAPROOT,
          ADDRESS_TYPES.WRAPPED_SEGWIT,
          ADDRESS_TYPES.LEGACY,
        ];

        // Calculate balance per address type from UTXOs
        const balanceByType: Record<string, number> = {};
        const txCountByType: Record<string, number> = {};

        for (const type of types) {
          const typeAddresses = new Set(
            addresses.filter(a => a.type === type).map(a => a.address),
          );
          // Sum UTXO values for this type
          balanceByType[type] = utxos
            .filter(u => typeAddresses.has(u.address))
            .reduce((sum, u) => sum + u.value, 0);
          // Count addresses that have been used (have any UTXOs or are in usedAddresses)
          const { usedAddresses } = get();
          txCountByType[type] = addresses
            .filter(a => a.type === type && usedAddresses.has(a.address))
            .length;
        }

        // Find type with highest balance
        let bestType: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT;
        let bestBalance = 0;
        for (const type of types) {
          if (balanceByType[type] > bestBalance) {
            bestBalance = balanceByType[type];
            bestType = type;
          }
        }

        // If all balances are 0, use type with most used addresses
        if (bestBalance === 0) {
          let bestTxCount = 0;
          for (const type of types) {
            if (txCountByType[type] > bestTxCount) {
              bestTxCount = txCountByType[type];
              bestType = type;
            }
          }
        }

        // If still nothing, default to native_segwit (already set above)
        return bestType;
      },

      // Set preferred address type
      setPreferredAddressType: (type: AddressType) => {
        set({ preferredAddressType: type });

        // Also update in metadata
        SecureStorage.getWalletMetadata().then(metadata => {
          SecureStorage.storeWalletMetadata({
            ...(metadata || {}),
            preferredAddressType: type,
          });
        });
      },

      // Delete ALL wallet data, credentials, caches, and app state.
      // Delegates to AppStateManager.resetWalletToFreshInstall() which:
      //  - Stops all networking & sync
      //  - Deletes wallet files & directories
      //  - Clears SecureStore, AsyncStorage, in-memory caches
      //  - Optionally archives wallets (preserve-on-delete) and deletes iCloud backups
      //  - Verifies fresh-install state
      deleteWallet: async (options?: { pin?: string; deleteCloudBackups?: boolean }) => {
        // Use require() to avoid circular import (AppStateManager imports walletStore)
        const { AppStateManager } = require('../services/AppStateManager');
        await AppStateManager.resetWalletToFreshInstall(options ?? {});
      },

      // Clear error state
      clearError: () => set({ error: null }),

      // Clear manual lock flag (called after successful unlock)
      clearManualLockFlag: () => set({ wasManuallyLocked: false }),

      // Multisig helper: Check if we can sign locally
      canSignMultisig: () => {
        const { isMultisig, multisigConfig } = get();
        if (!isMultisig || !multisigConfig) return false;
        return multisigConfig.cosigners.some(c => c.isLocal);
      },

      // Multisig helper: Get local cosigners (ones we can sign with)
      getLocalCosigners: () => {
        const { isMultisig, multisigConfig } = get();
        if (!isMultisig || !multisigConfig) return [];
        return multisigConfig.cosigners.filter(c => c.isLocal);
      },

      // Multisig helper: Get human-readable script type label
      getMultisigScriptTypeLabel: () => {
        const { multisigConfig } = get();
        if (!multisigConfig) return '';
        switch (multisigConfig.scriptType) {
          case 'p2wsh':
            return 'Native SegWit (P2WSH)';
          case 'p2sh-p2wsh':
            return 'Wrapped SegWit (P2SH-P2WSH)';
          case 'p2sh':
            return 'Legacy (P2SH)';
          default:
            return multisigConfig.scriptType;
        }
      },

      // Switch to a different wallet (multi-wallet support)
      switchToWallet: async (walletId: string, pin?: string) => {
        logger.perfStart('switch-wallet');
        log(' switchToWallet called for:', walletId);

        // Request ID gating — prevents race conditions during rapid wallet switching
        const requestId = `switch_${walletId}_${Date.now()}`;
        currentSwitchRequestId = requestId;

        // ─── CLEANUP: Tear down previous wallet's state ───
        // 1. Clean up old Electrum subscription listeners
        for (const cleanup of subscriptionCleanups) { cleanup(); }
        subscriptionCleanups = [];

        // 2. Reset refresh guard so new wallet sync isn't blocked
        refreshStartedAt = 0;

        // 3. Reset sendStore — clear stale PSBTs, signed txs, UTXOs from previous wallet
        try {
          const { useSendStore } = require('./sendStore');
          useSendStore.getState().reset();
        } catch {}

        // 4. Clear wallet-specific Zustand state to prevent stale data leaks between wallets
        set({
          addresses: [],
          utxos: [],
          transactions: [],
          balance: { confirmed: 0, unconfirmed: 0, total: 0 },
          usedAddresses: new Set<string>(),
          trackedTransactions: new Map<string, TrackedTransaction>(),
          addressIndices: { ...initialAddressIndices },
          isMultisig: false,
          multisigConfig: null,
          lastSync: null,
          isLoading: true,
          error: null,
        });

        // Get PIN from session if not provided
        const effectivePin = pin || SensitiveSession.getPin();

        try {
          // Check wallet type from multiWalletStore
          const walletInfo = useMultiWalletStore.getState().getWallet(walletId);
          const walletType = walletInfo?.type;
          const isWatchOnly = walletType === 'watch_xpub' || walletType === 'watch_addresses' || walletType === 'watch_descriptor';

          // ─── DB FAST PATH: Load entire wallet state from SQLite ───
          const v2State = loadWalletFromDB(walletId);
          log(' DB fast path result:', v2State ? `found (addrs=${v2State.addresses.length}, isMultisig=${v2State.isMultisig}, hasConfig=${!!v2State.multisigConfig})` : 'null');

          if (v2State && v2State.addresses.length > 0) {
            log(' Loading wallet from V2 file:', walletId, 'addresses:', v2State.addresses.length, 'balance:', v2State.balance.total);
            SyncLogger.log('switch', `V2 fast path HIT: ${walletId}, addrs=${v2State.addresses.length}, balance=${v2State.balance.total}, txs=${v2State.transactions.length}, utxos=${v2State.utxos.length}, isMultisig=${v2State.isMultisig}, lastSync=${v2State.lastSync}`);
            SyncLogger.log('switch', `V2 first 3 addrs: ${v2State.addresses.slice(0,3).map(a => a.address.slice(0,15)+'...').join(', ')}`);

            if (currentSwitchRequestId !== requestId) {
              log(' switchToWallet aborted — user switched again during load');
              return false;
            }

            // CRITICAL FIX: Derive isMultisig from wallet type, NOT from V2 file
            // The V2 file's isMultisig flag can be corrupted during migrations or fast switching
            // The wallet type from multiWalletStore is the authoritative source of truth
            const isMultisigWallet = walletType === 'multisig';
            const multisigConfigToUse = isMultisigWallet ? v2State.multisigConfig : null;

            // Log warning if V2 file and wallet type disagree
            if (v2State.isMultisig !== isMultisigWallet) {
              SyncLogger.log('switch', `isMultisig MISMATCH: V2=${v2State.isMultisig}, walletType=${walletType}, using walletType=${isMultisigWallet}`);
            }

            set({
              isLoading: false,
              isLocked: false,
              isRefreshing: false,
              walletId,
              error: null,
              network: v2State.network || 'mainnet',
              addresses: v2State.addresses,
              addressIndices: v2State.addressIndices,
              preferredAddressType: v2State.preferredAddressType,
              balance: v2State.balance,
              utxos: v2State.utxos,
              lastSync: v2State.lastSync,
              usedAddresses: v2State.usedAddresses,
              trackedTransactions: v2State.trackedTransactions,
              transactions: v2State.transactions,
              isMultisig: isMultisigWallet,
              multisigConfig: multisigConfigToUse,
            });

            logger.perfEnd('switch-wallet');

            // Background refresh if stale
            const cacheAge = v2State.lastSync ? Date.now() - v2State.lastSync : Infinity;
            if (cacheAge > CACHE_STALE_THRESHOLD) {
              log(' V2 wallet file is stale, refreshing in background');
              setTimeout(() => {
                if (currentSwitchRequestId !== requestId) return;
                get().refreshBalance();
              }, 100);
            }

            return true;
          }

          // ─── SLOW PATH: No V2 file — derive addresses from seed/data ───
          log(' No V2 data found, falling back to derivation for:', walletId);
          SyncLogger.log('switch', `V2 fast path MISS — slow path for ${walletId}, isWatchOnly=${isWatchOnly}`);
          set({
            isLoading: true,
            isRefreshing: false,
            error: null,
            walletId,
            network: 'mainnet',
            addresses: [],
            addressIndices: { ...initialAddressIndices },
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT as AddressType,
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            utxos: [],
            lastSync: null,
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map<string, TrackedTransaction>(),
            transactions: [],
            isMultisig: false,
            multisigConfig: null,
          });

          let addresses: AddressInfo[] = [];
          let newIndices: AddressIndices = { ...initialAddressIndices };
          let isMultisig = false;
          let multisigConfig: MultisigConfig | null = null;
          let pendingXpubEntries: { xpub: string; derivationPath: string; scriptType: string; fingerprint?: string | null }[] | null = null;
          let pendingDescriptorEntries: { descriptor: string; isRange?: boolean; internal?: boolean }[] | null = null;

          if (isWatchOnly) {
            // ─── Watch-only wallet: load addresses from WalletManager data ───
            const { WalletManager } = await import('../services/wallet/WalletManager');
            const walletData = await WalletManager.getWalletData(walletId);

            if (!walletData) {
              log(' No wallet data found for watch-only wallet:', walletId);
              set({ isLoading: false, error: 'Wallet data not found' });
              return false;
            }

            // Use cached addresses from wallet data
            if (walletData.cachedAddresses && walletData.cachedAddresses.length > 0) {
              addresses = walletData.cachedAddresses;
            } else if (walletData.addresses && walletData.addresses.length > 0) {
              // Fallback: build AddressInfo from raw address list (watch_addresses type)
              addresses = walletData.addresses.map((addr, index) => ({
                address: addr,
                path: `external/${index}`,
                index,
                isChange: false,
                type: ADDRESS_TYPES.NATIVE_SEGWIT,
              }));
            }

            if (addresses.length === 0) {
              log(' No addresses for watch-only wallet:', walletId);
              set({ isLoading: false, error: 'No addresses found in wallet' });
              return false;
            }

            log(' Watch-only wallet loaded:', walletId, 'with', addresses.length, 'addresses');
          } else {
            // ─── HD or Multisig wallet: derive addresses ───
            isMultisig = walletId.startsWith('multisig-');

            if (isMultisig) {
              // ─── Multisig wallet: derive addresses from MultisigWallet class ───
              log(' Multisig wallet detected, loading config for:', walletId);
              // Try per-wallet metadata first, then fall back to legacy shared key
              const walletMeta = await SecureStorage.getWalletMetadataById<{
                multisigConfig?: MultisigConfig;
              }>(walletId);
              multisigConfig = walletMeta?.multisigConfig || null;

              // Fallback 1: legacy metadata (createMultisigWallet stored here before multi-wallet fix)
              if (!multisigConfig) {
                log(' No per-wallet multisig config, trying legacy metadata');
                const legacyMeta = await SecureStorage.getWalletMetadata<{
                  isMultisig?: boolean;
                  multisigConfig?: MultisigConfig;
                }>();
                if (legacyMeta?.isMultisig && legacyMeta.multisigConfig) {
                  multisigConfig = legacyMeta.multisigConfig;
                  // Migrate: store in per-wallet key for future switches
                  await SecureStorage.storeWalletMetadataById(walletId, legacyMeta).catch(() => {});
                  log(' Migrated multisig config from legacy to per-wallet key');
                }
              }

              // Fallback 2: Database wallet row (multisigConfig is persisted there)
              if (!multisigConfig) {
                log(' No SecureStorage multisig config, trying database');
                try {
                  const dbWallet = WalletDatabase.shared().getWallet(walletId);
                  if (dbWallet?.multisigConfig) {
                    const dbCfg = JSON.parse(dbWallet.multisigConfig);
                    multisigConfig = {
                      m: dbCfg.m,
                      n: dbCfg.n,
                      scriptType: typeof dbCfg.scriptType === 'string' ? dbCfg.scriptType : 'p2wsh',
                      walletName: dbWallet.name || '',
                      descriptor: '',
                      cosigners: (dbCfg.cosigners || []).map((c: any) => ({
                        name: c.name || '',
                        fingerprint: c.fingerprint || '',
                        xpub: c.xpub || '',
                        derivationPath: c.derivationPath || "m/48'/0'/0'/2'",
                        isLocal: c.isLocal || false,
                      })),
                    };
                    // Migrate: store in per-wallet key for future switches
                    await SecureStorage.storeWalletMetadataById(walletId, {
                      isMultisig: true,
                      multisigConfig,
                    }).catch(() => {});
                    log(' Loaded multisig config from database');
                  }
                } catch (dbErr) {
                  log(' DB read error:', dbErr instanceof Error ? dbErr.message : String(dbErr));
                }
              }

              // Fallback 3: SecureStorage.getMultisigConfig (account-based key used by BackupService)
              if (!multisigConfig) {
                log(' Trying SecureStorage.getMultisigConfig with numeric account IDs');
                // Try a few common account IDs (0, 1, 2 and the timestamp from wallet ID)
                const timestampMatch = walletId.match(/multisig-(\d+)/);
                const candidateIds = [0, 1, 2];
                if (timestampMatch) candidateIds.push(Number(timestampMatch[1]));
                for (const accId of candidateIds) {
                  try {
                    const msConfig = await SecureStorage.getMultisigConfig<any>(accId);
                    if (msConfig && msConfig.cosigners?.length > 0) {
                      multisigConfig = {
                        m: msConfig.m,
                        n: msConfig.n,
                        scriptType: typeof msConfig.scriptType === 'string' ? msConfig.scriptType : 'p2wsh',
                        walletName: msConfig.walletName || msConfig.name || '',
                        descriptor: msConfig.descriptor || '',
                        cosigners: (msConfig.cosigners || []).map((c: any) => ({
                          name: c.name || '',
                          fingerprint: c.fingerprint || '',
                          xpub: c.xpub || '',
                          derivationPath: c.derivationPath || "m/48'/0'/0'/2'",
                          isLocal: c.isLocal || false,
                        })),
                      };
                      // Migrate to per-wallet key
                      await SecureStorage.storeWalletMetadataById(walletId, {
                        isMultisig: true,
                        multisigConfig,
                      }).catch(() => {});
                      log(' Found multisig config via getMultisigConfig(', accId, ')');
                      break;
                    }
                  } catch (e) {
                  }
                }
              }

              // Fallback 4: Current Zustand state (if previously loaded)
              if (!multisigConfig) {
                const currentState = get();
                if (currentState.isMultisig && currentState.multisigConfig?.cosigners?.length) {
                  log(' Using multisig config from current Zustand state');
                  multisigConfig = currentState.multisigConfig;
                }
              }

              if (multisigConfig && multisigConfig.cosigners?.length > 0) {
                // Accept all valid extended public key prefixes:
                // xpub/tpub (standard), zpub/vpub (native segwit), ypub/upub (wrapped segwit),
                // Zpub/Vpub (multisig native segwit), Ypub/Upub (multisig wrapped segwit)
                const VALID_XPUB_PREFIXES = ['xpub', 'tpub', 'zpub', 'vpub', 'ypub', 'upub', 'Zpub', 'Vpub', 'Ypub', 'Upub'];
                const hasValidXpubs = multisigConfig.cosigners.every(
                  (c) => c.xpub && c.xpub.length > 10 && VALID_XPUB_PREFIXES.some(p => c.xpub.startsWith(p))
                );

                if (hasValidXpubs) {
                  // Map script type string to MULTISIG_SCRIPT_TYPES constant
                  const getScriptType = (scriptType: string) => {
                    switch (scriptType) {
                      case 'p2wsh':
                        return MULTISIG_SCRIPT_TYPES.P2WSH;
                      case 'p2sh-p2wsh':
                        return MULTISIG_SCRIPT_TYPES.P2SH_P2WSH;
                      case 'p2sh':
                        return MULTISIG_SCRIPT_TYPES.P2SH;
                      default:
                        return MULTISIG_SCRIPT_TYPES.P2WSH;
                    }
                  };

                  const multisigWalletConfig: TypeMultisigConfig = {
                    m: multisigConfig.m,
                    n: multisigConfig.n,
                    scriptType: getScriptType(multisigConfig.scriptType),
                    cosigners: multisigConfig.cosigners.map((c, idx) => ({
                      id: `cosigner_${idx}`,
                      name: c.name,
                      fingerprint: c.fingerprint,
                      xpub: c.xpub,
                      derivationPath: c.derivationPath,
                      isLocal: c.isLocal,
                    })),
                    derivationPath: `m/48'/0'/0'/2'`,
                    sortedKeys: true,
                  };

                  const multisigWallet = MultisigWallet.fromConfig(multisigWalletConfig, 'mainnet');
                  const msGapLimit = useSettingsStore.getState().gapLimit;
                  const CHANGE_ADDRESS_COUNT = 10;

                  log(' Deriving multisig receiving addresses (gapLimit:', msGapLimit, ')');
                  for (const addr of multisigWallet.deriveReceivingAddresses(msGapLimit, 0)) {
                    addresses.push({
                      address: addr.address,
                      path: addr.path,
                      index: addr.index,
                      isChange: false,
                      type: addr.type,
                    });
                  }

                  log(' Deriving multisig change addresses...');
                  for (const addr of multisigWallet.deriveChangeAddresses(CHANGE_ADDRESS_COUNT, 0)) {
                    addresses.push({
                      address: addr.address,
                      path: addr.path,
                      index: addr.index,
                      isChange: true,
                      type: addr.type,
                    });
                  }

                  const msAddrType2 = (() => {
                    switch (multisigConfig.scriptType) {
                      case 'p2sh-p2wsh': return 'wrapped_segwit' as const;
                      case 'p2sh': return 'legacy' as const;
                      default: return 'native_segwit' as const;
                    }
                  })();
                  newIndices = {
                    native_segwit: { receiving: 0, change: 0 },
                    wrapped_segwit: { receiving: 0, change: 0 },
                    legacy: { receiving: 0, change: 0 },
                    taproot: { receiving: 0, change: 0 },
                  };
                  newIndices[msAddrType2] = { receiving: msGapLimit, change: CHANGE_ADDRESS_COUNT };

                  log(' Multisig addresses derived:', addresses.length, 'first:', addresses[0]?.address);
                } else {
                  log(' Multisig cosigners have invalid xpubs, cannot derive addresses');
                  set({ isLoading: false, error: 'Multisig wallet has invalid cosigner keys' });
                  return false;
                }
              } else {
                log(' No multisig config found for wallet:', walletId);
                set({ isLoading: false, error: 'Multisig configuration was lost. Please delete this wallet and re-create it.' });
                return false;
              }
            } else {
              // ─── HD single-sig wallet: derive addresses from seed or xprv ───
              if (!effectivePin) {
                log(' No PIN available for wallet switch');
                set({ isLoading: false, error: 'Authentication session expired. Please lock and unlock the app.' });
                return false;
              }

              const network = get().network;
              const CHANGE_ADDRESS_COUNT = 10;
              const switchGapLimit = useSettingsStore.getState().gapLimit;

              // Use shared KeyDerivationFactory for all wallet types
              let keyDerivation: KeyDerivation | null = null;
              try {
                keyDerivation = await keyDerivationFromSecureStorage(walletId, walletType!, network, effectivePin);
              } catch (err: any) {
                log(' Failed to construct KeyDerivation for wallet:', walletId, err?.message);
                set({ isLoading: false, error: 'Failed to load wallet data' });
                return false;
              }

              // Use shared AddressService for async batch derivation (yields every 10 to keep UI responsive)
              const derivedAddresses = await deriveAddressBatchAsync(keyDerivation, {
                addressTypes: ALL_ADDRESS_TYPES,
                receivingCount: switchGapLimit,
                changeCount: CHANGE_ADDRESS_COUNT,
              });
              addresses.push(...derivedAddresses);

              // Extract xpubs + descriptors using shared utility
              try {
                const generated = generateXpubsAndDescriptors(keyDerivation);
                pendingXpubEntries = generated.xpubs;
                pendingDescriptorEntries = generated.descriptors;
              } catch (e) {
              }

              keyDerivation.destroy();

              newIndices = {
                native_segwit: { receiving: switchGapLimit, change: CHANGE_ADDRESS_COUNT },
                wrapped_segwit: { receiving: switchGapLimit, change: CHANGE_ADDRESS_COUNT },
                legacy: { receiving: switchGapLimit, change: CHANGE_ADDRESS_COUNT },
                taproot: { receiving: switchGapLimit, change: CHANGE_ADDRESS_COUNT },
              };
            }
          }

          log(' Derived wallet:', walletId, 'with', addresses.length, 'addresses');
          SyncLogger.log('switch', `Slow path derived: ${walletId}, ${addresses.length} addrs, isMultisig=${isMultisig}, first 3: ${addresses.slice(0,3).map(a => a.address.slice(0,15)+'...').join(', ')}`);

          // Guard: if user switched to another wallet during async work, discard results
          if (currentSwitchRequestId !== requestId) {
            log(' switchToWallet aborted — user switched again during load');
            return false;
          }

          // Derive preferred address type from the first address or wallet type
          const derivedPreferredType: AddressType = addresses.length > 0
            ? (addresses[0].type as AddressType)
            : ADDRESS_TYPES.NATIVE_SEGWIT as AddressType;

          // Read network from DB wallet row (if available), otherwise keep current
          let walletNetwork: 'mainnet' | 'testnet' = 'mainnet';
          try {
            const dbWallet = WalletDatabase.shared().getWallet(walletId);
            if (dbWallet?.network) walletNetwork = dbWallet.network as 'mainnet' | 'testnet';
          } catch {}

          // Set state with derived addresses (no balance yet — needs refresh)
          set({
            isLoading: false,
            isLocked: false,
            isRefreshing: false,
            walletId,
            error: null,
            network: walletNetwork,
            addresses,
            addressIndices: newIndices,
            preferredAddressType: derivedPreferredType,
            balance: { confirmed: 0, unconfirmed: 0, total: 0 },
            utxos: [],
            lastSync: null,
            usedAddresses: new Set<string>(),
            trackedTransactions: new Map<string, TrackedTransaction>(),
            transactions: [],
            isMultisig,
            multisigConfig,
          });

          // Save derived addresses to DB if wallet is there but had no addresses
          try {
            const db = WalletDatabase.shared();
            const existingAddrs = db.getAddresses(walletId);
            if (existingAddrs.length === 0 && addresses.length > 0) {
              const addrRows = buildAddressRows(walletId, addresses);
              db.insertAddresses(addrRows);
              log(' Saved', addrRows.length, 'derived addresses to DB for:', walletId);
            }
            // Backfill xpubs/descriptors if missing
            if (pendingXpubEntries && db.getXpubs(walletId).length === 0) {
              db.insertXpubs(pendingXpubEntries.map(x => ({
                walletId, xpub: x.xpub, derivationPath: x.derivationPath,
                scriptType: x.scriptType, fingerprint: x.fingerprint ?? null,
              })));
            }
            if (pendingDescriptorEntries && db.getDescriptors(walletId).length === 0) {
              db.insertDescriptors(pendingDescriptorEntries.map(d => ({
                walletId, descriptor: d.descriptor,
                isRange: d.isRange ? 1 : 0, checksum: null, internal: d.internal ? 1 : 0,
              })));
            }
          } catch (err) {
          }

          // Refresh from network to get balance/txs
          SyncLogger.log('switch', `Slow path done, scheduling refreshBalance for ${walletId} (${addresses.length} addrs)`);
          setTimeout(() => {
            if (currentSwitchRequestId !== requestId) return;
            SyncLogger.log('switch', `refreshBalance triggered for ${walletId}`);
            get().refreshBalance();
          }, 100);

          logger.perfEnd('switch-wallet');
          return true;
        } catch (error) {
          logger.perfEnd('switch-wallet');
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to switch wallet',
          });
          return false;
        }
      },

      // Get cached transactions (for instant display)
      getCachedTransactions: () => {
        return get().transactions;
      },

      // Update cached transactions (DB is the source of truth — no file write needed)
      updateCachedTransactions: (transactions: DetailedTransactionInfo[]) => {
        set({ transactions });
      },

      // Check if cache is stale (older than threshold)
      isCacheStale: () => {
        const { lastSync } = get();
        if (!lastSync) return true;
        return Date.now() - lastSync > CACHE_STALE_THRESHOLD;
      },
    }),
    {
      name: 'wallet-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Version 4: Fixed change addresses not being generated properly
      version: 4,
      migrate: (persistedState: any, version: number) => {
        log(' Migrating from version', version, 'to 4');
        if (version < 2) {
          // Clear old addresses that don't have proper type field
          log(' Clearing old addresses for multi-type migration');
          return {
            ...persistedState,
            addresses: [],
            addressIndices: {
              native_segwit: { receiving: 0, change: 0 },
              wrapped_segwit: { receiving: 0, change: 0 },
              legacy: { receiving: 0, change: 0 },
            },
            preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
            usedAddressesArray: [],
          };
        }
        if (version < 3) {
          // Add usedAddresses tracking
          log(' Adding usedAddresses tracking');
          return {
            ...persistedState,
            usedAddressesArray: [],
          };
        }
        if (version < 4) {
          // Force re-generation of addresses to ensure change addresses are included
          // Check if there are any change addresses - if not, clear addresses to trigger re-generation
          const addresses = persistedState.addresses || [];
          const changeAddresses = addresses.filter((a: AddressInfo) => a.isChange === true);
          log(' Version 4 migration - checking change addresses:', changeAddresses.length);

          if (changeAddresses.length === 0 && addresses.length > 0) {
            log(' No change addresses found, clearing addresses for re-generation');
            return {
              ...persistedState,
              addresses: [],
              addressIndices: {
                native_segwit: { receiving: 0, change: 0 },
                wrapped_segwit: { receiving: 0, change: 0 },
                legacy: { receiving: 0, change: 0 },
              },
            };
          }
          return persistedState;
        }
        return persistedState;
      },
      // Persist addresses, balance, and indices (not the mnemonic - that's in SecureStorage)
      partialize: (state) => ({
        network: state.network,
        addresses: state.addresses,
        balance: state.balance,
        utxos: state.utxos,
        lastSync: state.lastSync,
        addressIndices: state.addressIndices,
        preferredAddressType: state.preferredAddressType,
        walletId: state.walletId,
        // Persist transactions so dashboard shows them immediately on app restart
        transactions: state.transactions,
        // Convert Set to Array for JSON serialization
        usedAddressesArray: Array.from(state.usedAddresses),
        // Convert Map to Array for JSON serialization
        trackedTransactionsArray: Array.from(state.trackedTransactions.entries()),
        // Multisig state
        isMultisig: state.isMultisig,
        multisigConfig: state.multisigConfig,
      }),
      // Convert Array back to Set/Map when loading
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert the persisted array back to a Set
          const usedArray = (state as any).usedAddressesArray || [];
          state.usedAddresses = new Set(usedArray);
          log(' Rehydrated usedAddresses, count:', state.usedAddresses.size);

          // Convert the persisted array back to a Map
          const txArray = (state as any).trackedTransactionsArray || [];
          state.trackedTransactions = new Map(txArray);
          log(' Rehydrated trackedTransactions, count:', state.trackedTransactions.size);
        }
      },
    }
  )
);
