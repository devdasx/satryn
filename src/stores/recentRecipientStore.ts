/**
 * Recent Recipient Store — DB-backed
 *
 * Persisted store tracking recent recipient addresses.
 * Uses SQLite as the source of truth. Zustand provides in-memory reactivity.
 *
 * Used for:
 * - Recent recipients list in StepRecipient (Feature 14)
 * - Address similarity detection (Feature 2)
 * - New recipient detection (Feature 1)
 *
 * Max 50 recipients. Evicts oldest when full.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';
import type { RecentRecipientRow } from '../services/database';

// ============================================
// TYPES
// ============================================

export interface RecentRecipient {
  address: string;
  contactId: string | null;
  label: string | null;
  firstUsed: number;
  lastUsed: number;
  useCount: number;
}

interface RecentRecipientState {
  recipients: RecentRecipient[];
  _initialized: boolean;

  // Init from DB (call once on app start)
  initFromDb: () => void;

  // Actions
  recordRecipient: (address: string, contactId?: string | null, label?: string | null) => void;
  removeRecipient: (address: string) => void;
  getRecent: (limit?: number) => RecentRecipient[];
  getAllAddresses: () => string[];
  isKnownRecipient: (address: string) => boolean;
  clear: () => void;
}

const MAX_RECIPIENTS = 50;

// ── Helpers ─────────────────────────────────────────────────────────

function rowToRecipient(row: RecentRecipientRow): RecentRecipient {
  return {
    address: row.address,
    contactId: row.contactId,
    label: row.label,
    firstUsed: row.firstUsed,
    lastUsed: row.lastUsed,
    useCount: row.useCount,
  };
}

// ============================================
// STORE
// ============================================

export const useRecentRecipientStore = create<RecentRecipientState>()(
  (set, get) => ({
    recipients: [],
    _initialized: false,

    initFromDb: () => {
      if (get()._initialized) return;

      try {
        const db = WalletDatabase.shared();
        const rows = db.getRecentRecipients(MAX_RECIPIENTS);

        if (rows.length === 0) {
          // One-time migration from AsyncStorage
          AsyncStorage.getItem('recent-recipients-storage').then(raw => {
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw);
              const legacyRecipients: RecentRecipient[] = parsed?.state?.recipients ?? [];
              if (legacyRecipients.length === 0) return;

              const db2 = WalletDatabase.shared();
              for (const r of legacyRecipients) {
                db2.upsertRecipient({
                  address: r.address,
                  contactId: r.contactId,
                  label: r.label,
                  firstUsed: r.firstUsed,
                  lastUsed: r.lastUsed,
                  useCount: r.useCount,
                });
              }

              set({ recipients: legacyRecipients });

              // Clear legacy storage
              AsyncStorage.removeItem('recent-recipients-storage').catch(() => {});
              // Migrated recipients from AsyncStorage to DB
            } catch {
              // Parse error — ignore
            }
          }).catch(() => {});
        } else {
          set({ recipients: rows.map(rowToRecipient) });
        }

        set({ _initialized: true });
      } catch (err) {
        // initFromDb error
        set({ _initialized: true });
      }
    },

    recordRecipient: (address, contactId = null, label = null) => {
      const { recipients } = get();
      const now = Date.now();
      const existing = recipients.find(r => r.address === address);

      // Write to DB (upsert handles both insert and update)
      try {
        const db = WalletDatabase.shared();
        db.upsertRecipient({
          address,
          contactId,
          label,
          firstUsed: existing?.firstUsed ?? now,
          lastUsed: now,
          useCount: (existing?.useCount ?? 0) + 1,
        });
      } catch (err) {
        // recordRecipient DB error
      }

      if (existing) {
        const updated = recipients.map(r =>
          r.address === address
            ? {
                ...r,
                lastUsed: now,
                useCount: r.useCount + 1,
                contactId: contactId ?? r.contactId,
                label: label ?? r.label,
              }
            : r
        );
        set({ recipients: updated });
      } else {
        const newRecipient: RecentRecipient = {
          address,
          contactId,
          label,
          firstUsed: now,
          lastUsed: now,
          useCount: 1,
        };

        let updated = [newRecipient, ...recipients];
        if (updated.length > MAX_RECIPIENTS) {
          updated.sort((a, b) => b.lastUsed - a.lastUsed);
          const evicted = updated.slice(MAX_RECIPIENTS);
          updated = updated.slice(0, MAX_RECIPIENTS);

          // Remove evicted from DB
          try {
            const db = WalletDatabase.shared();
            for (const r of evicted) {
              db.deleteRecipient(r.address);
            }
          } catch {}
        }

        set({ recipients: updated });
      }
    },

    removeRecipient: (address) => {
      try {
        const db = WalletDatabase.shared();
        db.deleteRecipient(address);
      } catch (err) {
        // removeRecipient DB error
      }

      set(state => ({
        recipients: state.recipients.filter(r => r.address !== address),
      }));
    },

    getRecent: (limit = 10) => {
      const { recipients } = get();
      return [...recipients]
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, limit);
    },

    getAllAddresses: () => {
      return get().recipients.map(r => r.address);
    },

    isKnownRecipient: (address) => {
      return get().recipients.some(r => r.address === address);
    },

    clear: () => {
      try {
        const db = WalletDatabase.shared();
        db.clearRecipients();
      } catch (err) {
        // clear DB error
      }
      set({ recipients: [] });
    },
  })
);
