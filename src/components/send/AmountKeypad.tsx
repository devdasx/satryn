/**
 * AmountKeypad — Phone-style 3x4 numeric grid matching PinCodeScreen keypad.
 * Circular Pressable buttons with pressed background state.
 * Includes MAX pill above the grid.
 */

import React, { useCallback, memo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { useHaptics } from '../../hooks/useHaptics';

// ─── Letter map for phone-style keypad ───────────────────────────
const DIGIT_LETTERS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL',
  '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
};

// ─── Responsive circular button size (matches PinCodeScreen) ────
const SCREEN_WIDTH = Dimensions.get('window').width;
const KEY_SIZE = Math.min(85, (SCREEN_WIDTH - 72) / 3);

// ─── Memoized digit button ──────────────────────────────────────

const DigitButton = memo(function DigitButton({
  digit,
  onPress,
  disabled,
  textColor,
  mutedColor,
  pressedBg,
}: {
  digit: string;
  onPress: (d: string) => void;
  disabled: boolean;
  textColor: string;
  mutedColor: string;
  pressedBg: string;
}) {
  const letters = DIGIT_LETTERS[digit];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.keyBtn,
        pressed && !disabled && { backgroundColor: pressedBg },
        disabled && styles.keyBtnDisabled,
      ]}
      onPress={() => onPress(digit)}
      disabled={disabled}
    >
      <Text style={[styles.keyBtnText, { color: textColor }]}>{digit}</Text>
      {letters ? (
        <Text style={[styles.keyBtnLetters, { color: mutedColor }]}>{letters}</Text>
      ) : null}
    </Pressable>
  );
});

// ─── Props ──────────────────────────────────────────────────────

interface AmountKeypadProps {
  onKeyPress: (key: string) => void;
  onBackspace: () => void;
  onMax: () => void;
  allowDecimal?: boolean;
}

// ─── Component ──────────────────────────────────────────────────

export function AmountKeypad({
  onKeyPress,
  onBackspace,
  onMax,
  allowDecimal = true,
}: AmountKeypadProps) {
  const { colors } = useTheme();
  const haptics = useHaptics();

  const pressedBg = colors.fillSecondary;
  const textColor = colors.text;
  const mutedColor = colors.textMuted;

  const handleDigitPress = useCallback((digit: string) => {
    haptics.trigger('light');
    onKeyPress(digit);
  }, [onKeyPress, haptics]);

  const handleDecimalPress = useCallback(() => {
    if (!allowDecimal) return;
    haptics.trigger('light');
    onKeyPress('.');
  }, [onKeyPress, allowDecimal, haptics]);

  const handleBackspace = useCallback(() => {
    haptics.trigger('light');
    onBackspace();
  }, [onBackspace, haptics]);

  const handleMax = useCallback(() => {
    haptics.trigger('medium');
    onMax();
  }, [onMax, haptics]);

  return (
    <View style={styles.container}>
      {/* MAX pill */}
      <Pressable
        style={({ pressed }) => [
          styles.maxPill,
          { backgroundColor: colors.fillSecondary },
          pressed && { opacity: 0.6 },
        ]}
        onPress={handleMax}
      >
        <Text style={[styles.maxText, { color: colors.text }]}>MAX</Text>
      </Pressable>

      {/* Keypad grid */}
      <View style={styles.keypad}>
        {/* Row 1 */}
        <View style={styles.keyRow}>
          <DigitButton digit="1" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="2" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="3" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
        </View>

        {/* Row 2 */}
        <View style={styles.keyRow}>
          <DigitButton digit="4" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="5" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="6" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
        </View>

        {/* Row 3 */}
        <View style={styles.keyRow}>
          <DigitButton digit="7" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="8" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
          <DigitButton digit="9" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />
        </View>

        {/* Row 4: decimal / 0 / backspace */}
        <View style={styles.keyRow}>
          {/* Decimal point */}
          <Pressable
            style={({ pressed }) => [
              styles.keyBtn,
              pressed && allowDecimal && { backgroundColor: pressedBg },
              !allowDecimal && styles.keyBtnDisabled,
            ]}
            onPress={handleDecimalPress}
            disabled={!allowDecimal}
          >
            <Text style={[
              styles.keyBtnText,
              { color: allowDecimal ? textColor : colors.textDisabled },
            ]}>.</Text>
          </Pressable>

          {/* Zero */}
          <DigitButton digit="0" onPress={handleDigitPress} disabled={false} textColor={textColor} mutedColor={mutedColor} pressedBg={pressedBg} />

          {/* Backspace */}
          <Pressable
            style={({ pressed }) => [
              styles.keyBtn,
              pressed && { backgroundColor: pressedBg },
            ]}
            onPress={handleBackspace}
          >
            <Ionicons name="backspace-outline" size={26} color={textColor} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  maxPill: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  maxText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  keypad: {
    width: '100%',
    paddingHorizontal: 24,
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginBottom: 8,
  },
  keyBtn: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBtnDisabled: {
    opacity: 0.3,
  },
  keyBtnText: {
    fontSize: 30,
    fontWeight: '300',
    letterSpacing: 0,
  },
  keyBtnLetters: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    marginTop: 1,
  },
});
