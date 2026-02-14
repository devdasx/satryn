/**
 * MultisigActionCard — Premium pressable card with icon, title, subtitle, and chevron.
 * Features Reanimated spring scale press feedback and haptic response.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface MultisigActionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle: string;
  variant: 'primary' | 'secondary';
  onPress: () => void;
}

export function MultisigActionCard({
  icon,
  iconColor,
  title,
  subtitle,
  variant,
  onPress,
}: MultisigActionCardProps) {
  const { isDark } = useTheme();
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
    haptics.trigger('medium');
    onPress();
  };

  // Card styling
  const isPrimary = variant === 'primary';
  const cardBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)';
  const borderColor = isPrimary
    ? (isDark ? 'rgba(247,147,26,0.20)' : 'rgba(247,147,26,0.15)')
    : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)');

  // Icon styling
  const resolvedIconColor = iconColor
    || (isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)');
  const iconBg = isPrimary
    ? (isDark ? 'rgba(247,147,26,0.10)' : 'rgba(247,147,26,0.08)')
    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)');

  // Text colors
  const titleColor = isDark ? '#FFFFFF' : '#000000';
  const subtitleColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const chevronColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';

  return (
    <AnimatedPressable
      style={[animStyle, styles.card, {
        backgroundColor: cardBg,
        borderColor,
      }]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={24} color={resolvedIconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={chevronColor} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
});
