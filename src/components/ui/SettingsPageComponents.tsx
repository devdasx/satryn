/**
 * SettingsPageComponents — Shared building blocks for full-page settings-style screens.
 *
 * Provides consistent card containers, row items, status indicators, buttons, and
 * inline actions so every settings-adjacent screen shares the same visual tokens.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Visual Tokens ──────────────────────────────────────────────

const TOKENS = {
  pageHorizontalPadding: 16,
  cardRadius: 20,
  cardPadding: 16,
  cardGap: 12,
  rowMinHeight: 56,
  iconSize: 32,
  iconRadius: 10,
  iconGlyph: 18,
  dividerInsetLeft: 56, // icon (32) + marginRight (12) + padding (12)
  ctaHeight: 50,
  ctaRadius: 24,
  tapTarget: 44,
};

// ─── SettingsCard ───────────────────────────────────────────────

export interface SettingsCardProps {
  children: React.ReactNode;
  style?: any;
  delay?: number;
}

export function SettingsCard({ children, style, delay = 0 }: SettingsCardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const bg = c.settingsCard.bg;
  const border = c.settingsCard.border;

  return (
    <Animated.View
      entering={FadeIn.delay(delay).duration(400)}
      style={[styles.card, { backgroundColor: bg, borderColor: border }, style]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={30}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </Animated.View>
  );
}

// ─── InfoCard ───────────────────────────────────────────────────

export interface InfoCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  variant?: 'info' | 'warning' | 'error';
  delay?: number;
}

export function InfoCard({ icon, text, variant = 'info', delay = 0 }: InfoCardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const iconColor = variant === 'error'
    ? c.semantic.error
    : variant === 'warning'
      ? c.semantic.warning
      : c.infoCard.infoIconColor;

  const iconBg = variant === 'error'
    ? c.infoCard.errorIconBg
    : variant === 'warning'
      ? c.infoCard.warningIconBg
      : c.infoCard.infoIconBg;

  const textColor = c.infoCard.text;
  const bg = c.infoCard.bg;
  const border = c.infoCard.border;

  return (
    <Animated.View
      entering={FadeIn.delay(delay).duration(400)}
      style={[styles.infoCard, { backgroundColor: bg, borderColor: border }]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={25}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.infoCardIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={TOKENS.iconGlyph} color={iconColor} />
      </View>
      <Text style={[styles.infoCardText, { color: textColor }]}>{text}</Text>
    </Animated.View>
  );
}

// ─── SettingsRow ────────────────────────────────────────────────

export interface SettingsRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  label: string;
  value?: string;
  description?: string;
  onPress?: () => void;
  showArrow?: boolean;
  showDivider?: boolean;
  danger?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function SettingsRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  description,
  onPress,
  showArrow = true,
  showDivider = true,
  danger = false,
  disabled = false,
  children,
}: SettingsRowProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const resolvedIconColor = iconColor
    || (danger ? c.semantic.error : c.settingsRow.iconColor);

  const resolvedIconBg = iconBg
    || (danger ? c.settingsRow.dangerIconBg : c.settingsRow.iconBg);

  const labelColor = danger ? c.semantic.error : c.settingsRow.label;
  const descColor = c.settingsRow.description;
  const valueColor = c.settingsRow.value;

  const content = (
    <Animated.View style={[styles.row, animStyle, disabled && { opacity: 0.4 }]}>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: resolvedIconBg }]}>
          <Ionicons name={icon} size={TOKENS.iconGlyph} color={resolvedIconColor} />
        </View>
      )}
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
        {description && (
          <Text style={[styles.rowDescription, { color: descColor }]} numberOfLines={2}>{description}</Text>
        )}
      </View>
      <View style={styles.rowRight}>
        {children || (
          <>
            {value !== undefined && (
              <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={1}>{value}</Text>
            )}
            {showArrow && onPress && (
              <Ionicons
                name="chevron-forward"
                size={14}
                color={c.settingsRow.arrow}
              />
            )}
          </>
        )}
      </View>
    </Animated.View>
  );

  if (onPress && !disabled) {
    return (
      <>
        <AnimatedPressable
          onPress={onPress}
          onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
          onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
        >
          {content}
        </AnimatedPressable>
        {showDivider && <RowDivider hasIcon={!!icon} />}
      </>
    );
  }

  return (
    <>
      {content}
      {showDivider && <RowDivider hasIcon={!!icon} />}
    </>
  );
}

// ─── RowDivider ─────────────────────────────────────────────────

function RowDivider({ hasIcon }: { hasIcon: boolean }) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  return (
    <View style={[styles.divider, {
      marginLeft: hasIcon ? TOKENS.dividerInsetLeft : TOKENS.cardPadding,
      backgroundColor: c.settingsRow.divider,
    }]} />
  );
}

// ─── StatusPill ─────────────────────────────────────────────────

export interface StatusPillProps {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'neutral';
  icon?: keyof typeof Ionicons.glyphMap;
}

export function StatusPill({ label, variant, icon }: StatusPillProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const bg = {
    success: c.statusPill.successBg,
    warning: c.statusPill.warningBg,
    error: c.statusPill.errorBg,
    neutral: c.statusPill.neutralBg,
  }[variant];

  const color = {
    success: c.statusPill.successText,
    warning: c.statusPill.warningText,
    error: c.statusPill.errorText,
    neutral: c.statusPill.neutralText,
  }[variant];

  const defaultIcon = {
    success: 'checkmark-circle' as const,
    warning: 'warning' as const,
    error: 'close-circle' as const,
    neutral: 'ellipse' as const,
  }[variant];

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Ionicons name={icon || defaultIcon} size={14} color={color} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── SectionLabel ───────────────────────────────────────────────

export interface SectionLabelProps {
  text: string;
  first?: boolean;
}

export function SectionLabel({ text, first = false }: SectionLabelProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  return (
    <Text style={[styles.sectionLabel, first && styles.sectionLabelFirst, {
      color: c.sectionLabel.text,
    }]}>
      {text}
    </Text>
  );
}

// ─── CardTextInput ──────────────────────────────────────────────

export interface CardTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'email-address' | 'url';
  monospace?: boolean;
  minHeight?: number;
  editable?: boolean;
  selectTextOnFocus?: boolean;
}

export function CardTextInput({
  value,
  onChangeText,
  placeholder,
  multiline = false,
  numberOfLines,
  autoCapitalize = 'none',
  autoCorrect = false,
  autoFocus = false,
  keyboardType = 'default',
  monospace = false,
  minHeight,
  editable = true,
  selectTextOnFocus,
}: CardTextInputProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  return (
    <TextInput
      style={[
        styles.cardInput,
        { color: c.input.text },
        multiline && { textAlignVertical: 'top' as const },
        minHeight ? { minHeight } : undefined,
        monospace && {
          fontSize: 14,
          letterSpacing: -0.3,
        },
      ]}
      placeholder={placeholder}
      placeholderTextColor={c.input.placeholder}
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      numberOfLines={numberOfLines}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      autoFocus={autoFocus}
      keyboardType={keyboardType}
      editable={editable}
      selectTextOnFocus={selectTextOnFocus}
    />
  );
}

// ─── InlineActionButton ─────────────────────────────────────────

export interface InlineActionButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  color?: string;
}

export function InlineActionButton({ icon, label, onPress, color }: InlineActionButtonProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const resolvedColor = color || c.brand.bitcoin;

  return (
    <TouchableOpacity
      style={styles.inlineAction}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name={icon} size={16} color={resolvedColor} />
      {label && <Text style={[styles.inlineActionText, { color: resolvedColor }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

// ─── PrimaryBottomButton ────────────────────────────────────────

export interface PrimaryBottomButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'destructive';
}

export function PrimaryBottomButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  variant = 'primary',
}: PrimaryBottomButtonProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const bgEnabled = variant === 'destructive'
    ? c.destructiveButton.bg
    : c.onboardingButton.primaryBg;
  const bgDisabled = c.primaryButton.bgDisabled;
  const textEnabled = variant === 'destructive'
    ? c.destructiveButton.text
    : c.onboardingButton.primaryText;
  const textDisabled = c.primaryButton.textDisabled;

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.ctaButton, {
        backgroundColor: isDisabled ? bgDisabled : bgEnabled,
      }]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={20}
          color={isDisabled ? textDisabled : textEnabled}
          style={{ marginRight: 8 }}
        />
      )}
      <Text style={[styles.ctaText, {
        color: isDisabled ? textDisabled : textEnabled,
      }]}>
        {loading ? 'Processing...' : label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── ResultCard ─────────────────────────────────────────────────

export interface ResultCardProps {
  variant: 'success' | 'error';
  title: string;
  description: string;
}

export function ResultCard({ variant, title, description }: ResultCardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const color = variant === 'success' ? c.semantic.success : c.semantic.error;
  const bg = variant === 'success' ? c.semantic.successLight : c.semantic.errorLight;
  const border = variant === 'success'
    ? c.securityBanner.successBorder
    : (isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.12)');
  const icon = variant === 'success' ? 'checkmark-circle' : 'close-circle';

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[styles.resultCard, { backgroundColor: bg, borderColor: border }]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={25}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={styles.resultHeader}>
        <Ionicons name={icon} size={22} color={color} />
        <Text style={[styles.resultTitle, { color }]}>{title}</Text>
      </View>
      <Text style={[styles.resultDescription, { color: isDark ? `${color}CC` : `${color}BB` }]}>
        {description}
      </Text>
    </Animated.View>
  );
}

// ─── MonoSelectableText ─────────────────────────────────────────

export interface MonoSelectableTextProps {
  text: string;
}

export function MonoSelectableText({ text }: MonoSelectableTextProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  return (
    <View style={[styles.monoBlock, {
      backgroundColor: c.card.bgSubtle,
    }]}>
      <Text
        style={[styles.monoText, { color: c.text.primary }]}
        selectable
      >
        {text}
      </Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Card
  card: {
    borderRadius: TOKENS.cardRadius,
    borderWidth: 1,
    paddingHorizontal: TOKENS.cardPadding,
    marginBottom: TOKENS.cardGap,
    overflow: 'hidden',
  },

  // Info Card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: TOKENS.cardPadding,
    borderRadius: TOKENS.cardRadius,
    borderWidth: 1,
    gap: 12,
    marginBottom: TOKENS.cardGap,
    overflow: 'hidden',
  },
  infoCardIcon: {
    width: TOKENS.iconSize,
    height: TOKENS.iconSize,
    borderRadius: TOKENS.iconRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCardText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: TOKENS.cardPadding,
    minHeight: TOKENS.rowMinHeight,
  },
  rowIcon: {
    width: TOKENS.iconSize,
    height: TOKENS.iconSize,
    borderRadius: TOKENS.iconRadius,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
    marginRight: 8,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  rowDescription: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
    lineHeight: 18,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '400',
    maxWidth: 160,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginRight: TOKENS.cardPadding,
  },

  // Status Pill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Section Label
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
    paddingLeft: 2,
  },
  sectionLabelFirst: {
    marginTop: 12,
  },

  // Card Text Input
  cardInput: {
    fontSize: 16,
    fontWeight: '400',
    paddingHorizontal: TOKENS.cardPadding,
    paddingVertical: 14,
  },

  // Inline Action
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: TOKENS.tapTarget,
    minHeight: TOKENS.tapTarget,
    justifyContent: 'center',
    gap: 4,
  },
  inlineActionText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // CTA Button
  ctaButton: {
    height: TOKENS.ctaHeight,
    borderRadius: TOKENS.ctaRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '600',
  },

  // Result Card
  resultCard: {
    padding: TOKENS.cardPadding,
    borderRadius: TOKENS.cardRadius,
    borderWidth: 1,
    marginBottom: TOKENS.cardGap,
    overflow: 'hidden',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  resultDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 32,
  },

  // Mono Block
  monoBlock: {
    paddingHorizontal: TOKENS.cardPadding,
    paddingVertical: 12,
    borderRadius: 12,
    marginHorizontal: TOKENS.cardPadding,
    marginBottom: 12,
  },
  monoText: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.3,
  },
});
