/**
 * UTXO Store — DB-backed
 *
 * UTXO metadata (freeze, lock, notes, tags) is stored in the
 * `utxos` table columns (isFrozen, isLocked, userNote, userTags).
 *
 * Zustand provides in-memory reactivity for React components.
 * On app start, metadata is loaded from the DB.
 * One-time migration from AsyncStorage (legacy) writes to DB.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';
import type { ManagedUTXO, UTXO } from '../types';

interface UTXOMetadata {
  note?: string;
  tags?: string[];
  isFrozen: boolean;
  isLocked: boolean;
  createdAt?: number;
}

interface UTXOState {
  // UTXO metadata storage (keyed by utxo id: txid:vout)
  utxoMetadata: Record<string, UTXOMetadata>;
  _initialized: boolean;

  // Init from DB (call once on app start)
  initFromDb: () => void;

  // Actions
  setNote: (utxoId: string, note: string) => void;
  clearNote: (utxoId: string) => void;
  addTag: (utxoId: string, tag: string) => void;
  removeTag: (utxoId: string, tag: string) => void;
  freezeUtxo: (utxoId: string) => void;
  unfreezeUtxo: (utxoId: string) => void;
  lockUtxo: (utxoId: string) => void;
  unlockUtxo: (utxoId: string) => void;

  // Get managed UTXO with metadata
  getManagedUtxo: (utxo: UTXO) => ManagedUTXO;

  // Get all available UTXOs (not frozen or locked)
  getAvailableUtxos: (utxos: UTXO[]) => ManagedUTXO[];

  // Get frozen UTXOs
  getFrozenUtxos: (utxos: UTXO[]) => ManagedUTXO[];

  // Get locked UTXOs
  getLockedUtxos: (utxos: UTXO[]) => ManagedUTXO[];

  // Check if UTXO is spendable
  isSpendable: (utxoId: string) => boolean;

  // Clear metadata for removed UTXOs
  cleanupStaleMetadata: (currentUtxoIds: string[]) => void;
}

const createUtxoId = (txid: string, vout: number): string => `${txid}:${vout}`;

function parseUtxoId(utxoId: string): { txid: string; vout: number } | null {
  const lastColon = utxoId.lastIndexOf(':');
  if (lastColon === -1) return null;
  const txid = utxoId.slice(0, lastColon);
  const vout = parseInt(utxoId.slice(lastColon + 1), 10);
  if (isNaN(vout)) return null;
  return { txid, vout };
}

/**
 * Find which walletId owns a UTXO using a direct DB query instead of
 * loading all UTXOs for all wallets (was O(wallets × utxos), now O(1) query).
 */
function findWalletForUtxo(db: WalletDatabase, txid: string, vout: number): string | null {
  const row = db.getDb().getFirstSync<{ walletId: string }>(
    'SELECT walletId FROM utxos WHERE txid = ? AND vout = ? LIMIT 1',
    [txid, vout]
  );
  return row?.walletId ?? null;
}

function writeMetaToDb(utxoId: string, meta: { isFrozen?: number; isLocked?: number; userNote?: string | null; userTags?: string | null }): void {
  try {
    const parsed = parseUtxoId(utxoId);
    if (!parsed) return;
    const db = WalletDatabase.shared();
    const walletId = findWalletForUtxo(db, parsed.txid, parsed.vout);
    if (walletId) {
      db.updateUtxoMeta(walletId, parsed.txid, parsed.vout, meta);
    }
  } catch (err) {
    // DB write error
  }
}

export const useUTXOStore = create<UTXOState>()(
  (set, get) => ({
    utxoMetadata: {},
    _initialized: false,

    initFromDb: () => {
      if (get()._initialized) return;

      try {
        const db = WalletDatabase.shared();
        const metadata: Record<string, UTXOMetadata> = {};

        // Load user metadata from all wallets
        const wallets = db.getAllWallets();
        for (const w of wallets) {
          const metas = db.getUtxoUserMeta(w.walletId);
          for (const m of metas) {
            const id = createUtxoId(m.txid, m.vout);
            metadata[id] = {
              isFrozen: m.isFrozen === 1,
              isLocked: m.isLocked === 1,
              note: m.userNote ?? undefined,
              tags: m.userTags ? (() => { try { return JSON.parse(m.userTags); } catch { return undefined; } })() : undefined,
            };
          }
        }

        // One-time migration from AsyncStorage
        if (Object.keys(metadata).length === 0) {
          AsyncStorage.getItem('utxo-metadata-storage').then(raw => {
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw);
              const legacyMeta: Record<string, UTXOMetadata> = parsed?.state?.utxoMetadata ?? {};
              const entries = Object.entries(legacyMeta);
              if (entries.length === 0) return;

              const db2 = WalletDatabase.shared();
              for (const [utxoId, meta] of entries) {
                const parts = parseUtxoId(utxoId);
                if (!parts) continue;
                const walletId = findWalletForUtxo(db2, parts.txid, parts.vout);
                if (walletId) {
                  db2.updateUtxoMeta(walletId, parts.txid, parts.vout, {
                    isFrozen: meta.isFrozen ? 1 : 0,
                    isLocked: meta.isLocked ? 1 : 0,
                    userNote: meta.note ?? null,
                    userTags: meta.tags ? JSON.stringify(meta.tags) : null,
                  });
                }
              }

              set({ utxoMetadata: legacyMeta });

              // Clear legacy storage
              AsyncStorage.removeItem('utxo-metadata-storage').catch(() => {});
              // Migrated UTXO metadata from AsyncStorage to DB
            } catch {
              // Parse error — ignore
            }
          }).catch(() => {});
        } else {
          set({ utxoMetadata: metadata });
        }

        set({ _initialized: true });
      } catch (err) {
        // initFromDb error
        set({ _initialized: true });
      }
    },

    setNote: (utxoId: string, note: string) => {
      const trimmed = note.trim() || undefined;
      writeMetaToDb(utxoId, { userNote: trimmed ?? null });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            note: trimmed,
            isFrozen: state.utxoMetadata[utxoId]?.isFrozen ?? false,
            isLocked: state.utxoMetadata[utxoId]?.isLocked ?? false,
          },
        },
      }));
    },

    clearNote: (utxoId: string) => {
      writeMetaToDb(utxoId, { userNote: null });

      set((state) => {
        const metadata = { ...state.utxoMetadata[utxoId] };
        delete metadata.note;
        return {
          utxoMetadata: {
            ...state.utxoMetadata,
            [utxoId]: metadata,
          },
        };
      });
    },

    addTag: (utxoId: string, tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed) return;

      const existing = get().utxoMetadata[utxoId]?.tags || [];
      if (existing.includes(trimmed)) return;

      const newTags = [...existing, trimmed];
      writeMetaToDb(utxoId, { userTags: JSON.stringify(newTags) });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            tags: newTags,
            isFrozen: state.utxoMetadata[utxoId]?.isFrozen ?? false,
            isLocked: state.utxoMetadata[utxoId]?.isLocked ?? false,
          },
        },
      }));
    },

    removeTag: (utxoId: string, tag: string) => {
      const existing = get().utxoMetadata[utxoId]?.tags || [];
      const newTags = existing.filter(t => t !== tag);
      writeMetaToDb(utxoId, { userTags: newTags.length > 0 ? JSON.stringify(newTags) : null });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            tags: newTags,
            isFrozen: state.utxoMetadata[utxoId]?.isFrozen ?? false,
            isLocked: state.utxoMetadata[utxoId]?.isLocked ?? false,
          },
        },
      }));
    },

    freezeUtxo: (utxoId: string) => {
      writeMetaToDb(utxoId, { isFrozen: 1 });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            isFrozen: true,
            isLocked: state.utxoMetadata[utxoId]?.isLocked ?? false,
          },
        },
      }));
    },

    unfreezeUtxo: (utxoId: string) => {
      writeMetaToDb(utxoId, { isFrozen: 0 });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            isFrozen: false,
          },
        },
      }));
    },

    lockUtxo: (utxoId: string) => {
      writeMetaToDb(utxoId, { isLocked: 1 });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            isLocked: true,
            isFrozen: state.utxoMetadata[utxoId]?.isFrozen ?? false,
          },
        },
      }));
    },

    unlockUtxo: (utxoId: string) => {
      writeMetaToDb(utxoId, { isLocked: 0 });

      set((state) => ({
        utxoMetadata: {
          ...state.utxoMetadata,
          [utxoId]: {
            ...state.utxoMetadata[utxoId],
            isLocked: false,
          },
        },
      }));
    },

    getManagedUtxo: (utxo: UTXO): ManagedUTXO => {
      const utxoId = createUtxoId(utxo.txid, utxo.vout);
      const metadata = get().utxoMetadata[utxoId] || { isFrozen: false, isLocked: false };

      return {
        ...utxo,
        id: utxoId,
        note: metadata.note,
        tags: metadata.tags,
        isFrozen: metadata.isFrozen,
        isLocked: metadata.isLocked,
        createdAt: metadata.createdAt,
      };
    },

    getAvailableUtxos: (utxos: UTXO[]): ManagedUTXO[] => {
      const { getManagedUtxo } = get();
      return utxos
        .map(getManagedUtxo)
        .filter(utxo => !utxo.isFrozen && !utxo.isLocked);
    },

    getFrozenUtxos: (utxos: UTXO[]): ManagedUTXO[] => {
      const { getManagedUtxo } = get();
      return utxos
        .map(getManagedUtxo)
        .filter(utxo => utxo.isFrozen);
    },

    getLockedUtxos: (utxos: UTXO[]): ManagedUTXO[] => {
      const { getManagedUtxo } = get();
      return utxos
        .map(getManagedUtxo)
        .filter(utxo => utxo.isLocked);
    },

    isSpendable: (utxoId: string): boolean => {
      const metadata = get().utxoMetadata[utxoId];
      if (!metadata) return true;
      return !metadata.isFrozen && !metadata.isLocked;
    },

    cleanupStaleMetadata: (currentUtxoIds: string[]) => {
      const { utxoMetadata } = get();
      const currentIds = new Set(currentUtxoIds);
      const newMetadata: Record<string, UTXOMetadata> = {};

      for (const [id, metadata] of Object.entries(utxoMetadata)) {
        if (currentIds.has(id)) {
          newMetadata[id] = metadata;
        }
      }

      set({ utxoMetadata: newMetadata });
    },
  })
);

// Helper function to create UTXO ID
export const getUtxoId = createUtxoId;
