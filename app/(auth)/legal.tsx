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

// ─── Data ──────────────────────────────────────────────────────

const LEGAL_LINKS = [
  { icon: 'shield-checkmark-outline' as const, label: 'Privacy Policy', subtitle: 'satryn.com/privacy', url: 'https://satryn.com/privacy' },
  { icon: 'document-text-outline' as const, label: 'Terms of Use', subtitle: 'satryn.com/terms', url: 'https://satryn.com/terms' },
];

const CONTACT_LINKS = [
  { icon: 'globe-outline' as const, label: 'Contact Us', subtitle: 'satryn.com/contact', url: 'https://satryn.com/contact' },
  { icon: 'mail-outline' as const, label: 'Email Support', subtitle: 'support@satryn.com', url: 'mailto:support@satryn.com?subject=Satryn%20Support%20Request' },
];

// ─── Component ──────────────────────────────────────────────────

export default function LegalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  // Design tokens
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const chevronColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';

  const openURL = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  const renderLinkCard = (links: readonly { icon: keyof typeof Ionicons.glyphMap; label: string; subtitle: string; url: string }[]) => (
    <View style={[styles.card, { backgroundColor: surfaceBg }]}>
      {links.map((item, index) => (
        <View key={item.label}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => openURL(item.url)}
            activeOpacity={0.7}
          >
            <View style={[styles.linkIcon, { backgroundColor: mutedBg }]}>
              <Ionicons name={item.icon} size={16} color={mutedText} />
            </View>
            <View style={styles.linkContent}>
              <Text style={[styles.linkLabel, { color: colors.text }]}>{item.label}</Text>
              <Text style={[styles.linkSubtitle, { color: mutedText }]}>{item.subtitle}</Text>
            </View>
            <Ionicons name="open-outline" size={14} color={chevronColor} />
          </TouchableOpacity>
          {index < links.length - 1 && (
            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          )}
        </View>
      ))}
    </View>
  );

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
        <Text style={[styles.largeTitle, { color: colors.text }]}>Legal & Support</Text>

        {/* ── Hero ────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.heroSection}>
          <Text style={[styles.heroSubtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.50)' }]}>
            Important information about our app and how to reach us.
          </Text>
        </Animated.View>

        {/* ── Legal Links ─────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(80).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>LEGAL</Text>
          {renderLinkCard(LEGAL_LINKS)}
        </Animated.View>

        {/* ── Contact ─────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>CONTACT</Text>
          {renderLinkCard(CONTACT_LINKS)}
        </Animated.View>

        {/* ── Footer ──────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(240).duration(400)} style={styles.footer}>
          <Text style={[styles.footerText, { color: chevronColor }]}>
            Satryn Bitcoin Wallet
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
    paddingBottom: 8,
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
    paddingHorizontal: 18,
    marginBottom: 4,
  },

  // ── Link Row ──────────────────────
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  linkIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  linkContent: {
    flex: 1,
    marginRight: 8,
  },
  linkLabel: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  linkSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },

  // ── Divider ──────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
  },

  // ── Footer ──────────────────────
  footer: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 16,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
