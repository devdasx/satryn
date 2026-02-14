/**
 * QRTransport — QR code fallback for Nearby Payments
 *
 * Encodes a NearbyPayload into a satryn://nearby URL for QR display.
 * Decodes a scanned URL back into a NearbyPayload.
 * Used as fallback when BLE is unavailable.
 */

import type { NearbyPayload } from './types';
import { serializePayload, deserializePayload } from './NearbyPayloadCodec';

const SCHEME = 'satryn';
const NEARBY_PATH = 'nearby';

// ============================================
// BASE64URL
// ============================================

function base64urlEncode(str: string): string {
  const b64 = Buffer.from(str, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(encoded: string): string {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf-8');
}

// ============================================
// ENCODE / DECODE
// ============================================

/** Encode a NearbyPayload into a satryn://nearby?data=... URL */
export function encodeNearbyQR(payload: NearbyPayload): string {
  const json = serializePayload(payload);
  const encoded = base64urlEncode(json);
  return `${SCHEME}://${NEARBY_PATH}?data=${encoded}`;
}

/** Decode a satryn://nearby URL into a NearbyPayload (no validation) */
export function decodeNearbyQR(url: string): NearbyPayload | null {
  try {
    const lower = url.toLowerCase();
    if (!lower.startsWith(`${SCHEME}://${NEARBY_PATH}`)) return null;

    const queryStart = url.indexOf('?');
    if (queryStart === -1) return null;

    const params = new URLSearchParams(url.slice(queryStart));
    const data = params.get('data');
    if (!data) return null;

    const json = base64urlDecode(data);
    return deserializePayload(json);
  } catch {
    return null;
  }
}

/** Check if a URL is a satryn://nearby deep link */
export function isNearbyDeepLink(url: string): boolean {
  return url.toLowerCase().startsWith(`${SCHEME}://${NEARBY_PATH}`);
}
