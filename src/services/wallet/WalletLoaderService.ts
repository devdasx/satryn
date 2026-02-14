/**
 * WalletLoaderService — Unified wallet data loading from SQLite
 *
 * Single source of truth for reading wallet data from the database.
 * Replaces two duplicated implementations:
 *   1. walletStore.ts loadWalletFromDB() — converts to Zustand store shape
 *   2. WalletEngine.ts buildSchemaFromDB() — converts to WalletFileV2Schema
 *
 * Both consumers now call loadWalletSnapshot() and use an adapter function
 * to convert the raw DB snapshot to their specific output format.
 */

import { WalletDatabase } from '../database/WalletDatabase';
import { scriptToAddressType, addressTypeToScript } from '../../utils/addressTypeMap';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType, AddressInfo, BalanceInfo, UTXO, DetailedTransactionInfo } from '../../types';
import type { AccountAddressIndices } from '../../types';
import type {
  WalletRow,
  AddressRow,
  UtxoRow,
  TransactionRow,
  TxDetailRow,
  XpubRow,
  DescriptorRow,
  SyncStateRow,
  BalanceResult,
} from '../database/types';
import type {
  WalletFileV2Schema,
  AddressIndices,
  LkgUtxo,
  LkgTransaction,
  TxDetailEntry,
  TxDetailInput,
  TxDetailOutput,
  SyncStateData,
  CanonicalScriptType,
  TrackedTransaction,
  XpubEntry,
  DescriptorEntry,
} from '../sync/types';
import { computeBalanceFromUtxos, createEmptySyncState } from '../sync/types';
import { SyncLogger } from '../SyncLogger';

// ─── Raw DB Snapshot ─────────────────────────────────────────────────

/**
 * Raw data loaded from all DB tables for a single wallet.
 * Shared between all consumers — each applies its own adapter.
 */
export interface WalletDBSnapshot {
  wallet: WalletRow;
  addresses: AddressRow[];
  utxos: UtxoRow[];
  transactions: TransactionRow[];
  txDetails: Record<string, TxDetailRow>;
  xpubs: XpubRow[];
  descriptors: DescriptorRow[];
  syncState: SyncStateRow | null;
  balance: BalanceResult;
  usedAddresses: string[];
}

// ─── Store State Output ──────────────────────────────────────────────

/**
 * The shape returned for walletStore consumption.
 * Matches what loadWalletFromDB() previously returned.
 */
export interface WalletStoreState {
  addresses: AddressInfo[];
  addressIndices: AccountAddressIndices;
  preferredAddressType: AddressType;
  usedAddresses: Set<string>;
  balance: BalanceInfo;
  utxos: UTXO[];
  transactions: DetailedTransactionInfo[];
  trackedTransactions: Map<string, TrackedTransaction>;
  lastSync: number | null;
  isMultisig: boolean;
  multisigConfig: any;
  network: 'mainnet' | 'testnet';
}

// ─── Core: Load Snapshot ─────────────────────────────────────────────

/**
 * Load all wallet data from DB in one call.
 * Returns a raw snapshot or null if wallet doesn't exist.
 *
 * @param walletId - Wallet ID to load
 * @returns WalletDBSnapshot or null
 */
export function loadWalletSnapshot(walletId: string): WalletDBSnapshot | null {
  try {
    const db = WalletDatabase.shared();
    const wallet = db.getWallet(walletId);
    if (!wallet) return null;

    const addresses = db.getAddresses(walletId);
    if (addresses.length === 0) return null;

    const utxos = db.getUtxos(walletId);
    const transactions = db.getTransactions(walletId);
    const txDetails = db.getAllTxDetails(walletId);
    const xpubs = db.getXpubs(walletId);
    const descriptors = db.getDescriptors(walletId);
    const syncState = db.getSyncState(walletId);
    const balance = db.getBalance(walletId);
    const usedAddresses = db.getUsedAddresses(walletId);

    return {
      wallet,
      addresses,
      utxos,
      transactions,
      txDetails,
      xpubs,
      descriptors,
      syncState,
      balance,
      usedAddresses,
    };
  } catch (err: any) {
    SyncLogger.warn('wallet-loader', `Failed to load snapshot for ${walletId}: ${err?.message}`);
    return null;
  }
}

// ─── Adapter: Snapshot → Store State ─────────────────────────────────

/**
 * Convert a WalletDBSnapshot to the walletStore state shape.
 * Used by walletStore.loadWalletFromDB().
 *
 * @param snapshot - Raw DB snapshot
 * @returns WalletStoreState ready for Zustand set()
 */
export function snapshotToStoreState(snapshot: WalletDBSnapshot): WalletStoreState {
  const { wallet, addresses: addrRows, utxos: utxoRows, transactions: txRows, txDetails: txDetailMap, syncState, balance: balanceResult, usedAddresses: usedAddrs } = snapshot;

  // Convert AddressRow[] → AddressInfo[]
  const addresses: AddressInfo[] = addrRows.map(row => ({
    address: row.address,
    path: row.path,
    index: row.addressIndex,
    isChange: row.isChange === 1,
    type: scriptToAddressType(row.addressType) as AddressType,
    label: row.label ?? undefined,
  }));

  // Build address indices from max indexes per type/chain
  const addressIndices = buildAddressIndices(snapshot.wallet.walletId);

  // Balance
  const balance: BalanceInfo = {
    confirmed: balanceResult.confirmed,
    unconfirmed: balanceResult.unconfirmed,
    total: balanceResult.total,
  };

  // UTXOs → legacy UTXO format
  const utxos: UTXO[] = utxoRows.map(u => ({
    txid: u.txid,
    vout: u.vout,
    value: u.valueSat,
    address: u.address,
    scriptPubKey: u.scriptPubKey,
    confirmations: u.confirmations,
  }));

  // Transactions → DetailedTransactionInfo[]
  const transactions: DetailedTransactionInfo[] = txRows.map((tx, idx, arr) => {
    const detail = txDetailMap[tx.txid];
    let inputs: { index: number; prevTxid: string; prevVout: number; address: string; value: number }[] = [];
    let outputs: { index: number; address: string | null; value: number }[] = [];

    if (detail) {
      try {
        const parsedInputs = JSON.parse(detail.inputs);
        const parsedOutputs = JSON.parse(detail.outputs);
        inputs = parsedInputs.map((inp: any, i: number) => ({
          index: i,
          prevTxid: inp.prevTxid ?? '',
          prevVout: inp.prevVout ?? 0,
          address: inp.address ?? '',
          value: inp.valueSat ?? 0,
        }));
        outputs = parsedOutputs.map((out: any) => ({
          index: out.index ?? 0,
          address: out.address ?? null,
          value: out.valueSat ?? 0,
        }));
      } catch {
        // JSON parse failed — use empty arrays
      }
    }

    return {
      txid: tx.txid,
      height: tx.blockHeight ?? 0,
      confirmed: tx.status === 'confirmed',
      blockTime: detail?.blockTime ?? (tx.firstSeenAt ? Math.floor(tx.firstSeenAt / 1000) : 0),
      confirmations: tx.confirmations,
      fee: tx.feeSat,
      feeRate: tx.feeRate,
      isRBF: tx.isRBF === 1,
      rawHex: detail?.rawHex ?? '',
      inputs,
      outputs,
      size: tx.size,
      vsize: tx.vsize,
      balanceDiff: tx.valueDeltaSat,
      isLastTransaction: idx === arr.length - 1,
      type: tx.direction as 'incoming' | 'outgoing' | 'self-transfer',
      status: tx.status as 'pending' | 'confirmed',
      firstSeen: tx.firstSeenAt,
    };
  });

  // Sort: pending first (newest), then confirmed (newest block height)
  transactions.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    if (a.status === 'pending' && b.status === 'pending') {
      return (b.firstSeen ?? 0) - (a.firstSeen ?? 0);
    }
    return (b.height ?? 0) - (a.height ?? 0);
  });

  // Parse multisigConfig
  let multisigConfig: any = null;
  if (wallet.multisigConfig) {
    try { multisigConfig = JSON.parse(wallet.multisigConfig); } catch {}
  }

  // Map preferredAddressType
  const preferredAddressType = scriptToAddressType(wallet.preferredAddressType) as AddressType;

  return {
    addresses,
    addressIndices,
    preferredAddressType: preferredAddressType ?? ADDRESS_TYPES.NATIVE_SEGWIT as AddressType,
    usedAddresses: new Set(usedAddrs),
    balance,
    utxos,
    transactions,
    trackedTransactions: new Map(),
    lastSync: syncState?.lastSuccessfulSyncAt ?? null,
    isMultisig: wallet.isMultisig === 1,
    multisigConfig,
    network: wallet.network as 'mainnet' | 'testnet',
  };
}

// ─── Adapter: Snapshot → WalletFileV2Schema ──────────────────────────

/**
 * Convert a WalletDBSnapshot to the WalletFileV2Schema format.
 * Used by WalletEngine.buildSchemaFromDB().
 *
 * @param snapshot - Raw DB snapshot
 * @returns WalletFileV2Schema ready for SyncPipeline/SyncValidator
 */
export function snapshotToV2Schema(snapshot: WalletDBSnapshot): WalletFileV2Schema {
  const { wallet, addresses: addrRows, utxos: utxoRows, transactions: txRows, txDetails: txDetailMap, xpubs: xpubRows, descriptors: descriptorRows, syncState: syncStateRow, usedAddresses: usedAddrs } = snapshot;

  // Convert AddressRow[] → AddressInfo[]
  const addresses: AddressInfo[] = addrRows.map(row => ({
    address: row.address,
    path: row.path,
    index: row.addressIndex,
    isChange: row.isChange === 1,
    type: scriptToAddressType(row.addressType) as AddressType,
    label: row.label ?? undefined,
  }));

  // Build address indices
  const addressIndices = buildAddressIndices(wallet.walletId);

  // UTXOs → LkgUtxo[]
  const lkgUtxos: LkgUtxo[] = utxoRows.map(u => ({
    txid: u.txid,
    vout: u.vout,
    valueSat: u.valueSat,
    height: u.height,
    address: u.address,
    scriptPubKey: u.scriptPubKey,
    scriptType: u.scriptType as CanonicalScriptType,
    scripthash: u.scripthash,
    confirmations: u.confirmations,
  }));

  // Transactions → LkgTransaction[]
  const lkgTransactions: LkgTransaction[] = txRows.map(tx => ({
    txid: tx.txid,
    firstSeenAt: tx.firstSeenAt,
    blockHeight: tx.blockHeight ?? null,
    confirmations: tx.confirmations,
    direction: tx.direction as 'incoming' | 'outgoing' | 'self-transfer',
    valueDeltaSat: tx.valueDeltaSat,
    feeSat: tx.feeSat,
    feeRate: tx.feeRate,
    isRBF: tx.isRBF === 1,
    status: tx.status as 'pending' | 'confirmed',
    inputCount: tx.inputCount,
    outputCount: tx.outputCount,
    size: tx.size,
    vsize: tx.vsize,
  }));

  // Tx details → Record<string, TxDetailEntry>
  const txDetails: Record<string, TxDetailEntry> = {};
  for (const [txid, row] of Object.entries(txDetailMap)) {
    let inputs: TxDetailInput[] = [];
    let outputs: TxDetailOutput[] = [];
    try {
      inputs = JSON.parse(row.inputs);
      outputs = JSON.parse(row.outputs);
    } catch {}
    txDetails[txid] = {
      txid,
      rawHex: row.rawHex,
      inputs,
      outputs,
      blockTime: row.blockTime,
      size: row.size,
      vsize: row.vsize,
    };
  }

  // Sync state
  const syncState: SyncStateData = {
    status: (syncStateRow?.status as any) ?? 'idle',
    lastSuccessfulSyncAt: syncStateRow?.lastSuccessfulSyncAt ?? null,
    lastAttemptAt: syncStateRow?.lastAttemptAt ?? null,
    lastKnownTipHeight: syncStateRow?.lastKnownTipHeight ?? null,
    lastServerUsed: syncStateRow?.lastServerUsed ?? null,
    isStale: syncStateRow?.isStale === 1,
    failureCount: syncStateRow?.failureCount ?? 0,
    nextRetryAt: syncStateRow?.nextRetryAt ?? null,
    lastError: syncStateRow?.lastError ?? null,
    lastErrorAt: syncStateRow?.lastErrorAt ?? null,
  };

  // Balance from UTXOs
  const balance = computeBalanceFromUtxos(lkgUtxos);

  // Script types
  let scriptTypes: CanonicalScriptType[] = [];
  try {
    scriptTypes = JSON.parse(wallet.scriptTypes);
  } catch {
    scriptTypes = ['p2wpkh'];
  }

  // Build schema
  const schema: WalletFileV2Schema = {
    schemaVersion: 2,
    walletId: wallet.walletId,
    name: wallet.name,
    walletType: wallet.walletType as any,
    importSource: wallet.importSource as any,
    createdAt: wallet.createdAt,
    lastModified: wallet.lastModified,
    network: 'mainnet',
    keyRef: {
      secretId: wallet.secretId,
      fingerprint: wallet.fingerprint,
      descriptor: wallet.descriptor,
      scriptTypes,
    },
    scriptInventory: {
      addresses,
      addressIndices,
      preferredAddressType: scriptToAddressType(wallet.preferredAddressType) as AddressType,
      usedAddresses: usedAddrs,
      gapLimit: wallet.gapLimit,
      lastDiscoveryAt: null,
    },
    syncState,
    lkg: {
      utxos: lkgUtxos,
      transactions: lkgTransactions,
      txDetails,
      confirmedBalanceSat: balance.confirmed,
      unconfirmedBalanceSat: balance.unconfirmed,
      trackedTransactions: [],
      committedAt: syncState.lastSuccessfulSyncAt ?? 0,
      tipHeightAtCommit: syncState.lastKnownTipHeight ?? null,
    },
    staging: null,
    integrity: {
      snapshotHash: '',
      lastGoodSnapshotHash: null,
      atomicWriteId: '',
    },
    isMultisig: wallet.isMultisig === 1,
    multisigConfig: wallet.multisigConfig ? (() => { try { return JSON.parse(wallet.multisigConfig!); } catch { return null; } })() : null,
    watchOnlyData: wallet.watchOnlyData ? (() => { try { return JSON.parse(wallet.watchOnlyData!); } catch { return null; } })() : null,
  };

  return schema;
}

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * Build address indices from max DB indexes per type/chain.
 * Shared between both adapters.
 */
function buildAddressIndices(walletId: string): AccountAddressIndices {
  const db = WalletDatabase.shared();
  return {
    native_segwit: {
      receiving: db.getMaxAddressIndex(walletId, 'p2wpkh', false) + 1,
      change: db.getMaxAddressIndex(walletId, 'p2wpkh', true) + 1,
    },
    wrapped_segwit: {
      receiving: db.getMaxAddressIndex(walletId, 'p2sh-p2wpkh', false) + 1,
      change: db.getMaxAddressIndex(walletId, 'p2sh-p2wpkh', true) + 1,
    },
    legacy: {
      receiving: db.getMaxAddressIndex(walletId, 'p2pkh', false) + 1,
      change: db.getMaxAddressIndex(walletId, 'p2pkh', true) + 1,
    },
    taproot: {
      receiving: db.getMaxAddressIndex(walletId, 'p2tr', false) + 1,
      change: db.getMaxAddressIndex(walletId, 'p2tr', true) + 1,
    },
  };
}
