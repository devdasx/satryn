/**
 * WalletNormalizer - Canonical Wallet Creation
 *
 * Single entry point that converts ANY ImportResult/payload into a CanonicalWalletRecord.
 * This replaces scattered wallet creation logic across walletStore and WalletManager.
 *
 * MAINNET ONLY — Satryn does not support testnet.
 */

import * as Crypto from 'expo-crypto';
import { SecureVault } from '../vault';

/**
 * Generate a UUID v4 using expo-crypto for randomness.
 */
function generateUUID(): string {
  // Use timestamp + random for simplicity
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const timestamp = Date.now().toString(16).padStart(12, '0');
  const random = Math.random().toString(16).slice(2, 14);
  const hex = timestamp + random;

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32).padEnd(12, '0'),
  ].join('-');
}
import { ADDRESS_TYPES, AddressType } from '../../constants';
import type {
  CanonicalWalletType,
  CanonicalWalletRecord,
  CapabilityFlags,
  CanonicalScriptType,
  ImportPayload,
  DerivationConfig,
} from '../../types/canonical';
import {
  WALLET_TYPE_CAPABILITIES,
  getRecommendedBackupMethod,
  canExportPhrase,
  createEmptyAddressCache,
  createEmptyBalance,
  createInitialSyncState,
} from '../../types/canonical';
import type { ImportResult, DerivationPathConfig } from '../import/types';
import type { AddressInfo, MultisigConfig } from '../../types';

// ============================================
// TYPE MAPPING HELPERS
// ============================================

/**
 * Map ImportResult.type to CanonicalWalletType
 */
function mapImportTypeToCanonical(
  importResult: ImportResult
): CanonicalWalletType {
  const { type, sourceFormat, mnemonic, xprv, seed, xpub, descriptors } = importResult;

  // Watch-only types
  if (type === 'watch_only') {
    if (xpub) return 'watch_xpub';
    if (descriptors?.length) return 'watch_descriptor';
    return 'watch_addresses';
  }

  // Key set
  if (type === 'key_set') {
    return 'imported_keys';
  }

  // Single key
  if (type === 'single_key') {
    return 'imported_key';
  }

  // HD types (most common)
  if (type === 'hd') {
    // Electrum seed
    if (sourceFormat === 'electrum_seed') {
      return 'hd_electrum';
    }
    // Mnemonic phrase
    if (mnemonic) {
      return 'hd_mnemonic';
    }
    // Extended private key
    if (xprv && !mnemonic && !seed) {
      return 'hd_xprv';
    }
    // Raw seed bytes
    if (seed && !mnemonic) {
      return 'hd_seed';
    }
    // Descriptor with private key
    if (descriptors?.some(d => d.hasPrivateKey)) {
      return 'hd_descriptor';
    }
    // Default HD
    return 'hd_mnemonic';
  }

  // Fallback
  return 'hd_mnemonic';
}

/**
 * Map AddressType to CanonicalScriptType
 */
function mapAddressTypeToScriptType(addressType: AddressType): CanonicalScriptType {
  switch (addressType) {
    case ADDRESS_TYPES.LEGACY:
      return 'p2pkh';
    case ADDRESS_TYPES.WRAPPED_SEGWIT:
      return 'p2sh-p2wpkh';
    case ADDRESS_TYPES.NATIVE_SEGWIT:
      return 'p2wpkh';
    case ADDRESS_TYPES.TAPROOT:
      return 'p2tr';
    default:
      return 'p2wpkh';
  }
}

/**
 * Map SuggestedScriptType to CanonicalScriptType
 */
function mapSuggestedScriptType(
  suggested: 'native_segwit' | 'wrapped_segwit' | 'legacy' | 'taproot' | undefined
): CanonicalScriptType {
  switch (suggested) {
    case 'legacy':
      return 'p2pkh';
    case 'wrapped_segwit':
      return 'p2sh-p2wpkh';
    case 'taproot':
      return 'p2tr';
    case 'native_segwit':
    default:
      return 'p2wpkh';
  }
}

/**
 * Map DerivationPathConfig preset to canonical preset
 */
function mapDerivationPreset(
  preset: DerivationPathConfig['preset'] | undefined
): CanonicalWalletRecord['derivation']['preset'] {
  switch (preset) {
    case 'bip32':
      return 'custom';
    case 'bip44':
    case 'bip49':
    case 'bip84':
    case 'bip86':
      return preset;
    case 'custom':
      return 'custom';
    case 'hd':
    default:
      return 'hd';
  }
}

// ============================================
// WALLET NORMALIZER
// ============================================

/**
 * WalletNormalizer converts any import payload into a CanonicalWalletRecord.
 */
export class WalletNormalizer {
  /**
   * Main entry point: normalize any import result into a canonical wallet.
   *
   * @param payload - The import result to normalize
   * @param name - User-provided wallet name
   * @param pin - User's PIN for secret encryption
   * @param options - Additional options
   * @returns The normalized canonical wallet record
   */
  static async normalize(
    payload: ImportResult,
    name: string,
    pin: string,
    options?: {
      derivationConfig?: DerivationPathConfig;
      scriptType?: AddressType;
    }
  ): Promise<CanonicalWalletRecord> {
    const walletId = generateUUID();
    const canonicalType = mapImportTypeToCanonical(payload);
    const capabilities = this.getCapabilities(canonicalType);
    const now = Date.now();

    // Determine script type
    const scriptType: CanonicalScriptType = options?.scriptType
      ? mapAddressTypeToScriptType(options.scriptType)
      : mapSuggestedScriptType(payload.suggestedScriptType);

    // Store secrets in SecureVault
    await this.storeSecrets(walletId, payload, canonicalType, pin);

    // Build derivation config
    const derivationConfig = options?.derivationConfig || payload.derivationPathConfig;
    const derivation: CanonicalWalletRecord['derivation'] = {
      preset: mapDerivationPreset(derivationConfig?.preset),
      accountIndex: derivationConfig?.accountIndex ?? payload.suggestedAccountIndex ?? 0,
      customPath: derivationConfig?.customPath,
      scriptType,
    };

    // Build metadata
    const meta: CanonicalWalletRecord['meta'] = {
      fingerprint: payload.fingerprint,
      xpub: payload.xpub,
      sourceFormat: payload.sourceFormat,
      hasPassphrase: !!payload.passphrase,
    };

    // Add descriptor if available
    if (payload.descriptors?.length) {
      meta.descriptor = payload.descriptors[0].raw;
    }

    // Build backup info
    const backup: CanonicalWalletRecord['backup'] = {
      lastBackupAt: null,
      recommendedMethod: getRecommendedBackupMethod(canonicalType),
      canExportPhrase: canExportPhrase(canonicalType),
    };

    // Create the canonical record
    const record: CanonicalWalletRecord = {
      id: walletId,
      name: name || payload.suggestedName || 'Imported Wallet',
      type: canonicalType,
      createdAt: now,
      updatedAt: now,
      network: 'mainnet',
      secretId: capabilities.requiresPin ? walletId : null,
      derivation,
      capabilities,
      addressCache: createEmptyAddressCache(),
      sync: createInitialSyncState(),
      balance: createEmptyBalance(),
      meta,
      backup,
    };

    return record;
  }

  /**
   * Create a wallet from an ImportPayload (simplified format).
   */
  static async normalizeFromPayload(
    payload: ImportPayload,
    name: string,
    pin: string
  ): Promise<CanonicalWalletRecord> {
    const walletId = generateUUID();
    const canonicalType = payload.type;
    const capabilities = this.getCapabilities(canonicalType);
    const now = Date.now();

    // Store secrets
    await this.storeSecretsFromPayload(walletId, payload, pin);

    // Build derivation config
    const derivation: CanonicalWalletRecord['derivation'] = {
      preset: payload.derivationConfig?.preset || 'hd',
      accountIndex: payload.derivationConfig?.accountIndex ?? 0,
      customPath: payload.derivationConfig?.customPath,
      scriptType: payload.scriptType || 'p2wpkh',
    };

    // Create record
    const record: CanonicalWalletRecord = {
      id: walletId,
      name: name || 'Wallet',
      type: canonicalType,
      createdAt: now,
      updatedAt: now,
      network: 'mainnet',
      secretId: capabilities.requiresPin ? walletId : null,
      derivation,
      capabilities,
      addressCache: createEmptyAddressCache(),
      sync: createInitialSyncState(),
      balance: createEmptyBalance(),
      multisig: payload.multisigConfig,
      meta: {
        watchAddresses: payload.watchAddresses,
        hasPassphrase: !!payload.passphrase,
      },
      backup: {
        lastBackupAt: null,
        recommendedMethod: getRecommendedBackupMethod(canonicalType),
        canExportPhrase: canExportPhrase(canonicalType),
      },
    };

    return record;
  }

  /**
   * Determine the canonical wallet type from an import result.
   */
  static getCanonicalType(payload: ImportResult): CanonicalWalletType {
    return mapImportTypeToCanonical(payload);
  }

  /**
   * Get capability flags for a wallet type.
   */
  static getCapabilities(type: CanonicalWalletType): CapabilityFlags {
    return WALLET_TYPE_CAPABILITIES[type];
  }

  /**
   * Derive initial addresses for a wallet.
   * This is a placeholder - actual derivation happens in WalletEngine.
   */
  static async deriveInitialAddresses(
    walletId: string,
    type: CanonicalWalletType,
    pin: string,
    gapLimit: number = 20
  ): Promise<{ receiving: AddressInfo[]; change: AddressInfo[] }> {
    // This will be implemented by WalletEngine
    // For now, return empty arrays - addresses are derived on first sync
    return {
      receiving: [],
      change: [],
    };
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Store secrets from ImportResult in SecureVault.
   */
  private static async storeSecrets(
    walletId: string,
    payload: ImportResult,
    type: CanonicalWalletType,
    pin: string
  ): Promise<void> {
    switch (type) {
      case 'hd_mnemonic':
      case 'hd_electrum':
        if (payload.mnemonic) {
          await SecureVault.store(
            walletId,
            payload.mnemonic,
            'mnemonic',
            pin,
            { passphrase: payload.passphrase, hasPassphrase: !!payload.passphrase }
          );
        }
        break;

      case 'hd_xprv':
        if (payload.xprv) {
          await SecureVault.store(walletId, payload.xprv, 'xprv', pin);
        }
        break;

      case 'hd_seed':
        if (payload.seed) {
          const seedHex = Array.from(payload.seed)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          await SecureVault.store(walletId, seedHex, 'seed_hex', pin);
        }
        break;

      case 'hd_descriptor':
        if (payload.descriptors?.[0]?.xprv) {
          await SecureVault.store(walletId, payload.descriptors[0].xprv, 'xprv', pin);
        }
        if (payload.descriptors?.[0]?.raw) {
          await SecureVault.store(walletId, payload.descriptors[0].raw, 'descriptor', pin);
        }
        break;

      case 'imported_key':
        if (payload.privateKeyWIF) {
          await SecureVault.store(walletId, payload.privateKeyWIF, 'wif', pin);
        }
        break;

      case 'imported_keys':
        if (payload.keys?.length) {
          const wifs = payload.keys.map(k => k.wif);
          await SecureVault.store(walletId, wifs, 'wif_set', pin);
        }
        break;

      case 'watch_xpub':
      case 'watch_descriptor':
      case 'watch_addresses':
        // No secrets to store for watch-only wallets
        break;

      case 'multisig':
        // Multisig secrets handled separately via storeCosignerSeed
        if (payload.mnemonic) {
          await SecureVault.store(walletId, payload.mnemonic, 'mnemonic', pin);
        }
        break;
    }
  }

  /**
   * Store secrets from ImportPayload in SecureVault.
   */
  private static async storeSecretsFromPayload(
    walletId: string,
    payload: ImportPayload,
    pin: string
  ): Promise<void> {
    if (payload.mnemonic) {
      await SecureVault.store(
        walletId,
        payload.mnemonic,
        'mnemonic',
        pin,
        { passphrase: payload.passphrase, hasPassphrase: !!payload.passphrase }
      );
    }

    if (payload.xprv) {
      await SecureVault.store(walletId, payload.xprv, 'xprv', pin);
    }

    if (payload.seedHex) {
      await SecureVault.store(walletId, payload.seedHex, 'seed_hex', pin);
    }

    if (payload.wif) {
      await SecureVault.store(walletId, payload.wif, 'wif', pin);
    }

    if (payload.wifKeys?.length) {
      const wifs = payload.wifKeys.map(k => k.wif);
      await SecureVault.store(walletId, wifs, 'wif_set', pin);
    }

    if (payload.privateDescriptor) {
      await SecureVault.store(walletId, payload.privateDescriptor, 'descriptor', pin);
    }

    // Store cosigner seeds for multisig
    if (payload.cosignerSeeds?.length) {
      for (const cosigner of payload.cosignerSeeds) {
        await SecureVault.storeCosignerSeed(walletId, cosigner.index, cosigner.mnemonic, pin);
      }
    }
  }
}

export default WalletNormalizer;
