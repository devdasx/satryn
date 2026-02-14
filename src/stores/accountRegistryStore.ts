/**
 * Account Registry Store — DB-backed
 *
 * Uses SQLite `app_config` table (key: 'account_registry') as the source of truth.
 * Zustand provides in-memory reactivity for React components.
 * On app start, `loadAccountRegistryFromDB()` hydrates state from the database.
 * One-time migration from AsyncStorage (legacy) if DB has no account registry.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletDatabase } from '../services/database';

const DB_CONFIG_KEY = 'account_registry';

export type AccountType = 'standard' | 'watch-only' | 'multisig';

export interface AccountInfo {
  id: string;
  name: string;
  type: AccountType;
  createdAt: number;
  lastSelectedAt: number;
}

interface AccountRegistryState {
  accounts: AccountInfo[];
  activeAccountId: string | null;

  // Actions
  addAccount: (account: Omit<AccountInfo, 'createdAt' | 'lastSelectedAt'>) => void;
  removeAccount: (id: string) => void;
  selectAccount: (id: string) => void;
  renameAccount: (id: string, name: string) => void;
  getActiveAccount: () => AccountInfo | null;
  initializeDefaultAccount: () => void;
  hasMultipleAccounts: () => boolean;
}

export const useAccountRegistryStore = create<AccountRegistryState>()(
  (set, get) => ({
    accounts: [],
    activeAccountId: null,

    // Add a new account
    addAccount: (account) => {
      const now = Date.now();
      const newAccount: AccountInfo = {
        ...account,
        createdAt: now,
        lastSelectedAt: now,
      };

      set((state) => {
        const accounts = [...state.accounts, newAccount];
        const activeAccountId = state.accounts.length === 0 ? newAccount.id : state.activeAccountId;
        _saveToDb(accounts, activeAccountId);
        return { accounts, activeAccountId };
      });
    },

    // Remove an account
    removeAccount: (id) => {
      set((state) => {
        const newAccounts = state.accounts.filter((a) => a.id !== id);
        let newActiveId = state.activeAccountId;

        // If we're removing the active account, select the first remaining one
        if (state.activeAccountId === id) {
          newActiveId = newAccounts.length > 0 ? newAccounts[0].id : null;
        }

        _saveToDb(newAccounts, newActiveId);
        return {
          accounts: newAccounts,
          activeAccountId: newActiveId,
        };
      });
    },

    // Select an account as active
    selectAccount: (id) => {
      set((state) => {
        const accounts = state.accounts.map((a) =>
          a.id === id ? { ...a, lastSelectedAt: Date.now() } : a
        );
        _saveToDb(accounts, id);
        return { accounts, activeAccountId: id };
      });
    },

    // Rename an account
    renameAccount: (id, name) => {
      set((state) => {
        const accounts = state.accounts.map((a) =>
          a.id === id ? { ...a, name } : a
        );
        _saveToDb(accounts, state.activeAccountId);
        return { accounts };
      });
    },

    // Get the currently active account
    getActiveAccount: () => {
      const { accounts, activeAccountId } = get();
      if (!activeAccountId) return null;
      return accounts.find((a) => a.id === activeAccountId) || null;
    },

    // Initialize with default account if empty
    initializeDefaultAccount: () => {
      const { accounts, addAccount } = get();
      if (accounts.length === 0) {
        addAccount({
          id: 'default',
          name: 'Personal Wallet',
          type: 'standard',
        });
      }
    },

    // Check if there are multiple accounts (for showing/hiding chevron)
    hasMultipleAccounts: () => {
      return get().accounts.length > 1;
    },
  })
);

// ── Write to DB ──────────────────────────────────────────────────────

function _saveToDb(accounts: AccountInfo[], activeAccountId: string | null): void {
  try {
    const db = WalletDatabase.shared();
    db.setConfig(DB_CONFIG_KEY, JSON.stringify({ accounts, activeAccountId }));
  } catch {
    // DB not ready
  }
}

// ── Load from DB ─────────────────────────────────────────────────────

let _accountRegistryLoaded = false;

export function loadAccountRegistryFromDB(): boolean {
  if (_accountRegistryLoaded) return true;

  try {
    const db = WalletDatabase.shared();
    const raw = db.getConfig(DB_CONFIG_KEY);

    if (raw) {
      const parsed = JSON.parse(raw);
      useAccountRegistryStore.setState({
        accounts: parsed.accounts ?? [],
        activeAccountId: parsed.activeAccountId ?? null,
      });
      _accountRegistryLoaded = true;
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
    const raw = await AsyncStorage.getItem('account-registry-storage');
    if (!raw) {
      _accountRegistryLoaded = true;
      return;
    }

    const parsed = JSON.parse(raw);
    const legacyState = parsed?.state ?? parsed;
    const accounts: AccountInfo[] = legacyState?.accounts ?? [];
    const activeAccountId: string | null = legacyState?.activeAccountId ?? null;

    if (accounts.length > 0) {
      // Write to DB
      try {
        const db = WalletDatabase.shared();
        db.setConfig(DB_CONFIG_KEY, JSON.stringify({ accounts, activeAccountId }));
      } catch { /* DB not ready */ }

      useAccountRegistryStore.setState({ accounts, activeAccountId });
    }

    _accountRegistryLoaded = true;
    AsyncStorage.removeItem('account-registry-storage').catch(() => {});
  } catch {
    _accountRegistryLoaded = true;
  }
}

export function resetAccountRegistryLoaded(): void {
  _accountRegistryLoaded = false;
}
