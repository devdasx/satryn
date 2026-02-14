/**
 * NearbyPayloadCodec — Encode, decode, validate, sign, verify
 *
 * Handles the NearbyPayload lifecycle:
 * 1. Create unsigned payload with ephemeral keypair
 * 2. Sign with ephemeral private key
 * 3. Serialize to JSON (for BLE characteristic or QR)
 * 4. Deserialize + validate + verify signature on receiver side
 */

import * as ecc from '@bitcoinerlab/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { isValidBitcoinAddress } from '../../utils/validation';
import type { NearbyPayload, NearbyPayloadUnsigned, NearbyErrorCode } from './types';
import {
  PAYLOAD_EXPIRY_MS,
  MAX_CLOCK_SKEW_MS,
  MIN_AMOUNT_SATS,
  MAX_AMOUNT_SATS,
  MAX_MEMO_LENGTH,
} from './types';

// ============================================
// EPHEMERAL KEYPAIR
// ============================================

export interface EphemeralKeypair {
  privateKey: Uint8Array;  // 32 bytes
  publicKey: Uint8Array;   // 33 bytes (compressed)
}

/** Generate an ephemeral secp256k1 keypair for payload signing */
export function generateEphemeralKeypair(): EphemeralKeypair {
  let privateKey: Uint8Array;

  // Generate a valid secp256k1 private key
  for (let i = 0; i < 100; i++) {
    const candidate = new Uint8Array(32);
    globalThis.crypto.getRandomValues(candidate);
    if (ecc.isPrivate(candidate)) {
      privateKey = candidate;
      break;
    }
  }
  // Extremely unlikely to reach here, but TypeScript needs it
  if (!privateKey!) throw new Error('Failed to generate private key');

  const publicKey = ecc.pointFromScalar(privateKey);
  if (!publicKey) throw new Error('Failed to derive public key');

  return { privateKey, publicKey };
}

// ============================================
// UUID v4
// ============================================

function generateUUID(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================
// CANONICAL FORM
// ============================================

/** Build the canonical string for signing (deterministic key order) */
function getCanonical(payload: NearbyPayloadUnsigned): string {
  // Base fields always included
  const base: Record<string, unknown> = {
    address: payload.address,
    amountSats: payload.amountSats ?? null,
  };

  // Display fields only included when present (backward compat with v1 payloads
  // that don't have display fields — their canonical hash stays unchanged)
  if (payload.displayDenomination !== undefined) {
    base.displayAmount = payload.displayAmount ?? null;
    base.displayCurrency = payload.displayCurrency ?? null;
    base.displayDenomination = payload.displayDenomination ?? null;
  }

  return JSON.stringify({
    ...base,
    ephemeralPubKey: payload.ephemeralPubKey,
    expiresAt: payload.expiresAt,
    memo: payload.memo ?? null,
    network: payload.network,
    requestId: payload.requestId,
    timestamp: payload.timestamp,
    type: payload.type,
    v: payload.v,
  });
}

/** Hash the canonical string with SHA-256 */
function hashCanonical(payload: NearbyPayloadUnsigned): Uint8Array {
  const canonical = getCanonical(payload);
  return sha256(new TextEncoder().encode(canonical));
}

// ============================================
// CREATE + SIGN
// ============================================

export interface CreatePayloadParams {
  address: string;
  network: 'mainnet' | 'testnet';
  amountSats?: number;
  memo?: string;
  displayDenomination?: string; // BitcoinUnit or 'fiat'
  displayAmount?: number;
  displayCurrency?: string;
}

/**
 * Create a signed NearbyPayload ready for transmission.
 * Generates an ephemeral keypair, builds the payload, and signs it.
 * Returns the signed payload and the ephemeral keypair (caller should discard private key after use).
 */
export function createSignedPayload(
  params: CreatePayloadParams,
): { payload: NearbyPayload; keypair: EphemeralKeypair } {
  const keypair = generateEphemeralKeypair();
  const now = Date.now();

  const unsigned: NearbyPayloadUnsigned = {
    v: 1,
    type: 'payment_request',
    requestId: generateUUID(),
    timestamp: now,
    expiresAt: now + PAYLOAD_EXPIRY_MS,
    network: params.network,
    address: params.address,
    amountSats: params.amountSats,
    displayDenomination: params.displayDenomination as NearbyPayloadUnsigned['displayDenomination'],
    displayAmount: params.displayAmount,
    displayCurrency: params.displayCurrency,
    memo: params.memo?.slice(0, MAX_MEMO_LENGTH),
    ephemeralPubKey: Buffer.from(keypair.publicKey).toString('hex'),
  };

  const hash = hashCanonical(unsigned);
  const sigBytes = ecc.sign(hash, keypair.privateKey);
  const signature = Buffer.from(sigBytes).toString('hex');

  return {
    payload: { ...unsigned, signature },
    keypair,
  };
}

// ============================================
// SERIALIZE / DESERIALIZE
// ============================================

/** Serialize payload to JSON string (for BLE characteristic or QR) */
export function serializePayload(payload: NearbyPayload): string {
  return JSON.stringify(payload);
}

/** Deserialize JSON string to payload (no validation) */
export function deserializePayload(json: string): NearbyPayload | null {
  try {
    return JSON.parse(json) as NearbyPayload;
  } catch {
    return null;
  }
}

// ============================================
// VALIDATE + VERIFY
// ============================================

export type ValidationResult =
  | { valid: true; payload: NearbyPayload }
  | { valid: false; errorCode: NearbyErrorCode; errorMessage: string };

/**
 * Validate and verify a received NearbyPayload.
 * Checks all fields, expiration, address validity, and signature.
 *
 * @param raw - Raw JSON string or parsed object
 * @param expectedNetwork - The current wallet's network
 */
export function validatePayload(
  raw: string | NearbyPayload,
  expectedNetwork: 'mainnet' | 'testnet',
): ValidationResult {
  // Parse if string
  let payload: NearbyPayload;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Invalid JSON' };
    }
  } else {
    payload = raw;
  }

  // 1. Version check
  if (payload.v !== 1) {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Unsupported payload version' };
  }

  // 2. Type check
  if (payload.type !== 'payment_request') {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Unsupported payload type' };
  }

  // 3. Request ID format
  if (!payload.requestId || !UUID_V4_REGEX.test(payload.requestId)) {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Invalid request ID' };
  }

  // 4. Timestamp — within clock skew tolerance
  const now = Date.now();
  if (typeof payload.timestamp !== 'number' || Math.abs(now - payload.timestamp) > MAX_CLOCK_SKEW_MS) {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Timestamp out of range' };
  }

  // 5. Expiration
  if (typeof payload.expiresAt !== 'number') {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Missing expiration' };
  }
  if (payload.expiresAt <= payload.timestamp || payload.expiresAt > payload.timestamp + PAYLOAD_EXPIRY_MS) {
    return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Invalid expiration window' };
  }
  if (now > payload.expiresAt) {
    return { valid: false, errorCode: 'PAYLOAD_EXPIRED', errorMessage: 'Payment request has expired' };
  }

  // 6. Address validation
  if (!payload.address || typeof payload.address !== 'string') {
    return { valid: false, errorCode: 'ADDRESS_INVALID', errorMessage: 'Missing address' };
  }
  if (!isValidBitcoinAddress(payload.address, payload.network)) {
    return { valid: false, errorCode: 'ADDRESS_INVALID', errorMessage: 'Invalid Bitcoin address' };
  }

  // 7. Network match
  if (payload.network !== expectedNetwork) {
    return { valid: false, errorCode: 'NETWORK_MISMATCH', errorMessage: `Expected ${expectedNetwork}, got ${payload.network}` };
  }

  // 8. Amount validation (if present)
  if (payload.amountSats !== undefined && payload.amountSats !== null) {
    if (typeof payload.amountSats !== 'number' || !Number.isInteger(payload.amountSats)) {
      return { valid: false, errorCode: 'AMOUNT_INVALID', errorMessage: 'Amount must be an integer' };
    }
    if (payload.amountSats < MIN_AMOUNT_SATS) {
      return { valid: false, errorCode: 'AMOUNT_INVALID', errorMessage: `Amount below dust limit (${MIN_AMOUNT_SATS} sats)` };
    }
    if (payload.amountSats > MAX_AMOUNT_SATS) {
      return { valid: false, errorCode: 'AMOUNT_INVALID', errorMessage: 'Amount exceeds maximum' };
    }
  }

  // 9. Memo validation (if present)
  if (payload.memo !== undefined && payload.memo !== null) {
    if (typeof payload.memo !== 'string') {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Invalid memo type' };
    }
    if (payload.memo.length > MAX_MEMO_LENGTH) {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Memo exceeds maximum length' };
    }
    // Reject control characters (except newlines)
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(payload.memo)) {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Memo contains invalid characters' };
    }
  }

  // 10. Display fields validation (if present)
  if (payload.displayDenomination !== undefined) {
    if (!['btc', 'mbtc', 'ubtc', 'sat', 'cbtc', 'dbtc', 'sats', 'fiat'].includes(payload.displayDenomination)) {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Invalid display denomination' };
    }
    if (payload.displayDenomination === 'fiat' && (!payload.displayCurrency || typeof payload.displayCurrency !== 'string')) {
      return { valid: false, errorCode: 'PAYLOAD_INVALID', errorMessage: 'Fiat denomination requires display currency' };
    }
    if (payload.displayAmount !== undefined && (typeof payload.displayAmount !== 'number' || payload.displayAmount < 0)) {
      return { valid: false, errorCode: 'AMOUNT_INVALID', errorMessage: 'Invalid display amount' };
    }
  }

  // 11. Ephemeral public key validation
  if (!payload.ephemeralPubKey || typeof payload.ephemeralPubKey !== 'string') {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Missing ephemeral public key' };
  }
  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = Uint8Array.from(Buffer.from(payload.ephemeralPubKey, 'hex'));
  } catch {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Invalid ephemeral public key encoding' };
  }
  if (pubKeyBytes.length !== 33) {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Ephemeral public key must be 33 bytes (compressed)' };
  }
  if (!ecc.isPoint(pubKeyBytes)) {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Ephemeral public key is not a valid curve point' };
  }

  // 12. Signature verification
  if (!payload.signature || typeof payload.signature !== 'string') {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Missing signature' };
  }
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(Buffer.from(payload.signature, 'hex'));
  } catch {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Invalid signature encoding' };
  }

  // Build unsigned version for hash
  const { signature: _, ...unsigned } = payload;
  const hash = hashCanonical(unsigned);

  if (!ecc.verify(hash, pubKeyBytes, sigBytes)) {
    return { valid: false, errorCode: 'SIGNATURE_INVALID', errorMessage: 'Signature verification failed' };
  }

  return { valid: true, payload };
}

// ============================================
// CONFIRMATION CODE
// ============================================

/**
 * Derive a 6-digit confirmation code from a requestId.
 * Both receiver and sender compute this from the shared payload.
 * The receiver displays it; the sender must enter it to confirm.
 */
export function deriveConfirmationCode(requestId: string): string {
  const hash = sha256(new TextEncoder().encode(requestId));
  const num = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
  return (num % 1000000).toString().padStart(6, '0');
}
