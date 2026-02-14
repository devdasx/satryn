/**
 * Address Book Store — DB-backed
 *
 * Uses SQLite `app_config` table (key: 'address_book') as the source of truth.
 * Zustand provides in-memory reactivity for React components.
 * On app start, `loadAddressBookFromDB()` hydrates state from the database.
 * One-time migration from AsyncStorage (legacy) if DB has no address book.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';
import type { AddressBookEntry } from '../types';

const DB_CONFIG_KEY = 'address_book';

interface AddressBookState {
  entries: AddressBookEntry[];
  addEntry: (address: string, label: string, note?: string) => void;
  updateEntry: (id: string, updates: Partial<Pick<AddressBookEntry, 'label' | 'note'>>) => void;
  removeEntry: (id: string) => void;
  getEntryByAddress: (address: string) => AddressBookEntry | undefined;
  markUsed: (address: string) => void;
}

export const useAddressBookStore = create<AddressBookState>()(
  (set, get) => ({
    entries: [],

    addEntry: (address, label, note) => {
      const existing = get().entries.find(e => e.address === address);
      if (existing) return; // Don't add duplicates
      const entry: AddressBookEntry = {
        id: `ab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address,
        label,
        note,
        createdAt: Date.now(),
      };
      set(state => {
        const entries = [...state.entries, entry];
        _saveToDb(entries);
        return { entries };
      });
    },

    updateEntry: (id, updates) => {
      set(state => {
        const entries = state.entries.map(e =>
          e.id === id ? { ...e, ...updates } : e
        );
        _saveToDb(entries);
        return { entries };
      });
    },

    removeEntry: (id) => {
      set(state => {
        const entries = state.entries.filter(e => e.id !== id);
        _saveToDb(entries);
        return { entries };
      });
    },

    getEntryByAddress: (address) => {
      return get().entries.find(e => e.address === address);
    },

    markUsed: (address) => {
      set(state => {
        const entries = state.entries.map(e =>
          e.address === address ? { ...e, lastUsed: Date.now() } : e
        );
        _saveToDb(entries);
        return { entries };
      });
    },
  })
);

// ── Write to DB ──────────────────────────────────────────────────────

let _writeTimer: ReturnType<typeof setTimeout> | null = null;

function _saveToDb(entries: AddressBookEntry[]): void {
  // Debounce writes
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    try {
      const db = WalletDatabase.shared();
      db.setConfig(DB_CONFIG_KEY, JSON.stringify(entries));
    } catch {
      // DB not ready
    }
  }, 300);
}

// ── Load from DB ─────────────────────────────────────────────────────

let _addressBookLoaded = false;

export function loadAddressBookFromDB(): boolean {
  if (_addressBookLoaded) return true;

  try {
    const db = WalletDatabase.shared();
    const raw = db.getConfig(DB_CONFIG_KEY);

    if (raw) {
      const entries = JSON.parse(raw) as AddressBookEntry[];
      useAddressBookStore.setState({ entries });
      _addressBookLoaded = true;
      return true;
    }

    // DB empty — try one-time migration from AsyncStorage
    _migrateFromAsyncStorage();
    return true;
  } catch {
    return false;
  }
}

async function _migrateFromAsyncStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('address-book-storage');
    if (!raw) {
      _addressBookLoaded = true;
      return;
    }

    const parsed = JSON.parse(raw);
    const entries: AddressBookEntry[] = parsed?.state?.entries ?? parsed?.entries ?? [];

    if (entries.length > 0) {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        db.setConfig(DB_CONFIG_KEY, JSON.stringify(entries));
      } catch { /* DB not ready */ }

      useAddressBookStore.setState({ entries });
    }

    _addressBookLoaded = true;
    AsyncStorage.removeItem('address-book-storage').catch(() => {});
  } catch {
    _addressBookLoaded = true;
  }
}

export function resetAddressBookLoaded(): void {
  _addressBookLoaded = false;
}
