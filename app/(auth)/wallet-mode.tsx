/**
 * Wallet Mode — Premium settings detail page
 *
 * Redesigned with the app's unified design language: large title, subtitle,
 * hero selection cards with animated press, comparison table,
 * borderRadius 20, semantic icons, 13px/700 uppercase section headers,
 * 24px horizontal padding, staggered FadeIn animations.
 */

import '../../shim';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import type { WalletMode } from '../../src/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Mode Data ───────────────────────────────────────────────────────

const MODES: {
  key: WalletMode;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge: string;
  iconColor: { light: { bg: string; color: string }; dark: { bg: string; color: string } };
}[] = [
  {
    key: 'hd',
    label: 'HD Wallet',
    description: 'Generates a new address for each transaction, improving privacy by making it harder to link payments together.',
    icon: 'git-branch-outline',
    badge: 'Recommended',
    iconColor: {
      light: { bg: 'rgba(175,82,222,0.10)', color: '#AF52DE' },
      dark: { bg: 'rgba(191,90,242,0.18)', color: '#BF5AF2' },
    },
  },
  {
    key: 'simple',
    label: 'Simple Wallet',
    description: 'Reuses a single address for all transactions. Ideal for donation pages or tip jars where a static address is preferred.',
    icon: 'key-outline',
    badge: 'Basic',
    iconColor: {
      light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' },
      dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' },
    },
  },
];

// ─── Comparison Data ─────────────────────────────────────────────────

const COMPARISON_ROWS: {
  label: string;
  hd: string;
  simple: string;
  hdGood: boolean;
  simpleGood: boolean;
}[] = [
  { label: 'Privacy', hd: 'High', simple: 'Low', hdGood: true, simpleGood: false },
  { label: 'Addresses', hd: 'New each time', simple: 'Single reused', hdGood: true, simpleGood: false },
  { label: 'Change', hd: 'Separate output', simple: 'Same address', hdGood: true, simpleGood: false },
  { label: 'Gap Limit', hd: 'Configurable', simple: 'N/A', hdGood: true, simpleGood: false },
  { label: 'Complexity', hd: 'Standard', simple: 'Minimal', hdGood: false, simpleGood: true },
  { label: 'Best For', hd: 'Daily use', simple: 'Donations, tips', hdGood: false, simpleGood: false },
];

// ─── Mode Selection Card ─────────────────────────────────────────────

function ModeCard({
  mode,
  selected,
  onPress,
  isDark,
  colors,
}: {
  mode: typeof MODES[number];
  selected: boolean;
  onPress: () => void;
  isDark: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const iconTheme = isDark ? mode.iconColor.dark : mode.iconColor.light;
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const subtleText = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;

  const selectedBorder = selected
    ? { borderWidth: 1.5, borderColor: iconTheme.color }
    : { borderWidth: 1.5, borderColor: 'transparent' };

  return (
    <AnimatedPressable
      style={[
        styles.modeCard,
        { backgroundColor: surfaceBg },
        selectedBorder,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
    >
      {/* Top row: icon, label, badge, check */}
      <View style={styles.modeCardHeader}>
        <View style={[styles.modeIconCircle, { backgroundColor: iconTheme.bg }]}>
          <Ionicons name={mode.icon} size={18} color={iconTheme.color} />
        </View>
        <View style={styles.modeCardTitleArea}>
          <Text style={[styles.modeCardLabel, { color: colors.text }]}>
            {mode.label}
          </Text>
          <View style={[styles.modeBadge, {
            backgroundColor: selected
              ? (isDark ? `${iconTheme.color}18` : `${iconTheme.color}12`)
              : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
          }]}>
            <Text style={[styles.modeBadgeText, {
              color: selected ? iconTheme.color : subtleText,
            }]}>
              {mode.badge}
            </Text>
          </View>
        </View>
        {selected && (
          <View style={[styles.checkCircle, { backgroundColor: iconTheme.color }]}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* Description */}
      <Text style={[styles.modeCardDescription, { color: mutedText }]}>
        {mode.description}
      </Text>
    </AnimatedPressable>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function WalletModeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const { walletMode, setWalletMode } = useSettingsStore();

  // Design tokens
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const subtleText = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const handleSelectMode = async (mode: WalletMode) => {
    if (mode === walletMode) return;
    await haptics.trigger('selection');
    setWalletMode(mode);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <Animated.View entering={FadeIn.duration(250)}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </Animated.View>

        {/* Title */}
        <Animated.Text
          entering={FadeIn.duration(300).delay(30)}
          style={[styles.largeTitle, { color: colors.text }]}
        >
          Wallet Mode
        </Animated.Text>

        {/* Subtitle */}
        <Animated.Text
          entering={FadeIn.duration(300).delay(60)}
          style={[styles.subtitle, { color: mutedText }]}
        >
          Choose how your wallet manages addresses
        </Animated.Text>

        {/* ── Mode Cards ─────────────────────────────────────── */}
        {MODES.map((mode, index) => (
          <Animated.View
            key={mode.key}
            entering={FadeIn.delay(90 + index * 60).duration(350)}
          >
            <ModeCard
              mode={mode}
              selected={walletMode === mode.key}
              onPress={() => handleSelectMode(mode.key)}
              isDark={isDark}
              colors={colors}
            />
          </Animated.View>
        ))}

        {/* ── Comparison Section ──────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(210).duration(350)}>
          <Text style={[styles.sectionHeader, { color: sectionHeaderColor }]}>
            COMPARISON
          </Text>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(240).duration(350)}>
          <View style={[styles.comparisonCard, { backgroundColor: surfaceBg }]}>
            {/* Column Headers */}
            <View style={styles.tableHeaderRow}>
              <View style={styles.tableLabelCol} />
              <View style={[styles.tableValueCol, {
                backgroundColor: walletMode === 'hd'
                  ? (isDark ? 'rgba(191,90,242,0.08)' : 'rgba(175,82,222,0.05)')
                  : 'transparent',
                borderRadius: 10,
              }]}>
                <Text style={[styles.tableColHeader, {
                  color: isDark ? '#BF5AF2' : '#AF52DE',
                }]}>
                  HD Wallet
                </Text>
              </View>
              <View style={[styles.tableValueCol, {
                backgroundColor: walletMode === 'simple'
                  ? (isDark ? 'rgba(255,159,10,0.08)' : 'rgba(255,149,0,0.05)')
                  : 'transparent',
                borderRadius: 10,
              }]}>
                <Text style={[styles.tableColHeader, {
                  color: isDark ? '#FF9F0A' : '#FF9500',
                }]}>
                  Simple
                </Text>
              </View>
            </View>

            {/* Rows */}
            {COMPARISON_ROWS.map((row, index) => (
              <View key={row.label}>
                <View style={[styles.tableDivider, { backgroundColor: dividerColor }]} />
                <View style={styles.tableRow}>
                  <View style={styles.tableLabelCol}>
                    <Text style={[styles.tableLabel, { color: mutedText }]}>
                      {row.label}
                    </Text>
                  </View>
                  <View style={[styles.tableValueCol, {
                    backgroundColor: walletMode === 'hd'
                      ? (isDark ? 'rgba(191,90,242,0.08)' : 'rgba(175,82,222,0.05)')
                      : 'transparent',
                    borderRadius: 10,
                  }]}>
                    <View style={styles.tableValueRow}>
                      {row.hdGood && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color={isDark ? '#30D158' : '#34C759'}
                          style={styles.tableValueIcon}
                        />
                      )}
                      <Text style={[styles.tableValue, {
                        color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.80)',
                      }]}>
                        {row.hd}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.tableValueCol, {
                    backgroundColor: walletMode === 'simple'
                      ? (isDark ? 'rgba(255,159,10,0.08)' : 'rgba(255,149,0,0.05)')
                      : 'transparent',
                    borderRadius: 10,
                  }]}>
                    <View style={styles.tableValueRow}>
                      {row.simpleGood && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color={isDark ? '#30D158' : '#34C759'}
                          style={styles.tableValueIcon}
                        />
                      )}
                      <Text style={[styles.tableValue, {
                        color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.80)',
                      }]}>
                        {row.simple}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(300).duration(350)}>
          <Text style={[styles.footer, { color: subtleText }]}>
            Changes apply to new transactions only. Your existing addresses and transaction history remain unaffected.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '400',
    marginBottom: 20,
  },

  // ── Section headers ──────────────────
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 18,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  // ── Mode Cards ───────────────────────
  modeCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 10,
  },
  modeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  modeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCardTitleArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeCardLabel: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  modeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCardDescription: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    paddingLeft: 52,
  },

  // ── Comparison table ─────────────────
  comparisonCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 4,
    paddingVertical: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tableLabelCol: {
    flex: 1,
    justifyContent: 'center',
  },
  tableValueCol: {
    flex: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableColHeader: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  tableLabel: {
    fontSize: 13,
    fontWeight: '400',
  },
  tableValue: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  tableValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tableValueIcon: {
    marginTop: 1,
  },
  tableDivider: {
    marginHorizontal: 16,
    height: StyleSheet.hairlineWidth,
  },

  // ── Footer ───────────────────────────
  footer: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
