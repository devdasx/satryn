/**
 * Address Type Map — Unified type conversions
 *
 * Single source of truth for converting between:
 * - AddressType constants ('native_segwit', 'wrapped_segwit', 'legacy', 'taproot')
 * - DB canonical script types ('p2wpkh', 'p2sh-p2wpkh', 'p2pkh', 'p2tr')
 * - Address prefixes ('bc1q...', '3...', '1...', 'bc1p...')
 * - BIP presets ('bip84', 'bip49', 'bip44', 'bip86')
 *
 * Replaces 6+ scattered duplicate implementations across the codebase.
 */

import { ADDRESS_TYPES } from '../constants';
import type { AddressType } from '../types';
import type { CanonicalScriptType } from '../services/sync/types';

// ─── Forward Mapping: AddressType → Script Type ──────────────────────

const _addressTypeToScript: Record<string, CanonicalScriptType> = {
  [ADDRESS_TYPES.NATIVE_SEGWIT]: 'p2wpkh',
  [ADDRESS_TYPES.WRAPPED_SEGWIT]: 'p2sh-p2wpkh',
  [ADDRESS_TYPES.LEGACY]: 'p2pkh',
  [ADDRESS_TYPES.TAPROOT]: 'p2tr',
};

// ─── Reverse Mapping: Script Type → AddressType ──────────────────────

const _scriptToAddressType: Record<string, AddressType> = {
  'p2wpkh': ADDRESS_TYPES.NATIVE_SEGWIT,
  'p2sh-p2wpkh': ADDRESS_TYPES.WRAPPED_SEGWIT,
  'p2pkh': ADDRESS_TYPES.LEGACY,
  'p2tr': ADDRESS_TYPES.TAPROOT,
};

// ─── BIP Preset → AddressType ────────────────────────────────────────

const _bipPresetToAddressType: Record<string, AddressType> = {
  bip44: ADDRESS_TYPES.LEGACY,
  bip49: ADDRESS_TYPES.WRAPPED_SEGWIT,
  bip84: ADDRESS_TYPES.NATIVE_SEGWIT,
  bip86: ADDRESS_TYPES.TAPROOT,
  bip32: ADDRESS_TYPES.NATIVE_SEGWIT,  // Default for raw BIP32
  custom: ADDRESS_TYPES.NATIVE_SEGWIT, // Default for custom paths
  hd: ADDRESS_TYPES.NATIVE_SEGWIT,     // Default for full HD
};

// ─── All standard address types ──────────────────────────────────────

export const ALL_ADDRESS_TYPES: AddressType[] = [
  ADDRESS_TYPES.NATIVE_SEGWIT,
  ADDRESS_TYPES.WRAPPED_SEGWIT,
  ADDRESS_TYPES.LEGACY,
  ADDRESS_TYPES.TAPROOT,
];

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Convert AddressType constant → DB canonical script type.
 *
 * @example addressTypeToScript('native_segwit') → 'p2wpkh'
 * @example addressTypeToScript('taproot') → 'p2tr'
 */
export function addressTypeToScript(addressType: AddressType | string): CanonicalScriptType {
  return _addressTypeToScript[addressType] ?? (addressType as CanonicalScriptType);
}

/**
 * Convert DB canonical script type → AddressType constant.
 *
 * @example scriptToAddressType('p2wpkh') → 'native_segwit'
 * @example scriptToAddressType('p2tr') → 'taproot'
 */
export function scriptToAddressType(scriptType: string): AddressType {
  return _scriptToAddressType[scriptType] ?? (scriptType as AddressType);
}

/**
 * Guess script type from a Bitcoin address prefix.
 * Used during transaction decoding when we don't have metadata.
 *
 * @example guessScriptType('bc1q...') → 'p2wpkh'
 * @example guessScriptType('bc1p...') → 'p2tr'
 * @example guessScriptType('3...')    → 'p2sh-p2wpkh'
 * @example guessScriptType('1...')    → 'p2pkh'
 */
export function guessScriptType(address: string): CanonicalScriptType {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 'p2tr';
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) return 'p2wpkh';
  if (address.startsWith('3') || address.startsWith('2')) return 'p2sh-p2wpkh';
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) return 'p2pkh';
  return 'p2wpkh'; // Fallback
}

/**
 * Convert BIP derivation preset → AddressType.
 *
 * @example bipPresetToAddressType('bip84') → 'native_segwit'
 * @example bipPresetToAddressType('bip44') → 'legacy'
 */
export function bipPresetToAddressType(preset: string): AddressType {
  return _bipPresetToAddressType[preset] ?? ADDRESS_TYPES.NATIVE_SEGWIT;
}

/**
 * Convert an array of AddressType constants to their DB script type equivalents.
 *
 * @example addressTypesToScripts(['native_segwit', 'taproot']) → ['p2wpkh', 'p2tr']
 */
export function addressTypesToScripts(types: (AddressType | string)[]): CanonicalScriptType[] {
  return types.map(addressTypeToScript);
}
