/**
 * Send — PIN verification step.
 *
 * Full-screen PinCodeScreen in verify mode. On success, reads walletCapability
 * from sendStore and either:
 *  - full_sign: pushes to broadcasting, signs+broadcasts, replaces with success
 *  - multisig: exports partially-signed PSBT, pushes to send-psbt
 *  - watch_only: should not reach here (no PIN needed)
 */

import React, { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { PinCodeScreen } from '../../src/components/security';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { useSendStore } from '../../src/stores/sendStore';
import { useSettingsStore } from '../../src/stores';

export default function SendPinRoute() {
  const router = useRouter();
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const isProcessing = useRef(false);

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const valid = await SecureStorage.verifyPin(pin);
    if (valid) {
      SensitiveSession.start(pin);
      return { success: true };
    }
    return { success: false, error: 'Incorrect PIN' };
  }, []);

  const handleSuccess = useCallback(async (pin: string) => {
    // Prevent double-execution
    if (isProcessing.current) return;
    isProcessing.current = true;

    const { walletCapability, signAndBroadcast, exportPSBT } = useSendStore.getState();

    try {
      if (walletCapability === 'multisig') {
        await exportPSBT(pin);
        router.replace('/(auth)/send-psbt');
      } else {
        // full_sign — navigate to broadcasting screen which handles
        // sign+broadcast, errors, wallet sync, and retry logic
        router.replace('/(auth)/send-broadcasting');
        signAndBroadcast(pin)
          .then(() => router.replace('/(auth)/send-success'))
          .catch(() => {
            // Error is already set in sendStore by signAndBroadcast.
            // Broadcasting screen will detect the error, sync wallet, and show retry/home buttons.
          });
      }
    } catch {
      // Error is set in store by exportPSBT
      router.replace('/(auth)/send-review');
    }
  }, [router]);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  const handleBiometricSuccess = useCallback(async (): Promise<{ success: boolean; pin?: string }> => {
    const pin = await SecureStorage.getPinForBiometrics();
    if (pin) {
      const valid = await SecureStorage.verifyPin(pin);
      if (valid) {
        SensitiveSession.start(pin);
        return { success: true, pin };
      }
    }
    return { success: false };
  }, []);

  const walletCapability = useSendStore((s) => s.walletCapability);
  const subtitle = walletCapability === 'multisig'
    ? 'Enter your PIN to sign the transaction.'
    : 'Enter your PIN to sign and broadcast.';

  return (
    <PinCodeScreen
      mode="verify"
      title="Confirm Transaction"
      subtitle={subtitle}
      icon="send"
      onVerify={handleVerify}
      onSuccess={handleSuccess}
      onCancel={handleCancel}
      biometricEnabled={biometricsEnabled}
      onBiometricSuccess={handleBiometricSuccess}
      suppressBiometricAutoPrompt={false}
    />
  );
}
