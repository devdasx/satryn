/**
 * Output Descriptor Utilities
 * Implements BIP380 descriptor checksum and parsing
 *
 * Supported descriptor formats:
 * - pkh(key)                    - P2PKH (Legacy)
 * - wpkh(key)                   - P2WPKH (Native SegWit)
 * - sh(wpkh(key))               - P2SH-P2WPKH (Wrapped SegWit)
 * - tr(key)                     - P2TR (Taproot)
 * - multi(k, key1, key2, ...)   - Bare multisig
 * - sh(multi(...))              - P2SH multisig
 * - wsh(multi(...))             - P2WSH multisig
 * - sh(wsh(multi(...)))         - P2SH-P2WSH multisig
 * - sortedmulti(k, key1, ...)   - Sorted multisig
 */

import { ADDRESS_TYPES } from '../constants';
import type { AddressType, DescriptorInfo, DescriptorKey } from '../types';

// BIP380 checksum character set
const INPUT_CHARSET = '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * BIP380 Polymod function for descriptor checksum
 */
function polymod(c: bigint, val: number): bigint {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val);
  if (c0 & 1n) c ^= 0xf5dee51989n;
  if (c0 & 2n) c ^= 0xa9fdca3312n;
  if (c0 & 4n) c ^= 0x1bab10e32dn;
  if (c0 & 8n) c ^= 0x3706b1677an;
  if (c0 & 16n) c ^= 0x644d626ffdn;
  return c;
}

/**
 * Calculate BIP380 descriptor checksum
 * @param descriptor - The descriptor without checksum
 * @returns 8-character checksum
 */
export function calculateDescriptorChecksum(descriptor: string): string {
  let c = 1n;

  // Process each character in the descriptor
  for (const char of descriptor) {
    const pos = INPUT_CHARSET.indexOf(char);
    if (pos === -1) {
      throw new Error(`Invalid character in descriptor: ${char}`);
    }
    c = polymod(c, pos & 31);
    c = polymod(c, pos >> 5);
  }

  // Finalize
  for (let i = 0; i < 8; i++) {
    c = polymod(c, 0);
  }
  c ^= 1n;

  // Generate checksum string
  let checksum = '';
  for (let i = 0; i < 8; i++) {
    checksum += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)];
  }

  return checksum;
}

/**
 * Add checksum to a descriptor
 * @param descriptor - Descriptor without checksum
 * @returns Descriptor with checksum appended
 */
export function addDescriptorChecksum(descriptor: string): string {
  // Remove existing checksum if present
  const baseDescriptor = descriptor.includes('#')
    ? descriptor.split('#')[0]
    : descriptor;

  const checksum = calculateDescriptorChecksum(baseDescriptor);
  return `${baseDescriptor}#${checksum}`;
}

/**
 * Validate a descriptor's checksum
 * @param descriptorWithChecksum - Full descriptor with #checksum
 * @returns True if checksum is valid
 */
export function validateDescriptorChecksum(descriptorWithChecksum: string): boolean {
  if (!descriptorWithChecksum.includes('#')) {
    return false; // No checksum present
  }

  const [descriptor, checksum] = descriptorWithChecksum.split('#');

  if (checksum.length !== 8) {
    return false;
  }

  const calculatedChecksum = calculateDescriptorChecksum(descriptor);
  return checksum === calculatedChecksum;
}

/**
 * Extract the base descriptor without checksum
 * @param descriptor - Descriptor with or without checksum
 * @returns Descriptor without checksum
 */
export function stripDescriptorChecksum(descriptor: string): string {
  return descriptor.includes('#')
    ? descriptor.split('#')[0]
    : descriptor;
}

/**
 * Parse a key expression from a descriptor
 * Handles: [fingerprint/path]xpub/chain/*, raw pubkeys, etc.
 */
function parseKeyExpression(keyExpr: string): DescriptorKey {
  // Pattern: [fingerprint/path]key/derivation
  const originMatch = keyExpr.match(/^\[([a-f0-9]{8})\/([^\]]+)\](.+)$/i);

  let fingerprint: string | undefined;
  let derivationPath: string | undefined;
  let keyPart: string;

  if (originMatch) {
    fingerprint = originMatch[1];
    derivationPath = `m/${originMatch[2]}`;
    keyPart = originMatch[3];
  } else {
    keyPart = keyExpr;
  }

  // Check for derivation path after the key (e.g., xpub.../0/*)
  const isWildcard = keyPart.includes('/*');
  const isXpub = keyPart.match(/^[xyztuvp]pub/i) !== null ||
                 keyPart.match(/^[xyztuvp]prv/i) !== null;

  // Extract the actual key (remove any trailing derivation)
  const key = keyPart.replace(/\/[0-9*]+\/?\*?$/, '').replace(/\/\*$/, '');

  return {
    fingerprint,
    derivationPath,
    key,
    isXpub,
    isWildcard,
  };
}

/**
 * Parse an output descriptor
 * @param descriptor - The descriptor string (with or without checksum)
 * @returns Parsed descriptor information
 */
// LRU cache for parsed descriptors (descriptors are immutable strings)
const _descriptorCache = new Map<string, DescriptorInfo>();
const _DESCRIPTOR_CACHE_MAX = 50;

export function parseDescriptor(descriptor: string): DescriptorInfo {
  const cached = _descriptorCache.get(descriptor);
  if (cached) return cached;
  const baseDescriptor = stripDescriptorChecksum(descriptor);
  const hasChecksum = descriptor.includes('#');
  const checksum = hasChecksum ? descriptor.split('#')[1] : undefined;

  // Validate checksum if present
  const isValid = hasChecksum ? validateDescriptorChecksum(descriptor) : true;

  let type: DescriptorInfo['type'];
  let scriptType: DescriptorInfo['scriptType'];
  let isMultisig = false;
  let threshold: number | undefined;
  let totalKeys: number | undefined;
  const keys: DescriptorKey[] = [];

  // Taproot: tr(key) or tr(key,{scripts})
  if (baseDescriptor.startsWith('tr(')) {
    type = 'tr';
    scriptType = 'p2tr';
    const inner = baseDescriptor.slice(3, -1);
    const keyExpr = inner.split(',')[0]; // Get the internal key
    keys.push(parseKeyExpression(keyExpr));
  }
  // Native SegWit: wpkh(key)
  else if (baseDescriptor.startsWith('wpkh(')) {
    type = 'wpkh';
    scriptType = 'p2wpkh';
    const inner = baseDescriptor.slice(5, -1);
    keys.push(parseKeyExpression(inner));
  }
  // Wrapped SegWit: sh(wpkh(key))
  else if (baseDescriptor.startsWith('sh(wpkh(')) {
    type = 'sh';
    scriptType = 'p2sh-p2wpkh';
    const inner = baseDescriptor.slice(8, -2);
    keys.push(parseKeyExpression(inner));
  }
  // Legacy: pkh(key)
  else if (baseDescriptor.startsWith('pkh(')) {
    type = 'pkh';
    scriptType = 'p2pkh';
    const inner = baseDescriptor.slice(4, -1);
    keys.push(parseKeyExpression(inner));
  }
  // P2WSH multisig: wsh(multi(...)) or wsh(sortedmulti(...))
  else if (baseDescriptor.startsWith('wsh(multi(') || baseDescriptor.startsWith('wsh(sortedmulti(')) {
    type = baseDescriptor.includes('sortedmulti') ? 'sortedmulti' : 'multi';
    scriptType = 'p2wsh';
    isMultisig = true;

    const multiMatch = baseDescriptor.match(/wsh\((sorted)?multi\((\d+),(.+)\)\)/);
    if (multiMatch) {
      threshold = parseInt(multiMatch[2], 10);
      const keysStr = multiMatch[3];
      const keyExprs = splitMultisigKeys(keysStr);
      totalKeys = keyExprs.length;
      for (const keyExpr of keyExprs) {
        keys.push(parseKeyExpression(keyExpr));
      }
    }
  }
  // P2SH-P2WSH multisig: sh(wsh(multi(...)))
  else if (baseDescriptor.startsWith('sh(wsh(multi(') || baseDescriptor.startsWith('sh(wsh(sortedmulti(')) {
    type = baseDescriptor.includes('sortedmulti') ? 'sortedmulti' : 'multi';
    scriptType = 'p2sh-p2wsh';
    isMultisig = true;

    const multiMatch = baseDescriptor.match(/sh\(wsh\((sorted)?multi\((\d+),(.+)\)\)\)/);
    if (multiMatch) {
      threshold = parseInt(multiMatch[2], 10);
      const keysStr = multiMatch[3];
      const keyExprs = splitMultisigKeys(keysStr);
      totalKeys = keyExprs.length;
      for (const keyExpr of keyExprs) {
        keys.push(parseKeyExpression(keyExpr));
      }
    }
  }
  // P2SH multisig: sh(multi(...))
  else if (baseDescriptor.startsWith('sh(multi(') || baseDescriptor.startsWith('sh(sortedmulti(')) {
    type = baseDescriptor.includes('sortedmulti') ? 'sortedmulti' : 'multi';
    scriptType = 'p2sh';
    isMultisig = true;

    const multiMatch = baseDescriptor.match(/sh\((sorted)?multi\((\d+),(.+)\)\)/);
    if (multiMatch) {
      threshold = parseInt(multiMatch[2], 10);
      const keysStr = multiMatch[3];
      const keyExprs = splitMultisigKeys(keysStr);
      totalKeys = keyExprs.length;
      for (const keyExpr of keyExprs) {
        keys.push(parseKeyExpression(keyExpr));
      }
    }
  }
  else {
    throw new Error(`Unsupported descriptor format: ${baseDescriptor}`);
  }

  const isRange = baseDescriptor.includes('/*');

  const result: DescriptorInfo = {
    raw: descriptor,
    type,
    scriptType,
    isRange,
    isMultisig,
    threshold,
    totalKeys,
    keys,
    checksum,
    isValid,
  };

  // Cache the result (LRU eviction)
  if (_descriptorCache.size >= _DESCRIPTOR_CACHE_MAX) {
    const firstKey = _descriptorCache.keys().next().value;
    if (firstKey !== undefined) _descriptorCache.delete(firstKey);
  }
  _descriptorCache.set(descriptor, result);

  return result;
}

/**
 * Split multisig key expressions, handling nested brackets
 */
function splitMultisigKeys(keysStr: string): string[] {
  const keys: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (const char of keysStr) {
    if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth--;
      current += char;
    } else if (char === ',' && bracketDepth === 0) {
      keys.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    keys.push(current.trim());
  }

  return keys;
}

/**
 * Determine the address type from a descriptor
 */
export function getAddressTypeFromDescriptor(descriptor: string): AddressType {
  const parsed = parseDescriptor(descriptor);

  switch (parsed.scriptType) {
    case 'p2tr':
      return ADDRESS_TYPES.TAPROOT;
    case 'p2wpkh':
      return ADDRESS_TYPES.NATIVE_SEGWIT;
    case 'p2sh-p2wpkh':
      return ADDRESS_TYPES.WRAPPED_SEGWIT;
    case 'p2pkh':
      return ADDRESS_TYPES.LEGACY;
    case 'p2wsh':
    case 'p2sh-p2wsh':
    case 'p2sh':
      // Multisig - default to native segwit for consistency
      return ADDRESS_TYPES.NATIVE_SEGWIT;
    default:
      return ADDRESS_TYPES.NATIVE_SEGWIT;
  }
}

/**
 * Create a single-key descriptor
 */
export function createSingleKeyDescriptor(
  addressType: AddressType,
  fingerprint: string,
  derivationPath: string,
  xpub: string,
  chain: 0 | 1 = 0,
  withChecksum: boolean = true
): string {
  // Normalize derivation path (remove leading m/)
  const normalizedPath = derivationPath.replace(/^m\//, '').replace(/'/g, 'h');
  const origin = `[${fingerprint}/${normalizedPath}]`;
  const keyExpr = `${origin}${xpub}/${chain}/*`;

  let descriptor: string;

  switch (addressType) {
    case ADDRESS_TYPES.TAPROOT:
      descriptor = `tr(${keyExpr})`;
      break;
    case ADDRESS_TYPES.NATIVE_SEGWIT:
      descriptor = `wpkh(${keyExpr})`;
      break;
    case ADDRESS_TYPES.WRAPPED_SEGWIT:
      descriptor = `sh(wpkh(${keyExpr}))`;
      break;
    case ADDRESS_TYPES.LEGACY:
      descriptor = `pkh(${keyExpr})`;
      break;
    default:
      throw new Error(`Unknown address type: ${addressType}`);
  }

  return withChecksum ? addDescriptorChecksum(descriptor) : descriptor;
}

/**
 * Create a multisig descriptor
 */
export function createMultisigDescriptor(
  threshold: number,
  keys: Array<{ fingerprint: string; derivationPath: string; xpub: string }>,
  scriptType: 'p2sh' | 'p2wsh' | 'p2sh-p2wsh',
  sorted: boolean = true,
  chain: 0 | 1 = 0,
  withChecksum: boolean = true
): string {
  if (keys.length < 2 || keys.length > 15) {
    throw new Error('Multisig requires 2-15 keys');
  }

  if (threshold < 1 || threshold > keys.length) {
    throw new Error(`Threshold must be between 1 and ${keys.length}`);
  }

  const multiType = sorted ? 'sortedmulti' : 'multi';

  const keyExprs = keys.map(({ fingerprint, derivationPath, xpub }) => {
    const normalizedPath = derivationPath.replace(/^m\//, '').replace(/'/g, 'h');
    return `[${fingerprint}/${normalizedPath}]${xpub}/${chain}/*`;
  });

  const multiExpr = `${multiType}(${threshold},${keyExprs.join(',')})`;

  let descriptor: string;

  switch (scriptType) {
    case 'p2sh':
      descriptor = `sh(${multiExpr})`;
      break;
    case 'p2wsh':
      descriptor = `wsh(${multiExpr})`;
      break;
    case 'p2sh-p2wsh':
      descriptor = `sh(wsh(${multiExpr}))`;
      break;
    default:
      throw new Error(`Unknown script type: ${scriptType}`);
  }

  return withChecksum ? addDescriptorChecksum(descriptor) : descriptor;
}

/**
 * Validate a descriptor string
 */
export function isValidDescriptor(descriptor: string): boolean {
  try {
    const parsed = parseDescriptor(descriptor);
    return parsed.isValid;
  } catch {
    return false;
  }
}
