/**
 * Database Row Type Definitions
 *
 * Thin data types matching each SQLite table.
 * No logic — just shape definitions for row data.
 */

import type { CanonicalWalletType, CanonicalScriptType } from '../sync/types';
import type { AddressType } from '../../types';

// ============================================
// WALLET ROW
// ============================================

export interface WalletRow {
  walletId: string;
  name: string;
  walletType: string;              // CanonicalWalletType stored as TEXT
  importSource: string;            // ImportSourceType stored as TEXT
  createdAt: number;
  lastModified: number;
  network: string;
  secretId: string | null;
  fingerprint: string | null;
  descriptor: string | null;
  scriptTypes: string;             // JSON array: '["p2wpkh","p2tr"]'
  preferredAddressType: string;
  gapLimit: number;
  isMultisig: number;              // 0 or 1
  multisigConfig: string | null;   // JSON
  confirmedBalanceSat: number;
  unconfirmedBalanceSat: number;
  watchOnlyData: string | null;    // JSON
  // Key material (added in migration v2)
  secretType: string | null;         // 'mnemonic' | 'xprv' | 'wif' | 'wif_set' | 'seed_hex' | 'watch_only'
  mnemonic: string | null;           // BIP39 mnemonic phrase
  passphrase: string | null;         // BIP39 passphrase (25th word)
  masterXprv: string | null;         // Master extended private key
  masterXpub: string | null;         // Master extended public key
  seedHex: string | null;            // Raw seed bytes as hex
}

// ============================================
// ADDRESS ROW
// ============================================

export interface AddressRow {
  id?: number;                     // AUTO INCREMENT, optional on insert
  walletId: string;
  address: string;
  path: string;                    // e.g. "m/84'/0'/0'/0/5"
  addressIndex: number;
  isChange: number;                // 0 or 1
  addressType: string;             // p2wpkh, p2sh-p2wpkh, p2tr, p2pkh
  scripthash: string | null;       // pre-computed Electrum scripthash
  isUsed: number;                  // 0 or 1
  label: string | null;
  note: string | null;
  wif: string | null;              // Wallet Import Format private key (added in migration v2)
}

// ============================================
// TRANSACTION ROW
// ============================================

export interface TransactionRow {
  walletId: string;
  txid: string;
  firstSeenAt: number;
  blockHeight: number | null;
  confirmations: number;
  direction: string;               // 'incoming' | 'outgoing'
  valueDeltaSat: number;
  feeSat: number;
  feeRate: number;
  isRBF: number;                   // 0 or 1
  status: string;                  // 'pending' | 'confirmed'
  inputCount: number;
  outputCount: number;
  size: number;
  vsize: number;
  userNote: string | null;
  userTags: string | null;         // JSON array
}

// ============================================
// UTXO ROW
// ============================================

export interface UtxoRow {
  walletId: string;
  txid: string;
  vout: number;
  valueSat: number;
  height: number;                  // 0 = unconfirmed
  address: string;
  scriptPubKey: string;
  scriptType: string;              // CanonicalScriptType
  scripthash: string;
  confirmations: number;
  isFrozen: number;                // 0 or 1
  isLocked: number;                // 0 or 1
  userNote: string | null;
  userTags: string | null;         // JSON array
}

// ============================================
// TX DETAIL ROW
// ============================================

export interface TxDetailRow {
  walletId: string;
  txid: string;
  rawHex: string;
  inputs: string;                  // JSON array of TxDetailInput
  outputs: string;                 // JSON array of TxDetailOutput
  blockTime: number | null;
  size: number;
  vsize: number;
}

// ============================================
// XPUB ROW
// ============================================

export interface XpubRow {
  id?: number;
  walletId: string;
  xpub: string;
  derivationPath: string;
  scriptType: string;
  fingerprint: string | null;
}

// ============================================
// DESCRIPTOR ROW
// ============================================

export interface DescriptorRow {
  id?: number;
  walletId: string;
  descriptor: string;
  isRange: number;                 // 0 or 1
  checksum: string | null;
  internal: number;                // 0 or 1
}

// ============================================
// SYNC STATE ROW
// ============================================

export interface SyncStateRow {
  walletId: string;
  status: string;                  // 'idle' | 'syncing' | 'synced' | 'error' | 'stale'
  lastSuccessfulSyncAt: number | null;
  lastAttemptAt: number | null;
  lastKnownTipHeight: number | null;
  lastServerUsed: string | null;
  isStale: number;                 // 0 or 1
  failureCount: number;
  nextRetryAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

// ============================================
// SCRIPTHASH STATUS ROW
// ============================================

export interface ScripthashStatusRow {
  walletId: string;
  scripthash: string;
  address: string;
  lastStatus: string | null;       // Electrum status hash
  lastCheckedAt: number | null;
}

// ============================================
// MIGRATION LOG ROW
// ============================================

export interface MigrationLogRow {
  version: number;
  appliedAt: number;
  description: string | null;
}

// ============================================
// CONTACT ROW
// ============================================

export interface ContactRow {
  id: string;
  name: string;
  tags: string;                    // JSON array of strings
  notes: string | null;
  isFavorite: number;              // 0 or 1
  color: string | null;            // Hex color for avatar, e.g. '#5B7FFF'
  createdAt: number;
  updatedAt: number;
}

// ============================================
// CONTACT ADDRESS ROW
// ============================================

export interface ContactAddressRow {
  id: string;
  contactId: string;
  label: string | null;
  address: string;
  network: string;                 // 'mainnet' | 'testnet'
  isDefault: number;               // 0 or 1
  createdAt: number;
  updatedAt: number | null;
}

// ============================================
// RECENT RECIPIENT ROW
// ============================================

export interface RecentRecipientRow {
  address: string;
  contactId: string | null;
  label: string | null;
  firstUsed: number;
  lastUsed: number;
  useCount: number;
}

// ============================================
// APP CONFIG ROW
// ============================================

export interface AppConfigRow {
  key: string;
  value: string;
  updatedAt: number;
}

// ============================================
// SAVED SERVER ROW
// ============================================

export interface SavedServerRow {
  id: string;
  host: string;
  port: number;
  ssl: number;                       // 0 or 1
  isBuiltIn: number;                 // 0 or 1
  isUserAdded: number;               // 0 or 1
  isFavorite: number;                // 0 or 1
  notes: string | null;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// BALANCE RESULT (computed, not a table)
// ============================================

export interface BalanceResult {
  confirmed: number;
  unconfirmed: number;
  total: number;
}

// ============================================
// COMMIT SYNC PARAMS
// ============================================

export interface CommitSyncParams {
  utxos: UtxoRow[];
  transactions: TransactionRow[];
  txDetails: TxDetailRow[];
  tipHeight: number;
  serverUsed: string;
}
