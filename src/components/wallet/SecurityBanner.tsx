/**
 * SecurityBanner - Backup warning banner
 *
 * Premium muted amber design matching Settings tab design language.
 * borderRadius 20, no border, circular icon container.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { useHaptics, useTheme } from '../../hooks';
import { getColors } from '../../constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SecurityBannerProps {
  isBackedUp: boolean;
  onBackupPress: () => void;
  walletType?: string;
}

// Premium muted amber palette (NOT orange) — centralized in securityBanner tokens
const BANNER_COLORS = {
  dark: {
    bg: '#252015',
    icon: '#B89B4C',
    title: '#B89B4C',
    subtitle: 'rgba(255,255,255,0.45)',
  },
  light: {
    bg: 'rgba(184, 155, 76, 0.08)',
    icon: '#8B7532',
    title: '#8B7532',
    subtitle: 'rgba(0,0,0,0.45)',
  },
};

export function SecurityBanner({
  isBackedUp,
  onBackupPress,
  walletType,
}: SecurityBannerProps) {
  const { isDark, themeMode } = useTheme();
  const { trigger } = useHaptics();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // All hooks above — conditional rendering below
  if (isBackedUp) return null;

  const c = getColors(themeMode);
  const colors = isDark ? BANNER_COLORS.dark : BANNER_COLORS.light;

  // Customize message based on wallet type
  const isWatchOnly = walletType?.startsWith('watch_');
  const subtitle = isWatchOnly
    ? 'Save your wallet configuration for easy recovery'
    : 'Back up your wallet to protect your funds';

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    trigger('light');
    onBackupPress();
  };

  return (
    <AnimatedPressable
      entering={FadeIn.duration(300)}
      style={[
        styles.container,
        {
          backgroundColor: colors.bg,
        },
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: `${colors.icon}15` },
        ]}
      >
        <Ionicons name="shield-outline" size={20} color={colors.icon} />
      </View>

      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.title }]}>
          Not backed up
        </Text>
        <Text style={[styles.subtitle, { color: colors.subtitle }]}>
          {subtitle}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={16}
        color={c.settingsRow.value}
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    gap: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 0,
  },
});

export default SecurityBanner;
