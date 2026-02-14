/**
 * Nearby Payments — Module Exports
 */

// Types
export type {
  NearbyPayload,
  NearbyPayloadUnsigned,
  NearbySessionState,
  NearbyMode,
  NearbyErrorCode,
  NearbyError,
  NearbyTransportEvents,
} from './types';

export {
  VALID_TRANSITIONS,
  ERROR_MESSAGES,
  BLE_SERVICE_UUID,
  BLE_CHARACTERISTIC_UUID,
  BLE_SCAN_TIMEOUT_MS,
  BLE_CONNECTION_TIMEOUT_MS,
  NEARBY_SCAN_TIMEOUT_MS,
  PAYLOAD_EXPIRY_MS,
  MAX_CLOCK_SKEW_MS,
  MIN_AMOUNT_SATS,
  MAX_AMOUNT_SATS,
  MAX_MEMO_LENGTH,
} from './types';

// Payload Codec
export {
  generateEphemeralKeypair,
  createSignedPayload,
  serializePayload,
  deserializePayload,
  validatePayload,
} from './NearbyPayloadCodec';
export type { EphemeralKeypair, CreatePayloadParams, ValidationResult } from './NearbyPayloadCodec';

// Transport Interface
export type { NearbyTransport, NearbyTransportCallbacks } from './NearbyTransport';

// Expo Nearby Transport
export { ExpoNearbyTransport } from './ExpoNearbyTransport';

// QR Transport
export { encodeNearbyQR, decodeNearbyQR, isNearbyDeepLink } from './QRTransport';

// Logger
export { NearbyLogger } from './NearbyLogger';
