/**
 * ActionPill
 * Standardized action button with pill shape
 * Used for Send, Receive, and other primary actions
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { THEME, getColors } from '../../constants';

interface ActionPillProps {
  /**
   * Ionicons icon name
   */
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * Button label
   */
  label: string;
  /**
   * Press handler
   */
  onPress: () => void;
  /**
   * Visual variant
   * 'default' = standard white surface
   * 'primary' = emphasized (darker text/icon for Send button)
   */
  variant?: 'default' | 'primary';
  /**
   * Additional container style
   */
  style?: ViewStyle;
  /**
   * Whether button is disabled
   */
  disabled?: boolean;
}

export function ActionPill({
  icon,
  label,
  onPress,
  variant = 'default',
  style,
  disabled = false,
}: ActionPillProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  // Determine colors based on variant
  const isPrimary = variant === 'primary';

  const backgroundColor = c.actionCircle.bg;
  const borderColor = c.capsule.border;
  const iconColor = isPrimary ? c.text.primary : c.text.secondary;
  const textColor = isPrimary ? c.text.primary : c.text.secondary;

  const textWeight = isPrimary ? '600' : '500';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.container,
        {
          backgroundColor,
          borderColor,
          opacity: disabled ? 0.5 : 1,
        },
        THEME.shadows.sm,
        style,
      ]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={30}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: c.actionCircle.bg,
          },
        ]}
      >
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>
      <Text
        style={[
          styles.label,
          {
            color: textColor,
            fontWeight: textWeight as '500' | '600',
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    minHeight: 64,
    overflow: 'hidden',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
  },
});

export default ActionPill;
