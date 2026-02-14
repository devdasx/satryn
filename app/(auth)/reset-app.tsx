import '../../shim';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Platform,
  UIManager,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  interpolate,
  useDerivedValue,
  FadeInDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useWalletStore, useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { usePriceStore } from '../../src/stores/priceStore';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { PinAuthCoordinator } from '../../src/services/auth/PinAuthCoordinator';
import { PinCodeScreen } from '../../src/components/security/PinCodeScreen';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useTheme, useKeyboardHeight } from '../../src/hooks';
import { formatUnitAmount } from '../../src/utils/formatting';
import { PriceAPI } from '../../src/services/api/PriceAPI';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ResetStep = 'warning' | 'confirm';

// ============================================
// ANIMATED CHECKBOX COMPONENT
// ============================================

function AnimatedCheckbox({
  checked,
  color,
  borderColor,
}: {
  checked: boolean;
  color: string;
  borderColor: string;
}) {
  const scale = useSharedValue(checked ? 1 : 0);

  React.useEffect(() => {
    scale.value = withSpring(checked ? 1 : 0, {
      damping: 12,
      stiffness: 200,
      mass: 0.8,
    });
  }, [checked]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: scale.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(scale.value, [0, 0.5, 1], [0, 0.3, 1]) }],
    opacity: interpolate(scale.value, [0, 0.5, 1], [0, 0, 1]),
  }));

  return (
    <View style={[styles.checkbox, { borderColor }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: color, borderRadius: 12 },
          fillStyle,
        ]}
      />
      <Animated.View style={checkStyle}>
        <Ionicons name="checkmark" size={15} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ResetAppScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors, themeMode } = useTheme();

  const deleteWallet = useWalletStore(s => s.deleteWallet);
  const { wallets } = useMultiWalletStore();
  const denomination = useSettingsStore(s => s.denomination);
  const currency = useSettingsStore(s => s.currency);
  const price = usePriceStore(s => s.price);

  // Keyboard handling
  const { keyboardHeight } = useKeyboardHeight();
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Flow state — 2 steps: warning → confirm
  const [step, setStep] = useState<ResetStep>('warning');
  const [checks, setChecks] = useState([false, false, false]);
  const [confirmText, setConfirmText] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Countdown timer for final button (3 seconds)
  const [countdown, setCountdown] = useState(0);
  const [countdownActive, setCountdownActive] = useState(false);

  const allChecked = checks.every(Boolean);
  const confirmValid = confirmText === 'RESET';
  const canProceedWarning = true; // Step 1 always allows continue
  const canProceedConfirm = allChecked && confirmValid && countdown === 0;

  // Compute total balance across all wallets
  const totalBalanceSat = wallets.reduce((sum, w) => sum + w.balanceSat, 0);
  const walletCount = wallets.length;
  const fiatTotal = price ? (totalBalanceSat / 100_000_000) * price : null;

  // Danger colors (consistent across the app)
  const danger = '#FF453A';
  const dangerSoft = isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)';
  const dangerSofter = isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,69,58,0.04)';
  const dangerMuted = isDark ? 'rgba(255,69,58,0.7)' : 'rgba(255,69,58,0.6)';

  // ============================================
  // COUNTDOWN TIMER
  // ============================================

  useEffect(() => {
    if (!countdownActive || countdown <= 0) return;
    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdownActive, countdown]);

  // ============================================
  // ANIMATED STYLES
  // ============================================

  const bottomInset = Math.max(insets.bottom, 16);

  const keyboardOffset = useDerivedValue(() => {
    if (keyboardHeight.value > 0) {
      return keyboardHeight.value - insets.bottom + 10;
    }
    return 0;
  }, [insets.bottom]);

  const animatedBottomStyle = useAnimatedStyle(() => {
    return {
      paddingBottom: bottomInset,
      transform: [{ translateY: -keyboardOffset.value }],
    };
  }, [bottomInset]);

  // ============================================
  // HANDLERS
  // ============================================

  const toggleCheck = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecks(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const handlePinVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    return { success: true };
  }, []);

  const handlePinSuccess = useCallback(async (pin: string) => {
    setShowPinModal(false);
    setIsResetting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    await deleteWallet({ pin });
    router.replace('/(onboarding)');
  }, [deleteWallet, router]);

  const handleContinue = useCallback(() => {
    Keyboard.dismiss();

    if (step === 'warning') {
      // Medium haptic for step transition
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStep('confirm');
      // Start countdown when entering confirm step
      setCountdown(3);
      setCountdownActive(true);
    } else if (step === 'confirm' && canProceedConfirm) {
      // Heavy haptic for final action
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setShowPinModal(true);
    }
  }, [step, canProceedConfirm]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();

    if (step === 'confirm') {
      setStep('warning');
      setConfirmText('');
      setCountdown(0);
      setCountdownActive(false);
    } else {
      router.back();
    }
  }, [step, router]);

  // ============================================
  // DATA
  // ============================================

  const acknowledgements = [
    {
      icon: 'trash-outline' as const,
      title: 'Permanent deletion',
      text: 'All wallets, contacts, settings, and data will be permanently erased',
    },
    {
      icon: 'shield-checkmark-outline' as const,
      title: 'Backup confirmed',
      text: 'I have backed up my recovery phrase(s) and can restore my wallets',
    },
    {
      icon: 'alert-circle-outline' as const,
      title: 'Irreversible action',
      text: 'This cannot be undone — my funds will be lost forever without a backup',
    },
  ];

  const lossItems = [
    { icon: 'wallet-outline' as const, label: 'Wallets & seed phrases' },
    { icon: 'people-outline' as const, label: 'Contacts & address book' },
    { icon: 'settings-outline' as const, label: 'App settings & preferences' },
    { icon: 'pricetag-outline' as const, label: 'Transaction labels & notes' },
    { icon: 'server-outline' as const, label: 'Custom Electrum servers' },
    { icon: 'key-outline' as const, label: 'PIN & security data' },
  ];

  // ============================================
  // RENDER
  // ============================================

  const buttonLabel = step === 'confirm'
    ? (countdown > 0 ? `Wait ${countdown}s` : 'Reset App')
    : 'Continue';
  const canProceed = step === 'warning' ? canProceedWarning : canProceedConfirm;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — simple back chevron, no progress dots */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={handleBack}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.backButton} />
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: 140 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ========== STEP 1: WARNING ========== */}
        {step === 'warning' && (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.stepContent}>
            {/* Hero icon with glow */}
            <View style={styles.heroIconWrapper}>
              <View style={[
                styles.heroIcon,
                { backgroundColor: dangerSoft },
                Platform.OS === 'ios' && {
                  shadowColor: danger,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 16,
                  shadowOpacity: 0.2,
                },
              ]}>
                <Ionicons name="warning" size={40} color={danger} />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>Reset App</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              This will permanently erase all data from this device. Your funds will be lost forever without a backup.
            </Text>

            {/* Wallet count + balance being erased */}
            {walletCount > 0 && (
              <Animated.View entering={FadeInDown.duration(250).delay(100)}>
                <View style={[styles.balanceBanner, { backgroundColor: dangerSoft, borderColor: isDark ? 'rgba(255,69,58,0.20)' : 'rgba(255,69,58,0.15)' }]}>
                  <Ionicons name="wallet" size={18} color={danger} />
                  <Text style={[styles.balanceBannerText, { color: colors.text }]}>
                    {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
                    {fiatTotal !== null && ` · ${PriceAPI.formatPrice(fiatTotal, currency || 'USD')}`}
                    {fiatTotal === null && totalBalanceSat > 0 && ` · ${formatUnitAmount(totalBalanceSat, denomination)}`}
                  </Text>
                  <Text style={[styles.balanceBannerLabel, { color: dangerMuted }]}>will be erased</Text>
                </View>
              </Animated.View>
            )}

            {/* What will be erased */}
            <View style={[styles.settingsCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
              <Text style={[styles.lossCardHeader, { color: colors.textMuted }]}>
                WHAT WILL BE ERASED
              </Text>
              <View style={styles.lossGrid}>
                {lossItems.map((item, i) => (
                  <View key={i} style={styles.lossItem}>
                    <View style={[styles.lossIconCircle, { backgroundColor: dangerSofter }]}>
                      <Ionicons name={item.icon} size={16} color={danger} />
                    </View>
                    <Text style={[styles.lossText, { color: colors.text }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

          </Animated.View>
        )}

        {/* ========== STEP 2: CONFIRM (merged checkboxes + type RESET) ========== */}
        {step === 'confirm' && (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.stepContent}>
            <Text style={[styles.title, { color: colors.text }]}>Confirm Reset</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary, marginBottom: 24 }]}>
              Acknowledge each item and type{' '}
              <Text style={{ fontWeight: '800', color: danger, fontSize: 17, letterSpacing: 2 }}>
                RESET
              </Text>
              {' '}to proceed
            </Text>

            {/* Acknowledgement checkboxes */}
            <View style={styles.checkList}>
              {acknowledgements.map((item, i) => (
                <Animated.View key={i} entering={FadeInDown.duration(250).delay(i * 80)}>
                  <Pressable
                    style={[
                      styles.checkCard,
                      {
                        backgroundColor: checks[i] ? dangerSoft : (isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF'),
                        borderColor: checks[i] ? danger : colors.borderLight,
                      },
                    ]}
                    onPress={() => toggleCheck(i)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: checks[i] }}
                    accessibilityLabel={item.text}
                  >
                    <View style={[styles.checkIconCircle, { backgroundColor: dangerSofter }]}>
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={checks[i] ? danger : dangerMuted}
                      />
                    </View>
                    <View style={styles.checkContent}>
                      <Text style={[styles.checkTitle, { color: colors.text }]}>{item.title}</Text>
                      <Text style={[styles.checkText, { color: colors.textSecondary }]}>{item.text}</Text>
                    </View>
                    <AnimatedCheckbox
                      checked={checks[i]}
                      color={danger}
                      borderColor={checks[i] ? danger : colors.textMuted}
                    />
                  </Pressable>
                </Animated.View>
              ))}
            </View>

            {/* Type RESET input */}
            <Animated.View entering={FadeInDown.duration(250).delay(260)}>
              <PremiumInputCard>
                <PremiumInput
                  ref={inputRef}
                  icon="warning"
                  iconColor={danger}
                  placeholder="Type RESET"
                  value={confirmText}
                  onChangeText={setConfirmText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  accessibilityLabel="Type RESET to confirm"
                  rightElement={
                    confirmValid ? (
                      <Ionicons name="checkmark-circle" size={24} color={danger} />
                    ) : undefined
                  }
                />
              </PremiumInputCard>
            </Animated.View>

            {/* Warning notice */}
            <Animated.View entering={FadeInDown.duration(250).delay(340)}>
              <View style={[styles.warningNotice, {
                backgroundColor: dangerSofter,
                borderLeftColor: danger,
              }]}>
                <Ionicons name="information-circle" size={20} color={danger} />
                <Text style={[styles.warningNoticeText, { color: colors.textSecondary }]}>
                  This action requires your PIN and cannot be undone
                </Text>
              </View>
            </Animated.View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Bottom CTA — animated for keyboard */}
      <Animated.View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.background },
          animatedBottomStyle,
        ]}
      >
        {/* "Point of no return" label on final step when ready */}
        {step === 'confirm' && canProceedConfirm && (
          <Text style={[styles.pointOfNoReturn, { color: dangerMuted }]}>
            POINT OF NO RETURN
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.continueButton,
            {
              backgroundColor: canProceed ? danger : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
              opacity: pressed && canProceed ? 0.85 : 1,
            },
            canProceed && step === 'confirm' && Platform.OS === 'ios' && {
              shadowColor: danger,
              shadowOffset: { width: 0, height: 4 },
              shadowRadius: 12,
              shadowOpacity: 0.35,
            },
          ]}
          onPress={handleContinue}
          disabled={!canProceed || isResetting}
          accessibilityLabel={buttonLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canProceed }}
        >
          {isResetting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.continueText,
                { color: canProceed ? '#FFFFFF' : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)') },
              ]}
            >
              {buttonLabel}
            </Text>
          )}
        </Pressable>
      </Animated.View>

      {/* PIN verification modal */}
      <Modal
        visible={showPinModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setShowPinModal(false);
        }}
      >
        <PinCodeScreen
          mode="verify"
          title="Reset App"
          subtitle="Enter your PIN to confirm reset"
          icon="trash"
          iconColor="#FF3B30"
          onVerify={handlePinVerify}
          onSuccess={handlePinSuccess}
          onCancel={() => {
            setShowPinModal(false);
          }}
          biometricEnabled={false}
          suppressBiometricAutoPrompt={true}
          showBackButton={true}
          onAppReset={async () => {
            setShowPinModal(false);
            setIsResetting(true);
            await PinAuthCoordinator.fullAppReset();
            await deleteWallet({});
            router.replace('/(onboarding)');
          }}
        />
      </Modal>

    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header — simple, no progress dots
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scroll content
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  stepContent: {
    paddingTop: 8,
    gap: 16,
  },

  // Hero icon
  heroIconWrapper: {
    alignItems: 'center',
    marginBottom: 8,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Typography
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  // Balance banner
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  balanceBannerText: {
    fontSize: 15,
    fontWeight: '600',
  },
  balanceBannerLabel: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Settings-style card (replaces GlassCard)
  settingsCard: {
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden' as const,
  },

  // Loss card
  lossCardHeader: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  lossGrid: {
    gap: 10,
  },
  lossItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lossIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lossText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },

  // Check list — compact row style for merged step
  checkList: {
    gap: 12,
  },
  checkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  checkIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  checkContent: {
    flex: 1,
    gap: 2,
  },
  checkTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  checkText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Warning notice
  warningNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderLeftWidth: 3,
  },
  warningNoticeText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  pointOfNoReturn: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  continueButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
