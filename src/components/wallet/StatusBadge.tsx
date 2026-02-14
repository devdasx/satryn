/**
 * StatusBadge - Premium sync status indicator
 *
 * Shows wallet sync state with appropriate colors and animations.
 * Designed for black-first UI with muted, premium color palette.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useHaptics } from '../../hooks';

export type SyncStatus = 'synced' | 'syncing' | 'not_synced' | 'offline';

interface StatusBadgeProps {
  status: SyncStatus;
  onPress?: () => void;
  disabled?: boolean;
}

// Premium muted color palette for status states
const STATUS_CONFIG: Record<SyncStatus, { bg: string; text: string; label: string }> = {
  synced: {
    bg: 'rgba(48, 209, 88, 0.12)',
    text: '#30D158',
    label: 'Synced'
  },
  syncing: {
    bg: 'rgba(255, 214, 10, 0.12)',
    text: '#FFD60A',
    label: 'Syncing...'
  },
  not_synced: {
    bg: 'rgba(142, 142, 147, 0.12)',
    text: '#8E8E93',
    label: 'Tap to sync'
  },
  offline: {
    bg: 'rgba(255, 69, 58, 0.12)',
    text: '#FF453A',
    label: 'Offline'
  },
};

export function StatusBadge({ status, onPress, disabled }: StatusBadgeProps) {
  const { trigger } = useHaptics();
  const config = STATUS_CONFIG[status];

  // Pulse animation for syncing state
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (status === 'syncing') {
      pulseOpacity.value = withRepeat(
        withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(1, { duration: 200 });
    }

    return () => {
      cancelAnimation(pulseOpacity);
    };
  }, [status]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const handlePress = () => {
    if (!disabled && onPress) {
      trigger('light');
      onPress();
    }
  };

  const content = (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: config.bg },
        animatedStyle,
      ]}
    >
      {status === 'syncing' ? (
        <ActivityIndicator size={10} color={config.text} style={styles.indicator} />
      ) : (
        <View style={[styles.dot, { backgroundColor: config.text }]} />
      )}
      <Text style={[styles.label, { color: config.text }]}>
        {config.label}
      </Text>
    </Animated.View>
  );

  if (onPress && !disabled) {
    return (
      <Pressable
        onPress={handlePress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  indicator: {
    marginRight: -2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});

export default StatusBadge;
