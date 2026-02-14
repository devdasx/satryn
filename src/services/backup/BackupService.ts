/**
 * BackupService — AES-256-GCM Encrypted Backup for iCloud
 *
 * Encrypts wallet data with a user-chosen password using:
 * - SHA-256 key derivation (instant — password + salt hashed to 32-byte key)
 * - AES-256-GCM authenticated encryption (12-byte IV, 16-byte auth tag)
 *
 * The encrypted blob contains unencrypted metadata (wallet name, type, dates)
 * plus an encrypted payload with seeds, passphrases, and wallet configuration.
 *
 * Legacy PBKDF2 fallback is retained for decrypting old v2 backups only.
 * Uses node-forge for crypto operations (pure JS, no native polyfill needed).
 */

// node-forge has no bundled TypeScript types — use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const forge = require('node-forge');
import { SecureStorage } from '../storage/SecureStorage';
import { SecureVault } from '../vault/SecureVault';
import { CanonicalSnapshotBuilder } from '../storage/CanonicalSnapshotBuilder';
import { useMultiWalletStore, type WalletType } from '../../stores/multiWalletStore';
import { useContactStore } from '../../stores/contactStore';
import type { Contact } from '../../types/contacts';

// ============================================
// TYPES
// ============================================

/** Unencrypted metadata stored alongside the encrypted payload */
export interface BackupMetadata {
  walletName: string;
  walletType: WalletType;
  createdAt: number;
  backupDate: number;
}

/** Full encrypted backup blob stored in iCloud */
export interface EncryptedBackupBlob {
  version: number;
  type: 'wallet_backup';
  walletName: string;
  walletType: WalletType;
  createdAt: number;
  backupDate: number;
  salt: string;           // hex, 32 bytes
  iv: string;             // hex, 12 bytes
  encryptedData: string;  // hex, AES-256-GCM ciphertext
  authTag: string;        // hex, 16 bytes
  deviceId?: string;      // device that created this backup
}

/** Full backup containing all wallets */
export interface FullBackupPayload {
  type: 'full_backup';
  version?: number;
  backupName: string;
  backupDate: number;
  wallets: BackupPayload[];
  contacts?: Contact[];
  // v2 expanded fields (settings, tx labels, UTXO metadata, pending txs)
  settings?: Record<string, unknown>;
  transactionLabels?: Record<string, unknown>;
  utxoMetadata?: Record<string, unknown>;
  pendingTransactions?: unknown[];
}

/** Full encrypted backup blob stored in iCloud */
export interface EncryptedFullBackupBlob {
  version: number;
  type: 'full_backup';
  backupName: string;
  backupDate: number;
  walletCount: number;
  walletNames: string[];
  salt: string;           // hex, 32 bytes
  iv: string;             // hex, 12 bytes
  encryptedData: string;  // hex, AES-256-GCM ciphertext
  authTag: string;        // hex, 16 bytes
  deviceId?: string;      // device that created this backup
}

/** Decrypted wallet payload (what gets encrypted) */
export interface BackupPayload {
  walletId: string;
  walletName: string;
  walletType: WalletType;
  createdAt: number;
  // HD wallet data (mnemonic-based)
  mnemonic?: string;
  passphrase?: string;
  // Extended private key (xprv) import
  xprv?: string;
  // Raw seed bytes (hex)
  seedHex?: string;
  // Single imported private key (WIF)
  privateKeyWIF?: string;
  privateKeyCompressed?: boolean;
  // Multiple imported private keys (dumpwallet format)
  importedKeysWIFs?: string[];
  // Derivation config for HD-like wallets
  derivationConfig?: {
    preset: string;
    accountIndex: number;
    addressIndex: number;
    customPath?: string;
  };
  scriptType?: string;
  // Watch-only data
  xpubs?: Record<string, string>;
  descriptor?: string;
  watchAddresses?: string[];
  // Multisig data
  multisigConfig?: any;
  multisigDescriptor?: string;
  cosignerSeeds?: { index: number; seed: string }[];
}

// ============================================
// BACKUP SERVICE
// ============================================

export class BackupService {
  private static readonly BACKUP_VERSION = 3;
  private static readonly KEY_LENGTH = 32;    // 256 bits
  private static readonly IV_LENGTH = 12;     // 96 bits for GCM
  private static readonly SALT_LENGTH = 32;   // 256 bits

  // Legacy PBKDF2 iterations — used ONLY for decrypting old v2 backups.
  private static readonly LEGACY_KDF_ITERATIONS = 100_000;

  // ============================================
  // KEY DERIVATION
  // ============================================

  /**
   * Derive a 256-bit encryption key from a password using SHA-256.
   * Instant (~1ms) — replaces the old PBKDF2 (100k iterations, ~2-5s on mobile).
   * Format: SHA256(password + ":" + saltHex) → 32-byte key.
   */
  static deriveKey(password: string, salt: string): string {
    const md = forge.md.sha256.create();
    md.update(password + ':' + salt, 'utf8');
    return md.digest().getBytes();
  }

  /**
   * Legacy PBKDF2 key derivation — used ONLY for decrypting old v2 backups.
   * @deprecated Only for backward compat. New backups use deriveKey() (SHA-256).
   */
  private static deriveKeyLegacyPBKDF2(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const saltBytes = forge.util.hexToBytes(salt);
      forge.pkcs5.pbkdf2(
        password,
        saltBytes,
        this.LEGACY_KDF_ITERATIONS,
        this.KEY_LENGTH,
        forge.md.sha256.create(),
        (err: any, key: string) => {
          if (err) reject(err);
          else resolve(key);
        },
      );
    });
  }

  // ============================================
  // ENCRYPTION / DECRYPTION
  // ============================================

  /**
   * Encrypt a backup payload with AES-256-GCM.
   * Uses instant SHA-256 key derivation.
   */
  static encryptBackup(
    payload: BackupPayload,
    password: string,
    deviceId?: string
  ): EncryptedBackupBlob {
    // Generate random salt and IV
    const saltBytes = forge.random.getBytesSync(this.SALT_LENGTH);
    const ivBytes = forge.random.getBytesSync(this.IV_LENGTH);
    const salt = forge.util.bytesToHex(saltBytes);
    const iv = forge.util.bytesToHex(ivBytes);

    // Derive encryption key (instant SHA-256)
    const key = this.deriveKey(password, salt);

    // Serialize payload to JSON
    const plaintext = JSON.stringify(payload);

    // AES-256-GCM encrypt
    const cipher = forge.cipher.createCipher('AES-GCM', key);
    cipher.start({
      iv: ivBytes,
      tagLength: 128, // 16 bytes auth tag
    });
    cipher.update(forge.util.createBuffer(plaintext, 'utf8'));
    cipher.finish();

    const encryptedData = forge.util.bytesToHex(cipher.output.getBytes());
    const authTag = forge.util.bytesToHex(cipher.mode.tag.getBytes());

    return {
      version: this.BACKUP_VERSION,
      type: 'wallet_backup',
      walletName: payload.walletName,
      walletType: payload.walletType,
      createdAt: payload.createdAt,
      backupDate: Date.now(),
      salt,
      iv,
      encryptedData,
      authTag,
      deviceId,
    };
  }

  /**
   * Try to decrypt data with a given key using AES-256-GCM.
   * @returns Decrypted string, or null if GCM auth fails.
   */
  private static tryDecryptGCM(blob: { iv: string; encryptedData: string; authTag: string }, key: string): string | null {
    try {
      const decipher = forge.cipher.createDecipher('AES-GCM', key);
      decipher.start({
        iv: forge.util.hexToBytes(blob.iv),
        tagLength: 128,
        tag: forge.util.createBuffer(forge.util.hexToBytes(blob.authTag)),
      });
      decipher.update(forge.util.createBuffer(forge.util.hexToBytes(blob.encryptedData)));
      const pass = decipher.finish();
      if (!pass) return null;
      return decipher.output.toString();
    } catch {
      return null;
    }
  }

  /**
   * Decrypt an encrypted backup blob.
   * Tries SHA-256 key first (v3+), falls back to legacy PBKDF2 key for old v2 backups.
   * @returns Decrypted payload, or null if password is wrong / data is corrupted
   */
  static async decryptBackup(
    blob: EncryptedBackupBlob,
    password: string,
  ): Promise<BackupPayload | null> {
    try {
      // 1. Try SHA-256 key (instant)
      const sha256Key = this.deriveKey(password, blob.salt);
      const result = this.tryDecryptGCM(blob, sha256Key);
      if (result) return JSON.parse(result);

      // 2. Fallback: try legacy PBKDF2 key (for old v2 backups)
      const pbkdf2Key = await this.deriveKeyLegacyPBKDF2(password, blob.salt);
      const legacyResult = this.tryDecryptGCM(blob, pbkdf2Key);
      if (legacyResult) return JSON.parse(legacyResult);

      return null;
    } catch {
      return null;
    }
  }

  // ============================================
  // PAYLOAD ASSEMBLY (read wallet data from SecureStorage)
  // ============================================

  /**
   * Assemble a backup payload for a wallet by reading its data from SecureStorage.
   * @param walletId - The wallet ID to back up
   * @param pin - User's PIN (needed to decrypt stored seed)
   * @returns Backup payload, or null if wallet not found
   */
  static async assemblePayload(
    walletId: string,
    pin: string,
  ): Promise<BackupPayload | null> {
    // Get wallet info from the store
    const wallet = useMultiWalletStore.getState().getWallet(walletId);
    if (!wallet) return null;

    const payload: BackupPayload = {
      walletId,
      walletName: wallet.name,
      walletType: wallet.type,
      createdAt: wallet.createdAt,
    };

    // Extract account ID (numeric) from wallet ID for legacy storage methods
    const accountId = this.extractAccountId(walletId);

    switch (wallet.type) {
      case 'hd': {
        // Get seed phrase and passphrase in parallel
        const [mnemonic, passphrase] = await Promise.all([
          SecureStorage.retrieveWalletSeed(walletId, pin),
          SecureStorage.retrieveWalletPassphrase(walletId, pin),
        ]);
        if (!mnemonic) return null; // PIN wrong or no seed
        payload.mnemonic = mnemonic;
        if (passphrase) {
          payload.passphrase = passphrase;
        }
        break;
      }

      case 'watch_xpub': {
        const xpubs = await SecureStorage.getWatchOnlyXpubs(accountId);
        if (xpubs) payload.xpubs = xpubs;
        break;
      }

      case 'watch_descriptor': {
        const descriptor = await SecureStorage.getWatchOnlyDescriptor(accountId);
        if (descriptor) payload.descriptor = descriptor;
        break;
      }

      case 'watch_addresses': {
        const addresses = await SecureStorage.getWatchAddresses(accountId);
        if (addresses) payload.watchAddresses = addresses;
        break;
      }

      case 'multisig': {
        // Read multisig config, descriptor, and cosigner seeds in parallel
        const [config, descriptor, cosignerSeeds] = await Promise.all([
          SecureStorage.getMultisigConfig(accountId),
          SecureStorage.retrieveWalletDescriptor(walletId, pin),
          SecureStorage.retrieveAllLocalCosignerSeeds(pin),
        ]);
        if (config) payload.multisigConfig = config;
        if (descriptor) payload.multisigDescriptor = descriptor;
        if (cosignerSeeds.length > 0) {
          payload.cosignerSeeds = cosignerSeeds;
        }
        break;
      }

      case 'imported_key': {
        // Single imported private key (WIF)
        const wifData = await SecureStorage.getImportedKeyWIF(walletId, pin);
        if (wifData) {
          payload.privateKeyWIF = wifData.wif;
          payload.privateKeyCompressed = wifData.compressed;
          payload.scriptType = wifData.scriptType;
        }
        break;
      }

      case 'hd_xprv': {
        // Extended private key import
        const xprvData = await SecureStorage.getImportedXprv(walletId, pin);
        if (xprvData) {
          payload.xprv = xprvData.xprv;
          payload.scriptType = xprvData.scriptType;
          if (xprvData.derivationConfig) {
            payload.derivationConfig = xprvData.derivationConfig;
          }
        }
        break;
      }

      case 'hd_seed': {
        // Raw seed bytes import
        const seedData = await SecureStorage.getImportedSeedHex(walletId, pin);
        if (seedData) {
          payload.seedHex = seedData.seedHex;
          payload.scriptType = seedData.scriptType;
          if (seedData.derivationConfig) {
            payload.derivationConfig = seedData.derivationConfig;
          }
        }
        break;
      }

      case 'hd_electrum': {
        // Electrum seed — stored as mnemonic (same as 'hd')
        const [electrumSeed, electrumPassphrase] = await Promise.all([
          SecureStorage.retrieveWalletSeed(walletId, pin),
          SecureStorage.retrieveWalletPassphrase(walletId, pin),
        ]);
        if (!electrumSeed) return null;
        payload.mnemonic = electrumSeed;
        if (electrumPassphrase) payload.passphrase = electrumPassphrase;
        break;
      }

      case 'hd_descriptor': {
        // Descriptor with private key — stores xprv + raw descriptor
        const [descXprv, descRaw] = await Promise.all([
          SecureStorage.retrieveWalletXprv(walletId, pin),
          SecureStorage.retrieveWalletDescriptor(walletId, pin),
        ]);
        if (descXprv) payload.xprv = descXprv;
        if (descRaw) payload.descriptor = descRaw;
        break;
      }

      case 'imported_keys': {
        // Multiple imported WIF keys (dumpwallet)
        const wifs = await SecureVault.retrieve(walletId, 'wif_set', pin);
        if (Array.isArray(wifs) && wifs.length > 0) {
          payload.importedKeysWIFs = wifs;
        }
        break;
      }

      default:
        // Unknown wallet type - return what we have
        // Unknown wallet type
        break;
    }

    return payload;
  }

  // ============================================
  // PAYLOAD RESTORATION (write wallet data back to SecureStorage)
  // ============================================

  /**
   * Restore a wallet from a decrypted backup payload.
   * Creates the wallet in multiWalletStore and stores data in SecureStorage.
   *
   * @param payload - Decrypted backup payload
   * @param pin - User's PIN for encrypting stored data
   * @returns The new wallet ID, or null on failure
   */
  static async restoreFromPayload(
    payload: BackupPayload,
    pin: string,
  ): Promise<string | null> {
    try {
      const store = useMultiWalletStore.getState();

      // Create the wallet in the store
      const wallet = await store.addWallet({
        name: payload.walletName,
        type: payload.walletType,
      });

      const walletId = wallet.id;
      const accountId = this.extractAccountId(walletId);

      switch (payload.walletType) {
        case 'hd': {
          if (!payload.mnemonic) return null;

          // Store seed
          await SecureStorage.storeWalletSeed(
            walletId,
            payload.mnemonic,
            pin,
            payload.passphrase || '',
          );
          break;
        }

        case 'watch_xpub': {
          if (payload.xpubs) {
            await SecureStorage.storeWatchOnlyXpubs(accountId, payload.xpubs);
          }
          break;
        }

        case 'watch_descriptor': {
          if (payload.descriptor) {
            await SecureStorage.storeWatchOnlyDescriptor(accountId, payload.descriptor);
          }
          break;
        }

        case 'watch_addresses': {
          if (payload.watchAddresses) {
            await SecureStorage.storeWatchAddresses(accountId, payload.watchAddresses);
          }
          break;
        }

        case 'multisig': {
          // Store multisig config and descriptor in parallel
          await Promise.all([
            payload.multisigConfig
              ? SecureStorage.storeMultisigConfig(accountId, payload.multisigConfig)
              : Promise.resolve(),
            payload.multisigDescriptor
              ? SecureStorage.storeWalletDescriptor(walletId, payload.multisigDescriptor, pin)
              : Promise.resolve(),
          ]);

          // Store cosigner seeds in parallel
          if (payload.cosignerSeeds) {
            await Promise.all(
              payload.cosignerSeeds.map(({ index, seed }) =>
                SecureStorage.storeLocalCosignerSeed(index, seed, pin)
              )
            );
          }
          break;
        }

        case 'imported_key': {
          // Restore single imported private key (WIF)
          if (payload.privateKeyWIF) {
            await SecureStorage.storeImportedKeyWIF(walletId, {
              wif: payload.privateKeyWIF,
              compressed: payload.privateKeyCompressed ?? true,
              scriptType: payload.scriptType || 'native_segwit',
            }, pin);
          }
          break;
        }

        case 'hd_xprv': {
          // Restore extended private key import
          if (payload.xprv) {
            await SecureStorage.storeImportedXprv(walletId, {
              xprv: payload.xprv,
              scriptType: payload.scriptType || 'native_segwit',
              derivationConfig: payload.derivationConfig,
            }, pin);
          }
          break;
        }

        case 'hd_seed': {
          // Restore raw seed bytes import
          if (payload.seedHex) {
            await SecureStorage.storeImportedSeedHex(walletId, {
              seedHex: payload.seedHex,
              scriptType: payload.scriptType || 'native_segwit',
              derivationConfig: payload.derivationConfig,
            }, pin);
          }
          break;
        }

        case 'hd_electrum': {
          // Restore Electrum seed — stored as mnemonic (same as 'hd')
          if (payload.mnemonic) {
            await SecureStorage.storeWalletSeed(
              walletId,
              payload.mnemonic,
              pin,
              payload.passphrase || '',
            );
          }
          break;
        }

        case 'hd_descriptor': {
          // Restore descriptor with private key — xprv + raw descriptor
          await Promise.all([
            payload.xprv
              ? SecureStorage.storeWalletXprv(walletId, payload.xprv, pin)
              : Promise.resolve(),
            payload.descriptor
              ? SecureStorage.storeWalletDescriptor(walletId, payload.descriptor, pin)
              : Promise.resolve(),
          ]);
          break;
        }

        case 'imported_keys': {
          // Restore multiple imported WIF keys
          if (payload.importedKeysWIFs && payload.importedKeysWIFs.length > 0) {
            await SecureVault.store(walletId, payload.importedKeysWIFs, 'wif_set', pin);
          }
          break;
        }

        default:
          // Unknown wallet type during restore
          break;
      }

      return walletId;
    } catch (error) {
      // Failed to restore from payload
      return null;
    }
  }

  // ============================================
  // FULL BACKUP (all wallets at once)
  // ============================================

  /**
   * Assemble a full backup payload containing ALL wallets + all app state.
   * Delegates to AppStateManager for expanded v2 payload (settings, tx labels, etc.).
   */
  static async assembleFullPayload(
    pin: string,
    backupName: string,
  ): Promise<FullBackupPayload | null> {
    // Use require() to avoid circular import
    const { AppStateManager } = require('../AppStateManager');
    return AppStateManager.assembleFullState(pin, backupName);
  }

  /**
   * Encrypt a full backup payload with AES-256-GCM.
   * Uses instant SHA-256 key derivation.
   */
  static encryptFullBackup(
    payload: FullBackupPayload,
    password: string,
    deviceId?: string
  ): EncryptedFullBackupBlob {
    const saltBytes = forge.random.getBytesSync(this.SALT_LENGTH);
    const ivBytes = forge.random.getBytesSync(this.IV_LENGTH);
    const salt = forge.util.bytesToHex(saltBytes);
    const iv = forge.util.bytesToHex(ivBytes);

    const key = this.deriveKey(password, salt);

    const plaintext = JSON.stringify(payload);

    const cipher = forge.cipher.createCipher('AES-GCM', key);
    cipher.start({
      iv: ivBytes,
      tagLength: 128,
    });
    cipher.update(forge.util.createBuffer(plaintext, 'utf8'));
    cipher.finish();

    const encryptedData = forge.util.bytesToHex(cipher.output.getBytes());
    const authTag = forge.util.bytesToHex(cipher.mode.tag.getBytes());

    return {
      version: this.BACKUP_VERSION,
      type: 'full_backup',
      backupName: payload.backupName,
      backupDate: payload.backupDate,
      walletCount: payload.wallets.length,
      walletNames: payload.wallets.map(w => w.walletName),
      salt,
      iv,
      encryptedData,
      authTag,
      deviceId,
    };
  }

  /**
   * Decrypt a full backup blob.
   * Tries SHA-256 key first (v3+), falls back to legacy PBKDF2 for old v2 backups.
   * @returns Decrypted full payload, or null if password is wrong / data is corrupted
   */
  static async decryptFullBackup(
    blob: EncryptedFullBackupBlob,
    password: string,
  ): Promise<FullBackupPayload | null> {
    try {
      // 1. Try SHA-256 key (instant)
      const sha256Key = this.deriveKey(password, blob.salt);
      const result = this.tryDecryptGCM(blob, sha256Key);
      if (result) return JSON.parse(result);

      // 2. Fallback: try legacy PBKDF2 key (for old v2 backups)
      const pbkdf2Key = await this.deriveKeyLegacyPBKDF2(password, blob.salt);
      const legacyResult = this.tryDecryptGCM(blob, pbkdf2Key);
      if (legacyResult) return JSON.parse(legacyResult);

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Restore all wallets + app state from a full backup payload.
   * v2 payloads restore settings, tx labels, UTXO metadata via AppStateManager.
   * v1 payloads restore wallets + contacts only (backward compatible).
   * @returns Array of new wallet IDs, or empty array on failure
   */
  static async restoreFullBackup(
    payload: FullBackupPayload,
    pin: string,
  ): Promise<string[]> {
    // Use require() to avoid circular import
    const { AppStateManager } = require('../AppStateManager');
    return AppStateManager.restoreFullState(payload, pin);
  }

  /**
   * Parse a full backup blob from its JSON string representation.
   * Validates required fields including type === 'full_backup'.
   */
  static parseFullBlob(json: string): EncryptedFullBackupBlob | null {
    try {
      const parsed = JSON.parse(json);
      if (
        parsed.type !== 'full_backup' ||
        !parsed.salt ||
        !parsed.iv ||
        !parsed.encryptedData ||
        !parsed.authTag ||
        typeof parsed.walletCount !== 'number'
      ) {
        return null;
      }
      return parsed as EncryptedFullBackupBlob;
    } catch {
      return null;
    }
  }

  /**
   * Serialize a full backup blob to JSON string for iCloud storage.
   */
  static serializeFullBlob(blob: EncryptedFullBackupBlob): string {
    return JSON.stringify(blob);
  }

  // ============================================
  // COMPRESSED FULL BACKUP (gzip before encryption)
  // ============================================

  /**
   * Encrypt a full backup payload with gzip compression + AES-256-GCM.
   * Compression typically reduces payload size by 60-80%, helping fit
   * within iCloud's 1MB KVS limit.
   * Uses instant SHA-256 key derivation.
   */
  static encryptFullBackupCompressed(
    payload: FullBackupPayload,
    password: string,
    deviceId?: string
  ): EncryptedFullBackupBlob {
    const saltBytes = forge.random.getBytesSync(this.SALT_LENGTH);
    const ivBytes = forge.random.getBytesSync(this.IV_LENGTH);
    const salt = forge.util.bytesToHex(saltBytes);
    const iv = forge.util.bytesToHex(ivBytes);

    const key = this.deriveKey(password, salt);

    // Gzip compress the JSON payload before encryption
    const json = JSON.stringify(payload);
    const compressed = CanonicalSnapshotBuilder.compress(json);

    // Convert Uint8Array to forge binary string for encryption
    let binaryStr = '';
    for (let i = 0; i < compressed.length; i++) {
      binaryStr += String.fromCharCode(compressed[i]);
    }

    const cipher = forge.cipher.createCipher('AES-GCM', key);
    cipher.start({
      iv: ivBytes,
      tagLength: 128,
    });
    cipher.update(forge.util.createBuffer(binaryStr, 'raw'));
    cipher.finish();

    const encryptedData = forge.util.bytesToHex(cipher.output.getBytes());
    const authTag = forge.util.bytesToHex(cipher.mode.tag.getBytes());

    return {
      version: this.BACKUP_VERSION,
      type: 'full_backup',
      backupName: payload.backupName,
      backupDate: payload.backupDate,
      walletCount: payload.wallets.length,
      walletNames: payload.wallets.map(w => w.walletName),
      salt,
      iv,
      encryptedData,
      authTag,
      deviceId,
    };
  }

  /**
   * Try to decrypt compressed data with a given key.
   * Handles both compressed (gzip) and uncompressed (legacy) payloads.
   * @returns Parsed payload, or null if decryption / decompression fails.
   */
  private static tryDecryptCompressedGCM(
    blob: { iv: string; encryptedData: string; authTag: string },
    key: string,
  ): FullBackupPayload | null {
    try {
      const decipher = forge.cipher.createDecipher('AES-GCM', key);
      decipher.start({
        iv: forge.util.hexToBytes(blob.iv),
        tagLength: 128,
        tag: forge.util.createBuffer(forge.util.hexToBytes(blob.authTag)),
      });
      decipher.update(forge.util.createBuffer(forge.util.hexToBytes(blob.encryptedData)));
      const pass = decipher.finish();
      if (!pass) return null;

      const rawBytes = decipher.output.getBytes();

      // Try compressed first, then uncompressed
      try {
        const bytes = new Uint8Array(rawBytes.length);
        for (let i = 0; i < rawBytes.length; i++) {
          bytes[i] = rawBytes.charCodeAt(i);
        }
        const json = CanonicalSnapshotBuilder.decompress(bytes);
        return JSON.parse(json);
      } catch {
        // Not compressed — try as plain text
        return JSON.parse(rawBytes);
      }
    } catch {
      return null;
    }
  }

  /**
   * Decrypt a compressed full backup blob.
   * Tries SHA-256 key first (v3+), falls back to legacy PBKDF2 for old v2 backups.
   * Handles both compressed (gzip) and uncompressed (legacy) payloads.
   * @returns Decrypted full payload, or null if password is wrong / data is corrupted
   */
  static async decryptFullBackupCompressed(
    blob: EncryptedFullBackupBlob,
    password: string,
  ): Promise<FullBackupPayload | null> {
    // 1. Try SHA-256 key (instant)
    const sha256Key = this.deriveKey(password, blob.salt);
    const result = this.tryDecryptCompressedGCM(blob, sha256Key);
    if (result) return result;

    // 2. Fallback: try legacy PBKDF2 key (for old v2 backups)
    try {
      const pbkdf2Key = await this.deriveKeyLegacyPBKDF2(password, blob.salt);
      const legacyResult = this.tryDecryptCompressedGCM(blob, pbkdf2Key);
      if (legacyResult) return legacyResult;
    } catch {
      // PBKDF2 derivation failed
    }

    return null;
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Check if a wallet type requires a password for iCloud backup.
   * Watch-only wallets have no secrets, so they don't need password encryption.
   */
  static requiresPassword(walletType: WalletType): boolean {
    // All types with private key material need password encryption
    return (
      walletType === 'hd' ||
      walletType === 'multisig' ||
      walletType === 'imported_key' ||
      walletType === 'imported_keys' ||
      walletType === 'hd_xprv' ||
      walletType === 'hd_seed' ||
      walletType === 'hd_descriptor' ||
      walletType === 'hd_electrum'
    );
  }

  /**
   * Extract numeric account ID from a wallet ID string.
   * Wallet IDs are UUIDs — we parse the first numeric portion or hash to a number.
   * For legacy compatibility with SecureStorage methods that use numeric account IDs.
   */
  private static extractAccountId(walletId: string): number {
    // Try to find a stored account mapping, or derive from the wallet ID
    // For new wallets created by multiWalletStore, we use the wallet's index
    const store = useMultiWalletStore.getState();
    const index = store.wallets.findIndex(w => w.id === walletId);
    return index >= 0 ? index : 0;
  }

  /**
   * Parse an encrypted blob from its JSON string representation.
   * Validates required fields.
   */
  static parseBlob(json: string): EncryptedBackupBlob | null {
    try {
      const parsed = JSON.parse(json);
      if (
        parsed.type !== 'wallet_backup' ||
        !parsed.salt ||
        !parsed.iv ||
        !parsed.encryptedData ||
        !parsed.authTag
      ) {
        return null;
      }
      return parsed as EncryptedBackupBlob;
    } catch {
      return null;
    }
  }

  /**
   * Serialize an encrypted blob to JSON string for iCloud storage.
   */
  static serializeBlob(blob: EncryptedBackupBlob): string {
    return JSON.stringify(blob);
  }
}
