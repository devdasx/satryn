/**
 * Contact Migration Utility
 * One-time migration from legacy AddressBookEntry[] to new Contact[]
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AddressBookEntry } from '../types';
import type { Contact } from '../types/contacts';

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert legacy AddressBookEntry array to new Contact array
 */
export function convertLegacyEntries(entries: AddressBookEntry[]): Contact[] {
  const now = Date.now();
  return entries.map((entry) => ({
    id: generateId(),
    name: entry.label,
    tags: [],
    notes: entry.note,
    isFavorite: false,
    addresses: [
      {
        id: generateId(),
        address: entry.address,
        isDefault: true,
        createdAt: entry.createdAt,
      },
    ],
    createdAt: entry.createdAt,
    updatedAt: now,
  }));
}

/**
 * Read legacy address book data from AsyncStorage
 * Returns null if no legacy data exists
 */
export async function readLegacyAddressBook(): Promise<AddressBookEntry[] | null> {
  try {
    const raw = await AsyncStorage.getItem('address-book-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Zustand persist wraps state in { state: { entries: [...] }, version: 0 }
    const entries = parsed?.state?.entries;
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries;
  } catch {
    return null;
  }
}

/**
 * Run the full migration: read legacy data, convert, return contacts
 * Does NOT modify the legacy store (safe, non-destructive)
 */
export async function migrateAddressBook(): Promise<Contact[]> {
  const legacyEntries = await readLegacyAddressBook();
  if (!legacyEntries) return [];
  return convertLegacyEntries(legacyEntries);
}
