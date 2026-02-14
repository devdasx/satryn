/**
 * WalletFileV2 — V2 wallet file persistence layer
 *
 * Reads and writes WalletFileV2Schema (schema version 2).
 * Auto-migrates V1 files (WalletFileSchema from WalletFileService) on first read.
 *
 * Uses the same atomic write pattern (.tmp → .bak → .json) as V1.
 * V2 adds: structured LKG snapshot, staging area, integrity hashing,
 * full sync metadata, key references, and script inventory.
 *
 * INVARIANTS:
 * 1. lkg.confirmedBalanceSat === sum(lkg.utxos where height > 0)
 * 2. lkg.unconfirmedBalanceSat === sum(lkg.utxos where height === 0)
 * 3. integrity.snapshotHash === SHA-256 of JSON.stringify(lkg)
 * 4. staging is null when no sync is in progress
 * 5. On sync error, lkg is NEVER modified
 */

import { File, Directory, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { WalletFileService } from './WalletFileService';
import type { WalletFileSchema, WalletStateSnapshot } from './WalletFileService';
import { SyncLogger } from '../SyncLogger';
import type { WalletType } from '../../stores/multiWalletStore';
import type { DetailedTransactionInfo, UTXO, AddressType, MultisigConfig } from '../../types';
import type { CanonicalWalletType, CanonicalScriptType } from '../../types';
import {
  computeBalanceFromUtxos,
  createEmptySyncState,
  createEmptyLkg,
  createEmptyIntegrity,
  createEmptyBackupMeta,
} from '../sync/types';
import type {
  WalletFileV2Schema,
  LkgUtxo,
  LkgTransaction,
  TxDetailEntry,
  TxDetailInput,
  TxDetailOutput,
  LkgSnapshot,
  KeyRefData,
  ScriptInventoryData,
  SyncStateData,
  IntegrityData,
  ImportSourceType,
  AddressIndices,
  TxUserMetadata,
  UtxoUserMetadata,
  AddressUserMetadata,
  XpubEntry,
  DescriptorEntry,
  BackupMeta,
} from '../sync/types';

// Re-export for consumers
export type { WalletFileV2Schema };

// ─── Constants ────────────────────────────────────────────────────────

const WALLET_DIR_NAME = 'wallets';
const SCHEMA_VERSION = 2;

const DEFAULT_GAP_LIMIT = 20;

// ─── Wallet Type Mapping ──────────────────────────────────────────────

/**
 * Map legacy WalletType (from multiWalletStore) to CanonicalWalletType.
 * Used during V1 → V2 migration.
 */
function mapLegacyWalletType(wt: WalletType | string): CanonicalWalletType {
  switch (wt) {
    case 'hd': return 'hd_mnemonic';
    case 'hd_xprv': return 'hd_xprv';
    case 'hd_seed': return 'hd_seed';
    case 'hd_descriptor': return 'hd_descriptor';
    case 'hd_electrum': return 'hd_electrum';
    case 'imported_key': return 'imported_key';
    case 'imported_keys': return 'imported_keys';
    case 'watch_xpub': return 'watch_xpub';
    case 'watch_descriptor': return 'watch_descriptor';
    case 'watch_addresses': return 'watch_addresses';
    case 'multisig': return 'multisig';
    // If already a canonical type, pass through
    case 'hd_mnemonic': return 'hd_mnemonic';
    default: return 'hd_mnemonic';
  }
}

/**
 * Guess CanonicalScriptType from an address string.
 */
function guessScriptType(address: string): CanonicalScriptType {
  if (address.startsWith('bc1p')) return 'p2tr';
  if (address.startsWith('bc1q')) return 'p2wpkh';
  if (address.startsWith('3')) return 'p2sh-p2wpkh';
  if (address.startsWith('1')) return 'p2pkh';
  // Fallback
  return 'p2wpkh';
}

/**
 * Guess ImportSourceType from walletType.
 * Best-effort for migration — accurate source is set at creation time for new wallets.
 */
function guessImportSource(walletType: CanonicalWalletType): ImportSourceType {
  switch (walletType) {
    case 'hd_mnemonic': return 'phrase';
    case 'hd_xprv': return 'xprv';
    case 'hd_seed': return 'seed_hex';
    case 'hd_descriptor': return 'descriptor';
    case 'hd_electrum': return 'electrum_seed';
    case 'imported_key':
    case 'imported_keys': return 'wif';
    case 'watch_xpub': return 'xpub';
    case 'watch_descriptor': return 'descriptor';
    case 'watch_addresses': return 'addresses';
    case 'multisig': return 'descriptor';
    default: return 'phrase';
  }
}

// ─── Hash Utilities ───────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of the LKG snapshot for integrity verification.
 */
function computeSnapshotHash(lkg: LkgSnapshot): string {
  const json = JSON.stringify(lkg);
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(json));
  return bytesToHex(hash);
}

/**
 * Generate a unique atomic write ID.
 */
function generateWriteId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── V1 → V2 Migration ───────────────────────────────────────────────

/**
 * Upgrade a V1 UTXO to LkgUtxo.
 * Adds scripthash, scriptType, and height fields.
 */
function upgradeLegacyUtxo(utxo: UTXO): LkgUtxo {
  const scriptType = guessScriptType(utxo.address);
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    valueSat: utxo.value,
    height: utxo.confirmations > 0 ? 1 : 0, // Approximate: we don't know exact block height from V1
    address: utxo.address,
    scriptPubKey: utxo.scriptPubKey,
    scriptType,
    scripthash: '', // Will be populated on next sync — computing requires bitcoinjs-lib which is heavy for migration
    confirmations: utxo.confirmations,
  };
}

/**
 * Upgrade a V1 DetailedTransactionInfo to LkgTransaction.
 */
function upgradeLegacyTransaction(tx: DetailedTransactionInfo): LkgTransaction {
  return {
    txid: tx.txid,
    firstSeenAt: tx.firstSeen ?? tx.blockTime ?? Date.now(),
    blockHeight: tx.confirmed ? tx.height : null,
    confirmations: tx.confirmations,
    direction: tx.type,
    valueDeltaSat: tx.balanceDiff,
    feeSat: tx.fee,
    feeRate: tx.feeRate,
    isRBF: tx.isRBF,
    status: tx.status,
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
    size: tx.size,
    vsize: tx.vsize,
  };
}

/**
 * Build TxDetailEntry from a V1 DetailedTransactionInfo.
 * Wallet-owned flags are set to false — they'll be recomputed on next sync.
 */
function buildTxDetailFromLegacy(tx: DetailedTransactionInfo): TxDetailEntry {
  const inputs: TxDetailInput[] = tx.inputs.map(inp => ({
    prevTxid: inp.prevTxid,
    prevVout: inp.prevVout,
    address: inp.address,
    valueSat: inp.value,
    isWalletOwned: false, // Will be recomputed on next sync
  }));

  const outputs: TxDetailOutput[] = tx.outputs.map(out => ({
    index: out.index,
    address: out.address,
    valueSat: out.value,
    scriptPubKey: '', // Not available in V1 — populated on next sync
    isWalletOwned: false,
  }));

  return {
    txid: tx.txid,
    rawHex: tx.rawHex,
    inputs,
    outputs,
    blockTime: tx.blockTime || null,
    size: tx.size,
    vsize: tx.vsize,
  };
}

/**
 * Upgrade V1 MultisigConfig to canonical MultisigConfig.
 * V1 cosigners lack `id`; V1 config lacks `derivationPath` and `sortedKeys`.
 */
function upgradeLegacyMultisigConfig(v1Config: any): MultisigConfig {
  const cosigners = (v1Config.cosigners || []).map((c: any, i: number) => ({
    id: c.id ?? `cosigner-${i}`,
    name: c.name ?? `Cosigner ${i + 1}`,
    fingerprint: c.fingerprint ?? '',
    xpub: c.xpub ?? '',
    derivationPath: c.derivationPath ?? "m/48'/0'/0'/2'",
    isLocal: c.isLocal ?? false,
  }));

  return {
    m: v1Config.m,
    n: v1Config.n,
    scriptType: v1Config.scriptType ?? 'p2wsh',
    cosigners,
    derivationPath: v1Config.derivationPath ?? "m/48'/0'/0'/2'",
    sortedKeys: v1Config.sortedKeys ?? true,
  };
}

/**
 * Migrate a V1 WalletFileSchema to V2.
 * Preserves all existing data, restructures into V2 layout.
 */
function migrateV1toV2(v1: WalletFileSchema, walletName?: string): WalletFileV2Schema {
  const canonicalType = mapLegacyWalletType(v1.walletType);

  // Upgrade UTXOs
  const lkgUtxos = (v1.utxos || []).map(upgradeLegacyUtxo);

  // Upgrade transactions
  const lkgTransactions = (v1.transactions || []).map(upgradeLegacyTransaction);

  // Build tx details map
  const txDetails: Record<string, TxDetailEntry> = {};
  for (const tx of v1.transactions || []) {
    txDetails[tx.txid] = buildTxDetailFromLegacy(tx);
  }

  // Compute balance from UTXOs (canonical method)
  const balance = computeBalanceFromUtxos(lkgUtxos);

  // Build LKG snapshot
  const lkg: LkgSnapshot = {
    utxos: lkgUtxos,
    transactions: lkgTransactions,
    txDetails,
    confirmedBalanceSat: balance.confirmed,
    unconfirmedBalanceSat: balance.unconfirmed,
    trackedTransactions: v1.trackedTransactions || [],
    committedAt: v1.lastSync || v1.lastModified || Date.now(),
    tipHeightAtCommit: null, // Unknown from V1
  };

  // Build sync state from V1 fields
  const syncState: SyncStateData = {
    status: (v1.syncState as any) || 'idle',
    lastSuccessfulSyncAt: v1.lastSuccessfulSyncAt ?? v1.lastSync ?? null,
    lastAttemptAt: v1.lastSync ?? null,
    lastKnownTipHeight: null,
    lastServerUsed: null,
    isStale: false,
    failureCount: 0,
    nextRetryAt: null,
    lastError: v1.lastSyncError?.message ?? null,
    lastErrorAt: v1.lastSyncError?.at ?? null,
  };

  // Build script inventory
  const scriptInventory: ScriptInventoryData = {
    addresses: v1.addresses || [],
    addressIndices: v1.addressIndices || {
      native_segwit: { receiving: 0, change: 0 },
      wrapped_segwit: { receiving: 0, change: 0 },
      legacy: { receiving: 0, change: 0 },
      taproot: { receiving: 0, change: 0 },
    },
    preferredAddressType: v1.preferredAddressType || 'native_segwit',
    usedAddresses: v1.usedAddresses || [],
    gapLimit: DEFAULT_GAP_LIMIT,
    lastDiscoveryAt: null,
  };

  // Build key reference (minimal — enriched later by wallet engine)
  const keyRef: KeyRefData = {
    secretId: null,
    fingerprint: null,
    descriptor: null,
    scriptTypes: inferScriptTypes(v1.preferredAddressType),
  };

  // Build integrity data
  const integrity: IntegrityData = {
    snapshotHash: computeSnapshotHash(lkg),
    lastGoodSnapshotHash: null,
    atomicWriteId: generateWriteId(),
  };

  return {
    schemaVersion: SCHEMA_VERSION as 2,
    walletId: v1.walletId,
    name: walletName || v1.walletId,
    walletType: canonicalType,
    importSource: guessImportSource(canonicalType),
    createdAt: v1.createdAt,
    lastModified: Date.now(),
    network: 'mainnet',
    keyRef,
    scriptInventory,
    syncState,
    lkg,
    staging: null,
    integrity,
    isMultisig: v1.isMultisig || false,
    multisigConfig: v1.multisigConfig
      ? upgradeLegacyMultisigConfig(v1.multisigConfig as any)
      : null,
    watchOnlyData: v1.watchOnlyData || null,
  };
}

/**
 * Infer script types from preferred address type.
 */
function inferScriptTypes(preferred?: AddressType | string): CanonicalScriptType[] {
  switch (preferred) {
    case 'native_segwit': return ['p2wpkh'];
    case 'wrapped_segwit': return ['p2sh-p2wpkh'];
    case 'legacy': return ['p2pkh'];
    case 'taproot': return ['p2tr'];
    default: return ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh', 'p2tr'];
  }
}

// ─── WalletFileV2 Service ─────────────────────────────────────────────

export class WalletFileV2Service {
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
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.json`);
  }

  /** Generate unique temp file for atomic writes (prevents collision) */
  private static createUniqueTmpFile(walletId: string): File {
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.${ts}.${rand}.tmp`);
  }

  /** Get backup file handle for recovery */
  private static getBakFile(walletId: string): File {
    const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File(Paths.document, WALLET_DIR_NAME, `${safeId}.json.bak`);
  }

  // ─── Per-Wallet Write Mutex ────────────────────────────────────────

  /** Per-wallet write mutex — serializes all file operations per wallet */
  private static writeLocks: Map<string, Promise<void>> = new Map();

  /**
   * Acquire per-wallet write lock. Returns a release function.
   * Uses Promise-chaining (no external deps needed).
   */
  private static async acquireWriteLock(walletId: string): Promise<() => void> {
    const current = this.writeLocks.get(walletId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.writeLocks.set(walletId, current.then(() => next));
    await current;
    return release;
  }

  // ─── Atomic Write ───────────────────────────────────────────────────

  /**
   * Atomic write (NOT concurrency-safe).
   * Callers inside the class that already hold the write lock use this directly.
   * External code should use the public write() method which acquires the lock.
   */
  private static atomicWriteUnsafe(walletId: string, json: string): void {
    this.ensureDir();
    const file = this.getFile(walletId);
    const tmpFile = this.createUniqueTmpFile(walletId);
    const bakFile = this.getBakFile(walletId);

    // 1. Write to unique temp file
    tmpFile.create({ intermediates: true });
    tmpFile.write(json);

    // 2. Backup current file (if exists)
    if (file.exists) {
      try { if (bakFile.exists) bakFile.delete(); } catch {}
      try { file.move(bakFile); } catch {
        // move failed — delete main file so promote step can succeed
        SyncLogger.warn('v2file', `atomicWrite: file.move(bak) failed for ${walletId}, deleting main file`);
        try { file.delete(); } catch {}
      }
    }

    // 3. Promote temp → main
    // expo-file-system move() fails if destination exists, so delete first defensively
    try { if (file.exists) file.delete(); } catch {}
    try {
      tmpFile.move(file);
    } catch (moveErr) {
      SyncLogger.error('v2file', `atomicWrite: tmpFile.move(main) FAILED for ${walletId}: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`);
      throw moveErr;
    }
  }

  /**
   * Attempt to recover from .bak file if main file is corrupt.
   */
  private static recoverFromBackup(walletId: string): WalletFileV2Schema | null {
    try {
      const bakFile = this.getBakFile(walletId);
      if (!bakFile.exists) return null;

      const raw = JSON.parse(bakFile.textSync());

      // If backup is V2, return it
      if (raw.schemaVersion === 2) {
        // Restore: copy backup to main
        const mainFile = this.getFile(walletId);
        if (mainFile.exists) mainFile.delete();
        bakFile.copy(mainFile);
        return raw as WalletFileV2Schema;
      }

      // If backup is V1, migrate it
      const v2 = migrateV1toV2(raw as WalletFileSchema);
      this.atomicWriteUnsafe(walletId, JSON.stringify(v2));
      return v2;
    } catch {
      return null;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  /**
   * Check if a wallet file exists.
   */
  static exists(walletId: string): boolean {
    try {
      return this.getFile(walletId).exists;
    } catch {
      return false;
    }
  }

  /**
   * Read a wallet file. Auto-migrates V1 → V2 on first read.
   * Returns null if not found. Tries .bak on corruption.
   *
   * @param walletName - Optional wallet name for V1→V2 migration
   */
  static read(walletId: string, walletName?: string): WalletFileV2Schema | null {
    try {
      const file = this.getFile(walletId);
      if (!file.exists) return null;

      const json = file.textSync();
      const raw = JSON.parse(json);

      // Already V2 — apply defaults for any new optional fields
      if (raw.schemaVersion === 2) {
        const data = raw as WalletFileV2Schema;
        this.applyOptionalDefaults(data);
        return data;
      }

      // V1 detected — migrate
      const v2 = migrateV1toV2(raw as WalletFileSchema, walletName);
      this.atomicWriteUnsafe(walletId, JSON.stringify(v2));
      return v2;
    } catch (error) {
      // Main file corrupt — try backup
      return this.recoverFromBackup(walletId);
    }
  }

  /**
   * Prepare integrity fields and serialize to disk (no lock).
   * Use when the caller already holds the write lock.
   */
  private static writeUnsafe(walletId: string, data: WalletFileV2Schema): boolean {
    try {
      data.lastModified = Date.now();
      data.integrity.snapshotHash = computeSnapshotHash(data.lkg);
      data.integrity.lastGoodSnapshotHash = data.integrity.snapshotHash;
      data.integrity.atomicWriteId = generateWriteId();

      this.atomicWriteUnsafe(walletId, JSON.stringify(data));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Write a complete V2 wallet file with per-wallet mutex.
   * Recomputes integrity hash before writing.
   */
  static async write(walletId: string, data: WalletFileV2Schema): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      return this.writeUnsafe(walletId, data);
    } finally {
      release();
    }
  }

  /**
   * Update specific fields in a V2 wallet file.
   * Reads existing, merges, recomputes integrity, writes atomically.
   * Uses per-wallet mutex to prevent concurrent read-modify-write races.
   */
  static async update(walletId: string, updates: Partial<WalletFileV2Schema>): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      const merged: WalletFileV2Schema = {
        ...existing,
        ...updates,
        // Preserve immutable fields
        schemaVersion: SCHEMA_VERSION as 2,
        walletId: existing.walletId,
        createdAt: existing.createdAt,
      };

      return this.writeUnsafe(walletId, merged);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Commit a new LKG snapshot atomically.
   * This is the two-phase commit entry point:
   * 1. Update lkg with new snapshot
   * 2. Clear staging
   * 3. Update sync state to 'synced'
   * 4. Recompute integrity hash
   * 5. Write atomically
   */
  static async commitLkg(walletId: string, newLkg: LkgSnapshot): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.lkg = newLkg;
      existing.staging = null;
      existing.syncState.status = 'synced';
      existing.syncState.lastSuccessfulSyncAt = Date.now();
      existing.syncState.lastAttemptAt = Date.now();
      existing.syncState.failureCount = 0;
      existing.syncState.lastError = null;
      existing.syncState.lastErrorAt = null;
      existing.syncState.nextRetryAt = null;
      existing.syncState.isStale = false;

      if (newLkg.tipHeightAtCommit !== null) {
        existing.syncState.lastKnownTipHeight = newLkg.tipHeightAtCommit;
      }

      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Record a sync error without touching LKG.
   * Only updates sync metadata — preserves last-known-good data.
   */
  static async recordSyncError(walletId: string, error: string): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.syncState.status = 'error';
      existing.syncState.lastError = error;
      existing.syncState.lastErrorAt = Date.now();
      existing.syncState.lastAttemptAt = Date.now();
      existing.syncState.failureCount += 1;
      existing.staging = null; // Discard failed staging data

      // Compute exponential backoff for next retry
      const backoffMs = Math.min(
        300_000,
        30_000 * Math.pow(1.5, existing.syncState.failureCount)
      );
      existing.syncState.nextRetryAt = Date.now() + backoffMs;

      // NOTE: lkg is NOT touched — UI keeps showing cached data
      return this.writeUnsafe(walletId, existing);
    } catch {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Save staging snapshot to file (in-progress sync).
   * Does NOT modify LKG — staging is held separately until validated.
   */
  static async saveStaging(walletId: string, staging: WalletFileV2Schema['staging']): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.staging = staging;
      existing.syncState.status = 'syncing';
      existing.syncState.lastAttemptAt = Date.now();

      return this.writeUnsafe(walletId, existing);
    } catch {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update script inventory (addresses, indices).
   */
  static async updateScriptInventory(
    walletId: string,
    inventory: Partial<ScriptInventoryData>
  ): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.scriptInventory = {
        ...existing.scriptInventory,
        ...inventory,
      };

      return this.writeUnsafe(walletId, existing);
    } catch {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update key reference data.
   */
  static async updateKeyRef(walletId: string, keyRef: Partial<KeyRefData>): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.keyRef = {
        ...existing.keyRef,
        ...keyRef,
      };

      return this.writeUnsafe(walletId, existing);
    } catch {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Delete a wallet file and its backup/temp files.
   */
  static delete(walletId: string): void {
    try {
      const file = this.getFile(walletId);
      const bakFile = this.getBakFile(walletId);

      if (file.exists) file.delete();
      if (bakFile.exists) bakFile.delete();

      // Clean up any orphan .tmp files for this wallet
      const safeId = walletId.replace(/[^a-zA-Z0-9_-]/g, '_');
      try {
        const dir = new Directory(Paths.document, WALLET_DIR_NAME);
        if (dir.exists) {
          for (const entry of dir.list()) {
            if (entry instanceof File && entry.name?.startsWith(safeId) && entry.name?.endsWith('.tmp')) {
              entry.delete();
            }
          }
        }
      } catch { /* Best effort temp cleanup */ }

    } catch (error) {
    }
  }

  /**
   * Verify integrity of a wallet file.
   * Returns true if the stored hash matches the computed hash.
   */
  static verifyIntegrity(walletId: string): boolean {
    try {
      const data = this.read(walletId);
      if (!data) return false;

      const computed = computeSnapshotHash(data.lkg);
      return computed === data.integrity.snapshotHash;
    } catch {
      return false;
    }
  }

  // ─── Optional Field Defaults ──────────────────────────────────────

  /**
   * Apply defaults for optional fields added after initial V2 schema.
   * Called on read() to ensure backward compatibility.
   */
  private static applyOptionalDefaults(data: WalletFileV2Schema): void {
    if (data.txUserMetadata === undefined) data.txUserMetadata = {};
    if (data.utxoUserMetadata === undefined) data.utxoUserMetadata = {};
    if (data.addressLabels === undefined) data.addressLabels = {};
    if (data.xpubs === undefined) data.xpubs = [];
    if (data.descriptors === undefined) data.descriptors = [];
    if (data.backupMeta === undefined) data.backupMeta = createEmptyBackupMeta();
  }

  // ─── User Metadata Updates ──────────────────────────────────────

  /**
   * Update transaction user metadata (note/tags) for a specific txid.
   */
  static async updateTxUserMetadata(
    walletId: string,
    txid: string,
    metadata: Partial<TxUserMetadata>
  ): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      const current = existing.txUserMetadata?.[txid];
      const now = Date.now();

      existing.txUserMetadata = {
        ...existing.txUserMetadata,
        [txid]: {
          note: metadata.note !== undefined ? metadata.note : current?.note,
          tags: metadata.tags !== undefined ? metadata.tags : current?.tags,
          createdAt: current?.createdAt ?? now,
          editedAt: now,
        },
      };

      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update UTXO user metadata for a specific outpoint (txid:vout).
   */
  static async updateUtxoUserMetadata(
    walletId: string,
    outpoint: string,
    metadata: Partial<UtxoUserMetadata>
  ): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      const current = existing.utxoUserMetadata?.[outpoint];

      existing.utxoUserMetadata = {
        ...existing.utxoUserMetadata,
        [outpoint]: {
          note: metadata.note !== undefined ? metadata.note : current?.note,
          tags: metadata.tags !== undefined ? metadata.tags : current?.tags,
          isFrozen: metadata.isFrozen !== undefined ? metadata.isFrozen : current?.isFrozen ?? false,
          isLocked: metadata.isLocked !== undefined ? metadata.isLocked : current?.isLocked ?? false,
          createdAt: current?.createdAt ?? Date.now(),
        },
      };

      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update address label/note.
   */
  static async updateAddressLabel(
    walletId: string,
    address: string,
    metadata: Partial<AddressUserMetadata>
  ): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      const current = existing.addressLabels?.[address];

      existing.addressLabels = {
        ...existing.addressLabels,
        [address]: {
          label: metadata.label !== undefined ? metadata.label : current?.label,
          note: metadata.note !== undefined ? metadata.note : current?.note,
        },
      };

      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update persisted xpubs array.
   */
  static async updateXpubs(walletId: string, xpubs: XpubEntry[]): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.xpubs = xpubs;
      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update persisted descriptors array.
   */
  static async updateDescriptors(walletId: string, descriptors: DescriptorEntry[]): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.descriptors = descriptors;
      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  /**
   * Update backup metadata.
   */
  static async updateBackupMeta(walletId: string, meta: Partial<BackupMeta>): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      const existing = this.read(walletId);
      if (!existing) return false;

      existing.backupMeta = {
        ...existing.backupMeta ?? createEmptyBackupMeta(),
        ...meta,
      };

      return this.writeUnsafe(walletId, existing);
    } catch (error) {
      return false;
    } finally {
      release();
    }
  }

  // ─── Factory ────────────────────────────────────────────────────

  /**
   * Create a new V2 wallet file from scratch.
   * Used for new wallet creation (not migration).
   */
  static create(params: {
    walletId: string;
    name: string;
    walletType: CanonicalWalletType;
    importSource: ImportSourceType;
    keyRef?: Partial<KeyRefData>;
    scriptInventory?: Partial<ScriptInventoryData>;
    isMultisig?: boolean;
    multisigConfig?: WalletFileV2Schema['multisigConfig'];
  }): WalletFileV2Schema {
    const emptyLkg = createEmptyLkg();
    const now = Date.now();

    const data: WalletFileV2Schema = {
      schemaVersion: SCHEMA_VERSION as 2,
      walletId: params.walletId,
      name: params.name,
      walletType: params.walletType,
      importSource: params.importSource,
      createdAt: now,
      lastModified: now,
      network: 'mainnet',
      keyRef: {
        secretId: params.keyRef?.secretId ?? null,
        fingerprint: params.keyRef?.fingerprint ?? null,
        descriptor: params.keyRef?.descriptor ?? null,
        scriptTypes: params.keyRef?.scriptTypes ?? ['p2wpkh'],
      },
      scriptInventory: {
        addresses: params.scriptInventory?.addresses ?? [],
        addressIndices: params.scriptInventory?.addressIndices ?? {
          native_segwit: { receiving: 0, change: 0 },
          wrapped_segwit: { receiving: 0, change: 0 },
          legacy: { receiving: 0, change: 0 },
          taproot: { receiving: 0, change: 0 },
        },
        preferredAddressType: params.scriptInventory?.preferredAddressType ?? 'native_segwit',
        usedAddresses: params.scriptInventory?.usedAddresses ?? [],
        gapLimit: params.scriptInventory?.gapLimit ?? DEFAULT_GAP_LIMIT,
        lastDiscoveryAt: null,
      },
      syncState: createEmptySyncState(),
      lkg: emptyLkg,
      staging: null,
      integrity: {
        snapshotHash: computeSnapshotHash(emptyLkg),
        lastGoodSnapshotHash: null,
        atomicWriteId: generateWriteId(),
      },
      isMultisig: params.isMultisig ?? false,
      multisigConfig: params.multisigConfig ?? null,
      watchOnlyData: null,
      // User metadata defaults
      txUserMetadata: {},
      utxoUserMetadata: {},
      addressLabels: {},
      xpubs: [],
      descriptors: [],
      backupMeta: createEmptyBackupMeta(),
    };

    this.atomicWriteUnsafe(params.walletId, JSON.stringify(data));
    return data;
  }

  // ─── V1 Snapshot Bridge ─────────────────────────────────────────

  /**
   * Save wallet state from V1 WalletStateSnapshot format.
   * Bridge method for callers still using the old WalletFileService.saveCurrentState() shape.
   * Routes through V2 mutex + unique temps + atomic write under the hood.
   */
  static async saveFromV1Snapshot(walletId: string, state: WalletStateSnapshot): Promise<boolean> {
    const release = await this.acquireWriteLock(walletId);
    try {
      // Read existing V2 data (or bootstrap from V1 snapshot)
      let existing = this.read(walletId);
      const isNew = !existing;
      if (!existing) {
        existing = this.bootstrapV2FromV1(walletId, state);
      }
      SyncLogger.log('v2file', `saveFromV1Snapshot: ${walletId}, isNew=${isNew}, addrs=${state.addresses.length}, utxos=${state.utxos.length}, txs=${state.transactions?.length ?? 0}, bal=${state.balance.confirmed}+${state.balance.unconfirmed}`);

      // Merge V1 fields into V2 structure — script inventory
      existing.scriptInventory.addresses = state.addresses;
      existing.scriptInventory.addressIndices = state.addressIndices;
      existing.scriptInventory.preferredAddressType = state.preferredAddressType;
      existing.scriptInventory.usedAddresses = Array.from(state.usedAddresses);

      // Update LKG from V1 balance/utxos/transactions
      existing.lkg.confirmedBalanceSat = state.balance.confirmed;
      existing.lkg.unconfirmedBalanceSat = state.balance.unconfirmed;
      existing.lkg.utxos = state.utxos.map(upgradeLegacyUtxo);
      existing.lkg.trackedTransactions = Array.from(state.trackedTransactions.entries());
      existing.lkg.committedAt = Date.now();

      // Persist transaction history into V2 LKG
      if (state.transactions && state.transactions.length > 0) {
        existing.lkg.transactions = state.transactions.map(upgradeLegacyTransaction);
        const txDetails: Record<string, TxDetailEntry> = {};
        for (const tx of state.transactions) {
          txDetails[tx.txid] = buildTxDetailFromLegacy(tx);
        }
        existing.lkg.txDetails = txDetails;
      }

      // Sync state — mark as synced
      existing.syncState.status = 'synced';
      existing.syncState.lastSuccessfulSyncAt = Date.now();
      existing.syncState.lastAttemptAt = Date.now();
      existing.syncState.lastError = null;
      existing.syncState.lastErrorAt = null;
      existing.syncState.failureCount = 0;

      // Multisig
      existing.isMultisig = state.isMultisig;
      existing.multisigConfig = state.multisigConfig as any;

      const written = this.writeUnsafe(walletId, existing);
      SyncLogger.log('v2file', `saveFromV1Snapshot result: ${walletId}, written=${written}, fileExists=${this.exists(walletId)}`);
      return written;
    } catch (error) {
      SyncLogger.error('v2file', `saveFromV1Snapshot FAILED: ${walletId}, ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      release();
    }
  }

  /**
   * Bootstrap a minimal V2 shell from a V1 snapshot.
   * Used when no V2 file exists yet (pre-migration wallet on first V2 save).
   */
  private static bootstrapV2FromV1(walletId: string, state: WalletStateSnapshot): WalletFileV2Schema {
    const emptyLkg = createEmptyLkg();
    const now = Date.now();

    return {
      schemaVersion: 2 as 2,
      walletId,
      name: walletId,
      walletType: 'hd_mnemonic',
      importSource: 'phrase',
      createdAt: now,
      lastModified: now,
      network: 'mainnet',
      keyRef: {
        secretId: null,
        fingerprint: null,
        descriptor: null,
        scriptTypes: inferScriptTypes(state.preferredAddressType),
      },
      scriptInventory: {
        addresses: state.addresses,
        addressIndices: state.addressIndices,
        preferredAddressType: state.preferredAddressType,
        usedAddresses: Array.from(state.usedAddresses),
        gapLimit: DEFAULT_GAP_LIMIT,
        lastDiscoveryAt: null,
      },
      syncState: createEmptySyncState(),
      lkg: emptyLkg,
      staging: null,
      integrity: createEmptyIntegrity(),
      isMultisig: state.isMultisig,
      multisigConfig: state.multisigConfig as any,
      watchOnlyData: null,
      txUserMetadata: {},
      utxoUserMetadata: {},
      addressLabels: {},
      xpubs: [],
      descriptors: [],
      backupMeta: createEmptyBackupMeta(),
    };
  }

  // ─── Orphan Cleanup ──────────────────────────────────────────────

  /**
   * Clean up orphan .tmp files from the wallets directory.
   * Call on app startup (after init, before first sync).
   * Only deletes .tmp files older than 60 seconds (to avoid deleting active writes).
   */
  static cleanupOrphanTempFiles(): number {
    try {
      const dir = new Directory(Paths.document, WALLET_DIR_NAME);
      if (!dir.exists) return 0;

      let cleaned = 0;
      const entries = dir.list();
      const cutoff = Date.now() - 60_000; // 60s grace period

      for (const entry of entries) {
        if (entry instanceof File && entry.name?.endsWith('.tmp')) {
          // For uniquely-named temps, extract timestamp from filename
          // Format: {safeId}.{timestamp}.{random}.tmp
          const parts = entry.name.split('.');
          if (parts.length >= 4) {
            const ts = parseInt(parts[parts.length - 3], 10);
            if (!isNaN(ts) && ts < cutoff) {
              entry.delete();
              cleaned++;
            }
          } else {
            // Legacy static .tmp file — always safe to delete on startup
            entry.delete();
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
      }
      return cleaned;
    } catch {
      return 0;
    }
  }
}
