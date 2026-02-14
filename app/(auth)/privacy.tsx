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
import { FastSwitch } from '../../src/components/ui';

// ─── Data ──────────────────────────────────────────────────────

const COLLECT_ITEMS: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  desc: string;
}[] = [
  {
    icon: 'bug-outline',
    color: '#30D158',
    title: 'Crash Reports',
    desc: 'Stack traces when the app encounters a fatal error, helping us identify and fix issues quickly.',
  },
  {
    icon: 'warning-outline',
    color: '#FF9F0A',
    title: 'Error Logs',
    desc: 'Non-fatal errors and exceptions that may impact performance or reliability.',
  },
  {
    icon: 'phone-portrait-outline',
    color: '#007AFF',
    title: 'Device Info',
    desc: 'OS version, app version, and device model to ensure compatibility across devices.',
  },
];

const NEVER_ITEMS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { icon: 'key', label: 'Seed Phrases' },
  { icon: 'wallet', label: 'Wallet Balances' },
  { icon: 'swap-horizontal', label: 'Transactions' },
  { icon: 'person', label: 'Identity Data' },
  { icon: 'location', label: 'Location / IP' },
  { icon: 'finger-print', label: 'Biometric Data' },
];

const COMMITMENTS: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  desc: string;
}[] = [
  {
    icon: 'logo-github',
    color: '#8E8E93',
    title: 'Open Source',
    desc: 'Every line of code is publicly auditable.',
  },
  {
    icon: 'eye-off',
    color: '#BF5AF2',
    title: 'No Tracking',
    desc: 'No user tracking, profiling, or ad networks.',
  },
  {
    icon: 'shield-checkmark',
    color: '#30D158',
    title: 'End-to-End Encryption',
    desc: 'All sensitive data encrypted on-device with AES-256.',
  },
  {
    icon: 'trash',
    color: '#FF453A',
    title: 'Data Deletion',
    desc: 'Disable analytics at any time — data is never retained.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function PrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const analyticsEnabled = useSettingsStore(s => s.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore(s => s.setAnalyticsEnabled);

  const handleToggle = (value: boolean) => {
    setAnalyticsEnabled(value);
  };

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const accentPurple = '#BF5AF2';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
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
          Privacy & Analytics
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ───────────────────────────────────────── */}
        <Animated.View
          entering={FadeIn.delay(50).duration(400)}
          style={styles.heroSection}
        >
          {/* Nested icon rings */}
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(191,90,242,0.06)' : 'rgba(191,90,242,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(191,90,242,0.12)' : 'rgba(191,90,242,0.10)',
            }]}>
              <Ionicons name="eye-off" size={28} color={accentPurple} />
            </View>
          </View>

          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Privacy First
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Help us improve Satryn by sharing anonymous{'\n'}crash data. No personal or wallet data is ever collected.
          </Text>

          {/* Status badge */}
          <View style={[styles.statusBadge, {
            backgroundColor: analyticsEnabled
              ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
              : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
          }]}>
            <View style={[styles.statusDot, {
              backgroundColor: analyticsEnabled ? '#30D158' : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)'),
            }]} />
            <Text style={[styles.statusText, {
              color: analyticsEnabled
                ? (isDark ? 'rgba(48,209,88,0.90)' : 'rgba(48,209,88,0.80)')
                : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'),
            }]}>
              {analyticsEnabled ? 'Analytics Enabled' : 'Analytics Disabled'}
            </Text>
          </View>
        </Animated.View>

        {/* ── Toggle Card ────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>DATA COLLECTION</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(120).duration(300)}
          style={[styles.toggleCard, { backgroundColor: surfaceBg }]}
        >
          <View style={styles.toggleTop}>
            <View style={[styles.toggleIconCircle, {
              backgroundColor: isDark ? 'rgba(191,90,242,0.12)' : 'rgba(191,90,242,0.08)',
            }]}>
              <Ionicons name="analytics" size={20} color={accentPurple} />
            </View>
            <View style={styles.toggleContent}>
              <Text style={[styles.toggleTitle, { color: textPrimary }]}>
                Anonymous Analytics
              </Text>
              <Text style={[styles.toggleDesc, { color: textSecondary }]}>
                Crash reports and error logs are sent anonymously to help improve app stability.
              </Text>
            </View>
          </View>

          <View style={[styles.toggleDivider, { backgroundColor: dividerColor }]} />

          <View style={styles.toggleBottom}>
            <Text style={[styles.toggleStatusText, {
              color: analyticsEnabled
                ? (isDark ? 'rgba(48,209,88,0.80)' : '#30D158')
                : textMuted,
            }]}>
              {analyticsEnabled ? 'Enabled' : 'Disabled'}
            </Text>
            <FastSwitch
              value={analyticsEnabled}
              onValueChange={handleToggle}
              accentColor={accentPurple}
            />
          </View>
        </Animated.View>

        {/* ── What We Collect ────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(150).duration(300)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>WHAT WE COLLECT</Text>
            <Text style={[styles.sectionCount, { color: textMuted }]}>{COLLECT_ITEMS.length}</Text>
          </View>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(170).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {COLLECT_ITEMS.map((item, index) => (
            <View key={item.title}>
              <View style={styles.collectRow}>
                <View style={[styles.collectIcon, {
                  backgroundColor: isDark
                    ? `${item.color}1F`
                    : `${item.color}14`,
                }]}>
                  <Ionicons name={item.icon} size={17} color={item.color} />
                </View>
                <View style={styles.collectContent}>
                  <Text style={[styles.collectTitle, { color: textPrimary }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.collectDesc, { color: textSecondary }]}>
                    {item.desc}
                  </Text>
                </View>
              </View>
              {index < COLLECT_ITEMS.length - 1 && (
                <View style={[styles.collectDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* ── Never Collected ────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>NEVER COLLECTED</Text>
            <Text style={[styles.sectionCount, { color: textMuted }]}>{NEVER_ITEMS.length}</Text>
          </View>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(220).duration(300)}
          style={styles.neverGrid}
        >
          {NEVER_ITEMS.map((item) => (
            <View
              key={item.label}
              style={[styles.neverCard, { backgroundColor: surfaceBg }]}
            >
              <View style={styles.neverCardTop}>
                <View style={[styles.neverIconCircle, {
                  backgroundColor: isDark ? 'rgba(255,69,58,0.10)' : 'rgba(255,69,58,0.06)',
                }]}>
                  <Ionicons name={item.icon} size={16} color="#FF453A" />
                </View>
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={isDark ? 'rgba(255,69,58,0.35)' : 'rgba(255,69,58,0.30)'}
                />
              </View>
              <Text style={[styles.neverLabel, {
                color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)',
              }]}>
                {item.label}
              </Text>
            </View>
          ))}
        </Animated.View>

        {/* ── Our Commitment ─────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(250).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>OUR COMMITMENT</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(270).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {COMMITMENTS.map((item, index) => (
            <View key={item.title}>
              <View style={styles.commitRow}>
                <View style={[styles.commitIcon, {
                  backgroundColor: isDark
                    ? `${item.color}1F`
                    : `${item.color}14`,
                }]}>
                  <Ionicons name={item.icon} size={16} color={item.color} />
                </View>
                <View style={styles.commitContent}>
                  <Text style={[styles.commitTitle, { color: textPrimary }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.commitDesc, { color: textSecondary }]}>
                    {item.desc}
                  </Text>
                </View>
              </View>
              {index < COMMITMENTS.length - 1 && (
                <View style={[styles.collectDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* ── Footer ─────────────────────────────────────── */}
        <Animated.View
          entering={FadeIn.delay(300).duration(300)}
          style={styles.footer}
        >
          <Ionicons name="lock-closed" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            Analytics are completely optional and disabled{'\n'}by default. You can change this anytime.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 4,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // ── Hero ──────────────────────
  heroSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  heroRingOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroRingInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: '88%',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Section ──────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
    paddingLeft: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingTop: 14,
  },

  // ── Card ──────────────────────
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 4,
  },

  // ── Toggle Card ──────────────────────
  toggleCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 4,
  },
  toggleTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  toggleIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleContent: {
    flex: 1,
    paddingTop: 2,
  },
  toggleTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  toggleDesc: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  toggleDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 16,
    marginBottom: 14,
  },
  toggleBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Collect rows ──────────────────────
  collectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 14,
  },
  collectIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  collectContent: {
    flex: 1,
  },
  collectTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  collectDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },
  collectDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
    marginRight: 18,
  },

  // ── Never grid ──────────────────────
  neverGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  neverCard: {
    width: '47.5%',
    borderRadius: 16,
    padding: 14,
  },
  neverCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  neverIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  neverLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // ── Commitment rows ──────────────────────
  commitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 13,
    paddingHorizontal: 18,
    gap: 13,
  },
  commitIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  commitContent: {
    flex: 1,
  },
  commitTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  commitDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },

  // ── Footer ──────────────────────
  footer: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
    gap: 8,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
    textAlign: 'center',
  },
});
