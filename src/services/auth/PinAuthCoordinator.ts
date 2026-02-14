/**
 * PinAuthCoordinator — Centralized PIN policy and lockout management.
 *
 * Manages PIN policy (4-digit, 6-digit, or variable-length),
 * tracks failed authentication attempts, and enforces progressive lockout.
 *
 * Progressive lockout schedule:
 *   5 failures → 30 seconds
 *   8 failures → 1 minute
 *  10 failures → 5 minutes
 *  12 failures → 30 minutes
 *  14 failures → 1 hour (repeating, with app-reset option)
 *
 * SECURITY: Lockout state is stored in iOS Keychain via expo-secure-store
 * so it persists across app restart, reinstall, and force-close.
 * PIN policy remains in AsyncStorage (not security-critical).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { SECURITY, STORAGE_KEYS } from '../../constants';
import type { PinPolicy } from '../../constants';
import { SecureStorage } from '../storage/SecureStorage';

// ─── Keychain options ────────────────────────────────────────
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ─── Lockout thresholds ────────────────────────────────────────
// 30s, 1m, 5m, 30m, 1h
const LOCKOUT_THRESHOLDS = [
  { attempts: SECURITY.MAX_PIN_ATTEMPTS, duration: SECURITY.LOCKOUT_DURATIONS[0] }, // 5 → 30s
  { attempts: 8,  duration: SECURITY.LOCKOUT_DURATIONS[1] }, // 8 → 60s
  { attempts: 10, duration: SECURITY.LOCKOUT_DURATIONS[2] }, // 10 → 300s
  { attempts: 12, duration: SECURITY.LOCKOUT_DURATIONS[3] }, // 12 → 1800s
  { attempts: 14, duration: SECURITY.LOCKOUT_DURATIONS[4] }, // 14+ → 3600s (repeating)
];

// ─── Keychain helpers ────────────────────────────────────────
async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, SECURE_OPTIONS);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_OPTIONS);
  } catch {
    // Keychain write failed — nothing we can do
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
  } catch {
    // Keychain delete failed — nothing we can do
  }
}

// ─── Public API ────────────────────────────────────────────────

export const PinAuthCoordinator = {
  /**
   * Get stored PIN policy. Defaults to 'fixed6' for backward compatibility.
   */
  async getPinPolicy(): Promise<PinPolicy> {
    const value = await AsyncStorage.getItem(STORAGE_KEYS.PIN_POLICY);
    if (value === 'fixed4' || value === 'fixed6' || value === 'variable') {
      return value;
    }
    return 'fixed6';
  },

  /**
   * Store PIN policy.
   */
  async setPinPolicy(policy: PinPolicy): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.PIN_POLICY, policy);
  },

  /**
   * Get expected PIN length for the current policy.
   * Returns null for variable-length PINs.
   */
  async getPinLength(): Promise<number | null> {
    const policy = await this.getPinPolicy();
    switch (policy) {
      case 'fixed4': return 4;
      case 'fixed6': return 6;
      case 'variable': return null;
    }
  },

  /**
   * Record a failed PIN attempt and check if lockout should be applied.
   * Stored in Keychain — persists across reinstall.
   */
  async recordFailedAttempt(): Promise<{
    locked: boolean;
    lockoutSeconds: number;
    attempts: number;
    canReset: boolean;
  }> {
    const raw = await secureGet(STORAGE_KEYS.PIN_FAILED_ATTEMPTS);
    const attempts = (raw ? parseInt(raw, 10) : 0) + 1;
    await secureSet(STORAGE_KEYS.PIN_FAILED_ATTEMPTS, String(attempts));

    // Find applicable lockout threshold (highest matching)
    let lockoutDuration = 0;
    for (const threshold of LOCKOUT_THRESHOLDS) {
      if (attempts >= threshold.attempts) {
        lockoutDuration = threshold.duration;
      }
    }

    if (lockoutDuration > 0) {
      const until = Date.now() + lockoutDuration * 1000;
      await secureSet(STORAGE_KEYS.PIN_LOCKOUT_UNTIL, String(until));
      // Allow reset when lockout reaches 1 hour (14+ attempts)
      const canReset = attempts >= 14;
      return { locked: true, lockoutSeconds: lockoutDuration, attempts, canReset };
    }

    return { locked: false, lockoutSeconds: 0, attempts, canReset: false };
  },

  /**
   * Reset failed attempt counter after successful authentication.
   */
  async resetFailedAttempts(): Promise<void> {
    await secureDelete(STORAGE_KEYS.PIN_FAILED_ATTEMPTS);
    await secureDelete(STORAGE_KEYS.PIN_LOCKOUT_UNTIL);
  },

  /**
   * Get current lockout state.
   * Reads from Keychain — survives app restart/reinstall.
   */
  async getLockoutState(): Promise<{
    locked: boolean;
    remainingSeconds: number;
    attempts: number;
    canReset: boolean;
  }> {
    const [attemptsRaw, untilRaw] = await Promise.all([
      secureGet(STORAGE_KEYS.PIN_FAILED_ATTEMPTS),
      secureGet(STORAGE_KEYS.PIN_LOCKOUT_UNTIL),
    ]);

    const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
    const until = untilRaw ? parseInt(untilRaw, 10) : 0;
    const now = Date.now();
    const canReset = attempts >= 14;

    if (until > now) {
      return {
        locked: true,
        remainingSeconds: Math.ceil((until - now) / 1000),
        attempts,
        canReset,
      };
    }

    // Lockout has expired — clear it but keep attempt count
    if (until > 0) {
      await secureDelete(STORAGE_KEYS.PIN_LOCKOUT_UNTIL);
    }

    return { locked: false, remainingSeconds: 0, attempts, canReset };
  },

  /**
   * Full app reset — wipe everything: Keychain, AsyncStorage, all state.
   * Called when user chooses to reset after max lockout.
   */
  async fullAppReset(): Promise<void> {
    // Preserve server reputation data across full reset
    const serverCache = await AsyncStorage.getItem('electrum_server_ccache').catch(() => null);
    // Clear all AsyncStorage
    await AsyncStorage.clear().catch(() => {});
    // Restore server reputation data (must survive any reset)
    if (serverCache) {
      await AsyncStorage.setItem('electrum_server_ccache', serverCache).catch(() => {});
    }
    // Clear all Keychain data (seeds, PIN, biometrics, accounts, etc.)
    await SecureStorage.deleteWallet().catch(() => {});
  },
};
