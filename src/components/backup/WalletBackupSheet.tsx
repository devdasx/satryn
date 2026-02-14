/**
 * WalletBackupSheet — Unified wallet backup component
 *
 * A reusable component for backing up individual wallets to iCloud.
 * Handles the full flow: PIN verification → password creation → encryption → upload
 *
 * Usage:
 * ```tsx
 * <WalletBackupSheet
 *   visible={showBackup}
 *   onClose={() => setShowBackup(false)}
 *   walletId="wallet_123"
 *   walletName="My Wallet"
 *   walletType="hd"
 *   onSuccess={() => console.log('Backup complete!')}
 * />
 * ```
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';
import { useSettingsStore } from '../../stores';
import { SecureStorage } from '../../services/storage/SecureStorage';
import { BackupService, ICloudService } from '../../services/backup';
import { SensitiveSession } from '../../services/auth/SensitiveSession';
import { getDeviceId } from '../../services/DeviceIdentity';
import { PinCodeScreen } from '../security';
import { AppBottomSheet, SheetPrimaryButton, SheetSectionFooter } from '../ui';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import type { WalletType } from '../../stores/multiWalletStore';

export interface WalletBackupSheetProps {
  /** Whether the sheet is visible */
  visible: boolean;
  /** Called when the sheet should close */
  onClose: () => void;
  /** Wallet ID to back up */
  walletId: string;
  /** Wallet name for display */
  walletName: string;
  /** Wallet type (determines if password is needed) */
  walletType: WalletType;
  /** Called when backup completes successfully */
  onSuccess?: () => void;
  /** Called when backup fails */
  onError?: (error: Error) => void;
}

type Step = 'pin' | 'password' | 'confirm' | 'uploading' | 'success' | 'error';
type UploadStep = 'assembling' | 'encrypting' | 'uploading' | 'done';

export function WalletBackupSheet({
  visible,
  onClose,
  walletId,
  walletName,
  walletType,
  onSuccess,
  onError,
}: WalletBackupSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const { biometricsEnabled, markBackedUp } = useSettingsStore();

  // Check if password is needed for this wallet type
  const needsPassword = BackupService.requiresPassword(walletType);

  // Check if session is already active
  const sessionActive = SensitiveSession.isActive();

  // State
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [uploadStep, setUploadStep] = useState<UploadStep>('assembling');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const hasStartedUpload = useRef(false);

  // Reset state when sheet opens
  useEffect(() => {
    if (visible) {
      hasStartedUpload.current = false;
      setPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      setErrorMessage(null);

      // If session is active and no password needed, go straight to upload
      if (sessionActive && !needsPassword) {
        const sessionPin = SensitiveSession.getPin() || '';
        setPin(sessionPin);
        handleUpload(sessionPin, '');
      } else if (sessionActive) {
        // Session active but password needed
        setPin(SensitiveSession.getPin() || '');
        setStep('password');
      } else {
        // Need PIN verification first
        setStep('pin');
      }
    }
  }, [visible, sessionActive, needsPassword]);

  // ─── PIN Verification ─────────────────────────────────────

  const handlePinVerify = useCallback(async (pinInput: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pinInput);
    if (isValid) {
      SensitiveSession.start(pinInput);
      return { success: true };
    }
    return { success: false, error: 'Incorrect PIN' };
  }, []);

  const handlePinSuccess = useCallback((verifiedPin: string) => {
    setPin(verifiedPin);
    if (needsPassword) {
      setStep('password');
    } else {
      // Watch-only wallets skip password
      handleUpload(verifiedPin, '');
    }
  }, [needsPassword]);

  const handleBiometricSuccess = useCallback(async () => {
    const storedPin = await SecureStorage.getPinForBiometrics();
    if (storedPin) {
      SensitiveSession.start(storedPin);
      return { success: true, pin: storedPin };
    }
    return { success: false } as { success: boolean; pin?: string };
  }, []);

  // ─── Password Handling ────────────────────────────────────

  const handlePasswordNext = useCallback(() => {
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setPasswordError(null);
    setStep('confirm');
  }, [password]);

  const handleConfirmNext = useCallback(() => {
    if (confirmPassword !== password) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordError(null);
    handleUpload(pin, password);
  }, [confirmPassword, password, pin]);

  // ─── Upload ───────────────────────────────────────────────

  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 50));

  const handleUpload = async (pinToUse: string, passwordToUse: string) => {
    if (hasStartedUpload.current) return;
    hasStartedUpload.current = true;

    setUploadStep('assembling');
    setStep('uploading');

    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      // Check iCloud availability
      if (!ICloudService.isAvailable()) {
        throw new Error('iCloud is not available. Please sign in to iCloud in Settings.');
      }

      // Step 1: Assemble payload
      const payload = await BackupService.assemblePayload(walletId, pinToUse);
      if (!payload) throw new Error('Failed to read wallet data. Please try again.');
      await haptics.trigger('light');

      // Step 2: Encrypt
      setUploadStep('encrypting');
      await yieldToUI();
      const deviceId = await getDeviceId();
      const blob = await BackupService.encryptBackup(payload, passwordToUse, deviceId);
      await haptics.trigger('light');

      // Step 3: Upload to iCloud
      setUploadStep('uploading');
      await yieldToUI();
      ICloudService.writeBackup(walletId, blob);

      // Mark as backed up
      markBackedUp(walletId, 'icloud');

      setUploadStep('done');
      await haptics.trigger('success');
      setStep('success');
      onSuccess?.();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Backup failed. Please try again.');
      await haptics.trigger('error');
      setStep('error');
      onError?.(error);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────

  const getUploadStepLabel = (): string => {
    switch (uploadStep) {
      case 'assembling': return 'Reading wallet data...';
      case 'encrypting': return 'Deriving encryption key...';
      case 'uploading': return 'Uploading to iCloud...';
      case 'done': return 'Done';
    }
  };

  const getUploadStepIndex = (): number => {
    switch (uploadStep) {
      case 'assembling': return 0;
      case 'encrypting': return 1;
      case 'uploading': return 2;
      case 'done': return 3;
    }
  };

  const getPasswordStrength = (pw: string): { level: number; label: string; color: string } => {
    if (pw.length === 0) return { level: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { level: 1, label: 'Weak', color: '#FF453A' };
    if (score <= 2) return { level: 2, label: 'Fair', color: '#FF9F0A' };
    if (score <= 3) return { level: 3, label: 'Good', color: '#FFD60A' };
    return { level: 4, label: 'Strong', color: '#30D158' };
  };

  const passwordStrength = getPasswordStrength(password);

  // ─── PIN Screen (Full Screen Modal) ───────────────────────

  if (step === 'pin' && visible) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={onClose}
      >
        <PinCodeScreen
          mode="verify"
          title="Verify Identity"
          subtitle="Enter your PIN to create an iCloud backup"
          icon="cloud-upload"
          iconColor="#007AFF"
          onVerify={handlePinVerify}
          onSuccess={handlePinSuccess}
          onCancel={onClose}
          biometricEnabled={biometricsEnabled}
          onBiometricSuccess={handleBiometricSuccess}
          showBackButton
        />
      </Modal>
    );
  }

  // ─── Sheet Content ────────────────────────────────────────

  const renderContent = () => {
    // Password Entry
    if (step === 'password') {
      return (
        <View style={styles.sheetContent}>
          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={[styles.instruction, { color: colors.textSecondary }]}>
              Choose a strong password to encrypt your backup. You'll need this password to restore.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <PremiumInputCard>
              <PremiumInput
                icon="key"
                iconColor="#FF9F0A"
                placeholder="Backup password"
                value={password}
                onChangeText={(t) => { setPassword(t); setPasswordError(null); }}
                secureTextEntry
                autoFocus
              />
            </PremiumInputCard>

            {/* Strength indicator */}
            {password.length > 0 && (
              <View style={styles.strengthRow}>
                <View style={styles.strengthBars}>
                  {[0, 1, 2, 3].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        { backgroundColor: i < passwordStrength.level
                          ? passwordStrength.color
                          : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                  {passwordStrength.label}
                </Text>
              </View>
            )}

            {passwordError && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" />
                <Text style={styles.errorText}>{passwordError}</Text>
              </Animated.View>
            )}
          </Animated.View>

          <SheetSectionFooter
            text="This password is required to restore your backup. Store it safely — it cannot be recovered."
            variant="info"
          />
        </View>
      );
    }

    // Confirm Password
    if (step === 'confirm') {
      return (
        <View style={styles.sheetContent}>
          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={[styles.instruction, { color: colors.textSecondary }]}>
              Re-enter your password to confirm.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <PremiumInputCard>
              <PremiumInput
                icon="shield-checkmark"
                iconColor="#5E5CE6"
                placeholder="Confirm password"
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setPasswordError(null); }}
                secureTextEntry
                autoFocus
              />
            </PremiumInputCard>

            {passwordError && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" />
                <Text style={styles.errorText}>{passwordError}</Text>
              </Animated.View>
            )}
          </Animated.View>
        </View>
      );
    }

    // Uploading
    if (step === 'uploading') {
      const stepIndex = getUploadStepIndex();
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color={colors.text} style={{ marginBottom: 16 }} />
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              Encrypting & uploading
            </Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
              {getUploadStepLabel()}
            </Text>
            <View style={styles.progressRow}>
              {['Read', 'Encrypt', 'Upload'].map((label, i) => (
                <View key={label} style={styles.progressItem}>
                  <View style={[
                    styles.progressDot,
                    {
                      backgroundColor: i < stepIndex ? '#30D158'
                        : i === stepIndex ? colors.text
                        : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
                    },
                  ]} />
                  <Text style={[styles.progressLabel, { color: i <= stepIndex ? colors.textSecondary : colors.textMuted }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      );
    }

    // Success
    if (step === 'success') {
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIcon, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
              <Ionicons name="cloud-done" size={36} color="#30D158" />
            </View>
            <Text style={[styles.statusTitle, { color: colors.text }]}>Backed up to iCloud</Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
              {walletName} has been encrypted and stored in iCloud.
            </Text>
            {needsPassword && (
              <View style={[styles.reminderCard, { backgroundColor: isDark ? 'rgba(255,200,120,0.06)' : 'rgba(180,140,60,0.06)' }]}>
                <Ionicons name="key-outline" size={14} color={isDark ? 'rgba(255,210,140,0.7)' : 'rgba(150,110,40,0.7)'} />
                <Text style={[styles.reminderText, { color: colors.textSecondary }]}>
                  Remember your backup password. Without it, this backup cannot be restored.
                </Text>
              </View>
            )}
          </View>
        </View>
      );
    }

    // Error
    if (step === 'error') {
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIcon, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
              <Ionicons name="cloud-offline" size={36} color="#FF453A" />
            </View>
            <Text style={[styles.statusTitle, { color: colors.text }]}>Backup failed</Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
              {errorMessage || 'Something went wrong. Please try again.'}
            </Text>
          </View>
        </View>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (step === 'password') {
      return (
        <SheetPrimaryButton
          label="Continue"
          onPress={handlePasswordNext}
          disabled={password.length < 8}
        />
      );
    }

    if (step === 'confirm') {
      return (
        <SheetPrimaryButton
          label="Encrypt & Back up"
          onPress={handleConfirmNext}
          disabled={!confirmPassword}
        />
      );
    }

    if (step === 'success') {
      return (
        <SheetPrimaryButton
          label="Done"
          onPress={onClose}
        />
      );
    }

    if (step === 'error') {
      return (
        <View style={styles.errorButtonsRow}>
          <SheetPrimaryButton
            label="Retry"
            onPress={() => {
              hasStartedUpload.current = false;
              handleUpload(pin, password);
            }}
          />
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  // Don't render sheet during PIN step
  if (step === 'pin') return null;

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={step === 'password' ? 'Create Password' : step === 'confirm' ? 'Confirm Password' : step === 'success' ? 'Backup Complete' : step === 'error' ? 'Backup Failed' : 'Backing Up'}
      subtitle={step === 'password' || step === 'confirm' ? 'Encrypt your wallet backup' : undefined}
      sizing="auto"
      dismissible={step !== 'uploading'}
      footer={renderFooter()}
    >
      {renderContent()}
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  instruction: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 10,
  },
  strengthBars: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: '600',
    width: 50,
    textAlign: 'right',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#FF453A',
  },
  statusContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  statusSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  progressItem: {
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  reminderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  reminderText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  errorButtonsRow: {
    gap: 10,
  },
  secondaryButton: {
    height: 45,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default WalletBackupSheet;
