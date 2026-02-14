import type { AddressType, WalletType, MultisigScriptType } from '../constants';

// Re-export from constants
export type { AddressType, WalletType, MultisigScriptType } from '../constants';

// Re-export canonical wallet types
export type {
  CanonicalWalletType,
  CanonicalScriptType,
  CapabilityFlags,
  CanonicalWalletRecord,
  SecretType,
  SecretMetadata,
  ImportPayload,
  WifKeyEntry,
  CosignerSeed,
  DerivationConfig,
  SyncRequest,
  SyncResult,
  CreatePsbtParams,
  UniversalBackupPayload,
} from './canonical';

export {
  WALLET_TYPE_CAPABILITIES,
  getRecommendedBackupMethod,
  canExportPhrase,
  getCapabilities,
  createEmptyAddressCache,
  createEmptyBalance,
  createInitialSyncState,
} from './canonical';

// ── Theme Types ──────────────────────────────────────────────────
/** The three visual themes: Light, Dim (dark blue-gray), Midnight (OLED black) */
export type ThemeMode = 'light' | 'dim' | 'midnight';

/** What the user stores in settings — the 3 modes + "system" auto-switch */
export type ThemePreference = ThemeMode | 'system';

// Re-export contact types
export type {
  Contact,
  ContactAddress,
  ContactStats,
  MonthlyActivity,
  PaymentLinkPayload,
  PaymentLinkRecipient,
  SendPrefillData,
} from './contacts';

// ============================================
// ACCOUNT & WALLET TYPES
// ============================================

// Legacy wallet metadata (kept for backward compatibility)
export interface WalletMetadata {
  id: string;
  name: string;
  createdAt: number;
  network: 'mainnet' | 'testnet';
  addressCount: number;
  preferredAddressType?: AddressType;
}

// New Account structure (replaces single wallet concept)
export interface Account {
  id: number;                           // Account index (unique identifier)
  name: string;                         // User-defined name (e.g., "Savings", "Spending")
  type: WalletType;                     // hd, watch_only_xpub, etc.
  network: 'mainnet' | 'testnet';
  createdAt: number;
  preferredAddressType: AddressType;
  // Address tracking
  addressIndices: AccountAddressIndices;
  // Derived data (not persisted, computed on unlock)
  addresses?: AddressInfo[];
  balance?: BalanceInfo;
  // Watch-only specific
  xpubs?: Partial<Record<AddressType, string>>;
  descriptor?: string;
  watchAddresses?: string[];            // For address-only watch
  // Multisig specific
  multisigConfig?: MultisigConfig;
  // BIP39 passphrase (if using 25th word)
  hasPassphrase?: boolean;
}

// Per-account address indices tracking
export interface AccountAddressIndices {
  native_segwit: { receiving: number; change: number };
  wrapped_segwit: { receiving: number; change: number };
  legacy: { receiving: number; change: number };
  taproot: { receiving: number; change: number };
}

// ============================================
// MULTISIG TYPES
// ============================================

export interface MultisigConfig {
  m: number;                            // Required signatures (e.g., 2 in 2-of-3)
  n: number;                            // Total signers (e.g., 3 in 2-of-3)
  scriptType: MultisigScriptType;
  cosigners: CosignerInfo[];
  derivationPath: string;               // e.g., "m/48'/0'/0'/2'"
  sortedKeys: boolean;                  // Whether to use sortedmulti
}

export interface CosignerInfo {
  id: string;                           // Unique identifier
  name: string;                         // Display name
  fingerprint: string;                  // Master fingerprint (8 hex chars)
  xpub: string;                         // Extended public key
  derivationPath: string;               // Derivation path used
  isLocal: boolean;                     // Whether we have the private key
  lastSeen?: number;                    // Last health check timestamp
  status?: 'online' | 'offline' | 'unknown';
}

// ============================================
// PSBT TYPES
// ============================================

export interface PSBTData {
  id: string;                           // Unique identifier
  base64: string;                       // PSBT in base64 format
  hex?: string;                         // PSBT in hex format
  inputs: PSBTInput[];
  outputs: PSBTOutput[];
  fee: number;                          // Total fee in satoshis
  feeRate: number;                      // Fee rate in sat/vB
  size: number;                         // Virtual size in vBytes
  isComplete: boolean;                  // All inputs signed?
  missingSignatures: number;            // How many more signatures needed
  createdAt: number;
  note?: string;
}

export interface PSBTInput {
  index: number;
  txid: string;
  vout: number;
  value: number;                        // Input value in satoshis
  address: string;
  scriptType: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' | 'p2wsh' | 'p2sh';
  derivationPath?: string;
  signed: boolean;
  signerFingerprints: string[];         // Fingerprints of signers who signed
  canSign: boolean;                     // Whether we can sign this input
}

export interface PSBTOutput {
  index: number;
  address: string;
  value: number;                        // Output value in satoshis
  isChange: boolean;
  derivationPath?: string;              // If change, the derivation path
}

export interface PSBTAnalysis {
  inputs: PSBTInput[];
  outputs: PSBTOutput[];
  fee: number;
  feeRate: number;
  requiredSignatures: number;
  presentSignatures: number;
  isComplete: boolean;
  canFinalize: boolean;
  warnings: string[];                   // Any issues detected
}

// ============================================
// BACKUP TYPES
// ============================================

export interface WalletBackup {
  version: number;                      // Backup format version
  createdAt: number;
  exportedAt: number;
  appVersion: string;
  accounts: AccountBackup[];
  settings: Partial<AppSettings>;
  addressBook?: AddressBookEntry[];
  utxoNotes?: Record<string, string>;   // UTXO notes by id
  transactionNotes?: Record<string, string>; // Tx notes by txid
  // Checksum for integrity verification
  checksum: string;
}

export interface AccountBackup {
  id: number;
  name: string;
  type: WalletType;
  network: 'mainnet' | 'testnet';
  createdAt: number;
  preferredAddressType: AddressType;
  // Descriptor (always included for all wallet types)
  descriptor: string;
  fingerprint: string;
  derivationPaths: Partial<Record<AddressType, string>>;
  // Encrypted seed (only for full HD wallets)
  encryptedSeed?: string;
  encryptedPassphrase?: string;         // If BIP39 passphrase used
  // Watch-only data
  xpubs?: Partial<Record<AddressType, string>>;
  watchAddresses?: string[];
  // Multisig data
  multisigConfig?: MultisigConfig;
}

export interface AddressBookEntry {
  id: string;
  address: string;
  label: string;
  note?: string;
  createdAt: number;
  lastUsed?: number;
}

// ============================================
// DESCRIPTOR TYPES
// ============================================

export interface DescriptorInfo {
  raw: string;                          // Full descriptor string
  type: 'pkh' | 'wpkh' | 'sh' | 'wsh' | 'tr' | 'multi' | 'sortedmulti';
  scriptType: 'p2pkh' | 'p2wpkh' | 'p2sh-p2wpkh' | 'p2tr' | 'p2sh' | 'p2wsh' | 'p2sh-p2wsh';
  isRange: boolean;                     // Contains /* wildcard
  isMultisig: boolean;
  threshold?: number;                   // For multisig: m in m-of-n
  totalKeys?: number;                   // For multisig: n in m-of-n
  keys: DescriptorKey[];
  checksum?: string;
  isValid: boolean;
}

export interface DescriptorKey {
  fingerprint?: string;                 // Master fingerprint if present
  derivationPath?: string;              // Origin path if present
  key: string;                          // The actual key (xpub, pubkey, etc.)
  isXpub: boolean;
  isWildcard: boolean;                  // Ends with /* or /<0;1>/*
}

// ============================================
// FEE BUMPING TYPES
// ============================================

export interface RBFTransaction {
  originalTxid: string;
  originalFee: number;
  originalFeeRate: number;
  newFeeRate: number;
  newFee: number;
  additionalFee: number;
  canBump: boolean;
  reason?: string;                      // Why it can't be bumped if canBump is false
}

export interface CPFPTransaction {
  parentTxid: string;
  parentFee: number;
  parentFeeRate: number;
  parentVsize: number;
  childFeeRate: number;                 // Effective fee rate for package
  childFee: number;
  outputIndex: number;                  // Which output of parent to spend
  outputValue: number;
  effectivePackageFeeRate: number;
}

export interface AddressInfo {
  address: string;
  path: string;
  index: number;
  isChange: boolean;
  type: AddressType;
  label?: string;
  balance?: number;
}

export interface BalanceInfo {
  confirmed: number; // in satoshis
  unconfirmed: number; // in satoshis
  total: number; // in satoshis
}

// Transaction Types
export interface UTXO {
  txid: string;
  vout: number;
  value: number; // in satoshis
  address: string;
  scriptPubKey: string;
  confirmations: number;
  /** Raw transaction hex — required for signing Legacy (P2PKH) inputs via nonWitnessUtxo */
  rawTxHex?: string;
}

// Extended UTXO with management features
export interface ManagedUTXO extends UTXO {
  id: string; // Unique identifier: txid:vout
  note?: string;
  tags?: string[];
  isFrozen: boolean;
  isLocked: boolean;
  createdAt?: number; // When the UTXO was first seen
}

// Pending Transaction (not yet broadcast)
export interface PendingTransaction {
  id: string;
  rawHex: string;
  recipients: TransactionRecipient[];
  totalAmount: number;
  fee: number;
  feeRate: number;
  createdAt: number;
  note?: string;
  rbfEnabled: boolean;
  selectedUtxos?: string[]; // UTXO ids used
}

// Transaction Recipient for multi-output transactions
export interface TransactionRecipient {
  address: string;
  amount: number; // in satoshis
  label?: string;
}

// Transaction Build Options
export interface TransactionBuildOptions {
  recipients: TransactionRecipient[];
  feeRate: number;
  rbfEnabled: boolean;
  selectedUtxoIds?: string[]; // Manual UTXO selection
  excludeUtxoIds?: string[]; // UTXOs to exclude
  changeAddress?: string;
  broadcast: boolean; // Whether to broadcast immediately
}

export interface TransactionInfo {
  txid: string;
  type: 'incoming' | 'outgoing' | 'self-transfer';
  amount: number; // in satoshis (positive for incoming, negative for outgoing)
  fee?: number;
  confirmations: number;
  timestamp: number;
  address: string; // receiving or sending address
  status: 'pending' | 'confirmed' | 'failed';
}

// Detailed Transaction Types (from Activity API)
export interface TransactionInput {
  index: number;
  prevTxid: string;
  prevVout: number;
  address: string;
  value: number; // in satoshis
}

export interface TransactionOutput {
  index: number;
  address: string | null;
  value: number; // in satoshis
}

export interface DetailedTransactionInfo {
  txid: string;
  height: number;
  confirmed: boolean;
  blockTime: number; // Block timestamp for confirmed, or firstSeen time for pending
  confirmations: number;
  fee: number;
  feeRate: number;
  isRBF: boolean;
  rawHex: string;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  size: number;
  vsize: number;
  balanceDiff: number; // positive for received, negative for sent
  isLastTransaction: boolean;
  // Computed fields
  type: 'incoming' | 'outgoing' | 'self-transfer';
  status: 'pending' | 'confirmed';
  // Discovery time - when we first saw this transaction (for pending tx display)
  firstSeen?: number;
}

export interface ActivityAPIResponse {
  status: string;
  message: string;
  timestamp: string;
  transactionsCount: number;
  scanDurationMs: number;
  topTipHeight: number;
  rpcCallsEstimated: number;
  result: {
    addresses: string[];
    transactions: ActivityAPITransaction[];
  };
}

export interface ActivityAPITransaction {
  txid: string;
  height: number;
  confirmed: boolean;
  blockTime: number;
  confirmations: number;
  fee: number;
  feeRate: number;
  isRBF: boolean;
  rawHex: string;
  inputs: {
    index: number;
    prevTxid: string;
    prevVout: number;
    address: string;
    value: number;
  }[];
  outputs: {
    index: number;
    address: string | null;
    value: number;
  }[];
  size: number;
  vsize: number;
  balance_diff: number;
  isLastTransaction: boolean;
}

export interface PreparedTransaction {
  hex: string;
  fee: number;
  inputTotal: number;
  outputTotal: number;
  changeAmount: number;
}

export interface FeeRecommendation {
  fastest: number; // sat/vB
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}

// API Types
export interface MempoolAddressData {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export interface MempoolUTXO {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
  value: number;
}

export interface MempoolTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_address: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

// Price Types
export interface PriceData {
  price: number;
  currency: string;
  change24h?: number;
  lastUpdated?: number;
}

// Fee Preference Types
export type FeePreference = 'fast' | 'medium' | 'slow' | 'custom';

// Wallet Mode Types (legacy - kept for backward compatibility)
export type WalletMode = 'hd' | 'simple';

// ============================================
// WALLET HEALTH TYPES
// ============================================

export interface WalletHealth {
  isConnected: boolean;
  lastSyncTime: number | null;
  blockHeight: number | null;
  peerCount?: number;
  networkLatency?: number;              // ms
  serverUrl?: string;
  errors: HealthError[];
}

export interface HealthError {
  code: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
}

// ============================================
// TRANSACTION LABEL/NOTE TYPES
// ============================================

export interface TransactionLabel {
  txid: string;
  label: string;
  note?: string;
  tags?: string[];                      // e.g., ['income', 'kyc', 'exchange']
  createdAt: number;
  updatedAt: number;
}

// ============================================
// UTXO TAG TYPES
// ============================================

export interface UTXOTag {
  id: string;                           // txid:vout
  tags: string[];                       // e.g., ['kyc', 'non-kyc', 'savings', 'dust']
  privacyScore?: number;                // 0-100, higher is better
  clusterWarning?: string;              // Warning about address clustering
}

// Bitcoin denomination units
export type BitcoinUnit = 'btc' | 'mbtc' | 'ubtc' | 'sat' | 'cbtc' | 'dbtc';

// Default Currency Display Type
export type DefaultCurrencyDisplay = BitcoinUnit | 'fiat';

// Custom Electrum Server
export interface CustomElectrumServer {
  host: string;
  port: number;
  ssl: boolean;
  enabled: boolean;
}

// Settings Types
export interface AppSettings {
  network: 'mainnet' | 'testnet';
  denomination: BitcoinUnit;
  currency: string;
  autoLockTimeout: number; // in milliseconds
  biometricsEnabled: boolean;
  hapticsEnabled: boolean;
  theme: ThemePreference;
  // New settings
  feePreference: FeePreference;
  customFeeRate: number; // sat/vB for custom fee
  customElectrumServer: CustomElectrumServer | null;
  useCustomElectrum: boolean;
  defaultCurrencyDisplay: DefaultCurrencyDisplay;
  gapLimit: number;
  walletMode: WalletMode;
}

// Security Types
export interface AuthState {
  isInitialized: boolean;
  isLocked: boolean;
  hasPin: boolean;
  hasBiometrics: boolean;
  lastActivity: number;
}
