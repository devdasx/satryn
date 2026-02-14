/**
 * PremiumInput — Unified premium text input matching PasswordInputSheet design.
 *
 * Features:
 *   - Colored icon circle (left)
 *   - TextInput (center, flex 1)
 *   - Optional right action (eye toggle for secure fields, clear button, custom)
 *   - surfaceBg card wrapper (borderRadius 20)
 *   - Hairline divider support for paired fields (PremiumInputCard wrapper)
 *
 * Usage:
 *   Single field:
 *     <PremiumInputCard>
 *       <PremiumInput icon="person" iconColor="#007AFF" placeholder="Name" ... />
 *     </PremiumInputCard>
 *
 *   Paired fields (e.g. password + confirm):
 *     <PremiumInputCard>
 *       <PremiumInput icon="key" iconColor="#FF9F0A" placeholder="Password" secureTextEntry ... />
 *       <PremiumInput icon="shield-checkmark" iconColor="#5E5CE6" placeholder="Confirm" secureTextEntry ... />
 *     </PremiumInputCard>
 */

import React, { useState, forwardRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

// ─── PremiumInputCard (wrapper for 1+ inputs) ──────────────────

export interface PremiumInputCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Optional label above the card */
  label?: string;
}

export function PremiumInputCard({ children, style, label }: PremiumInputCardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const surfaceBg = c.premiumInput.cardBg;
  const labelColor = c.premiumInput.label;
  const dividerColor = c.premiumInput.divider;

  // Insert dividers between children
  const childArray = React.Children.toArray(children).filter(Boolean);
  const withDividers: React.ReactNode[] = [];
  childArray.forEach((child, i) => {
    withDividers.push(child);
    if (i < childArray.length - 1) {
      withDividers.push(
        <View
          key={`divider-${i}`}
          style={[cardStyles.divider, { backgroundColor: dividerColor }]}
        />,
      );
    }
  });

  return (
    <View style={style}>
      {label && (
        <Text style={[cardStyles.label, { color: labelColor }]}>{label}</Text>
      )}
      <View style={[cardStyles.card, { backgroundColor: surfaceBg }]}>
        {withDividers}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
    marginRight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingLeft: 2,
  },
});

// ─── PremiumInput ───────────────────────────────────────────────

export interface PremiumInputProps extends Omit<TextInputProps, 'style'> {
  /** Ionicons icon name for the left circle */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Color for the icon and its background tint */
  iconColor?: string;
  /** Show clear button when text is present (default: false) */
  showClear?: boolean;
  /** Monospace font for addresses / keys */
  monospace?: boolean;
  /** Centered large text for numeric inputs */
  centered?: boolean;
  /** Error state — tints the card border red */
  error?: boolean;
  /** Custom right element (overrides eye toggle / clear) */
  rightElement?: React.ReactNode;
  /** Additional style for the row */
  rowStyle?: StyleProp<ViewStyle>;
}

export const PremiumInput = forwardRef<TextInput, PremiumInputProps>(
  function PremiumInput(
    {
      icon,
      iconColor = '#007AFF',
      secureTextEntry,
      showClear = false,
      monospace = false,
      centered = false,
      error = false,
      rightElement,
      rowStyle,
      value,
      onChangeText,
      ...rest
    },
    ref,
  ) {
    const { isDark, themeMode } = useTheme();
    const c = getColors(themeMode);
    const [showSecure, setShowSecure] = useState(true);
    const isSecure = secureTextEntry ?? false;

    const handleClear = useCallback(() => {
      onChangeText?.('');
    }, [onChangeText]);

    const iconBg = `${iconColor}${c.premiumInput.iconBgAlpha}`;
    const eyeColor = c.premiumInput.eyeIcon;

    return (
      <View style={[inputStyles.row, rowStyle]}>
        {/* Left icon circle */}
        {icon && (
          <View style={[inputStyles.iconCircle, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={16} color={iconColor} />
          </View>
        )}

        {/* TextInput */}
        <TextInput
          ref={ref}
          style={[
            inputStyles.input,
            { color: c.premiumInput.text },
            monospace && inputStyles.monospace,
            centered && inputStyles.centered,
            !icon && { marginLeft: 4 },
          ]}
          placeholderTextColor={c.premiumInput.placeholder}
          secureTextEntry={isSecure ? showSecure : false}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
        />

        {/* Right element */}
        {rightElement ? (
          rightElement
        ) : isSecure ? (
          <TouchableOpacity
            onPress={() => setShowSecure(!showSecure)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showSecure ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={eyeColor}
            />
          </TouchableOpacity>
        ) : showClear && value && value.length > 0 ? (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={c.premiumInput.clearIcon}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  },
);

const inputStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
    paddingVertical: 4,
  },
  monospace: {
    fontSize: 14,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  centered: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
});
