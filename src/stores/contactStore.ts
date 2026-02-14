/**
 * Contact Store — DB-backed
 * Premium Address Book with multi-address support, tags, favorites
 *
 * Uses SQLite as the source of truth. Zustand provides in-memory
 * reactivity for React components. On app start, data is loaded from DB.
 * One-time migration from AsyncStorage (legacy) if DB is empty.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';
import type { ContactRow, ContactAddressRow } from '../services/database';
import type { Contact, ContactAddress } from '../types/contacts';

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Helpers: Convert between app types and DB rows ──────────────────

const AVATAR_COLORS = [
  '#5B7FFF', '#30D158', '#FF6482', '#8E8CE6', '#FF9F0A',
  '#4ECDC4', '#FF453A', '#BF5AF2', '#5AC8FA', '#34D399',
  '#FF6B6B', '#A78BFA', '#F59E0B', '#06B6D4', '#EC4899',
  '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#8B5CF6',
];

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function contactToRow(c: Contact): ContactRow {
  return {
    id: c.id,
    name: c.name,
    tags: JSON.stringify(c.tags),
    notes: c.notes ?? null,
    isFavorite: c.isFavorite ? 1 : 0,
    color: c.color ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function addressToRow(contactId: string, a: ContactAddress): ContactAddressRow {
  return {
    id: a.id,
    contactId,
    label: a.label ?? null,
    address: a.address,
    network: a.network ?? 'mainnet',
    isDefault: a.isDefault ? 1 : 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt ?? null,
  };
}

function rowToContact(row: ContactRow, addrRows: ContactAddressRow[]): Contact {
  return {
    id: row.id,
    name: row.name,
    tags: (() => { try { return JSON.parse(row.tags) as string[]; } catch { return []; } })(),
    notes: row.notes ?? undefined,
    isFavorite: row.isFavorite === 1,
    color: row.color ?? undefined,
    addresses: addrRows.map(rowToAddress),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToAddress(row: ContactAddressRow): ContactAddress {
  return {
    id: row.id,
    label: row.label ?? undefined,
    address: row.address,
    network: (row.network as 'mainnet' | 'testnet') ?? 'mainnet',
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
  };
}

// ── Store ────────────────────────────────────────────────────────────

interface ContactState {
  contacts: Contact[];
  _initialized: boolean;

  // Init from DB (call once on app start)
  initFromDb: () => void;

  // CRUD
  addContact: (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateContact: (id: string, updates: Partial<Omit<Contact, 'id' | 'createdAt'>>) => void;
  removeContact: (id: string) => void;

  // Address management
  addAddress: (contactId: string, address: Omit<ContactAddress, 'id' | 'createdAt'>) => void;
  updateAddress: (contactId: string, addressId: string, updates: Partial<Omit<ContactAddress, 'id' | 'createdAt'>>) => void;
  removeAddress: (contactId: string, addressId: string) => void;
  setDefaultAddress: (contactId: string, addressId: string) => void;

  // Favorites
  toggleFavorite: (id: string) => void;

  // Queries
  getContactById: (id: string) => Contact | undefined;
  getContactByAddress: (address: string) => Contact | undefined;
  getAllAddresses: () => string[];
  getAllTags: () => string[];
  getRecentTransferDate: (address: string) => number | null;

  // Migration (legacy)
  importContacts: (contacts: Contact[]) => void;
}

export const useContactStore = create<ContactState>()(
  (set, get) => ({
    contacts: [],
    _initialized: false,

    initFromDb: () => {
      if (get()._initialized) return;

      try {
        const db = WalletDatabase.shared();

        // Check if DB has contacts
        const contactRows = db.getAllContacts();

        if (contactRows.length === 0) {
          // One-time migration from AsyncStorage
          try {
            // AsyncStorage.getItem is async — we need to handle this carefully.
            // Since this runs on init, we'll read it async and update state when done.
            AsyncStorage.getItem('contacts-storage').then(raw => {
              if (!raw) return;
              try {
                const parsed = JSON.parse(raw);
                const legacyContacts: Contact[] = parsed?.state?.contacts ?? [];
                if (legacyContacts.length === 0) return;

                const db2 = WalletDatabase.shared();
                for (const c of legacyContacts) {
                  db2.insertContact(contactToRow(c));
                  for (const addr of c.addresses) {
                    db2.insertContactAddress(addressToRow(c.id, addr));
                  }
                }

                set({ contacts: legacyContacts });

                // Clear legacy storage
                AsyncStorage.removeItem('contacts-storage').catch(() => {});
              } catch {
                // Parse error — ignore
              }
            }).catch(() => {});
          } catch {
            // AsyncStorage not available — skip migration
          }
        } else {
          // Load from DB
          const contacts: Contact[] = contactRows.map(row => {
            const addrRows = db.getContactAddresses(row.id);
            return rowToContact(row, addrRows);
          });
          set({ contacts });
        }

        set({ _initialized: true });
      } catch (err) {
        set({ _initialized: true });
      }
    },

    addContact: (contactData) => {
      // Prevent duplicate names
      const existing = get().contacts;
      const trimmedName = contactData.name.trim().toLowerCase();
      if (existing.some(c => c.name.trim().toLowerCase() === trimmedName)) {
        throw new Error('A contact with this name already exists');
      }

      const id = generateId();
      const now = Date.now();
      const contact: Contact = {
        ...contactData,
        id,
        color: contactData.color || randomAvatarColor(),
        createdAt: now,
        updatedAt: now,
        addresses: contactData.addresses.map((addr, i) => ({
          ...addr,
          id: addr.id || generateId(),
          createdAt: addr.createdAt || now,
          isDefault: contactData.addresses.length === 1 ? true : addr.isDefault || i === 0,
        })),
      };

      // Write to DB first
      try {
        const db = WalletDatabase.shared();
        db.insertContact(contactToRow(contact));
        for (const addr of contact.addresses) {
          db.insertContactAddress(addressToRow(id, addr));
        }
      } catch (err) {
      }

      // Update in-memory state
      set((state) => ({ contacts: [...state.contacts, contact] }));
      return id;
    },

    updateContact: (id, updates) => {
      const now = Date.now();

      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const dbUpdates: Partial<Omit<ContactRow, 'id' | 'createdAt'>> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.tags !== undefined) dbUpdates.tags = JSON.stringify(updates.tags);
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes ?? null;
        if (updates.isFavorite !== undefined) dbUpdates.isFavorite = updates.isFavorite ? 1 : 0;
        db.updateContact(id, dbUpdates);
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) =>
          c.id === id ? { ...c, ...updates, updatedAt: now } : c
        ),
      }));
    },

    removeContact: (id) => {
      // DB CASCADE handles contact_addresses
      try {
        const db = WalletDatabase.shared();
        db.deleteContact(id);
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.filter((c) => c.id !== id),
      }));
    },

    addAddress: (contactId, addressData) => {
      const now = Date.now();
      const newAddr: ContactAddress = {
        ...addressData,
        id: generateId(),
        createdAt: now,
      };

      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const contact = get().contacts.find(c => c.id === contactId);
        const isFirst = contact ? contact.addresses.length === 0 : false;
        const finalAddr = { ...newAddr, isDefault: isFirst ? true : newAddr.isDefault };
        db.insertContactAddress(addressToRow(contactId, finalAddr));
        db.updateContact(contactId, { updatedAt: now });
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) => {
          if (c.id !== contactId) return c;
          const isFirst = c.addresses.length === 0;
          return {
            ...c,
            updatedAt: now,
            addresses: [
              ...c.addresses,
              { ...newAddr, isDefault: isFirst ? true : newAddr.isDefault },
            ],
          };
        }),
      }));
    },

    updateAddress: (contactId, addressId, updates) => {
      const now = Date.now();

      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const dbUpdates: Partial<Omit<ContactAddressRow, 'id' | 'contactId' | 'createdAt'>> = {};
        if (updates.label !== undefined) dbUpdates.label = updates.label ?? null;
        if (updates.address !== undefined) dbUpdates.address = updates.address;
        if (updates.network !== undefined) dbUpdates.network = updates.network ?? 'mainnet';
        if (updates.isDefault !== undefined) dbUpdates.isDefault = updates.isDefault ? 1 : 0;
        db.updateContactAddress(addressId, dbUpdates);
        db.updateContact(contactId, { updatedAt: now });
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) => {
          if (c.id !== contactId) return c;
          return {
            ...c,
            updatedAt: now,
            addresses: c.addresses.map((a) =>
              a.id === addressId ? { ...a, ...updates, updatedAt: now } : a
            ),
          };
        }),
      }));
    },

    removeAddress: (contactId, addressId) => {
      const now = Date.now();

      // Write to DB
      try {
        const db = WalletDatabase.shared();
        db.deleteContactAddress(addressId);
        db.updateContact(contactId, { updatedAt: now });
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) => {
          if (c.id !== contactId) return c;
          const remaining = c.addresses.filter((a) => a.id !== addressId);
          const hadDefault = remaining.some((a) => a.isDefault);
          if (!hadDefault && remaining.length > 0) {
            remaining[0].isDefault = true;
            // Update DB default flag
            try {
              const db = WalletDatabase.shared();
              db.updateContactAddress(remaining[0].id, { isDefault: 1 });
            } catch {}
          }
          return { ...c, updatedAt: now, addresses: remaining };
        }),
      }));
    },

    setDefaultAddress: (contactId, addressId) => {
      const now = Date.now();

      // Write to DB — clear all defaults, set new one
      try {
        const db = WalletDatabase.shared();
        const contact = get().contacts.find(c => c.id === contactId);
        if (contact) {
          for (const addr of contact.addresses) {
            db.updateContactAddress(addr.id, { isDefault: addr.id === addressId ? 1 : 0 });
          }
        }
        db.updateContact(contactId, { updatedAt: now });
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) => {
          if (c.id !== contactId) return c;
          return {
            ...c,
            updatedAt: now,
            addresses: c.addresses.map((a) => ({
              ...a,
              isDefault: a.id === addressId,
            })),
          };
        }),
      }));
    },

    toggleFavorite: (id) => {
      const contact = get().contacts.find(c => c.id === id);
      const newFav = contact ? !contact.isFavorite : false;

      // Write to DB
      try {
        const db = WalletDatabase.shared();
        db.updateContact(id, { isFavorite: newFav ? 1 : 0 });
      } catch (err) {
      }

      set((state) => ({
        contacts: state.contacts.map((c) =>
          c.id === id ? { ...c, isFavorite: newFav, updatedAt: Date.now() } : c
        ),
      }));
    },

    getContactById: (id) => {
      return get().contacts.find((c) => c.id === id);
    },

    getContactByAddress: (address) => {
      return get().contacts.find((c) =>
        c.addresses.some((a) => a.address === address)
      );
    },

    getAllAddresses: () => {
      return get().contacts.flatMap((c) => c.addresses.map((a) => a.address));
    },

    getAllTags: () => {
      const tagSet = new Set<string>();
      for (const contact of get().contacts) {
        for (const tag of contact.tags) {
          tagSet.add(tag);
        }
      }
      return Array.from(tagSet).sort();
    },

    getRecentTransferDate: (address) => {
      const contact = get().contacts.find((c) =>
        c.addresses.some((a) => a.address === address)
      );
      if (!contact) return null;
      const addr = contact.addresses.find((a) => a.address === address);
      return addr?.updatedAt || contact.updatedAt || null;
    },

    importContacts: (contacts) => {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        for (const c of contacts) {
          db.insertContact(contactToRow(c));
          for (const addr of c.addresses) {
            db.insertContactAddress(addressToRow(c.id, addr));
          }
        }
      } catch (err) {
      }

      set((state) => ({
        contacts: [...state.contacts, ...contacts],
      }));
    },
  })
);
