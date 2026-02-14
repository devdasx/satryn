/**
 * ICloudBackupCreateSheet — Unified single-sheet flow for creating an iCloud backup.
 *
 * Combines previously separate sheets into one continuous flow:
 *   Phase 1: Name the backup
 *   Phase 2: Set encryption password
 *   Phase 3: Real progress steps (assemble → encrypt → upload → complete)
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
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { useTheme, useHaptics } from '../../hooks';
import { useMultiWalletStore } from '../../stores/multiWalletStore';
import {
  BackupService,
  ICloudService,
  type EncryptedFullBackupBlob,
} from '../../services/backup';
import { getDeviceId } from '../../services/DeviceIdentity';
import { useSettingsStore, type ICloudBackupEntry } from '../../stores';

// ─── Types ──────────────────────────────────────────────────────

interface ICloudBackupCreateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called when backup is successfully created */
  onComplete: (entry: ICloudBackupEntry) => void;
  /** PIN already verified */
  pin: string;
  /** Existing backup count (for default name) */
  existingBackupCount: number;
  /** Optional default name override */
  defaultName?: string;
}

type Phase = 'naming' | 'password' | 'progress';
type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StepConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  doneIcon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  color: string;
}

const BACKUP_STEPS: StepConfig[] = [
  {
    label: 'Assembling wallet data',
    icon: 'wallet-outline',
    activeIcon: 'wallet',
    doneIcon: 'wallet',
    hint: 'Gathering all wallet information',
    color: '#007AFF',
  },
  {
    label: 'Encrypting backup',
    icon: 'lock-closed-outline',
    activeIcon: 'lock-closed',
    doneIcon: 'lock-closed',
    hint: 'AES-256-GCM encryption',
    color: '#FF9F0A',
  },
  {
    label: 'Uploading to iCloud',
    icon: 'cloud-upload-outline',
    activeIcon: 'cloud-upload',
    doneIcon: 'cloud-upload',
    hint: 'Saving encrypted data to iCloud KVS',
    color: '#5E5CE6',
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
    { key: 'naming', label: 'Name' },
    { key: 'password', label: 'Password' },
    { key: 'progress', label: 'Backup' },
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
  container: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 20 },
  item: { alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
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

function BackupStepRow({
  step, index, status, isDark, colors, isLast = false,
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
          status === 'active' && animatedPulse]}
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

      {status === 'active' && <ActivityIndicator size="small" color={step.color} style={{ marginLeft: 8 }} />}
      {status === 'completed' && <Ionicons name="checkmark-circle" size={18} color="rgba(48,209,88,0.50)" />}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
  circle: {
    width: 34, height: 34, borderRadius: 11, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  connector: { position: 'absolute', left: 34, top: 48, width: 2, height: 14, borderRadius: 1 },
  content: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  hint: { fontSize: 12, fontWeight: '400', marginTop: 2 },
});

// ─── Main Component ─────────────────────────────────────────────

export function ICloudBackupCreateSheet({
  visible,
  onClose,
  onComplete,
  pin,
  existingBackupCount,
  defaultName,
}: ICloudBackupCreateSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const { wallets } = useMultiWalletStore();

  // Phase state
  const [phase, setPhase] = useState<Phase>('naming');

  // Naming state
  const [backupName, setBackupName] = useState('');
  const nameRef = useRef<TextInput>(null);

  // Password state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const shakeX = useSharedValue(0);

  // Progress state
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(BACKUP_STEPS.map(() => 'pending'));
  const [backupFailed, setBackupFailed] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupCompleted, setBackupCompleted] = useState(false);
  const isRunning = useRef(false);
  const completedEntryRef = useRef<ICloudBackupEntry | null>(null);
  const didCallComplete = useRef(false);

  const contentKey = `${phase}-${backupFailed ? 'f' : backupCompleted ? 'c' : 'r'}`;
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';

  // Reset on open
  useEffect(() => {
    if (visible) {
      setPhase('naming');
      setBackupName(defaultName || `Backup ${existingBackupCount + 1}`);
      setPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      setStepStatuses(BACKUP_STEPS.map(() => 'pending'));
      setBackupFailed(false);
      setBackupError(null);
      setBackupCompleted(false);
      isRunning.current = false;
      completedEntryRef.current = null;
      didCallComplete.current = false;
      setTimeout(() => nameRef.current?.focus(), 400);
    }
  }, [visible]);

  // Focus password field when entering password phase
  useEffect(() => {
    if (phase === 'password') {
      setTimeout(() => passwordRef.current?.focus(), 400);
    }
  }, [phase]);

  // Shake animation
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

  // Progress percentage
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
  const handleNameContinue = useCallback(async () => {
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
    setPhase('progress');
  }, [password, confirmPassword, haptics, triggerShake]);

  // ─── Phase 3: Backup Pipeline ─────────────────────────────────
  const runBackup = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;

    try {
      const name = backupName.trim() || `Backup ${existingBackupCount + 1}`;

      // Step 1: Assembling wallet data
      let stepStart = Date.now();
      setStep(0, 'active');

      let payload: any;
      try {
        payload = await BackupService.assembleFullPayload(pin, name);
        if (!payload) throw new Error('No wallet data could be assembled — check PIN and wallet state');
      } catch (e: any) {
        console.error('[ICloudBackup] Assemble failed:', e?.message);
        setStep(0, 'failed');
        setBackupFailed(true);
        setBackupError('Failed to assemble wallet data. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(0, 'completed');

      // Step 2: Encrypting backup
      stepStart = Date.now();
      setStep(1, 'active');

      let blob: EncryptedFullBackupBlob;
      const deviceId = await getDeviceId();
      try {
        blob = await BackupService.encryptFullBackup(payload, password, deviceId);
      } catch {
        setStep(1, 'failed');
        setBackupFailed(true);
        setBackupError('Failed to encrypt backup data. Please try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(1, 'completed');

      // Step 3: Uploading to iCloud
      stepStart = Date.now();
      setStep(2, 'active');

      const backupId = Date.now().toString();
      try {
        ICloudService.writeFullBackup(backupId, blob);
      } catch {
        setStep(2, 'failed');
        setBackupFailed(true);
        setBackupError('Failed to upload to iCloud. Check your iCloud connection and try again.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(2, 'completed');

      // Step 4: Complete
      setStep(3, 'completed');
      setBackupCompleted(true);
      haptics.trigger('success');

      // Build the entry for the caller — store in ref so Done button uses the real backup ID
      completedEntryRef.current = {
        id: backupId,
        name,
        timestamp: Date.now(),
        walletCount: wallets.length,
        walletNames: wallets.map(w => w.name),
      };

    } catch {
      setBackupFailed(true);
      setBackupError('An unexpected error occurred during backup.');
      haptics.trigger('error');
    } finally {
      isRunning.current = false;
    }
  }, [pin, password, backupName, existingBackupCount, wallets, setStep, haptics, onComplete]);

  // Start backup when entering progress phase
  useEffect(() => {
    if (phase === 'progress' && !isRunning.current && !backupCompleted && !backupFailed) {
      setStepStatuses(BACKUP_STEPS.map(() => 'pending'));
      setBackupFailed(false);
      setBackupError(null);
      setBackupCompleted(false);
      const timer = setTimeout(() => runBackup(), 300);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const handleRetry = () => {
    setStepStatuses(BACKUP_STEPS.map(() => 'pending'));
    setBackupFailed(false);
    setBackupError(null);
    setBackupCompleted(false);
    runBackup();
  };

  const handleDone = () => {
    // Prevent double-calling onComplete (e.g. rapid taps)
    if (didCallComplete.current) return;
    didCallComplete.current = true;

    // Use the real entry from the backup pipeline (same backup ID written to iCloud)
    const entry = completedEntryRef.current ?? {
      id: Date.now().toString(),
      name: backupName.trim() || `Backup ${existingBackupCount + 1}`,
      timestamp: Date.now(),
      walletCount: wallets.length,
      walletNames: wallets.map(w => w.name),
    };
    onComplete(entry);
  };

  // Password strength
  const strength = getStrength(password);
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;

  const isDismissible = phase === 'naming' || phase === 'password' || backupFailed || backupCompleted;

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing={phase === 'progress' ? ['auto', 'large'] : 'auto'}
      scrollable={phase === 'progress'}
      dismissible={isDismissible}
      contentKey={contentKey}
    >
      <View style={styles.container}>
        {/* Phase indicator */}
        <PhaseIndicator phase={phase} isDark={isDark} />

        {/* ─── Phase 1: Naming ───────────────────────────────── */}
        {phase === 'naming' && (
          <Animated.View entering={FadeIn.duration(300)}>
            {/* Cloud icon */}
            <View style={styles.iconContainer}>
              <View style={[styles.iconGlow, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.08)' : 'rgba(0,122,255,0.06)',
              }]} />
              <View style={[styles.iconCircle, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.10)',
              }]}>
                <Ionicons name="cloud-upload" size={28} color="#007AFF" />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>Name Your Backup</Text>
            <Text style={[styles.subtitle, { color: textSecondary }]}>
              Give this snapshot a recognizable name
            </Text>

            <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
              <PremiumInput
                ref={nameRef}
                icon="document-text"
                iconColor="#007AFF"
                placeholder="My Backup"
                value={backupName}
                onChangeText={setBackupName}
                returnKeyType="done"
                onSubmitEditing={handleNameContinue}
              />
            </View>

            <Text style={[styles.infoNote, {
              color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
            }]}>
              {`This backup includes ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}${wallets.length > 0 ? ': ' + wallets.map(w => w.name).join(', ') : ''}`}
            </Text>

            <TouchableOpacity
              onPress={handleNameContinue}
              activeOpacity={0.7}
              style={[styles.primaryButton, {
                backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
              }]}
            >
              <Text style={[styles.primaryButtonText, {
                color: isDark ? '#000000' : '#FFFFFF',
              }]}>Continue</Text>
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

              <Text style={[styles.title, { color: colors.text }]}>Set Backup Password</Text>
              <Text style={[styles.subtitle, { color: textSecondary }]}>
                Choose a strong password to encrypt your backup
              </Text>

              <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
                <PremiumInput
                  ref={passwordRef}
                  icon="key"
                  iconColor="#FF9F0A"
                  placeholder="Enter password (min 6 characters)"
                  secureTextEntry
                  value={password}
                  onChangeText={(t) => { setPassword(t); setPasswordError(null); }}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />

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
                  }]}>{passwordError}</Text>
                </Animated.View>
              )}

              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              }]}>
                This password is required to restore your backup. Store it safely — it cannot be recovered.
              </Text>

              <TouchableOpacity
                onPress={handlePasswordSubmit}
                activeOpacity={0.7}
                style={[styles.primaryButton, {
                  backgroundColor: isPasswordValid
                    ? (isDark ? '#FFFFFF' : '#0D0D0D')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                }]}
              >
                <Text style={[styles.primaryButtonText, {
                  color: isPasswordValid
                    ? (isDark ? '#000000' : '#FFFFFF')
                    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'),
                }]}>Create Backup</Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        )}

        {/* ─── Phase 3: Progress ─────────────────────────────── */}
        {phase === 'progress' && (
          <Animated.View entering={FadeIn.duration(300)}>
            <View style={styles.iconContainer}>
              <View style={[styles.iconGlow, {
                backgroundColor: backupFailed
                  ? (isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.06)')
                  : backupCompleted
                    ? (isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.07)')
                    : (isDark ? 'rgba(0,122,255,0.08)' : 'rgba(0,122,255,0.06)'),
              }]} />
              <View style={[styles.iconCircle, {
                backgroundColor: backupFailed
                  ? (isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)')
                  : backupCompleted
                    ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.10)')
                    : (isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.10)'),
              }]}>
                <Ionicons
                  name={backupFailed ? 'alert-circle' : backupCompleted ? 'cloud-done' : 'cloud-upload'}
                  size={32}
                  color={backupFailed ? '#FF453A' : backupCompleted ? '#30D158' : '#007AFF'}
                />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>
              {backupCompleted ? 'Backup Complete' : backupFailed ? 'Backup Failed' : 'Creating Backup'}
            </Text>
            <Text style={[styles.subtitle, {
              color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
            }]}>
              {backupCompleted
                ? 'Your encrypted backup is safely stored in iCloud'
                : backupFailed
                  ? 'Something went wrong during the backup process'
                  : 'Encrypting and uploading your wallet data'
              }
            </Text>

            <ProgressBar progress={progressPercent} isDark={isDark} failed={backupFailed} />

            <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
              {BACKUP_STEPS.map((step, index) => (
                <BackupStepRow
                  key={index}
                  step={step}
                  index={index}
                  status={stepStatuses[index]}
                  isDark={isDark}
                  colors={colors}
                  isLast={index === BACKUP_STEPS.length - 1}
                />
              ))}
            </View>

            {/* Summary on completion */}
            {backupCompleted && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(100)}
                style={[styles.summaryRow, { backgroundColor: surfaceBg }]}
              >
                <View style={styles.summaryItem}>
                  <View style={[styles.summaryIconCircle, {
                    backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
                  }]}>
                    <Ionicons name="wallet" size={14} color="#007AFF" />
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{wallets.length}</Text>
                  <Text style={[styles.summaryLabel, {
                    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                  }]}>{wallets.length === 1 ? 'Wallet' : 'Wallets'}</Text>
                </View>
                <View style={[styles.summaryDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]} />
                <View style={styles.summaryItem}>
                  <View style={[styles.summaryIconCircle, {
                    backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
                  }]}>
                    <Ionicons name="cloud-done" size={14} color="#007AFF" />
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>iCloud</Text>
                  <Text style={[styles.summaryLabel, {
                    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                  }]}>Stored</Text>
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
            {backupFailed && backupError && (
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
                }]}>{backupError}</Text>
              </Animated.View>
            )}

            {/* Retry / Cancel */}
            {backupFailed && (
              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  onPress={handleRetry}
                  activeOpacity={0.7}
                  style={[styles.primaryButton, {
                    backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
                  }]}
                >
                  <Ionicons name="refresh" size={17} color={isDark ? '#000000' : '#FFFFFF'} style={{ marginRight: 6 }} />
                  <Text style={[styles.primaryButtonText, {
                    color: isDark ? '#000000' : '#FFFFFF',
                  }]}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.secondaryButton}>
                  <Text style={[styles.secondaryButtonText, {
                    color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
                  }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Done button (show after success, auto-close disabled) */}
            {backupCompleted && (
              <Animated.View entering={FadeInDown.duration(300).delay(200)}>
                <TouchableOpacity
                  onPress={handleDone}
                  activeOpacity={0.7}
                  style={[styles.primaryButton, {
                    backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
                  }]}
                >
                  <Text style={[styles.primaryButtonText, {
                    color: isDark ? '#000000' : '#FFFFFF',
                  }]}>Done</Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* Footnote while running */}
            {!backupCompleted && !backupFailed && (
              <Text style={[styles.infoNote, {
                color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
              }]}>
                Your backup is encrypted with your password before uploading. Only you can decrypt it.
              </Text>
            )}
          </Animated.View>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, paddingTop: 4, paddingBottom: 16 },

  iconContainer: {
    width: 76, height: 76, justifyContent: 'center', alignItems: 'center',
    alignSelf: 'center', marginBottom: 14,
  },
  iconGlow: { position: 'absolute', width: 76, height: 76, borderRadius: 38 },
  iconCircle: { width: 56, height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },

  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, fontWeight: '400', textAlign: 'center', marginBottom: 20, lineHeight: 20 },

  inputCard: { borderRadius: 20, overflow: 'hidden', marginBottom: 12 },
  inputDivider: { height: StyleSheet.hairlineWidth, marginLeft: 60, marginRight: 16 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  strengthTrack: { flex: 1, height: 3, borderRadius: 1.5, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: 1.5 },
  strengthLabel: { fontSize: 11, fontWeight: '600', minWidth: 55, textAlign: 'right' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, marginBottom: 12 },
  errorText: { fontSize: 13, fontWeight: '500', flex: 1 },

  infoNote: { fontSize: 12, fontWeight: '400', textAlign: 'center', lineHeight: 17, marginBottom: 20, paddingHorizontal: 8 },

  stepsCard: { borderRadius: 20, marginBottom: 16, overflow: 'hidden' },

  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 20, paddingVertical: 16, paddingHorizontal: 12, marginBottom: 20,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryIconCircle: { width: 30, height: 30, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  summaryValue: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  summaryLabel: { fontSize: 11, fontWeight: '500' },
  summaryDivider: { width: 1, height: 36, borderRadius: 0.5 },

  archiveErrorCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 20, gap: 12 },
  archiveErrorIcon: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  archiveErrorText: { fontSize: 14, fontWeight: '500', flex: 1, lineHeight: 20 },

  primaryButton: { height: 50, borderRadius: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 16, fontWeight: '600' },
  buttonGroup: { gap: 8 },
  secondaryButton: { height: 45, justifyContent: 'center', alignItems: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '500' },
});
