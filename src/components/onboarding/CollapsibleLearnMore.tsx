/**
 * CollapsibleLearnMore — Animated expand/collapse educational section.
 * Explains multisig concepts (m-of-n, common setups, key loss warning).
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';

export function CollapsibleLearnMore() {
  const { isDark } = useTheme();
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);

  const progress = useSharedValue(0);

  const toggle = useCallback(() => {
    haptics.trigger('selection');
    const next = !expanded;
    setExpanded(next);
    progress.value = withTiming(next ? 1 : 0, { duration: 250 });
  }, [expanded, haptics, progress]);

  const bodyStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [0, contentHeight]),
    opacity: progress.value,
    overflow: 'hidden' as const,
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  const onContentLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && h !== contentHeight) {
      setContentHeight(h);
    }
  }, [contentHeight]);

  // Colors
  const containerBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const headerTextColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const bodyTextColor = isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)';
  const warningColor = isDark ? '#FF9500' : '#E68600';
  const warningBg = isDark ? 'rgba(255,149,0,0.08)' : 'rgba(255,149,0,0.06)';

  return (
    <View style={[styles.container, { backgroundColor: containerBg, borderColor }]}>
      {/* Header — tap to toggle */}
      <Pressable
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Learn more about multisig"
      >
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={headerTextColor}
        />
        <Text style={[styles.headerText, { color: headerTextColor }]}>
          Learn more
        </Text>
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={16} color={headerTextColor} />
        </Animated.View>
      </Pressable>

      {/* Body — animated height */}
      <Animated.View style={bodyStyle}>
        <View onLayout={onContentLayout} style={styles.bodyContent}>
          <Text style={[styles.paragraph, { color: bodyTextColor }]}>
            M-of-N means M signatures out of N total keys are needed to spend. For example, a 2-of-3 multisig requires any 2 of 3 keyholders to approve a transaction.
          </Text>

          <Text style={[styles.paragraph, { color: bodyTextColor }]}>
            Common setups include 2-of-3 for personal security (you hold 2 keys, 1 backup) and 3-of-5 for organizational custody.
          </Text>

          <View style={[styles.warningBox, { backgroundColor: warningBg }]}>
            <Ionicons name="warning-outline" size={16} color={warningColor} />
            <Text style={[styles.warningText, { color: warningColor }]}>
              If you lose enough keys to fall below the threshold, funds cannot be recovered. Always maintain secure backups.
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  headerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  bodyContent: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    // Rendered off-screen for measurement, then clipped by animated parent
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
});
