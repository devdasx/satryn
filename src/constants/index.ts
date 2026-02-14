// Bitcoin Network Constants
export const BITCOIN_NETWORKS = {
  mainnet: {
    name: 'Bitcoin Mainnet',
    bech32: 'bc',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
    coinType: 0, // BIP44 coin type
    explorerUrl: 'https://mempool.space',
    apiUrl: 'https://mempool.space/api',
  },
  testnet: {
    name: 'Bitcoin Testnet',
    bech32: 'tb',
    bip32: {
      public: 0x043587cf,
      private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
    coinType: 1, // BIP44 coin type for testnet
    explorerUrl: 'https://mempool.space/testnet',
    apiUrl: 'https://mempool.space/testnet/api',
  },
} as const;

// Address Type Constants
export const ADDRESS_TYPES = {
  NATIVE_SEGWIT: 'native_segwit',    // BIP84 - bc1q... (P2WPKH)
  WRAPPED_SEGWIT: 'wrapped_segwit',  // BIP49 - 3... (P2SH-P2WPKH)
  LEGACY: 'legacy',                   // BIP44 - 1... (P2PKH)
  TAPROOT: 'taproot',                 // BIP86 - bc1p... (P2TR)
} as const;

export type AddressType = typeof ADDRESS_TYPES[keyof typeof ADDRESS_TYPES];

// Wallet Type Constants (for different wallet configurations)
export const WALLET_TYPES = {
  HD: 'hd',                                   // Full HD wallet with seed
  WATCH_ONLY_XPUB: 'watch_only_xpub',        // Watch-only from xpub
  WATCH_ONLY_DESCRIPTOR: 'watch_only_descriptor', // Watch-only from descriptor
  WATCH_ONLY_ADDRESS: 'watch_only_address',  // Watch-only single/multiple addresses
  MULTISIG: 'multisig',                      // Multisig wallet
} as const;

export type WalletType = typeof WALLET_TYPES[keyof typeof WALLET_TYPES];

// Multisig Script Types
export const MULTISIG_SCRIPT_TYPES = {
  P2SH: 'p2sh',           // Legacy multisig
  P2WSH: 'p2wsh',         // Native SegWit multisig
  P2SH_P2WSH: 'p2sh-p2wsh', // Wrapped SegWit multisig
} as const;

export type MultisigScriptType = typeof MULTISIG_SCRIPT_TYPES[keyof typeof MULTISIG_SCRIPT_TYPES];

// BIP Derivation Path Constants
export const BIP_PURPOSES = {
  BIP84: 84,  // Native SegWit (P2WPKH)
  BIP49: 49,  // Wrapped SegWit (P2SH-P2WPKH)
  BIP44: 44,  // Legacy (P2PKH)
  BIP86: 86,  // Taproot (P2TR)
  BIP48: 48,  // Multisig
} as const;

// Derivation Path Constants
export const DERIVATION = {
  EXTERNAL_CHAIN: 0, // Receiving addresses
  INTERNAL_CHAIN: 1, // Change addresses
  DEFAULT_ACCOUNT: 0,
  GAP_LIMIT: 20, // Standard gap limit for address discovery
  GAP_LIMIT_OPTIONS: [
    { label: '20 (Default)', value: 20 },
    { label: '50', value: 50 },
    { label: '100', value: 100 },
    { label: '200 (Maximum)', value: 200 },
  ],
  MAX_GAP_LIMIT: 200,
} as const;

// Fee Preference Constants
export const FEE_PREFERENCES = {
  FAST: 'fast',
  MEDIUM: 'medium',
  SLOW: 'slow',
  CUSTOM: 'custom',
} as const;

export const FEE_PREFERENCE_LABELS = {
  fast: { label: 'Fast', description: '~10 min', icon: 'flash' },
  medium: { label: 'Medium', description: '~30 min', icon: 'time' },
  slow: { label: 'Economy', description: '~1 hour', icon: 'leaf' },
  custom: { label: 'Custom', description: 'Set manually', icon: 'settings' },
} as const;

// Wallet Mode Constants
export const WALLET_MODES = {
  HD: 'hd',
  SIMPLE: 'simple',
} as const;

export const WALLET_MODE_LABELS = {
  hd: { label: 'HD Wallet', description: 'New address for each transaction (recommended)' },
  simple: { label: 'Simple Wallet', description: 'Reuse same address' },
} as const;

// Default Currency Display
export const DEFAULT_CURRENCY_DISPLAY_OPTIONS = {
  btc: { label: 'BTC', description: '0.00000001 BTC' },
  mbtc: { label: 'mBTC', description: '0.001 BTC' },
  ubtc: { label: 'Bits', description: '100 sats' },
  sat: { label: 'Satoshis', description: '1 sat' },
  cbtc: { label: 'cBTC', description: '0.01 BTC' },
  dbtc: { label: 'dBTC', description: '0.1 BTC' },
  fiat: { label: 'Local Currency', description: 'USD, EUR, etc.' },
} as const;

// Security Constants
export const SECURITY = {
  PIN_LENGTH: 6, // Default — kept for backward compatibility
  PIN_MIN_LENGTH: 4,
  PIN_MAX_LENGTH: 32,
  PIN_POLICIES: ['fixed4', 'fixed6', 'variable'] as const,
  MAX_PIN_ATTEMPTS: 5,
  LOCKOUT_DURATIONS: [30, 60, 300, 1800, 3600] as const, // seconds: 30s, 1m, 5m, 30m, 1h
  AUTO_LOCK_OPTIONS: [
    { label: 'Immediately', value: 0 },
    { label: '1 minute', value: 60000 },
    { label: '5 minutes', value: 300000 },
    { label: '15 minutes', value: 900000 },
    { label: '1 hour', value: 3600000 },
    { label: 'Never', value: -1 },
  ],
  DEFAULT_AUTO_LOCK: 60000, // 1 minute
} as const;

export type PinPolicy = typeof SECURITY.PIN_POLICIES[number];

// Transaction Constants
export const TRANSACTION = {
  DUST_THRESHOLD: 546, // satoshis
  DUST_THRESHOLD_TAPROOT: 330, // Lower dust threshold for Taproot (bc1p) outputs
  MAX_FEE_RATE: 1000, // sat/vB - safety limit
  MIN_FEE_RATE: 1, // sat/vB
  // P2WPKH (Native SegWit bc1q) - default for backward compatibility
  VBYTES_PER_INPUT: 68, // P2WPKH input
  VBYTES_PER_OUTPUT: 31, // P2WPKH output
  VBYTES_OVERHEAD: 10.5,
  // Per-type input sizes (vBytes)
  INPUT_VBYTES: {
    P2TR: 57.5,      // Taproot: ~57.5 vBytes (key-path spend with Schnorr signature)
    P2WPKH: 68,      // Native SegWit: ~68 vBytes
    P2SH_P2WPKH: 91, // Wrapped SegWit: ~91 vBytes
    P2PKH: 148,      // Legacy: ~148 vBytes
  },
  // Per-type output sizes (vBytes)
  OUTPUT_VBYTES: {
    P2TR: 43,        // Taproot: 43 vBytes
    P2WPKH: 31,      // Native SegWit: 31 vBytes
    P2SH: 32,        // Wrapped SegWit: 32 vBytes
    P2PKH: 34,       // Legacy: 34 vBytes
  },
} as const;

// UI Theme Colors
export const COLORS = {
  light: {
    primary: '#F7931A', // Bitcoin orange
    primaryDark: '#E87F0E',
    background: '#FFFFFF',
    surface: '#F5F5F5',
    text: '#1A1A1A',
    textSecondary: '#666666',
    border: '#E0E0E0',
    success: '#4CAF50',
    error: '#F44336',
    warning: '#FF9800',
  },
  dark: {
    primary: '#F7931A',
    primaryDark: '#E87F0E',
    background: '#0D0D0F',
    surface: '#1A1A1E',
    text: '#F5F5F7',
    textSecondary: '#A0A0A8',
    border: '#2C2C34',
    success: '#66BB6A',
    error: '#EF5350',
    warning: '#FFA726',
  },
} as const;

// Formatting Constants
export const FORMATTING = {
  BTC_DECIMALS: 8,
  SATS_PER_BTC: 100000000,
  DEFAULT_CURRENCY: 'USD',
  SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'JPY', 'CNY'],
} as const;

// Bitcoin Unit definitions — multiplier converts BTC to the unit value
export const BITCOIN_UNITS = {
  btc:  { label: 'Bitcoin',       symbol: 'BTC',  satsPerUnit: 100_000_000, decimals: 8 },
  mbtc: { label: 'Millibitcoin',  symbol: 'mBTC', satsPerUnit: 100_000,     decimals: 5 },
  ubtc: { label: 'Bits',          symbol: 'bits', satsPerUnit: 100,         decimals: 2 },
  sat:  { label: 'Satoshi',       symbol: 'SAT',  satsPerUnit: 1,           decimals: 0 },
  cbtc: { label: 'Centibitcoin',  symbol: 'cBTC', satsPerUnit: 1_000_000,   decimals: 6 },
  dbtc: { label: 'Decibitcoin',   symbol: 'dBTC', satsPerUnit: 10_000_000,  decimals: 7 },
} as const;

// API Endpoints
export const API = {
  MEMPOOL_MAINNET: 'https://mempool.space/api',
  MEMPOOL_TESTNET: 'https://mempool.space/testnet/api',
  COINGECKO: 'https://api.coingecko.com/api/v3',
  BLOCKSTREAM_MAINNET: 'https://blockstream.info/api',
  BLOCKSTREAM_TESTNET: 'https://blockstream.info/testnet/api',
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  // Legacy single-wallet keys (kept for backward compatibility)
  ENCRYPTED_SEED: 'encrypted_seed',
  ENCRYPTED_PASSPHRASE: 'encrypted_passphrase',
  ENCRYPTION_SALT: 'encryption_salt',
  PIN_HASH: 'pin_hash',
  WALLET_METADATA: 'wallet_metadata',
  SETTINGS: 'settings',
  ADDRESS_BOOK: 'address_book',
  LAST_ACTIVITY: 'last_activity',
  BIOMETRIC_PIN: 'biometric_pin',
  PIN_POLICY: 'pin_policy',
  PIN_FAILED_ATTEMPTS: 'pin_failed_attempts',
  PIN_LOCKOUT_UNTIL: 'pin_lockout_until',
  // Multi-account keys (use with account ID suffix)
  ACCOUNT_SEED_PREFIX: 'account_seed_',           // + accountId
  ACCOUNT_SALT_PREFIX: 'account_salt_',           // + accountId
  ACCOUNT_METADATA_PREFIX: 'account_metadata_',   // + accountId
  ACCOUNT_PASSPHRASE_PREFIX: 'account_passphrase_', // + accountId (encrypted)
  // Multisig keys
  MULTISIG_CONFIG_PREFIX: 'multisig_config_',     // + accountId
  MULTISIG_DESCRIPTOR: 'multisig_descriptor',     // Primary multisig descriptor
  MULTISIG_DESCRIPTOR_PREFIX: 'multisig_descriptor_', // + accountId
  // Local cosigner seed storage (for multisig wallets with locally-generated keys)
  LOCAL_COSIGNER_SEED_PREFIX: 'local_cosigner_seed_', // + cosignerIndex
  LOCAL_COSIGNER_SALT_PREFIX: 'local_cosigner_salt_', // + cosignerIndex
  // Watch-only keys
  WATCH_XPUBS_PREFIX: 'watch_xpubs_',             // + accountId
  WATCH_DESCRIPTOR_PREFIX: 'watch_descriptor_',   // + accountId
  WATCH_ADDRESSES_PREFIX: 'watch_addresses_',     // + accountId
  // Backup keys
  BACKUP_METADATA: 'backup_metadata',
  ICLOUD_BACKUP_KEY: 'icloud_backup',
  ICLOUD_BACKUP_PREFIX: 'backup_',
  // Account management
  ACCOUNTS_LIST: 'accounts_list',                 // List of all account IDs
  CURRENT_ACCOUNT: 'current_account',             // Currently selected account
  // Encryption version tracking (per-key migration from XOR to AES-GCM)
  ENCRYPTION_VERSION_PREFIX: 'enc_ver_',          // + storage key → "1" (XOR) or "2" (AES-GCM)
  // Device identity (used to tag iCloud backups as device-specific)
  DEVICE_ID: 'device_id',
} as const;

// Encryption versions
export const ENCRYPTION_VERSION = {
  LEGACY_XOR: '1',
  AES_GCM: '2',
} as const;

// Export premium theme
export { THEME, getThemeColors, typography, spacing, radius, shadows, animation } from './theme';
export type { ThemeColors } from './theme';

// Export component color map (single source of truth)
export { getColors } from './colors';
export type { AppColors } from './colors';
