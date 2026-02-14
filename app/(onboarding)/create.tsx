import '../../shim';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  useColorScheme,
  Alert,
  ScrollView,
  Platform,
  Dimensions,
  Animated as RNAnimated,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import * as ExpoClipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { SeedGenerator } from '../../src/core/wallet';
import { THEME, getThemeColors } from '../../src/constants';
import type { ThemeColors } from '../../src/constants';
import { resolveThemeMode, useScreenSecurity } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer } from '../../src/services/auth/SecureSessionTransfer';
import { clearClipboard } from '../../src/services/import/security';
import { EntropyMethod, EntropyResult, EntropyService, EntropyMode } from '../../src/services/entropy';
import { EntropyCollectionModal } from '../../src/components/entropy';
import { AppBottomSheet, KeyboardSafeBottomBar } from '../../src/components/ui';


// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Step = 'select' | 'generate' | 'verify' | 'complete' | 'skipped';
type SeedLength = 12 | 24;

const STEP_LABELS = ['Security', 'Phrase', 'Verify', 'Done'] as const;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SMALL_SCREEN = SCREEN_HEIGHT < 700;

// ─── Step Indicator ────────────────────────────────────────────

function StepIndicator({
  activeIndex,
  colors,
  isDark,
}: {
  activeIndex: number;
  colors: any;
  isDark: boolean;
}) {
  return (
    <View style={stepStyles.row}>
      {STEP_LABELS.map((label, i) => {
        const isActive = i === activeIndex;
        const isCompleted = i < activeIndex;
        const dotBg = isActive || isCompleted
          ? colors.text
          : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');

        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View
                style={[
                  stepStyles.bar,
                  {
                    backgroundColor: isCompleted
                      ? colors.text
                      : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                  },
                ]}
              />
            )}
            <View style={stepStyles.item}>
              <View style={[stepStyles.dot, { backgroundColor: dotBg }]}>
                {isCompleted && (
                  <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                )}
              </View>
              <Text
                style={[
                  stepStyles.label,
                  {
                    color: isActive || isCompleted ? colors.text : colors.textMuted,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginBottom: 12,
  },
  item: { alignItems: 'center', gap: 4 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, letterSpacing: 0.2 },
  bar: {
    height: 2,
    width: 36,
    borderRadius: 1,
    marginHorizontal: 6,
    marginBottom: 18,
  },
});

// ─── Main Component ────────────────────────────────────────────

export default function CreateWalletScreen() {
  useScreenSecurity(); // Prevent screenshots/recording while seed phrase is visible
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const [step, setStep] = useState<Step>('select');
  const [seedLength, setSeedLength] = useState<SeedLength>(12);
  const [selectedLength, setSelectedLength] = useState<SeedLength | null>(12);
  const [mnemonic, setMnemonic] = useState<string>('');
  const [words, setWords] = useState<string[]>([]);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<{ [key: number]: string }>({});
  const [showQRModal, setShowQRModal] = useState(false);
  const [seedRevealed, setSeedRevealed] = useState(false);

  // Entropy state
  const [entropyExpanded, setEntropyExpanded] = useState(false);
  const [entropyMethod, setEntropyMethod] = useState<EntropyMethod | null>(null);
  const [entropyModalVisible, setEntropyModalVisible] = useState(false);
  const [entropyResult, setEntropyResult] = useState<EntropyResult | null>(null);
  const [entropyMode, setEntropyMode] = useState<EntropyMode>('pureManual');

  const warningPulse = useRef(new RNAnimated.Value(1)).current;
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnims = useRef<Record<number, RNAnimated.Value>>({}).current;

  // Fade animation for step transitions
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

  const animateTransition = useCallback((direction: 'forward' | 'back', callback: () => void) => {
    RNAnimated.timing(fadeAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      callback();
      RNAnimated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
  }, [fadeAnim]);

  // ─── Seed Generation ──────────────────────────────────────

  const generateSeed = useCallback(async (length: SeedLength, userEntropy?: EntropyResult, mode?: EntropyMode) => {
    let newMnemonic: string;
    if (userEntropy) {
      newMnemonic = await SeedGenerator.generateWithEntropy(length, userEntropy, mode || 'pureManual');
    } else {
      newMnemonic = SeedGenerator.generate(length);
    }
    setMnemonic(newMnemonic);
    setWords(SeedGenerator.parseWords(newMnemonic));
    setSeedRevealed(false);
  }, []);

  const handleSelectSeedLength = useCallback((length: SeedLength) => {
    setSelectedLength(length);
    if (entropyResult && entropyResult.bitsCollected < (length === 12 ? 128 : 256)) {
      setEntropyResult(null);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [entropyResult]);

  const handleContinueFromSelect = useCallback(async () => {
    if (!selectedLength) return;
    setSeedLength(selectedLength);
    await generateSeed(selectedLength, entropyResult || undefined, entropyMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateTransition('forward', () => setStep('generate'));
  }, [selectedLength, generateSeed, animateTransition, entropyResult, entropyMode]);

  // Entropy handlers
  const handleToggleEntropy = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEntropyExpanded((prev) => !prev);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSelectEntropyMethod = useCallback((method: EntropyMethod) => {
    setEntropyMethod(method);
    setEntropyModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleEntropyComplete = useCallback((result: EntropyResult) => {
    setEntropyResult(result);
    setEntropyModalVisible(false);
    setEntropyExpanded(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  // Test entropy function removed — was logging mnemonics in production

  const handleClearEntropy = useCallback(() => {
    setEntropyResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ─── Navigation & Actions ────────────────────────────────

  const handleCopyPhrase = useCallback(async () => {
    await ExpoClipboard.setStringAsync(mnemonic);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Auto-clear clipboard after 60 seconds to prevent other apps from reading the seed
    setTimeout(() => { clearClipboard(); }, 60_000);
  }, [mnemonic]);

  const handleShowQR = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowQRModal(true);
  }, []);

  const handleContinueToVerify = useCallback(() => {
    const numWords = seedLength === 24 ? 4 : 3;
    const indices = SeedGenerator.getVerificationIndices(words.length, numWords);
    setVerifyIndices(indices);
    setVerifyAnswers({});
    inputRefs.current = [];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition('forward', () => setStep('verify'));
  }, [words.length, seedLength, animateTransition]);

  const handleSkipBackup = useCallback(() => {
    Alert.alert(
      'Skip Backup Verification?',
      'Without verifying your backup, you risk losing access to your Bitcoin forever if you lose this device.\n\nYou can verify later in Settings.',
      [
        { text: 'Go Back', style: 'cancel' },
        {
          text: 'Skip Anyway',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            animateTransition('forward', () => setStep('skipped'));
          },
        },
      ]
    );
  }, [animateTransition]);

  // ─── Verification ─────────────────────────────────────────

  const getFieldStatus = useCallback((index: number): 'empty' | 'correct' | 'incorrect' => {
    const input = (verifyAnswers[index] || '').trim().toLowerCase();
    if (!input) return 'empty';
    return input === words[index]?.toLowerCase() ? 'correct' : 'incorrect';
  }, [verifyAnswers, words]);

  const triggerShake = useCallback((pos: number) => {
    if (!shakeAnims[pos]) {
      shakeAnims[pos] = new RNAnimated.Value(0);
    }
    const anim = shakeAnims[pos];
    anim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(anim, { toValue: 10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(anim, { toValue: -10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(anim, { toValue: 10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(anim, { toValue: -10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(anim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnims]);

  const handleVerify = useCallback(() => {
    const allCorrect = verifyIndices.every(
      (index) => verifyAnswers[index]?.toLowerCase().trim() === words[index]
    );

    if (allCorrect) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      animateTransition('forward', () => setStep('complete'));
    } else {
      // Shake incorrect fields
      for (const idx of verifyIndices) {
        if (getFieldStatus(idx) !== 'correct') {
          triggerShake(idx);
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [verifyIndices, verifyAnswers, words, animateTransition, getFieldStatus, triggerShake]);

  const handleComplete = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const cachedPin = await SensitiveSession.ensureAuth();
    if (cachedPin) {
      const token = SecureSessionTransfer.store({ mnemonic, pin: cachedPin });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
      return;
    }

    const hasPinSet = await SecureStorage.hasPinSet();
    if (hasPinSet) {
      const token = SecureSessionTransfer.store({ mnemonic, verifyOnly: 'true' });
      router.push({
        pathname: '/(onboarding)/pin',
        params: { _sst: token },
      });
    } else {
      const token = SecureSessionTransfer.store({ mnemonic });
      router.push({
        pathname: '/(onboarding)/pin',
        params: { _sst: token },
      });
    }
  }, [mnemonic, router]);

  const handleVerifyFromSkipped = useCallback(() => {
    const numWords = seedLength === 24 ? 4 : 3;
    const indices = SeedGenerator.getVerificationIndices(words.length, numWords);
    setVerifyIndices(indices);
    setVerifyAnswers({});
    inputRefs.current = [];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition('back', () => setStep('verify'));
  }, [words.length, seedLength, animateTransition]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'select':
        router.back();
        break;
      case 'generate':
        animateTransition('back', () => setStep('select'));
        break;
      case 'verify':
        animateTransition('back', () => setStep('generate'));
        break;
      case 'complete':
        animateTransition('back', () => setStep('verify'));
        break;
      case 'skipped':
        animateTransition('back', () => setStep('verify'));
        break;
    }
  }, [step, router, animateTransition]);

  const getStepIndex = () => {
    switch (step) {
      case 'select': return 0;
      case 'generate': return 1;
      case 'verify': return 2;
      case 'complete': return 3;
      case 'skipped': return 3;
    }
  };

  const canVerify = verifyIndices.every((i) => verifyAnswers[i]?.trim().length > 0);

  // Auto-advance to next input
  const handleInputChange = useCallback((index: number, text: string, position: number) => {
    setVerifyAnswers((prev) => ({
      ...prev,
      [index]: text.toLowerCase(),
    }));

    if (text.toLowerCase().trim() === words[index] && position < verifyIndices.length - 1) {
      setTimeout(() => {
        inputRefs.current[position + 1]?.focus();
      }, 100);
    }
  }, [words, verifyIndices.length]);

  // Warning pulse animation for skipped step
  useEffect(() => {
    if (step === 'skipped') {
      const pulseAnimation = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(warningPulse, {
            toValue: 1.08,
            duration: 1200,
            useNativeDriver: true,
          }),
          RNAnimated.timing(warningPulse, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();
      return () => pulseAnimation.stop();
    }
  }, [step, warningPulse]);

  const s = createStyles(colors, isDark, insets, seedLength);

  // ========================================
  // QR Code Sheet
  // ========================================
  const renderQRSheet = () => (
    <AppBottomSheet
      visible={showQRModal}
      onClose={() => setShowQRModal(false)}
      title="Recovery Phrase QR"
      subtitle="Scan to import on another device"
      sizing="medium"
    >
      <View style={s.qrSheetContent}>
        <View style={s.qrContainer}>
          <QRCode
            value={mnemonic}
            size={200}
            backgroundColor="white"
            color="black"
          />
        </View>

        <View style={[s.qrWarning, {
          backgroundColor: isDark ? 'rgba(255,69,58,0.1)' : 'rgba(255,59,48,0.08)',
        }]}>
          <Ionicons name="warning" size={16} color={isDark ? '#FF6961' : '#FF3B30'} />
          <View style={s.qrWarningTextWrap}>
            <Text style={[s.qrWarningText, { color: isDark ? '#FF6961' : '#FF3B30' }]}>
              Anyone with this QR can access your Bitcoin
            </Text>
            <Text style={[s.qrWarningSubtext, { color: isDark ? 'rgba(255,105,97,0.8)' : 'rgba(255,59,48,0.75)' }]}>
              Do not share or screenshot this QR
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowQRModal(false)}
          activeOpacity={0.85}
          style={[s.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
        >
          <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
            Close
          </Text>
        </TouchableOpacity>
      </View>
    </AppBottomSheet>
  );

  // ========================================
  // STEP 1: Choose Security Level
  // ========================================
  const renderSelectStep = () => {
    const entropyMethods: { method: EntropyMethod; config: typeof EntropyService.METHOD_CONFIGS.touch }[] = [
      { method: 'touch', config: EntropyService.METHOD_CONFIGS.touch },
      { method: 'coinFlips', config: EntropyService.METHOD_CONFIGS.coinFlips },
      { method: 'diceRolls', config: EntropyService.METHOD_CONFIGS.diceRolls },
      { method: 'numbers', config: EntropyService.METHOD_CONFIGS.numbers },
    ];

    return (
      <View style={s.stepContainer}>
        <ScrollView
          style={s.scrollView}
          contentContainerStyle={s.selectScrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
        >
          {/* Hero icon */}
          <Animated.View entering={FadeInDown.delay(50).duration(500)} style={{ alignItems: 'center', marginBottom: 20 }}>
            <View style={[s.heroIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
            }]}>
              <Ionicons name="shield-half-outline" size={32} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'} />
            </View>
          </Animated.View>

          {/* Header */}
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={s.headerContent}>
            <Text style={[s.title, { color: colors.text }]}>
              Choose Security Level
            </Text>
            <Text style={[s.subtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)' }]}>
              Select the length of your recovery phrase.{'\n'}More words means higher security.
            </Text>
          </Animated.View>

          {/* Seed Length Options */}
          <Animated.View entering={FadeInDown.delay(200).duration(500)} style={s.seedOptions}>
            {/* 12 Words */}
            <TouchableOpacity
              onPress={() => handleSelectSeedLength(12)}
              activeOpacity={0.8}
              style={[s.seedOption, {
                backgroundColor: isDark
                  ? (selectedLength === 12 ? colors.surface : 'rgba(255,255,255,0.03)')
                  : (selectedLength === 12 ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.02)'),
                borderColor: selectedLength === 12
                  ? (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)')
                  : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
                borderWidth: selectedLength === 12 ? 1.5 : 1,
              }]}
            >
              {Platform.OS === 'ios' && selectedLength === 12 && (
                <BlurView intensity={isDark ? 20 : 40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={s.seedOptionRow}>
                <View style={[s.seedOptionIconWrap, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}>
                  <Ionicons name="key-outline" size={20} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.seedOptionHeader}>
                    <Text style={[s.seedOptionTitle, { color: colors.text }]}>12 Words</Text>
                    <View style={[s.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                      <Text style={[s.badgeText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)' }]}>
                        Recommended
                      </Text>
                    </View>
                  </View>
                  <Text style={[s.seedOptionDesc, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
                    Standard security. Works with most wallets and hardware devices.
                  </Text>
                </View>
                {selectedLength === 12 && (
                  <Ionicons name="checkmark-circle" size={22} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)'} />
                )}
              </View>
            </TouchableOpacity>

            {/* 24 Words */}
            <TouchableOpacity
              onPress={() => handleSelectSeedLength(24)}
              activeOpacity={0.8}
              style={[s.seedOption, {
                backgroundColor: isDark
                  ? (selectedLength === 24 ? colors.surface : 'rgba(255,255,255,0.03)')
                  : (selectedLength === 24 ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.02)'),
                borderColor: selectedLength === 24
                  ? (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)')
                  : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
                borderWidth: selectedLength === 24 ? 1.5 : 1,
              }]}
            >
              {Platform.OS === 'ios' && selectedLength === 24 && (
                <BlurView intensity={isDark ? 20 : 40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={s.seedOptionRow}>
                <View style={[s.seedOptionIconWrap, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}>
                  <Ionicons name="lock-closed-outline" size={20} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.seedOptionHeader}>
                    <Text style={[s.seedOptionTitle, { color: colors.text }]}>24 Words</Text>
                    <View style={[s.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' }]}>
                      <Text style={[s.badgeText, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
                        Advanced
                      </Text>
                    </View>
                  </View>
                  <Text style={[s.seedOptionDesc, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
                    Higher security. Recommended for large holdings or advanced users.
                  </Text>
                </View>
                {selectedLength === 24 && (
                  <Ionicons name="checkmark-circle" size={22} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)'} />
                )}
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Entropy Section */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)} style={s.entropySection}>
            <TouchableOpacity
              onPress={handleToggleEntropy}
              activeOpacity={0.7}
              style={[s.entropyToggle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              }]}
            >
              <View style={s.entropyToggleLeft}>
                <Ionicons name="dice-outline" size={20} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'} />
                <Text style={[s.entropyToggleText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
                  Add Your Own Randomness
                </Text>
                <View style={[s.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                  <Text style={[s.badgeText, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)' }]}>
                    Optional
                  </Text>
                </View>
              </View>
              <Ionicons
                name={entropyExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
              />
            </TouchableOpacity>

            {/* Entropy Result Badge */}
            {entropyResult && !entropyExpanded && (
              <View style={[s.entropyResultBadge, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(52,199,89,0.08)',
                borderColor: isDark ? 'rgba(48,209,88,0.20)' : 'rgba(52,199,89,0.15)',
              }]}>
                <Ionicons name="checkmark-circle" size={18} color={isDark ? '#30D158' : '#34C759'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.entropyResultText, { color: isDark ? '#30D158' : '#34C759' }]}>
                    {entropyResult.bitsCollected} bits of entropy added
                  </Text>
                  <Text style={[s.entropyModeText, { color: isDark ? 'rgba(48,209,88,0.7)' : 'rgba(52,199,89,0.8)' }]}>
                    {entropyMode === 'pureManual' ? 'Deterministic mode' : 'Mixed with system entropy'}
                  </Text>
                </View>
                <TouchableOpacity onPress={handleClearEntropy} activeOpacity={0.7} style={{ padding: 2 }}>
                  <Ionicons name="close-circle" size={18} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'} />
                </TouchableOpacity>
              </View>
            )}

            {/* Expanded Entropy Methods */}
            {entropyExpanded && (
              <View style={{ gap: 12 }}>
                <View style={[s.infoBox, {
                  backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.04)',
                  borderColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.10)',
                }]}>
                  <Ionicons name="information-circle" size={18} color={isDark ? '#0A84FF' : '#007AFF'} />
                  <Text style={[s.infoBoxText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
                    Same input will always generate the same recovery phrase. Use real randomness (actual coin flips, dice rolls).
                  </Text>
                </View>

                <Text style={[s.entropyMethodsLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
                  Choose a collection method:
                </Text>
                <View style={s.entropyGrid}>
                  {entropyMethods.map(({ method, config }) => (
                    <TouchableOpacity
                      key={method}
                      onPress={() => handleSelectEntropyMethod(method)}
                      activeOpacity={0.8}
                      style={[s.entropyCard, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      }]}
                    >
                      <Ionicons name={config.icon as any} size={24} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                      <Text style={[s.entropyCardName, { color: colors.text }]}>{config.name}</Text>
                      <Text style={[s.entropyCardDesc, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
                        {config.description}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Bottom Action */}
        <View style={[s.bottomActions, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            onPress={handleContinueFromSelect}
            activeOpacity={0.85}
            disabled={!selectedLength}
            style={[s.primaryButton, {
              backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              opacity: selectedLength ? 1 : 0.35,
            }]}
          >
            <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
              Continue
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ========================================
  // STEP 2: Your Recovery Phrase
  // ========================================
  const renderGenerateStep = () => (
    <View style={s.stepContainer}>
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={SMALL_SCREEN || seedLength === 24}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.delay(50).duration(500)} style={s.headerContent}>
          <Text style={[s.title, { color: colors.text }]}>
            Your Recovery Phrase
          </Text>
          <Text style={[s.subtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)' }]}>
            Write down these {seedLength} words in order.{'\n'}This is the only way to recover your wallet.
          </Text>
        </Animated.View>

        {/* Seed Phrase Card */}
        <Animated.View entering={FadeInDown.delay(150).duration(500)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => !seedRevealed && setSeedRevealed(true)}
            style={[s.phraseCard, {
              backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.5)',
            }]}
          >
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 25 : 50} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}

            {!seedRevealed ? (
              <View style={s.seedHidden}>
                <View style={[s.seedHiddenIcon, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}>
                  <Ionicons name="eye-outline" size={28} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.30)'} />
                </View>
                <Text style={[s.seedHiddenText, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)' }]}>
                  Tap to reveal your recovery phrase
                </Text>
                <Text style={[s.seedHiddenNote, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>
                  Make sure no one is watching your screen
                </Text>
              </View>
            ) : (
              <>
                {/* Words header */}
                <View style={s.phraseCardHeader}>
                  <Text style={[s.phraseCardTitle, { color: colors.text }]}>Recovery Phrase</Text>
                  <TouchableOpacity
                    onPress={() => setSeedRevealed(false)}
                    style={[s.revealChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                  >
                    <Ionicons name="eye-off" size={14} color={colors.textSecondary} />
                    <Text style={[s.revealChipText, { color: colors.textSecondary }]}>Hide</Text>
                  </TouchableOpacity>
                </View>

                {/* Words Grid */}
                <View style={s.seedGrid}>
                  {words.map((word, index) => (
                    <View
                      key={index}
                      style={[s.wordItem, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                      }]}
                    >
                      <Text style={[s.wordIndex, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>
                        {index + 1}
                      </Text>
                      <Text style={[s.wordText, { color: colors.text }]}>
                        {word}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Actions */}
                <View style={[s.seedActions, { borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                  <TouchableOpacity onPress={handleCopyPhrase} activeOpacity={0.7} style={s.seedActionBtn}>
                    <Ionicons name="copy-outline" size={16} color={isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)'} />
                    <Text style={[s.seedActionText, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)' }]}>Copy</Text>
                  </TouchableOpacity>
                  <View style={[s.actionDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]} />
                  <TouchableOpacity onPress={handleShowQR} activeOpacity={0.7} style={s.seedActionBtn}>
                    <Ionicons name="qr-code-outline" size={16} color={isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)'} />
                    <Text style={[s.seedActionText, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)' }]}>Show QR</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Security Warning */}
        <Animated.View entering={FadeInDown.delay(250).duration(500)}>
          <View style={[s.warningBox, {
            backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,59,48,0.04)',
            borderColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,59,48,0.08)',
          }]}>
            <Ionicons name="shield-outline" size={18} color={isDark ? '#FF6961' : '#FF3B30'} />
            <View style={{ flex: 1 }}>
              <Text style={[s.warningTitle, { color: isDark ? '#FF6961' : '#FF3B30' }]}>
                Keep this phrase secret
              </Text>
              <Text style={[s.warningDesc, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
                Anyone with these words can access your Bitcoin. Never share them with anyone.
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Bottom Action */}
      <View style={[s.bottomActions, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleContinueToVerify}
          activeOpacity={0.85}
          disabled={!seedRevealed}
          style={[s.primaryButton, {
            backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
            opacity: seedRevealed ? 1 : 0.35,
          }]}
        >
          <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
            I've Written It Down
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ========================================
  // STEP 3: Verify Your Backup
  // ========================================
  const renderVerifyStep = () => (
    <View style={s.stepContainer}>
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={[s.scrollContent, { paddingBottom: 140 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.delay(50).duration(500)} style={s.headerContent}>
          <Text style={[s.title, { color: colors.text }]}>
            Verify Your Backup
          </Text>
          <Text style={[s.subtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)' }]}>
            Enter the requested words to confirm{'\n'}you've saved your recovery phrase.
          </Text>
        </Animated.View>

        {/* Verification Card */}
        <Animated.View
          entering={FadeInDown.delay(150).duration(500)}
          style={[s.verifyCard, { backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.5)' }]}
        >
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 25 : 50} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          {verifyIndices.map((index, i) => {
            const fieldStatus = getFieldStatus(index);
            if (!shakeAnims[index]) {
              shakeAnims[index] = new RNAnimated.Value(0);
            }

            return (
              <RNAnimated.View
                key={index}
                style={[
                  s.verifyRow,
                  { transform: [{ translateX: shakeAnims[index] }] },
                ]}
              >
                <View style={[s.verifyIndexBadge, {
                  backgroundColor: fieldStatus === 'correct'
                    ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
                    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                }]}>
                  <Text style={[s.verifyIndexText, {
                    color: fieldStatus === 'correct'
                      ? '#30D158'
                      : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)'),
                  }]}>
                    #{index + 1}
                  </Text>
                </View>
                <View style={s.verifyInputWrap}>
                  <TextInput
                    ref={(ref) => { inputRefs.current[i] = ref; }}
                    style={[s.verifyInput, {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                      color: colors.text,
                      borderColor: fieldStatus === 'correct'
                        ? '#30D158'
                        : fieldStatus === 'incorrect'
                          ? '#FF453A'
                          : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                    }]}
                    placeholder={`Word ${index + 1}`}
                    placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'}
                    value={verifyAnswers[index] || ''}
                    onChangeText={(text) => handleInputChange(index, text, i)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    returnKeyType={i < verifyIndices.length - 1 ? 'next' : 'done'}
                    onSubmitEditing={() => {
                      if (i < verifyIndices.length - 1) {
                        inputRefs.current[i + 1]?.focus();
                      }
                    }}
                  />
                  {fieldStatus === 'correct' && (
                    <View style={s.fieldStatusIcon}>
                      <Ionicons name="checkmark-circle" size={18} color="#30D158" />
                    </View>
                  )}
                  {fieldStatus === 'incorrect' && (
                    <View style={s.fieldStatusIcon}>
                      <Ionicons name="close-circle" size={18} color="#FF453A" />
                    </View>
                  )}
                </View>
              </RNAnimated.View>
            );
          })}
        </Animated.View>
      </ScrollView>

      {/* Bottom Actions */}
      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          onPress={handleVerify}
          activeOpacity={0.85}
          disabled={!canVerify}
          style={[s.primaryButton, {
            backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
            opacity: canVerify ? 1 : 0.35,
          }]}
        >
          <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
            Verify Backup
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSkipBackup} activeOpacity={0.7} style={s.skipButton}>
          <Text style={[s.skipButtonText, { color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)' }]}>
            Skip for now
          </Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>
    </View>
  );

  // ========================================
  // STEP 4: Backup Verified (SUCCESS)
  // ========================================
  const renderCompleteStep = () => (
    <View style={s.stepContainer}>
      <View style={s.centerContent}>
        {/* Success Icon */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={{ alignItems: 'center' }}>
          <View style={[s.resultIcon, {
            backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(52,199,89,0.08)',
          }]}>
            <Ionicons name="shield-checkmark" size={40} color={isDark ? '#30D158' : '#34C759'} />
          </View>
        </Animated.View>

        {/* Header */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ alignItems: 'center' }}>
          <Text style={[s.resultTitle, { color: colors.text }]}>Backup Verified</Text>
          <Text style={[s.resultSubtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)' }]}>
            Your recovery phrase has been verified.{'\n'}Your wallet is secured.
          </Text>
        </Animated.View>

        {/* Reminder Card */}
        <Animated.View
          entering={FadeInDown.delay(350).duration(500)}
          style={[s.reminderCard, { backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.5)' }]}
        >
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 20 : 40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          {[
            'Store your phrase offline, securely',
            'Never share it with anyone',
            "It's the only way to recover your wallet",
          ].map((text, i) => (
            <View key={i} style={s.reminderItem}>
              <Ionicons name="checkmark" size={16} color={isDark ? 'rgba(48,209,88,0.7)' : 'rgba(52,199,89,0.6)'} />
              <Text style={[s.reminderText, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
                {text}
              </Text>
            </View>
          ))}
        </Animated.View>
      </View>

      {/* Bottom Action */}
      <View style={[s.bottomActions, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleComplete}
          activeOpacity={0.85}
          style={[s.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
        >
          <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
            Set Up PIN
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ========================================
  // STEP 4 ALT: Backup Skipped (WARNING)
  // ========================================
  const renderSkippedStep = () => (
    <View style={s.stepContainer}>
      <View style={s.centerContent}>
        {/* Warning Icon with Pulse */}
        <RNAnimated.View
          style={[
            s.resultIcon,
            {
              backgroundColor: isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.08)',
              borderWidth: 2,
              borderColor: isDark ? 'rgba(255,149,0,0.25)' : 'rgba(255,149,0,0.20)',
              transform: [{ scale: warningPulse }],
            },
          ]}
        >
          <Ionicons name="warning" size={40} color={isDark ? '#FF9F0A' : '#FF9500'} />
        </RNAnimated.View>

        {/* Header */}
        <Text style={[s.resultTitle, { color: colors.text }]}>Backup Not Verified</Text>
        <Text style={[s.skippedAccent, { color: isDark ? '#FF9F0A' : '#E68600' }]}>
          Your Bitcoin is at risk
        </Text>

        {/* Warning Card */}
        <View style={[s.warningCard, {
          backgroundColor: isDark ? 'rgba(255,149,0,0.05)' : 'rgba(255,149,0,0.03)',
          borderColor: isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.10)',
        }]}>
          <Text style={[s.warningCardText, { color: isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.65)' }]}>
            You have not verified your recovery phrase. If this device is lost, stolen, or damaged, your Bitcoin cannot be recovered.
          </Text>
        </View>

        {/* Info Points */}
        <View style={s.infoPoints}>
          {['No way to recover your funds', 'You can verify anytime in Settings'].map((text, i) => (
            <View key={i} style={s.infoPointRow}>
              <Ionicons
                name="close-circle-outline"
                size={16}
                color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'}
              />
              <Text style={[s.infoPointText, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)' }]}>
                {text}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom Actions */}
      <View style={[s.bottomActions, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleVerifyFromSkipped}
          activeOpacity={0.85}
          style={[s.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
        >
          <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={[s.primaryButtonText, { color: '#FFFFFF' }]}>
            Verify Backup Now
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleComplete} activeOpacity={0.7} style={s.skipAnywayButton}>
          <Text style={[s.skipAnywayText, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)' }]}>
            Skip, I'll do it later
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ========================================
  // Main Render
  // ========================================
  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={s.headerBtn} activeOpacity={0.7}>
          <View style={[s.headerBtnBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>

        {/* Step Indicator in header area */}
        <View style={{ flex: 1 }} />

        <View style={s.headerBtn} />
      </View>

      {/* Visual Step Indicator */}
      <StepIndicator activeIndex={getStepIndex()} colors={colors} isDark={isDark} />

      {/* Content */}
      <RNAnimated.View style={[s.contentContainer, { opacity: fadeAnim }]}>
        {step === 'select' && renderSelectStep()}
        {step === 'generate' && renderGenerateStep()}
        {step === 'verify' && renderVerifyStep()}
        {step === 'complete' && renderCompleteStep()}
        {step === 'skipped' && renderSkippedStep()}
      </RNAnimated.View>

      {/* QR Modal */}
      {renderQRSheet()}

      {/* Entropy Collection Modal */}
      {entropyMethod && (
        <EntropyCollectionModal
          visible={entropyModalVisible}
          method={entropyMethod}
          seedLength={selectedLength || 12}
          onComplete={handleEntropyComplete}
          onCancel={() => setEntropyModalVisible(false)}
          isDark={isDark}
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const createStyles = (
  colors: ThemeColors,
  isDark: boolean,
  insets: { top: number; bottom: number },
  seedLength: SeedLength
) =>
  StyleSheet.create({
    container: { flex: 1 },
    contentContainer: { flex: 1 },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    headerBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerBtnBg: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Step Container
    stepContainer: { flex: 1 },
    scrollView: { flex: 1 },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 8,
      flexGrow: 1,
    },
    selectScrollContent: {
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 24,
    },

    // Hero Icon (Step 1)
    heroIcon: {
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Header Content
    headerContent: {
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      textAlign: 'center',
      marginBottom: 10,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
    },

    // Seed Options (Step 1)
    seedOptions: { gap: 12 },
    seedOption: {
      borderRadius: 16,
      borderWidth: 1,
      overflow: 'hidden' as const,
    },
    seedOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 14,
    },
    seedOptionIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seedOptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    seedOptionTitle: {
      fontSize: 17,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    seedOptionDesc: {
      fontSize: 13,
      lineHeight: 18,
    },
    badge: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '500',
    },

    // Entropy Section
    entropySection: { marginTop: 20, gap: 10 },
    entropyToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
    },
    entropyToggleLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    entropyToggleText: { fontSize: 15, fontWeight: '500' },
    entropyResultBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      gap: 8,
    },
    entropyResultText: { fontSize: 14, fontWeight: '500' },
    entropyModeText: { fontSize: 12, fontWeight: '400' },
    infoBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      gap: 10,
    },
    infoBoxText: { flex: 1, fontSize: 13, lineHeight: 18 },
    entropyMethodsLabel: { fontSize: 13, fontWeight: '500', marginLeft: 4 },
    entropyGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    entropyCard: {
      width: '47%',
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      alignItems: 'center',
      gap: 6,
    },
    entropyCardName: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
    entropyCardDesc: { fontSize: 12, textAlign: 'center', lineHeight: 16 },

    // Bottom Actions
    bottomActions: {
      paddingHorizontal: 24,
      paddingTop: 12,
      gap: 8,
    },
    primaryButton: {
      height: 50,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    primaryButtonText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    skipButton: { alignItems: 'center', paddingVertical: 6 },
    skipButtonText: { fontSize: 13, fontWeight: '400' },
    skipAnywayButton: { alignItems: 'center', paddingVertical: 14 },
    skipAnywayText: { fontSize: 14, fontWeight: '400' },

    // Phrase Card (Step 2)
    phraseCard: {
      borderRadius: 16,
      overflow: 'hidden' as const,
      marginBottom: 16,
    },
    phraseCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 18,
      marginBottom: 14,
    },
    phraseCardTitle: { fontSize: 16, fontWeight: '600' },
    revealChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
    },
    revealChipText: { fontSize: 13, fontWeight: '500' },
    seedHidden: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingVertical: 50,
    },
    seedHiddenIcon: {
      width: 56,
      height: 56,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    seedHiddenText: { fontSize: 16, fontWeight: '500' },
    seedHiddenNote: { fontSize: 13 },
    seedGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      gap: 8,
      rowGap: seedLength === 24 ? 8 : 10,
    },
    wordItem: {
      flexDirection: 'row',
      alignItems: 'center',
      width: seedLength === 24 ? '31.5%' : '48%',
      paddingVertical: seedLength === 24 ? 9 : 11,
      paddingHorizontal: seedLength === 24 ? 8 : 12,
      borderRadius: 10,
    },
    wordIndex: {
      fontSize: seedLength === 24 ? 10 : 11,
      fontWeight: '700',
      width: seedLength === 24 ? 16 : 18,
      marginRight: seedLength === 24 ? 4 : 6,
      textAlign: 'center',
    },
    wordText: {
      fontSize: seedLength === 24 ? 13 : 15,
      fontWeight: '600',
    },
    seedActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 14,
      paddingTop: 14,
      paddingBottom: 4,
      marginHorizontal: 14,
      borderTopWidth: 1,
    },
    seedActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    seedActionText: { fontSize: 14, fontWeight: '500' },
    actionDivider: { width: 1, height: 16, marginHorizontal: 8 },

    // Warning Box
    warningBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    warningTitle: { fontSize: 14, fontWeight: '600', marginBottom: 3 },
    warningDesc: { fontSize: 13, lineHeight: 19 },

    // Verify Step (Step 3)
    verifyCard: {
      borderRadius: 16,
      padding: 16,
      gap: 12,
      overflow: 'hidden' as const,
    },
    verifyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    verifyIndexBadge: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    verifyIndexText: { fontSize: 14, fontWeight: '700' },
    verifyInputWrap: { flex: 1, position: 'relative' as const },
    verifyInput: {
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingRight: 36,
      fontSize: 15,
      fontWeight: '500',
    },
    fieldStatusIcon: {
      position: 'absolute' as const,
      right: 10,
      top: 13,
    },

    // Result Screens (Step 4)
    centerContent: {
      flex: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 40,
    },
    resultIcon: {
      width: 88,
      height: 88,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    resultTitle: {
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      textAlign: 'center',
      marginBottom: 8,
    },
    resultSubtitle: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 28,
    },
    reminderCard: {
      width: '100%',
      paddingVertical: 16,
      paddingHorizontal: 18,
      borderRadius: 16,
      gap: 12,
      overflow: 'hidden' as const,
    },
    reminderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    reminderText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },

    // Skipped Step
    skippedAccent: {
      fontSize: 17,
      fontWeight: '500',
      textAlign: 'center',
      marginBottom: 24,
    },
    warningCard: {
      width: '100%',
      paddingVertical: 16,
      paddingHorizontal: 18,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 20,
    },
    warningCardText: {
      fontSize: 15,
      lineHeight: 23,
      textAlign: 'center',
    },
    infoPoints: { width: '100%', gap: 10 },
    infoPointRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    infoPointText: { fontSize: 14, fontWeight: '500' },

    // QR Sheet
    qrSheetContent: { alignItems: 'center', paddingHorizontal: 24 },
    qrContainer: {
      padding: 16,
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      marginBottom: 16,
    },
    qrWarning: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      marginBottom: 20,
    },
    qrWarningTextWrap: { flex: 1, gap: 2 },
    qrWarningText: { fontSize: 13, fontWeight: '600' },
    qrWarningSubtext: { fontSize: 12, fontWeight: '400' },
  });
