/**
 * WalletManager
 * Central service for wallet CRUD operations
 * Orchestrates between storage, sync, and UI state
 */

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { SecureStorage } from '../storage/SecureStorage';
import { WalletFileService } from '../storage/WalletFileService';
import { ElectrumAPI } from '../electrum';
import { WatchOnlyWallet } from '../../core/wallet/WatchOnlyWallet';
import { SeedGenerator } from '../../core/wallet';
import { useMultiWalletStore, type WalletInfo, type WalletType } from '../../stores/multiWalletStore';
import { ADDRESS_TYPES, DERIVATION } from '../../constants';
import type { AddressInfo } from '../../types';
import { syncNewWalletToDb, type WalletCreationParams } from '../../stores/walletStore';
import { WalletDatabase } from '../database';

// ============================================
// WALLET DATA INTERFACES
// ============================================

export interface WalletPersistedData {
  type: WalletType;
  // HD wallet
  hasPassphrase?: boolean;
  preferredAddressType?: string;
  // Watch-only xpub
  xpub?: string;
  xpubFormat?: 'xpub' | 'ypub' | 'zpub';
  // Watch-only descriptor
  descriptor?: string;
  // Watch-only addresses
  addresses?: string[];
  // Derived addresses cache
  cachedAddresses?: AddressInfo[];
  // Address type
  addressType?: string;
}

export interface SyncResult {
  success: boolean;
  balance?: number;
  unconfirmed?: number;
  error?: string;
}

// ============================================
// WALLET MANAGER
// ============================================

export class WalletManager {
  // ============================================
  // HD WALLET OPERATIONS
  // ============================================

  /**
   * Create a new HD wallet with generated mnemonic
   */
  static async createHDWallet(
    name: string,
    mnemonic: string,
    pin: string,
    passphrase?: string
  ): Promise<WalletInfo> {
    const id = uuidv4();

    // Validate mnemonic
    if (!SeedGenerator.validate(mnemonic)) {
      throw new Error('Invalid seed phrase');
    }

    // Store the encrypted seed
    await SecureStorage.storeSeed(mnemonic, pin, passphrase || '');

    // Store wallet-specific data
    const walletData: WalletPersistedData = {
      type: 'hd',
      hasPassphrase: !!passphrase,
      preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT,
    };
    await this.saveWalletData(id, walletData);

    // Create wallet entry in store
    const store = useMultiWalletStore.getState();
    const wallet = await store.addWallet({
      id,
      name,
      type: 'hd',
    });

    return wallet;
  }

  /**
   * Import an existing HD wallet from mnemonic
   */
  static async importHDWallet(
    name: string,
    mnemonic: string,
    pin: string,
    passphrase?: string
  ): Promise<WalletInfo> {
    // Same as create for HD wallets
    return this.createHDWallet(name, mnemonic, pin, passphrase);
  }

  // ============================================
  // WATCH-ONLY WALLET OPERATIONS
  // ============================================

  /**
   * Import a watch-only wallet from extended public key
   */
  static async importXpubWallet(name: string, xpub: string): Promise<WalletInfo> {
    const id = uuidv4();

    // Validate xpub using WatchOnlyWallet
    let watchWallet: WatchOnlyWallet;
    try {
      watchWallet = WatchOnlyWallet.fromExtendedPublicKey(xpub);
    } catch (error) {
      throw new Error(`Invalid extended public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Detect format
    const prefix = xpub.slice(0, 4) as 'xpub' | 'ypub' | 'zpub';
    const xpubFormat = ['xpub', 'ypub', 'zpub'].includes(prefix) ? prefix : 'xpub';

    // Derive initial addresses for caching
    const receivingAddresses = watchWallet.deriveReceivingAddresses(DERIVATION.GAP_LIMIT);
    const changeAddresses = watchWallet.deriveChangeAddresses(10);
    const cachedAddresses = [...receivingAddresses, ...changeAddresses];

    // Store wallet data
    const walletData: WalletPersistedData = {
      type: 'watch_xpub',
      xpub,
      xpubFormat,
      addressType: watchWallet.getAddressType(),
      cachedAddresses,
    };
    await this.saveWalletData(id, walletData);

    // Create wallet entry in store
    const store = useMultiWalletStore.getState();
    const wallet = await store.addWallet({
      id,
      name,
      type: 'watch_xpub',
    });

    // Write directly to SQLite DB
    syncNewWalletToDb({
      walletId: id,
      name,
      walletType: 'watch_xpub',
      importSource: 'xpub',
      addresses: cachedAddresses,
      preferredAddressType: watchWallet.getAddressType(),
    }, { secretType: 'watch_only' });

    return wallet;
  }

  /**
   * Import a watch-only wallet from output descriptor
   */
  static async importDescriptorWallet(name: string, descriptor: string): Promise<WalletInfo> {
    const id = uuidv4();

    // Validate descriptor using WatchOnlyWallet
    let watchWallet: WatchOnlyWallet;
    try {
      watchWallet = WatchOnlyWallet.fromDescriptor(descriptor);
    } catch (error) {
      throw new Error(`Invalid descriptor: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Derive initial addresses if possible
    let cachedAddresses: AddressInfo[] = [];
    if (watchWallet.canDeriveAddresses()) {
      const receivingAddresses = watchWallet.deriveReceivingAddresses(DERIVATION.GAP_LIMIT);
      const changeAddresses = watchWallet.deriveChangeAddresses(10);
      cachedAddresses = [...receivingAddresses, ...changeAddresses];
    }

    // Store wallet data
    const walletData: WalletPersistedData = {
      type: 'watch_descriptor',
      descriptor,
      addressType: watchWallet.getAddressType(),
      cachedAddresses,
    };
    await this.saveWalletData(id, walletData);

    // Create wallet entry in store
    const store = useMultiWalletStore.getState();
    const wallet = await store.addWallet({
      id,
      name,
      type: 'watch_descriptor',
    });

    // Write directly to SQLite DB
    syncNewWalletToDb({
      walletId: id,
      name,
      walletType: 'watch_descriptor',
      importSource: 'descriptor',
      descriptor,
      addresses: cachedAddresses,
      preferredAddressType: watchWallet.getAddressType(),
    }, { secretType: 'watch_only' });

    return wallet;
  }

  /**
   * Import a watch-only wallet from address list
   */
  static async importAddressesWallet(name: string, addresses: string[]): Promise<WalletInfo> {
    const id = uuidv4();

    if (addresses.length === 0) {
      throw new Error('At least one address is required');
    }

    // Deduplicate addresses
    const uniqueAddresses = [...new Set(addresses)];

    // Validate addresses using WatchOnlyWallet
    try {
      WatchOnlyWallet.fromAddresses(uniqueAddresses);
    } catch (error) {
      throw new Error(`Invalid addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Create cached address info from the list
    const cachedAddresses: AddressInfo[] = uniqueAddresses.map((address, index) => ({
      address,
      path: `external/${index}`,
      index,
      isChange: false,
      type: WatchOnlyWallet.detectAddressType(address) || ADDRESS_TYPES.NATIVE_SEGWIT,
    }));

    // Store wallet data
    const walletData: WalletPersistedData = {
      type: 'watch_addresses',
      addresses: uniqueAddresses,
      cachedAddresses,
    };
    await this.saveWalletData(id, walletData);

    // Create wallet entry in store
    const store = useMultiWalletStore.getState();
    const wallet = await store.addWallet({
      id,
      name,
      type: 'watch_addresses',
    });

    // Write directly to SQLite DB
    syncNewWalletToDb({
      walletId: id,
      name,
      walletType: 'watch_addresses',
      importSource: 'addresses',
      addresses: cachedAddresses,
    }, { secretType: 'watch_only' });

    return wallet;
  }

  // ============================================
  // SYNC OPERATIONS
  // ============================================

  /**
   * Sync a wallet's balance and transactions
   */
  static async syncWallet(wallet: WalletInfo): Promise<SyncResult> {
    const store = useMultiWalletStore.getState();
    store.updateWalletSync(wallet.id, 'syncing');

    try {
      const walletData = await this.getWalletData(wallet.id);
      if (!walletData) {
        throw new Error('Wallet data not found');
      }

      let addresses: string[] = [];

      // Get addresses based on wallet type
      switch (wallet.type) {
        case 'watch_xpub':
          if (walletData.cachedAddresses) {
            addresses = walletData.cachedAddresses.map(a => a.address);
          } else if (walletData.xpub) {
            const watchWallet = WatchOnlyWallet.fromExtendedPublicKey(walletData.xpub);
            addresses = watchWallet.deriveReceivingAddresses(DERIVATION.GAP_LIMIT).map(a => a.address);
          }
          break;

        case 'watch_descriptor':
          if (walletData.cachedAddresses) {
            addresses = walletData.cachedAddresses.map(a => a.address);
          } else if (walletData.descriptor) {
            const watchWallet = WatchOnlyWallet.fromDescriptor(walletData.descriptor);
            if (watchWallet.canDeriveAddresses()) {
              addresses = watchWallet.deriveReceivingAddresses(DERIVATION.GAP_LIMIT).map(a => a.address);
            }
          }
          break;

        case 'watch_addresses':
          addresses = walletData.addresses || [];
          break;

        case 'hd':
        case 'hd_xprv':
        case 'hd_seed':
        case 'hd_descriptor':
        case 'hd_electrum':
        case 'imported_key':
        case 'imported_keys':
        case 'multisig':
          // For HD/imported/multisig wallets, try multiple sources for addresses:
          // 1. First check SQLite DB (the canonical source)
          // 2. Fall back to cachedAddresses in SecureStorage
          // 3. If neither exists, mark as "needs initial sync via walletStore"
          {
            try {
              const db = WalletDatabase.shared();
              const dbAddresses = db.getAddresses(wallet.id);
              if (dbAddresses.length > 0) {
                addresses = dbAddresses.map(a => a.address);
              } else if (walletData.cachedAddresses) {
                addresses = walletData.cachedAddresses.map(a => a.address);
              }
            } catch {
              if (walletData.cachedAddresses) {
                addresses = walletData.cachedAddresses.map(a => a.address);
              }
            }
            // If still no addresses, the wallet needs its first unlock/sync
            // via walletStore.switchToWallet() which derives addresses from seed
          }
          break;

        default:
          throw new Error(`Unsupported wallet type: ${wallet.type}`);
      }

      if (addresses.length === 0) {
        // For HD wallets, this means the wallet needs its first unlock
        // to derive addresses from the seed. Mark as not_synced instead of error.
        if (wallet.type === 'hd' || wallet.type === 'hd_xprv' || wallet.type === 'hd_seed' ||
            wallet.type === 'hd_descriptor' || wallet.type === 'hd_electrum' ||
            wallet.type === 'imported_key' || wallet.type === 'imported_keys' ||
            wallet.type === 'multisig') {
          store.updateWalletSync(wallet.id, 'not_synced');
          return { success: false, error: 'Wallet needs first unlock to derive addresses' };
        }
        throw new Error('No addresses to sync');
      }

      // Query Electrum for balance
      const api = ElectrumAPI.shared('mainnet');
      const balance = await api.getWalletBalance(addresses);

      store.updateWalletSync(
        wallet.id,
        'synced',
        balance.total,
        balance.unconfirmed
      );

      return {
        success: true,
        balance: balance.total,
        unconfirmed: balance.unconfirmed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      store.updateWalletSync(wallet.id, 'error', undefined, undefined, errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sync all wallets using parallel multi-server connections.
   * Much faster than sequential sync when you have multiple wallets.
   */
  static async syncAllWallets(): Promise<void> {
    const store = useMultiWalletStore.getState();
    const wallets = store.wallets;

    if (wallets.length === 0) return;

    // Initialize Electrum pool for parallel operations
    const api = ElectrumAPI.shared('mainnet');
    await api.initializePool(Math.min(wallets.length, 5));

    // Sync all wallets in parallel (pool handles distribution)
    await Promise.all(wallets.map(wallet => this.syncWallet(wallet)));
  }

  /**
   * Sync all wallets with batched limit for very large wallet counts.
   * Use this if you have 10+ wallets to avoid overwhelming memory.
   */
  static async syncAllWalletsBatched(): Promise<void> {
    const store = useMultiWalletStore.getState();
    const wallets = store.wallets;

    // Initialize Electrum pool
    const api = ElectrumAPI.shared('mainnet');
    await api.initializePool(3);

    // Sync in parallel batches of 5
    const CONCURRENT_LIMIT = 5;
    for (let i = 0; i < wallets.length; i += CONCURRENT_LIMIT) {
      const batch = wallets.slice(i, i + CONCURRENT_LIMIT);
      await Promise.all(batch.map(wallet => this.syncWallet(wallet)));
    }
  }

  // ============================================
  // MANAGEMENT OPERATIONS
  // ============================================

  /**
   * Delete a wallet
   */
  static async deleteWallet(id: string): Promise<void> {
    // Remove from store
    const store = useMultiWalletStore.getState();
    await store.removeWallet(id);

    // Delete persisted data
    await this.deleteWalletData(id);
  }

  /**
   * Rename a wallet
   */
  static async renameWallet(id: string, name: string): Promise<void> {
    const store = useMultiWalletStore.getState();
    await store.renameWallet(id, name);
  }

  /**
   * Get addresses for a wallet
   */
  static async getWalletAddresses(id: string): Promise<AddressInfo[]> {
    const walletData = await this.getWalletData(id);
    return walletData?.cachedAddresses || [];
  }

  // ============================================
  // STORAGE HELPERS
  // ============================================

  /**
   * Save wallet-specific data to AsyncStorage
   */
  private static async saveWalletData(id: string, data: WalletPersistedData): Promise<void> {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(`wallet_data_${id}`, JSON.stringify(data));
  }

  /**
   * Get wallet-specific data from AsyncStorage
   */
  static async getWalletData(id: string): Promise<WalletPersistedData | null> {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const data = await AsyncStorage.getItem(`wallet_data_${id}`);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Delete wallet-specific data
   */
  private static async deleteWalletData(id: string): Promise<void> {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(`wallet_data_${id}`);
  }
}
