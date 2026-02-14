import '../../shim';
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { PinCodeScreen } from '../../src/components/security';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { useHaptics } from '../../src/hooks';

type Step = 'current' | 'new';

export default function ChangePinScreen() {
  const router = useRouter();
  const haptics = useHaptics();

  const [step, setStep] = useState<Step>('current');
  const [currentPin, setCurrentPin] = useState('');

  // ── Step 1: Verify current PIN ──

  const handleVerifyCurrent = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    return { success: true };
  }, []);

  const handleCurrentSuccess = useCallback((pin: string) => {
    setCurrentPin(pin);
    setStep('new');
  }, []);

  // ── Step 2: Create new PIN (includes confirm step internally) ──

  const handleNewPinSuccess = useCallback(async (newPin: string) => {
    try {
      const success = await SecureStorage.changePin(currentPin, newPin);
      if (success) {
        await haptics.trigger('success');
        Alert.alert(
          'PIN Changed',
          'Your PIN has been successfully updated.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else {
        await haptics.trigger('error');
        Alert.alert('Error', 'Failed to change PIN. Please try again.');
      }
    } catch {
      await haptics.trigger('error');
      Alert.alert('Error', 'Failed to change PIN. Please try again.');
    }
  }, [currentPin, haptics, router]);

  const handleCancel = useCallback(() => {
    if (step === 'new') {
      setStep('current');
      setCurrentPin('');
    } else {
      router.back();
    }
  }, [step, router]);

  // ── Render ──
  // key={step} forces a full remount when switching steps,
  // ensuring pin state resets completely between verify → create.

  if (step === 'current') {
    return (
      <PinCodeScreen
        key="verify-current"
        mode="verify"
        title="Current PIN"
        subtitle="Enter your current PIN to continue"
        icon="lock-closed"
        onVerify={handleVerifyCurrent}
        onSuccess={handleCurrentSuccess}
        onCancel={handleCancel}
        showBackButton
      />
    );
  }

  // step === 'new': Don't pass title/subtitle so PinCodeScreen's
  // internal logic handles "New PIN" → "Confirm your PIN" transition.
  return (
    <PinCodeScreen
      key="create-new"
      mode="create"
      icon="key"
      showLengthSelector
      onSuccess={handleNewPinSuccess}
      onCancel={handleCancel}
      showBackButton
    />
  );
}
