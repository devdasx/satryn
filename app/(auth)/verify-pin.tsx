/**
 * Verify PIN Screen — generic PIN verification route
 *
 * Used by wallet removal and other flows that need full-screen PIN verification
 * with proper navigation (hides tab bar, covers entire screen).
 *
 * Query params:
 *   - purpose: string label for the operation (e.g., "remove-wallet")
 *   - title: optional custom title
 *   - subtitle: optional custom subtitle
 *   - icon: optional Ionicons name
 *   - iconColor: optional icon color
 */

import React, { useCallback } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PinCodeScreen } from '../../src/components/security';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { useSettingsStore } from '../../src/stores';

export default function VerifyPinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    purpose?: string;
    title?: string;
    subtitle?: string;
    icon?: string;
    iconColor?: string;
  }>();

  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const valid = await SecureStorage.verifyPin(pin);
    if (valid) {
      SensitiveSession.start(pin);
      return { success: true };
    }
    return { success: false, error: 'Incorrect PIN' };
  }, []);

  const handleSuccess = useCallback(() => {
    // Go back and let the calling screen know PIN was verified
    // The calling screen checks pinVerified state
    router.back();
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

  return (
    <PinCodeScreen
      mode="verify"
      title={params.title || 'Verify Identity'}
      subtitle={params.subtitle || 'Enter your PIN to continue'}
      icon={(params.icon as any) || 'shield-checkmark'}
      iconColor={params.iconColor || undefined}
      onVerify={handleVerify}
      onSuccess={handleSuccess}
      onCancel={handleCancel}
      biometricEnabled={biometricsEnabled}
      onBiometricSuccess={handleBiometricSuccess}
      suppressBiometricAutoPrompt
    />
  );
}
