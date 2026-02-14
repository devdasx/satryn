/**
 * NearbyLogger — Structured logging for Nearby Payments
 *
 * Provides tagged, structured logging for debugging nearby sessions.
 * All logs are prefixed with [Nearby] for easy filtering.
 * All logging is gated behind __DEV__ to prevent production leaks.
 */

import type { NearbySessionState, NearbyErrorCode } from './types';

const TAG = '[Nearby]';

export const NearbyLogger = {
  /** Log session state transition */
  transition(from: NearbySessionState, to: NearbySessionState) {
    if (__DEV__) console.log(`${TAG} State: ${from} → ${to}`);
  },

  /** Log session start */
  sessionStart(mode: 'send' | 'receive', requestId?: string) {
    if (__DEV__) console.log(`${TAG} Session started: mode=${mode}${requestId ? ` requestId=${requestId}` : ''}`);
  },

  /** Log session end */
  sessionEnd(reason: 'completed' | 'error' | 'timeout' | 'cancelled') {
    if (__DEV__) console.log(`${TAG} Session ended: reason=${reason}`);
  },

  /** Log BLE event */
  ble(event: string, details?: Record<string, unknown>) {
    if (__DEV__) {
      const extra = details ? ` ${JSON.stringify(details)}` : '';
      console.log(`${TAG} BLE: ${event}${extra}`);
    }
  },

  /** Log Nearby Connections event */
  nearby(event: string, details?: Record<string, unknown>) {
    if (__DEV__) {
      const extra = details ? ` ${JSON.stringify(details)}` : '';
      console.log(`${TAG} Nearby: ${event}${extra}`);
    }
  },

  /** Log payload event */
  payload(event: string, details?: Record<string, unknown>) {
    if (__DEV__) {
      const extra = details ? ` ${JSON.stringify(details)}` : '';
      console.log(`${TAG} Payload: ${event}${extra}`);
    }
  },

  /** Log validation result */
  validation(success: boolean, errorCode?: NearbyErrorCode, details?: string) {
    if (__DEV__) {
      if (success) {
        console.log(`${TAG} Validation: passed`);
      } else {
        console.warn(`${TAG} Validation: failed — ${errorCode}${details ? `: ${details}` : ''}`);
      }
    }
  },

  /** Log error */
  error(code: NearbyErrorCode, message: string, nativeError?: unknown) {
    if (__DEV__) {
      // BLE_UNAVAILABLE / NEARBY_UNAVAILABLE expected in Expo Go / Simulator — don't show red LogBox
      if (code === 'BLE_UNAVAILABLE' || code === 'NEARBY_UNAVAILABLE') {
        console.warn(`${TAG} [${code}]: ${message}`);
      } else {
        console.error(`${TAG} Error [${code}]: ${message}`, nativeError ?? '');
      }
    }
  },

  /** Log debug info (only in __DEV__) */
  debug(message: string, data?: unknown) {
    if (__DEV__) {
      console.log(`${TAG} [DEBUG] ${message}`, data ?? '');
    }
  },
};
