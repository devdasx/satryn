/**
 * Seed Bytes Parser
 *
 * Parses raw BIP32/BIP39 seed bytes in hex format.
 * Supports:
 *   - 64-byte (128 hex chars) BIP39 seed output
 *   - 32-byte (64 hex chars) BIP32 master seed
 *   - 16-64 byte range (32-128 hex chars) for custom seeds
 *
 * SECURITY: Never logs raw seed material.
 */

import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import BIP32Factory from 'bip32';
import type { ImportResult, SuggestedScriptType, DerivationPathConfig } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';
import { isValidDerivationPath } from './extendedKey';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

export interface SeedBytesInfo {
  /** The raw seed bytes */
  seed: Uint8Array;
  /** Length in bytes */
  length: number;
  /** Whether this is a standard length */
  isStandardLength: boolean;
  /** Human-readable label */
  label: string;
}

/**
 * Parse hex-encoded seed bytes.
 * Accepts 16-64 bytes (32-128 hex characters).
 *
 * @param hex - Hex-encoded seed bytes
 * @returns Parsed seed information
 * @throws ImportError for invalid format
 */
export function parseSeedBytesHex(hex: string): SeedBytesInfo {
  const trimmed = hex.trim().toLowerCase();

  // Validate hex format
  if (!/^[0-9a-f]+$/.test(trimmed)) {
    throw new ImportError('INVALID_FORMAT', 'Expected hex characters only');
  }

  // Must be even length
  if (trimmed.length % 2 !== 0) {
    throw new ImportError('INVALID_FORMAT', 'Hex string must have even length');
  }

  const byteLength = trimmed.length / 2;

  // Valid range: 16-64 bytes
  if (byteLength < 16 || byteLength > 64) {
    throw new ImportError('INVALID_FORMAT', `Seed must be 16-64 bytes, got ${byteLength}`);
  }

  const seed = Buffer.from(trimmed, 'hex');

  // Check for all zeros
  let allZero = true;
  for (const byte of seed) {
    if (byte !== 0) { allZero = false; break; }
  }
  if (allZero) {
    throw new ImportError('INVALID_FORMAT', 'Seed cannot be all zeros');
  }

  // Determine label based on length
  let label: string;
  const isStandardLength = byteLength === 32 || byteLength === 64;

  if (byteLength === 64) {
    label = 'BIP39 Seed (64 bytes)';
  } else if (byteLength === 32) {
    label = 'Master Seed (32 bytes)';
  } else {
    label = `Seed (${byteLength} bytes)`;
  }

  safeLog(`parseSeedBytesHex: ${byteLength} bytes, standard=${isStandardLength}`);

  return {
    seed: new Uint8Array(seed),
    length: byteLength,
    isStandardLength,
    label,
  };
}

/**
 * Get the purpose number for a given BIP preset.
 */
function purposeForPreset(preset: 'bip44' | 'bip49' | 'bip84' | 'bip86'): number {
  switch (preset) {
    case 'bip44': return 44;
    case 'bip49': return 49;
    case 'bip84': return 84;
    case 'bip86': return 86;
  }
}

/**
 * Get the default purpose from script type (used when no derivation config provided).
 */
function purposeForScriptType(scriptType: SuggestedScriptType): number {
  switch (scriptType) {
    case 'native_segwit': return 84;
    case 'wrapped_segwit': return 49;
    case 'taproot': return 86;
    case 'legacy':
    default: return 44;
  }
}

/**
 * Derive addresses from raw seed bytes for preview.
 * Supports full BIP44/49/84/86 derivation, custom paths, and account index.
 *
 * @param seed - Raw seed bytes
 * @param scriptType - Address type to derive
 * @param count - Number of addresses to derive
 * @param derivationConfig - Optional derivation path configuration
 * @returns Array of derived addresses
 */
export function deriveAddressesFromSeed(
  seed: Uint8Array,
  scriptType: SuggestedScriptType,
  count: number = 1,
  derivationConfig?: DerivationPathConfig,
): string[] {
  const network = bitcoin.networks.bitcoin;
  const root = bip32.fromSeed(Buffer.from(seed), network);
  const addresses: string[] = [];

  for (let i = 0; i < count; i++) {
    try {
      let child;
      const addrIndex = (derivationConfig?.addressIndex ?? 0) + i;

      if (derivationConfig) {
        if (derivationConfig.preset === 'custom' && derivationConfig.customPath) {
          // Custom path — derive from root
          try {
            child = root.derivePath(derivationConfig.customPath.replace('m/', ''));
          } catch {
            continue;
          }
        } else if (derivationConfig.preset === 'bip32') {
          // Raw BIP32: m/0/index
          child = root.derive(0).derive(addrIndex);
        } else {
          // BIP44/49/84/86 with account index
          const purpose = purposeForPreset(derivationConfig.preset as 'bip44' | 'bip49' | 'bip84' | 'bip86');
          child = root
            .deriveHardened(purpose)
            .deriveHardened(0) // coin type (bitcoin)
            .deriveHardened(derivationConfig.accountIndex)
            .derive(0) // external chain
            .derive(addrIndex);
        }
      } else {
        // Default: derive using script type to determine purpose, account 0
        const purpose = purposeForScriptType(scriptType);
        child = root
          .deriveHardened(purpose)
          .deriveHardened(0)
          .deriveHardened(0)
          .derive(0)
          .derive(i);
      }

      if (!child) continue;
      const pubkey = child.publicKey;

      switch (scriptType) {
        case 'native_segwit':
          addresses.push(bitcoin.payments.p2wpkh({ pubkey, network }).address!);
          break;
        case 'wrapped_segwit': {
          const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
          addresses.push(bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address!);
          break;
        }
        case 'taproot': {
          const xOnly = pubkey.subarray(1, 33);
          addresses.push(bitcoin.payments.p2tr({ internalPubkey: xOnly, network }).address!);
          break;
        }
        case 'legacy':
        default:
          addresses.push(bitcoin.payments.p2pkh({ pubkey, network }).address!);
          break;
      }
    } catch {
      // Skip failures
    }
  }

  return addresses;
}

/**
 * Parse seed bytes hex and return an ImportResult.
 *
 * @param hex - Hex-encoded seed bytes
 * @param scriptType - Desired address type
 * @param derivationConfig - Optional derivation path configuration
 */
export function parseSeedBytes(
  hex: string,
  scriptType: SuggestedScriptType = 'native_segwit',
  derivationConfig?: DerivationPathConfig,
): ImportResult {
  const info = parseSeedBytesHex(hex);

  // Derive preview address using the provided derivation config
  const previewAddresses = deriveAddressesFromSeed(info.seed, scriptType, 1, derivationConfig);

  // Get master fingerprint
  let fingerprint: string | undefined;
  try {
    const root = bip32.fromSeed(Buffer.from(info.seed), bitcoin.networks.bitcoin);
    fingerprint = Buffer.from(root.fingerprint).toString('hex');
  } catch {
    // Ignore
  }

  return {
    type: 'hd',
    sourceFormat: 'seed_bytes_hex',
    seed: info.seed,
    suggestedScriptType: scriptType,
    suggestedName: `Imported Seed`,
    derivationPathConfig: derivationConfig,
    previewAddress: previewAddresses[0],
    fingerprint,
  };
}
