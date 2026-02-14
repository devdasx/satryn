/**
 * PreserveSetupSheet — Unified single-sheet flow for enabling Preserve Data on Delete.
 *
 * Combines three previously separate sheets into one continuous flow:
 *   Phase 1: Warning / feature overview
 *   Phase 2: Create encryption password
 *   Phase 3: Archival progress (encrypt + store in Keychain)
 *
 * The sheet stays open throughout the entire process. The toggle in data-backup.tsx
 * only turns ON when onComplete fires (after phase 3 succeeds).
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
  withDelay,
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput } from '../ui/PremiumInput';
import { useTheme, useHaptics } from '../../hooks';
import { THEME } from '../../constants';
import * as SecureStore from 'expo-secure-store';
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
import { PreserveDataSession } from '../../services/auth/PreserveDataSession';
import type { BackupSettings } from '../../services/AppStateManager';

// ─── Types ──────────────────────────────────────────────────────

interface PreserveSetupSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called only when the entire flow completes successfully */
  onComplete: () => void;
}

type Phase = 'info' | 'password' | 'archiving';
type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StepConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  doneIcon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  color: string;
}

const ARCHIVE_STEPS: StepConfig[] = [
  {
    label: 'Preparing data',
    icon: 'layers-outline',
    activeIcon: 'layers',
    doneIcon: 'layers',
    hint: 'Gathering wallet snapshots & settings',
    color: '#5E5CE6',
  },
  {
    label: 'Encrypting wallets',
    icon: 'lock-closed-outline',
    activeIcon: 'lock-closed',
    doneIcon: 'lock-closed',
    hint: 'AES-256 encryption in progress',
    color: '#FF9F0A',
  },
  {
    label: 'Saving to Keychain',
    icon: 'key-outline',
    activeIcon: 'key',
    doneIcon: 'key',
    hint: 'Writing to secure storage',
    color: '#30D158',
  },
  {
    label: 'Complete',
    icon: 'checkmark-circle-outline',
    activeIcon: 'checkmark-circle',
    doneIcon: 'checkmark-circle',
    color: '#30D158',
  },
];

const MIN_STEP_DURATION = 500;
const MIN_PASSWORD_LENGTH = 6;

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

// ─── Phase Indicator ────────────────────────────────────────────

function PhaseIndicator({ phase, isDark }: { phase: Phase; isDark: boolean }) {
  const phases: { key: Phase; label: string }[] = [
    { key: 'info', label: 'Overview' },
    { key: 'password', label: 'Password' },
    { key: 'archiving', label: 'Securing' },
  ];

  const currentIdx = phases.findIndex(p => p.key === phase);

  return (
    <View style={phaseStyles.container}>
      {phases.map((p, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <View key={p.key} style={phaseStyles.item}>
            <View style={[phaseStyles.dot, {
              backgroundColor: isActive
                ? (isDark ? '#FFFFFF' : '#000000')
                : isDone
                  ? '#30D158'
                  : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
              width: isActive ? 20 : 6,
            }]} />
          </View>
        );
      })}
    </View>
  );
}

const phaseStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  item: {
    alignItems: 'center',
  },
  dot: {
    height: 6,
    borderRadius: 3,
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
    <View style={[pBarStyles.track, {
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    }]}>
      <Animated.View style={[pBarStyles.fill, barStyle, {
        backgroundColor: failed ? '#FF453A' : '#30D158',
      }]} />
    </View>
  );
}

const pBarStyles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, marginBottom: 24, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});

// ─── Animated Step Row ──────────────────────────────────────────

function ArchiveStepRow({
  step,
  index,
  status,
  isDark,
  colors,
  isLast = false,
}: {
  step: StepConfig;
  index: number;
  status: StepStatus;
  isDark: boolean;
  colors: { text: string; textMuted: string };
  isLast?: boolean;
}) {
  const pulseOpacity = useSharedValue(1);
  const checkScale = useSharedValue(0);
  const iconRotation = useSharedValue(0);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1, true,
      );
      checkScale.value = 0;
      iconRotation.value = withRepeat(
        withSequence(
          withTiming(8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(-8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, false,
      );
    } else if (status === 'completed') {
      cancelAnimation(pulseOpacity);
      cancelAnimation(iconRotation);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      checkScale.value = withSpring(1, { damping: 12 });
      iconRotation.value = withTiming(0, { duration: 150 });
    } else if (status === 'failed') {
      cancelAnimation(pulseOpacity);
      cancelAnimation(iconRotation);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      iconRotation.value = withTiming(0, { duration: 150 });
    } else {
      cancelAnimation(pulseOpacity);
      cancelAnimation(iconRotation);
      pulseOpacity.value = 1;
      checkScale.value = 0;
      iconRotation.value = 0;
    }
    return () => {
      cancelAnimation(pulseOpacity);
      cancelAnimation(iconRotation);
    };
  }, [status]);

  const animatedPulse = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));
  const animatedCheck = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  const animatedIconRotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${iconRotation.value}deg` }] }));

  const stepColor =
    status === 'completed' ? '#30D158'
    : status === 'failed' ? '#FF453A'
    : status === 'active' ? step.color
    : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');

  const circleBg =
    status === 'completed' ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
    : status === 'failed' ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
    : status === 'active' ? (isDark ? `${step.color}18` : `${step.color}10`)
    : 'transparent';

  const labelColor =
    status === 'completed' ? (isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.80)')
    : status === 'failed' ? '#FF453A'
    : status === 'active' ? colors.text
    : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)');

  const iconName: keyof typeof Ionicons.glyphMap =
    status === 'completed' ? step.doneIcon
    : status === 'active' ? step.activeIcon
    : step.icon;

  return (
    <View style={stepStyles.row}>
      <Animated.View
        style={[stepStyles.circle, { backgroundColor: circleBg, borderColor: stepColor },
          status === 'active' && animatedPulse,
        ]}
      >
        {status === 'completed' ? (
          <Animated.View style={animatedCheck}>
            <Ionicons name="checkmark" size={15} color="#30D158" />
          </Animated.View>
        ) : status === 'failed' ? (
          <Ionicons name="close" size={15} color="#FF453A" />
        ) : status === 'active' ? (
          <Animated.View style={animatedIconRotate}>
            <Ionicons name={iconName} size={16} color={step.color} />
          </Animated.View>
        ) : (
          <Ionicons name={iconName} size={14} color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)'} />
        )}
      </Animated.View>

      {!isLast && (
        <View style={[stepStyles.connector, {
          backgroundColor: status === 'completed'
            ? (isDark ? 'rgba(48,209,88,0.25)' : 'rgba(48,209,88,0.20)')
            : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
        }]} />
      )}

      <View style={stepStyles.content}>
        <Text style={[stepStyles.label, { color: labelColor }]}>{step.label}</Text>
        {status === 'active' && step.hint && (
          <Text style={[stepStyles.hint, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>
            {step.hint}
          </Text>
        )}
        {status === 'completed' && index < 3 && (
          <Text style={[stepStyles.hint, { color: 'rgba(48,209,88,0.60)' }]}>Done</Text>
        )}
      </View>

      {status === 'active' && (
        <ActivityIndicator size="small" color={step.color} style={{ marginLeft: 8 }} />
      )}
      {status === 'completed' && (
        <Ionicons name="checkmark-circle" size={18} color="rgba(48,209,88,0.50)" />
      )}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
  circle: {
    width: 34, height: 34, borderRadius: 11, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  connector: {
    position: 'absolute', left: 34, top: 48, width: 2, height: 14, borderRadius: 1,
  },
  content: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  hint: { fontSize: 12, fontWeight: '400', marginTop: 2 },
});

// ─── Main Component ─────────────────────────────────────────────

export function PreserveSetupSheet({ visible, onClose, onComplete }: PreserveSetupSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  // Phase state
  const [phase, setPhase] = useState<Phase>('info');

  // Password state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const shakeX = useSharedValue(0);

  // Archival state
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(ARCHIVE_STEPS.map(() => 'pending'));
  const [archiveFailed, setArchiveFailed] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveCompleted, setArchiveCompleted] = useState(false);
  const [walletCount, setWalletCount] = useState(0);
  const [settingsCount, setSettingsCount] = useState(0);
  const isRunning = useRef(false);

  // Content key for AppBottomSheet auto-resize
  const contentKey = `${phase}-${archiveFailed ? 'f' : archiveCompleted ? 'c' : 'r'}`;

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';

  // Reset all state when sheet opens/closes
  useEffect(() => {
    if (visible) {
      setPhase('info');
      setPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      setStepStatuses(ARCHIVE_STEPS.map(() => 'pending'));
      setArchiveFailed(false);
      setArchiveError(null);
      setArchiveCompleted(false);
      setWalletCount(0);
      setSettingsCount(0);
      isRunning.current = false;
    }
  }, [visible]);

  // Focus password field when entering password phase
  useEffect(() => {
    if (phase === 'password') {
      setTimeout(() => passwordRef.current?.focus(), 400);
    }
  }, [phase]);

  // Animated shake for password errors
  const animatedShake = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, []);

  // Archive progress percentage
  const progressPercent = stepStatuses.reduce((acc, s, i) => {
    if (s === 'completed') return acc + (i === 3 ? 10 : 30);
    if (s === 'active') return acc + (i === 3 ? 5 : 15);
    return acc;
  }, 0);

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

  // ─── Phase 1 → Phase 2 ─────────────────────────────────────────
  const handleInfoContinue = useCallback(async () => {
    await haptics.trigger('selection');
    setPhase('password');
  }, [haptics]);

  // ─── Phase 2 → Phase 3 ─────────────────────────────────────────
  const handlePasswordSubmit = useCallback(async () => {
    setPasswordError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      triggerShake();
      await haptics.trigger('error');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      triggerShake();
      await haptics.trigger('error');
      return;
    }

    await haptics.trigger('success');
    await PreserveDataSession.setPassword(password);
    setPhase('archiving');
  }, [password, confirmPassword, haptics, triggerShake]);

  // ─── Phase 3: Archival Pipeline ─────────────────────────────────
  const runArchive = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;

    try {
      // Step 1: Preparing data
      let stepStart = Date.now();
      setStep(0, 'active');

      const wallets = useMultiWalletStore.getState().wallets;
      if (wallets.length === 0) {
        setStep(0, 'failed');
        setArchiveFailed(true);
        setArchiveError('No wallets found to archive.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }
      setWalletCount(wallets.length);

      const walletSnapshots: Array<{
        walletId: string;
        snapshot: ReturnType<typeof CanonicalSnapshotBuilder.extract>;
      }> = [];

      for (const wallet of wallets) {
        try {
          const snapshot = CanonicalSnapshotBuilder.extractFromDatabase(wallet.id);
          if (snapshot) walletSnapshots.push({ walletId: wallet.id, snapshot });
        } catch {}
      }

      const s = useSettingsStore.getState();
      const settings: BackupSettings = {
        denomination: s.denomination,
        currency: s.currency,
        autoLockTimeout: s.autoLockTimeout,
        biometricsEnabled: s.biometricsEnabled,
        hapticsEnabled: s.hapticsEnabled,
        theme: s.theme,
        feePreference: s.feePreference,
        customFeeRate: s.customFeeRate,
        customElectrumServer: s.customElectrumServer,
        useCustomElectrum: s.useCustomElectrum,
        defaultCurrencyDisplay: s.defaultCurrencyDisplay,
        gapLimit: s.gapLimit,
        walletMode: s.walletMode,
        walletName: s.walletName,
        preserveDataOnDelete: s.preserveDataOnDelete,
        iCloudBackupEnabled: s.iCloudBackupEnabled,
        autoBackupEnabled: s.autoBackupEnabled,
        analyticsEnabled: s.analyticsEnabled,
        inAppAlertsEnabled: s.inAppAlertsEnabled,
        nearbyNickname: s.nearbyNickname,
        maxFeeRateSatPerVb: s.maxFeeRateSatPerVb,
        maxFeeTotalSats: s.maxFeeTotalSats,
        feeCapRequireConfirmation: s.feeCapRequireConfirmation,
        defaultFeeTier: s.defaultFeeTier,
        rememberLastFeeTier: s.rememberLastFeeTier,
        defaultCustomFeeRate: s.defaultCustomFeeRate,
        privacyModeDefault: s.privacyModeDefault,
        avoidConsolidation: s.avoidConsolidation,
        preferSingleInput: s.preferSingleInput,
        avoidUnconfirmedDefault: s.avoidUnconfirmedDefault,
        largeAmountWarningPct: s.largeAmountWarningPct,
        largeAmountConfirmPct: s.largeAmountConfirmPct,
        tagPresets: s.tagPresets,
      };

      setSettingsCount(Object.values(settings).filter(v => v !== undefined && v !== null).length);

      const contacts = useContactStore.getState().contacts;
      const txLabels = useTransactionLabelStore.getState().labels;
      const utxoMeta = useUTXOStore.getState().utxoMetadata;

      const settingsPayload: PreservedSettingsPayload = {
        settings,
        contacts,
        transactionLabels: txLabels || {},
        utxoMetadata: utxoMeta || {},
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
          const success = await PreservedArchiveService.archiveWallet(walletId, snapshot, password);
          if (success) archivedCount++;
        } catch {}
      }

      if (walletSnapshots.length === 0) {
        setStep(1, 'failed');
        setArchiveFailed(true);
        setArchiveError('No wallet data available yet. Please wait for your wallets to finish syncing, then try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      if (archivedCount === 0) {
        setStep(1, 'failed');
        setArchiveFailed(true);
        setArchiveError('Failed to encrypt wallet data. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
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
            walletId: w.id,
            walletName: w.name,
            walletType: w.type,
            balanceSat: w.balanceSat,
          })),
          embeddedSettings: settingsPayload,
        };
        await PreservedArchiveService.writeManifest(manifest);

        await SecureStore.deleteItemAsync('preserved_recovery_dismissed', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => {});
      } catch {
        setStep(2, 'failed');
        setArchiveFailed(true);
        setArchiveError('Failed to save to Keychain. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
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
  }, [password, setStep, haptics]);

  // Start archival when entering phase 3
  useEffect(() => {
    if (phase === 'archiving' && !isRunning.current && !archiveCompleted && !archiveFailed) {
      setStepStatuses(ARCHIVE_STEPS.map(() => 'pending'));
      setArchiveFailed(false);
      setArchiveError(null);
      setArchiveCompleted(false);
      setWalletCount(0);
      setSettingsCount(0);
      const timer = setTimeout(() => runArchive(), 300);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const handleRetry = () => {
    setStepStatuses(ARCHIVE_STEPS.map(() => 'pending'));
    setArchiveFailed(false);
    setArchiveError(null);
    setArchiveCompleted(false);
    setWalletCount(0);
    setSettingsCount(0);
    runArchive();
  };

  const handleDone = () => {
    onComplete();
  };

  // Password strength
  const strength = getStrength(password);
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;

  // Only dismissible in info phase or when archival is done/failed
  const isDismissible = phase === 'info' || phase === 'password' || archiveFailed || archiveCompleted;

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
      <View style={styles.container}>
        {/* Phase indicator */}
        <PhaseIndicator phase={phase} isDark={isDark} />

        {/* ─── Phase 1: Info/Warning ─────────────────────────── */}
        {phase === 'info' && (
          <Animated.View entering={FadeIn.duration(300)}>
            {/* Shield icon */}
            <View style={styles.iconContainer}>
              <View style={[styles.iconGlow, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.07)',
              }]} />
              <View style={[styles.iconCircle, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
              }]}>
                <Ionicons name="shield-checkmark" size={32} color="#30D158" />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>
              Preserve Data on Delete
            </Text>
            <Text style={[styles.subtitle, { color: textSecondary }]}>
              Your wallet survives app removal
            </Text>

            {/* Features card */}
            <View style={[styles.featuresCard, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
              borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            }]}>
              <FeatureRow
                icon="shield-checkmark" iconColor="#30D158"
                title="Survives App Deletion"
                subtitle="Encrypted wallet data stays in iOS Keychain"
                isDark={isDark} textSecondary={textSecondary}
              />
              <FeatureRow
                icon="sync-outline" iconColor="#0A84FF"
                title="Continuous Backup"
                subtitle="Automatically archives after every sync"
                isDark={isDark} textSecondary={textSecondary}
              />
              <FeatureRow
                icon="refresh-outline" iconColor="#AF82FF"
                title="Instant Recovery"
                subtitle="Reinstall and pick up where you left off"
                isDark={isDark} textSecondary={textSecondary}
                isLast
              />
            </View>

            {/* Warning note */}
            <View style={[styles.warningNote, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
              borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
            }]}>
              <Ionicons
                name="information-circle-outline" size={16}
                color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'}
                style={{ marginTop: 1 }}
              />
              <Text style={[styles.warningText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.38)',
              }]}>
                If you sell or give away your iPhone, disable this feature first or factory reset the device.
              </Text>
            </View>

            {/* Continue button */}
            <TouchableOpacity
              onPress={handleInfoContinue}
              activeOpacity={0.7}
              style={[styles.primaryButton, {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              }]}
            >
              <Text style={[styles.primaryButtonText, {
                color: '#FFFFFF',
              }]}>
                Enable & Create Password
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ─── Phase 2: Password ─────────────────────────────── */}
        {phase === 'password' && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={80}
          >
            <Animated.View entering={FadeIn.duration(300)} style={animatedShake}>
              {/* Key icon */}
              <View style={styles.iconContainer}>
                <View style={[styles.iconGlow, {
                  backgroundColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.07)',
                }]} />
                <View style={[styles.iconCircle, {
                  backgroundColor: isDark ? 'rgba(255,159,10,0.15)' : 'rgba(255,159,10,0.10)',
                }]}>
                  <Ionicons name="key" size={26} color="#FF9F0A" />
                </View>
              </View>

              <Text style={[styles.title, { color: colors.text }]}>
                Create Encryption Password
              </Text>
              <Text style={[styles.subtitle, { color: textSecondary }]}>
                This password encrypts your preserved wallet data
              </Text>

              {/* Password inputs */}
              <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
                <PremiumInput
                  ref={passwordRef}
                  icon="key"
                  iconColor="#FF9F0A"
                  placeholder="Password"
                  secureTextEntry
                  value={password}
                  onChangeText={(t) => { setPassword(t); setPasswordError(null); }}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />

                {/* Strength indicator */}
                {password.length > 0 && (
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
                  placeholder="Confirm password"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setPasswordError(null); }}
                  returnKeyType="done"
                  onSubmitEditing={handlePasswordSubmit}
                />
              </View>

              {/* Error */}
              {passwordError && (
                <Animated.View
                  entering={FadeInDown.duration(200)}
                  style={[styles.errorRow, {
                    backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
                  }]}
                >
                  <Ionicons name="alert-circle" size={14} color="#FF453A" />
                  <Text style={[styles.errorText, {
                    color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A',
                  }]}>
                    {passwordError}
                  </Text>
                </Animated.View>
              )}

              {/* Info note */}
              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              }]}>
                Remember this password — it cannot be recovered. You will need it to restore your data after reinstalling.
              </Text>

              {/* Submit button */}
              <TouchableOpacity
                onPress={handlePasswordSubmit}
                activeOpacity={0.7}
                style={[styles.primaryButton, {
                  backgroundColor: isPasswordValid
                    ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                }]}
              >
                <Text style={[styles.primaryButtonText, {
                  color: isPasswordValid
                    ? '#FFFFFF'
                    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'),
                }]}>
                  Encrypt & Preserve
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        )}

        {/* ─── Phase 3: Archival Progress ────────────────────── */}
        {phase === 'archiving' && (
          <Animated.View entering={FadeIn.duration(300)}>
            {/* Shield progress icon */}
            <View style={styles.iconContainer}>
              <View style={[styles.iconGlow, {
                backgroundColor: archiveFailed
                  ? (isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.06)')
                  : archiveCompleted
                    ? (isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.07)')
                    : (isDark ? 'rgba(94,92,230,0.08)' : 'rgba(94,92,230,0.06)'),
              }]} />
              <View style={[styles.iconCircle, {
                backgroundColor: archiveFailed
                  ? (isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)')
                  : archiveCompleted
                    ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.10)')
                    : (isDark ? 'rgba(94,92,230,0.15)' : 'rgba(94,92,230,0.10)'),
              }]}>
                <Ionicons
                  name={archiveFailed ? 'alert-circle' : archiveCompleted ? 'shield-checkmark' : 'shield-half-outline'}
                  size={32}
                  color={archiveFailed ? '#FF453A' : archiveCompleted ? '#30D158' : '#5E5CE6'}
                />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>
              {archiveCompleted ? 'Data Preserved' : archiveFailed ? 'Archival Failed' : 'Securing Your Data'}
            </Text>
            <Text style={[styles.subtitle, {
              color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
            }]}>
              {archiveCompleted
                ? 'Your wallets and settings are safely stored in the iOS Keychain'
                : archiveFailed
                  ? 'Something went wrong during the archival process'
                  : 'Encrypting and storing your wallet data securely'
              }
            </Text>

            {/* Progress bar */}
            <ProgressBar progress={progressPercent} isDark={isDark} failed={archiveFailed} />

            {/* Steps card */}
            <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
              {ARCHIVE_STEPS.map((step, index) => (
                <ArchiveStepRow
                  key={index}
                  step={step}
                  index={index}
                  status={stepStatuses[index]}
                  isDark={isDark}
                  colors={colors}
                  isLast={index === ARCHIVE_STEPS.length - 1}
                />
              ))}
            </View>

            {/* Summary stats (completed) */}
            {archiveCompleted && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(100)}
                style={[styles.summaryRow, { backgroundColor: surfaceBg }]}
              >
                <View style={styles.summaryItem}>
                  <View style={[styles.summaryIconCircle, {
                    backgroundColor: isDark ? 'rgba(94,92,230,0.12)' : 'rgba(94,92,230,0.08)',
                  }]}>
                    <Ionicons name="wallet" size={14} color="#5E5CE6" />
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{walletCount}</Text>
                  <Text style={[styles.summaryLabel, {
                    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                  }]}>
                    {walletCount === 1 ? 'Wallet' : 'Wallets'}
                  </Text>
                </View>
                <View style={[styles.summaryDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]} />
                <View style={styles.summaryItem}>
                  <View style={[styles.summaryIconCircle, {
                    backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
                  }]}>
                    <Ionicons name="settings" size={14} color="#FF9F0A" />
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{settingsCount}</Text>
                  <Text style={[styles.summaryLabel, {
                    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                  }]}>Settings</Text>
                </View>
                <View style={[styles.summaryDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]} />
                <View style={styles.summaryItem}>
                  <View style={[styles.summaryIconCircle, {
                    backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
                  }]}>
                    <Ionicons name="shield-checkmark" size={14} color="#30D158" />
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>AES-256</Text>
                  <Text style={[styles.summaryLabel, {
                    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                  }]}>Encrypted</Text>
                </View>
              </Animated.View>
            )}

            {/* Error card */}
            {archiveFailed && archiveError && (
              <Animated.View
                entering={FadeInDown.duration(300)}
                style={[styles.archiveErrorCard, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
                }]}
              >
                <View style={[styles.archiveErrorIcon, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
                }]}>
                  <Ionicons name="alert-circle" size={16} color="#FF453A" />
                </View>
                <Text style={[styles.archiveErrorText, {
                  color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A',
                }]}>
                  {archiveError}
                </Text>
              </Animated.View>
            )}

            {/* Done button */}
            {archiveCompleted && (
              <Animated.View entering={FadeInDown.duration(300).delay(200)}>
                <TouchableOpacity
                  onPress={handleDone}
                  activeOpacity={0.7}
                  style={[styles.primaryButton, {
                    backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
                  }]}
                >
                  <Text style={[styles.primaryButtonText, {
                    color: '#FFFFFF',
                  }]}>Done</Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* Failed: Retry / Cancel */}
            {archiveFailed && (
              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  onPress={handleRetry}
                  activeOpacity={0.7}
                  style={[styles.primaryButton, {
                    backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
                  }]}
                >
                  <Ionicons
                    name="refresh" size={17}
                    color="#FFFFFF"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.primaryButtonText, {
                    color: '#FFFFFF',
                  }]}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.secondaryButton}>
                  <Text style={[styles.secondaryButtonText, {
                    color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
                  }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Footnote while running */}
            {!archiveCompleted && !archiveFailed && (
              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
              }]}>
                Data is encrypted and stored in the iOS Keychain, which persists even if the app is deleted.
              </Text>
            )}
          </Animated.View>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Feature Row Sub-component ──────────────────────────────────

function FeatureRow({
  icon, iconColor, title, subtitle, isDark, textSecondary, isLast = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle: string;
  isDark: boolean;
  textSecondary: string;
  isLast?: boolean;
}) {
  return (
    <View style={[featureStyles.row, !isLast && {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    }]}>
      <View style={[featureStyles.icon, {
        backgroundColor: isDark ? `${iconColor}18` : `${iconColor}10`,
      }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={featureStyles.content}>
        <Text style={[featureStyles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>{title}</Text>
        <Text style={[featureStyles.subtitle, { color: textSecondary }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const featureStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14 },
  icon: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', marginBottom: 1 },
  subtitle: { fontSize: 12, fontWeight: '400' },
});

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 28,
    paddingTop: 4,
    paddingBottom: 16,
  },

  // Icon
  iconContainer: {
    width: 76,
    height: 76,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  iconGlow: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Typography
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
    marginBottom: 20,
    lineHeight: 20,
  },

  // Features card
  featuresCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },

  // Warning note
  warningNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    marginBottom: 20,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },

  // Password inputs
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

  // Error
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

  // Steps card
  stepsCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },

  // Summary
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

  // Archive error
  archiveErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
    gap: 12,
  },
  archiveErrorIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  archiveErrorText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 20,
  },

  // Buttons
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
});
