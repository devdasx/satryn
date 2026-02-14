/**
 * PinCodeScreen — Unified Muun-style PIN entry screen.
 *
 * Single component for all PIN flows in the app:
 * - create: Set a new PIN (with optional length selection + confirm step)
 * - unlock: Enter PIN to unlock the wallet/app
 * - verify: Enter PIN for sensitive actions (sign, send, backup, etc.)
 *
 * Features:
 * - Variable PIN length (4-digit, 6-digit, or custom/unlimited)
 * - Face ID / Touch ID integration
 * - Progressive lockout after failed attempts
 * - Shake + haptic error feedback
 * - Apple-style lock icon animation
 * - Full light/dark theme support
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  StatusBar,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { SECURITY, THEME, getColors } from '../../constants';
import type { PinPolicy } from '../../constants';
import { SecureStorage } from '../../services/storage/SecureStorage';
import { FaceIdIcon } from '../ui/FaceIdIcon';
import { PinAuthCoordinator } from '../../services/auth/PinAuthCoordinator';
import { useTheme } from '../../hooks';
import { BiometricState } from '../../utils/biometricState';
import { AppBottomSheet } from '../ui/AppBottomSheet';

// ─── Props ──────────────────────────────────────────────────────

export interface PinCodeScreenProps {
  /** Operating mode */
  mode: 'create' | 'unlock' | 'verify';
  /** PIN length policy — only used in 'create' mode */
  pinPolicy?: PinPolicy;
  /** Title text */
  title?: string;
  /** Subtitle text */
  subtitle?: string;
  /** Icon name (Ionicons) */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Icon color */
  iconColor?: string;
  /** Called with the final PIN on success */
  onSuccess: (pin: string) => void;
  /** Called when user cancels/goes back */
  onCancel?: () => void;
  /**
   * Verification callback for unlock/verify modes.
   * Called with the entered PIN, should return success/error.
   */
  onVerify?: (pin: string) => Promise<{ success: boolean; error?: string }>;
  /** Whether biometric auth is available/enabled */
  biometricEnabled?: boolean;
  /**
   * Biometric success handler. Should return the PIN retrieved from secure storage.
   */
  onBiometricSuccess?: () => Promise<{ success: boolean; pin?: string }>;
  /** Don't auto-prompt biometrics on mount */
  suppressBiometricAutoPrompt?: boolean;
  /** Show back button (default: true) */
  showBackButton?: boolean;
  /** Show 4/6/Custom selector in create mode */
  showLengthSelector?: boolean;
  /** Called when user confirms full app reset after max lockout */
  onAppReset?: () => void;
}

// ─── Internal types ─────────────────────────────────────────────

type CreateStep = 'select' | 'enter' | 'confirm';

// ─── Letter map for phone-style keypad ───────────────────────────

const DIGIT_LETTERS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL',
  '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
};

// ─── Memoized keypad digit button (phone-style) ─────────────────

const DigitButton = memo(function DigitButton({
  digit,
  onPress,
  disabled,
  textColor,
  mutedColor,
  pressedBg,
}: {
  digit: string;
  onPress: (d: string) => void;
  disabled: boolean;
  textColor: string;
  mutedColor: string;
  pressedBg: string;
}) {
  const letters = DIGIT_LETTERS[digit];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.keyBtn,
        pressed && { backgroundColor: pressedBg },
        disabled && styles.keyBtnDisabled,
      ]}
      onPress={() => onPress(digit)}
      disabled={disabled}
    >
      <Text style={[styles.keyBtnText, { color: textColor }]}>{digit}</Text>
      {letters ? (
        <Text style={[styles.keyBtnLetters, { color: mutedColor }]}>{letters}</Text>
      ) : null}
    </Pressable>
  );
});

// ─── Animated PIN dot ────────────────────────────────────────────

const SUCCESS_COLOR = '#34C759';
const ERROR_COLOR = '#FF453A'; // c.semantic.error

function PinDot({
  filled,
  hasError,
  isSuccess,
  index,
  emptyColor,
  filledColor,
}: {
  filled: boolean;
  hasError: boolean;
  isSuccess: boolean;
  index: number;
  emptyColor: string;
  filledColor: string;
}) {
  const dotScale = useSharedValue(filled ? 1 : 0.85);

  useEffect(() => {
    if (isSuccess) {
      // Success: just hold at scale 1, color change handled by props
      dotScale.value = withTiming(1, { duration: 0 });
    } else {
      dotScale.value = filled
        ? withSpring(1, { damping: 12, stiffness: 200 })
        : withTiming(0.85, { duration: 80 });
    }
  }, [filled, isSuccess, dotScale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.value }],
  }));

  // Colors driven by React props directly
  const bgColor = isSuccess
    ? SUCCESS_COLOR
    : filled
      ? (hasError ? ERROR_COLOR : filledColor)
      : 'transparent';
  const border = isSuccess
    ? SUCCESS_COLOR
    : hasError
      ? ERROR_COLOR
      : (filled ? filledColor : emptyColor);

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: bgColor, borderColor: border },
        animStyle,
      ]}
    />
  );
}

// ─── Component ──────────────────────────────────────────────────

export function PinCodeScreen({
  mode,
  pinPolicy: initialPolicy = 'fixed6',
  title: titleProp,
  subtitle: subtitleProp,
  icon = 'lock-closed',
  iconColor,
  onSuccess,
  onCancel,
  onVerify,
  biometricEnabled = false,
  onBiometricSuccess,
  suppressBiometricAutoPrompt = false,
  showBackButton = true,
  showLengthSelector = false,
  onAppReset,
}: PinCodeScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  // Resolve icon color based on theme if not explicitly set
  const resolvedIconColor = iconColor || colors.text;

  // ── Theme-aware colors (memoized) ─────────────────────────────
  const themeColors = useMemo(() => ({
    bg: c.pinScreen.bg,
    textPrimary: c.pinScreen.textPrimary,
    textSecondary: c.pinScreen.textSecondary,
    textMuted: c.text.muted,
    iconCircleBg: c.pinScreen.iconCircleBg,
    dotBorder: c.pinScreen.dotBorder,
    dotFilled: c.pinScreen.dotFilled,
    keyTextColor: c.pinScreen.keypadText,
    keyIconColor: c.text.muted,
    backChevronColor: c.text.secondary,
    selectorBg: c.pinScreen.keypadBg,
    selectorBorder: c.pinScreen.keypadBg,
    selectorPressedBg: c.pinScreen.keypadBg,
    progressDotInactive: c.pinScreen.dotBorder,
    progressDotActiveBg: c.pinScreen.dotFilled,
    doneColor: c.brand.bitcoin,
  }), [c]);

  // ── State ──────────────────────────────────────────────────

  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [pinPolicy, setPinPolicy] = useState<PinPolicy>(initialPolicy);
  const [createStep, setCreateStep] = useState<CreateStep>('enter');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [optionsSheetVisible, setOptionsSheetVisible] = useState(false);

  // Lockout state
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [canResetApp, setCanResetApp] = useState(false);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Biometric retry tracking
  const [biometricFailed, setBiometricFailed] = useState(false);
  const [isFaceId, setIsFaceId] = useState(false);
  const biometricAttemptCount = useRef(0);

  // Refs for stable callback access (avoids re-creating callbacks on every keypress)
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const firstPinRef = useRef(firstPin);
  firstPinRef.current = firstPin;
  const createStepRef = useRef(createStep);
  createStepRef.current = createStep;
  const pinPolicyRef = useRef(pinPolicy);
  pinPolicyRef.current = pinPolicy;
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const isLockedOutRef = useRef(isLockedOut);
  isLockedOutRef.current = isLockedOut;

  // Animation — shake
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  // Animation — lock icon (Apple iOS style)
  const lockProgress = useSharedValue(0);
  const isLockAnimatable = mode === 'unlock' || mode === 'verify';

  const lockClosedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lockProgress.value, [0, 0.4, 0.5], [1, 1, 0]),
    transform: [
      { scale: interpolate(lockProgress.value, [0, 0.5], [1, 0.8]) },
    ],
  }));

  const lockOpenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lockProgress.value, [0.5, 0.6, 1], [0, 1, 1]),
    transform: [
      { scale: interpolate(lockProgress.value, [0.5, 1], [0.8, 1]) },
    ],
  }));

  const triggerUnlockAnimation = useCallback(() => {
    lockProgress.value = withTiming(1, {
      duration: 600,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, []);

  // ── Derived values ─────────────────────────────────────────

  const pinLength = pinPolicy === 'fixed4' ? 4 : pinPolicy === 'fixed6' ? 6 : null;
  const isFixedLength = pinLength !== null;
  const isVariableLength = !isFixedLength;
  const isCreateMode = mode === 'create';
  const isConfirmStep = createStep === 'confirm';
  const showBiometric = (mode === 'unlock' || mode === 'verify') && biometricsAvailable && !isLockedOut;
  const canSubmitVariable = isVariableLength && pin.length >= SECURITY.PIN_MIN_LENGTH;

  // ── Title/subtitle resolution ──────────────────────────────

  const resolvedTitle = useMemo(() => {
    if (isCreateMode) {
      if (createStep === 'select') return titleProp || 'Create a PIN';
      if (isConfirmStep) return 'Confirm your PIN';
      return titleProp || 'Create a PIN';
    }
    return titleProp || (mode === 'unlock' ? 'Enter your PIN' : 'Enter PIN');
  }, [isCreateMode, createStep, isConfirmStep, titleProp, mode]);

  const resolvedSubtitle = useMemo(() => {
    if (isCreateMode) {
      if (createStep === 'select') return subtitleProp || 'Choose a PIN length to protect your wallet.';
      if (isConfirmStep) return 'Enter your PIN again to confirm.';
      const lengthLabel = pinPolicy === 'fixed4' ? '4-digit' : pinPolicy === 'fixed6' ? '6-digit' : 'custom';
      return subtitleProp || `Choose a ${lengthLabel} PIN to protect your wallet.`;
    }
    return subtitleProp || (mode === 'unlock' ? 'Enter PIN to unlock' : '');
  }, [isCreateMode, createStep, isConfirmStep, subtitleProp, mode, pinPolicy]);

  // ── Load saved PIN policy for unlock/verify modes ────────

  useEffect(() => {
    if (mode === 'unlock' || mode === 'verify') {
      PinAuthCoordinator.getPinPolicy().then((savedPolicy) => {
        setPinPolicy(savedPolicy);
      });
    }
  }, [mode]);

  // ── Biometrics check ──────────────────────────────────────

  useEffect(() => {
    if (mode === 'unlock' || mode === 'verify') {
      checkBiometrics();
    }
  }, []);

  const checkBiometrics = async () => {
    if (!biometricEnabled || !onBiometricSuccess) {
      setBiometricsAvailable(false);
      return;
    }

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const hasBiometricPin = await SecureStorage.hasBiometricPin();

    // Detect Face ID vs Touch ID
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      setIsFaceId(types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION));
    } catch {}

    const available = hasHardware && isEnrolled && hasBiometricPin;
    setBiometricsAvailable(available);

    if (available && !suppressBiometricAutoPrompt && biometricAttemptCount.current < 2) {
      handleBiometricAuth();
    }
  };

  // ── Lockout check ─────────────────────────────────────────

  useEffect(() => {
    if (mode === 'unlock' || mode === 'verify') {
      checkLockout();
    }
    return () => {
      if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    };
  }, []);

  const checkLockout = async () => {
    const state = await PinAuthCoordinator.getLockoutState();
    // Only show reset option when actually locked out (must wait)
    if (state.locked) {
      setCanResetApp(true);
      startLockoutTimer(state.remainingSeconds);
    }
  };

  const startLockoutTimer = (seconds: number) => {
    setIsLockedOut(true);
    setCanResetApp(true);
    setLockoutRemaining(seconds);

    if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    lockoutTimerRef.current = setInterval(() => {
      setLockoutRemaining(prev => {
        if (prev <= 1) {
          if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
          setIsLockedOut(false);
          setCanResetApp(false); // Hide reset button when lockout ends
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResetApp = useCallback(() => {
    Alert.alert(
      'Reset App',
      'This will permanently erase all wallets, transactions, and settings. Your funds will be lost unless you have a backup of your recovery phrase. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Everything',
          style: 'destructive',
          onPress: async () => {
            await PinAuthCoordinator.fullAppReset();
            onAppReset?.();
          },
        },
      ],
    );
  }, [onAppReset]);

  // ── Shake animation ───────────────────────────────────────

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-12, { duration: 50, easing: Easing.linear }),
      withTiming(12, { duration: 50, easing: Easing.linear }),
      withTiming(-12, { duration: 50, easing: Easing.linear }),
      withTiming(12, { duration: 50, easing: Easing.linear }),
      withTiming(-5, { duration: 50, easing: Easing.linear }),
      withTiming(5, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 50, easing: Easing.linear })
    );
  }, []);

  // ── Success animation helper ─────────────────────────────────

  const triggerSuccessAndFinish = useCallback((enteredPin: string, afterAnimation?: () => void) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsSuccess(true);
    // Brief pause to show green dots, then proceed
    setTimeout(() => {
      afterAnimation?.();
      onSuccess(enteredPin);
    }, 300);
  }, [onSuccess]);

  // ── Core PIN completion logic (stable — uses refs) ─────────

  const handlePinComplete = useCallback(async (enteredPin: string) => {
    setIsProcessing(true);

    const currentCreateStep = createStepRef.current;
    const currentFirstPin = firstPinRef.current;
    const currentPinPolicy = pinPolicyRef.current;

    if (isCreateMode) {
      if (currentCreateStep === 'confirm') {
        if (enteredPin !== currentFirstPin) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          triggerShake();
          setError('PINs don\'t match');
          setTimeout(() => { setPin(''); setError(''); }, 400);
          setIsProcessing(false);
          return;
        }
        await PinAuthCoordinator.setPinPolicy(currentPinPolicy);
        triggerSuccessAndFinish(enteredPin);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setFirstPin(enteredPin);
      setPin('');
      setCreateStep('confirm');
      setIsProcessing(false);
      return;
    }

    // Unlock/verify mode
    if (onVerify) {
      const result = await onVerify(enteredPin);
      if (result.success) {
        PinAuthCoordinator.resetFailedAttempts().catch(() => {});
        triggerSuccessAndFinish(enteredPin, () => {
          if (isLockAnimatable) triggerUnlockAnimation();
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        triggerShake();
        setError(result.error || 'Incorrect PIN');

        const lockoutResult = await PinAuthCoordinator.recordFailedAttempt();
        // Only show reset option when locked out (must wait)
        if (lockoutResult.locked) {
          setCanResetApp(true);
          startLockoutTimer(lockoutResult.lockoutSeconds);
        }

        setTimeout(() => { setPin(''); setError(''); }, 400);
        setIsProcessing(false);
      }
    } else {
      triggerSuccessAndFinish(enteredPin, () => {
        if (isLockAnimatable) triggerUnlockAnimation();
      });
    }
  }, [isCreateMode, isLockAnimatable, onVerify, triggerShake, triggerUnlockAnimation, triggerSuccessAndFinish]);

  // ── Handlers (stable — use refs instead of pin in deps) ────

  const handleDigitPress = useCallback((digit: string) => {
    if (isProcessingRef.current || isLockedOutRef.current) return;

    const currentPin = pinRef.current;
    const policy = pinPolicyRef.current;
    const pLength = policy === 'fixed4' ? 4 : policy === 'fixed6' ? 6 : null;
    const maxLen = pLength !== null ? pLength : SECURITY.PIN_MAX_LENGTH;
    if (currentPin.length >= maxLen) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const newPin = currentPin + digit;
    setPin(newPin);
    setError('');

    // Auto-submit for fixed-length modes
    if (pLength !== null && newPin.length === pLength) {
      setTimeout(() => handlePinComplete(newPin), 50);
    }
  }, [handlePinComplete]);

  const handleDelete = useCallback(() => {
    if (isProcessingRef.current || pinRef.current.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  const handleClearAll = useCallback(() => {
    if (isProcessingRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPin('');
    setError('');
  }, []);

  const handleDonePress = useCallback(() => {
    const currentPin = pinRef.current;
    if (currentPin.length < SECURITY.PIN_MIN_LENGTH) return;
    handlePinComplete(currentPin);
  }, [handlePinComplete]);

  const handleBiometricAuth = async () => {
    if (!onBiometricSuccess) return;

    try {
      BiometricState.setActive(true);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: titleProp || 'Authenticate',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
      });
      BiometricState.setActive(false);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setBiometricFailed(false);
        const bioResult = await onBiometricSuccess();
        if (bioResult.success && bioResult.pin) {
          PinAuthCoordinator.resetFailedAttempts().catch(() => {});
          if (isLockAnimatable) triggerUnlockAnimation();
          onSuccess(bioResult.pin);
        }
      } else {
        biometricAttemptCount.current += 1;
        setBiometricFailed(true);
        setError('Face ID failed — try again or enter PIN');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err) {
      BiometricState.setActive(false);
      biometricAttemptCount.current += 1;
      setBiometricFailed(true);
      setError('Face ID failed — try again or enter PIN');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handlePolicySelect = useCallback((policy: PinPolicy) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPinPolicy(policy);
    setOptionsSheetVisible(false);
    setPin('');
    setFirstPin('');
    setError('');
    setCreateStep('enter');
  }, []);

  const handleBack = useCallback(() => {
    if (isLockedOutRef.current) return; // Cannot leave during lockout
    if (isCreateMode && createStepRef.current === 'confirm') {
      setCreateStep('enter');
      setPin('');
      setFirstPin('');
      setError('');
      return;
    }
    onCancel?.();
  }, [isCreateMode, onCancel]);

  // ── Lockout display ───────────────────────────────────────

  const formatLockout = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Render helpers ─────────────────────────────────────────

  const keypadDisabled = isProcessing || isLockedOut;

  const renderDots = () => {
    if (!isFixedLength) {
      return (
        <View style={styles.variableIndicator}>
          <Text style={[styles.maskedText, { color: themeColors.textPrimary }]}>
            {pin.length > 0 ? '\u2022'.repeat(pin.length) : ' '}
          </Text>
          <Text style={[styles.digitCounter, { color: themeColors.textMuted }]}>
            {pin.length > 0 ? `${pin.length} digits` : 'Enter at least 4 digits'}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.dotsRow}>
        {Array.from({ length: pinLength! }, (_, i) => (
          <PinDot
            key={i}
            index={i}
            filled={i < pin.length}
            hasError={!!error}
            isSuccess={isSuccess}
            emptyColor={themeColors.dotBorder}
            filledColor={themeColors.dotFilled}
          />
        ))}
      </View>
    );
  };

  const handleOpenOptions = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOptionsSheetVisible(true);
  }, []);

  const policyLabel = pinPolicy === 'fixed4' ? '4-digit' : pinPolicy === 'fixed6' ? '6-digit' : 'Custom';

  const renderOptionsSheet = () => {
    const options: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; policy: PinPolicy }[] = [
      { label: '4-digit PIN', hint: 'Quick and convenient', icon: 'flash-outline', policy: 'fixed4' },
      { label: '6-digit PIN', hint: 'Recommended for security', icon: 'shield-checkmark-outline', policy: 'fixed6' },
      { label: 'Custom length', hint: 'Set your own (4+ digits)', icon: 'keypad-outline', policy: 'variable' },
    ];

    return (
      <AppBottomSheet
        visible={optionsSheetVisible}
        onClose={() => setOptionsSheetVisible(false)}
        title="PIN Length"
        subtitle="Choose how many digits your PIN should have."
      >
        <View style={styles.optionsContent}>
          {options.map((opt) => {
            const isSelected = pinPolicy === opt.policy;
            return (
              <Pressable
                key={opt.policy}
                style={({ pressed }) => [
                  styles.optionCard,
                  { backgroundColor: themeColors.selectorBg },
                  isSelected && {
                    borderWidth: 1.5,
                    borderColor: themeColors.textPrimary,
                  },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handlePolicySelect(opt.policy)}
              >
                <View style={[styles.optionIconCircle, {
                  backgroundColor: isSelected
                    ? c.pinScreen.keypadBg
                    : c.pinScreen.iconCircleBg,
                }]}>
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={isSelected ? themeColors.textPrimary : themeColors.textMuted}
                  />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, { color: themeColors.textPrimary }]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.optionHint, { color: themeColors.textMuted }]}>
                    {opt.hint}
                  </Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={22} color={themeColors.textPrimary} />
                )}
              </Pressable>
            );
          })}
        </View>
      </AppBottomSheet>
    );
  };

  // ── Main render ────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={styles.header}>
        {showBackButton && onCancel && !isLockedOut ? (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={24} color={themeColors.backChevronColor} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        {/* Progress dots (create mode, enter/confirm) */}
        {isCreateMode && (
          <View style={styles.progressDots}>
            <View style={[styles.progressDot, { backgroundColor: themeColors.progressDotActiveBg }]} />
            <View style={[
              styles.progressDot,
              { backgroundColor: isConfirmStep ? themeColors.progressDotActiveBg : themeColors.progressDotInactive },
            ]} />
          </View>
        )}

        {/* Right side: Done button OR Forgot PIN (during lockout) */}
        {isLockedOut && canResetApp && onAppReset ? (
          <TouchableOpacity
            onPress={handleResetApp}
            style={styles.headerRightBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotPinText}>Forgot PIN?</Text>
          </TouchableOpacity>
        ) : isVariableLength && canSubmitVariable ? (
          <TouchableOpacity
            onPress={handleDonePress}
            style={styles.doneBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.doneBtnText, { color: themeColors.doneColor }]}>Done</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      {/* Top section — title, dots, error */}
      <View style={styles.topSection}>
        {/* Main content wrapper - centered and stable */}
        <View style={styles.mainContentWrapper}>
          {/* Title + Subtitle */}
          <Text style={[styles.title, { color: themeColors.textPrimary }]}>{resolvedTitle}</Text>
          {resolvedSubtitle ? (
            <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>{resolvedSubtitle}</Text>
          ) : null}

          {/* PIN Indicator */}
          <Animated.View style={[styles.indicatorContainer, shakeStyle]}>
            {renderDots()}
          </Animated.View>
        </View>

        {/* Error / Lockout - fixed height slot, always present */}
        <View style={styles.statusContainer}>
          {isLockedOut ? (
            <View style={[styles.lockoutPill, { backgroundColor: c.pinScreen.iconCircleBg }]}>
              <Text style={[styles.lockoutLabel, { color: themeColors.textSecondary }]}>
                Try again in
              </Text>
              <Text style={[styles.lockoutTimer, { color: themeColors.textPrimary }]}>
                {formatLockout(lockoutRemaining)}
              </Text>
            </View>
          ) : error ? (
            <View style={[styles.errorPill, { backgroundColor: c.pinScreen.iconCircleBg }]}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>

        {/* OPTIONS capsule — always reserve space to prevent layout shift */}
        <View style={styles.optionsCapsuleSlot}>
          {isCreateMode && showLengthSelector && createStep === 'enter' && (
            <Pressable
              style={({ pressed }) => [
                styles.optionsCapsule,
                { backgroundColor: themeColors.selectorBg },
                pressed && { opacity: 0.6 },
              ]}
              onPress={handleOpenOptions}
            >
              <Ionicons name="options-outline" size={14} color={themeColors.textSecondary} />
              <Text style={[styles.optionsCapsuleText, { color: themeColors.textSecondary }]}>
                {policyLabel}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Keypad — phone-style, bottom-aligned, full-width */}
      <View style={styles.keypad}>
        <View style={styles.keyRow}>
          <DigitButton digit="1" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="2" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="3" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
        </View>
        <View style={styles.keyRow}>
          <DigitButton digit="4" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="5" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="6" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
        </View>
        <View style={styles.keyRow}>
          <DigitButton digit="7" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="8" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <DigitButton digit="9" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
        </View>
        <View style={styles.keyRow}>
          {showBiometric ? (
            <Pressable
              style={({ pressed }) => [
                styles.keyBtn,
                pressed && { backgroundColor: themeColors.selectorBg },
              ]}
              onPress={handleBiometricAuth}
              disabled={isProcessing}
            >
              {isFaceId ? (
                <FaceIdIcon size={28} color={themeColors.keyIconColor} />
              ) : (
                <Ionicons name="finger-print" size={28} color={themeColors.keyIconColor} />
              )}
            </Pressable>
          ) : (
            <View style={styles.keyBtn} />
          )}
          <DigitButton digit="0" onPress={handleDigitPress} disabled={keypadDisabled} textColor={themeColors.keyTextColor} mutedColor={themeColors.textMuted} pressedBg={themeColors.selectorBg} />
          <Pressable
            style={({ pressed }) => [
              styles.keyBtn,
              pressed && pin.length > 0 && { backgroundColor: themeColors.selectorBg },
              (keypadDisabled || pin.length === 0) && styles.keyBtnDisabled,
            ]}
            onPress={handleDelete}
            onLongPress={handleClearAll}
            delayLongPress={500}
            disabled={keypadDisabled || pin.length === 0}
          >
            <Ionicons
              name="backspace-outline"
              size={26}
              color={pin.length === 0 ? themeColors.textMuted : themeColors.keyTextColor}
            />
          </Pressable>
        </View>
      </View>

      {/* Bottom safe area */}
      <View style={{ height: insets.bottom + 8 }} />

      {/* Options bottom sheet */}
      {renderOptionsSheet()}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    height: 52,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  doneBtnText: {
    fontSize: 17,
    fontWeight: '600',
  },
  progressDots: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Top section — title, dots, error (centered, expands to push keypad down)
  topSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // Main content wrapper - keeps title, subtitle, dots stable
  mainContentWrapper: {
    alignItems: 'center',
  },

  // Title / Subtitle
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
    marginBottom: 20,
  },

  // OPTIONS capsule — fixed-height slot prevents layout shift
  optionsCapsuleSlot: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  optionsCapsuleText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Options bottom sheet
  optionsContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  optionHint: {
    fontSize: 13,
    fontWeight: '400',
  },

  // PIN Indicator
  indicatorContainer: {
    minHeight: 40,
    justifyContent: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  dotError: {
    backgroundColor: '#FF453A',
    borderColor: '#FF453A',
  },

  // Variable-length indicator
  variableIndicator: {
    alignItems: 'center',
  },
  maskedText: {
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: 6,
    minHeight: 36,
  },
  digitCounter: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 4,
  },

  // Status (error / lockout) — fixed height to prevent layout shift
  statusContainer: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  errorPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF453A',
  },
  lockoutPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  lockoutLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  lockoutTimer: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  headerRightBtn: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  forgotPinText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FF453A',
    letterSpacing: -0.2,
  },

  // Keypad — phone-style, full-width, bottom-aligned
  keypad: {
    width: '100%',
    paddingHorizontal: 24,
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginBottom: 8,
  },
  keyBtn: {
    // Responsive: caps at 85 on large screens, scales down on smaller devices (e.g. iPhone SE)
    width: Math.min(85, (Dimensions.get('window').width - 72) / 3),
    height: Math.min(85, (Dimensions.get('window').width - 72) / 3),
    borderRadius: Math.min(85, (Dimensions.get('window').width - 72) / 3) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBtnPressed: {
    opacity: 0.4,
  },
  keyBtnDisabled: {
    opacity: 0.3,
  },
  keyBtnText: {
    fontSize: 30,
    fontWeight: '300',
    letterSpacing: 0,
  },
  keyBtnLetters: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    marginTop: 1,
  },
});
