import '../../shim';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../src/hooks';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─────────────────────────────────────────────────────────────────────────────
// Types & Data
// ─────────────────────────────────────────────────────────────────────────────

interface ImportOption {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  badge: 'recommended' | 'advanced' | 'limited';
}

const IMPORT_OPTIONS: ImportOption[] = [
  {
    id: 'xpub',
    title: 'Extended Public Key',
    description: 'Import an account xpub. Derives all addresses automatically.',
    icon: 'key-outline',
    route: '/(auth)/import-xpub',
    badge: 'recommended',
  },
  {
    id: 'descriptor',
    title: 'Output Descriptor',
    description: 'For multisig and custom derivation paths.',
    icon: 'code-slash-outline',
    route: '/(auth)/import-descriptor',
    badge: 'advanced',
  },
  {
    id: 'addresses',
    title: 'Address List',
    description: 'Track specific addresses. No derivation.',
    icon: 'list-outline',
    route: '/(auth)/import-addresses',
    badge: 'limited',
  },
];

// Semantic icon tinting
const ICON_COLORS: Record<string, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
  'key-outline':        { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'code-slash-outline': { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  'list-outline':       { light: { bg: 'rgba(90,200,250,0.10)', color: '#5AC8FA' }, dark: { bg: 'rgba(100,210,255,0.18)', color: '#64D2FF' } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Import Option Card — interactive row with press animation + chevron
// ─────────────────────────────────────────────────────────────────────────────

function ImportCard({ option, onPress, isDark, isLast }: {
  option: ImportOption;
  onPress: (option: ImportOption) => void;
  isDark: boolean;
  isLast: boolean;
}) {
  const isRecommended = option.badge === 'recommended';
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const getBadgeText = () => {
    switch (option.badge) {
      case 'recommended': return 'Recommended';
      case 'advanced': return 'Advanced';
      case 'limited': return 'Limited';
    }
  };

  const iconTheme = ICON_COLORS[option.icon as string];
  const iconBg = iconTheme ? (isDark ? iconTheme.dark.bg : iconTheme.light.bg) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
  const iconColor = iconTheme ? (isDark ? iconTheme.dark.color : iconTheme.light.color) : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)');

  return (
    <AnimatedPressable
      onPress={() => onPress(option)}
      onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
    >
      <Animated.View style={[styles.optionRow, animStyle]}>
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={option.icon} size={16} color={iconColor} />
        </View>
        <View style={styles.optionContent}>
          <View style={styles.optionTitleRow}>
            <Text style={[styles.optionTitle, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]} numberOfLines={1}>
              {option.title}
            </Text>
            <View style={[styles.badge, {
              backgroundColor: isRecommended
                ? (isDark ? 'rgba(255,159,10,0.18)' : 'rgba(255,149,0,0.10)')
                : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'),
            }]}>
              <Text style={[styles.badgeText, {
                color: isRecommended
                  ? (isDark ? '#FF9F0A' : '#FF9500')
                  : (isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)'),
              }]}>
                {getBadgeText()}
              </Text>
            </View>
          </View>
          <Text style={[styles.optionDesc, {
            color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
          }]} numberOfLines={1}>
            {option.description}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'} />
        {!isLast && (
          <View style={[styles.rowDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />
        )}
      </Animated.View>
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ImportWatchOnlyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const handleBack = async () => {
    await haptics.trigger('light');
    router.back();
  };

  const handleOptionPress = async (option: ImportOption) => {
    await haptics.trigger('selection');
    router.push(option.route as any);
  };

  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title — left-aligned, matching import screen pattern */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color: colors.text }]}>Watch-Only</Text>
          <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
            Full visibility without exposing private keys. Signing happens on your external device.
          </Text>
        </View>

        {/* Import Method — interactive card */}
        <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
          IMPORT METHOD
        </Text>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          {IMPORT_OPTIONS.map((option, i) => (
            <ImportCard key={option.id} option={option} onPress={handleOptionPress} isDark={isDark} isLast={i === IMPORT_OPTIONS.length - 1} />
          ))}
        </View>

        {/* Capabilities — plain text list, visually distinct from buttons */}
        <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
          CAPABILITIES
        </Text>
        <View style={styles.capabilityList}>
          {[
            'View balance and transaction history',
            'Generate new receive addresses',
            'Create unsigned transactions (PSBTs)',
          ].map((text, i) => (
            <View key={i} style={styles.capabilityItem}>
              <Ionicons name="checkmark" size={15} color={isDark ? '#30D158' : '#34C759'} />
              <Text style={[styles.capabilityText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
                {text}
              </Text>
            </View>
          ))}
        </View>

        {/* Security notice — accent bar style matching import screen */}
        <View style={[styles.securityNotice, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]}>
          <View style={[styles.securityAccent, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)' }]} />
          <View style={styles.securityContent}>
            <Ionicons name="shield-checkmark-outline" size={16} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)'} />
            <Text style={[styles.securityText, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
              No private keys are stored. Your keys never leave your signing device.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  // Title — left-aligned, sub-screen style
  titleSection: { marginBottom: 20 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, maxWidth: '95%' },

  // Section
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 24, marginBottom: 8, paddingLeft: 4 },
  card: { borderRadius: 20, overflow: 'hidden' },

  // Interactive option rows
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, minHeight: 56, position: 'relative' },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  optionContent: { flex: 1, marginRight: 8 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  optionTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginRight: 8 },
  optionDesc: { fontSize: 13, fontWeight: '500' },
  rowDivider: { position: 'absolute', bottom: 0, left: 64, right: 16, height: StyleSheet.hairlineWidth },

  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },

  // Capabilities — plain text, NOT a card
  capabilityList: { gap: 12, paddingLeft: 4 },
  capabilityItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  capabilityText: { fontSize: 15, fontWeight: '400', lineHeight: 22 },

  // Security notice — accent bar style
  securityNotice: { flexDirection: 'row', borderRadius: 14, marginTop: 28, overflow: 'hidden' },
  securityAccent: { width: 3 },
  securityContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingLeft: 12, gap: 10 },
  securityText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '400' },
});
