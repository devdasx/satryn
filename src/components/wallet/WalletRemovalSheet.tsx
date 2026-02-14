/**
 * WalletRemovalSheet — Premium step-based wallet removal flow
 *
 * Flow:
 *   1. User sees confirmation screen with wallet info + "Remove" button
 *   2. Face ID / PIN auth (auto-triggered after user taps Remove)
 *      – biometric prompt, or navigates to full-screen PIN
 *   3. Balance confirmation (only if wallet has funds — type sats amount)
 *      – or badge prompt for zero-balance wallets
 *   4. Removing wallet data (with timeout safety)
 *   5. Complete (with stay/reset for last wallet)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  cancelAnimation,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme, useHaptics } from '../../hooks';
import { SecureStorage } from '../../services/storage/SecureStorage';
import { WalletFileService } from '../../services/storage/WalletFileService';
import { WalletDatabase } from '../../services/database/WalletDatabase';
import { useWalletStore, useMultiWalletStore } from '../../stores';
import type { WalletInfo } from '../../stores/multiWalletStore';

// ─── Types ──────────────────────────────────────────────────────

interface WalletRemovalSheetProps {
  visible: boolean;
  onClose: () => void;
  wallet: WalletInfo | null;
  isLastWallet: boolean;
  onRemoved: (action: 'stay' | 'reset') => void;
  /** Called when PIN auth is needed — parent navigates to PIN screen */
  onNavigateToPin?: () => void;
  /** Set to true when user returns from PIN screen with verified PIN */
  pinVerified?: boolean;
}

type RemovalStep = 'waiting' | 'auth' | 'confirm' | 'removing' | 'complete' | 'last_wallet_choice';
type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

// ─── Constants ──────────────────────────────────────────────────

const AVATAR_STORAGE_KEY = 'wallet_avatar';
const REMOVAL_TIMEOUT_MS = 15000;

// ─── Animated Icon ──────────────────────────────────────────────

function SheetIcon({
  isDark,
  step,
  failed,
}: {
  isDark: boolean;
  step: RemovalStep;
  failed: boolean;
}) {
  const glowOpacity = useSharedValue(0.3);
  const scaleValue = useSharedValue(1);
  const rotateValue = useSharedValue(0);

  const isComplete = step === 'complete' || step === 'last_wallet_choice';

  useEffect(() => {
    if (isComplete) {
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
    } else if (step === 'removing') {
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
    } else {
      cancelAnimation(glowOpacity);
      cancelAnimation(rotateValue);
      glowOpacity.value = 0.3;
      rotateValue.value = 0;
    }
  }, [step, failed, isComplete]);

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const animatedScale = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }, { rotate: `${rotateValue.value}deg` }],
  }));

  const accentColor = failed ? '#FF453A' : isComplete ? '#30D158' : '#FF453A';

  return (
    <Animated.View style={[iconStyles.container, animatedScale]}>
      <Animated.View style={[iconStyles.glowRing, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}08` : `${accentColor}06`,
        borderColor: `${accentColor}15`,
      }]} />
      <Animated.View style={[iconStyles.glowCircle, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}15` : `${accentColor}10`,
      }]} />
      <View style={[iconStyles.iconCircle, {
        backgroundColor: isDark ? `${accentColor}20` : `${accentColor}14`,
      }]}>
        <Ionicons
          name={failed ? 'alert-circle' : isComplete ? 'checkmark-circle' : 'trash-outline'}
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

// ─── Step Row ───────────────────────────────────────────────────

function StepRow({
  label,
  status,
  isDark,
  hint,
  isLast = false,
}: {
  label: string;
  status: StepStatus;
  isDark: boolean;
  hint?: string;
  isLast?: boolean;
}) {
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = 1;
    }
    return () => cancelAnimation(pulseOpacity);
  }, [status]);

  const animatedPulse = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const stepColor =
    status === 'completed' ? '#30D158'
    : status === 'failed' ? '#FF453A'
    : status === 'active' ? '#FF9F0A'
    : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');

  const circleBg =
    status === 'completed' ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
    : status === 'failed' ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
    : status === 'active' ? (isDark ? 'rgba(255,159,10,0.15)' : 'rgba(255,159,10,0.10)')
    : 'transparent';

  const labelColor =
    status === 'completed' ? (isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.80)')
    : status === 'failed' ? '#FF453A'
    : status === 'active' ? (isDark ? '#FFFFFF' : '#000000')
    : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)');

  return (
    <View style={styles.stepRow}>
      <Animated.View
        style={[
          styles.stepCircle,
          { backgroundColor: circleBg, borderColor: stepColor },
          status === 'active' && animatedPulse,
        ]}
      >
        {status === 'completed' ? (
          <Ionicons name="checkmark" size={15} color="#30D158" />
        ) : status === 'failed' ? (
          <Ionicons name="close" size={15} color="#FF453A" />
        ) : status === 'active' ? (
          <ActivityIndicator size={14} color="#FF9F0A" />
        ) : (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }} />
        )}
      </Animated.View>

      {!isLast && (
        <View style={[styles.connectorLine, {
          backgroundColor: status === 'completed'
            ? (isDark ? 'rgba(48,209,88,0.25)' : 'rgba(48,209,88,0.20)')
            : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
        }]} />
      )}

      <View style={styles.stepContent}>
        <Text style={[styles.stepLabel, { color: labelColor }]}>{label}</Text>
        {status === 'active' && hint && (
          <Text style={[styles.stepHint, {
            color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)',
          }]}>
            {hint}
          </Text>
        )}
        {status === 'completed' && (
          <Text style={[styles.stepHint, { color: 'rgba(48,209,88,0.60)' }]}>Done</Text>
        )}
      </View>

      {status === 'active' && (
        <ActivityIndicator size="small" color="#FF9F0A" style={{ marginLeft: 8 }} />
      )}
      {status === 'completed' && (
        <Ionicons name="checkmark-circle" size={18} color="rgba(48,209,88,0.50)" />
      )}
    </View>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function WalletRemovalSheet({
  visible,
  onClose,
  wallet,
  isLastWallet,
  onRemoved,
  onNavigateToPin,
  pinVerified,
}: WalletRemovalSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [step, setStep] = useState<RemovalStep>('waiting');
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(['pending', 'pending', 'pending', 'pending']);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceError, setBalanceError] = useState(false);
  const [authMethod, setAuthMethod] = useState<'biometric' | 'pin' | 'none'>('none');
  const [authDetected, setAuthDetected] = useState(false);
  const [awaitingPinReturn, setAwaitingPinReturn] = useState(false);
  const [switchedToWallet, setSwitchedToWallet] = useState<WalletInfo | null>(null);

  const isRunning = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const removalTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Capture wallet data in a ref so it survives the parent re-render when
  // removeWallet() causes activeWallet to become null mid-removal.
  const walletRef = useRef<WalletInfo | null>(wallet);
  // Track which wallet ID is currently being removed so we can distinguish
  // "same wallet in progress" from "new wallet removal requested".
  const removingWalletId = useRef<string | null>(null);

  // Keep ref updated when wallet changes (but not when it becomes null during removal)
  useEffect(() => {
    if (wallet) walletRef.current = wallet;
  }, [wallet]);

  const hasBalance = (wallet?.balanceSat ?? 0) > 0;
  const walletBalance = wallet?.balanceSat ?? 0;

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  // Reset state when sheet closes — ensures fresh state for next wallet removal
  useEffect(() => {
    if (!visible) {
      // Delay reset slightly so closing animation completes before state clears
      const timer = setTimeout(() => {
        setStep('waiting');
        setStepStatuses(['pending', 'pending', 'pending', 'pending']);
        setFailed(false);
        setErrorMessage(null);
        setBalanceInput('');
        setBalanceError(false);
        setAuthMethod('none');
        setAuthDetected(false);
        setAwaitingPinReturn(false);
        setSwitchedToWallet(null);
        isRunning.current = false;
        removingWalletId.current = null;
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Reset state when sheet opens — but skip reset if returning from PIN verification
  // or if removal is already in progress / completed (wallet.id changes when the next
  // wallet auto-activates after removing the current one).
  useEffect(() => {
    if (visible && wallet) {
      if (pinVerified) {
        // Returning from PIN screen — skip reset, proceed with auth completed
        setStep('auth');
        setStepStatuses(['completed', 'pending', 'pending', 'pending']);
        setFailed(false);
        setErrorMessage(null);
        setAuthDetected(true);
        setAwaitingPinReturn(false);
        // Small delay for sheet to render, then proceed
        setTimeout(() => {
          proceedAfterAuth();
        }, 400);
        return;
      }

      // Don't reset if removal is in progress or completed —
      // wallet.id changes when the next wallet auto-activates after removeWallet(),
      // but we need to keep showing the completion state, not restart for the new wallet.
      if (step === 'removing' || step === 'complete' || step === 'last_wallet_choice') {
        return;
      }

      removingWalletId.current = wallet.id;
      setStep('waiting');
      setStepStatuses(['pending', 'pending', 'pending', 'pending']);
      setFailed(false);
      setErrorMessage(null);
      setBalanceInput('');
      setBalanceError(false);
      setAuthMethod('none');
      setAuthDetected(false);
      setAwaitingPinReturn(false);
      setSwitchedToWallet(null);
      isRunning.current = false;

      // Detect auth method
      (async () => {
        try {
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = await LocalAuthentication.isEnrolledAsync();

          let hasBiometricPin: string | null = null;
          if (hasHardware && isEnrolled) {
            hasBiometricPin = await SecureStorage.hasBiometricPin() ? 'yes' : null;
          }

          if (hasHardware && isEnrolled && hasBiometricPin) {
            setAuthMethod('biometric');
          } else {
            const pinExists = await SecureStorage.hasPinSet();
            const method = pinExists ? 'pin' : 'none';
            setAuthMethod(method);
          }
        } catch (e) {
          try {
            const pinExists = await SecureStorage.hasPinSet();
            setAuthMethod(pinExists ? 'pin' : 'none');
          } catch {
            setAuthMethod('none');
          }
        } finally {
          setAuthDetected(true);
        }
      })();
    }

    return () => {
      if (removalTimeout.current) {
        clearTimeout(removalTimeout.current);
        removalTimeout.current = null;
      }
    };
  }, [visible, wallet?.id, pinVerified]);

  // ── User taps "Remove Wallet" → start auth ──
  // Always require re-authentication for destructive wallet removal
  const handleStartRemoval = useCallback(async () => {
    if (!wallet) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('auth');
    updateStep(0, 'active');

    if (authMethod === 'biometric') {
      setTimeout(() => startBiometricAuth(), 200);
    } else if (authMethod === 'pin') {
      setAwaitingPinReturn(true);
      if (onNavigateToPin) {
        onNavigateToPin();
      } else {
      }
    } else {
      updateStep(0, 'completed');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      proceedAfterAuth();
    }
  }, [wallet, authMethod, authDetected, onNavigateToPin]);

  // ── Biometric auth ──
  const startBiometricAuth = useCallback(async () => {
    if (!wallet) return;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to remove wallet',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
      });

      if (result.success) {
        updateStep(0, 'completed');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        proceedAfterAuth();
        return;
      }

      // Cancelled or failed — fall back to PIN screen
      const pinExists = await SecureStorage.hasPinSet();
      if (pinExists && onNavigateToPin) {
        setAuthMethod('pin');
        setAwaitingPinReturn(true);
        onNavigateToPin();
      } else {
        setStep('waiting');
        setStepStatuses(['pending', 'pending', 'pending', 'pending']);
      }
    } catch (error) {
      const pinExists = await SecureStorage.hasPinSet();
      if (pinExists && onNavigateToPin) {
        setAuthMethod('pin');
        setAwaitingPinReturn(true);
        onNavigateToPin();
      } else {
        updateStep(0, 'failed');
        setFailed(true);
        setErrorMessage('Authentication failed. Please try again.');
        haptics.trigger('error');
      }
    }
  }, [wallet, haptics, onNavigateToPin]);

  // After auth succeeds
  const proceedAfterAuth = useCallback(() => {
    setStep('confirm');
    updateStep(1, 'active');
    if (hasBalance) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [hasBalance]);

  const updateStep = (index: number, status: StepStatus) => {
    setStepStatuses(prev => {
      const next = [...prev];
      next[index] = status;
      // When completing a step, ensure all prior steps are also completed
      // (guards against race conditions where a prior step's update was lost)
      if (status === 'completed') {
        for (let i = 0; i < index; i++) {
          if (next[i] !== 'completed') next[i] = 'completed';
        }
      }
      return next;
    });
  };

  // ── Step 3: Execute removal with timeout ──
  const executeRemoval = useCallback(async () => {
    // Use the ref so we have stable wallet data even after store removal
    const w = walletRef.current;
    if (!w || isRunning.current) {
      return;
    }
    isRunning.current = true;

    // Safety timeout — if removal hangs, force-complete
    removalTimeout.current = setTimeout(() => {
      if (isRunning.current) {
        isRunning.current = false;
        updateStep(2, 'completed');
        // Always clear stale wallet data on timeout too
        useWalletStore.setState({
          walletId: null,
          balance: { confirmed: 0, unconfirmed: 0, total: 0 },
          transactions: [],
          addresses: [],
          utxos: [],
        });
        if (isLastWallet) {
          setStep('last_wallet_choice');
          updateStep(3, 'completed');
        } else {
          setStep('complete');
          updateStep(3, 'completed');
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }, REMOVAL_TIMEOUT_MS);

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      // Delete wallet data — each wrapped in try/catch
      try { await SecureStorage.deleteWalletData(w.id); } catch (e) {
      }
      try { await AsyncStorage.removeItem(`wallet_cache_${w.id}`); } catch {}
      try { await AsyncStorage.removeItem(`${AVATAR_STORAGE_KEY}_${w.id}`); } catch {}
      try { await WalletFileService.delete(w.id); } catch {}
      try { WalletDatabase.shared().deleteWallet(w.id); } catch (e) {
      }

      // Remove from multi-wallet store
      try {
        const { removeWallet } = useMultiWalletStore.getState();
        await removeWallet(w.id);
      } catch (e) {
      }

      // UX delay
      await new Promise(resolve => setTimeout(resolve, 400));

      // Clear timeout
      if (removalTimeout.current) {
        clearTimeout(removalTimeout.current);
        removalTimeout.current = null;
      }

      if (!isRunning.current) {
        return;
      }

      updateStep(2, 'completed');

      // Always clear stale wallet data from Zustand immediately after deletion.
      // This ensures the UI never shows balance/transactions from the deleted wallet.
      useWalletStore.setState({
        walletId: null,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        transactions: [],
        addresses: [],
        utxos: [],
      });

      if (isLastWallet) {
        setStep('last_wallet_choice');
        updateStep(3, 'completed');
      } else {
        let nextWallet: WalletInfo | null = null;
        try {
          const remainingWallets = useMultiWalletStore.getState().wallets;
          if (remainingWallets.length > 0) {
            nextWallet = remainingWallets[0];
            const pin = await SecureStorage.getPinForBiometrics();
            if (pin) {
              const { switchToWallet } = useWalletStore.getState();
              await switchToWallet(remainingWallets[0].id, pin);
            }
          }
        } catch (e) {
        }
        setSwitchedToWallet(nextWallet);
        setStep('complete');
        updateStep(3, 'completed');
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (removalTimeout.current) {
        clearTimeout(removalTimeout.current);
        removalTimeout.current = null;
      }
      updateStep(2, 'failed');
      setFailed(true);
      setErrorMessage('Failed to remove wallet. Please try again.');
      haptics.trigger('error');
    } finally {
      isRunning.current = false;
    }
  }, [isLastWallet, haptics]);

  // ── Step 2: Confirmation ──
  const handleConfirmRemoval = useCallback(() => {
    if (!wallet) return;

    if (hasBalance) {
      Keyboard.dismiss();
      const inputSats = parseInt(balanceInput.replace(/,/g, '').trim(), 10);

      if (isNaN(inputSats) || inputSats !== walletBalance) {
        setBalanceError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => setBalanceError(false), 1500);
        return;
      }
    }

    updateStep(1, 'completed');
    setStep('removing');
    updateStep(2, 'active');
    executeRemoval();
  }, [wallet, balanceInput, walletBalance, hasBalance, executeRemoval]);

  const handleRetry = () => {
    setStep('waiting');
    setStepStatuses(['pending', 'pending', 'pending', 'pending']);
    setFailed(false);
    setErrorMessage(null);
    setBalanceInput('');
    setBalanceError(false);
    setAwaitingPinReturn(false);
    setSwitchedToWallet(null);
    isRunning.current = false;
  };

  // Use the ref wallet if the prop becomes null mid-removal (parent re-renders
  // with activeWallet=undefined after removeWallet() updates the store).
  const displayWallet = wallet || walletRef.current;
  if (!displayWallet) return null;

  const isWatchOnly = displayWallet.type.startsWith('watch_');
  const walletTypeName = isWatchOnly ? 'Watch-Only' : displayWallet.type === 'multisig' ? 'Multisig' : 'Wallet';

  const getTitle = () => {
    if (step === 'last_wallet_choice') return 'Wallet Removed';
    if (step === 'complete') return 'Wallet Removed';
    if (failed) return 'Removal Failed';
    return 'Remove Wallet';
  };

  const getSubtitle = () => {
    if (step === 'last_wallet_choice') return 'This was your last wallet. What would you like to do?';
    if (step === 'complete') return switchedToWallet
      ? `"${displayWallet.name}" has been removed. You've been switched to another wallet.`
      : `"${displayWallet.name}" has been removed successfully.`;
    if (failed) return 'Something went wrong during the removal process.';
    if (step === 'confirm' && hasBalance) return 'Confirm wallet balance to proceed with removal.';
    if (step === 'confirm') return 'Are you sure you want to remove this wallet?';
    if (step === 'removing') return 'Removing wallet data from this device...';
    return 'Are you sure you want to remove this wallet?';
  };

  const isComplete = step === 'complete' || step === 'last_wallet_choice';
  const showSteps = step !== 'waiting';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing={['auto', 'large']}
      scrollable
      dismissible={isComplete || failed || step === 'waiting' || step === 'confirm'}
      contentKey={step}
    >
      <View style={styles.container}>
        <SheetIcon isDark={isDark} step={step} failed={failed} />

        <Text style={[styles.title, { color: colors.text }]}>{getTitle()}</Text>
        <Text style={[styles.subtitle, {
          color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
        }]}>
          {getSubtitle()}
        </Text>

        {/* Waiting — wallet info + remove button */}
        {step === 'waiting' && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.walletInfoCard, { backgroundColor: surfaceBg }]}>
              <View style={[styles.walletInfoIcon, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}>
                <Ionicons
                  name={isWatchOnly ? 'eye-outline' : 'wallet-outline'}
                  size={20}
                  color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.walletInfoName, { color: colors.text }]} numberOfLines={1}>
                  {displayWallet.name}
                </Text>
                <Text style={[styles.walletInfoType, {
                  color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
                }]}>
                  {walletTypeName}{hasBalance ? ` · ${walletBalance.toLocaleString()} sats` : ' · No funds'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleStartRemoval}
              activeOpacity={0.7}
              style={[styles.dangerButton, !authDetected && { opacity: 0.5 }]}
              disabled={!authDetected}
            >
              <Ionicons name="trash-outline" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.dangerButtonText}>Remove Wallet</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.secondaryButton}>
              <Text style={[styles.secondaryButtonText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              }]}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Steps Card */}
        {showSteps && (
          <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
            <StepRow
              label="Verify identity"
              status={stepStatuses[0]}
              isDark={isDark}
              hint={authMethod === 'biometric' ? 'Face ID or Touch ID' : 'Verifying...'}
            />
            <StepRow
              label={hasBalance ? 'Confirm balance' : 'Confirm removal'}
              status={stepStatuses[1]}
              isDark={isDark}
              hint={hasBalance ? `Enter ${walletBalance.toLocaleString()} sats to confirm` : 'Press remove to continue'}
            />
            <StepRow
              label="Removing wallet data"
              status={stepStatuses[2]}
              isDark={isDark}
              hint="Deleting keys and transaction data"
            />
            <StepRow label="Complete" status={stepStatuses[3]} isDark={isDark} isLast />
          </View>
        )}

        {/* Auth in progress (biometric or navigated to PIN) */}
        {step === 'auth' && (
          <Animated.View entering={FadeInDown.duration(300)}>
            {awaitingPinReturn && (
              <View style={[styles.confirmBadge, {
                backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
                borderColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
              }]}>
                <Ionicons name="lock-closed" size={18} color="#FF9F0A" />
                <Text style={[styles.confirmBadgeText, {
                  color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)',
                }]}>
                  Verify your PIN to continue with wallet removal.
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                setStep('waiting');
                setStepStatuses(['pending', 'pending', 'pending', 'pending']);
                setAwaitingPinReturn(false);
              }}
              activeOpacity={0.7}
              style={styles.secondaryButton}
            >
              <Text style={[styles.secondaryButtonText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              }]}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Balance confirmation (wallet has funds) */}
        {step === 'confirm' && hasBalance && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.balanceCard, {
              backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
              borderColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
            }]}>
              <View style={[styles.balanceIconCircle, {
                backgroundColor: isDark ? 'rgba(255,159,10,0.15)' : 'rgba(255,159,10,0.10)',
              }]}>
                <Ionicons name="warning" size={16} color="#FF9F0A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.balanceWarningTitle, { color: colors.text }]}>This wallet has funds</Text>
                <Text style={[styles.balanceAmount, { color: '#FF9F0A' }]}>
                  {walletBalance.toLocaleString()} sats
                </Text>
              </View>
            </View>

            <PremiumInputCard>
              <PremiumInput
                ref={inputRef}
                icon="wallet-outline"
                iconColor="#FF9F0A"
                value={balanceInput}
                onChangeText={setBalanceInput}
                placeholder="Enter balance in sats to confirm"
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleConfirmRemoval}
                error={balanceError}
                centered
              />
            </PremiumInputCard>
            {balanceError && (
              <Text style={styles.balanceErrorText}>
                Amount doesn't match. Enter exactly {walletBalance.toLocaleString()} sats.
              </Text>
            )}

            <TouchableOpacity
              onPress={handleConfirmRemoval}
              activeOpacity={0.7}
              style={[styles.dangerButton, { opacity: balanceInput.trim().length === 0 ? 0.4 : 1 }]}
              disabled={balanceInput.trim().length === 0}
            >
              <Ionicons name="trash-outline" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.dangerButtonText}>Confirm Removal</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Simple confirm (no balance) — badge prompt */}
        {step === 'confirm' && !hasBalance && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.confirmBadge, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.05)',
              borderColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
            }]}>
              <Ionicons name="information-circle" size={18} color="#FF453A" />
              <Text style={[styles.confirmBadgeText, {
                color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)',
              }]}>
                Press the button below to confirm wallet removal. This action cannot be undone.
              </Text>
            </View>

            <TouchableOpacity onPress={handleConfirmRemoval} activeOpacity={0.7} style={styles.dangerButton}>
              <Ionicons name="trash-outline" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.dangerButtonText}>Yes, Remove Wallet</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setStep('waiting');
                setStepStatuses(['pending', 'pending', 'pending', 'pending']);
              }}
              activeOpacity={0.7}
              style={styles.secondaryButton}
            >
              <Text style={[styles.secondaryButtonText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              }]}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Last wallet choice */}
        {step === 'last_wallet_choice' && (
          <Animated.View entering={FadeInDown.duration(300).delay(100)}>
            <TouchableOpacity
              onPress={() => onRemoved('stay')}
              activeOpacity={0.7}
              style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
            >
              <Ionicons name="home-outline" size={17} color={isDark ? '#000000' : '#FFFFFF'} style={{ marginRight: 6 }} />
              <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Stay in App</Text>
            </TouchableOpacity>
            <Text style={[styles.choiceHint, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>
              Keep your settings and add a new wallet later
            </Text>

            <TouchableOpacity onPress={() => onRemoved('reset')} activeOpacity={0.7} style={[styles.dangerButton, { marginTop: 8 }]}>
              <Ionicons name="refresh" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.dangerButtonText}>Reset All Data</Text>
            </TouchableOpacity>
            <Text style={[styles.choiceHint, { color: isDark ? 'rgba(255,69,58,0.50)' : 'rgba(255,69,58,0.60)' }]}>
              Clear everything and start fresh from onboarding
            </Text>
          </Animated.View>
        )}

        {/* Success — show switched wallet info */}
        {step === 'complete' && (
          <Animated.View entering={FadeInDown.duration(300).delay(200)}>
            {switchedToWallet && (
              <View style={[styles.switchedWalletCard, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.04)',
                borderColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
              }]}>
                <View style={[styles.switchedWalletIcon, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.10)',
                }]}>
                  <Ionicons
                    name={switchedToWallet.type.startsWith('watch_') ? 'eye-outline' : 'wallet-outline'}
                    size={18}
                    color="#30D158"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switchedWalletLabel, {
                    color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
                  }]}>
                    Now active
                  </Text>
                  <Text style={[styles.switchedWalletName, { color: colors.text }]} numberOfLines={1}>
                    {switchedToWallet.name}
                  </Text>
                </View>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color="#30D158"
                />
              </View>
            )}

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
            >
              <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Done</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Failed */}
        {failed && (
          <View style={styles.buttonGroup}>
            {errorMessage && (
              <Animated.View entering={FadeInDown.duration(300)} style={[styles.errorCard, {
                backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
              }]}>
                <View style={[styles.errorIconCircle, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
                }]}>
                  <Ionicons name="alert-circle" size={16} color="#FF453A" />
                </View>
                <Text style={[styles.errorText, { color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A' }]}>
                  {errorMessage}
                </Text>
              </Animated.View>
            )}
            <TouchableOpacity
              onPress={handleRetry}
              activeOpacity={0.7}
              style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
            >
              <Ionicons name="refresh" size={17} color={isDark ? '#000000' : '#FFFFFF'} style={{ marginRight: 6 }} />
              <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.secondaryButton}>
              <Text style={[styles.secondaryButtonText, {
                color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* In-progress footnote */}
        {step === 'removing' && (
          <Text style={[styles.footnote, {
            color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
          }]}>
            Removing keys and encrypted data from this device...
          </Text>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 32 },

  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, fontWeight: '400', textAlign: 'center', marginBottom: 20, lineHeight: 20 },

  walletInfoCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 16, gap: 12 },
  walletInfoIcon: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  walletInfoName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  walletInfoType: { fontSize: 13, fontWeight: '400' },

  stepsCard: { borderRadius: 20, marginBottom: 16, overflow: 'hidden' },

  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
  stepCircle: { width: 34, height: 34, borderRadius: 11, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  connectorLine: { position: 'absolute', left: 34, top: 48, width: 2, height: 14, borderRadius: 1 },
  stepContent: { flex: 1 },
  stepLabel: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  stepHint: { fontSize: 12, fontWeight: '400', marginTop: 2 },

  confirmBadge: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16, gap: 10 },
  confirmBadgeText: { fontSize: 13, fontWeight: '400', lineHeight: 19, flex: 1 },

  balanceCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 12, gap: 12 },
  balanceIconCircle: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  balanceWarningTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  balanceAmount: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // (Balance TextInput styles removed — using PremiumInput)
  balanceErrorText: { fontSize: 12, fontWeight: '500', color: '#FF453A', marginBottom: 12, paddingLeft: 4 },

  primaryButton: { height: 50, borderRadius: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 16, fontWeight: '600' },
  dangerButton: { height: 50, borderRadius: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF453A' },
  dangerButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  buttonGroup: { gap: 8 },
  secondaryButton: { height: 45, justifyContent: 'center', alignItems: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '500' },

  errorCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 12, gap: 12 },
  errorIconCircle: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 14, fontWeight: '500', flex: 1, lineHeight: 20 },

  switchedWalletCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16, gap: 12 },
  switchedWalletIcon: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  switchedWalletLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  switchedWalletName: { fontSize: 15, fontWeight: '600' },

  choiceHint: { fontSize: 12, fontWeight: '400', textAlign: 'center', marginTop: 6, marginBottom: 8, lineHeight: 17 },
  footnote: { fontSize: 12, fontWeight: '400', textAlign: 'center', lineHeight: 17, marginTop: 4, paddingHorizontal: 8 },
});
