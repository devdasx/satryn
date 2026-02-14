import '../../shim';
import React, { useCallback } from 'react';
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
import { DERIVATION } from '../../src/constants';

// ─── Data ──────────────────────────────────────────────────────

const GAP_OPTIONS = DERIVATION.GAP_LIMIT_OPTIONS.map((opt) => {
  const isDefault = opt.value === 20;
  const isMax = opt.value === 200;
  return {
    value: opt.value,
    label: opt.label,
    icon: (isDefault ? 'shield-checkmark-outline' : isMax ? 'rocket-outline' : 'layers-outline') as keyof typeof Ionicons.glyphMap,
    color: isDefault ? '#30D158' : isMax ? '#FF453A' : '#007AFF',
    desc: isDefault
      ? 'Standard BIP44 gap limit. Works perfectly for most wallets with normal usage.'
      : opt.value === 50
        ? 'Scans 50 unused addresses ahead. Useful if you generated many addresses in other wallets.'
        : opt.value === 100
          ? 'Scans 100 unused addresses. Recommended for wallets that were heavily used in other software.'
          : 'Maximum scan depth. Use only if you know you have transactions beyond 100 unused addresses.',
  };
});

const EXPLANATIONS = [
  {
    icon: 'git-branch-outline' as const,
    color: '#FF9F0A',
    title: 'What is a Gap Limit?',
    desc: 'HD wallets generate addresses in sequence. The gap limit is how many consecutive unused addresses to check before stopping the scan.',
  },
  {
    icon: 'search-outline' as const,
    color: '#007AFF',
    title: 'Address Discovery',
    desc: 'During wallet sync, Satryn scans addresses sequentially. If it finds this many empty addresses in a row, it assumes the rest are unused.',
  },
  {
    icon: 'speedometer-outline' as const,
    color: '#30D158',
    title: 'Sync Speed Trade-off',
    desc: 'Higher gap limits mean more addresses to check, which increases sync time. Only increase if you\'re missing transactions or addresses.',
  },
  {
    icon: 'alert-circle-outline' as const,
    color: '#FF453A',
    title: 'When to Increase',
    desc: 'If you used this wallet in another app that skipped addresses, or if you generated many unused receiving addresses, try increasing the gap limit.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function GapLimitScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const gapLimit = useSettingsStore(s => s.gapLimit);
  const setGapLimit = useSettingsStore(s => s.setGapLimit);

  const handleSelect = useCallback(async (value: number) => {
    setGapLimit(value);
    await haptics.trigger('success');
  }, [setGapLimit, haptics]);

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

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
          Address Gap Limit
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
            backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.10)',
            }]}>
              <Ionicons name="layers" size={28} color="#007AFF" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Scan Depth
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Control how many unused addresses Satryn{'\n'}scans ahead during wallet synchronization.
          </Text>

          <View style={[styles.statusBadge, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
          }]}>
            <View style={[styles.statusDot, { backgroundColor: '#007AFF' }]} />
            <Text style={[styles.statusText, {
              color: isDark ? 'rgba(0,122,255,0.90)' : 'rgba(0,122,255,0.80)',
            }]}>
              {gapLimit} addresses
            </Text>
          </View>
        </Animated.View>

        {/* Gap Limit Options */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>SCAN AHEAD</Text>
        </Animated.View>
        {GAP_OPTIONS.map((opt, index) => {
          const isSelected = gapLimit === opt.value;
          return (
            <Animated.View
              key={opt.value}
              entering={FadeIn.delay(120 + index * 30).duration(300)}
            >
              <TouchableOpacity
                style={[styles.optionCard, {
                  backgroundColor: surfaceBg,
                  borderColor: isSelected ? opt.color : 'transparent',
                  borderWidth: isSelected ? 1.5 : 0,
                }]}
                activeOpacity={0.7}
                onPress={() => handleSelect(opt.value)}
              >
                <View style={styles.optionTop}>
                  <View style={[styles.optionIconCircle, {
                    backgroundColor: isDark ? `${opt.color}1F` : `${opt.color}14`,
                  }]}>
                    <Ionicons name={opt.icon} size={20} color={opt.color} />
                  </View>
                  <View style={styles.optionContent}>
                    <Text style={[styles.optionTitle, { color: textPrimary }]}>{opt.label}</Text>
                    <Text style={[styles.optionSubtitle, { color: textSecondary }]}>
                      {opt.value === 20 ? 'Recommended' : `${opt.value} unused addresses`}
                    </Text>
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

        {/* Explanations */}
        <Animated.View entering={FadeIn.delay(250).duration(300)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>UNDERSTANDING GAP LIMITS</Text>
            <Text style={[styles.sectionCount, { color: textMuted }]}>{EXPLANATIONS.length}</Text>
          </View>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(270).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {EXPLANATIONS.map((item, index) => (
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
              {index < EXPLANATIONS.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeIn.delay(300).duration(300)} style={styles.footer}>
          <Ionicons name="information-circle" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            Changes take effect on the next wallet sync.{'\n'}A higher limit may increase sync time.
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
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingRight: 4,
  },
  sectionCount: {
    fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'],
    paddingTop: 14,
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
  optionSubtitle: { fontSize: 14, fontWeight: '500' },
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
