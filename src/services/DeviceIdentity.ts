/**
 * DeviceIdentity — stable per-installation device identifier
 *
 * Generates a UUID on first launch and persists it in SecureStore (Keychain).
 * Survives app updates. Transfers with iOS device migration (Keychain sync).
 * Deleted on app uninstall/reinstall (new UUID generated).
 *
 * Used to tag iCloud backups so they only appear on the device that created them.
 */

import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../constants';

let cachedDeviceId: string | null = null;

/** Async: get or create the device ID. Call once at app startup. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
  if (!id) {
    id = generateUUID();
    await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, id);
  }
  cachedDeviceId = id;
  return id;
}

/** Sync: returns cached device ID, or null if not yet initialized. */
export function getDeviceIdSync(): string | null {
  return cachedDeviceId;
}

function generateUUID(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // Set version 4 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
