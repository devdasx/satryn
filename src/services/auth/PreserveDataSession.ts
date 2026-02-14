/**
 * PreserveDataSession — Keychain-backed storage for the preserve-data encryption password.
 *
 * When the user enables "Preserve Data on Delete", they set a password that is
 * used to encrypt wallet snapshots in the iOS Keychain. This password is
 * different from the app PIN.
 *
 * The password is stored persistently in the iOS Keychain (same pattern as
 * BIOMETRIC_PIN in SecureStorage). This means:
 *   - It survives app termination and restart (background archival keeps working)
 *   - It survives app deletion and reinstall (user can restore with the same password)
 *   - It is hardware-encrypted at rest by the Secure Enclave
 *
 * On app launch, call loadFromKeychain() to hydrate the in-memory cache.
 * ContinuousArchivalManager reads the password synchronously via getPassword().
 */

import * as SecureStore from 'expo-secure-store';

const KEYCHAIN_KEY = 'preserve_data_password';
const KEYCHAIN_OPTS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** In-memory cache for synchronous access by ContinuousArchivalManager */
let cachedPassword: string | null = null;

/** Helper: fingerprint for logs (first 3 + last 2 chars, length) — never log full password */
function fp(pw: string | null): string {
  if (!pw) return '<null>';
  if (pw.length <= 5) return `"${pw[0]}***${pw[pw.length - 1]}" (len=${pw.length})`;
  return `"${pw.slice(0, 3)}***${pw.slice(-2)}" (len=${pw.length})`;
}

export const PreserveDataSession = {
  /**
   * Store the password in both Keychain and memory.
   * Called when the user creates/changes their preserve-data password,
   * or after successful restoration (we know the password works).
   */
  async setPassword(password: string): Promise<void> {
    cachedPassword = password;
    try {
      await SecureStore.setItemAsync(KEYCHAIN_KEY, password, KEYCHAIN_OPTS);
      // Verify by reading back
      const readBack = await SecureStore.getItemAsync(KEYCHAIN_KEY, KEYCHAIN_OPTS);
    } catch (error) {
    }
  },

  /**
   * Return the cached password (synchronous).
   * Returns null if not loaded or not set.
   */
  getPassword(): string | null {
    return cachedPassword;
  },

  /**
   * Load the password from Keychain into memory.
   * Call once on app startup (e.g. in _layout.tsx) so that
   * ContinuousArchivalManager has the password available.
   */
  async loadFromKeychain(): Promise<void> {
    try {
      const password = await SecureStore.getItemAsync(KEYCHAIN_KEY, KEYCHAIN_OPTS);
      cachedPassword = password;
    } catch (error) {
      cachedPassword = null;
    }
  },

  /**
   * Check if a password exists in Keychain (without loading it into memory
   * if it's not already there — but this also loads it).
   */
  async hasPassword(): Promise<boolean> {
    try {
      const password = await SecureStore.getItemAsync(KEYCHAIN_KEY, KEYCHAIN_OPTS);
      if (password) {
        cachedPassword = password;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  /**
   * Clear the password from both memory and Keychain.
   * Called when the user disables "Preserve Data on Delete".
   */
  async clear(): Promise<void> {
    cachedPassword = null;
    try {
      await SecureStore.deleteItemAsync(KEYCHAIN_KEY, KEYCHAIN_OPTS);
    } catch (error) {
    }
  },
};
