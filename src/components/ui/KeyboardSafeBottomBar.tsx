/**
 * KeyboardSafeBottomBar - Animated bottom CTA container
 *
 * Keeps the bottom action button visible above the keyboard with a 10px gap.
 * Uses Reanimated for smooth, 60fps animations that match iOS keyboard timing.
 *
 * Usage:
 * ```tsx
 * <KeyboardSafeBottomBar backgroundColor={colors.bg}>
 *   <AppButton title="Continue" onPress={handleContinue} />
 * </KeyboardSafeBottomBar>
 * ```
 */

import React, { useMemo } from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

/** Gap between keyboard and bottom bar (in pixels) */
const KEYBOARD_GAP = 10;

export interface KeyboardSafeBottomBarProps {
  /** Content to render inside the bottom bar (typically buttons) */
  children: React.ReactNode;
  /** Background color of the bottom bar */
  backgroundColor?: string;
  /** Additional styles to apply to the container */
  style?: StyleProp<ViewStyle>;
  /** Horizontal padding (default: 24) */
  horizontalPadding?: number;
  /** Top padding (default: 12) */
  topPadding?: number;
}

export function KeyboardSafeBottomBar({
  children,
  backgroundColor = 'transparent',
  style,
  horizontalPadding = 24,
  topPadding = 12,
}: KeyboardSafeBottomBarProps) {
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboardHeight();

  // Memoize the bottom inset value to avoid re-creating the derived value
  const bottomInset = useMemo(() => insets.bottom, [insets.bottom]);
  const bottomPadding = useMemo(() => Math.max(bottomInset, 16), [bottomInset]);

  // Use derived value to compute offset on UI thread
  const keyboardOffset = useDerivedValue(() => {
    if (keyboardHeight.value > 0) {
      return keyboardHeight.value - bottomInset + KEYBOARD_GAP;
    }
    return 0;
  }, [bottomInset]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      paddingBottom: bottomPadding,
      transform: [{ translateY: -keyboardOffset.value }],
    };
  }, [bottomPadding]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor,
          paddingHorizontal: horizontalPadding,
          paddingTop: topPadding,
        },
        animatedStyle,
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
