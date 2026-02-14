import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Platform,
  TouchableOpacity,
  Animated,
  TextInputProps,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../../constants/theme';

interface GlassInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  success?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  disabled?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  variant?: 'default' | 'filled' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
  inputStyle?: TextStyle;
  isDark?: boolean;
}

export function GlassInput({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  success,
  icon,
  rightIcon,
  onRightIconPress,
  disabled = false,
  multiline = false,
  numberOfLines = 1,
  variant = 'default',
  size = 'md',
  style,
  inputStyle,
  isDark = true,
  ...textInputProps
}: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;
  const colors = isDark ? THEME.dark : THEME.light;

  // Size configurations
  const sizeConfig = {
    sm: {
      height: multiline ? undefined : 44,
      minHeight: multiline ? 80 : undefined,
      paddingVertical: THEME.spacing.sm,
      paddingHorizontal: THEME.spacing.md,
      fontSize: THEME.typography.size.sm,
      iconSize: 18,
      borderRadius: THEME.radius.md,
    },
    md: {
      height: multiline ? undefined : 52,
      minHeight: multiline ? 100 : undefined,
      paddingVertical: THEME.spacing.md,
      paddingHorizontal: THEME.spacing.base,
      fontSize: THEME.typography.size.base,
      iconSize: 20,
      borderRadius: THEME.radius.lg,
    },
    lg: {
      height: multiline ? undefined : 60,
      minHeight: multiline ? 120 : undefined,
      paddingVertical: THEME.spacing.base,
      paddingHorizontal: THEME.spacing.lg,
      fontSize: THEME.typography.size.md,
      iconSize: 22,
      borderRadius: THEME.radius.xl,
    },
  }[size];

  const handleFocus = () => {
    setIsFocused(true);
    Animated.spring(focusAnim, {
      toValue: 1,
      friction: 8,
      tension: 100,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.spring(focusAnim, {
      toValue: 0,
      friction: 8,
      tension: 100,
      useNativeDriver: false,
    }).start();
  };

  // Get border color based on state
  const getBorderColor = () => {
    if (error) return colors.error;
    if (success) return colors.success;
    if (isFocused) return THEME.brand.bitcoin;
    return colors.glassBorder;
  };

  // Get background color based on variant
  const getBackgroundColor = () => {
    switch (variant) {
      case 'filled':
        return colors.fill;
      case 'outline':
        return 'transparent';
      default:
        return colors.glass;
    }
  };

  const animatedBorderWidth = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2],
  });

  const containerStyle: ViewStyle[] = [
    styles.container,
    {
      borderRadius: sizeConfig.borderRadius,
      backgroundColor: getBackgroundColor(),
    },
    style,
  ].filter(Boolean) as ViewStyle[];

  const inputContainerStyle: ViewStyle[] = [
    styles.inputContainer,
    {
      height: sizeConfig.height,
      minHeight: sizeConfig.minHeight,
      paddingVertical: sizeConfig.paddingVertical,
      paddingHorizontal: sizeConfig.paddingHorizontal,
      borderRadius: sizeConfig.borderRadius,
    },
    disabled && styles.disabled,
  ].filter(Boolean) as ViewStyle[];

  const textInputStyle: TextStyle[] = [
    styles.input,
    {
      fontSize: sizeConfig.fontSize,
      color: colors.text,
    },
    icon && styles.inputWithLeftIcon,
    rightIcon && styles.inputWithRightIcon,
    disabled && styles.disabledText,
    inputStyle,
  ].filter(Boolean) as TextStyle[];

  return (
    <View style={containerStyle}>
      {/* Label */}
      {label && (
        <Text style={[styles.label, { color: isFocused ? THEME.brand.bitcoin : colors.textSecondary }]}>
          {label}
        </Text>
      )}

      {/* Input container with animated border */}
      <Animated.View
        style={[
          styles.inputWrapper,
          {
            borderRadius: sizeConfig.borderRadius,
            borderWidth: animatedBorderWidth,
            borderColor: getBorderColor(),
          },
        ]}
      >
        {/* Glass blur background */}
        {Platform.OS === 'ios' && variant === 'default' && (
          <BlurView
            intensity={THEME.liquidGlass.blur.subtle}
            tint={isDark ? 'dark' : 'light'}
            style={[StyleSheet.absoluteFill, { borderRadius: sizeConfig.borderRadius }]}
          />
        )}

        <View style={inputContainerStyle}>
          {/* Left icon */}
          {icon && (
            <View style={styles.leftIconContainer}>
              <Ionicons
                name={icon}
                size={sizeConfig.iconSize}
                color={isFocused ? THEME.brand.bitcoin : colors.textSecondary}
              />
            </View>
          )}

          {/* Text input */}
          <TextInput
            style={textInputStyle}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            onFocus={handleFocus}
            onBlur={handleBlur}
            editable={!disabled}
            multiline={multiline}
            numberOfLines={numberOfLines}
            textAlignVertical={multiline ? 'top' : 'center'}
            {...textInputProps}
          />

          {/* Right icon */}
          {rightIcon && (
            <TouchableOpacity
              onPress={onRightIconPress}
              disabled={!onRightIconPress}
              style={styles.rightIconContainer}
              activeOpacity={0.7}
            >
              <Ionicons
                name={rightIcon}
                size={sizeConfig.iconSize}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          )}

          {/* Success/Error icons */}
          {(success || error) && !rightIcon && (
            <View style={styles.statusIconContainer}>
              <Ionicons
                name={success ? 'checkmark-circle' : 'alert-circle'}
                size={sizeConfig.iconSize}
                color={success ? colors.success : colors.error}
              />
            </View>
          )}
        </View>
      </Animated.View>

      {/* Error message */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: THEME.spacing.base,
  },
  label: {
    fontSize: THEME.typography.size.sm,
    fontWeight: THEME.typography.weight.medium,
    marginBottom: THEME.spacing.sm,
    marginLeft: THEME.spacing.xs,
  },
  inputWrapper: {
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontWeight: THEME.typography.weight.regular,
    padding: 0,
    margin: 0,
  },
  inputWithLeftIcon: {
    marginLeft: THEME.spacing.sm,
  },
  inputWithRightIcon: {
    marginRight: THEME.spacing.sm,
  },
  leftIconContainer: {
    marginRight: THEME.spacing.xs,
  },
  rightIconContainer: {
    marginLeft: THEME.spacing.xs,
    padding: THEME.spacing.xs,
  },
  statusIconContainer: {
    marginLeft: THEME.spacing.sm,
  },
  disabled: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.7,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: THEME.spacing.xs,
    marginLeft: THEME.spacing.xs,
  },
  errorText: {
    fontSize: THEME.typography.size.sm,
    marginLeft: THEME.spacing.xs,
  },
});
