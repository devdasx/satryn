/**
 * WalletMigration
 * Handles migration from single-wallet (v1) to multi-wallet (v2) architecture
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SecureStorage } from '../storage/SecureStorage';
import { useMultiWalletStore, type WalletInfo } from '../../stores/multiWalletStore';

const MIGRATION_KEY = 'multi_wallet_migration_v2_complete';

/**
 * Check if migration has already been completed
 */
export async function isMigrationComplete(): Promise<boolean> {
  const value = await AsyncStorage.getItem(MIGRATION_KEY);
  return value === 'true';
}

/**
 * Mark migration as complete
 */
async function markMigrationComplete(): Promise<void> {
  await AsyncStorage.setItem(MIGRATION_KEY, 'true');
}

/**
 * Migrate from single-wallet to multi-wallet architecture
 * This should be called on app startup before any wallet operations
 */
export async function migrateToMultiWallet(): Promise<void> {
  // Check if already migrated
  if (await isMigrationComplete()) {
    return;
  }


  const store = useMultiWalletStore.getState();

  // Check if there are already wallets in the new store
  if (store.wallets.length > 0) {
    await markMigrationComplete();
    return;
  }

  try {
    // Check for existing HD wallet
    const hasHDWallet = await SecureStorage.hasWallet();
    const hasMultisigWallet = await SecureStorage.hasMultisigWallet();

    if (hasHDWallet) {

      // Get metadata from old wallet
      const metadata = await SecureStorage.getWalletMetadata<{
        createdAt?: number;
        preferredAddressType?: string;
        isMultisig?: boolean;
        multisigConfig?: any;
      }>();

      // Don't migrate if it's a multisig wallet stored as HD
      if (metadata?.isMultisig) {
      } else {
        const wallet: WalletInfo = {
          id: 'migrated-hd-wallet',
          name: 'Personal Wallet',
          type: 'hd',
          createdAt: metadata?.createdAt || Date.now(),
          syncStatus: 'not_synced',
          lastSyncedAt: null,
          balanceSat: 0,
          unconfirmedSat: 0,
        };

        // Add to store directly (not through addWallet to avoid ID generation)
        store.setWallets([wallet]);
        await store.setActiveWallet(wallet.id);

        // Store wallet data reference
        const walletData = {
          type: 'hd' as const,
          hasPassphrase: false,
          preferredAddressType: metadata?.preferredAddressType || 'native_segwit',
          // Note: We don't migrate cached addresses - they'll be regenerated on unlock
        };

        await AsyncStorage.setItem(`wallet_data_${wallet.id}`, JSON.stringify(walletData));

      }
    }

    if (hasMultisigWallet) {

      const metadata = await SecureStorage.getWalletMetadata<{
        createdAt?: number;
        isMultisig?: boolean;
        multisigConfig?: {
          m: number;
          n: number;
          walletName?: string;
        };
      }>();

      if (metadata?.isMultisig && metadata?.multisigConfig) {
        const walletName = metadata.multisigConfig.walletName ||
          `${metadata.multisigConfig.m}-of-${metadata.multisigConfig.n} Multisig`;

        const wallet: WalletInfo = {
          id: 'migrated-multisig-wallet',
          name: walletName,
          type: 'multisig',
          createdAt: metadata?.createdAt || Date.now(),
          syncStatus: 'not_synced',
          lastSyncedAt: null,
          balanceSat: 0,
          unconfirmedSat: 0,
        };

        // Add to existing wallets
        const currentWallets = store.wallets;
        store.setWallets([...currentWallets, wallet]);

        // If no active wallet yet, set this one
        if (!store.activeWalletId) {
          await store.setActiveWallet(wallet.id);
        }

        // Store wallet data reference
        const walletData = {
          type: 'multisig' as const,
          multisigConfig: metadata.multisigConfig,
        };

        await AsyncStorage.setItem(`wallet_data_${wallet.id}`, JSON.stringify(walletData));

      }
    }

    // If no wallets were migrated, that's okay - user will create one
    if (store.wallets.length === 0) {
    }

    await markMigrationComplete();
  } catch (error) {
    // Don't mark as complete so it can be retried
    throw error;
  }
}

/**
 * Reset migration status (for testing/debugging)
 */
export async function resetMigration(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_KEY);
}
