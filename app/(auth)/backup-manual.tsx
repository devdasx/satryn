import '../../shim';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated as RNAnimated,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PinCodeScreen } from '../../src/components/security';
import { useTheme, useHaptics, useScreenSecurity } from '../../src/hooks';
import { THEME } from '../../src/constants';
import { useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';

type Step = 'pin' | 'words' | 'verify' | 'success';

const STEP_LABELS = ['Write', 'Verify', 'Done'] as const;

export default function BackupManualScreen() {
  useScreenSecurity(); // Prevent screenshots/recording while seed words are displayed
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const markBackedUp = useSettingsStore(s => s.markBackedUp);
  const { activeWalletId } = useMultiWalletStore();
  const wallets = useMultiWalletStore((s: any) => s.wallets);
  const activeWallet = wallets.find((w: any) => w.id === activeWalletId);

  const [step, setStep] = useState<Step>('pin');
  const [seedWords, setSeedWords] = useState<string[]>([]);
  const [showWords, setShowWords] = useState(false);

  // Verification state
  const [verifyInputs, setVerifyInputs] = useState<Record<number, string>>({});

  // Shake animation for incorrect verify fields
  const shakeAnims = useRef<Record<number, RNAnimated.Value>>({}).current;

  // Try session-based auth on mount
  useEffect(() => {
    (async () => {
      if (SensitiveSession.isActive()) {
        const pin = SensitiveSession.getPin();
        if (pin) {
          const mnemonic = await SecureStorage.retrieveSeed(pin);
          if (mnemonic) {
            setSeedWords(mnemonic.split(' '));
            setStep('words');
            return;
          }
        }
      }
      // If session has biometric PIN, try that
      const pin = await SensitiveSession.ensureAuth();
      if (pin) {
        const mnemonic = await SecureStorage.retrieveSeed(pin);
        if (mnemonic) {
          setSeedWords(mnemonic.split(' '));
          setStep('words');
          return;
        }
      }
      // Fall through to PIN screen
    })();
  }, []);

  // Pick random word positions for verification
  const verifyPositions = useMemo(() => {
    if (seedWords.length === 0) return [];
    const count = seedWords.length <= 12 ? 3 : 4;
    const positions: number[] = [];
    const available = Array.from({ length: seedWords.length }, (_, i) => i);
    for (let i = 0; i < count; i++) {
      const randIdx = Math.floor(Math.random() * available.length);
      positions.push(available[randIdx]);
      available.splice(randIdx, 1);
    }
    return positions.sort((a, b) => a - b);
  }, [seedWords.length]);

  // ─── Inline validation helper ──────────────────────────────

  const getFieldStatus = useCallback((pos: number): 'empty' | 'correct' | 'incorrect' => {
    const input = (verifyInputs[pos] || '').trim().toLowerCase();
    if (!input) return 'empty';
    return input === seedWords[pos]?.toLowerCase() ? 'correct' : 'incorrect';
  }, [verifyInputs, seedWords]);

  const allFieldsFilled = verifyPositions.length > 0 &&
    verifyPositions.every(pos => (verifyInputs[pos] || '').trim().length > 0);

  const allFieldsCorrect = verifyPositions.length > 0 &&
    verifyPositions.every(pos => getFieldStatus(pos) === 'correct');

  // ─── Shake animation ──────────────────────────────────────

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

  // ─── PIN Verification ─────────────────────────────────────

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const isValid = await SecureStorage.verifyPin(pin);
      if (!isValid) return { success: false, error: 'Incorrect PIN' };
      SensitiveSession.start(pin);
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to verify PIN' };
    }
  }, []);

  const handleVerifySuccess = useCallback(async (pin: string) => {
    try {
      const mnemonic = await SecureStorage.retrieveSeed(pin);
      if (mnemonic) {
        setSeedWords(mnemonic.split(' '));
      }
    } catch {
      console.error('Failed to retrieve seed');
    }
    setStep('words');
  }, []);

  const handleBiometricSuccess = useCallback(async (): Promise<{ success: boolean; pin?: string }> => {
    try {
      const pin = await SecureStorage.getPinForBiometrics();
      if (!pin) return { success: false };
      const isValid = await SecureStorage.verifyPin(pin);
      if (!isValid) return { success: false };
      SensitiveSession.start(pin);
      return { success: true, pin };
    } catch {
      return { success: false };
    }
  }, []);

  // ─── Word Verification ────────────────────────────────────

  const handleCheckVerification = useCallback(async () => {
    if (!allFieldsCorrect) {
      // Shake incorrect fields
      for (const pos of verifyPositions) {
        if (getFieldStatus(pos) === 'incorrect') {
          triggerShake(pos);
        }
      }
      await haptics.trigger('error');
      return;
    }

    // Success
    await haptics.trigger('success');
    if (activeWalletId) {
      markBackedUp(activeWalletId, 'manual');
    }
    setStep('success');
  }, [allFieldsCorrect, verifyPositions, getFieldStatus, triggerShake, haptics, activeWalletId, markBackedUp]);

  const handleUpdateVerifyInput = useCallback((pos: number, value: string) => {
    setVerifyInputs(prev => ({ ...prev, [pos]: value }));
  }, []);

  // ─── Step indicator mapping ───────────────────────────────

  const stepIndex = step === 'words' ? 0 : step === 'verify' ? 1 : 2;

  // ─── PIN Screen ───────────────────────────────────────────

  if (step === 'pin') {
    return (
      <PinCodeScreen
        mode="verify"
        title="Verify Identity"
        subtitle="Enter your PIN to view your recovery phrase"
        icon="document"
        iconColor={colors.text}
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── Success Screen ───────────────────────────────────────

  if (step === 'success') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerButton} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Backup complete</Text>
          <View style={styles.headerButton} />
        </View>

        {/* Step indicator */}
        {renderStepIndicator(2, colors, isDark)}

        <View style={[styles.successContent, { paddingTop: 40 }]}>
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.successCenter}>
            <View style={[styles.successIcon, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
              <Ionicons name="checkmark-circle" size={48} color="#30D158" />
            </View>
            <Text style={[styles.successTitle, { color: colors.text }]}>Backup verified</Text>
            <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
              Your recovery phrase has been verified. Keep it safe.
            </Text>
          </Animated.View>

          {/* Summary card */}
          <Animated.View
            entering={FadeInDown.delay(250).duration(500)}
            style={[styles.summaryCard, { backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.45)' }]}
          >
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Wallet</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {activeWallet?.name || 'My Wallet'}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Backed up</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {new Date().toLocaleDateString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Method</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>Manual (phrase verified)</Text>
            </View>
          </Animated.View>
        </View>

        <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={() => {
              haptics.trigger('selection');
              router.dismissAll();
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Words / Verify Screen ────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => {
            if (step === 'verify') {
              setStep('words');
              setVerifyInputs({});
            } else {
              router.back();
            }
          }}
          style={styles.headerButton}
        >
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {step === 'words' ? 'Recovery Phrase' : 'Verify Words'}
        </Text>
        <View style={styles.headerButton} />
      </View>

      {/* 3-step indicator */}
      {renderStepIndicator(stepIndex, colors, isDark)}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {step === 'words' ? (
          <>
            {/* Warning banner */}
            <Animated.View
              entering={FadeInDown.delay(100).duration(500)}
              style={[styles.warningBanner, { backgroundColor: isDark ? 'rgba(255,159,10,0.08)' : 'rgba(255,159,10,0.06)' }]}
            >
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <Ionicons name="shield-outline" size={18} color="#FF9F0A" />
              <Text style={[styles.warningText, { color: isDark ? '#FFD60A' : '#996000' }]}>
                Write these words on paper. Do not screenshot or copy digitally.
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).duration(500)}>
              <Text style={[styles.stepInstruction, { color: colors.textSecondary }]}>
                Write down each word in order. You will verify them next.
              </Text>
            </Animated.View>

            {/* Words Grid */}
            <Animated.View entering={FadeInDown.delay(250).duration(500)} style={[styles.wordsCard, { backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.45)' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={styles.wordsCardHeader}>
                <Text style={[styles.wordsCardTitle, { color: colors.text }]}>Recovery Phrase</Text>
                <TouchableOpacity
                  onPress={() => {
                    haptics.trigger('selection');
                    setShowWords(!showWords);
                  }}
                  style={[styles.revealChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                >
                  <Ionicons name={showWords ? 'eye-off' : 'eye'} size={14} color={colors.textSecondary} />
                  <Text style={[styles.revealChipText, { color: colors.textSecondary }]}>
                    {showWords ? 'Hide' : 'Reveal'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.wordsGrid, seedWords.length <= 12 && styles.wordsGrid2Col]}>
                {seedWords.map((word, index) => (
                  <View
                    key={index}
                    style={[
                      styles.wordCell,
                      seedWords.length <= 12 && styles.wordCell2Col,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' },
                    ]}
                  >
                    <Text style={[styles.wordIndex, { color: colors.textMuted }]}>{index + 1}</Text>
                    <Text style={[styles.wordValue, { color: colors.text }, !showWords && styles.wordBlurred]}>
                      {showWords ? word : '•••••'}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          </>
        ) : (
          <>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              <Text style={[styles.stepInstruction, { color: colors.textSecondary }]}>
                Enter the words at the following positions to verify your backup.
              </Text>
            </Animated.View>

            {/* Verification inputs with inline validation */}
            <Animated.View entering={FadeInDown.delay(200).duration(500)} style={[styles.verifyCard, { backgroundColor: isDark ? colors.surface : 'rgba(255,255,255,0.45)' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              {verifyPositions.map((pos) => {
                const status = getFieldStatus(pos);
                if (!shakeAnims[pos]) {
                  shakeAnims[pos] = new RNAnimated.Value(0);
                }

                return (
                  <RNAnimated.View
                    key={pos}
                    style={[
                      styles.verifyRow,
                      { transform: [{ translateX: shakeAnims[pos] }] },
                    ]}
                  >
                    <View style={[styles.verifyIndexBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Text style={[styles.verifyIndexText, { color: colors.textMuted }]}>
                        #{pos + 1}
                      </Text>
                    </View>
                    <View style={styles.verifyInputWrapper}>
                      <TextInput
                        style={[
                          styles.verifyInput,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                            color: colors.text,
                            borderColor: status === 'correct'
                              ? '#30D158'
                              : status === 'incorrect'
                                ? '#FF453A'
                                : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                          },
                        ]}
                        placeholder={`Word ${pos + 1}`}
                        placeholderTextColor={colors.textMuted}
                        value={verifyInputs[pos] || ''}
                        onChangeText={(val) => handleUpdateVerifyInput(pos, val)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                      {status === 'correct' && (
                        <View style={styles.fieldStatusIcon}>
                          <Ionicons name="checkmark-circle" size={18} color="#30D158" />
                        </View>
                      )}
                      {status === 'incorrect' && (
                        <View style={styles.fieldStatusIcon}>
                          <Ionicons name="close-circle" size={18} color="#FF453A" />
                        </View>
                      )}
                    </View>
                  </RNAnimated.View>
                );
              })}
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Sticky Bottom */}
      <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background }]}>
        {step === 'words' ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={() => {
              haptics.trigger('selection');
              setStep('verify');
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
              I've written it down
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              !allFieldsFilled && { opacity: 0.4 },
            ]}
            onPress={handleCheckVerification}
            disabled={!allFieldsFilled}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
              Verify
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── 3-step indicator component ──────────────────────────────

function renderStepIndicator(
  activeIndex: number,
  colors: any,
  isDark: boolean,
) {
  return (
    <View style={styles.stepRow}>
      {STEP_LABELS.map((label, i) => {
        const isActive = i === activeIndex;
        const isCompleted = i < activeIndex;
        const dotBg = isActive || isCompleted
          ? colors.text
          : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)');

        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View
                style={[
                  styles.stepBar,
                  {
                    backgroundColor: isCompleted
                      ? colors.text
                      : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
                  },
                ]}
              />
            )}
            <View style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: dotBg }]}>
                {isCompleted && (
                  <Ionicons name="checkmark" size={10} color={isDark ? '#000000' : '#FFFFFF'} />
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: isActive || isCompleted
                      ? colors.text
                      : colors.textMuted,
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

// ─── Styles ──────────────────────────────────────────────────

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

  // 3-step indicator
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  stepBar: {
    height: 2,
    width: 40,
    borderRadius: 1,
    marginHorizontal: 8,
    marginBottom: 18, // align with dot center, accounting for label below
  },

  // Content
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // Warning banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 14,
    gap: 10,
    marginBottom: 16,
    overflow: 'hidden' as const,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },

  stepInstruction: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
  },

  // Words card
  wordsCard: {
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden' as const,
  },
  wordsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  wordsCardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  revealChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  revealChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordsGrid2Col: {},
  wordCell: {
    width: '31%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 8,
  },
  wordCell2Col: {
    width: '48%',
  },
  wordIndex: {
    fontSize: 11,
    fontWeight: '700',
    width: 18,
    textAlign: 'center',
  },
  wordValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  wordBlurred: {
    opacity: 0.2,
  },

  // Verify card
  verifyCard: {
    borderRadius: 16,
    padding: 20,
    gap: 14,
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
  verifyIndexText: {
    fontSize: 14,
    fontWeight: '700',
  },
  verifyInputWrapper: {
    flex: 1,
    position: 'relative',
  },
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
    position: 'absolute',
    right: 10,
    top: 13,
  },

  // Sticky bottom
  stickyBottom: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // Success screen
  successContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  successCenter: {
    alignItems: 'center',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 28,
  },

  // Summary card
  summaryCard: {
    borderRadius: 16,
    padding: 18,
    width: '100%',
    marginTop: 8,
    overflow: 'hidden' as const,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  summaryDivider: {
    height: 1,
  },
});
