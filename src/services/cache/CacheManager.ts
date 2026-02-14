/**
 * CacheManager — Centralized cache lifecycle management for all wallets.
 *
 * Handles cache deletion on wallet removal, pruning of stale data,
 * and ensures per-wallet cache isolation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';

// All address types used by the app
const ALL_ADDRESS_TYPES: AddressType[] = [
  ADDRESS_TYPES.NATIVE_SEGWIT,
  ADDRESS_TYPES.WRAPPED_SEGWIT,
  ADDRESS_TYPES.LEGACY,
  ADDRESS_TYPES.TAPROOT,
];

export class CacheManager {
  /**
   * Clear ALL caches for a specific wallet.
   * Called when a wallet is deleted.
   */
  static async clearWalletCaches(walletId: string): Promise<void> {
    try {
      const keys = [
        // Wallet state cache
        `wallet_cache_${walletId}`,
        // Transaction cache
        `tx_cache_${walletId}`,
        // Sync state
        `sync_state_${walletId}`,
        // Old address cache format
        `addr_cache_${walletId}`,
        // New address caches (one per address type)
        ...ALL_ADDRESS_TYPES.map(type => `addr_v2_${walletId}_${type}`),
      ];
      await AsyncStorage.multiRemove(keys);
    } catch (error) {
    }
  }

  /**
   * Get all cache keys for a wallet (for debugging/inspection).
   */
  static getCacheKeys(walletId: string): string[] {
    return [
      `wallet_cache_${walletId}`,
      `tx_cache_${walletId}`,
      `sync_state_${walletId}`,
      `addr_cache_${walletId}`,
      ...ALL_ADDRESS_TYPES.map(type => `addr_v2_${walletId}_${type}`),
    ];
  }

  /**
   * Prune stale caches that are older than the given max age.
   * Useful for cleaning up caches from wallets that may have been
   * deleted outside the normal flow.
   */
  static async pruneStale(
    activeWalletIds: string[],
    maxAgeMs: number = 30 * 24 * 60 * 60 * 1000, // 30 days default
  ): Promise<number> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeyPrefixes = ['wallet_cache_', 'tx_cache_', 'addr_v2_', 'addr_cache_', 'sync_state_'];
      const activeSet = new Set(activeWalletIds);

      const keysToRemove: string[] = [];

      for (const key of allKeys) {
        for (const prefix of cacheKeyPrefixes) {
          if (key.startsWith(prefix)) {
            // Extract walletId from key
            const remaining = key.slice(prefix.length);
            // For addr_v2_ keys, format is: walletId_addressType
            // For others, format is: walletId
            const walletId = remaining.includes('_') && prefix === 'addr_v2_'
              ? remaining.substring(0, remaining.lastIndexOf('_'))
              : remaining;

            if (!activeSet.has(walletId)) {
              keysToRemove.push(key);
            }
            break;
          }
        }
      }

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }

      return keysToRemove.length;
    } catch (error) {
      return 0;
    }
  }
}
