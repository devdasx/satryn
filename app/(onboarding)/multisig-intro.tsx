import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../src/hooks';
import {
  MultisigFeatureBullet,
  MultisigActionCard,
  CollapsibleLearnMore,
} from '../../src/components/onboarding';

export default function MultisigIntroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const handleBack = () => {
    haptics.trigger('light');
    router.back();
  };

  const handleStartCreate = () => {
    haptics.trigger('medium');
    router.push('/(onboarding)/multisig-create');
  };

  const handleStartImport = () => {
    haptics.trigger('medium');
    router.push('/(onboarding)/multisig-import');
  };

  // ─── Theme Colors ───────────────────────────────────────────────

  const screenBg = colors.background;
  const iconContainerBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const iconContainerBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const iconColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';
  const titleColor = isDark ? '#FFFFFF' : '#000000';
  const subtitleColor = isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const backBtnColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header — Back button */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBackButton}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={backBtnColor} />
        </TouchableOpacity>
        <View style={styles.headerBackButton} />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces
      >
        {/* Hero Section */}
        <Animated.View entering={FadeIn.delay(0).duration(400)}>
          {/* Shield icon — replaces old git-network icon for stronger trust signal */}
          <View style={[styles.iconContainer, {
            backgroundColor: iconContainerBg,
            borderColor: iconContainerBorder,
          }]}>
            <Ionicons name="shield-checkmark-outline" size={26} color={iconColor} />
          </View>

          {/* Title */}
          <Text
            style={[styles.title, { color: titleColor }]}
            accessibilityRole="header"
          >
            Multi-Signature Wallet
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: subtitleColor }]}>
            Require multiple approvals to move funds.
          </Text>
        </Animated.View>

        {/* Security Highlight Bullets */}
        <Animated.View entering={FadeIn.delay(80).duration(400)} style={styles.bulletsContainer}>
          <MultisigFeatureBullet
            icon="lock-closed-outline"
            text="No single key can spend alone"
          />
          <MultisigFeatureBullet
            icon="people-outline"
            text="Ideal for shared custody"
          />
          <MultisigFeatureBullet
            icon="hardware-chip-outline"
            text="Works with hardware or cosigners"
          />
        </Animated.View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        {/* Primary Action — Create New Multisig */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <MultisigActionCard
            icon="add-circle-outline"
            iconColor="#F7931A"
            title="Create New Multisig"
            subtitle="Set up m-of-n with your keys"
            variant="primary"
            onPress={handleStartCreate}
          />
        </Animated.View>

        {/* Secondary Action — Import Watch-Only */}
        <Animated.View entering={FadeIn.delay(220).duration(400)}>
          <MultisigActionCard
            icon="document-text-outline"
            title="Import Watch-Only"
            subtitle="Paste an existing descriptor"
            variant="secondary"
            onPress={handleStartImport}
          />
        </Animated.View>

        {/* Collapsible Learn More Section */}
        <Animated.View entering={FadeIn.delay(280).duration(400)}>
          <CollapsibleLearnMore />
        </Animated.View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  // Icon — subtle, monochrome, security-focused
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  // Title — strong hierarchy
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 10,
  },

  // Subtitle
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },

  // Security bullets
  bulletsContainer: {
    gap: 12,
    marginBottom: 28,
  },

  // Divider
  divider: {
    height: 1,
    marginBottom: 24,
  },

  // Bottom spacer
  bottomSpacer: {
    height: 40,
  },
});
