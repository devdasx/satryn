/**
 * Server Store — DB-backed
 * Manages saved Electrum servers with favorites, notes, and labels.
 * Tracks the active (connected) server via app_config key-value store.
 *
 * Uses SQLite as the source of truth. Zustand provides in-memory
 * reactivity for React components.
 */

import { create } from 'zustand';
import { WalletDatabase } from '../services/database';
import type { SavedServerRow } from '../services/database';

function generateId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const ACTIVE_SERVER_KEY = 'active_server';

// ── Types ────────────────────────────────────────────────────────────

export interface SavedServer {
  id: string;
  host: string;
  port: number;
  ssl: boolean;
  isBuiltIn: boolean;
  isUserAdded: boolean;
  isFavorite: boolean;
  notes: string | null;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveServer {
  host: string;
  port: number;
  ssl: boolean;
}

function rowToServer(row: SavedServerRow): SavedServer {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    ssl: row.ssl === 1,
    isBuiltIn: row.isBuiltIn === 1,
    isUserAdded: row.isUserAdded === 1,
    isFavorite: row.isFavorite === 1,
    notes: row.notes,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Store ────────────────────────────────────────────────────────────

interface ServerState {
  servers: SavedServer[];
  activeServer: ActiveServer | null;
  _initialized: boolean;

  /** Load all servers + active server from SQLite */
  loadServers: () => void;

  /** Get the active (connected) server from DB */
  getActiveServer: () => ActiveServer | null;

  /** Set the active (connected) server — persists to app_config */
  setActiveServer: (server: ActiveServer) => void;

  /** Clear the active server (reset to public/auto) */
  clearActiveServer: () => void;

  /** Add a user-created server */
  addServer: (host: string, port: number, ssl: boolean, label?: string, notes?: string) => string;

  /** Remove a user-added server (built-in servers cannot be removed) */
  removeServer: (id: string) => void;

  /** Toggle favorite status */
  toggleFavorite: (id: string) => void;

  /** Update notes for a server */
  updateNotes: (id: string, notes: string | null) => void;

  /** Update label for a server */
  updateLabel: (id: string, label: string | null) => void;

  /** Get favorites only */
  getFavorites: () => SavedServer[];

  /** Get a server by host:port */
  getByHostPort: (host: string, port: number) => SavedServer | undefined;
}

export const useServerStore = create<ServerState>()(
  (set, get) => ({
    servers: [],
    activeServer: null,
    _initialized: false,

    loadServers: () => {
      try {
        const db = WalletDatabase.shared();
        const rows = db.getAllSavedServers();

        // Load active server from app_config
        let active: ActiveServer | null = null;
        try {
          const raw = db.getConfig(ACTIVE_SERVER_KEY);
          if (raw) active = JSON.parse(raw) as ActiveServer;
        } catch {}

        set({ servers: rows.map(rowToServer), activeServer: active, _initialized: true });
      } catch {
        set({ _initialized: true });
      }
    },

    getActiveServer: () => {
      return get().activeServer;
    },

    setActiveServer: (server) => {
      try {
        const db = WalletDatabase.shared();
        db.setConfig(ACTIVE_SERVER_KEY, JSON.stringify(server));
      } catch {}
      set({ activeServer: server });
    },

    clearActiveServer: () => {
      try {
        const db = WalletDatabase.shared();
        db.deleteConfig(ACTIVE_SERVER_KEY);
      } catch {}
      set({ activeServer: null });
    },

    addServer: (host, port, ssl, label, notes) => {
      const id = generateId();
      const now = Date.now();
      const row: SavedServerRow = {
        id,
        host: host.trim(),
        port,
        ssl: ssl ? 1 : 0,
        isBuiltIn: 0,
        isUserAdded: 1,
        isFavorite: 0,
        notes: notes ?? null,
        label: label ?? null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const db = WalletDatabase.shared();
        db.upsertSavedServer(row);
      } catch {}

      const server = rowToServer(row);
      set((state) => ({ servers: [server, ...state.servers] }));
      return id;
    },

    removeServer: (id) => {
      const server = get().servers.find(s => s.id === id);
      if (!server || server.isBuiltIn) return;

      try {
        const db = WalletDatabase.shared();
        db.deleteSavedServer(id);
      } catch {}

      set((state) => ({
        servers: state.servers.filter(s => s.id !== id),
      }));
    },

    toggleFavorite: (id) => {
      try {
        const db = WalletDatabase.shared();
        db.toggleServerFavorite(id);
      } catch {}

      set((state) => ({
        servers: state.servers.map(s =>
          s.id === id ? { ...s, isFavorite: !s.isFavorite, updatedAt: Date.now() } : s
        ),
      }));
    },

    updateNotes: (id, notes) => {
      try {
        const db = WalletDatabase.shared();
        db.updateServerNotes(id, notes);
      } catch {}

      set((state) => ({
        servers: state.servers.map(s =>
          s.id === id ? { ...s, notes, updatedAt: Date.now() } : s
        ),
      }));
    },

    updateLabel: (id, label) => {
      try {
        const db = WalletDatabase.shared();
        db.updateServerLabel(id, label);
      } catch {}

      set((state) => ({
        servers: state.servers.map(s =>
          s.id === id ? { ...s, label, updatedAt: Date.now() } : s
        ),
      }));
    },

    getFavorites: () => {
      return get().servers.filter(s => s.isFavorite);
    },

    getByHostPort: (host, port) => {
      return get().servers.find(s => s.host === host && s.port === port);
    },
  })
);
