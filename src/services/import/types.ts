/**
 * Universal Import Types
 *
 * Type definitions for the multi-format wallet import system.
 * Supports 25+ import formats across mnemonics, private keys,
 * extended keys, descriptors, wallet files, and UR codes.
 *
 * MAINNET ONLY — all testnet formats are rejected at detection time.
 */

// ============================================
// Import Format Detection
// ============================================

/** All supported import formats */
export type ImportFormat =
  // Phrase-based
  | 'bip39_mnemonic'
  | 'electrum_seed'
  | 'slip39_share'
  | 'brainwallet'
  // Raw seed
  | 'seed_bytes_hex'
  | 'seed_bytes_binary'
  // Single private keys
  | 'wif_compressed'
  | 'wif_uncompressed'
  | 'hex_privkey'
  | 'decimal_privkey'
  | 'base64_privkey'
  | 'mini_privkey'
  | 'bip38_encrypted'
  | 'sec1_pem'
  | 'pkcs8_pem'
  | 'pkcs8_encrypted'
  | 'raw_binary_32'
  // Extended private keys
  | 'xprv'
  | 'yprv'
  | 'zprv'
  | 'Yprv'
  | 'Zprv'
  // Extended public keys (watch-only)
  | 'xpub'
  | 'ypub'
  | 'zpub'
  | 'Ypub'
  | 'Zpub'
  // Descriptors & wallet files
  | 'descriptor_set'
  | 'dumpwallet'
  | 'wallet_dat'
  | 'electrum_json'
  // UR / Blockchain Commons
  | 'ur_crypto_hdkey'
  | 'ur_crypto_eckey'
  | 'ur_crypto_seed';

/** Result of format auto-detection */
export interface DetectionResult {
  /** Detected format */
  format: ImportFormat;
  /** How confident the detection is */
  confidence: 'definite' | 'likely' | 'possible';
  /** Human-readable label (NEVER contains raw key material) */
  label: string;
  /** Whether a password/passphrase is needed to decrypt */
  needsPassword?: boolean;
  /** Whether this is a mainnet format (false = reject) */
  isMainnet: boolean;
  /** Word count for mnemonic formats */
  wordCount?: number;
  /** For formats that could be multiple things (e.g., 64-char hex) */
  alternatives?: ImportFormat[];
  /** Whether this is a watch-only format (xpub, etc.) */
  isWatchOnly?: boolean;
}

// ============================================
// Import Results
// ============================================

/** Type of wallet that will be created from the import */
export type ImportResultType = 'hd' | 'single_key' | 'key_set' | 'watch_only' | 'watch_xpub';

/** Suggested script/address type for the imported wallet */
export type SuggestedScriptType =
  | 'native_segwit'    // bc1q... (BIP84)
  | 'wrapped_segwit'   // 3...    (BIP49)
  | 'legacy'           // 1...    (BIP44)
  | 'taproot';         // bc1p... (BIP86)

/** Result of parsing and validating an import */
export interface ImportResult {
  /** What type of wallet this creates */
  type: ImportResultType;
  /** Source format that was detected */
  sourceFormat: ImportFormat;

  // HD wallet material (mnemonic/seed/xprv)
  mnemonic?: string;
  passphrase?: string;
  seed?: Uint8Array;
  xprv?: string;

  // Watch-only material
  xpub?: string;

  // Single private key material
  privateKeyWIF?: string;
  privateKeyBuffer?: Uint8Array;
  compressed?: boolean;

  // Multiple keys (dumpwallet, imported keys)
  keys?: ImportedKey[];

  // Descriptor material
  descriptors?: ParsedDescriptor[];

  // Suggestions for wallet creation
  suggestedScriptType?: SuggestedScriptType;
  suggestedName?: string;
  suggestedAccountIndex?: number;

  // Derivation path configuration (for HD imports)
  derivationPathConfig?: DerivationPathConfig;

  // Safe preview data (no key material)
  previewAddress?: string;
  fingerprint?: string;
}

/** A single imported key with optional metadata */
export interface ImportedKey {
  wif: string;
  compressed: boolean;
  label?: string;
  timestamp?: number;
  address?: string;
  hdKeypath?: string;
  isChange?: boolean;
}

/** Parsed descriptor with extracted key material */
export interface ParsedDescriptor {
  raw: string;
  scriptType: 'wpkh' | 'sh(wpkh)' | 'pkh' | 'tr';
  hasPrivateKey: boolean;
  xprv?: string;
  fingerprint?: string;
  derivationPath?: string;
  isInternal: boolean;
}

// ============================================
// Import Errors
// ============================================

/** Error codes for import failures */
export type ImportErrorCode =
  | 'INVALID_FORMAT'
  | 'TESTNET_REJECTED'
  | 'INVALID_CHECKSUM'
  | 'INVALID_WORD'
  | 'INVALID_WORD_COUNT'
  | 'INVALID_KEY_ON_CURVE'
  | 'WRONG_PASSWORD'
  | 'ENCRYPTED_UNSUPPORTED'
  | 'FILE_TOO_LARGE'
  | 'FILE_PARSE_ERROR'
  | 'NO_PRIVATE_KEYS'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN';

/** Import error (never contains raw key material in message) */
export class ImportError extends Error {
  code: ImportErrorCode;

  constructor(code: ImportErrorCode, safeMessage: string) {
    super(safeMessage);
    this.code = code;
    this.name = 'ImportError';
  }
}

// ============================================
// Import Section Types (UI)
// ============================================

/** Active section in the import screen */
export type ImportSection =
  | 'phrase'
  | 'key'
  | 'extended'
  | 'seed'
  | 'file'
  | 'scan';

/** Configuration for wallet creation after import */
export interface WalletImportConfig {
  name: string;
  scriptType: SuggestedScriptType;
  accountIndex: number;
  gapLimit: number;
}

// ============================================
// Derivation Path Configuration
// ============================================

/** Available derivation path presets */
export type DerivationPathPreset = 'hd' | 'bip32' | 'bip44' | 'bip49' | 'bip84' | 'bip86' | 'custom';

/** Full derivation path configuration for HD imports */
export interface DerivationPathConfig {
  /** Selected preset (BIP standard or custom) */
  preset: DerivationPathPreset;
  /** Account index (default 0) */
  accountIndex: number;
  /** Address index for preview (default 0) */
  addressIndex: number;
  /** Custom derivation path (only used when preset === 'custom'), e.g. "m/84'/0'/5'/0/0" */
  customPath?: string;
}

// ============================================
// Path Discovery (Auto-scanning for balances)
// ============================================

/** Status of a path scan during discovery */
export type PathScanStatus = 'pending' | 'scanning' | 'complete' | 'error';

/** Result of scanning a single derivation path for activity */
export interface PathDiscoveryResult {
  /** Which BIP path was scanned */
  path: 'bip44' | 'bip49' | 'bip84' | 'bip86';
  /** Human-readable label (e.g., "Legacy (BIP44)") */
  label: string;
  /** Example address prefix (e.g., "1...", "3...", "bc1q...", "bc1p...") */
  addressPrefix: string;
  /** Current scan status */
  status: PathScanStatus;
  /** Balance found in satoshis */
  balanceSats: number;
  /** Number of addresses with transaction history */
  usedAddressCount: number;
  /** First address that has activity (for display) */
  firstUsedAddress?: string;
  /** First derived address (always available once scanning starts) */
  firstAddress: string;
  /** Error message if status === 'error' */
  error?: string;
}

/** Aggregate result of scanning all paths */
export interface PathDiscoveryAggregateResult {
  /** Results for each path */
  paths: PathDiscoveryResult[];
  /** Whether any path has balance or history */
  hasActivity: boolean;
  /** Total balance across all paths in satoshis */
  totalBalanceSats: number;
  /** Whether all paths have finished scanning */
  isComplete: boolean;
}
