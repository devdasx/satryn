import '../../shim';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  useColorScheme,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME, getThemeColors, ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { KeyboardSafeBottomBar } from '../../src/components/ui';

type ScriptType = 'p2wsh' | 'p2sh-p2wsh' | 'p2sh';

const SCRIPT_TYPES: { value: ScriptType; label: string; description: string; recommended?: boolean }[] = [
  {
    value: 'p2wsh',
    label: 'Native SegWit (P2WSH)',
    description: 'Lowest fees, modern wallets',
    recommended: true,
  },
  {
    value: 'p2sh-p2wsh',
    label: 'Wrapped SegWit',
    description: 'Wider compatibility',
  },
  {
    value: 'p2sh',
    label: 'Legacy (P2SH)',
    description: 'Maximum compatibility',
  },
];

const DEFAULT_WALLET_NAME = 'Multisig Wallet';

export default function MultisigSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Get theme setting from store to respect app's theme preference
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const [walletName, setWalletName] = useState('');
  const [requiredSigs, setRequiredSigs] = useState(2);
  const [totalSigners, setTotalSigners] = useState(3);
  const [scriptType, setScriptType] = useState<ScriptType>('p2wsh');

  // Create dynamic styles
  const styles = createStyles(colors, isDark);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleRequiredChange = useCallback((delta: number) => {
    const newValue = requiredSigs + delta;
    // Guardrails: M >= 1, M <= N, M <= 15
    if (newValue >= 1 && newValue <= totalSigners && newValue <= 15) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRequiredSigs(newValue);
    }
  }, [requiredSigs, totalSigners]);

  const handleTotalChange = useCallback((delta: number) => {
    const newValue = totalSigners + delta;
    // Guardrails: N >= 2, N <= 15, N >= M
    if (newValue >= 2 && newValue <= 15) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTotalSigners(newValue);
      // Auto-adjust M if it exceeds new N
      if (requiredSigs > newValue) {
        setRequiredSigs(newValue);
      }
    }
  }, [totalSigners, requiredSigs]);

  const handleScriptTypeSelect = useCallback((type: ScriptType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setScriptType(type);
  }, []);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const finalName = walletName.trim() || DEFAULT_WALLET_NAME;
    router.push({
      pathname: '/(auth)/multisig-add-cosigner',
      params: {
        name: finalName,
        m: requiredSigs.toString(),
        n: totalSigners.toString(),
        scriptType,
      },
    });
  }, [walletName, requiredSigs, totalSigners, scriptType, router]);

  // Validation - always valid if M <= N and both within bounds
  const isValid = requiredSigs >= 1 && requiredSigs <= totalSigners && totalSigners >= 2;

  // Button disabled states
  const canDecreaseRequired = requiredSigs > 1;
  const canIncreaseRequired = requiredSigs < totalSigners && requiredSigs < 15;
  const canDecreaseTotal = totalSigners > 2 && totalSigners > requiredSigs;
  const canIncreaseTotal = totalSigners < 15;

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header - matches Create Wallet pattern */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBackButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.stepIndicatorText}>Step 1 of 3</Text>
        <View style={styles.headerBackButton} />
      </View>

      <View style={styles.scrollWrapper}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Card */}
          <View style={styles.heroCard}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.heroIconContainer}>
              <View style={styles.heroIconGlow} />
              <Ionicons name="people" size={28} color={isDark ? '#FFFFFF' : THEME.brand.bitcoin} />
            </View>
            <Text style={styles.heroTitle}>Multi-Signature Wallet</Text>
            <Text style={styles.heroDesc}>
              Require multiple signatures to authorize transactions.{'\n'}
              Perfect for shared custody or enhanced security.
            </Text>
          </View>

          {/* Wallet Name */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>WALLET NAME</Text>
            <Text style={styles.sectionSubtitle}>Optional</Text>
            <PremiumInputCard>
              <PremiumInput
                icon="wallet-outline"
                iconColor="#FF9F0A"
                placeholder={DEFAULT_WALLET_NAME}
                value={walletName}
                onChangeText={setWalletName}
                autoCapitalize="words"
              />
            </PremiumInputCard>
          </View>

          {/* Signature Requirements - CORE SECTION */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SIGNATURE REQUIREMENTS</Text>
            <Text style={styles.sectionHelper}>
              You will need {requiredSigs} signature{requiredSigs > 1 ? 's' : ''} out of {totalSigners} total to spend funds.
            </Text>

            <View style={styles.mnCard}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              {/* Visual M of N Display */}
              <View style={styles.mnDisplay}>
                <Text style={styles.mnValue}>{requiredSigs}</Text>
                <Text style={styles.mnOf}>of</Text>
                <Text style={styles.mnValue}>{totalSigners}</Text>
              </View>

              {/* Helper text under M-of-N */}
              <Text style={styles.mnHelper}>
                Any {requiredSigs} of the {totalSigners} signers can approve a spend
              </Text>

              {/* Counters */}
              <View style={styles.countersRow}>
                {/* Required Signatures */}
                <View style={styles.counter}>
                  <Text style={styles.counterLabel}>Signatures</Text>
                  <View style={styles.counterControls}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canDecreaseRequired && styles.counterBtnDisabled,
                        pressed && canDecreaseRequired && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleRequiredChange(-1)}
                      disabled={!canDecreaseRequired}
                    >
                      <Ionicons
                        name="remove"
                        size={22}
                        color={canDecreaseRequired ? colors.text : colors.textDisabled}
                      />
                    </Pressable>
                    <Text style={styles.counterValue}>{requiredSigs}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canIncreaseRequired && styles.counterBtnDisabled,
                        pressed && canIncreaseRequired && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleRequiredChange(1)}
                      disabled={!canIncreaseRequired}
                    >
                      <Ionicons
                        name="add"
                        size={22}
                        color={canIncreaseRequired ? colors.text : colors.textDisabled}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Total Signers */}
                <View style={styles.counter}>
                  <Text style={styles.counterLabel}>Total Signers</Text>
                  <View style={styles.counterControls}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canDecreaseTotal && styles.counterBtnDisabled,
                        pressed && canDecreaseTotal && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleTotalChange(-1)}
                      disabled={!canDecreaseTotal}
                    >
                      <Ionicons
                        name="remove"
                        size={22}
                        color={canDecreaseTotal ? colors.text : colors.textDisabled}
                      />
                    </Pressable>
                    <Text style={styles.counterValue}>{totalSigners}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canIncreaseTotal && styles.counterBtnDisabled,
                        pressed && canIncreaseTotal && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleTotalChange(1)}
                      disabled={!canIncreaseTotal}
                    >
                      <Ionicons
                        name="add"
                        size={22}
                        color={canIncreaseTotal ? colors.text : colors.textDisabled}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Address Format */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ADDRESS FORMAT</Text>
            <Text style={styles.sectionHelper}>
              This affects compatibility and transaction fees.
            </Text>

            <View style={styles.scriptTypesContainer}>
              {SCRIPT_TYPES.map((type) => {
                const isSelected = scriptType === type.value;
                return (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.scriptTypeCard,
                      isSelected && styles.scriptTypeCardSelected,
                    ]}
                    onPress={() => handleScriptTypeSelect(type.value)}
                    activeOpacity={0.7}
                  >
                    {Platform.OS === 'ios' && (
                      <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                    )}
                    <View style={styles.scriptTypeContent}>
                      <View style={styles.scriptTypeInfo}>
                        <View style={styles.scriptTypeTitleRow}>
                          <Text style={[
                            styles.scriptTypeTitle,
                            isSelected && styles.scriptTypeTitleSelected,
                          ]}>
                            {type.label}
                          </Text>
                          {type.recommended && (
                            <View style={styles.recommendedBadge}>
                              <Text style={styles.recommendedText}>Recommended</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.scriptTypeDesc}>{type.description}</Text>
                      </View>
                      <View style={[
                        styles.radioOuter,
                        isSelected && styles.radioOuterSelected,
                      ]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Spacer for fixed footer */}
          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>

      {/* CTA - Keyboard Safe Footer */}
      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            !isValid && styles.primaryButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={!isValid}
          activeOpacity={0.85}
        >
          <Text style={[
            styles.primaryButtonText,
            !isValid && styles.primaryButtonTextDisabled,
          ]}>
            Continue
          </Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>
    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header - matches Create Wallet pattern exactly
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicatorText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },

  // Scroll
  scrollWrapper: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  // Hero Card
  heroCard: {
    alignItems: 'center',
    padding: 28,
    borderRadius: 20,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 32,
    overflow: 'hidden' as const,
  },
  heroIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: isDark ? colors.glassMedium : THEME.brand.bitcoinSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroIconGlow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(247,147,26,0.1)',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    color: colors.textTertiary,
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textDisabled,
    marginBottom: 12,
  },
  sectionHelper: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textTertiary,
    marginBottom: 16,
    lineHeight: 20,
  },

  // Name Input
  // M of N Card
  mnCard: {
    padding: 24,
    borderRadius: 16,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    overflow: 'hidden' as const,
  },
  mnDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  mnHelper: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  mnValue: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -2,
  },
  mnOf: {
    fontSize: 22,
    fontWeight: '500',
    marginHorizontal: 16,
    color: colors.textMuted,
  },
  countersRow: {
    flexDirection: 'row',
    gap: 20,
  },
  counter: {
    flex: 1,
  },
  counterLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  counterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  counterBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnDisabled: {
    backgroundColor: colors.glassLight,
  },
  counterBtnPressed: {
    backgroundColor: colors.glassStrong,
    transform: [{ scale: 0.96 }],
  },
  counterValue: {
    fontSize: 22,
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
    color: colors.text,
  },

  // Script Types
  scriptTypesContainer: {
    gap: 10,
  },
  scriptTypeCard: {
    borderRadius: 14,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.borderLight : 'rgba(0,0,0,0.10)',
    overflow: 'hidden' as const,
  },
  scriptTypeCardSelected: {
    backgroundColor: colors.glassMedium,
    borderColor: colors.borderStrong,
  },
  scriptTypeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  scriptTypeInfo: {
    flex: 1,
  },
  scriptTypeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  scriptTypeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scriptTypeTitleSelected: {
    color: colors.text,
  },
  recommendedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.glassMedium,
  },
  recommendedText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
    letterSpacing: 0.2,
  },
  scriptTypeDesc: {
    fontSize: 13,
    color: colors.textMuted,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: isDark ? '#FFFFFF' : colors.text,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: isDark ? '#FFFFFF' : colors.text,
  },

  bottomSpacer: {
    height: 120,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    backgroundColor: isDark ? THEME.brand.bitcoin : colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: colors.glassMedium,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  primaryButtonTextDisabled: {
    color: colors.textMuted,
  },
});
