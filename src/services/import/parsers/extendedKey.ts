/**
 * Extended Private Key Parser
 *
 * Parses xprv, yprv, zprv, Yprv, Zprv extended private keys.
 * Automatically detects the script type from the version prefix.
 *
 * MAINNET ONLY — tprv, uprv, vprv are rejected.
 *
 * Version bytes:
 *   0x0488ADE4 = xprv (BIP44, legacy or ambiguous)
 *   0x049d7878 = yprv (BIP49, wrapped segwit)
 *   0x04b2430c = zprv (BIP84, native segwit)
 *   0x0295b005 = Yprv (BIP49 multisig)
 *   0x02aa7a99 = Zprv (BIP84 multisig)
 *
 * Testnet versions (rejected):
 *   0x04358394 = tprv
 *   0x044a4e28 = uprv
 *   0x045f18bc = vprv
 */

import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import BIP32Factory from 'bip32';
import bs58check from 'bs58check';
import type { ImportResult, SuggestedScriptType, DerivationPathConfig } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

// Version byte mapping
const VERSION_MAP: Record<string, {
  prefix: string;
  scriptType: SuggestedScriptType;
  isMainnet: boolean;
  label: string;
}> = {
  '0488ade4': { prefix: 'xprv', scriptType: 'legacy', isMainnet: true, label: 'xprv (BIP44)' },
  '049d7878': { prefix: 'yprv', scriptType: 'wrapped_segwit', isMainnet: true, label: 'yprv (BIP49)' },
  '04b2430c': { prefix: 'zprv', scriptType: 'native_segwit', isMainnet: true, label: 'zprv (BIP84)' },
  '0295b005': { prefix: 'Yprv', scriptType: 'wrapped_segwit', isMainnet: true, label: 'Yprv (BIP49 multisig)' },
  '02aa7a99': { prefix: 'Zprv', scriptType: 'native_segwit', isMainnet: true, label: 'Zprv (BIP84 multisig)' },
  // Testnet
  '04358394': { prefix: 'tprv', scriptType: 'legacy', isMainnet: false, label: 'tprv (testnet)' },
  '044a4e28': { prefix: 'uprv', scriptType: 'wrapped_segwit', isMainnet: false, label: 'uprv (testnet)' },
  '045f18bc': { prefix: 'vprv', scriptType: 'native_segwit', isMainnet: false, label: 'vprv (testnet)' },
};

export interface ExtendedKeyInfo {
  /** The raw xprv string (may have been converted from yprv/zprv) */
  xprv: string;
  /** Original version prefix */
  originalPrefix: string;
  /** Detected script type from version bytes */
  scriptType: SuggestedScriptType;
  /** Depth in the BIP32 tree */
  depth: number;
  /** Parent fingerprint */
  fingerprint: string;
  /** Whether this is a mainnet key */
  isMainnet: boolean;
  /** Human-readable label */
  label: string;
}

/**
 * Parse an extended private key (xprv/yprv/zprv/Yprv/Zprv).
 * Rejects testnet keys (tprv/uprv/vprv).
 *
 * @param key - Base58check-encoded extended private key
 * @returns Parsed key information
 * @throws ImportError for testnet or invalid format
 */
export function parseExtendedPrivateKey(key: string): ExtendedKeyInfo {
  const trimmed = key.trim();

  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(trimmed);
  } catch {
    throw new ImportError('INVALID_CHECKSUM', 'Invalid extended key checksum');
  }

  if (decoded.length !== 78) {
    throw new ImportError('INVALID_FORMAT', 'Extended key must be 78 bytes');
  }

  // Read version bytes (first 4 bytes)
  const versionHex = Buffer.from(decoded.slice(0, 4)).toString('hex');
  const versionInfo = VERSION_MAP[versionHex];

  if (!versionInfo) {
    throw new ImportError('UNSUPPORTED_VERSION', 'Unrecognized extended key version');
  }

  if (!versionInfo.isMainnet) {
    throw new ImportError('TESTNET_REJECTED', 'Testnet extended keys are not supported. This app is mainnet only.');
  }

  // Extract metadata
  const depth = decoded[4];
  const parentFingerprint = Buffer.from(decoded.slice(5, 9)).toString('hex');

  // Verify it contains a private key (byte 45 should be 0x00 padding)
  if (decoded[45] !== 0x00) {
    throw new ImportError('NO_PRIVATE_KEYS', 'This is a public key (xpub), not a private key (xprv)');
  }

  // Convert yprv/zprv/etc. to standard xprv for BIP32 library compatibility
  let standardXprv = trimmed;
  if (versionHex !== '0488ade4') {
    // Rewrite version bytes to xprv (0x0488ADE4)
    const modifiedData = Buffer.from(decoded);
    modifiedData[0] = 0x04;
    modifiedData[1] = 0x88;
    modifiedData[2] = 0xAD;
    modifiedData[3] = 0xE4;
    standardXprv = bs58check.encode(modifiedData);
  }

  safeLog(`parseExtendedPrivateKey: ${versionInfo.label}, depth=${depth}`);

  return {
    xprv: standardXprv,
    originalPrefix: versionInfo.prefix,
    scriptType: versionInfo.scriptType,
    depth,
    fingerprint: parentFingerprint,
    isMainnet: true,
    label: versionInfo.label,
  };
}

/**
 * Validate a custom derivation path string.
 * Must start with "m/" and contain valid path components.
 */
export function isValidDerivationPath(path: string): boolean {
  if (!path.startsWith('m/')) return false;
  const parts = path.slice(2).split('/');
  if (parts.length === 0) return false;
  return parts.every(s => /^\d+'?$/.test(s));
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
 * Derive a child node from a BIP32 node using a full BIP44/49/84/86 path,
 * accounting for the depth of the input node.
 *
 * depth 0 (master)  → deriveHardened(purpose).deriveHardened(0).deriveHardened(account).derive(chain).derive(index)
 * depth 1 (purpose) → deriveHardened(0).deriveHardened(account).derive(chain).derive(index)
 * depth 2 (coin)    → deriveHardened(account).derive(chain).derive(index)
 * depth 3 (account) → derive(chain).derive(index)
 * depth 4+ (deeper) → derive(index)
 */
function deriveFromFullPath(
  node: ReturnType<typeof bip32.fromBase58>,
  purpose: number,
  accountIndex: number,
  chain: number,
  index: number,
): ReturnType<typeof bip32.fromBase58> {
  let child = node;
  switch (node.depth) {
    case 0: // master
      child = child.deriveHardened(purpose);
      // fallthrough
    case 1: // purpose level
      child = child.deriveHardened(0); // coin type = 0 (bitcoin)
      // fallthrough
    case 2: // coin level
      child = child.deriveHardened(accountIndex);
      // fallthrough
    case 3: // account level
      child = child.derive(chain).derive(index);
      break;
    default: // deeper
      child = child.derive(index);
      break;
  }
  return child;
}

/**
 * Build the full derivation path string for display.
 */
export function buildDerivationPathString(
  config: DerivationPathConfig,
  scriptType?: SuggestedScriptType,
): string {
  if (config.preset === 'hd') {
    return 'All standard paths (BIP44/49/84/86)';
  }
  if (config.preset === 'custom' && config.customPath) {
    return config.customPath;
  }
  if (config.preset === 'bip32') {
    return `0/${config.addressIndex}`;
  }
  const purpose = purposeForPreset(config.preset as 'bip44' | 'bip49' | 'bip84' | 'bip86');
  return `m/${purpose}'/0'/${config.accountIndex}'/0/${config.addressIndex}`;
}

/**
 * Derive addresses from an extended private key for preview.
 * Supports full BIP44/49/84/86 derivation and custom paths.
 *
 * @param xprv - Standard xprv key
 * @param scriptType - Address type to derive
 * @param count - Number of addresses to derive (default 1)
 * @param derivationConfig - Optional derivation path configuration
 * @returns Array of derived addresses
 */
export function deriveAddressesFromXprv(
  xprv: string,
  scriptType: SuggestedScriptType,
  count: number = 1,
  derivationConfig?: DerivationPathConfig,
): string[] {
  const node = bip32.fromBase58(xprv, bitcoin.networks.bitcoin);
  const addresses: string[] = [];
  const network = bitcoin.networks.bitcoin;

  for (let i = 0; i < count; i++) {
    let child;
    const addrIndex = (derivationConfig?.addressIndex ?? 0) + i;

    if (derivationConfig) {
      if (derivationConfig.preset === 'custom' && derivationConfig.customPath) {
        // Custom path — derive from root using derivePath
        try {
          child = node.derivePath(derivationConfig.customPath.replace('m/', ''));
        } catch {
          continue;
        }
      } else if (derivationConfig.preset === 'bip32') {
        // Raw BIP32: just derive 0/index (external chain)
        if (node.depth <= 3) {
          child = node.derive(0).derive(addrIndex);
        } else {
          child = node.derive(addrIndex);
        }
      } else {
        // BIP44/49/84/86 — use depth-aware derivation
        const purpose = purposeForPreset(derivationConfig.preset as 'bip44' | 'bip49' | 'bip84' | 'bip86');
        child = deriveFromFullPath(node, purpose, derivationConfig.accountIndex, 0, addrIndex);
      }
    } else {
      // Legacy fallback: BIP32 raw derivation
      if (node.depth <= 3) {
        child = node.derive(0).derive(addrIndex);
      } else {
        child = node.derive(addrIndex);
      }
    }

    if (!child) continue;
    const pubkey = child.publicKey;

    try {
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
      // Skip address derivation failures
    }
  }

  return addresses;
}

/**
 * Parse an extended private key and return an ImportResult.
 *
 * @param input - Raw xprv/yprv/zprv key string
 * @param overrideScriptType - Override the auto-detected script type
 * @param derivationConfig - Optional derivation path configuration
 */
export function parseExtendedKey(
  input: string,
  overrideScriptType?: SuggestedScriptType,
  derivationConfig?: DerivationPathConfig,
): ImportResult {
  const info = parseExtendedPrivateKey(input);
  const scriptType = overrideScriptType || info.scriptType;

  // Derive preview address using the provided derivation config
  const previewAddresses = deriveAddressesFromXprv(info.xprv, scriptType, 1, derivationConfig);

  // Get master fingerprint
  let fingerprint: string | undefined;
  try {
    const node = bip32.fromBase58(info.xprv, bitcoin.networks.bitcoin);
    if (node.depth === 0) {
      fingerprint = Buffer.from(node.fingerprint).toString('hex');
    } else {
      fingerprint = info.fingerprint;
    }
  } catch {
    fingerprint = info.fingerprint;
  }

  return {
    type: 'hd',
    sourceFormat: 'xprv',
    xprv: info.xprv,
    suggestedScriptType: scriptType,
    suggestedName: `Imported ${info.originalPrefix}`,
    derivationPathConfig: derivationConfig,
    previewAddress: previewAddresses[0],
    fingerprint,
  };
}
