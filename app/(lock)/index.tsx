import '../../shim';
import React, { useEffect, useCallback } from 'react';
import { View, StyleSheet, BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import { PinCodeScreen } from '../../src/components/security';
import { useWalletStore, useSettingsStore, useDeepLinkStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';

export default function LockScreen() {
  const router = useRouter();
  const unlock = useWalletStore((state) => state.unlock);
  const deleteWallet = useWalletStore((state) => state.deleteWallet);
  const wasManuallyLocked = useWalletStore((state) => state.wasManuallyLocked);
  const clearManualLockFlag = useWalletStore((state) => state.clearManualLockFlag);
  const biometricsEnabled = useSettingsStore((state) => state.biometricsEnabled);

  // Prevent back button on Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => backHandler.remove();
  }, []);

  // If no PIN exists (e.g., after preserve-data restore before PIN creation),
  // redirect to PIN creation instead of showing an unresolvable lock screen.
  useEffect(() => {
    SecureStorage.hasPinSet().then((hasPin) => {
      if (!hasPin) {
        console.log('[LockScreen] No PIN set — redirecting to PIN creation (preserveRestore)');
        router.replace({ pathname: '/(onboarding)/pin', params: { preserveRestore: 'true' } });
      }
    });
  }, [router]);

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    SensitiveSession.start(pin);
    return { success: true };
  }, []);

  const handleSuccess = useCallback(async (pin: string) => {
    clearManualLockFlag();
    await unlock(pin);

    // If a deep link payment request is pending, route to send flow
    const pending = useDeepLinkStore.getState().pendingPayload;
    if (pending && pending.recipients?.length > 0) {
      const first = pending.recipients[0];
      router.replace({
        pathname: '/(auth)/send',
        params: {
          address: first.address,
          amount: first.amountSats ? String(first.amountSats) : undefined,
          memo: pending.memo || undefined,
        },
      });
      return;
    }

    // Lock screen replaced the auth route, so navigate back to auth tabs
    router.replace('/(auth)/(tabs)');
  }, [unlock, router, clearManualLockFlag]);

  const handleBiometricSuccess = useCallback(async () => {
    const pin = await SecureStorage.getPinForBiometrics();
    if (pin) {
      SensitiveSession.start(pin);
      return { success: true, pin };
    }
    return { success: false } as { success: boolean; pin?: string };
  }, []);

  const handleCancel = useCallback(() => {
    // Cannot cancel on lock screen
  }, []);

  const handleAppReset = useCallback(async () => {
    await deleteWallet();
    router.replace('/(onboarding)');
  }, [deleteWallet, router]);

  return (
    <View style={styles.container}>
      <PinCodeScreen
        mode="unlock"
        title="Bitcoin Wallet"
        subtitle="Enter PIN to unlock"
        icon="lock-closed"
        iconColor="#F7931A"
        onVerify={handleVerify}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
        showBackButton={false}
        suppressBiometricAutoPrompt={wasManuallyLocked}
        onAppReset={handleAppReset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
