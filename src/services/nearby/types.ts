/**
 * Nearby Payments — Type Definitions
 *
 * Types for the wireless tap-to-send Bitcoin feature.
 * Payload is exchanged between two devices via Nearby Connections
 * (MultipeerConnectivity on iOS / Google Nearby on Android),
 * with QR code as fallback.
 */

import type { BitcoinUnit } from '../../types';

// ============================================
// PAYLOAD
// ============================================

/** Versioned payment request payload exchanged between devices */
export interface NearbyPayload {
  /** Protocol version (always 1) */
  v: 1;
  /** Payload type */
  type: 'payment_request';
  /** UUID v4 — unique per session, replay protection */
  requestId: string;
  /** Unix ms — when payload was created */
  timestamp: number;
  /** Unix ms — payload expires (timestamp + 120_000) */
  expiresAt: number;
  /** Bitcoin network — must match sender's wallet */
  network: 'mainnet' | 'testnet';
  /** Bitcoin address (validated before signing) */
  address: string;
  /** Amount in satoshis (optional — receiver may not specify) */
  amountSats?: number;
  /** Display denomination chosen by receiver */
  displayDenomination?: BitcoinUnit | 'fiat';
  /** Amount as the receiver entered it (e.g. 10.00 for USD, 0.001 for BTC) */
  displayAmount?: number;
  /** Fiat currency code, present when displayDenomination is 'fiat' (e.g. 'USD') */
  displayCurrency?: string;
  /** Short memo / label — max 100 chars */
  memo?: string;
  /** Hex-encoded compressed secp256k1 public key (33 bytes) */
  ephemeralPubKey: string;
  /** Hex-encoded ECDSA signature over canonical payload */
  signature: string;
}

/** Payload fields minus the signature — used for canonical signing */
export type NearbyPayloadUnsigned = Omit<NearbyPayload, 'signature'>;

// ============================================
// DISCOVERED PEER
// ============================================

/** A nearby peer discovered during scanning/advertising (before connection) */
export interface DiscoveredPeer {
  peerId: string;
  displayName: string;
  discoveredAt: number; // Date.now()
}

// ============================================
// SESSION STATE MACHINE
// ============================================

export type NearbySessionState =
  | 'idle'
  | 'initializing'
  | 'advertising'   // Receiver: BLE peripheral active
  | 'scanning'      // Sender: BLE central scanning
  | 'connecting'    // Sender: found peripheral, connecting
  | 'exchanging'    // Data transfer in progress
  | 'validating'    // Parsing + verifying payload
  | 'pending_acceptance' // Receiver waiting for sender's accept/decline
  | 'completed'     // Success — payload delivered
  | 'error'         // Error with code + message
  | 'timeout'       // Scan/connection timed out
  | 'cancelled';    // User cancelled

export type NearbyMode = 'send' | 'receive';

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<NearbySessionState, NearbySessionState[]> = {
  idle:         ['initializing'],
  initializing: ['advertising', 'scanning', 'error'],
  advertising:  ['exchanging', 'timeout', 'cancelled', 'error'],
  scanning:     ['connecting', 'validating', 'timeout', 'cancelled', 'error'],
  connecting:   ['exchanging', 'validating', 'completed', 'error', 'timeout'],
  exchanging:   ['validating', 'pending_acceptance', 'completed', 'error'],
  validating:   ['completed', 'error'],
  pending_acceptance: ['completed', 'error', 'timeout', 'cancelled', 'idle'],
  completed:    ['idle'],
  error:        ['idle', 'initializing', 'scanning'],
  timeout:      ['idle', 'initializing', 'scanning'],
  cancelled:    ['idle'],
};

// ============================================
// ERROR CODES
// ============================================

export type NearbyErrorCode =
  | 'BLE_UNAVAILABLE'
  | 'BLE_PERMISSION_DENIED'
  | 'BLE_POWERED_OFF'
  | 'NEARBY_UNAVAILABLE'
  | 'SCAN_TIMEOUT'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_FAILED'
  | 'EXCHANGE_FAILED'
  | 'PAYLOAD_INVALID'
  | 'PAYLOAD_EXPIRED'
  | 'SIGNATURE_INVALID'
  | 'ADDRESS_INVALID'
  | 'NETWORK_MISMATCH'
  | 'AMOUNT_INVALID'
  | 'UNKNOWN';

export interface NearbyError {
  code: NearbyErrorCode;
  message: string;
}

/** Human-readable error messages */
export const ERROR_MESSAGES: Record<NearbyErrorCode, string> = {
  BLE_UNAVAILABLE: 'Bluetooth is not available on this device',
  BLE_PERMISSION_DENIED: 'Bluetooth permission was denied',
  BLE_POWERED_OFF: 'Please turn on Bluetooth to use Nearby',
  NEARBY_UNAVAILABLE: 'Nearby Connections is not available on this device',
  SCAN_TIMEOUT: 'No nearby devices found',
  CONNECTION_TIMEOUT: 'Connection timed out',
  CONNECTION_FAILED: 'Failed to connect to device',
  EXCHANGE_FAILED: 'Failed to exchange payment data',
  PAYLOAD_INVALID: 'Invalid payment request',
  PAYLOAD_EXPIRED: 'Payment request has expired',
  SIGNATURE_INVALID: 'Payment request signature is invalid',
  ADDRESS_INVALID: 'Invalid Bitcoin address in payment request',
  NETWORK_MISMATCH: 'Network mismatch — sender and receiver are on different networks',
  AMOUNT_INVALID: 'Invalid amount in payment request',
  UNKNOWN: 'An unexpected error occurred',
};

// ============================================
// BLE CONSTANTS
// ============================================

/** Custom 128-bit BLE service UUID for Nearby Payments */
export const BLE_SERVICE_UUID = 'B1TC0001-SEND-4BTC-NEAR-000000000000';

/** Characteristic UUID for payload data */
export const BLE_CHARACTERISTIC_UUID = 'B1TC0002-DATA-4BTC-NEAR-000000000000';

/** BLE scan timeout in milliseconds */
export const BLE_SCAN_TIMEOUT_MS = 30_000;

/** BLE connection timeout in milliseconds */
export const BLE_CONNECTION_TIMEOUT_MS = 10_000;

/** Nearby Connections scan/discovery timeout in milliseconds (60s for manual peer selection) */
export const NEARBY_SCAN_TIMEOUT_MS = 60_000;

/** Payload expiration window in milliseconds (10 minutes — allows time for manual peer selection) */
export const PAYLOAD_EXPIRY_MS = 600_000;

/** Maximum clock skew tolerance in milliseconds (15 minutes — generous for in-person payments) */
export const MAX_CLOCK_SKEW_MS = 900_000;

/** Minimum valid amount in satoshis (dust limit) */
export const MIN_AMOUNT_SATS = 546;

/** Maximum valid amount in satoshis (21M BTC) */
export const MAX_AMOUNT_SATS = 2_100_000_000_000_000;

/** Maximum memo length in characters */
export const MAX_MEMO_LENGTH = 100;

// ============================================
// TRANSPORT INTERFACE
// ============================================

/** Events emitted by a transport */
export interface NearbyTransportEvents {
  onPayloadReceived: (payload: NearbyPayload) => void;
  onPeerConnected: () => void;
  onPeerDisconnected: () => void;
  onError: (error: NearbyError) => void;
}
