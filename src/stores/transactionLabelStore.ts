/**
 * Transaction Label Store — DB-backed
 *
 * Labels, notes, and tags for transactions are stored in the
 * `transactions.userNote` and `transactions.userTags` columns.
 *
 * Zustand provides in-memory reactivity for React components.
 * On app start, labels are loaded from the DB transactions table.
 * One-time migration from AsyncStorage (legacy) writes to DB.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';
import type { TransactionLabel } from '../types';

interface TransactionLabelState {
  labels: Record<string, TransactionLabel>;
  _initialized: boolean;

  // Init from DB (call once on app start)
  initFromDb: () => void;

  setLabel: (txid: string, label: string, note?: string, tags?: string[]) => void;
  updateNote: (txid: string, note: string) => void;
  updateTags: (txid: string, tags: string[]) => void;
  clearLabel: (txid: string) => void;
  getLabel: (txid: string) => TransactionLabel | undefined;
  searchLabels: (query: string) => TransactionLabel[];
}

/**
 * Find which walletId owns a txid via a single indexed SQL query.
 * Replaces O(N) per-wallet scan with a direct DB lookup.
 */
function findWalletForTxid(db: WalletDatabase, txid: string): string | null {
  try {
    const row = db.getDb().getFirstSync<{ walletId: string }>(
      'SELECT walletId FROM transactions WHERE txid = ? LIMIT 1',
      [txid]
    );
    return row?.walletId ?? null;
  } catch {
    // Fallback to legacy scan if transactions table doesn't exist yet
    const wallets = db.getAllWallets();
    for (const w of wallets) {
      const tx = db.getTransaction(w.walletId, txid);
      if (tx) return w.walletId;
    }
    return null;
  }
}

export const useTransactionLabelStore = create<TransactionLabelState>()(
  (set, get) => ({
    labels: {},
    _initialized: false,

    initFromDb: () => {
      if (get()._initialized) return;

      try {
        const db = WalletDatabase.shared();
        const labels: Record<string, TransactionLabel> = {};

        // Load from all wallets' transactions that have userNote or userTags
        const wallets = db.getAllWallets();
        for (const w of wallets) {
          const txs = db.getTransactions(w.walletId);
          for (const tx of txs) {
            if (tx.userNote || tx.userTags) {
              labels[tx.txid] = {
                txid: tx.txid,
                label: '',
                note: tx.userNote ?? undefined,
                tags: tx.userTags ? (() => { try { return JSON.parse(tx.userTags); } catch { return undefined; } })() : undefined,
                createdAt: tx.firstSeenAt,
                updatedAt: tx.firstSeenAt,
              };
            }
          }
        }

        // One-time migration from AsyncStorage
        if (Object.keys(labels).length === 0) {
          AsyncStorage.getItem('transaction-labels').then(raw => {
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw);
              const legacyLabels: Record<string, TransactionLabel> = parsed?.state?.labels ?? {};
              const entries = Object.entries(legacyLabels);
              if (entries.length === 0) return;

              const db2 = WalletDatabase.shared();
              for (const [txid, lbl] of entries) {
                const walletId = findWalletForTxid(db2, txid);
                if (walletId) {
                  if (lbl.note) db2.setTransactionNote(walletId, txid, lbl.note);
                  if (lbl.tags && lbl.tags.length > 0) db2.setTransactionTags(walletId, txid, lbl.tags);
                }
              }

              set({ labels: legacyLabels });

              // Clear legacy storage
              AsyncStorage.removeItem('transaction-labels').catch(() => {});
              // Migrated labels from AsyncStorage to DB
            } catch {
              // Parse error — ignore
            }
          }).catch(() => {});
        } else {
          set({ labels });
        }

        set({ _initialized: true });
      } catch (err) {
        // initFromDb error
        set({ _initialized: true });
      }
    },

    setLabel: (txid, label, note, tags) => {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const walletId = findWalletForTxid(db, txid);
        if (walletId) {
          if (note !== undefined) db.setTransactionNote(walletId, txid, note || null);
          if (tags !== undefined) db.setTransactionTags(walletId, txid, tags);
        }
      } catch (err) {
        // setLabel DB error
      }

      set((state) => ({
        labels: {
          ...state.labels,
          [txid]: {
            txid,
            label,
            note: note || state.labels[txid]?.note,
            tags: tags || state.labels[txid]?.tags,
            createdAt: state.labels[txid]?.createdAt || Date.now(),
            updatedAt: Date.now(),
          },
        },
      }));
    },

    updateNote: (txid, note) => {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const walletId = findWalletForTxid(db, txid);
        if (walletId) db.setTransactionNote(walletId, txid, note || null);
      } catch (err) {
        // updateNote DB error
      }

      set((state) => {
        const existing = state.labels[txid];
        return {
          labels: {
            ...state.labels,
            [txid]: {
              txid,
              label: existing?.label || '',
              note,
              tags: existing?.tags,
              createdAt: existing?.createdAt || Date.now(),
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    updateTags: (txid, tags) => {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        const walletId = findWalletForTxid(db, txid);
        if (walletId) db.setTransactionTags(walletId, txid, tags);
      } catch (err) {
        // updateTags DB error
      }

      set((state) => {
        const existing = state.labels[txid];
        return {
          labels: {
            ...state.labels,
            [txid]: {
              txid,
              label: existing?.label || '',
              note: existing?.note,
              tags,
              createdAt: existing?.createdAt || Date.now(),
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    clearLabel: (txid) => {
      // Clear from DB
      try {
        const db = WalletDatabase.shared();
        const walletId = findWalletForTxid(db, txid);
        if (walletId) {
          db.setTransactionNote(walletId, txid, null);
          db.setTransactionTags(walletId, txid, []);
        }
      } catch (err) {
        // clearLabel DB error
      }

      set((state) => {
        const { [txid]: _, ...rest } = state.labels;
        return { labels: rest };
      });
    },

    getLabel: (txid) => get().labels[txid],

    searchLabels: (query) => {
      if (!query.trim()) return [];
      const q = query.toLowerCase().trim();
      return Object.values(get().labels).filter((entry) => {
        if (entry.label.toLowerCase().includes(q)) return true;
        if (entry.note?.toLowerCase().includes(q)) return true;
        if (entry.tags?.some((tag) => tag.toLowerCase().includes(q))) return true;
        if (entry.txid.toLowerCase().includes(q)) return true;
        return false;
      });
    },
  })
);
