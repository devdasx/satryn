import '../../shim';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PinCodeScreen } from '../../src/components/security';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useTheme, useHaptics } from '../../src/hooks';
import { useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { BackupService, ICloudService } from '../../src/services/backup';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { getDeviceId } from '../../src/services/DeviceIdentity';
import { THEME } from '../../src/constants';

type Step = 'pin' | 'password' | 'confirm' | 'acknowledge';
type SheetState = 'idle' | 'uploading' | 'success' | 'error';
type UploadStep = 'assembling' | 'encrypting' | 'uploading' | 'done';

export default function BackupICloudScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const markBackedUp = useSettingsStore(s => s.markBackedUp);
  const { activeWalletId } = useMultiWalletStore();
  const wallets = useMultiWalletStore(s => s.wallets);
  const activeWallet = wallets.find(w => w.id === activeWalletId);
  const walletType = activeWallet?.type || 'hd';
  const isWatchOnly = walletType.startsWith('watch_');
  const needsPassword = BackupService.requiresPassword(walletType);

  // Skip PIN if SensitiveSession is already active
  const sessionActive = SensitiveSession.isActive();
  const initialStep: Step = sessionActive && needsPassword ? 'password' : 'pin';

  const [step, setStep] = useState<Step>(initialStep);
  const [pin, setPin] = useState<string>(sessionActive ? (SensitiveSession.getPin() || '') : '');
  const [didAutoUpload, setDidAutoUpload] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Bottom sheet state
  const [sheetState, setSheetState] = useState<SheetState>('idle');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('assembling');

  const passwordStrength = getPasswordStrength(password);

  // Auto-upload for watch-only wallets when session is already active (no password needed)
  useEffect(() => {
    if (sessionActive && !needsPassword && !didAutoUpload) {
      setDidAutoUpload(true);
      const sessionPin = SensitiveSession.getPin() || '';
      handleUpload(sessionPin, '');
    }
  }, []);

  // ─── PIN Verification ─────────────────────────────────────

  const handleVerify = async (pinInput: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const isValid = await SecureStorage.verifyPin(pinInput);
      if (isValid) {
        SensitiveSession.start(pinInput);
        return { success: true };
      }
      return { success: false, error: 'Incorrect PIN' };
    } catch {
      return { success: false, error: 'Failed to verify PIN' };
    }
  };

  const handleVerifySuccess = (pinFromAuth: string) => {
    setPin(pinFromAuth);
    if (needsPassword) {
      setStep('password');
    } else {
      // Watch-only: skip password, go straight to upload
      handleUpload(pinFromAuth, '');
    }
  };

  const handleBiometricSuccess = async (): Promise<{ success: boolean; pin?: string }> => {
    try {
      const storedPin = await SecureStorage.getPinForBiometrics();
      if (storedPin) {
        SensitiveSession.start(storedPin);
        return { success: true, pin: storedPin };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  };

  // ─── Password Handling ────────────────────────────────────

  const handlePasswordNext = () => {
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setPasswordError(null);
    setStep('confirm');
  };

  const handleConfirmNext = () => {
    if (confirmPassword !== password) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordError(null);
    setStep('acknowledge');
  };

  // ─── Upload (via bottom sheet) ─────────────────────────────

  // Helper: yield to the UI thread so React can flush a render
  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 50));

  const handleUpload = async (pinToUse?: string, passwordToUse?: string) => {
    // Show the sheet immediately with loading state
    setUploadStep('assembling');
    setSheetState('uploading');
    setUploadError(null);
    setSheetVisible(true);

    // Wait for the sheet to render and animate in
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const resolvedPin = pinToUse || pin || SensitiveSession.getPin() || '';
      const resolvedPassword = passwordToUse !== undefined ? passwordToUse : password;

      if (!activeWalletId) throw new Error('No active wallet');

      // Check iCloud availability
      if (!ICloudService.isAvailable()) {
        throw new Error('iCloud is not available. Please sign in to iCloud in Settings.');
      }

      // Step 1: Assemble payload
      const payload = await BackupService.assemblePayload(activeWalletId, resolvedPin);
      if (!payload) throw new Error('Failed to read wallet data. Please try again.');

      // Step 2: Encrypt — yield first so React paints "Encrypting" before encryption runs
      setUploadStep('encrypting');
      await yieldToUI();
      const deviceId = await getDeviceId();
      const blob = await BackupService.encryptBackup(payload, resolvedPassword, deviceId);

      // Step 3: Upload to iCloud — yield so React paints "Uploading"
      setUploadStep('uploading');
      await yieldToUI();
      ICloudService.writeBackup(activeWalletId, blob);

      // Mark as backed up
      markBackedUp(activeWalletId, 'icloud');

      setUploadStep('done');
      await haptics.trigger('success');
      setSheetState('success');
    } catch (error: any) {
      console.error('[BackupICloud] Upload failed:', error);
      setUploadError(error?.message || 'Backup failed. Please try again.');
      await haptics.trigger('error');
      setSheetState('error');
    }
  };

  const handleSheetClose = () => {
    if (sheetState === 'success') {
      setSheetVisible(false);
      // Navigate away after sheet closes
      setTimeout(() => router.dismissAll(), 200);
    } else if (sheetState === 'error') {
      setSheetVisible(false);
      setSheetState('idle');
    }
    // Don't allow closing during upload
  };

  const handleRetry = () => {
    handleUpload();
  };

  // ─── PIN Screen ───────────────────────────────────────────

  if (step === 'pin') {
    return (
      <PinCodeScreen
        mode="verify"
        title="Verify Identity"
        subtitle="Enter your PIN to create an iCloud backup"
        icon="shield"
        iconColor={colors.text}
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── Bottom Sheet Content ──────────────────────────────────

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

  const renderSheetContent = () => {
    if (sheetState === 'uploading') {
      const stepIndex = getUploadStepIndex();
      return (
        <View style={styles.sheetBody}>
          <ActivityIndicator size="large" color={colors.text} style={{ marginBottom: 16 }} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Encrypting & uploading</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
            {getUploadStepLabel()}
          </Text>
          {/* Progress dots */}
          <View style={styles.progressRow}>
            {['Read', 'Encrypt', 'Upload'].map((label, i) => (
              <View key={label} style={styles.progressItem}>
                <View style={[
                  styles.progressDot,
                  {
                    backgroundColor: i < stepIndex ? '#30D158'
                      : i === stepIndex ? (colors.text)
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
      );
    }

    if (sheetState === 'success') {
      return (
        <View style={styles.sheetBody}>
          <View style={[styles.sheetIcon, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
            <Ionicons name="cloud-done" size={36} color="#30D158" />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Backed up to iCloud</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
            {activeWallet?.name || 'Wallet'} has been encrypted and stored in iCloud.
          </Text>
          {needsPassword && (
            <View style={[styles.sheetReminder, { backgroundColor: isDark ? 'rgba(255,200,120,0.06)' : 'rgba(180,140,60,0.06)' }]}>
              <Ionicons name="key-outline" size={14} color={isDark ? 'rgba(255,210,140,0.7)' : 'rgba(150,110,40,0.7)'} />
              <Text style={[styles.sheetReminderText, { color: colors.textSecondary }]}>
                Remember your backup password. Without it, this backup cannot be restored.
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.sheetButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D', marginTop: 20 }]}
            onPress={() => {
              haptics.trigger('selection');
              setSheetVisible(false);
              setTimeout(() => router.dismissAll(), 200);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetButtonText, { color: '#FFFFFF' }]}>Finish</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (sheetState === 'error') {
      return (
        <View style={styles.sheetBody}>
          <View style={[styles.sheetIcon, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
            <Ionicons name="cloud-offline" size={36} color="#FF453A" />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Backup failed</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
            {uploadError || 'Something went wrong. Please try again.'}
          </Text>
          <TouchableOpacity
            style={[styles.sheetButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D', marginTop: 20 }]}
            onPress={handleRetry}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetButtonText, { color: '#FFFFFF' }]}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetSecondaryButton, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', marginTop: 10 }]}
            onPress={() => {
              setSheetVisible(false);
              setSheetState('idle');
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetSecondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  // ─── Password / Confirm / Acknowledge ─────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => {
            if (step === 'confirm') { setStep('password'); setConfirmPassword(''); setPasswordError(null); }
            else if (step === 'acknowledge') { setStep('confirm'); }
            else { router.back(); }
          }}
          style={styles.headerButton}
        >
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {step === 'password' ? 'Create password' : step === 'confirm' ? 'Confirm password' : 'Acknowledgment'}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'password' && (
          <>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              <Text style={[styles.stepInstruction, { color: colors.textSecondary }]}>
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
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{passwordError}</Text>
                </Animated.View>
              )}
            </Animated.View>
          </>
        )}

        {step === 'confirm' && (
          <>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              <Text style={[styles.stepInstruction, { color: colors.textSecondary }]}>
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
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{passwordError}</Text>
                </Animated.View>
              )}
            </Animated.View>
          </>
        )}

        {step === 'acknowledge' && (
          <>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              <View style={[styles.ackCard, { backgroundColor: isDark ? 'rgba(255,200,120,0.06)' : 'rgba(255,255,255,0.45)' }]}>
                {Platform.OS === 'ios' && (
                  <BlurView
                    intensity={isDark ? 30 : 60}
                    tint={isDark ? 'dark' : 'light'}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <Ionicons name="warning-outline" size={28} color={isDark ? 'rgba(255,210,140,0.7)' : 'rgba(150,110,40,0.7)'} />
                <Text style={[styles.ackTitle, { color: colors.text }]}>Important</Text>
                <Text style={[styles.ackText, { color: colors.textSecondary }]}>
                  Without your backup password, this backup cannot be restored. There is no way to recover it.
                </Text>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).duration(500)}>
              <TouchableOpacity
                style={[styles.checkRow, { backgroundColor: colors.surface }]}
                onPress={() => {
                  haptics.trigger('selection');
                  setAcknowledged(!acknowledged);
                }}
                activeOpacity={0.7}
              >
                {Platform.OS === 'ios' && (
                  <BlurView
                    intensity={isDark ? 30 : 60}
                    tint={isDark ? 'dark' : 'light'}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={[
                  styles.checkbox,
                  { borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' },
                  acknowledged && { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D', borderColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
                ]}>
                  {acknowledged && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                </View>
                <Text style={[styles.checkLabel, { color: colors.text }]}>
                  I understand that without my password, this backup cannot be restored
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Sticky Bottom */}
      <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background }]}>
        {step === 'password' && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              password.length < 8 && { opacity: 0.4 },
            ]}
            onPress={handlePasswordNext}
            disabled={password.length < 8}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Continue</Text>
          </TouchableOpacity>
        )}

        {step === 'confirm' && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              !confirmPassword && { opacity: 0.4 },
            ]}
            onPress={handleConfirmNext}
            disabled={!confirmPassword}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Confirm</Text>
          </TouchableOpacity>
        )}

        {step === 'acknowledge' && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              !acknowledged && { opacity: 0.4 },
            ]}
            onPress={() => handleUpload()}
            disabled={!acknowledged}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Encrypt & Back up</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Upload Bottom Sheet */}
      <AppBottomSheet
        visible={sheetVisible}
        onClose={handleSheetClose}
        dismissible={sheetState !== 'uploading'}
      >
        {renderSheetContent()}
      </AppBottomSheet>
    </View>
  );
}

// ─── Password Strength ──────────────────────────────────────

function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
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
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  stepInstruction: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
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
  },
  ackCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    overflow: 'hidden' as const,
  },
  ackTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  ackText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    gap: 12,
    overflow: 'hidden' as const,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  stickyBottom: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  // Bottom sheet styles
  sheetBody: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sheetIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  sheetReminder: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  sheetReminderText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  sheetButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  sheetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  sheetSecondaryButton: {
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  sheetSecondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
});
