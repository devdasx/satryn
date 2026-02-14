/**
 * AppButton
 * Unified button component — single source of truth for ALL buttons in the app.
 * Height: 50 (primary) / 45 (secondary), BorderRadius: 24.
 * Variants: primary, secondary, tertiary, ghost
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost';

export interface AppButtonProps {
  /** Button label — accepts either `title` or `label` */
  title?: string;
  label?: string;

  /** Press handler */
  onPress: () => void;

  /** Visual style variant */
  variant?: ButtonVariant;

  /** Disabled state */
  disabled?: boolean;

  /** Loading state */
  loading?: boolean;

  /** Icon — Ionicons name string OR a ReactNode (e.g. <Ionicons .../>) */
  icon?: keyof typeof Ionicons.glyphMap | React.ReactNode;

  /** Icon position */
  iconPosition?: 'left' | 'right';

  /** Full width (default: true) */
  fullWidth?: boolean;

  /** Haptic feedback style */
  haptic?: 'light' | 'medium' | 'heavy' | 'none';

  /** Custom container style — use to override colors per-screen */
  style?: ViewStyle;

  /** Custom text style — use to override text color per-screen */
  textStyle?: TextStyle;
}

export function AppButton({
  title,
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = true,
  haptic = 'medium',
  style,
  textStyle,
}: AppButtonProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const displayLabel = title || label || '';

  const handlePress = () => {
    if (disabled || loading) return;

    // Haptic feedback
    if (haptic !== 'none') {
      const feedbackStyle = {
        light: Haptics.ImpactFeedbackStyle.Light,
        medium: Haptics.ImpactFeedbackStyle.Medium,
        heavy: Haptics.ImpactFeedbackStyle.Heavy,
      }[haptic];
      Haptics.impactAsync(feedbackStyle);
    }

    onPress();
  };

  // Variant configurations — using centralized color tokens
  const getVariantStyles = (): { container: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: c.primaryButton.bg,
          },
          text: {
            color: c.primaryButton.text,
          },
        };
      case 'secondary':
        return {
          container: {
            height: 45,
            backgroundColor: c.secondaryButton.bg,
            borderWidth: 1,
            borderColor: c.secondaryButton.border,
          },
          text: {
            color: c.secondaryButton.text,
          },
        };
      case 'tertiary':
        return {
          container: {
            backgroundColor: c.tertiaryButton.bg,
          },
          text: {
            color: c.tertiaryButton.text,
          },
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: c.ghostButton.bg,
          },
          text: {
            color: c.ghostButton.text,
          },
        };
    }
  };

  const variantStyles = getVariantStyles();
  const iconColor = variantStyles.text.color as string;

  // Render icon — supports both Ionicons string name and ReactNode
  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return (
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={18}
          color={iconColor}
        />
      );
    }
    // ReactNode icon (e.g. from LuxeButton)
    return icon;
  };

  const needsGlass = (variant === 'secondary' || variant === 'tertiary') && Platform.OS === 'ios';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={variant === 'primary' ? 0.85 : 0.7}
      accessibilityRole="button"
      accessibilityLabel={displayLabel}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.container,
        variantStyles.container,
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {needsGlass && (
        <BlurView
          intensity={25}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      {loading ? (
        <ActivityIndicator
          size="small"
          color={iconColor}
        />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' && renderIcon()}
          <Text
            style={[
              styles.text,
              variantStyles.text,
              textStyle,
            ]}
          >
            {displayLabel}
          </Text>
          {icon && iconPosition === 'right' && renderIcon()}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 50,
    borderRadius: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});

export default AppButton;
