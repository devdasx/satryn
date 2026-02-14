/**
 * ActionRow - Premium interactive row component
 *
 * Matches Settings tab design language:
 * 36px icon circles with semantic tinting, 15px/600 labels,
 * absolute-positioned dividers at left: 64.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useHaptics, useTheme } from '../../hooks';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ActionRowVariant = 'default' | 'protected' | 'danger';

interface ActionRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ActionRowVariant;
  rightText?: string;
  showChevron?: boolean;
  isLast?: boolean;
}

// Semantic icon tinting — matches Settings tab pattern
const ICON_COLORS: Record<string, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
  'layers-outline':            { light: { bg: 'rgba(90,200,250,0.10)', color: '#5AC8FA' }, dark: { bg: 'rgba(100,210,255,0.18)', color: '#64D2FF' } },
  'cube-outline':              { light: { bg: 'rgba(175,82,222,0.10)', color: '#AF52DE' }, dark: { bg: 'rgba(191,90,242,0.18)', color: '#BF5AF2' } },
  'key-outline':               { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'code-slash-outline':        { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  'document-text-outline':     { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'shield-checkmark-outline':  { light: { bg: 'rgba(52,199,89,0.10)', color: '#34C759' }, dark: { bg: 'rgba(48,209,88,0.18)', color: '#30D158' } },
};

// Variant-specific styling (for protected/danger overrides)
const VARIANT_CONFIG = {
  default: {
    iconColor: (isDark: boolean) => isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)',
    labelColor: (isDark: boolean) => isDark ? '#FFFFFF' : '#000000',
    bgPressed: (isDark: boolean) => isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
  },
  protected: {
    iconColor: () => '#30D158',
    labelColor: (isDark: boolean) => isDark ? '#FFFFFF' : '#000000',
    bgPressed: (isDark: boolean) => isDark ? 'rgba(48,209,88,0.08)' : 'rgba(48,209,88,0.05)',
  },
  danger: {
    iconColor: () => '#FF453A',
    labelColor: () => '#FF453A',
    bgPressed: (isDark: boolean) => isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.05)',
  },
};

export function ActionRow({
  icon,
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'default',
  rightText,
  showChevron = true,
  isLast = false,
}: ActionRowProps) {
  const { isDark } = useTheme();
  const { trigger } = useHaptics();
  const scale = useSharedValue(1);
  const [isPressed, setIsPressed] = useState(false);

  const config = VARIANT_CONFIG[variant];
  const isDisabled = disabled || loading;

  // Get semantic icon colors from map (for default variant)
  const iconTheme = ICON_COLORS[icon as string];
  let iconBgColor: string;
  let iconTintColor: string;

  if (variant === 'protected') {
    iconBgColor = isDark ? 'rgba(48,209,88,0.18)' : 'rgba(52,199,89,0.10)';
    iconTintColor = config.iconColor(isDark);
  } else if (variant === 'danger') {
    iconBgColor = isDark ? 'rgba(255,69,58,0.18)' : 'rgba(255,59,48,0.10)';
    iconTintColor = config.iconColor(isDark);
  } else if (iconTheme) {
    iconBgColor = isDark ? iconTheme.dark.bg : iconTheme.light.bg;
    iconTintColor = isDark ? iconTheme.dark.color : iconTheme.light.color;
  } else {
    iconBgColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    iconTintColor = config.iconColor(isDark);
  }

  // Keep animated style worklet-safe: only use shared values
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Compute pressed background on JS thread (safe)
  const pressedBg = isPressed ? config.bgPressed(isDark) : 'transparent';

  const handlePressIn = () => {
    if (!isDisabled) {
      scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
      setIsPressed(true);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
    setIsPressed(false);
  };

  const handlePress = () => {
    if (!isDisabled) {
      trigger('light');
      onPress();
    }
  };

  return (
    <AnimatedPressable
      style={[
        styles.container,
        animatedStyle,
        { backgroundColor: pressedBg },
        isDisabled && styles.disabled,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={isDisabled}
    >
      <View style={styles.content}>
        {/* Left icon */}
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: isDisabled ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') : iconBgColor },
          ]}
        >
          {loading ? (
            <ActivityIndicator size={16} color={iconTintColor} />
          ) : (
            <Ionicons
              name={icon}
              size={16}
              color={isDisabled
                ? isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
                : iconTintColor
              }
            />
          )}
        </View>

        {/* Label */}
        <Text
          style={[
            styles.label,
            {
              color: isDisabled
                ? isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'
                : config.labelColor(isDark),
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>

        {/* Right content */}
        <View style={styles.rightContent}>
          {rightText && (
            <Text
              style={[
                styles.rightText,
                {
                  color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
                },
              ]}
              numberOfLines={1}
            >
              {rightText}
            </Text>
          )}

          {showChevron && !loading && (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}
            />
          )}
        </View>
      </View>

      {/* Bottom divider (unless last) */}
      {!isLast && (
        <View
          style={[
            styles.divider,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.06)',
            },
          ]}
        />
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  rightContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rightText: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 120,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 64,
    right: 16,
    height: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.5,
  },
});

export default ActionRow;
