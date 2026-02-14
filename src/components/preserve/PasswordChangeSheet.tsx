/**
 * PasswordChangeSheet — Unified single-sheet flow for changing the Preserve Data password.
 *
 * Combines previously separate sheets into one continuous flow:
 *   Phase 1: Verify current password
 *   Phase 2: Set new password
 *   Phase 3: Re-archive data with new password (full archival pipeline)
 *
 * The sheet stays open throughout the entire process.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput } from '../ui/PremiumInput';
import { useTheme, useHaptics } from '../../hooks';
import { THEME } from '../../constants';
import * as SecureStore from 'expo-secure-store';
import { PreserveDataSession } from '../../services/auth/PreserveDataSession';
import { PreservedArchiveService } from '../../services/storage/PreservedArchiveService';
import type {
  PreservedManifest,
  PreservedSettingsPayload,
} from '../../services/storage/PreservedArchiveService';
import { CanonicalSnapshotBuilder } from '../../services/storage/CanonicalSnapshotBuilder';
import { useMultiWalletStore } from '../../stores/multiWalletStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useContactStore } from '../../stores/contactStore';
import { useTransactionLabelStore } from '../../stores/transactionLabelStore';
import { useUTXOStore } from '../../stores/utxoStore';
import type { BackupSettings } from '../../services/AppStateManager';

// ─── Types ──────────────────────────────────────────────────────

interface PasswordChangeSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type Phase = 'verify' | 'create' | 'archiving';
type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

const MIN_PASSWORD_LENGTH = 6;
const MIN_STEP_DURATION = 500;

interface StepConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  doneIcon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  color: string;
}

const ARCHIVAL_STEPS: StepConfig[] = [
  { label: 'Preparing data', icon: 'layers-outline', activeIcon: 'layers', doneIcon: 'layers', hint: 'Gathering wallet snapshots & settings', color: '#5E5CE6' },
  { label: 'Encrypting wallets', icon: 'lock-closed-outline', activeIcon: 'lock-closed', doneIcon: 'lock-closed', hint: 'AES-256 encryption in progress', color: '#FF9F0A' },
  { label: 'Saving to Keychain', icon: 'key-outline', activeIcon: 'key', doneIcon: 'key', hint: 'Writing to secure storage', color: '#30D158' },
  { label: 'Complete', icon: 'checkmark-circle-outline', activeIcon: 'checkmark-circle', doneIcon: 'checkmark-circle', color: '#30D158' },
];

// ─── Password Strength ──────────────────────────────────────────

function getStrength(password: string): { label: string; color: string; width: number } {
  if (password.length === 0) return { label: '', color: 'transparent', width: 0 };
  if (password.length < MIN_PASSWORD_LENGTH) return { label: 'Too short', color: '#FF453A', width: 15 };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { label: 'Weak', color: '#FF9F0A', width: 33 };
  if (score <= 3) return { label: 'Good', color: '#30D158', width: 66 };
  return { label: 'Strong', color: '#30D158', width: 100 };
}

// ─── Phase Indicator ─────────────────────────────────────────────

function PhaseIndicator({ phase, isDark }: { phase: Phase; isDark: boolean }) {
  const phases: Phase[] = ['verify', 'create', 'archiving'];
  const currentIdx = phases.indexOf(phase);

  return (
    <View style={phaseStyles.container}>
      {phases.map((p, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <View
            key={p}
            style={[
              phaseStyles.dot,
              isDone && { backgroundColor: '#30D158', width: 8, height: 8, borderRadius: 4 },
              isActive && {
                backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
                width: 24,
                height: 8,
                borderRadius: 4,
              },
              !isDone && !isActive && {
                backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)',
                width: 8,
                height: 8,
                borderRadius: 4,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const phaseStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {},
});

// ─── Animated Icon ──────────────────────────────────────────────

function PhaseIcon({ isDark, phase, archiveCompleted, archiveFailed }: {
  isDark: boolean;
  phase: Phase;
  archiveCompleted: boolean;
  archiveFailed: boolean;
}) {
  const glowOpacity = useSharedValue(0.3);

  useEffect(() => {
    if (archiveCompleted || archiveFailed) {
      cancelAnimation(glowOpacity);
      glowOpacity.value = withTiming(archiveCompleted ? 0.9 : 0.2, { duration: 400 });
    } else {
      glowOpacity.value = withRepeat(
        withTiming(0.7, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }
    return () => cancelAnimation(glowOpacity);
  }, [phase, archiveCompleted, archiveFailed]);

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const accentColor =
    archiveFailed ? '#FF453A'
    : archiveCompleted ? '#30D158'
    : phase === 'verify' ? '#5E5CE6'
    : phase === 'create' ? '#FF9F0A'
    : '#5E5CE6';

  const iconName: keyof typeof Ionicons.glyphMap =
    archiveFailed ? 'alert-circle'
    : archiveCompleted ? 'shield-checkmark'
    : phase === 'verify' ? 'lock-open'
    : phase === 'create' ? 'key'
    : 'shield-half-outline';

  return (
    <View style={iconStyles.container}>
      <Animated.View style={[iconStyles.glowCircle, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}12` : `${accentColor}08`,
      }]} />
      <View style={[iconStyles.iconCircle, {
        backgroundColor: isDark ? `${accentColor}20` : `${accentColor}14`,
      }]}>
        <Ionicons name={iconName} size={28} color={accentColor} />
      </View>
    </View>
  );
}

const iconStyles = StyleSheet.create({
  container: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  glowCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─── Progress Bar ───────────────────────────────────────────────

function ProgressBar({ progress, isDark, failed }: { progress: number; isDark: boolean; failed: boolean }) {
  const animatedWidth = useSharedValue(0);

  useEffect(() => {
    animatedWidth.value = withSpring(progress, { damping: 20, stiffness: 90, mass: 0.8 });
  }, [progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.value}%` as any,
  }));

  return (
    <View style={[progressStyles.track, {
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    }]}>
      <Animated.View style={[progressStyles.fill, barStyle, {
        backgroundColor: failed ? '#FF453A' : '#30D158',
      }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, marginBottom: 28, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});

// ─── Animated Step Row ──────────────────────────────────────────

function AnimatedStepRow({ step, index, status, isDark, colors, isLast = false }: {
  step: StepConfig; index: number; status: StepStatus; isDark: boolean;
  colors: { text: string; textMuted: string }; isLast?: boolean;
}) {
  const pulseOpacity = useSharedValue(1);
  const checkScale = useSharedValue(0);
  const iconRotation = useSharedValue(0);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
      checkScale.value = 0;
      iconRotation.value = withRepeat(
        withSequence(
          withTiming(8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(-8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        ), -1, false,
      );
    } else if (status === 'completed') {
      cancelAnimation(pulseOpacity); cancelAnimation(iconRotation);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      checkScale.value = withSpring(1, { damping: 12 });
      iconRotation.value = withTiming(0, { duration: 150 });
    } else if (status === 'failed') {
      cancelAnimation(pulseOpacity); cancelAnimation(iconRotation);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      iconRotation.value = withTiming(0, { duration: 150 });
    } else {
      cancelAnimation(pulseOpacity); cancelAnimation(iconRotation);
      pulseOpacity.value = 1; checkScale.value = 0; iconRotation.value = 0;
    }
    return () => { cancelAnimation(pulseOpacity); cancelAnimation(iconRotation); };
  }, [status]);

  const animatedPulse = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));
  const animatedCheck = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  const animatedIconRotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${iconRotation.value}deg` }] }));

  const stepColor = status === 'completed' ? '#30D158' : status === 'failed' ? '#FF453A' : status === 'active' ? step.color : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');
  const circleBg = status === 'completed' ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)') : status === 'failed' ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)') : status === 'active' ? (isDark ? `${step.color}18` : `${step.color}10`) : 'transparent';
  const labelColor = status === 'completed' ? (isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.80)') : status === 'failed' ? '#FF453A' : status === 'active' ? colors.text : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)');
  const iconName: keyof typeof Ionicons.glyphMap = status === 'completed' ? step.doneIcon : status === 'active' ? step.activeIcon : step.icon;

  return (
    <View style={styles.stepRow}>
      <Animated.View style={[styles.stepCircle, { backgroundColor: circleBg, borderColor: stepColor }, status === 'active' && animatedPulse]}>
        {status === 'completed' ? (
          <Animated.View style={animatedCheck}><Ionicons name="checkmark" size={15} color="#30D158" /></Animated.View>
        ) : status === 'failed' ? (
          <Ionicons name="close" size={15} color="#FF453A" />
        ) : status === 'active' ? (
          <Animated.View style={animatedIconRotate}><Ionicons name={iconName} size={16} color={step.color} /></Animated.View>
        ) : (
          <Ionicons name={iconName} size={14} color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)'} />
        )}
      </Animated.View>
      {!isLast && (
        <View style={[styles.connectorLine, {
          backgroundColor: status === 'completed' ? (isDark ? 'rgba(48,209,88,0.25)' : 'rgba(48,209,88,0.20)') : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
        }]} />
      )}
      <View style={styles.stepContent}>
        <Text style={[styles.stepLabel, { color: labelColor }]}>{step.label}</Text>
        {status === 'active' && step.hint && (
          <Text style={[styles.stepHint, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>{step.hint}</Text>
        )}
        {status === 'completed' && index < 3 && (
          <Text style={[styles.stepHint, { color: 'rgba(48,209,88,0.60)' }]}>Done</Text>
        )}
      </View>
      {status === 'active' && <ActivityIndicator size="small" color={step.color} style={{ marginLeft: 8 }} />}
      {status === 'completed' && <Ionicons name="checkmark-circle" size={18} color="rgba(48,209,88,0.50)" />}
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function PasswordChangeSheet({
  visible,
  onClose,
  onComplete,
}: PasswordChangeSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  // Phase
  const [phase, setPhase] = useState<Phase>('verify');

  // Verify phase
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyRef = useRef<TextInput>(null);

  // Create phase
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const newPasswordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Archiving phase
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(ARCHIVAL_STEPS.map(() => 'pending'));
  const [archiveFailed, setArchiveFailed] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveCompleted, setArchiveCompleted] = useState(false);
  const [walletCount, setWalletCount] = useState(0);
  const [settingsCount, setSettingsCount] = useState(0);
  const isRunning = useRef(false);

  // Shake animation
  const shakeX = useSharedValue(0);
  const animatedShake = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const contentKey = `${phase}-${archiveFailed ? 'f' : archiveCompleted ? 'c' : 'r'}`;
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  // Reset on open
  useEffect(() => {
    if (visible) {
      setPhase('verify');
      setVerifyPassword('');
      setVerifyError(null);
      setNewPassword('');
      setConfirmPassword('');
      setCreateError(null);
      setStepStatuses(ARCHIVAL_STEPS.map(() => 'pending'));
      setArchiveFailed(false);
      setArchiveError(null);
      setArchiveCompleted(false);
      setWalletCount(0);
      setSettingsCount(0);
      isRunning.current = false;
      setTimeout(() => verifyRef.current?.focus(), 400);
    }
  }, [visible]);

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, []);

  // ── Phase 1: Verify ──────────────────────────────────────────

  const handleVerifySubmit = useCallback(async () => {
    setVerifyError(null);
    if (verifyPassword.length === 0) {
      setVerifyError('Please enter your password');
      triggerShake();
      await haptics.trigger('error');
      return;
    }

    const stored = PreserveDataSession.getPassword();
    if (stored && verifyPassword !== stored) {
      setVerifyError('Incorrect password');
      triggerShake();
      await haptics.trigger('error');
      return;
    }

    await haptics.trigger('success');
    setPhase('create');
    setTimeout(() => newPasswordRef.current?.focus(), 400);
  }, [verifyPassword, haptics, triggerShake]);

  // ── Phase 2: Create ──────────────────────────────────────────

  const handleCreateSubmit = useCallback(async () => {
    setCreateError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setCreateError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      triggerShake();
      await haptics.trigger('error');
      return;
    }
    if (newPassword !== confirmPassword) {
      setCreateError('Passwords do not match');
      triggerShake();
      await haptics.trigger('error');
      return;
    }

    await haptics.trigger('success');
    await PreserveDataSession.setPassword(newPassword);
    setPhase('archiving');
  }, [newPassword, confirmPassword, haptics, triggerShake]);

  // ── Phase 3: Archival ────────────────────────────────────────

  const setStep = useCallback((index: number, status: StepStatus) => {
    setStepStatuses(prev => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  }, []);

  const waitMin = (startMs: number, minMs: number) => {
    const elapsed = Date.now() - startMs;
    return new Promise(resolve => setTimeout(resolve, Math.max(0, minMs - elapsed)));
  };

  const runArchive = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;
    try {
      // Step 1: Preparing data
      let stepStart = Date.now();
      setStep(0, 'active');

      const wallets = useMultiWalletStore.getState().wallets;
      if (wallets.length === 0) {
        setStep(0, 'failed'); setArchiveFailed(true);
        setArchiveError('No wallets found to archive.');
        haptics.trigger('error'); isRunning.current = false; return;
      }

      setWalletCount(wallets.length);

      const walletSnapshots: Array<{ walletId: string; snapshot: ReturnType<typeof CanonicalSnapshotBuilder.extract> }> = [];
      for (const wallet of wallets) {
        try {
          const snapshot = CanonicalSnapshotBuilder.extractFromDatabase(wallet.id);
          if (snapshot) walletSnapshots.push({ walletId: wallet.id, snapshot });
        } catch {}
      }

      const s = useSettingsStore.getState();
      const settings: BackupSettings = {
        denomination: s.denomination, currency: s.currency, autoLockTimeout: s.autoLockTimeout,
        biometricsEnabled: s.biometricsEnabled, hapticsEnabled: s.hapticsEnabled, theme: s.theme,
        feePreference: s.feePreference, customFeeRate: s.customFeeRate,
        customElectrumServer: s.customElectrumServer, useCustomElectrum: s.useCustomElectrum,
        defaultCurrencyDisplay: s.defaultCurrencyDisplay, gapLimit: s.gapLimit,
        walletMode: s.walletMode, walletName: s.walletName,
        preserveDataOnDelete: s.preserveDataOnDelete, iCloudBackupEnabled: s.iCloudBackupEnabled,
        autoBackupEnabled: s.autoBackupEnabled, analyticsEnabled: s.analyticsEnabled,
        inAppAlertsEnabled: s.inAppAlertsEnabled, nearbyNickname: s.nearbyNickname,
        maxFeeRateSatPerVb: s.maxFeeRateSatPerVb, maxFeeTotalSats: s.maxFeeTotalSats,
        feeCapRequireConfirmation: s.feeCapRequireConfirmation, defaultFeeTier: s.defaultFeeTier,
        rememberLastFeeTier: s.rememberLastFeeTier, defaultCustomFeeRate: s.defaultCustomFeeRate,
        privacyModeDefault: s.privacyModeDefault, avoidConsolidation: s.avoidConsolidation,
        preferSingleInput: s.preferSingleInput, avoidUnconfirmedDefault: s.avoidUnconfirmedDefault,
        largeAmountWarningPct: s.largeAmountWarningPct, largeAmountConfirmPct: s.largeAmountConfirmPct,
        tagPresets: s.tagPresets,
      };

      setSettingsCount(Object.values(settings).filter(v => v !== undefined && v !== null).length);

      const contacts = useContactStore.getState().contacts;
      const txLabels = useTransactionLabelStore.getState().labels;
      const utxoMeta = useUTXOStore.getState().utxoMetadata;

      const settingsPayload: PreservedSettingsPayload = {
        settings, contacts, transactionLabels: txLabels || {}, utxoMetadata: utxoMeta || {},
      };

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(0, 'completed');

      // Step 2: Encrypting wallets
      stepStart = Date.now();
      setStep(1, 'active');

      let archivedCount = 0;
      for (const { walletId, snapshot } of walletSnapshots) {
        try {
          await new Promise(resolve => setTimeout(resolve, 50));
          const success = await PreservedArchiveService.archiveWallet(walletId, snapshot, newPassword);
          if (success) archivedCount++;
        } catch {}
      }

      if (walletSnapshots.length === 0) {
        setStep(1, 'failed'); setArchiveFailed(true);
        setArchiveError('No wallet data available yet. Please wait for your wallets to finish syncing, then try again.');
        haptics.trigger('error'); isRunning.current = false; return;
      }

      if (archivedCount === 0) {
        setStep(1, 'failed'); setArchiveFailed(true);
        setArchiveError('Failed to encrypt wallet data. Please try again.');
        haptics.trigger('error'); isRunning.current = false; return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(1, 'completed');

      // Step 3: Saving to Keychain
      stepStart = Date.now();
      setStep(2, 'active');

      try {
        const manifest: PreservedManifest = {
          version: 2,
          preservedAt: Date.now(),
          walletCount: wallets.length,
          wallets: wallets.map(w => ({
            walletId: w.id, walletName: w.name, walletType: w.type, balanceSat: w.balanceSat,
          })),
          embeddedSettings: settingsPayload,
        };
        await PreservedArchiveService.writeManifest(manifest);
        await SecureStore.deleteItemAsync('preserved_recovery_dismissed', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => {});
      } catch {
        setStep(2, 'failed'); setArchiveFailed(true);
        setArchiveError('Failed to save to Keychain. Please try again.');
        haptics.trigger('error'); isRunning.current = false; return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(2, 'completed');

      // Step 4: Complete
      setStep(3, 'completed');
      setArchiveCompleted(true);
      haptics.trigger('success');
    } catch {
      setArchiveFailed(true);
      setArchiveError('An unexpected error occurred during archival.');
      haptics.trigger('error');
    } finally {
      isRunning.current = false;
    }
  }, [newPassword, setStep, haptics]);

  // Start archival when phase changes to 'archiving'
  useEffect(() => {
    if (phase === 'archiving' && !isRunning.current && !archiveCompleted && !archiveFailed) {
      setStepStatuses(ARCHIVAL_STEPS.map(() => 'pending'));
      setArchiveFailed(false);
      setArchiveError(null);
      setArchiveCompleted(false);
      const timer = setTimeout(() => runArchive(), 300);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const handleRetry = () => {
    setStepStatuses(ARCHIVAL_STEPS.map(() => 'pending'));
    setArchiveFailed(false);
    setArchiveError(null);
    setArchiveCompleted(false);
    runArchive();
  };

  // Progress
  const progressPercent = stepStatuses.reduce((acc, s, i) => {
    if (s === 'completed') return acc + (i === 3 ? 10 : 30);
    if (s === 'active') return acc + (i === 3 ? 5 : 15);
    return acc;
  }, 0);

  const strength = getStrength(newPassword);
  const isCreateValid = newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword;
  const isVerifyValid = verifyPassword.length > 0;

  const isDismissible = phase === 'verify' || phase === 'create' || archiveCompleted || archiveFailed;

  // ── Title/subtitle per phase ─────────────────────────────────

  const title =
    phase === 'verify' ? 'Verify Current Password'
    : phase === 'create' ? 'Set New Password'
    : archiveCompleted ? 'Password Changed'
    : archiveFailed ? 'Archival Failed'
    : 'Re-encrypting Data';

  const subtitle =
    phase === 'verify' ? 'Enter your current encryption password to continue'
    : phase === 'create' ? 'Your preserved data will be re-encrypted with this password'
    : archiveCompleted ? 'Your wallets and settings are safely re-encrypted'
    : archiveFailed ? 'Something went wrong during the archival process'
    : 'Re-encrypting your wallet data with the new password';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing={phase === 'archiving' ? ['auto', 'large'] : 'auto'}
      scrollable={phase === 'archiving'}
      dismissible={isDismissible}
      grabber={isDismissible}
      showCloseButton={isDismissible}
      contentKey={contentKey}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <Animated.View style={[styles.container, (phase === 'verify' || phase === 'create') ? animatedShake : undefined]}>
          {/* Phase Indicator */}
          <PhaseIndicator phase={phase} isDark={isDark} />

          {/* Icon */}
          <PhaseIcon isDark={isDark} phase={phase} archiveCompleted={archiveCompleted} archiveFailed={archiveFailed} />

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, {
            color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
          }]}>
            {subtitle}
          </Text>

          {/* ── Phase 1: Verify ──────────────────────────────── */}
          {phase === 'verify' && (
            <>
              <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
                <PremiumInput
                  ref={verifyRef}
                  icon="lock-open"
                  iconColor="#5E5CE6"
                  placeholder="Current password"
                  secureTextEntry
                  value={verifyPassword}
                  onChangeText={(t) => { setVerifyPassword(t); setVerifyError(null); }}
                  returnKeyType="done"
                  onSubmitEditing={handleVerifySubmit}
                />
              </View>

              {verifyError && (
                <Animated.View entering={FadeInDown.duration(200)} style={[styles.errorRow, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
                }]}>
                  <Ionicons name="alert-circle" size={14} color="#FF453A" />
                  <Text style={[styles.errorText, { color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A' }]}>
                    {verifyError}
                  </Text>
                </Animated.View>
              )}

              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              }]}>
                Enter the password you used when enabling Preserve Data.
              </Text>

              <TouchableOpacity
                onPress={handleVerifySubmit}
                activeOpacity={0.7}
                style={[styles.primaryButton, {
                  backgroundColor: isVerifyValid
                    ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                }]}
              >
                <Text style={[styles.primaryButtonText, {
                  color: isVerifyValid
                    ? '#FFFFFF'
                    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'),
                }]}>
                  Verify Password
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Phase 2: Create ──────────────────────────────── */}
          {phase === 'create' && (
            <>
              <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
                <PremiumInput
                  ref={newPasswordRef}
                  icon="key"
                  iconColor="#FF9F0A"
                  placeholder="New password"
                  secureTextEntry
                  value={newPassword}
                  onChangeText={(t) => { setNewPassword(t); setCreateError(null); }}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />

                {newPassword.length > 0 && (
                  <View style={styles.strengthRow}>
                    <View style={[styles.strengthTrack, {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    }]}>
                      <Animated.View style={[styles.strengthFill, {
                        backgroundColor: strength.color,
                        width: `${strength.width}%` as any,
                      }]} />
                    </View>
                    <Text style={[styles.strengthLabel, { color: strength.color }]}>
                      {strength.label}
                    </Text>
                  </View>
                )}

                <View style={[styles.inputDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                }]} />

                <PremiumInput
                  ref={confirmRef}
                  icon="shield-checkmark"
                  iconColor="#5E5CE6"
                  placeholder="Confirm new password"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setCreateError(null); }}
                  returnKeyType="done"
                  onSubmitEditing={handleCreateSubmit}
                />
              </View>

              {createError && (
                <Animated.View entering={FadeInDown.duration(200)} style={[styles.errorRow, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
                }]}>
                  <Ionicons name="alert-circle" size={14} color="#FF453A" />
                  <Text style={[styles.errorText, { color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A' }]}>
                    {createError}
                  </Text>
                </Animated.View>
              )}

              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              }]}>
                Remember this password — it cannot be recovered. You will need it to restore your data after reinstalling.
              </Text>

              <TouchableOpacity
                onPress={handleCreateSubmit}
                activeOpacity={0.7}
                style={[styles.primaryButton, {
                  backgroundColor: isCreateValid
                    ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                }]}
              >
                <Text style={[styles.primaryButtonText, {
                  color: isCreateValid
                    ? '#FFFFFF'
                    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'),
                }]}>
                  Encrypt & Re-archive
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Phase 3: Archiving ───────────────────────────── */}
          {phase === 'archiving' && (
            <>
              {/* Progress bar */}
              <ProgressBar progress={progressPercent} isDark={isDark} failed={archiveFailed} />

              {/* Steps card */}
              <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
                {ARCHIVAL_STEPS.map((step, index) => (
                  <AnimatedStepRow
                    key={index}
                    step={step}
                    index={index}
                    status={stepStatuses[index]}
                    isDark={isDark}
                    colors={colors}
                    isLast={index === ARCHIVAL_STEPS.length - 1}
                  />
                ))}
              </View>

              {/* Summary stats (completed) */}
              {archiveCompleted && (
                <Animated.View entering={FadeInDown.duration(300).delay(100)} style={[styles.summaryRow, { backgroundColor: surfaceBg }]}>
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryIconCircle, { backgroundColor: isDark ? 'rgba(94,92,230,0.12)' : 'rgba(94,92,230,0.08)' }]}>
                      <Ionicons name="wallet" size={14} color="#5E5CE6" />
                    </View>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{walletCount}</Text>
                    <Text style={[styles.summaryLabel, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)' }]}>
                      {walletCount === 1 ? 'Wallet' : 'Wallets'}
                    </Text>
                  </View>
                  <View style={[styles.summaryDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryIconCircle, { backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)' }]}>
                      <Ionicons name="settings" size={14} color="#FF9F0A" />
                    </View>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{settingsCount}</Text>
                    <Text style={[styles.summaryLabel, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)' }]}>Settings</Text>
                  </View>
                  <View style={[styles.summaryDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryIconCircle, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
                      <Ionicons name="shield-checkmark" size={14} color="#30D158" />
                    </View>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>AES-256</Text>
                    <Text style={[styles.summaryLabel, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)' }]}>Encrypted</Text>
                  </View>
                </Animated.View>
              )}

              {/* Error card */}
              {archiveFailed && archiveError && (
                <Animated.View entering={FadeInDown.duration(300)} style={[styles.errorCard, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
                }]}>
                  <View style={[styles.errorIconCircle, {
                    backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
                  }]}>
                    <Ionicons name="alert-circle" size={16} color="#FF453A" />
                  </View>
                  <Text style={[styles.errorCardText, { color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A' }]}>
                    {archiveError}
                  </Text>
                </Animated.View>
              )}

              {/* Done button */}
              {archiveCompleted && (
                <Animated.View entering={FadeInDown.duration(300).delay(200)}>
                  <TouchableOpacity
                    onPress={onComplete}
                    activeOpacity={0.7}
                    style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
                  >
                    <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Done</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Retry/Cancel */}
              {archiveFailed && (
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    onPress={handleRetry}
                    activeOpacity={0.7}
                    style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
                  >
                    <Ionicons name="refresh" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Try Again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.secondaryButton}>
                    <Text style={[styles.secondaryButtonText, {
                      color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
                    }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* In-progress note */}
              {!archiveCompleted && !archiveFailed && (
                <Text style={[styles.infoNote, { color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)' }]}>
                  Data is encrypted and stored in the iOS Keychain, which persists even if the app is deleted.
                </Text>
              )}
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  // Input card
  inputCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
  },
  inputDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
    marginRight: 16,
  },

  // Strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  strengthTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 55,
    textAlign: 'right',
  },

  // Error (password phases)
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },

  // Info note
  infoNote: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  // Button
  primaryButton: {
    height: 50,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonGroup: {
    gap: 8,
  },
  secondaryButton: {
    height: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },

  // Steps card (archival phase)
  stepsCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  stepCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  connectorLine: {
    position: 'absolute',
    left: 34,
    top: 48,
    width: 2,
    height: 14,
    borderRadius: 1,
  },
  stepContent: {
    flex: 1,
  },
  stepLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  stepHint: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },

  // Summary stats
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  summaryDivider: {
    width: 1,
    height: 36,
    borderRadius: 0.5,
  },

  // Error card (archival phase)
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
    gap: 12,
  },
  errorIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorCardText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 20,
  },
});
