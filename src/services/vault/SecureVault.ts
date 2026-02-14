/**
 * SecureVault - Centralized Secret Management
 *
 * A high-level abstraction over SecureStorage for managing wallet secrets.
 * Provides a unified API for storing, retrieving, and managing secrets
 * across all wallet types.
 *
 * Key Features:
 * - Automatic key generation per wallet
 * - Type-safe secret storage
 * - Metadata tracking without decryption
 * - Clean delete for all wallet secrets
 */

import * as SecureStore from 'expo-secure-store';
import { SecureStorage } from '../storage/SecureStorage';
import type { SecretType, SecretMetadata } from '../../types/canonical';

// Storage key prefixes for different secret types
const SECRET_KEY_PREFIX: Record<SecretType, string> = {
  mnemonic: 'wallet_seed',
  passphrase: 'wallet_passphrase',
  xprv: 'wallet_xprv',
  seed_hex: 'wallet_seedhex',
  wif: 'wallet_privkey',
  wif_set: 'wallet_privkeys',
  descriptor: 'wallet_descriptor',
  cosigner_mnemonic: 'wallet_cosigner',
};

/**
 * SecureVault provides a clean abstraction over SecureStorage
 * for managing wallet secrets with type safety.
 */
export class SecureVault {
  // ============================================
  // STORE METHODS
  // ============================================

  /**
   * Store a secret for a wallet.
   *
   * @param walletId - The wallet ID
   * @param secret - The secret to store (string or array for wif_set)
   * @param type - Type of secret
   * @param pin - User's PIN for encryption
   * @param metadata - Optional metadata (e.g., passphrase)
   * @returns The secret ID (key used for storage)
   */
  static async store(
    walletId: string,
    secret: string | string[],
    type: SecretType,
    pin: string,
    metadata?: { passphrase?: string; hasPassphrase?: boolean }
  ): Promise<string> {
    const secretId = this.getSecretKey(walletId, type);

    switch (type) {
      case 'mnemonic':
        await SecureStorage.storeWalletSeed(
          walletId,
          secret as string,
          pin,
          metadata?.passphrase || ''
        );
        // Store hasPassphrase metadata if provided
        if (metadata?.hasPassphrase) {
          await this.storeMetadata(walletId, type, { hasPassphrase: true });
        }
        break;

      case 'passphrase':
        // Store passphrase alongside mnemonic
        // SecureStorage handles this internally via storeWalletSeed
        // For direct passphrase storage, we use the wallet metadata system
        await this.storeRawSecret(walletId, 'passphrase', secret as string, pin);
        break;

      case 'xprv':
        await SecureStorage.storeWalletXprv(walletId, secret as string, pin);
        break;

      case 'seed_hex':
        await SecureStorage.storeWalletSeedHex(walletId, secret as string, pin);
        break;

      case 'wif':
        await SecureStorage.storeWalletPrivateKey(walletId, secret as string, pin);
        break;

      case 'wif_set':
        // Store as JSON array
        const wifArray = Array.isArray(secret) ? secret : [secret];
        await this.storeRawSecret(walletId, 'privkeys', JSON.stringify(wifArray), pin);
        break;

      case 'descriptor':
        await SecureStorage.storeWalletDescriptor(walletId, secret as string, pin);
        break;

      case 'cosigner_mnemonic':
        // Store as part of cosigner seeds - uses index 0 by default
        await this.storeRawSecret(walletId, 'cosigner_0', secret as string, pin);
        break;

      default: {
        // Exhaustive check — TypeScript will error if a new SecretType is added without handling
        const _exhaustive: never = type;
        throw new Error(`Unknown secret type: ${_exhaustive}`);
      }
    }

    return secretId;
  }

  /**
   * Store a cosigner seed with specific index.
   */
  static async storeCosignerSeed(
    walletId: string,
    index: number,
    mnemonic: string,
    pin: string
  ): Promise<string> {
    await this.storeRawSecret(walletId, `cosigner_${index}`, mnemonic, pin);
    return `${walletId}_cosigner_${index}`;
  }

  // ============================================
  // RETRIEVE METHODS
  // ============================================

  /**
   * Retrieve a secret for a wallet.
   *
   * @param walletId - The wallet ID
   * @param type - Type of secret to retrieve
   * @param pin - User's PIN for decryption
   * @returns The decrypted secret, or null if not found
   */
  static async retrieve(
    walletId: string,
    type: SecretType,
    pin: string
  ): Promise<string | string[] | null> {
    switch (type) {
      case 'mnemonic':
        return SecureStorage.retrieveWalletSeed(walletId, pin);

      case 'passphrase':
        return SecureStorage.retrieveWalletPassphrase(walletId, pin);

      case 'xprv':
        return SecureStorage.retrieveWalletXprv(walletId, pin);

      case 'seed_hex':
        return SecureStorage.retrieveWalletSeedHex(walletId, pin);

      case 'wif':
        return SecureStorage.retrieveWalletPrivateKey(walletId, pin);

      case 'wif_set':
        const rawKeys = await this.retrieveRawSecret(walletId, 'privkeys', pin);
        if (!rawKeys) return null;
        try {
          return JSON.parse(rawKeys);
        } catch {
          return [rawKeys]; // Fallback: treat as single key
        }

      case 'descriptor':
        return SecureStorage.retrieveWalletDescriptor(walletId, pin);

      case 'cosigner_mnemonic':
        return this.retrieveRawSecret(walletId, 'cosigner_0', pin);

      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown secret type: ${_exhaustive}`);
      }
    }
  }

  /**
   * Retrieve a cosigner seed with specific index.
   */
  static async retrieveCosignerSeed(
    walletId: string,
    index: number,
    pin: string
  ): Promise<string | null> {
    return this.retrieveRawSecret(walletId, `cosigner_${index}`, pin);
  }

  // ============================================
  // DELETE METHODS
  // ============================================

  /**
   * Delete all secrets for a wallet.
   *
   * @param walletId - The wallet ID
   */
  static async delete(walletId: string): Promise<void> {
    await SecureStorage.deleteWalletData(walletId);
    // Also clean up any custom vault keys
    await this.deleteRawSecret(walletId, 'passphrase');
    await this.deleteRawSecret(walletId, 'privkeys');
    for (let i = 0; i < 15; i++) {
      await this.deleteRawSecret(walletId, `cosigner_${i}`);
    }
  }

  /**
   * Delete a specific secret type for a wallet.
   *
   * @param walletId - The wallet ID
   * @param type - Type of secret to delete
   */
  static async deleteSecret(walletId: string, type: SecretType): Promise<void> {
    const keyMap: Record<SecretType, string> = {
      mnemonic: `wallet_seed_${walletId}`,
      passphrase: `vault_passphrase_${walletId}`,
      xprv: `wallet_xprv_${walletId}`,
      seed_hex: `wallet_seedhex_${walletId}`,
      wif: `wallet_privkey_${walletId}`,
      wif_set: `vault_privkeys_${walletId}`,
      descriptor: `wallet_descriptor_${walletId}`,
      cosigner_mnemonic: `vault_cosigner_0_${walletId}`,
    };

    await SecureStore.deleteItemAsync(keyMap[type]);
  }

  // ============================================
  // CHECK METHODS
  // ============================================

  /**
   * Check if a secret exists for a wallet.
   *
   * @param walletId - The wallet ID
   * @param type - Type of secret to check
   * @returns True if the secret exists
   */
  static async has(walletId: string, type: SecretType): Promise<boolean> {
    switch (type) {
      case 'mnemonic':
        return SecureStorage.hasWalletSeed(walletId);

      case 'passphrase':
        return this.hasRawSecret(walletId, 'passphrase');

      case 'xprv':
        return this.hasRawSecret(walletId, 'xprv');

      case 'seed_hex':
        return this.hasRawSecret(walletId, 'seedhex');

      case 'wif':
        return SecureStorage.hasWalletPrivateKey(walletId);

      case 'wif_set':
        return this.hasRawSecret(walletId, 'privkeys');

      case 'descriptor':
        return this.hasRawSecret(walletId, 'descriptor');

      case 'cosigner_mnemonic':
        return this.hasRawSecret(walletId, 'cosigner_0');

      default: {
        const _exhaustive: never = type;
        console.warn(`[SecureVault] Unknown secret type in has(): ${_exhaustive}`);
        return false;
      }
    }
  }

  /**
   * Check which secret types exist for a wallet.
   *
   * @param walletId - The wallet ID
   * @returns Array of secret types that exist
   */
  static async getExistingSecretTypes(walletId: string): Promise<SecretType[]> {
    const types: SecretType[] = [
      'mnemonic',
      'passphrase',
      'xprv',
      'seed_hex',
      'wif',
      'wif_set',
      'descriptor',
      'cosigner_mnemonic',
    ];

    const existing: SecretType[] = [];

    for (const type of types) {
      if (await this.has(walletId, type)) {
        existing.push(type);
      }
    }

    return existing;
  }

  // ============================================
  // METADATA METHODS
  // ============================================

  /**
   * Get metadata about stored secrets (without decryption).
   *
   * @param walletId - The wallet ID
   * @returns Secret metadata or null
   */
  static async getMetadata(walletId: string): Promise<SecretMetadata | null> {
    const existingTypes = await this.getExistingSecretTypes(walletId);

    if (existingTypes.length === 0) {
      return null;
    }

    // Get the primary secret type (in order of priority)
    const primaryType = existingTypes.find(
      (t) =>
        t === 'mnemonic' ||
        t === 'xprv' ||
        t === 'seed_hex' ||
        t === 'wif' ||
        t === 'descriptor'
    ) || existingTypes[0];

    const hasPassphrase = existingTypes.includes('passphrase');

    return {
      walletId,
      type: primaryType,
      storedAt: Date.now(), // We don't track creation time yet
      hasPassphrase,
    };
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Get the storage key for a secret type.
   */
  private static getSecretKey(walletId: string, type: SecretType): string {
    return `${SECRET_KEY_PREFIX[type]}_${walletId}`;
  }

  /**
   * Store a raw secret using vault-specific keys.
   * Used for secret types not directly supported by SecureStorage.
   */
  private static async storeRawSecret(
    walletId: string,
    suffix: string,
    value: string,
    pin: string
  ): Promise<void> {
    // For vault-specific secrets, we use a simple encryption approach
    // The actual encryption is handled by SecureStorage methods
    const key = `vault_${suffix}_${walletId}`;

    // Get or create salt (CSPRNG)
    let salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) {
      const randomBytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(randomBytes);
      salt = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await SecureStore.setItemAsync(
        `wallet_salt_${walletId}`,
        salt,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    }

    // AES-256-GCM encryption — Keychain provides the primary security layer
    const encrypted = this.aesEncrypt(value, pin, salt);

    await SecureStore.setItemAsync(
      key,
      encrypted,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
  }

  /**
   * Retrieve a raw secret using vault-specific keys.
   */
  private static async retrieveRawSecret(
    walletId: string,
    suffix: string,
    pin: string
  ): Promise<string | null> {
    const key = `vault_${suffix}_${walletId}`;
    const encrypted = await SecureStore.getItemAsync(key);

    if (!encrypted) return null;

    const salt = await SecureStore.getItemAsync(`wallet_salt_${walletId}`);
    if (!salt) return null;

    try {
      // Try AES-256-GCM first (new format)
      return this.aesDecrypt(encrypted, pin, salt);
    } catch {
      try {
        // Fall back to legacy XOR for existing data
        return this.legacyXorDecrypt(encrypted, pin, salt);
      } catch {
        return null;
      }
    }
  }

  /**
   * Delete a raw secret.
   */
  private static async deleteRawSecret(
    walletId: string,
    suffix: string
  ): Promise<void> {
    const key = `vault_${suffix}_${walletId}`;
    await SecureStore.deleteItemAsync(key);
  }

  /**
   * Check if a raw secret exists.
   */
  private static async hasRawSecret(
    walletId: string,
    suffix: string
  ): Promise<boolean> {
    // Check both vault-prefixed and wallet-prefixed keys
    const vaultKey = `vault_${suffix}_${walletId}`;
    const walletKey = `wallet_${suffix}_${walletId}`;

    const vaultValue = await SecureStore.getItemAsync(vaultKey);
    const walletValue = await SecureStore.getItemAsync(walletKey);

    return vaultValue !== null || walletValue !== null;
  }

  /**
   * AES-256-GCM encryption.
   * Derives a 256-bit key via SHA-256(pin + ":" + salt), then encrypts with a
   * random 12-byte IV.  Output: base64("gcm:" + iv_hex + ":" + ciphertext_hex + ":" + tag_hex)
   */
  private static aesEncrypt(data: string, pin: string, salt: string): string {
    const forge = require('node-forge');

    // Derive 256-bit key
    const md = forge.md.sha256.create();
    md.update(pin + ':' + salt, 'utf8');
    const keyBytes = md.digest().getBytes(); // 32 bytes

    // Random 12-byte IV
    const iv = forge.random.getBytesSync(12);

    const cipher = forge.cipher.createCipher('AES-GCM', keyBytes);
    cipher.start({ iv, tagLength: 128 });
    cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(data)));
    cipher.finish();

    const ivHex = forge.util.bytesToHex(iv);
    const ctHex = cipher.output.toHex();
    const tagHex = cipher.mode.tag.toHex();

    return Buffer.from(`gcm:${ivHex}:${ctHex}:${tagHex}`).toString('base64');
  }

  /**
   * AES-256-GCM decryption.
   */
  private static aesDecrypt(encrypted: string, pin: string, salt: string): string {
    const forge = require('node-forge');

    const raw = Buffer.from(encrypted, 'base64').toString('utf8');
    if (!raw.startsWith('gcm:')) throw new Error('Not AES-GCM format');

    const [, ivHex, ctHex, tagHex] = raw.split(':');

    // Derive same key
    const md = forge.md.sha256.create();
    md.update(pin + ':' + salt, 'utf8');
    const keyBytes = md.digest().getBytes();

    const decipher = forge.cipher.createDecipher('AES-GCM', keyBytes);
    decipher.start({
      iv: forge.util.hexToBytes(ivHex),
      tag: forge.util.createBuffer(forge.util.hexToBytes(tagHex)),
      tagLength: 128,
    });
    decipher.update(forge.util.createBuffer(forge.util.hexToBytes(ctHex)));
    const ok = decipher.finish();
    if (!ok) throw new Error('AES-GCM authentication failed');

    return forge.util.decodeUtf8(decipher.output.getBytes());
  }

  /**
   * Legacy XOR-based decryption (for backward compatibility with existing data).
   */
  private static legacyXorDecrypt(encrypted: string, pin: string, salt: string): string {
    const keyMaterial = `${pin}:${salt}`;
    const decoded = Buffer.from(encrypted, 'base64').toString();
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(
        decoded.charCodeAt(i) ^ keyMaterial.charCodeAt(i % keyMaterial.length)
      );
    }
    return result;
  }

  /**
   * Store metadata about a secret (without the secret itself).
   */
  private static async storeMetadata(
    walletId: string,
    type: SecretType,
    metadata: { hasPassphrase?: boolean }
  ): Promise<void> {
    const key = `vault_meta_${walletId}`;
    const existing = await SecureStore.getItemAsync(key);
    const data = existing ? JSON.parse(existing) : {};

    data[type] = {
      ...data[type],
      ...metadata,
      storedAt: Date.now(),
    };

    await SecureStore.setItemAsync(key, JSON.stringify(data));
  }
}

export default SecureVault;
