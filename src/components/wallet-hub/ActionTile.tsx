/**
 * ActionTile
 * Premium action card for Wallet Hub — icon, title, subtitle, optional badge, chevron.
 * Used for Create / Import / Restore entry points.
 */

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type BadgeVariant = 'recommended' | 'advanced' | 'neutral';

export interface ActionTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle: string;
  badge?: { label: string; variant: BadgeVariant };
  onPress: () => void;
  disabled?: boolean;
}

const BADGE_COLORS: Record<BadgeVariant, { bg: (isDark: boolean) => string; text: (isDark: boolean) => string }> = {
  recommended: {
    bg: () => 'rgba(48,209,88,0.12)',
    text: () => '#30D158',
  },
  advanced: {
    bg: (isDark) => isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    text: (isDark) => isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  },
  neutral: {
    bg: (isDark) => isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    text: (isDark) => isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  },
};

export function ActionTile({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  badge,
  onPress,
  disabled = false,
}: ActionTileProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    haptics.trigger('selection');
    onPress();
  };

  const resolvedIconColor = iconColor ?? colors.textSecondary;
  const resolvedIconBg = iconBg ?? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');

  return (
      <AnimatedPressable
        style={[
          animStyle,
          styles.container,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.025)',
            borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
            opacity: disabled ? 0.4 : 1,
          },
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
      >
        {/* Glass background */}
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={30}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Icon */}
        <View style={[styles.iconContainer, { backgroundColor: resolvedIconBg }]}>
          <Ionicons name={icon} size={20} color={resolvedIconColor} />
        </View>

        {/* Text content */}
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.text }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {badge && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: BADGE_COLORS[badge.variant].bg(isDark) },
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: BADGE_COLORS[badge.variant].text(isDark) },
                  ]}
                >
                  {badge.label}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[styles.subtitle, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        </View>

        {/* Chevron */}
        <View style={styles.chevronContainer}>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'}
          />
        </View>
      </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  chevronContainer: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
