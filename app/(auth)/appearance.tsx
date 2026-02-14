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
import { THEME } from '../../src/constants';
import { useTheme, useHaptics } from '../../src/hooks';
import { FastSwitch } from '../../src/components/ui';
import type { ThemeMode, ThemePreference } from '../../src/types';

// ─── Data ──────────────────────────────────────────────────────

const THEME_OPTIONS: {
  key: ThemeMode;
  label: string;
  desc: string;
  bg: string;
  surface: string;
  barLight: string;
  barDark: string;
  textColor: string;
}[] = [
  {
    key: 'light',
    label: 'Light',
    desc: 'Clean and bright. Great for daytime use and well-lit environments.',
    bg: '#FFFFFF',
    surface: '#F2F2F7',
    barLight: 'rgba(0,0,0,0.06)',
    barDark: 'rgba(0,0,0,0.04)',
    textColor: '#000000',
  },
  {
    key: 'dim',
    label: 'Dim',
    desc: 'Softer dark with warm navy tones. Easy on the eyes while keeping contrast.',
    bg: '#15202B',
    surface: '#1C2938',
    barLight: 'rgba(255,255,255,0.10)',
    barDark: 'rgba(255,255,255,0.06)',
    textColor: '#E7E9EA',
  },
  {
    key: 'midnight',
    label: 'Midnight',
    desc: 'Pure dark experience. Saves battery on OLED screens and reduces glare.',
    bg: '#0D0D0F',
    surface: '#1A1A1E',
    barLight: 'rgba(255,255,255,0.08)',
    barDark: 'rgba(255,255,255,0.05)',
    textColor: '#F5F5F7',
  },
];

const FEATURES = [
  {
    icon: 'eye-outline' as const,
    color: '#30D158',
    title: 'Adaptive Contrast',
    desc: 'Text and icons adjust automatically for maximum readability in any mode.',
  },
  {
    icon: 'battery-full' as const,
    color: '#007AFF',
    title: 'Battery Friendly',
    desc: 'Dark themes use less power on OLED displays, extending your battery life.',
  },
  {
    icon: 'color-palette-outline' as const,
    color: '#FF9F0A',
    title: 'Consistent Design',
    desc: 'Every screen and component is designed to look premium across all themes.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function AppearanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, themeMode, colors } = useTheme();
  const haptics = useHaptics();

  const appTheme = useSettingsStore(s => s.theme);
  const setTheme = useSettingsStore(s => s.setTheme);

  const isSystemEnabled = appTheme === 'system';

  // Resolve which ThemeMode card is visually selected
  const selectedMode: ThemeMode = isSystemEnabled ? themeMode : (appTheme as ThemeMode);

  const handleSelectTheme = async (key: ThemeMode) => {
    // When user picks a theme card, disable system and set that mode
    setTheme(key);
    await haptics.trigger('success');
  };

  const handleToggleSystem = (enabled: boolean) => {
    if (enabled) {
      setTheme('system');
    } else {
      // When disabling system, lock to whatever is currently resolved
      setTheme(themeMode);
    }
  };

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

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
          Appearance
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
              <Ionicons
                name={selectedMode === 'midnight' ? 'moon' : selectedMode === 'dim' ? 'cloudy-night' : 'sunny'}
                size={28}
                color="#007AFF"
              />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Choose Your Look
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Select how Satryn appears on your device.{'\n'}Your choice applies across all screens.
          </Text>

          {/* Status badge */}
          <View style={[styles.statusBadge, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
          }]}>
            <View style={[styles.statusDot, { backgroundColor: '#007AFF' }]} />
            <Text style={[styles.statusText, {
              color: isDark ? 'rgba(0,122,255,0.90)' : 'rgba(0,122,255,0.80)',
            }]}>
              {isSystemEnabled
                ? `System · ${selectedMode === 'light' ? 'Light' : selectedMode === 'dim' ? 'Dim' : 'Midnight'}`
                : selectedMode === 'light' ? 'Light' : selectedMode === 'dim' ? 'Dim' : 'Midnight'}
            </Text>
          </View>
        </Animated.View>

        {/* System toggle */}
        <Animated.View entering={FadeIn.delay(80).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>SYSTEM</Text>
          <View style={[styles.systemCard, { backgroundColor: surfaceBg }]}>
            <View style={styles.systemRow}>
              <View style={[styles.systemIcon, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.10)',
              }]}>
                <Ionicons name="phone-portrait-outline" size={17} color="#007AFF" />
              </View>
              <View style={styles.systemContent}>
                <Text style={[styles.systemTitle, { color: textPrimary }]}>Use Device Settings</Text>
                <Text style={[styles.systemDesc, { color: textSecondary }]}>
                  Automatically match your device's appearance
                </Text>
              </View>
              <FastSwitch
                value={isSystemEnabled}
                onValueChange={handleToggleSystem}
              />
            </View>
          </View>
        </Animated.View>

        {/* Theme Previews */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>THEME</Text>
        </Animated.View>
        <Animated.View entering={FadeIn.delay(120).duration(300)} style={styles.previewRow}>
          {THEME_OPTIONS.map((opt) => {
            const isSelected = selectedMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.previewCard, {
                  backgroundColor: opt.surface,
                  borderColor: isSelected
                    ? THEME.brand.bitcoin
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                  borderWidth: isSelected ? 2 : 1,
                }]}
                activeOpacity={0.7}
                onPress={() => handleSelectTheme(opt.key)}
              >
                <View style={[styles.previewPhone, { backgroundColor: opt.bg }]}>
                  <View style={[styles.previewBar, { backgroundColor: opt.barLight, width: '85%' }]} />
                  <View style={[styles.previewBar, { backgroundColor: opt.barDark, width: '60%' }]} />
                  <View style={[styles.previewBar, { backgroundColor: opt.barLight, width: '85%' }]} />
                  <View style={[styles.previewBar, { backgroundColor: opt.barDark, width: '45%' }]} />
                </View>
                <Text style={[styles.previewLabel, {
                  color: isSelected
                    ? (isDark ? '#FFFFFF' : '#000000')
                    : (isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)'),
                  fontWeight: isSelected ? '700' : '500',
                }]}>{opt.label}</Text>
                {isSelected && (
                  <View style={[styles.checkDot, { backgroundColor: THEME.brand.bitcoin }]}>
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        {isSystemEnabled && (
          <Animated.View entering={FadeIn.duration(200)}>
            <Text style={[styles.systemHint, { color: textMuted }]}>
              System is active — theme follows your device appearance.{'\n'}
              Selecting a card above will disable system mode.
            </Text>
          </Animated.View>
        )}

        {/* Details */}
        <Animated.View entering={FadeIn.delay(150).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>ABOUT EACH OPTION</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(170).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {THEME_OPTIONS.map((opt, index) => (
            <View key={opt.key}>
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, {
                  backgroundColor: opt.key === 'light'
                    ? (isDark ? 'rgba(255,159,10,0.15)' : 'rgba(255,159,10,0.10)')
                    : opt.key === 'dim'
                    ? (isDark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.10)')
                    : (isDark ? 'rgba(191,90,242,0.15)' : 'rgba(191,90,242,0.10)'),
                }]}>
                  <Ionicons
                    name={opt.key === 'light' ? 'sunny-outline' : opt.key === 'dim' ? 'cloudy-night-outline' : 'moon-outline'}
                    size={17}
                    color={opt.key === 'light' ? '#FF9F0A' : opt.key === 'dim' ? '#1D9BF0' : '#BF5AF2'}
                  />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoTitle, { color: textPrimary }]}>{opt.label}</Text>
                  <Text style={[styles.infoDesc, { color: textSecondary }]}>{opt.desc}</Text>
                </View>
              </View>
              {index < THEME_OPTIONS.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* Design Features */}
        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>DESIGN FEATURES</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(220).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {FEATURES.map((item, index) => (
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
              {index < FEATURES.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeIn.delay(250).duration(300)} style={styles.footer}>
          <Ionicons name="color-palette" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            Theme changes take effect immediately{'\n'}across all screens.
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

  // Hero
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

  // System toggle
  systemCard: { borderRadius: 20, padding: 4, marginBottom: 4 },
  systemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16, gap: 12,
  },
  systemIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  systemContent: { flex: 1 },
  systemTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginBottom: 2 },
  systemDesc: { fontSize: 12, fontWeight: '400', lineHeight: 17 },
  systemHint: {
    fontSize: 13, lineHeight: 19, paddingHorizontal: 4,
    marginTop: 6, marginBottom: 4,
  },

  // Section
  sectionLabel: {
    fontSize: 13, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 10, paddingLeft: 2,
  },

  // Preview cards
  previewRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  previewCard: {
    flex: 1, borderRadius: 16, padding: 12,
    alignItems: 'center', gap: 10, overflow: 'hidden' as const,
  },
  previewPhone: {
    width: '100%', aspectRatio: 0.65, borderRadius: 10,
    padding: 8, gap: 5, justifyContent: 'center',
  },
  previewBar: { height: 6, borderRadius: 3 },
  previewLabel: { fontSize: 13, letterSpacing: -0.2 },
  checkDot: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    position: 'absolute', top: 8, right: 8,
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

  // Footer
  footer: { alignItems: 'center', paddingTop: 24, paddingBottom: 8, gap: 8 },
  footerText: { fontSize: 13, fontWeight: '400', lineHeight: 19, textAlign: 'center' },
});
