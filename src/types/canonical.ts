/**
 * Canonical Wallet Schema (CWS)
 *
 * This file defines the unified wallet model used across all wallet types in Satryn.
 * All 11+ wallet types normalize to a single CanonicalWalletRecord structure.
 *
 * MAINNET ONLY - Satryn does not support testnet.
 */

import type { MultisigConfig, AddressInfo, BalanceInfo } from './index';

// ============================================
// CANONICAL WALLET TYPES
// ============================================

/**
 * All supported wallet types in canonical form.
 * These map to various import sources but normalize to consistent behavior.
 */
export type CanonicalWalletType =
  | 'hd_mnemonic'      // BIP39 mnemonic (12/24 words)
  | 'hd_xprv'          // Extended private key (xprv/yprv/zprv)
  | 'hd_seed'          // Raw seed bytes (hex)
  | 'hd_descriptor'    // Output descriptor with private key
  | 'hd_electrum'      // Electrum-format seed
  | 'imported_key'     // Single WIF private key
  | 'imported_keys'    // Multiple WIF keys (dumpwallet format)
  | 'watch_xpub'       // Extended public key (xpub/ypub/zpub)
  | 'watch_descriptor' // Public output descriptor
  | 'watch_addresses'  // Static address list
  | 'multisig';        // Multi-signature wallet

/**
 * Script types for address derivation.
 * Maps to BIP standards and output script formats.
 */
export type CanonicalScriptType =
  | 'p2pkh'        // Legacy (1...)
  | 'p2sh-p2wpkh'  // Wrapped SegWit (3...)
  | 'p2wpkh'       // Native SegWit (bc1q...)
  | 'p2tr'         // Taproot (bc1p...)
  | 'p2wsh'        // Native SegWit multisig
  | 'p2sh-p2wsh';  // Wrapped SegWit multisig

// ============================================
// CAPABILITY FLAGS
// ============================================

/**
 * Wallet capabilities determine what operations are available.
 * Computed from wallet type and used for UI/API decisions.
 */
export interface CapabilityFlags {
  /** Can sign transactions */
  canSign: boolean;
  /** Can derive new addresses from parent key */
  canDerive: boolean;
  /** Can export original seed phrase */
  canExportSeed: boolean;
  /** Can export extended private key */
  canExportXprv: boolean;
  /** Can export extended public key */
  canExportXpub: boolean;
  /** Requires PIN for sensitive operations */
  requiresPin: boolean;
  /** Supports BIP39 passphrase (25th word) */
  supportsPassphrase: boolean;
  /** Supports gap limit address discovery */
  supportsAddressDiscovery: boolean;
  /** Supports manual UTXO selection */
  supportsCoinControl: boolean;
}

/**
 * Default capability flags for each wallet type.
 * Used by WalletNormalizer.getCapabilities()
 */
export const WALLET_TYPE_CAPABILITIES: Record<CanonicalWalletType, CapabilityFlags> = {
  hd_mnemonic: {
    canSign: true,
    canDerive: true,
    canExportSeed: true,
    canExportXprv: true,
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: true,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  hd_xprv: {
    canSign: true,
    canDerive: true,
    canExportSeed: false,  // No mnemonic available
    canExportXprv: true,
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  hd_seed: {
    canSign: true,
    canDerive: true,
    canExportSeed: false,  // Only raw bytes, no mnemonic
    canExportXprv: true,
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  hd_descriptor: {
    canSign: true,
    canDerive: true,  // Partial - limited by descriptor range
    canExportSeed: false,
    canExportXprv: false,  // May not have full xprv
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  hd_electrum: {
    canSign: true,
    canDerive: true,
    canExportSeed: true,  // Electrum seed format
    canExportXprv: false, // Different derivation
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  imported_key: {
    canSign: true,
    canDerive: false,     // Single key, no derivation
    canExportSeed: false,
    canExportXprv: false,
    canExportXpub: false,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: false,
    supportsCoinControl: true,
  },
  imported_keys: {
    canSign: true,
    canDerive: false,     // Fixed key set
    canExportSeed: false,
    canExportXprv: false,
    canExportXpub: false,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: false,
    supportsCoinControl: true,
  },
  watch_xpub: {
    canSign: false,       // Watch-only
    canDerive: true,
    canExportSeed: false,
    canExportXprv: false,
    canExportXpub: true,
    requiresPin: false,   // No secrets
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  watch_descriptor: {
    canSign: false,       // Watch-only
    canDerive: true,      // Partial - limited by descriptor
    canExportSeed: false,
    canExportXprv: false,
    canExportXpub: true,  // Partial - may extract xpub
    requiresPin: false,   // No secrets
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
  watch_addresses: {
    canSign: false,       // Watch-only
    canDerive: false,     // Fixed address set
    canExportSeed: false,
    canExportXprv: false,
    canExportXpub: false,
    requiresPin: false,   // No secrets
    supportsPassphrase: false,
    supportsAddressDiscovery: false,
    supportsCoinControl: true,
  },
  multisig: {
    canSign: true,        // Partial - depends on local cosigner keys
    canDerive: true,
    canExportSeed: true,  // Partial - only local cosigner seeds
    canExportXprv: false,
    canExportXpub: true,
    requiresPin: true,
    supportsPassphrase: false,
    supportsAddressDiscovery: true,
    supportsCoinControl: true,
  },
};

// ============================================
// CANONICAL WALLET RECORD
// ============================================

/**
 * Unified wallet record that all wallet types normalize to.
 * This is the single source of truth for wallet state.
 */
export interface CanonicalWalletRecord {
  // ── Identity ──
  /** Unique wallet identifier (UUID v4) */
  id: string;
  /** User-defined wallet name */
  name: string;
  /** Canonical wallet type */
  type: CanonicalWalletType;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Last modification timestamp (ms since epoch) */
  updatedAt: number;
  /** Always mainnet - Satryn does not support testnet */
  network: 'mainnet';

  // ── Secret Reference ──
  /**
   * Reference to encrypted secret in SecureVault.
   * null for watch-only wallets.
   */
  secretId: string | null;

  // ── Derivation Configuration ──
  derivation: {
    /** Derivation preset or custom */
    preset: 'hd' | 'bip44' | 'bip49' | 'bip84' | 'bip86' | 'bip48' | 'custom' | null;
    /** Account index (default 0) */
    accountIndex: number;
    /** Custom derivation path (if preset is 'custom') */
    customPath?: string;
    /** Script type for address generation */
    scriptType: CanonicalScriptType;
  };

  // ── Capabilities ──
  /** Computed capabilities based on wallet type */
  capabilities: CapabilityFlags;

  // ── Address Cache ──
  addressCache: {
    /** Derived receiving addresses */
    receiving: AddressInfo[];
    /** Derived change addresses */
    change: AddressInfo[];
    /** Last derived receiving index */
    lastDerivedReceiving: number;
    /** Last derived change index */
    lastDerivedChange: number;
  };

  // ── Sync State ──
  sync: {
    /** Current sync status */
    status: 'idle' | 'syncing' | 'synced' | 'error';
    /** Last successful sync timestamp (ms since epoch) */
    lastSyncedAt: number | null;
    /** Error message if status is 'error' */
    error?: string;
  };

  // ── Balance Cache ──
  balance: BalanceInfo;

  // ── Multisig Configuration ──
  /** Only present for multisig wallets */
  multisig?: MultisigConfig;

  // ── Metadata ──
  meta: {
    /** Master fingerprint (8 hex chars) */
    fingerprint?: string;
    /** Extended public key for HD wallets */
    xpub?: string;
    /** Output descriptor string */
    descriptor?: string;
    /** Watch-only address list */
    watchAddresses?: string[];
    /** Original import format (for debugging/display) */
    sourceFormat?: string;
    /** BIP39 passphrase indicator */
    hasPassphrase?: boolean;
  };

  // ── Backup Tracking ──
  backup: {
    /** Last backup timestamp (ms since epoch) */
    lastBackupAt: number | null;
    /** Recommended backup method for this wallet type */
    recommendedMethod: 'phrase' | 'encrypted_file' | 'descriptor' | 'none';
    /** Whether seed phrase export is possible */
    canExportPhrase: boolean;
  };
}

// ============================================
// SECRET TYPES
// ============================================

/**
 * Types of secrets that can be stored in SecureVault.
 */
export type SecretType =
  | 'mnemonic'           // BIP39 mnemonic phrase
  | 'passphrase'         // BIP39 passphrase (25th word)
  | 'xprv'               // Extended private key
  | 'seed_hex'           // Raw seed bytes as hex
  | 'wif'                // Single WIF private key
  | 'wif_set'            // Multiple WIF keys (JSON array)
  | 'descriptor'         // Private descriptor
  | 'cosigner_mnemonic'; // Cosigner seed for multisig

/**
 * Metadata about a stored secret (without revealing the secret).
 */
export interface SecretMetadata {
  /** Wallet ID this secret belongs to */
  walletId: string;
  /** Type of secret */
  type: SecretType;
  /** When the secret was stored */
  storedAt: number;
  /** Whether passphrase is also stored */
  hasPassphrase?: boolean;
}

// ============================================
// IMPORT PAYLOAD TYPES
// ============================================

/**
 * Extended import payload that includes all possible import data.
 * Used by WalletNormalizer to create CanonicalWalletRecord.
 */
export interface ImportPayload {
  /** Import type indicator */
  type: CanonicalWalletType;

  // ── Secret Data (one of these) ──
  mnemonic?: string;
  passphrase?: string;
  xprv?: string;
  seedHex?: string;
  wif?: string;
  wifKeys?: WifKeyEntry[];
  privateDescriptor?: string;

  // ── Public Data ──
  xpub?: string;
  publicDescriptor?: string;
  watchAddresses?: string[];

  // ── Configuration ──
  derivationConfig?: DerivationConfig;
  scriptType?: CanonicalScriptType;
  name?: string;
  compressed?: boolean;

  // ── Multisig ──
  multisigConfig?: MultisigConfig;
  cosignerSeeds?: CosignerSeed[];
}

/**
 * WIF key entry for imported_keys type.
 */
export interface WifKeyEntry {
  wif: string;
  compressed?: boolean;
  label?: string;
}

/**
 * Cosigner seed for multisig wallets.
 */
export interface CosignerSeed {
  index: number;
  mnemonic: string;
  name: string;
}

/**
 * Derivation path configuration.
 */
export interface DerivationConfig {
  preset: 'hd' | 'bip44' | 'bip49' | 'bip84' | 'bip86' | 'bip48' | 'custom';
  accountIndex?: number;
  customPath?: string;
  purpose?: number;
  coinType?: number;
}

// ============================================
// SYNC & ENGINE TYPES
// ============================================

/**
 * Request for wallet synchronization.
 */
export interface SyncRequest {
  walletId: string;
  network: 'mainnet';
  /** Script hashes or addresses to sync */
  targets: string[];
  /** Gap limit for address discovery */
  gapLimit: number;
  /** Previous sync state for incremental sync */
  cacheState: {
    lastSyncedAt: number | null;
  };
}

/**
 * Result of a wallet sync operation.
 */
export interface SyncResult {
  success: boolean;
  /** New transactions found */
  newTransactions: number;
  /** Updated balance */
  balance: BalanceInfo;
  /** New addresses discovered */
  addressesDiscovered: number;
  /** Sync duration in ms */
  durationMs: number;
  /** Error message if success is false */
  error?: string;
}

/**
 * Parameters for creating a PSBT.
 */
export interface CreatePsbtParams {
  recipients: Array<{
    address: string;
    amount: number; // satoshis
  }>;
  feeRate: number; // sat/vB
  /** Manual UTXO selection */
  selectedUtxoIds?: string[];
  /** Enable RBF */
  rbfEnabled?: boolean;
  /** Custom change address */
  changeAddress?: string;
}

// ============================================
// BACKUP TYPES
// ============================================

/**
 * Universal backup payload that supports all wallet types.
 * Version 2 of the backup format with canonical wallet support.
 */
export interface UniversalBackupPayload {
  /** Backup format version */
  version: 2;
  /** Canonical wallet type */
  canonicalType: CanonicalWalletType;

  // ── Type-specific secret data ──
  mnemonic?: string;
  passphrase?: string;
  xprv?: string;
  seedHex?: string;
  wifKeys?: Array<{
    wif: string;
    compressed: boolean;
    label?: string;
  }>;

  // ── Watch-only data ──
  xpubs?: Record<string, string>;
  descriptor?: string;
  watchAddresses?: string[];

  // ── Derivation config ──
  derivationConfig?: DerivationConfig;

  // ── Multisig ──
  multisigConfig?: MultisigConfig;
  cosignerSeeds?: Array<{
    index: number;
    mnemonic: string;
    name: string;
  }>;

  // ── Metadata ──
  name: string;
  fingerprint?: string;
  createdAt: number;
  backupDate: number;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the recommended backup method for a wallet type.
 */
export function getRecommendedBackupMethod(
  type: CanonicalWalletType
): 'phrase' | 'encrypted_file' | 'descriptor' | 'none' {
  switch (type) {
    case 'hd_mnemonic':
    case 'hd_electrum':
      return 'phrase';
    case 'hd_xprv':
    case 'hd_seed':
    case 'imported_key':
    case 'imported_keys':
    case 'multisig':
      return 'encrypted_file';
    case 'hd_descriptor':
    case 'watch_descriptor':
      return 'descriptor';
    case 'watch_xpub':
    case 'watch_addresses':
      return 'none';
    default:
      return 'encrypted_file';
  }
}

/**
 * Check if a wallet type can export a seed phrase.
 */
export function canExportPhrase(type: CanonicalWalletType): boolean {
  return type === 'hd_mnemonic' || type === 'hd_electrum' || type === 'multisig';
}

/**
 * Get capabilities for a wallet type.
 */
export function getCapabilities(type: CanonicalWalletType): CapabilityFlags {
  return WALLET_TYPE_CAPABILITIES[type];
}

/**
 * Create an empty address cache structure.
 */
export function createEmptyAddressCache(): CanonicalWalletRecord['addressCache'] {
  return {
    receiving: [],
    change: [],
    lastDerivedReceiving: -1,
    lastDerivedChange: -1,
  };
}

/**
 * Create an empty balance structure.
 */
export function createEmptyBalance(): BalanceInfo {
  return {
    confirmed: 0,
    unconfirmed: 0,
    total: 0,
  };
}

/**
 * Create initial sync state.
 */
export function createInitialSyncState(): CanonicalWalletRecord['sync'] {
  return {
    status: 'idle',
    lastSyncedAt: null,
  };
}
