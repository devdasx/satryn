import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createCipheriv, createDecipheriv } from 'browserify-cipher';
import { createHash } from 'crypto-browserify';
import { STORAGE_KEYS, ENCRYPTION_VERSION } from '../../constants';

// PBKDF2 migration code has been removed. All encryption now uses SHA-256 key derivation.

/**
 * Secure Storage Service
 * Handles encrypted storage of sensitive data in iOS Keychain
 */
export class SecureStorage {

  /**
   * No-op — kept for API compatibility. Key derivation is now instant (SHA-256).
   */
  static clearKeyCache(): void {
    // No-op: SHA-256 key derivation is instant, no cache needed
  }

  /**
   * Generate a random salt for encryption
   * @returns Hex-encoded salt
   */
  private static async generateSalt(): Promise<string> {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    return this.bytesToHex(randomBytes);
  }

  /**
   * Convert Uint8Array to hex string
   */
  private static bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ============================================
  // KEY DERIVATION
  // ============================================

  /**
   * Derive a 32-byte encryption key from PIN using SHA-256.
   * Fast (~1ms) since iOS Keychain + rate limiting protect the PIN.
   * @param pin - User's PIN
   * @param salt - Random salt (hex string)
   * @returns 32-byte key as Buffer
   */
  private static deriveKeySHA256(pin: string, salt: string): Buffer {
    // SHA-256 of "pin:salt" → 32 bytes (matches AES-256 key size)
    return createHash('sha256').update(`${pin}:${salt}`).digest();
  }

  /**
   * Legacy key derivation: 1000 rounds of SHA256 (weak, for V1 XOR migration only).
   * NOT related to PBKDF2 — this is for the oldest encryption format.
   */
  private static async _legacyDeriveKey(pin: string, salt: string): Promise<string> {
    let key = `${pin}:${salt}`;
    for (let i = 0; i < 1000; i++) {
      key = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        key
      );
    }
    return key;
  }

  /**
   * Decrypt V2 data using SHA-256 key derivation.
   * Returns same shape as the old tryDecryptV2AndReEncrypt for API compatibility.
   * needsReEncrypt is always false since we no longer migrate from PBKDF2.
   */
  private static tryDecryptV2AndReEncrypt(
    encryptedData: string,
    pin: string,
    salt: string,
  ): { decrypted: string; needsReEncrypt: boolean; reEncrypted?: string } | null {
    const sha256Key = this.deriveKeySHA256(pin, salt);
    try {
      const decrypted = this.decryptV2(encryptedData, sha256Key);
      return { decrypted, needsReEncrypt: false };
    } catch {
      return null;
    }
  }

  /**
   * Decrypt V2 data using SHA-256 key derivation.
   * Simple version — returns decrypted string or null.
   */
  private static tryDecryptV2WithMigration(
    encryptedData: string,
    pin: string,
    salt: string,
  ): string | null {
    const sha256Key = this.deriveKeySHA256(pin, salt);
    try {
      return this.decryptV2(encryptedData, sha256Key);
    } catch {
      return null;
    }
  }

  // ============================================
  // AES-256-GCM ENCRYPTION (V2)
  // ============================================

  /**
   * Encrypt data with AES-256-GCM.
   * Format: "2:<iv_hex>:<ciphertext_hex>:<authTag_hex>"
   * @param data - Plaintext string
   * @param key - 32-byte key Buffer
   * @returns Versioned encrypted string
   */
  private static encryptV2(data: string, key: Buffer): string {
    const ivArray = new Uint8Array(12);
    global.crypto.getRandomValues(ivArray);
    const iv = Buffer.from(ivArray); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(data, 'utf-8');
    const encPart1 = cipher.update(plaintext);
    const encPart2 = cipher.final();
    const encrypted = Buffer.concat([encPart1, encPart2]);
    const authTag = cipher.getAuthTag();
    return `2:${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
  }

  /**
   * Decrypt AES-256-GCM encrypted data.
   * Expects format: "2:<iv_hex>:<ciphertext_hex>:<authTag_hex>"
   * @param encryptedString - Versioned encrypted string
   * @param key - 32-byte key Buffer
   * @returns Decrypted plaintext string
   */
  private static decryptV2(encryptedString: string, key: Buffer): string {
    const parts = encryptedString.split(':');
    if (parts.length !== 4 || parts[0] !== '2') {
      throw new Error('Invalid V2 encrypted data format');
    }
    const iv = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decPart1 = decipher.update(ciphertext);
    const decPart2 = decipher.final();
    const decrypted = Buffer.concat([decPart1, decPart2]);
    return decrypted.toString('utf-8');
  }

  // ============================================
  // LEGACY XOR ENCRYPTION (V1 — migration only)
  // ============================================

  /**
   * Legacy XOR encryption (weak, kept for migration from v1 data)
   */
  private static _legacyXorEncrypt(data: string, key: string): string {
    const dataBytes = new TextEncoder().encode(data);
    const keyBytes = new TextEncoder().encode(key);
    const encrypted = new Uint8Array(dataBytes.length);
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return this.bytesToHex(encrypted);
  }

  /**
   * Legacy XOR decryption (weak, kept for migration from v1 data)
   */
  private static _legacyXorDecrypt(encryptedHex: string, key: string): string {
    const encryptedBytes = new Uint8Array(
      encryptedHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
    );
    const keyBytes = new TextEncoder().encode(key);
    const decrypted = new Uint8Array(encryptedBytes.length);
    for (let i = 0; i < encryptedBytes.length; i++) {
      decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return new TextDecoder().decode(decrypted);
  }

  // ============================================
  // ENCRYPTION VERSION HELPERS
  // ============================================

  /**
   * Check encryption version for a storage key.
   * Returns "2" for AES-GCM, "1" (or missing) for legacy XOR.
   */
  private static async getEncryptionVersion(storageKey: string): Promise<string> {
    const ver = await SecureStore.getItemAsync(`${STORAGE_KEYS.ENCRYPTION_VERSION_PREFIX}${storageKey}`);
    return ver || ENCRYPTION_VERSION.LEGACY_XOR;
  }

  /**
   * Mark a storage key as using V2 (AES-GCM) encryption.
   */
  private static async setEncryptionVersionV2(storageKey: string): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.ENCRYPTION_VERSION_PREFIX}${storageKey}`,
      ENCRYPTION_VERSION.AES_GCM
    );
  }

  /**
   * Encrypt data with AES-256-GCM using SHA-256-derived key.
   */
  private static encrypt(data: string, key: Buffer): string {
    return this.encryptV2(data, key);
  }

  /**
   * Derive encryption key using SHA-256 (fast, ~1ms).
   */
  private static deriveKey(pin: string, salt: string): Buffer {
    return this.deriveKeySHA256(pin, salt);
  }

  /**
   * Store encrypted seed phrase in Keychain
   * @param mnemonic - The seed phrase to store
   * @param pin - User's PIN for encryption
   * @param passphrase - Optional BIP39 passphrase (25th word)
   */
  static async storeSeed(mnemonic: string, pin: string, passphrase: string = ''): Promise<void> {
    // IMPORTANT: Reuse existing salt if present to avoid invalidating existing encrypted data.
    // Only generate a new salt on first-ever wallet creation.
    let salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_SALT, salt, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    const key = this.deriveKey(pin, salt);
    const encryptedSeed = this.encrypt(mnemonic, key);

    await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_SEED, encryptedSeed, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    // Ensure PIN hash exists (won't overwrite if already set with same salt)
    const existingPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);
    if (!existingPinHash) {
      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );
      await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    // Mark as V2 encryption
    await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_SEED);

    if (passphrase) {
      const encryptedPassphrase = this.encrypt(passphrase, key);
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE, encryptedPassphrase, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
    }
  }

  /**
   * Retrieve and decrypt seed phrase
   * @param pin - User's PIN
   * @returns Decrypted mnemonic or null if PIN is wrong
   */
  static async retrieveSeed(pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
      const encryptedSeed = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_SEED);
      const storedPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);

      if (!salt || !encryptedSeed || !storedPinHash) {
        return null;
      }

      // Verify PIN
      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );

      if (pinHash !== storedPinHash) {
        return null;
      }

      if (encryptedSeed.startsWith('2:')) {
        // V2 AES-GCM format — decrypt with SHA-256 key
        const result = this.tryDecryptV2AndReEncrypt(encryptedSeed, pin, salt);
        if (!result) return null;

        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_SEED, result.reEncrypted, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          // Also migrate passphrase if it exists
          const encryptedPassphrase = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
          if (encryptedPassphrase?.startsWith('2:')) {
            const ppResult = this.tryDecryptV2AndReEncrypt(encryptedPassphrase, pin, salt);
            if (ppResult?.needsReEncrypt && ppResult.reEncrypted) {
              await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE, ppResult.reEncrypted, {
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
              });
            }
          }
        }
        return result.decrypted;
      }

      // Legacy XOR format — derive legacy key and migrate to AES-GCM with SHA-256 key
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const mnemonic = this._legacyXorDecrypt(encryptedSeed, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(mnemonic, v2Key);
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_SEED, reEncrypted, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_SEED);

      // Also migrate passphrase if it exists
      const encryptedPassphrase = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
      if (encryptedPassphrase && !encryptedPassphrase.startsWith('2:')) {
        const passphrase = this._legacyXorDecrypt(encryptedPassphrase, legacyKey);
        const reEncryptedPassphrase = this.encrypt(passphrase, v2Key);
        await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE, reEncryptedPassphrase, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
      }

      return mnemonic;
    } catch (error) {
      return null;
    }
  }

  /**
   * Retrieve and decrypt BIP39 passphrase
   * @param pin - User's PIN
   * @returns Decrypted passphrase or empty string if not set
   */
  static async retrievePassphrase(pin: string): Promise<string> {
    try {
      const salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
      const encryptedPassphrase = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
      const storedPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);

      if (!salt || !storedPinHash) return '';
      if (!encryptedPassphrase) return '';

      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );
      if (pinHash !== storedPinHash) return '';

      if (encryptedPassphrase.startsWith('2:')) {
        const result = this.tryDecryptV2WithMigration(encryptedPassphrase, pin, salt);
        return result ?? '';
      }
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      return this._legacyXorDecrypt(encryptedPassphrase, legacyKey);
    } catch (error) {
      return '';
    }
  }

  /**
   * Check if a PIN has been set up (PIN hash exists in storage).
   */
  static async hasPinSet(): Promise<boolean> {
    try {
      const storedPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);
      return !!storedPinHash;
    } catch {
      return false;
    }
  }

  /**
   * Ensure PIN hash exists (for non-mnemonic wallet types that don't call storeSeed).
   * Creates salt and PIN hash if they don't exist.
   * @param pin - User's PIN
   */
  static async ensurePinHashExists(pin: string): Promise<void> {
    const existingPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);
    if (existingPinHash) return; // Already set

    let salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_SALT, salt, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    const pinHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${pin}:${salt}`
    );
    await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  /**
   * Verify if a PIN is correct
   * @param pin - PIN to verify
   * @returns Whether the PIN is correct
   */
  static async verifyPin(pin: string): Promise<boolean> {
    try {
      const salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
      const storedPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);

      if (!salt || !storedPinHash) {

        // RECOVERY: If global salt/hash are missing but we still have wallet data,
        // try to verify by attempting decryption of ANY known encrypted data.
        // If that works, the PIN is correct and we can re-create the hash.
        if (!salt && !storedPinHash) {
          const recovered = await this.tryRecoverPinHash(pin);
          if (recovered) {
            return true;
          }
        }

        return false;
      }

      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );

      const isValid = pinHash === storedPinHash;
      if (!isValid) {
      }
      return isValid;
    } catch (error) {
      return false;
    }
  }

  /**
   * Attempt to recover PIN hash by trying to decrypt known wallet data.
   * This handles the edge case where Keychain lost the global salt/hash
   * but per-wallet data is still intact.
   */
  private static async tryRecoverPinHash(pin: string): Promise<boolean> {
    try {
      // Check if we have a legacy encrypted seed with its own salt
      const legacySalt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
      const legacySeed = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_SEED);

      if (legacySalt && legacySeed) {
        // Salt exists but hash doesn't — try to verify by decrypting the seed
        const key = this.deriveKey(pin, legacySalt);
        try {
          this.decryptV2(legacySeed, key);
          // Decryption succeeded — PIN is correct! Re-create the hash
          const pinHash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            `${pin}:${legacySalt}`
          );
          await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          return true;
        } catch {
          // Decryption failed — wrong PIN
          return false;
        }
      }

      // No legacy seed — check per-wallet seeds
      // We need to find any wallet salt and encrypted seed to test against
      // This requires knowing wallet IDs from the multi-wallet store
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Change the PIN (re-encrypts the seed with new PIN)
   * @param oldPin - Current PIN
   * @param newPin - New PIN
   * @returns Whether the change was successful
   */
  static async changePin(oldPin: string, newPin: string): Promise<boolean> {
    // Retrieve seed with old PIN (this also triggers migration if needed)
    const seed = await this.retrieveSeed(oldPin);
    if (!seed) {
      return false;
    }

    // Also retrieve passphrase before re-encrypting
    const passphrase = await this.retrievePassphrase(oldPin);

    // Generate a NEW salt for the new PIN (different PIN needs different hash)
    const newSalt = await this.generateSalt();
    const newKey = this.deriveKey(newPin, newSalt);
    const encryptedSeed = this.encrypt(seed, newKey);

    // Overwrite salt, seed, and PIN hash
    await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_SALT, newSalt, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_SEED, encryptedSeed, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_SEED);

    const pinHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${newPin}:${newSalt}`
    );
    await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    // Write-through to DB for visibility in Database Viewer
    this.writePinHashToDb(pinHash);

    // Re-encrypt passphrase if it exists
    if (passphrase) {
      const encryptedPassphrase = this.encrypt(passphrase, newKey);
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE, encryptedPassphrase, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await this.setEncryptionVersionV2(STORAGE_KEYS.ENCRYPTED_PASSPHRASE);
    }

    // Update biometric PIN if it was stored
    const hasBiometric = await this.hasBiometricPin();
    if (hasBiometric) {
      await this.storePinForBiometrics(newPin);
    }

    return true;
  }

  /**
   * Check if a wallet exists (seed is stored)
   * @returns Whether a wallet is stored
   */
  static async hasWallet(): Promise<boolean> {
    const encryptedSeed = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTED_SEED);
    return encryptedSeed !== null;
  }

  /**
   * Delete ALL stored data from SecureStore (WARNING: This is irreversible)
   * Wipes everything: seeds, PIN, biometrics, address book, backups, accounts
   */
  static async deleteWallet(): Promise<void> {
    // Delete all Keychain entries in parallel (independent operations)
    const deletes = [
      // Legacy single-wallet keys
      SecureStore.deleteItemAsync(STORAGE_KEYS.ENCRYPTED_SEED),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ENCRYPTED_PASSPHRASE),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ENCRYPTION_SALT),
      SecureStore.deleteItemAsync(STORAGE_KEYS.PIN_HASH),
      SecureStore.deleteItemAsync(STORAGE_KEYS.WALLET_METADATA),
      SecureStore.deleteItemAsync(STORAGE_KEYS.SETTINGS),
      SecureStore.deleteItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR),
      // PIN and biometric data
      SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_PIN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.PIN_POLICY),
      SecureStore.deleteItemAsync(STORAGE_KEYS.PIN_FAILED_ATTEMPTS),
      SecureStore.deleteItemAsync(STORAGE_KEYS.PIN_LOCKOUT_UNTIL),
      // User data
      SecureStore.deleteItemAsync(STORAGE_KEYS.ADDRESS_BOOK),
      SecureStore.deleteItemAsync(STORAGE_KEYS.LAST_ACTIVITY),
      // Backup and account management
      SecureStore.deleteItemAsync(STORAGE_KEYS.BACKUP_METADATA),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ICLOUD_BACKUP_KEY),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ACCOUNTS_LIST),
      SecureStore.deleteItemAsync(STORAGE_KEYS.CURRENT_ACCOUNT),
    ];
    await Promise.allSettled(deletes);

    // Clear local cosigner seeds for multisig wallets
    await this.clearLocalCosignerSeeds();
  }

  /**
   * Delete all per-wallet SecureStore keys for a list of wallet IDs.
   * Called during full wipe to clean up multi-wallet data.
   */
  static async deleteAllWalletData(walletIds: string[]): Promise<void> {
    // Delete all wallet data in parallel (each wallet is independent)
    await Promise.allSettled(walletIds.map(id => this.deleteWalletData(id)));
  }

  /**
   * Store general settings (non-sensitive)
   * @param key - Setting key
   * @param value - Setting value
   */
  static async setSetting(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  }

  /**
   * Get a setting value
   * @param key - Setting key
   * @returns Setting value or null
   */
  static async getSetting(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  /**
   * Store wallet metadata (addresses count, network, etc.)
   * @param metadata - Wallet metadata object
   */
  static async storeWalletMetadata(metadata: object): Promise<void> {
    await SecureStore.setItemAsync(
      STORAGE_KEYS.WALLET_METADATA,
      JSON.stringify(metadata)
    );
  }

  /**
   * Get wallet metadata
   * @returns Wallet metadata or null
   */
  static async getWalletMetadata<T>(): Promise<T | null> {
    const data = await SecureStore.getItemAsync(STORAGE_KEYS.WALLET_METADATA);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * Store PIN for biometric authentication
   * The PIN is stored with biometric protection so it can only be retrieved
   * after successful Face ID / Touch ID authentication
   * @param pin - User's PIN to store
   */
  static async storePinForBiometrics(pin: string): Promise<void> {
    await SecureStore.setItemAsync(
      STORAGE_KEYS.BIOMETRIC_PIN,
      pin,
      {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }
    );
  }

  /**
   * Store PIN hash (salt + hash) without storing any seed.
   * Used for skip mode where user creates a PIN but no wallet.
   */
  static async storePin(pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_SALT, salt, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    const existingPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);
    if (!existingPinHash) {
      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );
      await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // Write-through to DB for visibility in Database Viewer
      this.writePinHashToDb(pinHash);
    }
  }

  /**
   * Write PIN hash to SQLite app_config table (for Database Viewer visibility).
   * Keychain remains the authoritative source — this is a non-critical mirror.
   */
  private static writePinHashToDb(pinHash: string): void {
    try {
      const { WalletDatabase } = require('../database');
      const db = WalletDatabase.shared();
      db.setConfig('pin_hash', pinHash);
    } catch {
      // DB not ready yet — non-critical
    }
  }

  /**
   * Retrieve PIN stored for biometric authentication
   * This should only be called after successful biometric verification
   * @returns The stored PIN or null if not set
   */
  static async getPinForBiometrics(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PIN);
    } catch (error) {
      return null;
    }
  }

  /**
   * Remove stored biometric PIN
   * Called when user disables biometric authentication
   */
  static async removeBiometricPin(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_PIN);
  }

  /**
   * Check if PIN is stored for biometrics
   * @returns Whether a PIN is stored for biometric auth
   */
  static async hasBiometricPin(): Promise<boolean> {
    const pin = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PIN);
    return pin !== null;
  }

  // ============================================
  // MULTI-ACCOUNT STORAGE METHODS
  // ============================================

  /**
   * Store seed for a specific account
   * @param accountId - Account identifier
   * @param mnemonic - The seed phrase to store
   * @param pin - User's PIN for encryption
   */
  static async storeAccountSeed(accountId: number, mnemonic: string, pin: string): Promise<void> {
    const salt = await this.generateSalt();
    const key = this.deriveKey(pin, salt);
    const encryptedSeed = this.encrypt(mnemonic, key);

    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.ACCOUNT_SALT_PREFIX}${accountId}`,
      salt,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );

    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`,
      encryptedSeed,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`);
  }

  /**
   * Retrieve seed for a specific account
   * @param accountId - Account identifier
   * @param pin - User's PIN
   * @returns Decrypted mnemonic or null
   */
  static async retrieveAccountSeed(accountId: number, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_SALT_PREFIX}${accountId}`);
      const encryptedSeed = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`);

      if (!salt || !encryptedSeed) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedSeed.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedSeed, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      // Legacy XOR format — derive legacy key and migrate
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const mnemonic = this._legacyXorDecrypt(encryptedSeed, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(mnemonic, v2Key);
      await SecureStore.setItemAsync(
        `${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`);

      return mnemonic;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete seed for a specific account
   * @param accountId - Account identifier
   */
  static async deleteAccountSeed(accountId: number): Promise<void> {
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.ACCOUNT_SEED_PREFIX}${accountId}`);
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.ACCOUNT_SALT_PREFIX}${accountId}`);
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`);
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.ACCOUNT_METADATA_PREFIX}${accountId}`);
  }

  /**
   * Store encrypted BIP39 passphrase for an account
   * @param accountId - Account identifier
   * @param passphrase - The BIP39 passphrase (25th word)
   * @param pin - User's PIN for encryption
   */
  static async storeAccountPassphrase(accountId: number, passphrase: string, pin: string): Promise<void> {
    const salt = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_SALT_PREFIX}${accountId}`);
    if (!salt) {
      throw new Error('Account salt not found');
    }

    const key = this.deriveKey(pin, salt);
    const encryptedPassphrase = this.encrypt(passphrase, key);

    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`,
      encryptedPassphrase,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`);
  }

  /**
   * Retrieve BIP39 passphrase for an account
   * @param accountId - Account identifier
   * @param pin - User's PIN
   * @returns Decrypted passphrase or null
   */
  static async retrieveAccountPassphrase(accountId: number, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_SALT_PREFIX}${accountId}`);
      const encryptedPassphrase = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`);

      if (!salt || !encryptedPassphrase) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedPassphrase.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedPassphrase, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const passphrase = this._legacyXorDecrypt(encryptedPassphrase, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(passphrase, v2Key);
      await SecureStore.setItemAsync(
        `${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`${STORAGE_KEYS.ACCOUNT_PASSPHRASE_PREFIX}${accountId}`);

      return passphrase;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store account metadata (non-sensitive)
   * @param accountId - Account identifier
   * @param metadata - Account metadata object
   */
  static async storeAccountMetadata(accountId: number, metadata: object): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.ACCOUNT_METADATA_PREFIX}${accountId}`,
      JSON.stringify(metadata)
    );
  }

  /**
   * Get account metadata
   * @param accountId - Account identifier
   * @returns Account metadata or null
   */
  static async getAccountMetadata<T>(accountId: number): Promise<T | null> {
    const data = await SecureStore.getItemAsync(`${STORAGE_KEYS.ACCOUNT_METADATA_PREFIX}${accountId}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  // ============================================
  // WATCH-ONLY WALLET STORAGE
  // ============================================

  /**
   * Store extended public keys for a watch-only account
   * @param accountId - Account identifier
   * @param xpubs - Object containing xpubs by address type
   */
  static async storeWatchOnlyXpubs(accountId: number, xpubs: Record<string, string>): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.WATCH_XPUBS_PREFIX}${accountId}`,
      JSON.stringify(xpubs)
    );
  }

  /**
   * Get extended public keys for a watch-only account
   * @param accountId - Account identifier
   * @returns Object containing xpubs or null
   */
  static async getWatchOnlyXpubs(accountId: number): Promise<Record<string, string> | null> {
    const data = await SecureStore.getItemAsync(`${STORAGE_KEYS.WATCH_XPUBS_PREFIX}${accountId}`);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Store output descriptor for a watch-only account
   * @param accountId - Account identifier
   * @param descriptor - Output descriptor string
   */
  static async storeWatchOnlyDescriptor(accountId: number, descriptor: string): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.WATCH_DESCRIPTOR_PREFIX}${accountId}`,
      descriptor
    );
  }

  /**
   * Get output descriptor for a watch-only account
   * @param accountId - Account identifier
   * @returns Output descriptor or null
   */
  static async getWatchOnlyDescriptor(accountId: number): Promise<string | null> {
    return SecureStore.getItemAsync(`${STORAGE_KEYS.WATCH_DESCRIPTOR_PREFIX}${accountId}`);
  }

  /**
   * Store watch addresses for address-only watch account
   * @param accountId - Account identifier
   * @param addresses - Array of addresses to watch
   */
  static async storeWatchAddresses(accountId: number, addresses: string[]): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.WATCH_ADDRESSES_PREFIX}${accountId}`,
      JSON.stringify(addresses)
    );
  }

  /**
   * Get watch addresses for address-only watch account
   * @param accountId - Account identifier
   * @returns Array of addresses or null
   */
  static async getWatchAddresses(accountId: number): Promise<string[] | null> {
    const data = await SecureStore.getItemAsync(`${STORAGE_KEYS.WATCH_ADDRESSES_PREFIX}${accountId}`);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ============================================
  // MULTISIG WALLET STORAGE
  // ============================================

  /**
   * Store encrypted multisig descriptor (primary wallet)
   * @param descriptor - The multisig descriptor to store
   * @param pin - User's PIN for encryption
   */
  static async storeMultisigDescriptor(descriptor: string, pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(STORAGE_KEYS.ENCRYPTION_SALT, salt, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    const key = this.deriveKey(pin, salt);
    const encryptedDescriptor = this.encrypt(descriptor, key);

    await SecureStore.setItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR, encryptedDescriptor, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await this.setEncryptionVersionV2(STORAGE_KEYS.MULTISIG_DESCRIPTOR);

    const existingPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);
    if (!existingPinHash) {
      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );
      await SecureStore.setItemAsync(STORAGE_KEYS.PIN_HASH, pinHash, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  }

  /**
   * Retrieve and decrypt multisig descriptor
   * @param pin - User's PIN
   * @returns Decrypted descriptor or null if PIN is wrong
   */
  static async retrieveMultisigDescriptor(pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(STORAGE_KEYS.ENCRYPTION_SALT);
      const encryptedDescriptor = await SecureStore.getItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR);
      const storedPinHash = await SecureStore.getItemAsync(STORAGE_KEYS.PIN_HASH);

      if (!salt || !encryptedDescriptor || !storedPinHash) return null;

      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${pin}:${salt}`
      );
      if (pinHash !== storedPinHash) return null;

      if (encryptedDescriptor.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedDescriptor, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR, result.reEncrypted, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const descriptor = this._legacyXorDecrypt(encryptedDescriptor, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(descriptor, v2Key);
      await SecureStore.setItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR, reEncrypted, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await this.setEncryptionVersionV2(STORAGE_KEYS.MULTISIG_DESCRIPTOR);

      return descriptor;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a multisig wallet exists
   * @returns Whether a multisig descriptor is stored
   */
  static async hasMultisigWallet(): Promise<boolean> {
    const descriptor = await SecureStore.getItemAsync(STORAGE_KEYS.MULTISIG_DESCRIPTOR);
    return descriptor !== null;
  }

  /**
   * Store multisig configuration for an account
   * @param accountId - Account identifier
   * @param config - Multisig configuration object
   */
  static async storeMultisigConfig(accountId: number, config: object): Promise<void> {
    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.MULTISIG_CONFIG_PREFIX}${accountId}`,
      JSON.stringify(config)
    );
  }

  /**
   * Get multisig configuration for an account
   * @param accountId - Account identifier
   * @returns Multisig configuration or null
   */
  static async getMultisigConfig<T>(accountId: number): Promise<T | null> {
    const data = await SecureStore.getItemAsync(`${STORAGE_KEYS.MULTISIG_CONFIG_PREFIX}${accountId}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  // ============================================
  // LOCAL COSIGNER SEED STORAGE (for multisig)
  // ============================================

  /**
   * Store seed phrase for a local cosigner in a multisig wallet
   * @param cosignerIndex - Index of the local cosigner (0-based)
   * @param mnemonic - The seed phrase to store
   * @param pin - User's PIN for encryption
   */
  static async storeLocalCosignerSeed(cosignerIndex: number, mnemonic: string, pin: string): Promise<void> {
    const salt = await this.generateSalt();
    const key = this.deriveKey(pin, salt);
    const encryptedSeed = this.encrypt(mnemonic, key);

    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.LOCAL_COSIGNER_SALT_PREFIX}${cosignerIndex}`,
      salt,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );

    await SecureStore.setItemAsync(
      `${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`,
      encryptedSeed,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`);
  }

  /**
   * Retrieve seed phrase for a local cosigner
   * @param cosignerIndex - Index of the local cosigner
   * @param pin - User's PIN
   * @returns Decrypted mnemonic or null
   */
  static async retrieveLocalCosignerSeed(cosignerIndex: number, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SALT_PREFIX}${cosignerIndex}`);
      const encryptedSeed = await SecureStore.getItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`);

      if (!salt || !encryptedSeed) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedSeed.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedSeed, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const mnemonic = this._legacyXorDecrypt(encryptedSeed, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(mnemonic, v2Key);
      await SecureStore.setItemAsync(
        `${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`);

      return mnemonic;
    } catch (error) {
      return null;
    }
  }

  /**
   * Retrieve all local cosigner seeds
   * @param pin - User's PIN
   * @returns Array of {index, seed} for all stored local cosigner seeds
   */
  static async retrieveAllLocalCosignerSeeds(pin: string): Promise<{ index: number; seed: string }[]> {
    // Parallel retrieval: try all 15 indices concurrently instead of sequentially
    // This dramatically reduces wait time from 15 × ~100ms → ~100ms total
    const promises = Array.from({ length: 15 }, (_, i) =>
      this.retrieveLocalCosignerSeed(i, pin)
        .then(seed => seed ? { index: i, seed } : null)
        .catch(() => null)
    );

    const settled = await Promise.all(promises);
    return settled.filter((r): r is { index: number; seed: string } => r !== null);
  }

  /**
   * Clear all local cosigner seeds (called on wallet deletion)
   */
  static async clearLocalCosignerSeeds(): Promise<void> {
    const deletes: Promise<void>[] = [];
    for (let i = 0; i < 15; i++) {
      deletes.push(SecureStore.deleteItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${i}`));
      deletes.push(SecureStore.deleteItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SALT_PREFIX}${i}`));
    }
    await Promise.allSettled(deletes);
  }

  /**
   * Delete a specific local cosigner's seed (convert to watch-only)
   * @param cosignerIndex - Index of the local cosigner
   */
  static async deleteLocalCosignerSeed(cosignerIndex: number): Promise<void> {
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`);
    await SecureStore.deleteItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SALT_PREFIX}${cosignerIndex}`);
  }

  /**
   * Check if a local cosigner seed exists
   * @param cosignerIndex - Index of the local cosigner
   * @returns Whether a seed is stored for this cosigner
   */
  static async hasLocalCosignerSeed(cosignerIndex: number): Promise<boolean> {
    const seed = await SecureStore.getItemAsync(`${STORAGE_KEYS.LOCAL_COSIGNER_SEED_PREFIX}${cosignerIndex}`);
    return seed !== null;
  }

  // ============================================
  // ACCOUNTS LIST MANAGEMENT
  // ============================================

  /**
   * Get list of all account IDs
   * @returns Array of account IDs
   */
  static async getAccountsList(): Promise<number[]> {
    const data = await SecureStore.getItemAsync(STORAGE_KEYS.ACCOUNTS_LIST);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Add account ID to the accounts list
   * @param accountId - Account identifier to add
   */
  static async addToAccountsList(accountId: number): Promise<void> {
    const accounts = await this.getAccountsList();
    if (!accounts.includes(accountId)) {
      accounts.push(accountId);
      await SecureStore.setItemAsync(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(accounts));
    }
  }

  /**
   * Remove account ID from the accounts list
   * @param accountId - Account identifier to remove
   */
  static async removeFromAccountsList(accountId: number): Promise<void> {
    const accounts = await this.getAccountsList();
    const filtered = accounts.filter(id => id !== accountId);
    await SecureStore.setItemAsync(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(filtered));
  }

  /**
   * Get current account ID
   * @returns Current account ID or 0 (default)
   */
  static async getCurrentAccountId(): Promise<number> {
    const data = await SecureStore.getItemAsync(STORAGE_KEYS.CURRENT_ACCOUNT);
    if (!data) return 0;
    try {
      return parseInt(data, 10);
    } catch {
      return 0;
    }
  }

  /**
   * Set current account ID
   * @param accountId - Account identifier to set as current
   */
  static async setCurrentAccountId(accountId: number): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.CURRENT_ACCOUNT, accountId.toString());
  }

  /**
   * Get next available account ID
   * @returns Next available account ID
   */
  static async getNextAccountId(): Promise<number> {
    const accounts = await this.getAccountsList();
    if (accounts.length === 0) return 0;
    return Math.max(...accounts) + 1;
  }

  // ============================================
  // BACKUP & RESTORE
  // ============================================

  /**
   * Export encrypted backup data
   * @param password - Password for backup encryption
   * @returns Encrypted backup string
   */
  static async exportEncryptedBackup(password: string): Promise<string> {
    const accounts = await this.getAccountsList();
    const backupData: any = {
      version: 1,
      createdAt: Date.now(),
      accounts: [],
    };

    // Export each account's data
    for (const accountId of accounts) {
      const metadata = await this.getAccountMetadata(accountId);
      const xpubs = await this.getWatchOnlyXpubs(accountId);
      const descriptor = await this.getWatchOnlyDescriptor(accountId);
      const watchAddresses = await this.getWatchAddresses(accountId);
      const multisigConfig = await this.getMultisigConfig(accountId);

      backupData.accounts.push({
        id: accountId,
        metadata,
        xpubs,
        descriptor,
        watchAddresses,
        multisigConfig,
        // Note: Seeds are NOT included in standard backup - must be backed up separately
      });
    }

    // Encrypt the backup with AES-256-GCM using SHA-256-derived key
    const salt = await this.generateSalt();
    const key = this.deriveKey(password, salt);
    const encrypted = this.encrypt(JSON.stringify(backupData), key);

    return JSON.stringify({
      salt,
      data: encrypted,
      checksum: await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        encrypted
      ),
    });
  }

  /**
   * Import encrypted backup data
   * @param backupString - Encrypted backup string
   * @param password - Password for decryption
   * @returns Whether import was successful
   */
  static async importEncryptedBackup(backupString: string, password: string): Promise<boolean> {
    try {
      const backup = JSON.parse(backupString);
      const { salt, data, checksum } = backup;

      // Verify checksum
      const computedChecksum = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        data
      );
      if (computedChecksum !== checksum) {
        throw new Error('Backup checksum mismatch');
      }

      // Decrypt (try SHA-256 key, then legacy XOR)
      let decrypted: string;
      if (data.startsWith('2:')) {
        const result = this.tryDecryptV2WithMigration(data, password, salt);
        if (!result) throw new Error('Decryption failed — wrong password');
        decrypted = result;
      } else {
        const legacyKey = await this._legacyDeriveKey(password, salt);
        decrypted = this._legacyXorDecrypt(data, legacyKey);
      }
      const backupData = JSON.parse(decrypted);

      // Restore each account
      for (const account of backupData.accounts) {
        if (account.metadata) {
          await this.storeAccountMetadata(account.id, account.metadata);
        }
        if (account.xpubs) {
          await this.storeWatchOnlyXpubs(account.id, account.xpubs);
        }
        if (account.descriptor) {
          await this.storeWatchOnlyDescriptor(account.id, account.descriptor);
        }
        if (account.watchAddresses) {
          await this.storeWatchAddresses(account.id, account.watchAddresses);
        }
        if (account.multisigConfig) {
          await this.storeMultisigConfig(account.id, account.multisigConfig);
        }
        await this.addToAccountsList(account.id);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Export seed phrase backup (encrypted with separate password)
   * @param accountId - Account identifier
   * @param pin - User's PIN to retrieve seed
   * @param backupPassword - Password to encrypt the backup
   * @returns Encrypted seed backup string or null
   */
  static async exportSeedBackup(accountId: number, pin: string, backupPassword: string): Promise<string | null> {
    // First try account-specific seed
    let seed = await this.retrieveAccountSeed(accountId, pin);

    // Fall back to legacy single-wallet seed for account 0
    if (!seed && accountId === 0) {
      seed = await this.retrieveSeed(pin);
    }

    if (!seed) {
      return null;
    }

    // Also get passphrase if exists
    const passphrase = await this.retrieveAccountPassphrase(accountId, pin);

    const seedData = {
      seed,
      passphrase,
      accountId,
      exportedAt: Date.now(),
    };

    const salt = await this.generateSalt();
    const key = this.deriveKey(backupPassword, salt);
    const encrypted = this.encrypt(JSON.stringify(seedData), key);

    return JSON.stringify({
      type: 'seed_backup',
      version: 2,
      salt,
      data: encrypted,
      checksum: await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        encrypted
      ),
    });
  }

  /**
   * Import seed phrase from backup
   * @param backupString - Encrypted seed backup string
   * @param backupPassword - Password to decrypt the backup
   * @param pin - User's PIN to store the seed
   * @returns Whether import was successful
   */
  static async importSeedBackup(backupString: string, backupPassword: string, pin: string): Promise<{ success: boolean; accountId?: number; error?: string }> {
    try {
      const backup = JSON.parse(backupString);

      if (backup.type !== 'seed_backup') {
        return { success: false, error: 'Invalid backup type' };
      }

      const { salt, data, checksum } = backup;

      // Verify checksum
      const computedChecksum = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        data
      );
      if (computedChecksum !== checksum) {
        return { success: false, error: 'Backup checksum mismatch' };
      }

      // Decrypt (try SHA-256 key, then legacy XOR)
      let decrypted: string;
      if (data.startsWith('2:')) {
        const result = this.tryDecryptV2WithMigration(data, backupPassword, salt);
        if (!result) throw new Error('Decryption failed — wrong password');
        decrypted = result;
      } else {
        const legacyKey = await this._legacyDeriveKey(backupPassword, salt);
        decrypted = this._legacyXorDecrypt(data, legacyKey);
      }
      const seedData = JSON.parse(decrypted);

      // Store the seed
      const accountId = await this.getNextAccountId();
      await this.storeAccountSeed(accountId, seedData.seed, pin);

      if (seedData.passphrase) {
        await this.storeAccountPassphrase(accountId, seedData.passphrase, pin);
      }

      await this.addToAccountsList(accountId);

      return { success: true, accountId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================
  // MULTI-WALLET STORAGE (String-based wallet IDs)
  // ============================================

  /**
   * Store seed for a specific wallet (using string wallet ID)
   * @param walletId - Wallet identifier (e.g., "hd-1234567890")
   * @param mnemonic - The seed phrase to store
   * @param pin - User's PIN for encryption
   * @param passphrase - Optional BIP39 passphrase
   */
  static async storeWalletSeed(walletId: string, mnemonic: string, pin: string, passphrase: string = ''): Promise<void> {
    const salt = await this.generateSalt();
    const key = this.deriveKey(pin, salt);
    const encryptedSeed = this.encrypt(mnemonic, key);

    await SecureStore.setItemAsync(
      `wallet_salt_${walletId}`,
      salt,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );

    await SecureStore.setItemAsync(
      `wallet_seed_${walletId}`,
      encryptedSeed,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_seed_${walletId}`);

    if (passphrase) {
      const encryptedPassphrase = this.encrypt(passphrase, key);
      await SecureStore.setItemAsync(
        `wallet_passphrase_${walletId}`,
        encryptedPassphrase,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_passphrase_${walletId}`);
    }
  }

  /**
   * Retrieve seed for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted mnemonic or null
   */
  static async retrieveWalletSeed(walletId: string, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedSeed = await SecureStore.getItemAsync(`wallet_seed_${walletId}`);

      if (!salt || !encryptedSeed) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedSeed.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedSeed, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `wallet_seed_${walletId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
          // Also migrate passphrase if exists
          const encryptedPassphrase = await SecureStore.getItemAsync(`wallet_passphrase_${walletId}`);
          if (encryptedPassphrase?.startsWith('2:')) {
            const ppResult = this.tryDecryptV2AndReEncrypt(encryptedPassphrase, pin, salt);
            if (ppResult?.needsReEncrypt && ppResult.reEncrypted) {
              await SecureStore.setItemAsync(
                `wallet_passphrase_${walletId}`,
                ppResult.reEncrypted,
                { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
              );
            }
          }
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const mnemonic = this._legacyXorDecrypt(encryptedSeed, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(mnemonic, v2Key);
      await SecureStore.setItemAsync(
        `wallet_seed_${walletId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_seed_${walletId}`);

      // Also migrate passphrase if exists
      const encryptedPassphrase = await SecureStore.getItemAsync(`wallet_passphrase_${walletId}`);
      if (encryptedPassphrase && !encryptedPassphrase.startsWith('2:')) {
        const passphrase = this._legacyXorDecrypt(encryptedPassphrase, legacyKey);
        const reEncryptedPassphrase = this.encrypt(passphrase, v2Key);
        await SecureStore.setItemAsync(
          `wallet_passphrase_${walletId}`,
          reEncryptedPassphrase,
          { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
        );
        await this.setEncryptionVersionV2(`wallet_passphrase_${walletId}`);
      }

      return mnemonic;
    } catch (error) {
      return null;
    }
  }

  /**
   * Retrieve passphrase for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted passphrase or empty string
   */
  static async retrieveWalletPassphrase(walletId: string, pin: string): Promise<string> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedPassphrase = await SecureStore.getItemAsync(`wallet_passphrase_${walletId}`);

      if (!salt || !encryptedPassphrase) return '';

      const isValid = await this.verifyPin(pin);
      if (!isValid) return '';

      if (encryptedPassphrase.startsWith('2:')) {
        const result = this.tryDecryptV2WithMigration(encryptedPassphrase, pin, salt);
        return result ?? '';
      }
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      return this._legacyXorDecrypt(encryptedPassphrase, legacyKey);
    } catch (error) {
      return '';
    }
  }

  /**
   * Check if a specific wallet has a seed stored
   * @param walletId - Wallet identifier
   * @returns Whether the wallet has a seed
   */
  static async hasWalletSeed(walletId: string): Promise<boolean> {
    const seed = await SecureStore.getItemAsync(`wallet_seed_${walletId}`);
    return seed !== null;
  }

  /**
   * Delete all data for a specific wallet
   * @param walletId - Wallet identifier
   */
  static async deleteWalletData(walletId: string): Promise<void> {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(`wallet_seed_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_salt_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_passphrase_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_metadata_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_descriptor_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_privkey_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_xprv_${walletId}`),
      SecureStore.deleteItemAsync(`wallet_seedhex_${walletId}`),
    ]);
  }

  /**
   * Store multisig descriptor for a specific wallet
   * @param walletId - Wallet identifier
   * @param descriptor - The multisig descriptor
   * @param pin - User's PIN for encryption
   */
  static async storeWalletDescriptor(walletId: string, descriptor: string, pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encryptedDescriptor = this.encrypt(descriptor, key);

    await SecureStore.setItemAsync(
      `wallet_descriptor_${walletId}`,
      encryptedDescriptor,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_descriptor_${walletId}`);
  }

  /**
   * Retrieve multisig descriptor for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted descriptor or null
   */
  static async retrieveWalletDescriptor(walletId: string, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedDescriptor = await SecureStore.getItemAsync(`wallet_descriptor_${walletId}`);

      if (!salt || !encryptedDescriptor) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedDescriptor.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedDescriptor, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `wallet_descriptor_${walletId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const descriptor = this._legacyXorDecrypt(encryptedDescriptor, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(descriptor, v2Key);
      await SecureStore.setItemAsync(
        `wallet_descriptor_${walletId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_descriptor_${walletId}`);

      return descriptor;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store an imported private key (WIF) for a specific wallet
   * @param walletId - Wallet identifier
   * @param wif - WIF-encoded private key
   * @param pin - User's PIN for encryption
   */
  static async storeWalletPrivateKey(walletId: string, wif: string, pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encryptedKey = this.encrypt(wif, key);

    await SecureStore.setItemAsync(
      `wallet_privkey_${walletId}`,
      encryptedKey,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_privkey_${walletId}`);
  }

  /**
   * Retrieve an imported private key (WIF) for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted WIF or null
   */
  static async retrieveWalletPrivateKey(walletId: string, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedKey = await SecureStore.getItemAsync(`wallet_privkey_${walletId}`);

      if (!salt || !encryptedKey) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedKey.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedKey, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `wallet_privkey_${walletId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      // Legacy XOR format
      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const wif = this._legacyXorDecrypt(encryptedKey, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(wif, v2Key);
      await SecureStore.setItemAsync(
        `wallet_privkey_${walletId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_privkey_${walletId}`);

      return wif;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a specific wallet has a private key stored
   * @param walletId - Wallet identifier
   * @returns Whether the wallet has a private key
   */
  static async hasWalletPrivateKey(walletId: string): Promise<boolean> {
    const key = await SecureStore.getItemAsync(`wallet_privkey_${walletId}`);
    return key !== null;
  }

  /**
   * Store an extended private key (xprv) for a specific wallet
   * @param walletId - Wallet identifier
   * @param xprv - Base58-encoded extended private key
   * @param pin - User's PIN for encryption
   */
  static async storeWalletXprv(walletId: string, xprv: string, pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encryptedXprv = this.encrypt(xprv, key);

    await SecureStore.setItemAsync(
      `wallet_xprv_${walletId}`,
      encryptedXprv,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_xprv_${walletId}`);
  }

  /**
   * Retrieve an extended private key (xprv) for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted xprv or null
   */
  static async retrieveWalletXprv(walletId: string, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedXprv = await SecureStore.getItemAsync(`wallet_xprv_${walletId}`);

      if (!salt || !encryptedXprv) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedXprv.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedXprv, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `wallet_xprv_${walletId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const xprv = this._legacyXorDecrypt(encryptedXprv, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(xprv, v2Key);
      await SecureStore.setItemAsync(
        `wallet_xprv_${walletId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_xprv_${walletId}`);

      return xprv;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store raw seed bytes (hex) for a specific wallet
   * @param walletId - Wallet identifier
   * @param seedHex - Hex-encoded seed bytes
   * @param pin - User's PIN for encryption
   */
  static async storeWalletSeedHex(walletId: string, seedHex: string, pin: string): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encryptedSeedHex = this.encrypt(seedHex, key);

    await SecureStore.setItemAsync(
      `wallet_seedhex_${walletId}`,
      encryptedSeedHex,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_seedhex_${walletId}`);
  }

  /**
   * Retrieve raw seed bytes (hex) for a specific wallet
   * @param walletId - Wallet identifier
   * @param pin - User's PIN
   * @returns Decrypted seed hex or null
   */
  static async retrieveWalletSeedHex(walletId: string, pin: string): Promise<string | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encryptedSeedHex = await SecureStore.getItemAsync(`wallet_seedhex_${walletId}`);

      if (!salt || !encryptedSeedHex) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encryptedSeedHex.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encryptedSeedHex, pin, salt);
        if (!result) return null;
        if (result.needsReEncrypt && result.reEncrypted) {
          await SecureStore.setItemAsync(
            `wallet_seedhex_${walletId}`,
            result.reEncrypted,
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
          );
        }
        return result.decrypted;
      }

      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const seedHex = this._legacyXorDecrypt(encryptedSeedHex, legacyKey);

      const v2Key = this.deriveKey(pin, salt);
      const reEncrypted = this.encrypt(seedHex, v2Key);
      await SecureStore.setItemAsync(
        `wallet_seedhex_${walletId}`,
        reEncrypted,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
      await this.setEncryptionVersionV2(`wallet_seedhex_${walletId}`);

      return seedHex;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store metadata for a specific wallet
   * @param walletId - Wallet identifier
   * @param metadata - Wallet metadata object
   */
  static async storeWalletMetadataById(walletId: string, metadata: object): Promise<void> {
    await SecureStore.setItemAsync(
      `wallet_metadata_${walletId}`,
      JSON.stringify(metadata)
    );
  }

  /**
   * Get metadata for a specific wallet
   * @param walletId - Wallet identifier
   * @returns Wallet metadata or null
   */
  static async getWalletMetadataById<T>(walletId: string): Promise<T | null> {
    const data = await SecureStore.getItemAsync(`wallet_metadata_${walletId}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  // ============================================
  // IMPORTED KEY STORAGE (for backup/restore)
  // ============================================

  /**
   * Store imported WIF key data for backup
   */
  static async storeImportedKeyWIF(
    walletId: string,
    data: { wif: string; compressed: boolean; scriptType: string },
    pin: string
  ): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encrypted = this.encrypt(JSON.stringify(data), key);

    await SecureStore.setItemAsync(
      `wallet_wif_${walletId}`,
      encrypted,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_wif_${walletId}`);
  }

  /**
   * Retrieve imported WIF key data for backup
   */
  static async getImportedKeyWIF(
    walletId: string,
    pin: string
  ): Promise<{ wif: string; compressed: boolean; scriptType: string } | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encrypted = await SecureStore.getItemAsync(`wallet_wif_${walletId}`);

      if (!salt || !encrypted) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encrypted.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encrypted, pin, salt);
        if (!result) return null;
        return JSON.parse(result.decrypted);
      }

      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const decrypted = this._legacyXorDecrypt(encrypted, legacyKey);
      return JSON.parse(decrypted);
    } catch (error) {
      return null;
    }
  }

  /**
   * Store imported xprv data for backup
   */
  static async storeImportedXprv(
    walletId: string,
    data: { xprv: string; scriptType: string; derivationConfig?: any },
    pin: string
  ): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encrypted = this.encrypt(JSON.stringify(data), key);

    await SecureStore.setItemAsync(
      `wallet_xprv_data_${walletId}`,
      encrypted,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_xprv_data_${walletId}`);
  }

  /**
   * Retrieve imported xprv data for backup
   */
  static async getImportedXprv(
    walletId: string,
    pin: string
  ): Promise<{ xprv: string; scriptType: string; derivationConfig?: any } | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encrypted = await SecureStore.getItemAsync(`wallet_xprv_data_${walletId}`);

      if (!salt || !encrypted) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encrypted.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encrypted, pin, salt);
        if (!result) return null;
        return JSON.parse(result.decrypted);
      }

      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const decrypted = this._legacyXorDecrypt(encrypted, legacyKey);
      return JSON.parse(decrypted);
    } catch (error) {
      return null;
    }
  }

  /**
   * Store imported seed hex data for backup
   */
  static async storeImportedSeedHex(
    walletId: string,
    data: { seedHex: string; scriptType: string; derivationConfig?: any },
    pin: string
  ): Promise<void> {
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      salt = await this.generateSalt();
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    const key = this.deriveKey(pin, salt);
    const encrypted = this.encrypt(JSON.stringify(data), key);

    await SecureStore.setItemAsync(
      `wallet_seed_data_${walletId}`,
      encrypted,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await this.setEncryptionVersionV2(`wallet_seed_data_${walletId}`);
  }

  /**
   * Retrieve imported seed hex data for backup
   */
  static async getImportedSeedHex(
    walletId: string,
    pin: string
  ): Promise<{ seedHex: string; scriptType: string; derivationConfig?: any } | null> {
    try {
      const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
      const encrypted = await SecureStore.getItemAsync(`wallet_seed_data_${walletId}`);

      if (!salt || !encrypted) return null;

      const isValid = await this.verifyPin(pin);
      if (!isValid) return null;

      if (encrypted.startsWith('2:')) {
        const result = this.tryDecryptV2AndReEncrypt(encrypted, pin, salt);
        if (!result) return null;
        return JSON.parse(result.decrypted);
      }

      const legacyKey = await this._legacyDeriveKey(pin, salt);
      const decrypted = this._legacyXorDecrypt(encrypted, legacyKey);
      return JSON.parse(decrypted);
    } catch (error) {
      return null;
    }
  }
}
