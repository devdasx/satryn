/**
 * ArchivalProgressSheet — Premium step-based archival progress visualization
 *
 * Shows real-time progress while archiving wallet data to the iOS Keychain
 * when the user enables "Preserve Data on Delete".
 *
 * Pipeline (3 real steps + completion):
 *   1. Preparing data — extract wallet snapshots & gather settings
 *   2. Encrypting wallets — PBKDF2 + AES-256-GCM per wallet
 *   3. Saving to Keychain — write manifest (with embedded settings) to secure store
 *   4. Complete
 *
 * Settings are embedded directly in the manifest (no separate PBKDF2 encryption).
 * The iOS Keychain already provides hardware-backed at-rest encryption, so a
 * second PBKDF2 round for non-secret preferences was unnecessary and caused
 * the UI to freeze.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
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
import type { BackupSettings } from '../../services/AppStateManager';

// ─── Types ──────────────────────────────────────────────────────

interface ArchivalProgressSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
  pin: string;
}

type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StepConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  doneIcon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  color: string;
}

const STEPS: StepConfig[] = [
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

// ─── Progress Bar ───────────────────────────────────────────────

function ProgressBar({
  progress,
  isDark,
  failed,
}: {
  progress: number;
  isDark: boolean;
  failed: boolean;
}) {
  const animatedWidth = useSharedValue(0);

  useEffect(() => {
    animatedWidth.value = withSpring(progress, {
      damping: 20,
      stiffness: 90,
      mass: 0.8,
    });
  }, [progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.value}%` as any,
  }));

  const accentColor = failed ? '#FF453A' : '#30D158';

  return (
    <View style={[progressStyles.track, {
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    }]}>
      <Animated.View style={[progressStyles.fill, barStyle, {
        backgroundColor: accentColor,
      }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    marginBottom: 28,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});

// ─── Animated Shield Icon ───────────────────────────────────────

function ShieldProgressIcon({
  isDark,
  completed,
  failed,
}: {
  isDark: boolean;
  completed: boolean;
  failed: boolean;
}) {
  const glowOpacity = useSharedValue(0.3);
  const scaleValue = useSharedValue(1);
  const rotateValue = useSharedValue(0);

  useEffect(() => {
    if (completed) {
      cancelAnimation(glowOpacity);
      cancelAnimation(rotateValue);
      glowOpacity.value = withTiming(0.9, { duration: 400 });
      scaleValue.value = withSpring(1.08, { damping: 8, stiffness: 100 });
      rotateValue.value = withTiming(0, { duration: 300 });
    } else if (failed) {
      cancelAnimation(glowOpacity);
      cancelAnimation(rotateValue);
      glowOpacity.value = withTiming(0.2, { duration: 300 });
      rotateValue.value = withTiming(0, { duration: 300 });
    } else {
      glowOpacity.value = withRepeat(
        withTiming(0.7, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      rotateValue.value = withRepeat(
        withSequence(
          withTiming(-2, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
          withTiming(2, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    }
  }, [completed, failed]);

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const animatedScale = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }, { rotate: `${rotateValue.value}deg` }],
  }));

  const accentColor = failed ? '#FF453A' : completed ? '#30D158' : '#5E5CE6';

  return (
    <Animated.View style={[iconStyles.container, animatedScale]}>
      {/* Outer glow ring */}
      <Animated.View style={[iconStyles.glowRing, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}08` : `${accentColor}06`,
        borderColor: `${accentColor}15`,
      }]} />
      {/* Inner glow circle */}
      <Animated.View style={[iconStyles.glowCircle, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}15` : `${accentColor}10`,
      }]} />
      <View style={[iconStyles.iconCircle, {
        backgroundColor: isDark ? `${accentColor}20` : `${accentColor}14`,
      }]}>
        <Ionicons
          name={failed ? 'alert-circle' : completed ? 'shield-checkmark' : 'shield-half-outline'}
          size={32}
          color={accentColor}
        />
      </View>
    </Animated.View>
  );
}

const iconStyles = StyleSheet.create({
  container: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  glowRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
  },
  glowCircle: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─── Animated Step Row ──────────────────────────────────────────

function AnimatedStepRow({
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
  const shakeX = useSharedValue(0);
  const iconRotation = useSharedValue(0);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      checkScale.value = 0;
      iconRotation.value = withRepeat(
        withSequence(
          withTiming(8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(-8, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
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
      shakeX.value = withSequence(
        withTiming(-5, { duration: 50 }),
        withTiming(5, { duration: 50 }),
        withTiming(-5, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
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

  const animatedPulse = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const animatedCheck = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const animatedShake = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const animatedIconRotate = useAnimatedStyle(() => ({
    transform: [{ rotate: `${iconRotation.value}deg` }],
  }));

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
    <Animated.View style={[styles.stepRow, animatedShake]}>
      {/* Step indicator */}
      <Animated.View
        style={[
          styles.stepCircle,
          { backgroundColor: circleBg, borderColor: stepColor },
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

      {/* Connector line */}
      {!isLast && (
        <View style={[styles.connectorLine, {
          backgroundColor: status === 'completed'
            ? (isDark ? 'rgba(48,209,88,0.25)' : 'rgba(48,209,88,0.20)')
            : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
        }]} />
      )}

      {/* Step content */}
      <View style={styles.stepContent}>
        <Text style={[styles.stepLabel, { color: labelColor }]}>
          {step.label}
        </Text>
        {status === 'active' && step.hint && (
          <Text style={[styles.stepHint, {
            color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)',
          }]}>
            {step.hint}
          </Text>
        )}
        {status === 'completed' && index < 3 && (
          <Text style={[styles.stepHint, { color: 'rgba(48,209,88,0.60)' }]}>
            Done
          </Text>
        )}
      </View>

      {/* Active spinner on the right */}
      {status === 'active' && (
        <ActivityIndicator size="small" color={step.color} style={{ marginLeft: 8 }} />
      )}
      {status === 'completed' && (
        <Ionicons name="checkmark-circle" size={18} color="rgba(48,209,88,0.50)" />
      )}
    </Animated.View>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function ArchivalProgressSheet({
  visible,
  onClose,
  onComplete,
  pin,
}: ArchivalProgressSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    STEPS.map(() => 'pending'),
  );
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [walletCount, setWalletCount] = useState(0);
  const [settingsCount, setSettingsCount] = useState(0);

  const isRunning = useRef(false);

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  // Calculate progress percentage
  const progressPercent = stepStatuses.reduce((acc, s, i) => {
    if (s === 'completed') return acc + (i === 3 ? 10 : 30);
    if (s === 'active') return acc + (i === 3 ? 5 : 15);
    return acc;
  }, 0);

  // Helper to update a single step status
  const setStep = useCallback((index: number, status: StepStatus) => {
    setStepStatuses(prev => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  }, []);

  // Helper to wait minimum duration
  const waitMin = (startMs: number, minMs: number) => {
    const elapsed = Date.now() - startMs;
    const remaining = Math.max(0, minMs - elapsed);
    return new Promise(resolve => setTimeout(resolve, remaining));
  };

  // Run the archival pipeline
  const runArchive = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;
    try {
      // ── Step 1: Preparing data ─────────────────────────
      let stepStart = Date.now();
      setStep(0, 'active');

      const wallets = useMultiWalletStore.getState().wallets;
      if (wallets.length === 0) {
        setStep(0, 'failed');
        setFailed(true);
        setErrorMessage('No wallets found to archive.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      setWalletCount(wallets.length);

      // Extract snapshots for each wallet
      const walletSnapshots: Array<{
        walletId: string;
        snapshot: ReturnType<typeof CanonicalSnapshotBuilder.extract>;
      }> = [];

      for (const wallet of wallets) {
        try {
          const snapshot = CanonicalSnapshotBuilder.extractFromDatabase(wallet.id);
          if (snapshot) {
            walletSnapshots.push({ walletId: wallet.id, snapshot });
          }
        } catch (error) {
          // Failed to extract snapshot
        }
      }

      // Gather all settings (full coverage)
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

      // Count non-undefined settings for display
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

      // ── Step 2: Encrypting wallets (PBKDF2-heavy) ─────
      stepStart = Date.now();
      setStep(1, 'active');

      let archivedCount = 0;
      for (const { walletId, snapshot } of walletSnapshots) {
        try {
          // Small yield to keep UI responsive between PBKDF2 calls
          await new Promise(resolve => setTimeout(resolve, 50));
          const success = await PreservedArchiveService.archiveWallet(walletId, snapshot, pin);
          if (success) archivedCount++;
        } catch (error) {
          // Failed to encrypt wallet
        }
      }

      if (walletSnapshots.length === 0) {
        setStep(1, 'failed');
        setFailed(true);
        setErrorMessage('No wallet data available yet. Please wait for your wallets to finish syncing, then try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      if (archivedCount === 0) {
        setStep(1, 'failed');
        setFailed(true);
        setErrorMessage('Failed to encrypt wallet data. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(1, 'completed');

      // ── Step 3: Saving to Keychain (manifest + embedded settings) ──
      stepStart = Date.now();
      setStep(2, 'active');

      try {
        // Settings are embedded in the manifest — no separate PBKDF2 needed.
        // Keychain provides hardware-backed at-rest encryption.
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

        // Clear the recovery-dismissed flag so recovery sheet appears after next reinstall.
        // This flag persists in Keychain — must be reset each time fresh data is archived.
        await SecureStore.deleteItemAsync('preserved_recovery_dismissed', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => {});
      } catch (error) {
        // Failed to write manifest
        setStep(2, 'failed');
        setFailed(true);
        setErrorMessage('Failed to save to Keychain. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(2, 'completed');

      // ── Step 4: Complete ───────────────────────────────
      setStep(3, 'completed');
      setCompleted(true);

      haptics.trigger('success');

    } catch (error) {
      setFailed(true);
      setErrorMessage('An unexpected error occurred during archival.');
      haptics.trigger('error');
    } finally {
      isRunning.current = false;
    }
  }, [pin, setStep, haptics]);

  // Start archival when visible
  useEffect(() => {
    if (visible && !isRunning.current && !completed && !failed) {
      // Reset state
      setStepStatuses(STEPS.map(() => 'pending'));
      setFailed(false);
      setErrorMessage(null);
      setCompleted(false);
      setWalletCount(0);
      setSettingsCount(0);

      // Slight delay to let the sheet animate in
      const timer = setTimeout(() => runArchive(), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleRetry = () => {
    setStepStatuses(STEPS.map(() => 'pending'));
    setFailed(false);
    setErrorMessage(null);
    setCompleted(false);
    setWalletCount(0);
    setSettingsCount(0);
    runArchive();
  };

  const handleDone = () => {
    onComplete();
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing={['auto', 'large']}
      scrollable
      dismissible={failed || completed}
      grabber={failed || completed}
      showCloseButton={failed || completed}
      contentKey={failed ? 1 : completed ? 2 : 0}
    >
      <View style={styles.container}>
        {/* Animated Shield Icon */}
        <ShieldProgressIcon isDark={isDark} completed={completed} failed={failed} />

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>
          {completed ? 'Data Preserved' : failed ? 'Archival Failed' : 'Securing Your Data'}
        </Text>
        <Text style={[styles.subtitle, {
          color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
        }]}>
          {completed
            ? 'Your wallets and settings are safely stored in the iOS Keychain'
            : failed
            ? 'Something went wrong during the archival process'
            : 'Encrypting and storing your wallet data securely'
          }
        </Text>

        {/* Progress bar */}
        <ProgressBar progress={progressPercent} isDark={isDark} failed={failed} />

        {/* Steps card */}
        <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
          {STEPS.map((step, index) => (
            <AnimatedStepRow
              key={index}
              step={step}
              index={index}
              status={stepStatuses[index]}
              isDark={isDark}
              colors={colors}
              isLast={index === STEPS.length - 1}
            />
          ))}
        </View>

        {/* Summary stats (completed) */}
        {completed && (
          <Animated.View
            entering={FadeInDown.duration(300).delay(100)}
            style={[styles.summaryRow, {
              backgroundColor: surfaceBg,
            }]}
          >
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIconCircle, {
                backgroundColor: isDark ? 'rgba(94,92,230,0.12)' : 'rgba(94,92,230,0.08)',
              }]}>
                <Ionicons name="wallet" size={14} color="#5E5CE6" />
              </View>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {walletCount}
              </Text>
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
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {settingsCount}
              </Text>
              <Text style={[styles.summaryLabel, {
                color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
              }]}>
                Settings
              </Text>
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
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                AES-256
              </Text>
              <Text style={[styles.summaryLabel, {
                color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
              }]}>
                Encrypted
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Error card */}
        {failed && errorMessage && (
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={[styles.errorCard, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
            }]}
          >
            <View style={[styles.errorIconCircle, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
            }]}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
            </View>
            <Text style={[styles.errorText, {
              color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A',
            }]}>
              {errorMessage}
            </Text>
          </Animated.View>
        )}

        {/* Success: Done button */}
        {completed && (
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
              }]}>
                Done
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Failed: Retry / Cancel buttons */}
        {failed && (
          <View style={styles.buttonGroup}>
            <TouchableOpacity
              onPress={handleRetry}
              activeOpacity={0.7}
              style={[styles.primaryButton, {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              }]}
            >
              <Ionicons
                name="refresh"
                size={17}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.primaryButtonText, {
                color: '#FFFFFF',
              }]}>
                Try Again
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={styles.secondaryButton}
            >
              <Text style={[styles.secondaryButtonText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Keychain info note */}
        {!completed && !failed && (
          <Text style={[styles.footnote, {
            color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
          }]}>
            Data is encrypted and stored in the iOS Keychain, which persists even if the app is deleted.
          </Text>
        )}
      </View>
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
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
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

  // Steps card
  stepsCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },

  // Step row
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

  // Error
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
  errorText: {
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

  // Footnote
  footnote: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
    paddingHorizontal: 8,
  },
});
