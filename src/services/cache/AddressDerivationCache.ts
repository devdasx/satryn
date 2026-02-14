/**
 * AddressDerivationCache — Per-wallet address derivation cache with gap limit strategy.
 *
 * Caches derived addresses per wallet and per chain (external/internal) to avoid
 * re-deriving from the HD seed on every app start. Public data only — never stores
 * mnemonics, private keys, or passphrases.
 *
 * Storage key pattern: `addr_v2_${walletId}_${addressType}`
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AddressType, AddressInfo } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────

export interface CachedAddressEntry {
  address: string;
  path: string;           // e.g., "m/84'/0'/0'/0/5"
  index: number;
  isChange: boolean;
  type: AddressType;
  scripthash: string;     // Pre-computed for Electrum queries
  isUsed: boolean;
}

export interface ChainDerivationState {
  lastUsedIndex: number;      // Highest index with confirmed activity (-1 if none)
  lastDerivedIndex: number;   // Highest index we have derived (-1 if none)
}

export interface WalletAddressCache {
  version: 2;
  walletId: string;
  network: 'mainnet' | 'testnet';
  addressType: AddressType;
  external: {
    state: ChainDerivationState;
    addresses: CachedAddressEntry[];
  };
  internal: {
    state: ChainDerivationState;
    addresses: CachedAddressEntry[];
  };
  lastUpdated: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'addr_v2_';
const OLD_CACHE_KEY_PREFIX = 'addr_cache_';
const CACHE_VERSION = 2;

// ─── Helpers ────────────────────────────────────────────────────────

function cacheKey(walletId: string, addressType: AddressType): string {
  return `${CACHE_KEY_PREFIX}${walletId}_${addressType}`;
}

function oldCacheKey(walletId: string): string {
  return `${OLD_CACHE_KEY_PREFIX}${walletId}`;
}

function emptyChainState(): { state: ChainDerivationState; addresses: CachedAddressEntry[] } {
  return {
    state: { lastUsedIndex: -1, lastDerivedIndex: -1 },
    addresses: [],
  };
}

function emptyCache(walletId: string, network: 'mainnet' | 'testnet', addressType: AddressType): WalletAddressCache {
  return {
    version: CACHE_VERSION,
    walletId,
    network,
    addressType,
    external: emptyChainState(),
    internal: emptyChainState(),
    lastUpdated: Date.now(),
  };
}

// ─── AddressDerivationCache ─────────────────────────────────────────

export class AddressDerivationCache {
  /**
   * Load cached addresses for a specific wallet + address type.
   * Returns null if no cache exists.
   */
  static async load(
    walletId: string,
    addressType: AddressType,
  ): Promise<WalletAddressCache | null> {
    try {
      const key = cacheKey(walletId, addressType);
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as WalletAddressCache;
      if (parsed.version !== CACHE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Load all address type caches for a wallet and return a flat AddressInfo array.
   * This is the primary method for loading cached addresses on unlock/switch.
   */
  static async loadAllForWallet(
    walletId: string,
    addressTypes: AddressType[],
  ): Promise<{ addresses: AddressInfo[]; caches: Map<AddressType, WalletAddressCache> } | null> {
    try {
      const keys = addressTypes.map(t => cacheKey(walletId, t));
      const results = await AsyncStorage.multiGet(keys);

      const caches = new Map<AddressType, WalletAddressCache>();
      const addresses: AddressInfo[] = [];
      let hasAny = false;

      for (let i = 0; i < addressTypes.length; i++) {
        const [, raw] = results[i];
        if (!raw) continue;

        const parsed = JSON.parse(raw) as WalletAddressCache;
        if (parsed.version !== CACHE_VERSION) continue;

        hasAny = true;
        caches.set(addressTypes[i], parsed);

        // Convert cached entries to AddressInfo
        for (const entry of parsed.external.addresses) {
          addresses.push(cachedEntryToAddressInfo(entry));
        }
        for (const entry of parsed.internal.addresses) {
          addresses.push(cachedEntryToAddressInfo(entry));
        }
      }

      return hasAny ? { addresses, caches } : null;
    } catch {
      return null;
    }
  }

  /**
   * Save a wallet address cache for a specific address type.
   */
  static async save(cache: WalletAddressCache): Promise<void> {
    try {
      cache.lastUpdated = Date.now();
      const key = cacheKey(cache.walletId, cache.addressType);
      await AsyncStorage.setItem(key, JSON.stringify(cache));
    } catch (error) {
      // Failed to save
    }
  }

  /**
   * Save multiple caches atomically.
   */
  static async saveMultiple(caches: WalletAddressCache[]): Promise<void> {
    try {
      const entries: [string, string][] = caches.map(c => {
        c.lastUpdated = Date.now();
        return [cacheKey(c.walletId, c.addressType), JSON.stringify(c)];
      });
      await AsyncStorage.multiSet(entries);
    } catch (error) {
      // Failed to save multiple
    }
  }

  /**
   * Create or update a cache from a flat AddressInfo array (typically from initial derivation).
   * Converts the flat array into the structured cache format with scripthashes.
   */
  static createFromAddresses(
    walletId: string,
    network: 'mainnet' | 'testnet',
    addressType: AddressType,
    addresses: AddressInfo[],
    computeScripthash: (address: string) => string,
    usedAddresses?: Set<string>,
  ): WalletAddressCache {
    const cache = emptyCache(walletId, network, addressType);

    const typeAddresses = addresses.filter(a => a.type === addressType);

    for (const addr of typeAddresses) {
      const entry: CachedAddressEntry = {
        address: addr.address,
        path: addr.path,
        index: addr.index,
        isChange: addr.isChange,
        type: addr.type,
        scripthash: computeScripthash(addr.address),
        isUsed: usedAddresses?.has(addr.address) ?? false,
      };

      const chain = addr.isChange ? cache.internal : cache.external;
      chain.addresses.push(entry);

      // Track highest derived index
      if (addr.index > chain.state.lastDerivedIndex) {
        chain.state.lastDerivedIndex = addr.index;
      }

      // Track highest used index
      if (entry.isUsed && addr.index > chain.state.lastUsedIndex) {
        chain.state.lastUsedIndex = addr.index;
      }
    }

    return cache;
  }

  /**
   * Mark addresses as used and check if the gap window needs extending.
   * Returns true if more addresses need to be derived.
   */
  static markUsed(
    cache: WalletAddressCache,
    usedAddresses: Set<string>,
  ): { needsExtension: boolean; chain: 'external' | 'internal' } | null {
    let needsExtension = false;
    let extendChain: 'external' | 'internal' = 'external';

    for (const chainKey of ['external', 'internal'] as const) {
      const chain = cache[chainKey];
      let updated = false;

      // Build address→entry index for O(1) lookups instead of linear scan
      // Only iterate usedAddresses (typically smaller than chain.addresses)
      const addressIndex = new Map<string, CachedAddressEntry>();
      for (const entry of chain.addresses) {
        if (!entry.isUsed) {
          addressIndex.set(entry.address, entry);
        }
      }
      for (const addr of usedAddresses) {
        const entry = addressIndex.get(addr);
        if (entry) {
          entry.isUsed = true;
          if (entry.index > chain.state.lastUsedIndex) {
            chain.state.lastUsedIndex = entry.index;
            updated = true;
          }
        }
      }

      // Check if we're approaching the end of our derived window
      if (updated) {
        const gap = chain.state.lastDerivedIndex - chain.state.lastUsedIndex;
        if (gap < 10) { // Less than half the standard gap limit remaining
          needsExtension = true;
          extendChain = chainKey;
        }
      }
    }

    return needsExtension ? { needsExtension, chain: extendChain } : null;
  }

  /**
   * Check if more addresses need to be derived to maintain the gap limit window.
   * Returns the range that needs derivation, or null if coverage is sufficient.
   */
  static getDerivationRange(
    cache: WalletAddressCache,
    chain: 'external' | 'internal',
    gapLimit: number,
  ): { startIndex: number; endIndex: number } | null {
    const chainData = cache[chain];
    const windowEnd = chainData.state.lastUsedIndex + gapLimit;

    if (chainData.state.lastDerivedIndex >= windowEnd) {
      return null; // Already have enough addresses
    }

    return {
      startIndex: chainData.state.lastDerivedIndex + 1,
      endIndex: windowEnd,
    };
  }

  /**
   * Add newly derived addresses to the cache.
   */
  static addDerivedAddresses(
    cache: WalletAddressCache,
    chain: 'external' | 'internal',
    entries: CachedAddressEntry[],
  ): void {
    const chainData = cache[chain];
    chainData.addresses.push(...entries);

    // Update lastDerivedIndex
    for (const entry of entries) {
      if (entry.index > chainData.state.lastDerivedIndex) {
        chainData.state.lastDerivedIndex = entry.index;
      }
    }
  }

  /**
   * Migrate from old cache format (addr_cache_*) to new format (addr_v2_*).
   * Returns the migrated addresses or null if no old cache exists.
   */
  static async migrateFromLegacy(
    walletId: string,
    computeScripthash: (address: string) => string,
  ): Promise<AddressInfo[] | null> {
    try {
      const oldKey = oldCacheKey(walletId);
      const raw = await AsyncStorage.getItem(oldKey);
      if (!raw) return null;

      const { addresses } = JSON.parse(raw) as {
        addresses: AddressInfo[];
        indices: Record<string, { receiving: number; change: number }>;
      };

      if (!addresses || addresses.length === 0) return null;

      // Group by address type and create new caches
      const typeGroups = new Map<AddressType, AddressInfo[]>();
      for (const addr of addresses) {
        const group = typeGroups.get(addr.type) || [];
        group.push(addr);
        typeGroups.set(addr.type, group);
      }

      const cachesToSave: WalletAddressCache[] = [];
      // Detect network from first address
      const network: 'mainnet' | 'testnet' =
        addresses[0]?.address?.startsWith('tb1') || addresses[0]?.address?.startsWith('m') || addresses[0]?.address?.startsWith('n') || addresses[0]?.address?.startsWith('2')
          ? 'testnet' : 'mainnet';

      for (const [addressType, addrs] of typeGroups) {
        const cache = AddressDerivationCache.createFromAddresses(
          walletId,
          network,
          addressType,
          addrs,
          computeScripthash,
        );
        cachesToSave.push(cache);
      }

      // Save new format and delete old
      await AddressDerivationCache.saveMultiple(cachesToSave);
      await AsyncStorage.removeItem(oldKey);

      return addresses;
    } catch (error) {
      // Migration failed
      return null;
    }
  }

  /**
   * Delete all caches for a wallet.
   */
  static async deleteForWallet(
    walletId: string,
    addressTypes: AddressType[],
  ): Promise<void> {
    try {
      const keys = addressTypes.map(t => cacheKey(walletId, t));
      // Also clean up old format
      keys.push(oldCacheKey(walletId));
      await AsyncStorage.multiRemove(keys);
    } catch (error) {
      // Failed to delete
    }
  }

  /**
   * Get all scripthashes from cache for efficient Electrum queries.
   */
  static getAllScripthashes(cache: WalletAddressCache): string[] {
    const hashes: string[] = [];
    for (const entry of cache.external.addresses) {
      hashes.push(entry.scripthash);
    }
    for (const entry of cache.internal.addresses) {
      hashes.push(entry.scripthash);
    }
    return hashes;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function cachedEntryToAddressInfo(entry: CachedAddressEntry): AddressInfo {
  return {
    address: entry.address,
    path: entry.path,
    index: entry.index,
    isChange: entry.isChange,
    type: entry.type,
  };
}
