/**
 * WalletFileService - Per-wallet JSON file storage
 *
 * Each wallet gets its own independent JSON file in the documents directory.
 * Files are created at wallet creation time and serve as the source of truth
 * when switching wallets — just read the file, populate state.
 *
 * No secrets are stored in these files — seeds/keys stay in SecureStorage.
 */

import { File, Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WalletType } from '../../stores/multiWalletStore';
import type { AddressInfo, BalanceInfo, UTXO, AddressType, DetailedTransactionInfo } from '../../types';
import type { WalletPersistedData } from '../wallet/WalletManager';

// ─── Types ────────────────────────────────────────────────────────────

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

interface MultisigConfig {
  m: number;
  n: number;
  scriptType: string;
  cosigners: Array<{
    name: string;
    fingerprint: string;
    xpub: string;
    derivationPath: string;
    isLocal: boolean;
  }>;
  descriptor: string;
  walletName: string;
}

export interface WalletFileSchema {
  // Header
  version: number;
  walletId: string;
  walletType: WalletType;
  createdAt: number;
  lastModified: number;
  network: 'mainnet' | 'testnet';

  // Addresses (cached from derivation — no PIN needed to reload)
  addresses: AddressInfo[];
  addressIndices: AddressIndices;
  preferredAddressType: AddressType;

  // Balance & UTXOs
  balance: BalanceInfo;
  utxos: UTXO[];

  // Sync
  lastSync: number | null;

  // Sync metadata — never cleared on failure, only updated on success or error
  syncState?: 'idle' | 'synced' | 'error' | 'stale';
  lastSuccessfulSyncAt?: number | null;
  lastSyncError?: { message: string; at: number } | null;

  // Address usage tracking (serialized from Set)
  usedAddresses: string[];

  // Transaction notification tracking (serialized from Map)
  trackedTransactions: [string, TrackedTransaction][];

  // Transaction history
  transactions: DetailedTransactionInfo[];

  // Multisig
  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;

  // Watch-only data (replaces wallet_data_{id})
  watchOnlyData: WalletPersistedData | null;
}

/** Snapshot of wallet state for saving (Set/Map not yet serialized) */
export interface WalletStateSnapshot {
  addresses: AddressInfo[];
  addressIndices: AddressIndices;
  preferredAddressType: AddressType;
  balance: BalanceInfo;
  utxos: UTXO[];
  lastSync: number | null;
  usedAddresses: Set<string>;
  trackedTransactions: Map<string, TrackedTransaction>;
  transactions: DetailedTransactionInfo[];
  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;
  network: 'mainnet' | 'testnet';
}

// ─── Constants ────────────────────────────────────────────────────────

const WALLET_DIR_NAME = 'wallets';
const FILE_VERSION = 1;

const DEFAULT_ADDRESS_INDICES: AddressIndices = {
  native_segwit: { receiving: 0, change: 0 },
  wrapped_segwit: { receiving: 0, change: 0 },
  legacy: { receiving: 0, change: 0 },
  taproot: { receiving: 0, change: 0 },
};

// ─── Service ──────────────────────────────────────────────────────────

export class WalletFileService {
  private static dirReady = false;

  /** Ensure the wallets directory exists */
  private static ensureDir(): void {
    if (this.dirReady) return;
    try {
      const dir = new Directory(Paths.document, WALLET_DIR_NAME);
      if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
      }
      this.dirReady = true;
    } catch (error) {
    }
  }

  /** Get the File handle for a wallet ID */
  private static getFile(walletId: string): File {
    // Sanitize wallet ID for filesystem safety
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.json`);
  }

  /** Get temp file handle for atomic writes */
  private static getTmpFile(walletId: string): File {
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.json.tmp`);
  }

  /** Get backup file handle for recovery */
  private static getBakFile(walletId: string): File {
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.json.bak`);
  }

  /**
   * Atomic write: write to .tmp → backup current to .bak → rename .tmp to .json
   * This ensures the wallet file is never partially written.
   * @deprecated Uses fixed .tmp filename — concurrent writes cause iOS crashes.
   * Use WalletFileV2Service which has unique temps + per-wallet mutex.
   */
  private static atomicWrite(walletId: string, json: string): void {
    this.ensureDir();
    const file = this.getFile(walletId);
    const tmpFile = this.getTmpFile(walletId);
    const bakFile = this.getBakFile(walletId);

    // 1. Write to temp file
    if (tmpFile.exists) tmpFile.delete();
    tmpFile.create({ intermediates: true });
    tmpFile.write(json);

    // 2. Backup current file (if exists) — rename current → .bak
    if (file.exists) {
      if (bakFile.exists) bakFile.delete();
      file.move(bakFile);
    }

    // 3. Promote temp → main (atomic rename)
    tmpFile.move(file);
  }

  /** Attempt to recover from .bak file if main file is corrupt */
  private static recoverFromBackup(walletId: string): WalletFileSchema | null {
    try {
      const bakFile = this.getBakFile(walletId);
      if (!bakFile.exists) return null;

      const data = JSON.parse(bakFile.textSync()) as WalletFileSchema;

      // Restore: copy backup back to main
      const mainFile = this.getFile(walletId);
      if (mainFile.exists) mainFile.delete();
      bakFile.copy(mainFile);

      return data;
    } catch {
      return null;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  /** Check if a wallet file exists */
  static exists(walletId: string): boolean {
    try {
      return this.getFile(walletId).exists;
    } catch {
      return false;
    }
  }

  /**
   * Create a new wallet file with initial data.
   * @deprecated Uses V1 atomicWrite (fixed .tmp, no mutex). Use WalletFileV2Service.create().
   */
  static create(walletId: string, data: Partial<WalletFileSchema>): void {
    try {
      this.ensureDir();
      const file = this.getFile(walletId);

      const fullData: WalletFileSchema = {
        version: FILE_VERSION,
        walletId,
        walletType: data.walletType ?? 'hd',
        createdAt: data.createdAt ?? Date.now(),
        lastModified: Date.now(),
        network: data.network ?? 'mainnet',
        addresses: data.addresses ?? [],
        addressIndices: data.addressIndices ?? { ...DEFAULT_ADDRESS_INDICES },
        preferredAddressType: data.preferredAddressType ?? 'native_segwit',
        balance: data.balance ?? { confirmed: 0, unconfirmed: 0, total: 0 },
        utxos: data.utxos ?? [],
        lastSync: data.lastSync ?? null,
        usedAddresses: data.usedAddresses ?? [],
        trackedTransactions: data.trackedTransactions ?? [],
        transactions: data.transactions ?? [],
        isMultisig: data.isMultisig ?? false,
        multisigConfig: data.multisigConfig ?? null,
        watchOnlyData: data.watchOnlyData ?? null,
      };

      const json = JSON.stringify(fullData);
      this.atomicWrite(walletId, json);

    } catch (error) {
    }
  }

  /** Read a wallet file. Returns null if not found. Tries .bak on corruption. */
  static read(walletId: string): WalletFileSchema | null {
    try {
      const file = this.getFile(walletId);
      if (!file.exists) return null;

      const json = file.textSync();
      const data = JSON.parse(json) as WalletFileSchema;

      if (data.version > FILE_VERSION) {
      }

      return data;
    } catch (error) {
      // Main file corrupt — try backup
      return this.recoverFromBackup(walletId);
    }
  }

  /**
   * Update specific fields in a wallet file (merge with existing).
   * @deprecated Uses V1 atomicWrite (fixed .tmp, no mutex). Use WalletFileV2Service.update().
   */
  static update(walletId: string, updates: Partial<WalletFileSchema>): boolean {
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      const merged: WalletFileSchema = {
        ...existing,
        ...updates,
        lastModified: Date.now(),
      };

      this.atomicWrite(walletId, JSON.stringify(merged));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Save the full current wallet state to its JSON file.
   * @deprecated Uses V1 atomicWrite (fixed .tmp, no mutex). Use WalletFileV2Service.saveFromV1Snapshot().
   */
  static saveCurrentState(walletId: string, state: WalletStateSnapshot): boolean {
    try {
      this.ensureDir();
      const file = this.getFile(walletId);

      // Read existing file to preserve header fields (walletType, createdAt, watchOnlyData)
      let existing: Partial<WalletFileSchema> = {};
      if (file.exists) {
        try {
          existing = JSON.parse(file.textSync());
        } catch {
          // Corrupt file — will overwrite
        }
      }

      const existingTyped = existing as WalletFileSchema;

      const fullData: WalletFileSchema = {
        version: FILE_VERSION,
        walletId,
        walletType: existingTyped.walletType ?? 'hd',
        createdAt: existingTyped.createdAt ?? Date.now(),
        lastModified: Date.now(),
        network: state.network,
        addresses: state.addresses,
        addressIndices: state.addressIndices,
        preferredAddressType: state.preferredAddressType,
        balance: state.balance,
        utxos: state.utxos,
        lastSync: state.lastSync,
        // Sync metadata — mark as successfully synced
        syncState: 'synced',
        lastSuccessfulSyncAt: Date.now(),
        lastSyncError: null,
        usedAddresses: Array.from(state.usedAddresses),
        trackedTransactions: Array.from(state.trackedTransactions.entries()),
        transactions: state.transactions,
        isMultisig: state.isMultisig,
        multisigConfig: state.multisigConfig,
        watchOnlyData: existingTyped.watchOnlyData ?? null,
      };

      this.atomicWrite(walletId, JSON.stringify(fullData));

      return true;
    } catch (error) {
      return false;
    }
  }

  /** Delete a wallet file and its backup/temp files */
  static delete(walletId: string): void {
    try {
      const file = this.getFile(walletId);
      const bakFile = this.getBakFile(walletId);
      const tmpFile = this.getTmpFile(walletId);

      if (file.exists) file.delete();
      if (bakFile.exists) bakFile.delete();
      if (tmpFile.exists) tmpFile.delete();

    } catch (error) {
    }
  }

  /**
   * Record a sync error without touching cached balance/tx/utxo data.
   * Only updates sync metadata fields — preserves last-known-good state.
   * @deprecated Uses V1 atomicWrite (fixed .tmp, no mutex). Use WalletFileV2Service.recordSyncError().
   */
  static recordSyncError(walletId: string, error: string): void {
    try {
      const file = this.getFile(walletId);
      if (!file.exists) return;

      const data = JSON.parse(file.textSync()) as WalletFileSchema;
      data.lastSyncError = { message: error, at: Date.now() };
      data.syncState = 'error';
      data.lastModified = Date.now();
      // NOTE: balance, utxos, transactions, addresses are NOT modified

      this.atomicWrite(walletId, JSON.stringify(data));
    } catch {
      // Best effort — don't crash on sync error recording
    }
  }

  // ─── Migration ────────────────────────────────────────────────────

  /** Migrate an existing wallet from scattered AsyncStorage keys to a single JSON file */
  static async migrateFromAsyncStorage(
    walletId: string,
    walletType: WalletType
  ): Promise<boolean> {
    try {
      // Already migrated?
      if (this.exists(walletId)) return true;


      // Read all scattered cache keys
      const keys = [
        `wallet_cache_${walletId}`,
        `addr_cache_${walletId}`,
        `wallet_data_${walletId}`,
      ];

      const results = await AsyncStorage.multiGet(keys);

      const walletCacheRaw = results[0][1];
      const addrCacheRaw = results[1][1];
      const walletDataRaw = results[2][1];

      const walletCache = walletCacheRaw ? JSON.parse(walletCacheRaw) : null;
      const addrCache = addrCacheRaw ? JSON.parse(addrCacheRaw) : null;
      const walletData = walletDataRaw ? JSON.parse(walletDataRaw) : null;

      // Build the file data from whatever we can find
      const fileData: Partial<WalletFileSchema> = {
        walletType,
        network: 'mainnet',

        // Balance from wallet cache
        balance: walletCache?.balance ?? { confirmed: 0, unconfirmed: 0, total: 0 },
        utxos: walletCache?.utxos ?? [],
        lastSync: walletCache?.lastSync ?? null,
        usedAddresses: walletCache?.usedAddressesArray ?? [],
        trackedTransactions: walletCache?.trackedTransactionsArray ?? [],
        transactions: walletCache?.transactions ?? [],

        // Addresses from addr_cache or walletData.cachedAddresses
        addresses: addrCache?.addresses ?? walletData?.cachedAddresses ?? [],
        addressIndices: addrCache?.indices ?? { ...DEFAULT_ADDRESS_INDICES },
        preferredAddressType: walletData?.preferredAddressType as AddressType ?? 'native_segwit',

        // Watch-only data
        watchOnlyData: walletData ?? null,
      };

      this.create(walletId, fileData);

      // Clean up old AsyncStorage keys after successful migration
      const keysToRemove = [
        `wallet_cache_${walletId}`,
        `addr_cache_${walletId}`,
        // Note: keep wallet_data_{id} for now as WalletManager may still reference it
        // It will be cleaned up later once we verify everything works
      ];
      await AsyncStorage.multiRemove(keysToRemove);

      return true;
    } catch (error) {
      return false;
    }
  }
}
