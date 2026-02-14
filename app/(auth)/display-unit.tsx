import '../../shim';
import React from 'react';
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
import { useTheme, useHaptics } from '../../src/hooks';
import { BITCOIN_UNITS } from '../../src/constants';
import { formatUnitAmount } from '../../src/utils/formatting';
import type { BitcoinUnit } from '../../src/types';

// ─── Data ──────────────────────────────────────────────────────

const UNIT_OPTIONS: {
  key: BitcoinUnit;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  example: string;
  desc: string;
}[] = [
  {
    key: 'btc',
    label: 'Bitcoin (BTC)',
    icon: 'logo-bitcoin',
    color: '#FF9F0A',
    example: formatUnitAmount(100_000, 'btc', true),
    desc: 'Standard Bitcoin notation with up to 8 decimal places. Most commonly used on exchanges.',
  },
  {
    key: 'mbtc',
    label: 'Millibitcoin (mBTC)',
    icon: 'flash-outline',
    color: '#FF6B6B',
    example: formatUnitAmount(100_000, 'mbtc', true),
    desc: '1 mBTC = 0.001 BTC (100,000 sats). Convenient for mid-range amounts.',
  },
  {
    key: 'ubtc',
    label: 'Bits (\u00B5BTC)',
    icon: 'diamond-outline',
    color: '#BF5AF2',
    example: formatUnitAmount(100_000, 'ubtc', true),
    desc: '1 bit = 0.000001 BTC (100 sats). Good balance between precision and readability.',
  },
  {
    key: 'sat',
    label: 'Satoshi (sats)',
    icon: 'grid-outline',
    color: '#007AFF',
    example: formatUnitAmount(100_000, 'sat', true),
    desc: 'The smallest unit of Bitcoin (1 sat = 0.00000001 BTC). No decimals needed.',
  },
  {
    key: 'cbtc',
    label: 'Centibitcoin (cBTC)',
    icon: 'layers-outline',
    color: '#30D158',
    example: formatUnitAmount(100_000, 'cbtc', true),
    desc: '1 cBTC = 0.01 BTC (1,000,000 sats). Similar scale to fiat cents.',
  },
  {
    key: 'dbtc',
    label: 'Decibitcoin (dBTC)',
    icon: 'pie-chart-outline',
    color: '#FFD60A',
    example: formatUnitAmount(100_000, 'dbtc', true),
    desc: '1 dBTC = 0.1 BTC (10,000,000 sats). Useful for larger amounts.',
  },
];

const DETAILS = [
  {
    icon: 'calculator-outline' as const,
    color: '#30D158',
    title: '1 BTC = 100,000,000 sats',
    desc: 'One Bitcoin equals one hundred million satoshis, named after the creator Satoshi Nakamoto.',
  },
  {
    icon: 'swap-horizontal-outline' as const,
    color: '#FF9F0A',
    title: 'Instant Conversion',
    desc: 'Changing units is purely cosmetic \u2014 your actual balance never changes, only how it\u2019s displayed.',
  },
  {
    icon: 'phone-portrait-outline' as const,
    color: '#007AFF',
    title: 'Applied Everywhere',
    desc: 'Your chosen unit is used across all screens: portfolio, send, receive, transaction details, and more.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function DisplayUnitScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const { denomination, setDenomination } = useSettingsStore();

  const handleSelect = async (key: BitcoinUnit) => {
    setDenomination(key);
    await haptics.trigger('success');
  };

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const currentUnit = BITCOIN_UNITS[denomination];

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
          Display Unit
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View entering={FadeIn.delay(50).duration(400)} style={styles.heroSection}>
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.10)',
            }]}>
              <Ionicons name="logo-bitcoin" size={28} color="#FF9F0A" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Choose Your Unit
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Pick how Bitcoin amounts are displayed{'\n'}throughout the app. Your balance stays the same.
          </Text>

          <View style={[styles.statusBadge, {
            backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
          }]}>
            <View style={[styles.statusDot, { backgroundColor: '#FF9F0A' }]} />
            <Text style={[styles.statusText, {
              color: isDark ? 'rgba(255,159,10,0.90)' : 'rgba(255,159,10,0.80)',
            }]}>
              {currentUnit.label} ({currentUnit.symbol})
            </Text>
          </View>
        </Animated.View>

        {/* Selection Cards */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>CHOOSE UNIT</Text>
        </Animated.View>
        {UNIT_OPTIONS.map((opt, index) => {
          const isSelected = denomination === opt.key;
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
                    <Text style={[styles.optionExample, { color: textSecondary }]}>{opt.example}</Text>
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

        {/* Conversion Info */}
        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>GOOD TO KNOW</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(220).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {DETAILS.map((item, index) => (
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
              {index < DETAILS.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeIn.delay(260).duration(300)} style={styles.footer}>
          <Ionicons name="information-circle" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            This only changes display formatting.{'\n'}No wallet data is modified.
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
  optionExample: { fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] as any },
  optionDivider: { height: StyleSheet.hairlineWidth, marginTop: 16, marginBottom: 14 },
  optionDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  checkmark: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

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
