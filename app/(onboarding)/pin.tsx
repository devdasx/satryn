import '../../shim';
import React, { useCallback, useMemo } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PinCodeScreen } from '../../src/components/security';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer, type TransferPayload } from '../../src/services/auth/SecureSessionTransfer';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSettingsStore, useWalletStore, useMultiWalletStore } from '../../src/stores';
import { WalletDatabase } from '../../src/services/database';
import { logger } from '../../src/utils/logger';

export default function PinSetupScreen() {
  const router = useRouter();
  const rawParams = useLocalSearchParams<{
    _sst?: string;
    // Legacy direct params (kept for backward compat)
    skipMode?: string;
    preserveRestore?: string;
    isMultisig?: string;
    verifyOnly?: string;
    source?: string;
  }>();

  // Peek at SecureSessionTransfer payload (don't consume yet — re-renders would lose it)
  const sstPayload = useMemo<TransferPayload | null>(
    () => SecureSessionTransfer.peek(rawParams._sst),
    [rawParams._sst],
  );

  // Merge SST payload with direct params for backward compatibility
  const params = useMemo(() => ({ ...sstPayload, ...rawParams }), [sstPayload, rawParams]);

  const isMultisigFlow = params.isMultisig === 'true';
  const isVerifyOnly = params.verifyOnly === 'true';
  const isSkipMode = params.skipMode === 'true';
  const isPreserveRestore = params.preserveRestore === 'true';

  // ── Verify-only mode (existing wallet, e.g. iCloud restore) ──

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    return { success: true };
  }, []);

  const handleVerifySuccess = useCallback((pin: string) => {
    SensitiveSession.start(pin);

    // Check for import-specific params (xprv, WIF, seed bytes)
    const hasImportParams = params.importXprv || params.importKeyWIF || params.importSeedHex;

    if (hasImportParams) {
      // Route to setup with import-specific params via SecureSessionTransfer
      const token = SecureSessionTransfer.store({
        pin,
        isImport: 'true',
        walletName: params.importKeyName || '',
        importXprv: params.importXprv || '',
        importKeyWIF: params.importKeyWIF || '',
        importKeyCompressed: params.importKeyCompressed || 'true',
        importKeyName: params.importKeyName || '',
        importKeyScriptType: params.importKeyScriptType || 'p2wpkh',
        importSeedHex: params.importSeedHex || '',
        derivationConfig: params.derivationConfig || '',
      });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
      return;
    }

    // Standard mnemonic flow
    const mnemonic = params.mnemonic;
    if (!mnemonic) return;

    const token = SecureSessionTransfer.store({
      mnemonic,
      pin,
      passphrase: params.passphrase || '',
      isImport: params.isImport || 'false',
      walletName: params.walletName || '',
      source: params.source || '',
      restorePayload: params.restorePayload || '',
      derivationConfig: params.derivationConfig || '',
    });
    router.replace({
      pathname: '/(onboarding)/setup',
      params: { _sst: token },
    });
  }, [params, router]);

  // ── Create mode (new wallet) ──

  const handleCreateSuccess = useCallback(async (pin: string) => {
    SensitiveSession.start(pin);

    // Auto-enable biometrics if available
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (compatible && enrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enable Face ID for quick unlock',
          fallbackLabel: 'Skip',
          disableDeviceFallback: true,
        });
        if (result.success) {
          await SecureStorage.storePinForBiometrics(pin);
          useSettingsStore.getState().setBiometricsEnabled(true);
        }
      }
    } catch {}

    // Skip mode: PIN created, store PIN hash, navigate directly to the app
    if (isSkipMode) {
      await SecureStorage.storePin(pin);
      useWalletStore.setState({ hasPinSet: true });
      router.replace('/(auth)');
      return;
    }

    // Preserve-data restore: PIN created after wallet restore, store PIN and enter app
    if (isPreserveRestore) {
      await SecureStorage.storePin(pin);

      // Re-store wallet secrets from DB to Keychain.
      // During preserve-on-delete restore, secrets (mnemonic, xprv, etc.) are
      // written to the SQLite wallet row by applyToDatabase(), but NOT to the
      // Keychain (which is where SecureStorage.retrieveWalletSeed reads from).
      // Now that we have the PIN, encrypt and store each wallet's secrets.
      try {
        const db = WalletDatabase.shared();
        const wallets = useMultiWalletStore.getState().wallets;
        for (const wallet of wallets) {
          try {
            const row = db.getWallet(wallet.id);
            if (!row) continue;

            const secretType = row.secretType;
            const isMultisig = row.isMultisig === 1;

            if (isMultisig) {
              // Multisig wallet: restore descriptor and local cosigner seeds
              if (row.descriptor) {
                await SecureStorage.storeMultisigDescriptor(row.descriptor, pin);
              }
              // Local cosigner seeds are stored as JSON in the mnemonic column
              if (row.mnemonic) {
                try {
                  const cosignerSeeds = JSON.parse(row.mnemonic) as Array<{ localIndex: number; mnemonic: string }>;
                  await SecureStorage.clearLocalCosignerSeeds();
                  for (const seed of cosignerSeeds) {
                    if (seed.localIndex !== undefined && seed.mnemonic) {
                      await SecureStorage.storeLocalCosignerSeed(seed.localIndex, seed.mnemonic, pin);
                    }
                  }
                } catch {
                  // mnemonic is not JSON (legacy multisig) — store as regular seed
                  await SecureStorage.storeWalletSeed(wallet.id, row.mnemonic, pin, row.passphrase || '');
                }
              }
            } else if (secretType === 'mnemonic' && row.mnemonic) {
              await SecureStorage.storeWalletSeed(wallet.id, row.mnemonic, pin, row.passphrase || '');
            } else if (secretType === 'xprv' && row.masterXprv) {
              await SecureStorage.storeWalletXprv(wallet.id, row.masterXprv, pin);
            } else if (secretType === 'wif') {
              // For single-key WIF wallets, check address rows for WIF
              const addresses = db.getAddresses(wallet.id);
              const wifAddr = addresses.find(a => a.wif);
              if (wifAddr?.wif) {
                await SecureStorage.storeWalletPrivateKey(wallet.id, wifAddr.wif, pin);
              }
            } else if (secretType === 'seed_hex' && row.seedHex) {
              await SecureStorage.storeWalletSeedHex(wallet.id, row.seedHex, pin);
            }

            // Also store as legacy single-wallet seed for fallback compatibility
            if (wallets.length === 1 && row.mnemonic && secretType === 'mnemonic' && !isMultisig) {
              await SecureStorage.storeSeed(row.mnemonic, pin);
            }
          } catch (err) {
            logger.warn('PRESERVE_RESTORE', `Failed to re-store secrets for wallet ${wallet.id}`, err);
          }
        }
      } catch (err) {
        logger.warn('PRESERVE_RESTORE', 'Failed to re-store wallet secrets from DB to Keychain', err);
      }

      // Re-initialize walletStore so it picks up restored wallets from multiWalletStore/DB
      await useWalletStore.getState().initialize();
      // Unlock immediately since user just authenticated with their new PIN
      await useWalletStore.getState().unlock(pin);
      router.replace('/(auth)/(tabs)');
      return;
    }

    if (isMultisigFlow) {
      const { walletName, descriptor, multisigConfig, localCosignerSeeds } = params;
      if (!descriptor) return;

      const token = SecureSessionTransfer.store({
        mnemonic: 'multisig_descriptor_based',
        pin,
        isMultisig: 'true',
        walletName: walletName || 'Multisig Wallet',
        descriptor,
        multisigConfig: multisigConfig || '',
        localCosignerSeeds: localCosignerSeeds || '',
      });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
      return;
    }

    // Check for import-specific params (xprv, WIF, seed bytes)
    const hasImportParams = params.importXprv || params.importKeyWIF || params.importSeedHex;

    if (hasImportParams) {
      const token = SecureSessionTransfer.store({
        pin,
        isImport: 'true',
        walletName: params.importKeyName || '',
        importXprv: params.importXprv || '',
        importKeyWIF: params.importKeyWIF || '',
        importKeyCompressed: params.importKeyCompressed || 'true',
        importKeyName: params.importKeyName || '',
        importKeyScriptType: params.importKeyScriptType || 'p2wpkh',
        importSeedHex: params.importSeedHex || '',
        derivationConfig: params.derivationConfig || '',
      });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
      return;
    }

    // Standard mnemonic flow
    const mnemonic = params.mnemonic;
    if (!mnemonic) return;

    const token = SecureSessionTransfer.store({
      mnemonic,
      pin,
      passphrase: params.passphrase || '',
      isImport: params.isImport || 'false',
      walletName: params.walletName || '',
      source: params.source || '',
      restorePayload: params.restorePayload || '',
      derivationConfig: params.derivationConfig || '',
    });
    router.replace({
      pathname: '/(onboarding)/setup',
      params: { _sst: token },
    });
  }, [params, router, isMultisigFlow, isSkipMode, isPreserveRestore]);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  // ── Render ──

  if (isVerifyOnly) {
    return (
      <PinCodeScreen
        mode="verify"
        title="Enter your PIN"
        subtitle={
          params.source === 'icloud_restore'
            ? 'Enter your PIN to restore your wallet.'
            : 'Enter your PIN to add a new wallet.'
        }
        icon="lock-closed"
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <PinCodeScreen
      mode="create"
      title={isMultisigFlow ? 'Secure your Multisig' : isPreserveRestore ? 'Set a PIN' : 'Create a PIN'}
      subtitle={
        isMultisigFlow
          ? 'Choose a PIN to protect your multisig wallet.'
          : isPreserveRestore
          ? 'Your wallet has been restored. Choose a PIN to secure it.'
          : 'Choose a PIN to protect your wallet on this device.'
      }
      icon="lock-closed"
      showLengthSelector
      onSuccess={handleCreateSuccess}
      onCancel={isPreserveRestore ? undefined : handleCancel}
    />
  );
}
