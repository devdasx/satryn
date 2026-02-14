/**
 * Sync Engine Type Definitions
 *
 * Canonical types for the offline-first wallet sync architecture.
 * These types are used by WalletFileV2, SyncPipeline, SyncValidator,
 * and WalletEngine.
 */

import type {
  AddressInfo,
  AddressType,
  BalanceInfo,
  MultisigConfig,
  CanonicalWalletType,
  CanonicalScriptType,
  AccountAddressIndices,
} from '../../types';

// Re-export for convenience
export type { CanonicalWalletType, CanonicalScriptType };

// Use the same AddressIndices type as the rest of the app
export type AddressIndices = AccountAddressIndices;

// ============================================
// IMPORT SOURCE
// ============================================

export type ImportSourceType =
  | 'phrase'
  | 'xprv'
  | 'wif'
  | 'descriptor'
  | 'xpub'
  | 'addresses'
  | 'file'
  | 'icloud'
  | 'seed_hex'
  | 'electrum_seed';

// ============================================
// LKG UTXO (richer than legacy UTXO)
// ============================================

/**
 * UTXO stored in the Last Known Good snapshot.
 * Includes scripthash and scriptType for incremental sync.
 */
export interface LkgUtxo {
  txid: string;
  vout: number;
  valueSat: number;
  height: number;              // 0 = unconfirmed, >0 = confirmed block height
  address: string;
  scriptPubKey: string;
  scriptType: CanonicalScriptType;
  scripthash: string;          // Electrum scripthash for this address
  confirmations: number;       // Derived from tip height
}

// ============================================
// LKG TRANSACTION (canonical tx model)
// ============================================

/**
 * Transaction stored in the Last Known Good snapshot.
 * Summarized form — full details are in txDetails store.
 */
export interface LkgTransaction {
  txid: string;
  firstSeenAt: number;         // When we first discovered this tx
  blockHeight: number | null;  // null = unconfirmed
  confirmations: number;
  direction: 'incoming' | 'outgoing' | 'self-transfer';
  valueDeltaSat: number;       // positive = received, negative = sent
  feeSat: number;
  feeRate: number;             // sat/vB
  isRBF: boolean;
  status: 'pending' | 'confirmed';
  inputCount: number;
  outputCount: number;
  size: number;
  vsize: number;
}

// ============================================
// TX DETAIL ENTRY (full decoded tx)
// ============================================

export interface TxDetailInput {
  prevTxid: string;
  prevVout: number;
  address: string;
  valueSat: number;
  isWalletOwned: boolean;
}

export interface TxDetailOutput {
  index: number;
  address: string | null;
  valueSat: number;
  scriptPubKey: string;
  isWalletOwned: boolean;
}

/**
 * Full decoded transaction details, stored per-txid.
 */
export interface TxDetailEntry {
  txid: string;
  rawHex: string;
  inputs: TxDetailInput[];
  outputs: TxDetailOutput[];
  blockTime: number | null;
  size: number;
  vsize: number;
}

// ============================================
// TRACKED TRANSACTION
// ============================================

/**
 * Per-transaction tracking.
 * Preserved across syncs — never reset on sync failure.
 */
export interface TrackedTransaction {
  txid: string;
  confirmations: number;
  amount: number;
  address: string;
  isIncoming: boolean;
}

// ============================================
// STAGING SNAPSHOT (in-progress sync)
// ============================================

export interface StagingHistoryEntry {
  txHash: string;
  height: number;
}

export interface StagingMeta {
  serverUsed: string;            // "host:port"
  fetchedAt: number;
  tipHeight: number;
  scripthashesQueried: number;
  scripthashesSucceeded: number;
  txDetailsFetched: number;
  txDetailsMissing: string[];    // txids we couldn't fetch
  isComplete: boolean;           // All scripthashes succeeded
}

/**
 * Staging snapshot built during sync.
 * Validated before being promoted to LKG.
 */
export interface StagingSnapshot {
  utxos: LkgUtxo[];
  historyMap: Record<string, StagingHistoryEntry[]>;
  txDetails: Record<string, TxDetailEntry>;
  meta: StagingMeta;
}

// ============================================
// LKG SNAPSHOT (last known good)
// ============================================

/**
 * The Last Known Good snapshot — THE source of truth for UI display.
 * Only updated via validated two-phase commit.
 */
export interface LkgSnapshot {
  utxos: LkgUtxo[];
  transactions: LkgTransaction[];
  txDetails: Record<string, TxDetailEntry>;
  confirmedBalanceSat: number;       // sum(utxos where height > 0)
  unconfirmedBalanceSat: number;     // sum(utxos where height === 0)
  trackedTransactions: [string, TrackedTransaction][];
  committedAt: number;
  tipHeightAtCommit: number | null;
}

// ============================================
// SYNC STATE
// ============================================

export type SyncStatusValue = 'idle' | 'syncing' | 'synced' | 'error' | 'stale';

export interface SyncStateData {
  status: SyncStatusValue;
  lastSuccessfulSyncAt: number | null;
  lastAttemptAt: number | null;
  lastKnownTipHeight: number | null;
  lastServerUsed: string | null;
  isStale: boolean;
  failureCount: number;
  nextRetryAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

// ============================================
// INTEGRITY
// ============================================

export interface IntegrityData {
  snapshotHash: string;              // SHA-256 of JSON.stringify(lkg)
  lastGoodSnapshotHash: string | null;
  atomicWriteId: string;             // UUID per write
}

// ============================================
// KEY REFERENCE
// ============================================

export interface KeyRefData {
  secretId: string | null;           // SecureStorage key prefix
  fingerprint: string | null;        // Master fingerprint (8 hex chars)
  descriptor: string | null;         // Output descriptor (public portion only)
  scriptTypes: CanonicalScriptType[];
}

// ============================================
// SCRIPT INVENTORY
// ============================================

export interface ScriptInventoryData {
  addresses: AddressInfo[];
  addressIndices: AddressIndices;
  preferredAddressType: AddressType;
  usedAddresses: string[];           // Serialized from Set
  gapLimit: number;
  lastDiscoveryAt: number | null;
}

// ============================================
// WALLET FILE V2 SCHEMA
// ============================================

/**
 * Complete V2 wallet file schema.
 * Single JSON file per wallet — the authoritative persistence format.
 */
export interface WalletFileV2Schema {
  // A) Identity & Metadata
  schemaVersion: 2;
  walletId: string;
  name: string;
  walletType: CanonicalWalletType;
  importSource: ImportSourceType;
  createdAt: number;
  lastModified: number;
  network: 'mainnet';

  // B) Key / Policy References
  keyRef: KeyRefData;

  // C) Script Inventory & Discovery State
  scriptInventory: ScriptInventoryData;

  // D) Sync State
  syncState: SyncStateData;

  // E) Last Known Good Snapshot
  lkg: LkgSnapshot;

  // F) Staging Snapshot (null when idle)
  staging: StagingSnapshot | null;

  // G) Integrity / Anti-corruption
  integrity: IntegrityData;

  // Legacy compat
  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;
  watchOnlyData: any | null;

  // H) User Metadata (optional — backward compatible)
  txUserMetadata?: Record<string, TxUserMetadata>;
  utxoUserMetadata?: Record<string, UtxoUserMetadata>;
  addressLabels?: Record<string, AddressUserMetadata>;

  // I) Keys & Descriptors
  xpubs?: XpubEntry[];
  descriptors?: DescriptorEntry[];

  // J) Backup Metadata
  backupMeta?: BackupMeta;
}

// ============================================
// USER METADATA
// ============================================

/** Per-transaction user metadata (note, tags). */
export interface TxUserMetadata {
  note?: string;
  tags?: string[];
  createdAt: number;
  editedAt: number;
}

/** Per-UTXO user metadata (frozen, locked, note, tags). */
export interface UtxoUserMetadata {
  note?: string;
  tags?: string[];
  isFrozen: boolean;
  isLocked: boolean;
  createdAt?: number;
}

/** Per-address user label/note. */
export interface AddressUserMetadata {
  label?: string;
  note?: string;
}

// ============================================
// XPUB & DESCRIPTOR PERSISTENCE
// ============================================

/** Persisted xpub entry. */
export interface XpubEntry {
  xpub: string;
  derivationPath: string;
  scriptType: CanonicalScriptType;
  fingerprint?: string;
}

/** Persisted descriptor entry. */
export interface DescriptorEntry {
  descriptor: string;
  isRange: boolean;
  checksum?: string;
  /** true = change/internal chain, false = receive/external chain */
  internal: boolean;
}

// ============================================
// BACKUP METADATA
// ============================================

/** Tracks when/how the wallet was last backed up. */
export interface BackupMeta {
  lastBackupAt: number | null;
  backupHash: string | null;
  lastICloudSyncAt: number | null;
}

// ============================================
// CANONICAL WALLET SNAPSHOT
// ============================================

/**
 * Unified snapshot format used for:
 * 1. iCloud backup payload (encrypted)
 * 2. Preserve-on-delete archive (encrypted, Keychain)
 *
 * Extracted from WalletFileV2Schema via CanonicalSnapshotBuilder.extract().
 * EXCLUDES secrets (mnemonic, xprv, WIF) — those are in BackupPayload.
 * EXCLUDES staging data — only committed LKG state.
 */
export interface CanonicalWalletSnapshot {
  schemaVersion: 2;
  walletId: string;
  name: string;
  walletType: CanonicalWalletType;
  importSource: ImportSourceType;
  createdAt: number;
  lastModified: number;
  network: 'mainnet';

  keysAndDescriptors: {
    fingerprint: string | null;
    xpubs: XpubEntry[];
    descriptors: DescriptorEntry[];
    scriptTypes: CanonicalScriptType[];
  };

  addressCache: ScriptInventoryData & {
    addressLabels: Record<string, AddressUserMetadata>;
  };

  utxoCache: {
    utxos: LkgUtxo[];
    utxoMetadata: Record<string, UtxoUserMetadata>;
  };

  txCache: {
    transactions: LkgTransaction[];
    txDetails: Record<string, TxDetailEntry>;
    txUserMetadata: Record<string, TxUserMetadata>;
  };

  syncState: SyncStateData;
  confirmedBalanceSat: number;
  unconfirmedBalanceSat: number;
  trackedTransactions: [string, TrackedTransaction][];

  isMultisig: boolean;
  multisigConfig: MultisigConfig | null;
  backupMeta: BackupMeta;

  /**
   * Optional secrets block — ONLY populated for Preserve-on-Delete archives.
   * NOT included in iCloud backups (those use BackupPayload for secrets).
   * Contains key material needed to fully restore wallet functionality.
   */
  secrets?: {
    secretId: string | null;
    secretType: string | null;
    mnemonic: string | null;
    passphrase: string | null;
    masterXprv: string | null;
    masterXpub: string | null;
    seedHex: string | null;
    descriptor: string | null;
    watchOnlyData: string | null;
    /** Per-address WIF keys (address → WIF) */
    addressWifs?: Record<string, string>;
  };
}

// ============================================
// SYNC OPTIONS & OUTCOME
// ============================================

export interface SyncOptions {
  /** Ignore staleness check, sync immediately */
  force?: boolean;
  /** Fetch full transaction details (default: true) */
  fetchTxDetails?: boolean;
  /** Number of retries on failure (default: 2) */
  retryCount?: number;
  /** Prefer specific server for cross-check */
  serverHint?: string;
  /** Skip BIP44 gap limit address discovery (default: false) */
  skipDiscovery?: boolean;
}

export type SyncOutcome =
  | { ok: true; newTxCount: number; balanceChanged: boolean; durationMs: number }
  | { ok: false; error: string; preservedLkg: boolean };

// ============================================
// VALIDATION
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================
// ERROR CLASSIFICATION
// ============================================

export type ErrorClass = 'network' | 'timeout' | 'protocol' | 'malformed' | 'server_error';

/**
 * Classify an error for server health tracking.
 */
export function classifyError(error: any): ErrorClass {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('dns') ||
    msg.includes('connection lost') ||
    msg.includes('socket') ||
    msg.includes('econnreset') ||
    msg.includes('epipe')
  ) return 'network';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('unexpected')) return 'malformed';
  if (error?.code) return 'server_error';
  return 'network';
}

// ============================================
// SERVER HEALTH (for ServerCacheManager)
// ============================================

export interface ServerHealthRecord {
  host: string;
  port: number;
  transport: 'tls' | 'wss' | 'tcp';

  // Counters
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;

  // Latency
  avgLatencyMs: number;
  latencySamples: number;

  // Timestamps
  lastTriedAt: number;
  lastSuccessAt: number;
  lastFailureAt: number;

  // Server info (populated on successful handshake)
  protocolVersion: string | null;
  serverImpl: string | null;
  supportsBatchArray: boolean;
  pruningLimit: number | null;

  // Computed
  score: number;
  blacklistUntil: number;          // 0 = not blacklisted

  // Error classification
  lastErrorClass: string | null;                // e.g. 'DNS_ERROR', 'TLS_ERROR', 'TIMEOUT'
  errorClassCounts: Record<string, number>;     // Histogram: { DNS_ERROR: 2, TIMEOUT: 5 }

  // Latency distribution (circular buffer, max 20 samples)
  latencyHistory: number[];
}

// ============================================
// UTILITY: compute balance from UTXOs
// ============================================

/**
 * Compute balance from a UTXO set.
 * This is the ONLY way balance should be derived — never from a separate API call.
 */
export function computeBalanceFromUtxos(utxos: LkgUtxo[]): { confirmed: number; unconfirmed: number; total: number } {
  let confirmed = 0;
  let unconfirmed = 0;
  for (const u of utxos) {
    if (u.height > 0) {
      confirmed += u.valueSat;
    } else {
      unconfirmed += u.valueSat;
    }
  }
  return { confirmed, unconfirmed, total: confirmed + unconfirmed };
}

/**
 * Create empty sync state.
 */
export function createEmptySyncState(): SyncStateData {
  return {
    status: 'idle',
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    lastKnownTipHeight: null,
    lastServerUsed: null,
    isStale: false,
    failureCount: 0,
    nextRetryAt: null,
    lastError: null,
    lastErrorAt: null,
  };
}

/**
 * Create empty LKG snapshot.
 */
export function createEmptyLkg(): LkgSnapshot {
  return {
    utxos: [],
    transactions: [],
    txDetails: {},
    confirmedBalanceSat: 0,
    unconfirmedBalanceSat: 0,
    trackedTransactions: [],
    committedAt: 0,
    tipHeightAtCommit: null,
  };
}

/**
 * Create empty integrity data.
 */
export function createEmptyIntegrity(): IntegrityData {
  return {
    snapshotHash: '',
    lastGoodSnapshotHash: null,
    atomicWriteId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

/**
 * Create empty backup metadata.
 */
export function createEmptyBackupMeta(): BackupMeta {
  return {
    lastBackupAt: null,
    backupHash: null,
    lastICloudSyncAt: null,
  };
}
