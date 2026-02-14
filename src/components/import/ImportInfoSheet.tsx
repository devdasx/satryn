/**
 * ImportInfoSheet
 * Premium info sheet explaining all supported import types and formats.
 * Tabbed layout with categories: Phrase, Keys, Extended, Seed, File, Watch-Only
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { AppBottomSheet } from '../ui/AppBottomSheet';

/* ─── Types ────────────────────────────────────────────────── */

interface ImportInfoSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface FormatInfo {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  example: string;
  notes?: string;
}

interface TabInfo {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  formats: FormatInfo[];
}

/* ─── Data ─────────────────────────────────────────────────── */

const TABS: TabInfo[] = [
  {
    key: 'phrase',
    label: 'Phrase',
    icon: 'reader-outline',
    title: 'Recovery Phrase',
    subtitle: 'BIP39 mnemonic seed words',
    formats: [
      {
        name: '12-Word Phrase',
        icon: 'grid-outline',
        description: 'Standard recovery phrase used by most wallets. 128-bit entropy.',
        example: 'abandon ability able about above absent ...',
      },
      {
        name: '15-Word Phrase',
        icon: 'grid-outline',
        description: 'Extended recovery phrase with 160-bit entropy. Less common.',
        example: 'abandon ability able about above absent absorb ...',
      },
      {
        name: '18-Word Phrase',
        icon: 'grid-outline',
        description: 'Extended recovery phrase with 192-bit entropy.',
        example: 'abandon ability able about above absent absorb abstract ...',
      },
      {
        name: '21-Word Phrase',
        icon: 'grid-outline',
        description: 'Extended recovery phrase with 224-bit entropy.',
        example: 'abandon ability able about above absent absorb abstract absurd ...',
      },
      {
        name: '24-Word Phrase',
        icon: 'shield-checkmark-outline',
        description: 'Maximum security recovery phrase. 256-bit entropy. Used by hardware wallets.',
        example: 'abandon ability able about above absent absorb abstract absurd abuse ...',
      },
      {
        name: 'With Passphrase',
        icon: 'key-outline',
        description: 'Optional BIP39 passphrase (25th word) for extra security. Creates a completely different wallet from the same seed.',
        example: 'Your phrase + custom passphrase',
        notes: 'Toggle "Passphrase" below the input field',
      },
    ],
  },
  {
    key: 'keys',
    label: 'Keys',
    icon: 'key-outline',
    title: 'Private Keys',
    subtitle: 'Individual key formats',
    formats: [
      {
        name: 'WIF (Compressed)',
        icon: 'lock-closed-outline',
        description: 'Wallet Import Format — the standard way to represent a single private key. Starts with K or L for mainnet.',
        example: 'KwDiBf89QgGbjE...',
      },
      {
        name: 'WIF (Uncompressed)',
        icon: 'lock-open-outline',
        description: 'Legacy uncompressed WIF format. Starts with 5 for mainnet. Produces different addresses than compressed.',
        example: '5HueCGU8rMjxE...',
      },
      {
        name: 'BIP38 Encrypted',
        icon: 'shield-outline',
        description: 'Password-encrypted private key. You\'ll be prompted for the decryption password. Starts with 6P.',
        example: '6PRVWUbkzzsbcVac2q...',
        notes: 'Requires decryption password',
      },
      {
        name: 'Hex Key',
        icon: 'code-outline',
        description: 'Raw 32-byte private key in hexadecimal. 64 characters of hex digits.',
        example: 'e8f32e723decf4051...',
      },
    ],
  },
  {
    key: 'extended',
    label: 'Extended',
    icon: 'git-branch-outline',
    title: 'Extended Keys',
    subtitle: 'HD wallet master keys',
    formats: [
      {
        name: 'xprv (Legacy)',
        icon: 'lock-closed-outline',
        description: 'Extended private key for Legacy (P2PKH) addresses. Full spending access. BIP44 derivation.',
        example: 'xprv9s21ZrQH143K...',
      },
      {
        name: 'yprv (Wrapped SegWit)',
        icon: 'lock-closed-outline',
        description: 'Extended private key for Wrapped SegWit (P2SH-P2WPKH) addresses. BIP49 derivation.',
        example: 'yprv9s21ZrQH143K...',
      },
      {
        name: 'zprv (Native SegWit)',
        icon: 'lock-closed-outline',
        description: 'Extended private key for Native SegWit (P2WPKH) addresses. Lowest fees. BIP84 derivation.',
        example: 'zprv9s21ZrQH143K...',
      },
      {
        name: 'With Passphrase',
        icon: 'key-outline',
        description: 'Extended keys can include an optional passphrase that was used during HD wallet derivation.',
        example: 'xprv... + custom passphrase',
        notes: 'Toggle "Passphrase" below the input field',
      },
    ],
  },
  {
    key: 'seed',
    label: 'Seed',
    icon: 'finger-print-outline',
    title: 'Seed Bytes',
    subtitle: 'Raw entropy in hexadecimal',
    formats: [
      {
        name: '16-Byte Seed',
        icon: 'code-outline',
        description: '128-bit seed entropy (32 hex characters). Equivalent to a 12-word phrase.',
        example: '0c1e24e5917779d297...',
      },
      {
        name: '32-Byte Seed',
        icon: 'code-outline',
        description: '256-bit seed entropy (64 hex characters). Equivalent to a 24-word phrase. Maximum security.',
        example: '0c1e24e5917779d297e14d45f14e1a1a...',
      },
      {
        name: 'Variable Length',
        icon: 'resize-outline',
        description: 'Supports 16 to 64 byte seeds (32 to 128 hex characters). Must be even length.',
        example: 'Any even-length hex string (32-128 chars)',
      },
      {
        name: 'With Passphrase',
        icon: 'key-outline',
        description: 'Seed bytes can be combined with an optional passphrase for additional security.',
        example: 'Hex seed + custom passphrase',
        notes: 'Toggle "Passphrase" below the input field',
      },
    ],
  },
  {
    key: 'file',
    label: 'File',
    icon: 'document-outline',
    title: 'Wallet Files',
    subtitle: 'Import from exported files',
    formats: [
      {
        name: 'Electrum JSON',
        icon: 'logo-electron',
        description: 'Electrum wallet export file (.json). Contains seed, xprv, or xpub depending on export settings.',
        example: '{"keystore": {"type": "bip32", ...}}',
      },
      {
        name: 'Bitcoin Core dumpwallet',
        icon: 'terminal-outline',
        description: 'Output of Bitcoin Core\'s dumpwallet command. Contains private keys with labels and metadata.',
        example: '# Wallet dump created by Bitcoin...',
      },
      {
        name: 'Descriptor Export',
        icon: 'list-outline',
        description: 'Output descriptor file containing wallet descriptors. Used by modern Bitcoin Core and other wallets.',
        example: 'wpkh([fingerprint/84h/0h/0h]xpub...)',
      },
      {
        name: 'Binary wallet.dat',
        icon: 'save-outline',
        description: 'Bitcoin Core binary wallet file. Requires specialized parsing.',
        example: 'wallet.dat binary file',
        notes: 'Limited support — text-based exports preferred',
      },
    ],
  },
  {
    key: 'watch',
    label: 'Watch',
    icon: 'eye-outline',
    title: 'Watch-Only',
    subtitle: 'Monitor without spending access',
    formats: [
      {
        name: 'xpub (Legacy)',
        icon: 'eye-outline',
        description: 'Extended public key for monitoring Legacy addresses. No spending capability.',
        example: 'xpub661MyMwAqRbc...',
      },
      {
        name: 'ypub (Wrapped SegWit)',
        icon: 'eye-outline',
        description: 'Extended public key for Wrapped SegWit addresses. Watch-only.',
        example: 'ypub6Ww3ibDFAg...',
      },
      {
        name: 'zpub (Native SegWit)',
        icon: 'eye-outline',
        description: 'Extended public key for Native SegWit addresses. Watch-only. Most modern format.',
        example: 'zpub6rFR7y4Q2A...',
      },
      {
        name: 'Watch Descriptor',
        icon: 'list-outline',
        description: 'Output descriptor containing only public keys. Creates a watch-only wallet from descriptor.',
        example: 'wpkh([fp/84h/0h/0h]xpub.../0/*)',
      },
    ],
  },
];

/* ─── Component ────────────────────────────────────────────── */

export function ImportInfoSheet({ visible, onClose }: ImportInfoSheetProps) {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState(0);

  const currentTab = TABS[activeTab];

  const handleTabPress = useCallback((index: number) => {
    setActiveTab(index);
  }, []);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing="large"
      scrollable
      title="Import Formats"
      subtitle="Supported wallet import types"
      contentKey={activeTab}
    >
      <View style={styles.body}>
        {/* Tab Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
          style={styles.tabBarScroll}
        >
          {TABS.map((tab, index) => {
            const isActive = index === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.7}
                onPress={() => handleTabPress(index)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: isActive
                      ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                      : 'transparent',
                    borderColor: isActive
                      ? 'transparent'
                      : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                  },
                ]}
              >
                <Ionicons
                  name={tab.icon}
                  size={16}
                  color={isActive
                    ? colors.text
                    : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)')
                  }
                />
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color: isActive
                        ? colors.text
                        : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'),
                      fontWeight: isActive ? '600' : '500',
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Category Header */}
        <Animated.View
          entering={FadeIn.duration(200)}
          key={`header-${currentTab.key}`}
          style={[
            styles.categoryHeader,
            { backgroundColor: isDark ? colors.surface : colors.surfaceSecondary },
          ]}
        >
          <View style={[
            styles.categoryIconWrap,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
          ]}>
            <Ionicons name={currentTab.icon} size={22} color={colors.text} />
          </View>
          <View style={styles.categoryTextWrap}>
            <Text style={[styles.categoryTitle, { color: colors.text }]}>
              {currentTab.title}
            </Text>
            <Text style={[styles.categorySubtitle, { color: colors.textMuted }]}>
              {currentTab.subtitle}
            </Text>
          </View>
        </Animated.View>

        {/* Format Cards */}
        {currentTab.formats.map((format, index) => (
          <Animated.View
            entering={FadeInDown.duration(250).delay(index * 40)}
            key={`${currentTab.key}-${format.name}`}
            style={[
              styles.formatCard,
              {
                backgroundColor: isDark ? colors.surface : colors.surfaceSecondary,
                borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              },
            ]}
          >
            <View style={styles.formatHeader}>
              <View style={[
                styles.formatIconWrap,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
              ]}>
                <Ionicons name={format.icon} size={18} color={colors.text} />
              </View>
              <Text style={[styles.formatName, { color: colors.text }]}>
                {format.name}
              </Text>
            </View>

            <Text style={[styles.formatDescription, { color: colors.textMuted }]}>
              {format.description}
            </Text>

            <View style={[
              styles.exampleBox,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)' },
            ]}>
              <Text style={[styles.exampleLabel, { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)' }]}>
                Example
              </Text>
              <Text
                style={[styles.exampleText, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}
                numberOfLines={1}
              >
                {format.example}
              </Text>
            </View>

            {format.notes && (
              <View style={styles.noteRow}>
                <Ionicons
                  name="information-circle-outline"
                  size={14}
                  color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'}
                />
                <Text style={[styles.noteText, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }]}>
                  {format.notes}
                </Text>
              </View>
            )}
          </Animated.View>
        ))}

        {/* Bottom spacing */}
        <View style={{ height: 16 }} />
      </View>
    </AppBottomSheet>
  );
}

/* ─── Styles ───────────────────────────────────────────────── */

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
  },

  // Tab bar
  tabBarScroll: {
    marginBottom: 16,
    marginHorizontal: -24,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  tabLabel: {
    fontSize: 13,
    letterSpacing: 0.1,
  },

  // Category header
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  categoryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTextWrap: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  categorySubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },

  // Format cards
  formatCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  formatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  formatIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  formatDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    marginBottom: 10,
  },

  // Example box
  exampleBox: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exampleLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  exampleText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Notes
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  noteText: {
    fontSize: 12,
    fontWeight: '400',
  },
});

export default ImportInfoSheet;
