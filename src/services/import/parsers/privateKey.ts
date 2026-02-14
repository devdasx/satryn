/**
 * Private Key Parser
 *
 * Parses all single private key formats (mainnet only):
 * - WIF compressed (K/L prefix)
 * - WIF uncompressed (5 prefix)
 * - Hex (64 hex chars)
 * - Decimal integer
 * - Base64 (32 bytes)
 * - Mini private key (S prefix)
 *
 * SECURITY: Never logs raw key material. All errors use safe messages.
 */

import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import { sha256 } from '@noble/hashes/sha256';
import type { ImportResult, SuggestedScriptType } from '../types';
import { ImportError } from '../types';
import { safeLog, zeroizeBuffer } from '../security';

const ECPair = ECPairFactory(ecc);

// secp256k1 curve order
const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

/** Mainnet WIF version byte */
const MAINNET_WIF_VERSION = 0x80;
/** Testnet WIF version byte */
const TESTNET_WIF_VERSION = 0xef;

// ============================================
// WIF (Wallet Import Format)
// ============================================

export interface WIFResult {
  privateKey: Uint8Array;
  compressed: boolean;
  wif: string;
}

/**
 * Parse a WIF-encoded private key (mainnet only).
 * WIF compressed: starts with K or L (52 chars)
 * WIF uncompressed: starts with 5 (51 chars)
 *
 * @throws ImportError for testnet or invalid format
 */
export function parseWIF(wif: string): WIFResult {
  const trimmed = wif.trim();

  try {
    const keyPair = ECPair.fromWIF(trimmed, bitcoin.networks.bitcoin);
    const privateKey = keyPair.privateKey;

    if (!privateKey) {
      throw new ImportError('INVALID_FORMAT', 'Could not extract private key from WIF');
    }

    return {
      privateKey: new Uint8Array(privateKey),
      compressed: keyPair.compressed,
      wif: trimmed,
    };
  } catch (error: any) {
    // Check if it's a testnet key
    try {
      ECPair.fromWIF(trimmed, bitcoin.networks.testnet);
      throw new ImportError('TESTNET_REJECTED', 'Testnet keys are not supported. This app is mainnet only.');
    } catch (testnetError: any) {
      if (testnetError instanceof ImportError) throw testnetError;
    }

    throw new ImportError('INVALID_FORMAT', 'Invalid WIF format');
  }
}

// ============================================
// Hex Private Key (64 hex chars = 32 bytes)
// ============================================

/**
 * Parse a hex-encoded private key (64 hex characters).
 * Validates the key is on the secp256k1 curve.
 */
export function parseHexPrivateKey(hex: string): Uint8Array {
  const trimmed = hex.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    throw new ImportError('INVALID_FORMAT', 'Expected 64 hex characters');
  }

  const bytes = Buffer.from(trimmed, 'hex');
  validateKeyOnCurve(bytes);

  return new Uint8Array(bytes);
}

// ============================================
// Decimal Integer
// ============================================

/**
 * Parse a decimal integer private key.
 * The decimal must represent a valid secp256k1 private key (1 < n < order).
 */
export function parseDecimalPrivateKey(decimal: string): Uint8Array {
  const trimmed = decimal.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new ImportError('INVALID_FORMAT', 'Expected a decimal integer');
  }

  let value: bigint;
  try {
    value = BigInt(trimmed);
  } catch {
    throw new ImportError('INVALID_FORMAT', 'Invalid decimal number');
  }

  if (value <= 0n || value >= SECP256K1_ORDER) {
    throw new ImportError('INVALID_KEY_ON_CURVE', 'Key value is outside the valid range');
  }

  // Convert BigInt to 32-byte buffer (big-endian)
  const hex = value.toString(16).padStart(64, '0');
  const bytes = Buffer.from(hex, 'hex');

  return new Uint8Array(bytes);
}

// ============================================
// Base64 Private Key (32 bytes)
// ============================================

/**
 * Parse a base64-encoded private key (must decode to exactly 32 bytes).
 */
export function parseBase64PrivateKey(b64: string): Uint8Array {
  const trimmed = b64.trim();

  let bytes: Buffer;
  try {
    bytes = Buffer.from(trimmed, 'base64');
  } catch {
    throw new ImportError('INVALID_FORMAT', 'Invalid base64 encoding');
  }

  if (bytes.length !== 32) {
    throw new ImportError('INVALID_FORMAT', `Expected 32 bytes, got ${bytes.length}`);
  }

  validateKeyOnCurve(bytes);

  return new Uint8Array(bytes);
}

// ============================================
// Mini Private Key
// ============================================

/**
 * Parse a mini private key format.
 * Mini keys start with 'S' and are typically 22 or 30 characters.
 * Validation: SHA256(key + '?')[0] must equal 0x00.
 * The actual private key is SHA256(key).
 */
export function parseMiniPrivateKey(mini: string): Uint8Array {
  const trimmed = mini.trim();

  // Validate format: starts with S, 22 or 30 chars
  if (!/^S[1-9A-HJ-NP-Za-km-z]{21,29}$/.test(trimmed)) {
    throw new ImportError('INVALID_FORMAT', 'Invalid mini private key format');
  }

  // Validation check: SHA256(key + '?')[0] === 0x00
  const checkHash = sha256(Buffer.from(trimmed + '?', 'utf8'));
  if (checkHash[0] !== 0x00) {
    throw new ImportError('INVALID_CHECKSUM', 'Mini private key validation failed');
  }

  // The private key is SHA256(key)
  const privateKey = sha256(Buffer.from(trimmed, 'utf8'));
  validateKeyOnCurve(Buffer.from(privateKey));

  return new Uint8Array(privateKey);
}

// ============================================
// Key Validation
// ============================================

/**
 * Validate that a 32-byte buffer is a valid secp256k1 private key.
 * Must be: 0 < key < secp256k1 curve order
 */
function validateKeyOnCurve(keyBytes: Buffer | Uint8Array): void {
  if (keyBytes.length !== 32) {
    throw new ImportError('INVALID_FORMAT', 'Private key must be 32 bytes');
  }

  // Check it's not all zeros
  let allZero = true;
  for (const byte of keyBytes) {
    if (byte !== 0) { allZero = false; break; }
  }
  if (allZero) {
    throw new ImportError('INVALID_KEY_ON_CURVE', 'Private key cannot be zero');
  }

  // Convert to BigInt and check against curve order
  const hex = Buffer.from(keyBytes).toString('hex');
  const value = BigInt('0x' + hex);

  if (value >= SECP256K1_ORDER) {
    throw new ImportError('INVALID_KEY_ON_CURVE', 'Key value exceeds curve order');
  }
}

// ============================================
// Unified Parser
// ============================================

/**
 * Detect and parse any single private key format.
 * Returns an ImportResult ready for wallet creation.
 *
 * @param input - Raw key input (WIF, hex, base64, decimal, or mini)
 * @param scriptType - Desired address type for the imported key
 */
export function parsePrivateKey(
  input: string,
  scriptType: SuggestedScriptType = 'native_segwit'
): ImportResult {
  const trimmed = input.trim();

  // Try WIF first (most common format)
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) {
    safeLog('parsePrivateKey: detected WIF format');
    const result = parseWIF(trimmed);
    return wifToImportResult(result, scriptType);
  }

  // Mini private key (starts with S)
  if (/^S[1-9A-HJ-NP-Za-km-z]{21,29}$/.test(trimmed)) {
    safeLog('parsePrivateKey: detected mini private key format');
    const privateKey = parseMiniPrivateKey(trimmed);
    return privateKeyToImportResult(privateKey, true, 'mini_privkey', scriptType);
  }

  // Hex (64 hex chars)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    safeLog('parsePrivateKey: detected hex format');
    const privateKey = parseHexPrivateKey(trimmed);
    return privateKeyToImportResult(privateKey, true, 'hex_privkey', scriptType);
  }

  // Base64 (44 chars with padding, decodes to 32 bytes)
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    safeLog('parsePrivateKey: detected base64 format');
    const privateKey = parseBase64PrivateKey(trimmed);
    return privateKeyToImportResult(privateKey, true, 'base64_privkey', scriptType);
  }

  // Decimal integer (very large number)
  if (/^\d{1,78}$/.test(trimmed) && trimmed.length >= 10) {
    safeLog('parsePrivateKey: detected decimal format');
    const privateKey = parseDecimalPrivateKey(trimmed);
    return privateKeyToImportResult(privateKey, true, 'decimal_privkey', scriptType);
  }

  throw new ImportError('INVALID_FORMAT', 'Unrecognized private key format');
}

// ============================================
// Helpers
// ============================================

function derivePreviewAddress(
  pubkey: Buffer | Uint8Array,
  scriptType: SuggestedScriptType,
): string | undefined {
  // Ensure we have a Buffer for bitcoinjs-lib
  const pubkeyBuf = Buffer.from(pubkey);
  const network = bitcoin.networks.bitcoin;
  try {
    switch (scriptType) {
      case 'native_segwit':
        return bitcoin.payments.p2wpkh({ pubkey: pubkeyBuf, network }).address;
      case 'wrapped_segwit': {
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: pubkeyBuf, network });
        return bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address;
      }
      case 'legacy':
        return bitcoin.payments.p2pkh({ pubkey: pubkeyBuf, network }).address;
      case 'taproot': {
        bitcoin.initEccLib(ecc);
        const xOnly = pubkeyBuf.subarray(1, 33);
        return bitcoin.payments.p2tr({ internalPubkey: xOnly, network }).address;
      }
      default:
        return bitcoin.payments.p2wpkh({ pubkey: pubkeyBuf, network }).address;
    }
  } catch {
    return undefined;
  }
}

function wifToImportResult(
  result: WIFResult,
  scriptType: SuggestedScriptType
): ImportResult {
  const keyPair = ECPair.fromPrivateKey(Buffer.from(result.privateKey), {
    compressed: result.compressed,
    network: bitcoin.networks.bitcoin,
  });
  const previewAddress = derivePreviewAddress(keyPair.publicKey, scriptType);

  return {
    type: 'single_key',
    sourceFormat: result.compressed ? 'wif_compressed' : 'wif_uncompressed',
    privateKeyWIF: result.wif,
    privateKeyBuffer: result.privateKey,
    compressed: result.compressed,
    suggestedScriptType: scriptType,
    suggestedName: 'Imported Key',
    previewAddress,
  };
}

function privateKeyToImportResult(
  privateKey: Uint8Array,
  compressed: boolean,
  sourceFormat: ImportResult['sourceFormat'],
  scriptType: SuggestedScriptType
): ImportResult {
  // Convert raw key to WIF for storage
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey), {
    compressed,
    network: bitcoin.networks.bitcoin,
  });
  const previewAddress = derivePreviewAddress(keyPair.publicKey, scriptType);

  return {
    type: 'single_key',
    sourceFormat,
    privateKeyWIF: keyPair.toWIF(),
    privateKeyBuffer: privateKey,
    compressed,
    suggestedScriptType: scriptType,
    suggestedName: 'Imported Key',
    previewAddress,
  };
}
