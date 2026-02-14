import '../../shim';
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  useColorScheme,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSettingsStore } from '../../src/stores';
import { getThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';

// ─── Data ──────────────────────────────────────────────────────

const TECH_STACK = [
  { label: 'TypeScript', detail: 'Primary language', icon: 'code-slash-outline' as const },
  { label: 'React Native', detail: 'Cross-platform UI framework', icon: 'phone-portrait-outline' as const },
  { label: 'Expo SDK 54', detail: 'Development platform', icon: 'layers-outline' as const },
  { label: 'bitcoinjs-lib', detail: 'Bitcoin protocol & cryptography', icon: 'logo-bitcoin' as const },
  { label: 'Electrum Protocol', detail: 'Lightweight SPV via TCP/TLS', icon: 'flash-outline' as const },
  { label: 'Zustand', detail: 'Reactive state management', icon: 'git-branch-outline' as const },
  { label: 'expo-secure-store', detail: 'iOS Keychain integration', icon: 'lock-closed-outline' as const },
  { label: 'expo-local-authentication', detail: 'Face ID / Touch ID', icon: 'finger-print-outline' as const },
  { label: 'React Native Reanimated', detail: 'Fluid 60fps animations', icon: 'sparkles-outline' as const },
  { label: 'expo-sqlite', detail: 'Native SQLite persistence', icon: 'server-outline' as const },
  { label: 'react-native-true-sheet', detail: 'Native iOS bottom sheets', icon: 'albums-outline' as const },
  { label: 'Nearby Connections', detail: 'Device-to-device transfers', icon: 'bluetooth-outline' as const },
  { label: 'expo-camera', detail: 'QR code scanning', icon: 'camera-outline' as const },
  { label: 'expo-blur', detail: 'Native blur effects', icon: 'eye-outline' as const },
  { label: '@bitcoinerlab/secp256k1', detail: 'Elliptic curve cryptography', icon: 'shield-checkmark-outline' as const },
];

const FEATURES = [
  'Full HD wallet (BIP32/39/44/49/84/86)',
  'SegWit, Nested SegWit, Taproot & Legacy',
  'Multi-wallet management',
  'Multisig wallet support (m-of-n)',
  'Watch-only wallets (xpub, descriptor)',
  'Import from Electrum, seed, xprv, WIF',
  'PSBT workflow for offline signing',
  'UTXO management with coin control',
  'Nearby device-to-device payments',
  'Address poisoning & fraud detection',
  'Visual address review (chunked characters)',
  'Deep address sanitization & validation',
  'RBF fee bumping (replace-by-fee)',
  'Custom Electrum server with health stats',
  'Server switching from list view',
  'Auto-reconnect with exponential backoff',
  'iCloud encrypted backup & restore',
  'PIN + Face ID / Touch ID authentication',
  'SQLite database with migration system',
  'Contact management with address book',
  'QR code scanning & generation',
  'Real-time price tracking & conversion',
  'Privacy mode (single-input preference)',
  'Inline copy feedback & haptic responses',
];

// ─── Component ──────────────────────────────────────────────────

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const openURL = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  // Design tokens
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const chevronColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';

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
        <Text style={[styles.largeTitle, { color: colors.text }]}>About</Text>

        {/* ── Hero ────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.heroSection}>
          <Image
            source={isDark ? require('../../darkLogo.png') : require('../../appLogo.png')}
            style={styles.heroLogo}
            resizeMode="contain"
          />
          <Text style={[styles.heroVersion, { color: mutedText }]}>
            Version 1.0.0
          </Text>
          <Text style={[styles.heroSubtitle, { color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.50)' }]}>
            A fully open-source Bitcoin wallet built with privacy and self-custody in mind. Your keys, your coins.
          </Text>
        </Animated.View>

        {/* ── Open Source ─────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(80).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>OPEN SOURCE</Text>
          <TouchableOpacity
            style={[styles.card, { backgroundColor: surfaceBg }]}
            onPress={() => openURL('https://github.com/devdasx/satryn')}
            activeOpacity={0.7}
          >
            <View style={styles.githubCardTop}>
              <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                <Ionicons name="logo-github" size={18} color={mutedText} />
              </View>
              <View style={styles.githubInfo}>
                <Text style={[styles.githubName, { color: colors.text }]}>devdasx/satryn</Text>
                <Text style={[styles.githubDesc, { color: mutedText }]}>
                  Satryn Bitcoin Wallet — Open Source
                </Text>
              </View>
              <Ionicons name="open-outline" size={15} color={chevronColor} />
            </View>
            <View style={[styles.githubDivider, { backgroundColor: dividerColor }]} />
            <View style={styles.githubTags}>
              <View style={[styles.tag, { backgroundColor: mutedBg }]}>
                <Text style={[styles.tagText, { color: mutedText }]}>TypeScript</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: mutedBg }]}>
                <Text style={[styles.tagText, { color: mutedText }]}>React Native</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: mutedBg }]}>
                <Text style={[styles.tagText, { color: mutedText }]}>Bitcoin</Text>
              </View>
            </View>
          </TouchableOpacity>
          <Text style={[styles.openSourceNote, { color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }]}>
            Satryn is fully open source. Anyone can audit the code, contribute improvements, or verify the security of the wallet.
          </Text>
        </Animated.View>

        {/* ── Tech Stack ──────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>TECH STACK</Text>
            <Text style={[styles.sectionCount, { color: chevronColor }]}>
              {TECH_STACK.length}
            </Text>
          </View>
          <View style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}>
            {TECH_STACK.map((item, index) => (
              <View key={item.label}>
                <View style={styles.techRow}>
                  <View style={[styles.techIcon, { backgroundColor: mutedBg }]}>
                    <Ionicons name={item.icon} size={14} color={mutedText} />
                  </View>
                  <View style={styles.techContent}>
                    <Text style={[styles.techLabel, { color: colors.text }]}>{item.label}</Text>
                    <Text style={[styles.techDetail, { color: mutedText }]}>{item.detail}</Text>
                  </View>
                </View>
                {index < TECH_STACK.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: dividerColor }]} />
                )}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── Features ────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(240).duration(400)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>FEATURES</Text>
            <Text style={[styles.sectionCount, { color: chevronColor }]}>
              {FEATURES.length}
            </Text>
          </View>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {FEATURES.map((feature, index) => (
              <View key={index} style={styles.featureRow}>
                <View style={[styles.featureDot, { backgroundColor: mutedText }]} />
                <Text style={[styles.featureText, { color: isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)' }]}>
                  {feature}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── Footer ──────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(320).duration(400)} style={styles.footer}>
          <Text style={[styles.footerText, { color: chevronColor }]}>
            Built with care for the Bitcoin community
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
    paddingTop: 8,
    paddingBottom: 32,
  },
  heroLogo: {
    width: 200,
    height: 64,
    marginBottom: 12,
  },
  heroVersion: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: '85%',
  },

  // ── Card ──────────────────────
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
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

  // ── Icon Circle ──────────────────────
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── GitHub Card ──────────────────────
  githubCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  githubInfo: {
    flex: 1,
  },
  githubName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  githubDesc: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  githubDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  githubTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  openSourceNote: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    marginBottom: 4,
  },

  // ── Tech Stack ──────────────────────
  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    gap: 12,
  },
  techIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  techContent: {
    flex: 1,
  },
  techLabel: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  techDetail: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 58,
    marginRight: 18,
  },

  // ── Features ──────────────────────
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  featureDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },

  // ── Footer ──────────────────────
  footer: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 16,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
