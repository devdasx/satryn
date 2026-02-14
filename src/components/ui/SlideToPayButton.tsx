/**
 * SlideToPayButton
 * Premium swipe-to-confirm gesture — Apple Pay / Revolut inspired.
 * Features: progressive fill, arrow shimmer, clamped animations, milestone haptics.
 *
 * Uses TouchableOpacity fallback approach: the entire track is a pan gesture handler
 * (not just the thumb). This avoids TrueSheet gesture conflicts that caused the
 * slider to freeze when placed inside a bottom sheet footer.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  interpolate,
  runOnJS,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

const THUMB_SIZE = 56;
const TRACK_HEIGHT = 64;
const TRACK_PADDING = 4;
const CONFIRM_THRESHOLD = 0.8;

// Overdamped spring — no bounce on snap-back
const SPRING_BACK = { damping: 28, stiffness: 200, mass: 1 };
// Slightly snappier for confirm snap-forward
const SPRING_CONFIRM = { damping: 22, stiffness: 250, mass: 1 };

interface SlideToPayButtonProps {
  onConfirm: () => void;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Increment to force-reset the slider to start position */
  resetKey?: number;
}

export function SlideToPayButton({
  onConfirm,
  label = 'Slide to pay',
  disabled = false,
  loading = false,
  resetKey = 0,
}: SlideToPayButtonProps) {
  const { isDark, themeMode } = useTheme();
  const translateX = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const lastMilestone = useSharedValue(0);
  const arrowOpacity = useSharedValue(1);
  const hasConfirmed = useSharedValue(false);
  // Track the starting X to know if the touch began on the thumb
  const startX = useSharedValue(0);

  const maxSlide = () => {
    'worklet';
    return Math.max(0, trackWidth.value - THUMB_SIZE - TRACK_PADDING * 2);
  };

  // Reset slider position when resetKey changes
  useEffect(() => {
    translateX.value = withSpring(0, SPRING_BACK);
    hasConfirmed.value = false;
  }, [resetKey]);

  // Arrow shimmer — gentle pulse when idle
  useEffect(() => {
    if (disabled || loading) {
      cancelAnimation(arrowOpacity);
      arrowOpacity.value = 1;
      return;
    }
    arrowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(arrowOpacity);
  }, [disabled, loading]);

  // Use ref to always call the latest onConfirm — avoids stale closure in gesture handler
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const triggerConfirm = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirmRef.current();
  }, []);

  const triggerMilestone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Memoize the gesture to prevent recreation on every render.
  // The gesture is placed on the ENTIRE track (not just the thumb) to avoid
  // the bottom sheet's gesture handler stealing the event from a small target.
  // We use activeOffsetX to ensure horizontal intent before activating.
  const panGesture = useMemo(() =>
    Gesture.Pan()
      .activeOffsetX(5) // Only activate after 5px horizontal movement — prevents sheet dismiss conflict
      .failOffsetY([-15, 15]) // Cancel if vertical movement exceeds 15px
      .onStart((e) => {
        if (hasConfirmed.value) return;
        // Record the starting finger position to calculate drag relative to thumb
        startX.value = e.x;
        isDragging.value = true;
        lastMilestone.value = 0;
        // Stop shimmer while dragging
        cancelAnimation(arrowOpacity);
        arrowOpacity.value = 1;
      })
      .onUpdate((e) => {
        if (hasConfirmed.value) return;
        const max = maxSlide();
        if (max <= 0) return;
        // Calculate new position: current thumb position + finger delta from start
        const thumbCenter = THUMB_SIZE / 2 + TRACK_PADDING;
        // If the user started the drag on the thumb, move relative to start;
        // otherwise use absolute finger position minus thumb center
        const newPos = e.x - thumbCenter;
        translateX.value = Math.min(Math.max(0, newPos), max);

        // Milestone haptics at 25%, 50%, 75%, 80%
        const progress = translateX.value / max;
        const milestones = [0.25, 0.5, 0.75, CONFIRM_THRESHOLD];
        for (const m of milestones) {
          if (progress >= m && lastMilestone.value < m) {
            lastMilestone.value = m;
            runOnJS(triggerMilestone)();
          }
        }
      })
      .onEnd(() => {
        if (hasConfirmed.value) return;
        const max = maxSlide();
        isDragging.value = false;
        if (max <= 0) return;

        const progress = translateX.value / max;
        if (progress >= CONFIRM_THRESHOLD) {
          // Snap to end and confirm — set flag to prevent double-fire
          hasConfirmed.value = true;
          translateX.value = withSpring(max, SPRING_CONFIRM);
          runOnJS(triggerConfirm)();
        } else {
          // Snap back — overdamped, no bounce
          translateX.value = withSpring(0, SPRING_BACK);
          // Restart shimmer after snap-back
          arrowOpacity.value = withRepeat(
            withSequence(
              withTiming(0.35, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
              withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            ),
            -1,
            true,
          );
        }
      }),
    [triggerConfirm, triggerMilestone],
  );

  // Thumb position — strictly clamped
  const thumbStyle = useAnimatedStyle(() => {
    const max = maxSlide();
    const clamped = Math.min(Math.max(0, translateX.value), max > 0 ? max : 0);
    return {
      transform: [{ translateX: clamped }],
    };
  });

  // Progressive fill behind thumb
  const fillStyle = useAnimatedStyle(() => {
    const max = maxSlide();
    const clamped = Math.min(Math.max(0, translateX.value), max > 0 ? max : 0);
    return {
      width: clamped + THUMB_SIZE + TRACK_PADDING,
      opacity: interpolate(clamped, [0, 10], [0, 1], 'clamp'),
    };
  });

  // Label fades out as thumb passes 30%
  const labelStyle = useAnimatedStyle(() => {
    const max = maxSlide();
    if (max <= 0) return { opacity: 1 };
    return {
      opacity: interpolate(translateX.value, [0, max * 0.4], [1, 0], 'clamp'),
    };
  });

  // Arrow icon shimmer opacity
  const arrowStyle = useAnimatedStyle(() => ({
    opacity: arrowOpacity.value,
  }));

  // Colors
  const c = getColors(themeMode);
  const trackBg = c.slideToPay.trackBg;
  const fillBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const thumbBg = c.slideToPay.thumbBg;
  const thumbIcon = c.slideToPay.thumbIcon;
  const labelColor = c.slideToPay.text;

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          styles.track,
          { backgroundColor: trackBg },
          (disabled || loading) && styles.trackDisabled,
        ]}
        onLayout={(e) => {
          trackWidth.value = e.nativeEvent.layout.width;
        }}
      >
        {/* Glass background */}
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={20}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Progressive fill */}
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: fillBg, overflow: 'hidden' },
            fillStyle,
          ]}
        >
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={15}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          )}
        </Animated.View>

        {/* Label */}
        <Animated.View style={[styles.labelContainer, labelStyle]}>
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </Animated.View>

        {/* Thumb */}
        <Animated.View
          style={[
            styles.thumb,
            { backgroundColor: thumbBg },
            thumbStyle,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={thumbIcon} />
          ) : (
            <Animated.View style={arrowStyle}>
              <Ionicons name="chevron-forward" size={24} color={thumbIcon} />
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: TRACK_PADDING,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackDisabled: {
    opacity: 0.35,
  },
  fill: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: (TRACK_HEIGHT - TRACK_PADDING * 2) / 2,
  },
  labelContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
