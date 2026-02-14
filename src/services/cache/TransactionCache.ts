/**
 * TransactionCache — Per-wallet transaction cache with incremental refresh.
 *
 * Stores transaction data locally so confirmed historical transactions are not
 * re-fetched on every sync. Only new transactions and unconfirmed transactions
 * are refreshed.
 *
 * Storage key pattern: `tx_cache_${walletId}`
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DetailedTransactionInfo } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────

export interface ScripthashSyncState {
  lastSeenTxCount: number;    // Number of txs at last check
  lastCheckedHeight: number;  // Block height when last checked
}

export interface TransactionCacheState {
  version: 1;
  walletId: string;
  transactions: DetailedTransactionInfo[];
  lastSyncTime: number;                             // Unix ms
  lastKnownTipHeight: number;                       // Block height at last sync
  scripthashStates: Record<string, ScripthashSyncState>;
  pendingTxids: string[];                           // Unconfirmed txids to re-check
}

// ─── Constants ──────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'tx_cache_';
const CACHE_VERSION = 1;

// Transactions older than this with enough confirmations are considered stable
const STABLE_CONFIRMATIONS = 6;

// ─── TransactionCache ───────────────────────────────────────────────

export class TransactionCache {
  /**
   * Load transaction cache for a wallet.
   */
  static async load(walletId: string): Promise<TransactionCacheState | null> {
    try {
      const key = `${CACHE_KEY_PREFIX}${walletId}`;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as TransactionCacheState;
      if (parsed.version !== CACHE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Save transaction cache for a wallet.
   */
  static async save(cache: TransactionCacheState): Promise<void> {
    try {
      const key = `${CACHE_KEY_PREFIX}${cache.walletId}`;
      await AsyncStorage.setItem(key, JSON.stringify(cache));
    } catch (error) {
    }
  }

  /**
   * Create a new empty cache for a wallet.
   */
  static createEmpty(walletId: string): TransactionCacheState {
    return {
      version: CACHE_VERSION,
      walletId,
      transactions: [],
      lastSyncTime: 0,
      lastKnownTipHeight: 0,
      scripthashStates: {},
      pendingTxids: [],
    };
  }

  /**
   * Create a cache from a full sync result.
   * Used after the first complete sync for a wallet.
   */
  static createFromFullSync(
    walletId: string,
    transactions: DetailedTransactionInfo[],
    tipHeight: number,
    scripthashCounts: Record<string, number>,
  ): TransactionCacheState {
    const pendingTxids = transactions
      .filter(tx => !tx.confirmed)
      .map(tx => tx.txid);

    const scripthashStates: Record<string, ScripthashSyncState> = {};
    for (const [sh, count] of Object.entries(scripthashCounts)) {
      scripthashStates[sh] = {
        lastSeenTxCount: count,
        lastCheckedHeight: tipHeight,
      };
    }

    return {
      version: CACHE_VERSION,
      walletId,
      transactions,
      lastSyncTime: Date.now(),
      lastKnownTipHeight: tipHeight,
      scripthashStates,
      pendingTxids,
    };
  }

  /**
   * Determine which scripthashes need refreshing based on changed tx counts.
   * Returns the list of scripthashes that have new transactions.
   */
  static getChangedScripthashes(
    cache: TransactionCacheState,
    currentCounts: Record<string, number>,
  ): string[] {
    const changed: string[] = [];

    for (const [sh, count] of Object.entries(currentCounts)) {
      const cached = cache.scripthashStates[sh];
      if (!cached || count > cached.lastSeenTxCount) {
        changed.push(sh);
      }
    }

    return changed;
  }

  /**
   * Get txids that need to be fetched (not already in cache).
   */
  static getNewTxids(
    cache: TransactionCacheState,
    allTxids: string[],
  ): string[] {
    const cachedTxids = new Set(cache.transactions.map(tx => tx.txid));
    return allTxids.filter(txid => !cachedTxids.has(txid));
  }

  /**
   * Merge new transactions into the cache and update state.
   * Handles:
   * - Adding new transactions
   * - Updating previously unconfirmed transactions that are now confirmed
   * - Updating confirmation counts
   */
  static merge(
    cache: TransactionCacheState,
    newTransactions: DetailedTransactionInfo[],
    tipHeight: number,
    updatedScripthashCounts: Record<string, number>,
  ): void {
    const txMap = new Map<string, DetailedTransactionInfo>();

    // Start with existing transactions
    for (const tx of cache.transactions) {
      txMap.set(tx.txid, tx);
    }

    // Merge new/updated transactions (overwrites existing)
    for (const tx of newTransactions) {
      txMap.set(tx.txid, tx);
    }

    // Update confirmation counts only for transactions that changed
    // (new txs or height-changed txs) instead of re-computing all
    for (const tx of txMap.values()) {
      if (tx.confirmed && tx.height > 0) {
        const newConf = tipHeight - tx.height + 1;
        if (tx.confirmations !== newConf) {
          tx.confirmations = newConf;
        }
      }
    }

    // Convert to array and sort — only needed when new txs were added
    const txArray = Array.from(txMap.values());
    if (newTransactions.length > 0) {
      txArray.sort((a, b) => {
        // Pending first, then by height descending
        if (!a.confirmed && b.confirmed) return -1;
        if (a.confirmed && !b.confirmed) return 1;
        return b.height - a.height;
      });
    }
    cache.transactions = txArray;

    cache.lastSyncTime = Date.now();
    cache.lastKnownTipHeight = tipHeight;

    // Update pending txids
    cache.pendingTxids = cache.transactions
      .filter(tx => !tx.confirmed)
      .map(tx => tx.txid);

    // Update scripthash states
    for (const [sh, count] of Object.entries(updatedScripthashCounts)) {
      cache.scripthashStates[sh] = {
        lastSeenTxCount: count,
        lastCheckedHeight: tipHeight,
      };
    }
  }

  /**
   * Update a previously pending transaction to confirmed status.
   */
  static confirmTransaction(
    cache: TransactionCacheState,
    txid: string,
    height: number,
    tipHeight: number,
  ): boolean {
    const tx = cache.transactions.find(t => t.txid === txid);
    if (!tx) return false;

    tx.confirmed = true;
    tx.height = height;
    tx.confirmations = tipHeight - height + 1;
    tx.status = 'confirmed';

    // Remove from pending
    cache.pendingTxids = cache.pendingTxids.filter(id => id !== txid);

    return true;
  }

  /**
   * Check if a transaction is considered "stable" (deeply confirmed).
   * Stable transactions don't need to be re-checked.
   */
  static isStable(tx: DetailedTransactionInfo): boolean {
    return tx.confirmed && tx.confirmations >= STABLE_CONFIRMATIONS;
  }

  /**
   * Get transactions that still need to be re-checked (pending + recently confirmed).
   */
  static getUnstableTxids(cache: TransactionCacheState): string[] {
    return cache.transactions
      .filter(tx => !TransactionCache.isStable(tx))
      .map(tx => tx.txid);
  }

  /**
   * Delete transaction cache for a wallet.
   */
  static async delete(walletId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}${walletId}`);
    } catch (error) {
    }
  }

  /**
   * Check if the cache is fresh enough to use (within threshold).
   */
  static isFresh(cache: TransactionCacheState, thresholdMs: number): boolean {
    return Date.now() - cache.lastSyncTime < thresholdMs;
  }

  /**
   * Get cached transaction count for display.
   */
  static getCount(cache: TransactionCacheState): {
    total: number;
    confirmed: number;
    pending: number;
  } {
    return {
      total: cache.transactions.length,
      confirmed: cache.transactions.filter(tx => tx.confirmed).length,
      pending: cache.pendingTxids.length,
    };
  }
}
