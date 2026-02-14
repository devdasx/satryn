/**
 * useKeyboardHeight - Animated keyboard height tracking hook
 *
 * Returns Reanimated shared values for keyboard height and visibility.
 * Uses platform-specific events (keyboardWillShow/keyboardDidShow) for
 * smooth, native-feeling animations on iOS.
 *
 * Usage:
 * ```tsx
 * const { keyboardHeight, isKeyboardVisible } = useKeyboardHeight();
 *
 * const animatedStyle = useAnimatedStyle(() => ({
 *   transform: [{ translateY: -keyboardHeight.value }],
 * }));
 * ```
 */

import { useEffect } from 'react';
import { Keyboard, Platform, KeyboardEvent } from 'react-native';
import { useSharedValue, withTiming, Easing, SharedValue } from 'react-native-reanimated';

export interface UseKeyboardHeightResult {
  /** Current keyboard height (animated) */
  keyboardHeight: SharedValue<number>;
  /** Whether keyboard is currently visible */
  isKeyboardVisible: SharedValue<boolean>;
}

export function useKeyboardHeight(): UseKeyboardHeightResult {
  const keyboardHeight = useSharedValue(0);
  const isKeyboardVisible = useSharedValue(false);

  useEffect(() => {
    // Use 'will' events on iOS for smoother animation (fires before keyboard animates)
    // Use 'did' events on Android (keyboardWill* not supported)
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleShow = (e: KeyboardEvent) => {
      isKeyboardVisible.value = true;
      // Use the keyboard's own animation duration and curve for perfect sync
      keyboardHeight.value = withTiming(e.endCoordinates.height, {
        duration: Platform.OS === 'ios' ? (e.duration || 250) : 200,
        easing: Easing.bezier(0.33, 0.01, 0, 1), // iOS keyboard curve
      });
    };

    const handleHide = (e: KeyboardEvent) => {
      isKeyboardVisible.value = false;
      keyboardHeight.value = withTiming(0, {
        duration: Platform.OS === 'ios' ? (e.duration || 250) : 200,
        easing: Easing.bezier(0.33, 0.01, 0, 1), // iOS keyboard curve
      });
    };

    const showSub = Keyboard.addListener(showEvent, handleShow);
    const hideSub = Keyboard.addListener(hideEvent, handleHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight, isKeyboardVisible]);

  return { keyboardHeight, isKeyboardVisible };
}
