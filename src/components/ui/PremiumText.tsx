import React from 'react';
import { Text, TextStyle, StyleSheet } from 'react-native';
import { THEME } from '../../constants/theme';
import { getColors } from '../../constants';
import { useTheme } from '../../hooks';

interface PremiumTextProps {
  children: React.ReactNode;
  variant?: 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'bodySmall' | 'caption' | 'label';
  color?: 'primary' | 'secondary' | 'tertiary' | 'muted' | 'accent' | 'success' | 'error';
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
}

export function PremiumText({
  children,
  variant = 'body',
  color = 'primary',
  weight,
  align = 'left',
  mono = false,
  style,
  numberOfLines,
}: PremiumTextProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const variantStyles: TextStyle = {
    display: {
      fontSize: THEME.typography.size.display,
      fontWeight: THEME.typography.weight.bold,
      letterSpacing: THEME.typography.letterSpacing.tight,
      lineHeight: THEME.typography.size.display * THEME.typography.lineHeight.tight,
    },
    h1: {
      fontSize: THEME.typography.size['3xl'],
      fontWeight: THEME.typography.weight.bold,
      letterSpacing: THEME.typography.letterSpacing.tight,
      lineHeight: THEME.typography.size['3xl'] * THEME.typography.lineHeight.tight,
    },
    h2: {
      fontSize: THEME.typography.size['2xl'],
      fontWeight: THEME.typography.weight.semibold,
      letterSpacing: THEME.typography.letterSpacing.normal,
      lineHeight: THEME.typography.size['2xl'] * THEME.typography.lineHeight.normal,
    },
    h3: {
      fontSize: THEME.typography.size.xl,
      fontWeight: THEME.typography.weight.semibold,
      letterSpacing: THEME.typography.letterSpacing.normal,
      lineHeight: THEME.typography.size.xl * THEME.typography.lineHeight.normal,
    },
    body: {
      fontSize: THEME.typography.size.base,
      fontWeight: THEME.typography.weight.regular,
      letterSpacing: THEME.typography.letterSpacing.normal,
      lineHeight: THEME.typography.size.base * THEME.typography.lineHeight.normal,
    },
    bodySmall: {
      fontSize: THEME.typography.size.sm,
      fontWeight: THEME.typography.weight.regular,
      letterSpacing: THEME.typography.letterSpacing.normal,
      lineHeight: THEME.typography.size.sm * THEME.typography.lineHeight.normal,
    },
    caption: {
      fontSize: THEME.typography.size.xs,
      fontWeight: THEME.typography.weight.medium,
      letterSpacing: THEME.typography.letterSpacing.wide,
      lineHeight: THEME.typography.size.xs * THEME.typography.lineHeight.relaxed,
      textTransform: 'uppercase' as const,
    },
    label: {
      fontSize: THEME.typography.size.sm,
      fontWeight: THEME.typography.weight.medium,
      letterSpacing: THEME.typography.letterSpacing.normal,
      lineHeight: THEME.typography.size.sm * THEME.typography.lineHeight.normal,
    },
  }[variant];

  const colorStyles: TextStyle = {
    primary: { color: c.premiumText.primary },
    secondary: { color: c.premiumText.secondary },
    tertiary: { color: c.premiumText.tertiary },
    muted: { color: c.premiumText.muted },
    accent: { color: c.premiumText.accent },
    success: { color: c.premiumText.success },
    error: { color: c.premiumText.error },
  }[color];

  const combinedStyles: TextStyle[] = [
    variantStyles,
    colorStyles,
    { textAlign: align },
    weight && { fontWeight: THEME.typography.weight[weight] },
    ...(Array.isArray(style) ? style : style ? [style] : []),
  ].filter(Boolean) as TextStyle[];

  return (
    <Text style={combinedStyles} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// Shorthand components for common use cases
export const DisplayText = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="display" {...props} />
);

export const H1 = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="h1" {...props} />
);

export const H2 = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="h2" {...props} />
);

export const H3 = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="h3" {...props} />
);

export const BodyText = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="body" {...props} />
);

export const Caption = (props: Omit<PremiumTextProps, 'variant'>) => (
  <PremiumText variant="caption" {...props} />
);
