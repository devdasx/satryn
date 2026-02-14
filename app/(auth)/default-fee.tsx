import '../../shim';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSettingsStore } from '../../src/stores';
import { THEME } from '../../src/constants';
import { useTheme, useHaptics } from '../../src/hooks';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import type { FeePreference } from '../../src/types';

// ─── Data ──────────────────────────────────────────────────────

const FEE_OPTIONS: {
  key: FeePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  speed: string;
  desc: string;
}[] = [
  {
    key: 'fast',
    label: 'Fast',
    icon: 'flash',
    color: '#FF9F0A',
    speed: '~10 minutes',
    desc: 'Highest priority. Your transaction will be included in the next 1-2 blocks. Best for time-sensitive payments.',
  },
  {
    key: 'medium',
    label: 'Medium',
    icon: 'time',
    color: '#007AFF',
    speed: '~30 minutes',
    desc: 'Balanced between speed and cost. Usually confirms within 3-6 blocks. Recommended for most transactions.',
  },
  {
    key: 'slow',
    label: 'Economy',
    icon: 'leaf',
    color: '#30D158',
    speed: '~1 hour',
    desc: 'Lower fee, slower confirmation. Good for non-urgent transfers when you want to minimize costs.',
  },
  {
    key: 'custom',
    label: 'Custom',
    icon: 'settings',
    color: '#BF5AF2',
    speed: 'Set manually',
    desc: 'Set an exact fee rate in sat/vB. For advanced users who want full control over transaction priority.',
  },
];

const HOW_IT_WORKS = [
  {
    icon: 'cube-outline' as const,
    color: '#FF9F0A',
    title: 'Block Space is Limited',
    desc: 'Each Bitcoin block can only hold a limited number of transactions. Miners prioritize transactions with higher fees.',
  },
  {
    icon: 'trending-up-outline' as const,
    color: '#007AFF',
    title: 'Dynamic Fee Estimation',
    desc: 'Fee rates are estimated based on current mempool conditions. Satryn fetches real-time estimates from your Electrum server.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    color: '#30D158',
    title: 'Override Per Transaction',
    desc: 'This setting is the default for new transactions. You can always adjust the fee before sending each individual payment.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function DefaultFeeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const feePreference = useSettingsStore(s => s.feePreference);
  const setFeePreference = useSettingsStore(s => s.setFeePreference);
  const customFeeRate = useSettingsStore(s => s.customFeeRate);
  const setCustomFeeRate = useSettingsStore(s => s.setCustomFeeRate);

  const [showCustomInput, setShowCustomInput] = useState(feePreference === 'custom');
  const [customInput, setCustomInput] = useState(String(customFeeRate));
  // Only auto-focus when user explicitly selects custom, not on screen revisit
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);

  const handleSelect = useCallback(async (key: FeePreference) => {
    await haptics.trigger('selection');
    if (key === 'custom') {
      setShowCustomInput(true);
      setShouldAutoFocus(true);
      setCustomInput(String(customFeeRate));
    } else {
      setShowCustomInput(false);
      setShouldAutoFocus(false);
      setFeePreference(key);
    }
  }, [haptics, customFeeRate, setFeePreference]);

  const handleSaveCustom = useCallback(async () => {
    const rate = parseInt(customInput, 10);
    if (isNaN(rate) || rate < 1 || rate > 1000) {
      await haptics.trigger('error');
      return;
    }
    await haptics.trigger('success');
    setCustomFeeRate(rate);
    setFeePreference('custom');
  }, [customInput, haptics, setCustomFeeRate, setFeePreference]);

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const currentFeeLabel = feePreference === 'custom' ? `${customFeeRate} sat/vB` : FEE_OPTIONS.find(o => o.key === feePreference)?.label || 'Medium';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Animated.Text
          entering={FadeIn.duration(300)}
          style={[styles.largeTitle, { color: textPrimary }]}
        >
          Default Fee
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <Animated.View entering={FadeIn.delay(50).duration(400)} style={styles.heroSection}>
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.10)',
            }]}>
              <Ionicons name="flash" size={28} color="#007AFF" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Transaction Speed
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Set your default fee rate for new transactions.{'\n'}Higher fees mean faster confirmation.
          </Text>

          <View style={[styles.statusBadge, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
          }]}>
            <View style={[styles.statusDot, { backgroundColor: '#007AFF' }]} />
            <Text style={[styles.statusText, {
              color: isDark ? 'rgba(0,122,255,0.90)' : 'rgba(0,122,255,0.80)',
            }]}>
              {currentFeeLabel}
            </Text>
          </View>
        </Animated.View>

        {/* Fee Options */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>FEE PRESETS</Text>
        </Animated.View>
        {FEE_OPTIONS.map((opt, index) => {
          const isSelected = feePreference === opt.key;
          return (
            <Animated.View
              key={opt.key}
              entering={FadeIn.delay(120 + index * 30).duration(300)}
            >
              <TouchableOpacity
                style={[styles.optionCard, {
                  backgroundColor: surfaceBg,
                  borderColor: isSelected ? opt.color : 'transparent',
                  borderWidth: isSelected ? 1.5 : 0,
                }]}
                activeOpacity={0.7}
                onPress={() => handleSelect(opt.key)}
              >
                <View style={styles.optionTop}>
                  <View style={[styles.optionIconCircle, {
                    backgroundColor: isDark ? `${opt.color}1F` : `${opt.color}14`,
                  }]}>
                    <Ionicons name={opt.icon} size={20} color={opt.color} />
                  </View>
                  <View style={styles.optionContent}>
                    <Text style={[styles.optionTitle, { color: textPrimary }]}>{opt.label}</Text>
                    <Text style={[styles.optionSpeed, { color: textSecondary }]}>{opt.speed}</Text>
                  </View>
                  {isSelected && (
                    <View style={[styles.checkmark, { backgroundColor: opt.color }]}>
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <View style={[styles.optionDivider, { backgroundColor: dividerColor }]} />
                <Text style={[styles.optionDesc, { color: textSecondary }]}>{opt.desc}</Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}

        {/* Custom Fee Input */}
        {showCustomInput && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.customCard}>
            <PremiumInputCard label="CUSTOM FEE RATE">
              <PremiumInput
                icon="speedometer"
                iconColor="#BF5AF2"
                value={customInput}
                onChangeText={setCustomInput}
                placeholder="e.g. 15"
                keyboardType="number-pad"
                autoFocus={shouldAutoFocus}
                returnKeyType="done"
                onSubmitEditing={handleSaveCustom}
                centered
                rightElement={
                  <Text style={[styles.customUnit, { color: textMuted }]}>sat/vB</Text>
                }
              />
            </PremiumInputCard>
            <TouchableOpacity
              style={[styles.saveButton, {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#000000',
                opacity: (!customInput || isNaN(parseInt(customInput, 10)) || parseInt(customInput, 10) < 1 || parseInt(customInput, 10) > 1000) ? 0.3 : 1,
              }]}
              activeOpacity={0.85}
              onPress={handleSaveCustom}
              disabled={!customInput || isNaN(parseInt(customInput, 10)) || parseInt(customInput, 10) < 1 || parseInt(customInput, 10) > 1000}
            >
              <Text style={[styles.saveButtonText, { color: '#FFFFFF' }]}>
                Save Custom Fee
              </Text>
            </TouchableOpacity>
            <Text style={[styles.customHint, { color: textMuted }]}>
              Valid range: 1 - 1,000 sat/vB
            </Text>
          </Animated.View>
        )}

        {/* How It Works */}
        <Animated.View entering={FadeIn.delay(250).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>HOW IT WORKS</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(270).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {HOW_IT_WORKS.map((item, index) => (
            <View key={item.title}>
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, {
                  backgroundColor: isDark ? `${item.color}1F` : `${item.color}14`,
                }]}>
                  <Ionicons name={item.icon} size={17} color={item.color} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoTitle, { color: textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.infoDesc, { color: textSecondary }]}>{item.desc}</Text>
                </View>
              </View>
              {index < HOW_IT_WORKS.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeIn.delay(300).duration(300)} style={styles.footer}>
          <Ionicons name="information-circle" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            You can always adjust the fee rate before{'\n'}confirming each individual transaction.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 8 },
  backButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    marginLeft: -8, marginBottom: 4,
  },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  heroSection: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  heroRingOuter: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  heroRingInner: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginBottom: 8 },
  heroSubtitle: {
    fontSize: 15, fontWeight: '400', lineHeight: 22,
    textAlign: 'center', maxWidth: '88%', marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 13, fontWeight: '600' },

  sectionLabel: {
    fontSize: 13, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 10, paddingLeft: 2,
  },

  // Option cards
  optionCard: { borderRadius: 20, padding: 20, marginBottom: 10 },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  optionIconCircle: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  optionContent: { flex: 1 },
  optionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3, marginBottom: 2 },
  optionSpeed: { fontSize: 14, fontWeight: '500' },
  optionDivider: { height: StyleSheet.hairlineWidth, marginTop: 16, marginBottom: 14 },
  optionDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  checkmark: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  // Custom fee
  customCard: { marginBottom: 10 },
  customUnit: { fontSize: 14, fontWeight: '500' },
  saveButton: {
    height: 50, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  saveButtonText: { fontSize: 16, fontWeight: '600' },
  customHint: { fontSize: 12, fontWeight: '400', textAlign: 'center' },

  // Info rows
  card: { borderRadius: 20, padding: 18, marginBottom: 4 },
  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 14, paddingHorizontal: 18, gap: 14,
  },
  infoIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  infoContent: { flex: 1 },
  infoTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginBottom: 3 },
  infoDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  infoDivider: { height: StyleSheet.hairlineWidth, marginLeft: 70, marginRight: 18 },

  footer: { alignItems: 'center', paddingTop: 24, paddingBottom: 8, gap: 8 },
  footerText: { fontSize: 13, fontWeight: '400', lineHeight: 19, textAlign: 'center' },
});
