/**
 * SheetComponents — Shared building blocks for all Settings bottom sheets.
 *
 * Provides consistent row design, section footers, search bar, and form inputs
 * so every sheet shares the same visual tokens and interaction patterns.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Platform,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Visual Tokens ──────────────────────────────────────────────

const TOKENS = {
  // Spacing
  horizontalPadding: 24,
  rowMinHeight: 52,
  iconSize: 32,
  iconRadius: 9,
  iconGlyph: 16,
  sectionGap: 12,
  // Radii
  cardRadius: 16,
  inputRadius: 12,
  checkmarkSize: 22,
  // Typography
  rowTitle: 16,
  rowSubtitle: 12,
  sectionFooter: 13,
  inputLabel: 11,
};

// ─── SheetOptionRow ─────────────────────────────────────────────

export interface SheetOptionRowProps {
  /** Leading icon name (Ionicons) */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Row title */
  label: string;
  /** Optional description (1-2 lines) */
  description?: string;
  /** Whether this option is currently selected */
  selected?: boolean;
  /** Whether this row is disabled */
  disabled?: boolean;
  /** Tap handler */
  onPress: () => void;
  /** Show separator below (default: true) */
  showDivider?: boolean;
  /** Danger style (red text/icon) */
  danger?: boolean;
  /** Show chevron instead of checkmark */
  showChevron?: boolean;
}

export function SheetOptionRow({
  icon,
  label,
  description,
  selected = false,
  disabled = false,
  onPress,
  showDivider = true,
  danger = false,
  showChevron = false,
}: SheetOptionRowProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const iconColor = danger
    ? c.semantic.error
    : disabled
      ? (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)')
      : c.settingsRow.iconColor;

  const labelColor = danger
    ? c.semantic.error
    : disabled
      ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)')
      : c.text.primary;

  const descColor = disabled
    ? (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)')
    : c.settingsRow.description;

  return (
    <>
      <AnimatedPressable
        style={[animStyle, styles.optionRow, {
          backgroundColor: selected
            ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)')
            : 'transparent',
          opacity: disabled ? 0.5 : 1,
        }]}
        onPress={disabled ? undefined : onPress}
        onPressIn={disabled ? undefined : () => {
          scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
        }}
        onPressOut={disabled ? undefined : () => {
          scale.value = withSpring(1, { damping: 15, stiffness: 400 });
        }}
        disabled={disabled}
      >
        {icon && (
          <View style={[styles.optionIcon, {
            backgroundColor: danger
              ? c.settingsRow.dangerIconBg
              : c.settingsRow.iconBg,
          }]}>
            <Ionicons name={icon} size={TOKENS.iconGlyph} color={iconColor} />
          </View>
        )}
        <View style={styles.optionContent}>
          <Text
            style={[styles.optionLabel, { color: labelColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {description && (
            <Text
              style={[styles.optionDescription, { color: descColor }]}
              numberOfLines={2}
            >
              {description}
            </Text>
          )}
        </View>
        {selected && !showChevron && (
          <View style={[styles.checkmark, {
            backgroundColor: c.brand.primary,
          }]}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
        {showChevron && (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={c.settingsRow.arrow}
          />
        )}
      </AnimatedPressable>
      {showDivider && (
        <View style={[styles.divider, {
          marginLeft: icon ? 68 : TOKENS.horizontalPadding,
          backgroundColor: c.settingsRow.divider,
        }]} />
      )}
    </>
  );
}

// ─── SheetSearchBar ─────────────────────────────────────────────

export interface SheetSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SheetSearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
}: SheetSearchBarProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  return (
    <View style={[styles.searchBar, {
      backgroundColor: c.searchBar.bg,
    }]}>
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={20}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Ionicons
        name="search"
        size={16}
        color={c.searchBar.icon}
      />
      <TextInput
        style={[styles.searchInput, { color: c.searchBar.text }]}
        placeholder={placeholder}
        placeholderTextColor={c.searchBar.placeholder}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons
            name="close-circle"
            size={16}
            color={c.searchBar.placeholder}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── SheetSectionFooter ─────────────────────────────────────────

export interface SheetSectionFooterProps {
  text: string;
  /** 'info' = muted, 'warning' = orange tinted */
  variant?: 'info' | 'warning';
}

export function SheetSectionFooter({
  text,
  variant = 'info',
}: SheetSectionFooterProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  if (variant === 'warning') {
    return (
      <View style={[styles.footerWarning, {
        backgroundColor: c.alertBar.warningBg,
      }]}>
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={20}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        )}
        <Ionicons name="warning-outline" size={16} color={c.semantic.warning} />
        <Text style={[styles.footerWarningText, { color: c.semantic.warning }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.footerInfo}>
      <Text style={[styles.footerInfoText, {
        color: c.sectionLabel.text,
      }]}>
        {text}
      </Text>
    </View>
  );
}

// ─── SheetFormInput ─────────────────────────────────────────────

export interface SheetFormInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'email-address' | 'url';
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  /** Large centered style for number inputs */
  centered?: boolean;
  returnKeyType?: 'done' | 'next' | 'search' | 'go';
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput>;
  secureTextEntry?: boolean;
}

export function SheetFormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoFocus = false,
  autoCapitalize = 'none',
  autoCorrect = false,
  centered = false,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  secureTextEntry = false,
}: SheetFormInputProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  return (
    <View style={styles.formInputContainer}>
      <Text style={[styles.formInputLabel, {
        color: c.text.muted,
      }]}>
        {label}
      </Text>
      <View style={[styles.formInputWrapper, {
        backgroundColor: c.input.bg,
        borderColor: c.input.border,
      }]}>
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={15}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <TextInput
          ref={inputRef}
          style={[styles.formInput, {
            color: c.input.text,
          }, centered && styles.formInputCentered]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.input.placeholder}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          secureTextEntry={secureTextEntry}
        />
      </View>
    </View>
  );
}

// ─── SheetPrimaryButton ─────────────────────────────────────────

export interface SheetPrimaryButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive';
  /** Whether the button is disabled */
  disabled?: boolean;
}

export function SheetPrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: SheetPrimaryButtonProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const bgColor = variant === 'destructive'
    ? c.destructiveButton.bg
    : c.primaryButton.bg;

  const textColor = variant === 'destructive'
    ? c.destructiveButton.text
    : c.primaryButton.text;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
      style={[styles.primaryButton, { backgroundColor: bgColor }, disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.primaryButtonText, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Option Row
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: TOKENS.horizontalPadding,
    minHeight: TOKENS.rowMinHeight,
  },
  optionIcon: {
    width: TOKENS.iconSize,
    height: TOKENS.iconSize,
    borderRadius: TOKENS.iconRadius,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionContent: {
    flex: 1,
    marginRight: 8,
  },
  optionLabel: {
    fontSize: TOKENS.rowTitle,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  optionDescription: {
    fontSize: TOKENS.rowSubtitle,
    fontWeight: '400',
    marginTop: 2,
    lineHeight: 17,
  },
  checkmark: {
    width: TOKENS.checkmarkSize,
    height: TOKENS.checkmarkSize,
    borderRadius: TOKENS.checkmarkSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginRight: TOKENS.horizontalPadding,
  },

  // Search Bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: TOKENS.inputRadius,
    gap: 8,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    padding: 0,
  },

  // Section Footer
  footerInfo: {
    paddingHorizontal: TOKENS.horizontalPadding,
    paddingTop: 8,
    paddingBottom: 16,
  },
  footerInfoText: {
    fontSize: TOKENS.sectionFooter,
    lineHeight: 18,
  },
  footerWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: TOKENS.horizontalPadding,
    padding: 14,
    borderRadius: TOKENS.cardRadius,
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  footerWarningText: {
    flex: 1,
    fontSize: TOKENS.sectionFooter,
    fontWeight: '500',
    lineHeight: 18,
  },

  // Form Input
  formInputContainer: {
    marginTop: 12,
  },
  formInputLabel: {
    fontSize: TOKENS.inputLabel,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  formInputWrapper: {
    borderRadius: TOKENS.inputRadius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  formInput: {
    fontSize: 15,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  formInputCentered: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1,
  },

  // Primary Button
  primaryButton: {
    height: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
