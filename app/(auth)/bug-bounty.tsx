import '../../shim';
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../src/hooks';
import { THEME } from '../../src/constants';

// ─── Data ──────────────────────────────────────────────────────

const STEPS = [
  { step: '1', text: 'Find a security vulnerability in Satryn' },
  { step: '2', text: 'Document the issue with clear reproduction steps' },
  { step: '3', text: 'Send your report to bounty@satryn.com' },
  { step: '4', text: 'We\'ll review and respond within 72 hours' },
];

const SCOPE_ITEMS = [
  { icon: 'key-outline' as const, title: 'Key & Seed Security', desc: 'Vulnerabilities in private key handling, seed storage, or encryption' },
  { icon: 'swap-horizontal-outline' as const, title: 'Transaction Integrity', desc: 'Issues that could lead to unauthorized transactions or address manipulation' },
  { icon: 'lock-closed-outline' as const, title: 'Authentication Bypass', desc: 'PIN, biometric, or session management vulnerabilities' },
  { icon: 'server-outline' as const, title: 'Network Security', desc: 'Electrum protocol, API communication, or data leakage issues' },
];

const RULES = [
  'Do not publicly disclose the vulnerability before we patch it',
  'Do not access or modify other users\' data',
  'Provide enough detail for us to reproduce the issue',
  'Only test against your own wallet / accounts',
];

// ─── Component ──────────────────────────────────────────────────

export default function BugBountyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  // Design tokens
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const accentColor = isDark ? '#FF9F0A' : '#E68600';

  const handleReport = useCallback(() => {
    Linking.openURL('mailto:bounty@satryn.com?subject=' + encodeURIComponent('Satryn Bug Bounty Report')).catch(() => {});
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 40,
        }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        {/* Title */}
        <Text style={[styles.largeTitle, { color: colors.text }]}>Bug Bounty</Text>

        {/* ── Hero ────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.heroSection}>
          <View style={[styles.heroIcon, { backgroundColor: isDark ? 'rgba(255,149,0,0.10)' : 'rgba(255,149,0,0.08)' }]}>
            <Ionicons name="bug-outline" size={28} color={accentColor} />
          </View>
          <Text style={[styles.heroSubtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.50)' }]}>
            Help us keep Satryn secure. We reward responsible disclosure of security vulnerabilities.
          </Text>
        </Animated.View>

        {/* ── How It Works ────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(80).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>HOW IT WORKS</Text>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {STEPS.map((item, index) => (
              <View key={item.step}>
                <View style={styles.stepRow}>
                  <View style={[styles.stepBadge, { backgroundColor: mutedBg }]}>
                    <Text style={[styles.stepNumber, { color: mutedText }]}>{item.step}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.65)' }]}>
                    {item.text}
                  </Text>
                </View>
                {index < STEPS.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: dividerColor }]} />
                )}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── In Scope ────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>IN SCOPE</Text>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {SCOPE_ITEMS.map((item, index) => (
              <View key={item.title}>
                <View style={styles.scopeRow}>
                  <View style={[styles.scopeIcon, { backgroundColor: mutedBg }]}>
                    <Ionicons name={item.icon} size={16} color={mutedText} />
                  </View>
                  <View style={styles.scopeContent}>
                    <Text style={[styles.scopeTitle, { color: colors.text }]}>{item.title}</Text>
                    <Text style={[styles.scopeDesc, { color: mutedText }]}>{item.desc}</Text>
                  </View>
                </View>
                {index < SCOPE_ITEMS.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: dividerColor }]} />
                )}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── Rules ───────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(240).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>RULES</Text>
          <View style={[styles.card, { backgroundColor: surfaceBg, paddingVertical: 4 }]}>
            {RULES.map((rule, index) => (
              <View key={index} style={styles.ruleRow}>
                <View style={[styles.ruleDot, { backgroundColor: mutedText }]} />
                <Text style={[styles.ruleText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)' }]}>
                  {rule}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── CTA ─────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(320).duration(400)} style={styles.ctaSection}>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={handleReport}
            activeOpacity={0.85}
          >
            <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
            <Text style={[styles.ctaText, { color: '#FFFFFF' }]}>
              Report a Vulnerability
            </Text>
          </TouchableOpacity>
          <Text style={[styles.ctaSubtext, { color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }]}>
            bounty@satryn.com
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // ── Back + Title ──────────────────────
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
    marginBottom: 16,
  },

  // ── Hero ──────────────────────
  heroSection: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: '85%',
  },

  // ── Section ──────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    paddingTop: 22,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  // ── Card ──────────────────────
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 4,
  },

  // ── Steps ──────────────────────
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 21,
  },

  // ── Scope ──────────────────────
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
  },
  scopeIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  scopeContent: {
    flex: 1,
  },
  scopeTitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  scopeDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 2,
  },

  // ── Divider ──────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
  },

  // ── Rules ──────────────────────
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  ruleDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 7,
  },
  ruleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },

  // ── CTA ──────────────────────
  ctaSection: {
    alignItems: 'center',
    paddingTop: 28,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    paddingHorizontal: 28,
    gap: 10,
    width: '100%',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  ctaSubtext: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 10,
  },
});
