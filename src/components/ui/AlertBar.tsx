import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ToastData, AlertLevel } from './Toast';

interface AlertBarProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const LEVEL_CONFIG: Record<AlertLevel, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  success: { icon: 'checkmark-circle', color: '#30D158' },
  error: { icon: 'close-circle', color: '#FF453A' },
  info: { icon: 'information-circle', color: '#0A84FF' },
  neutral: { icon: 'checkmark-circle', color: '#FFFFFF' },
};

export function AlertBar({ toast, onDismiss }: AlertBarProps) {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);
  const { title, duration = 1500, alertLevel = 'success' } = toast;

  const config = LEVEL_CONFIG[alertLevel];

  useEffect(() => {
    // Fade + scale in
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });

    // Auto dismiss
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDismiss)(toast.id);
      });
      scale.value = withTiming(0.85, { duration: 200, easing: Easing.in(Easing.cubic) });
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: insets.bottom + 40 },
        animatedStyle,
      ]}
      pointerEvents="none"
      accessible
      accessibilityRole="alert"
      accessibilityLabel={title}
    >
      <View style={styles.pill}>
        <Ionicons name={config.icon} size={18} color={config.color} style={styles.icon} />
        <Text style={styles.text} numberOfLines={1}>{title}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  icon: {
    marginRight: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
