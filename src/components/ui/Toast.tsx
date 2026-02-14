import React, { useEffect } from 'react';
import { View, Text, StyleSheet, useColorScheme, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME, FORMATTING, getColors } from '../../constants';
import { formatUnitAmount } from '../../utils/formatting';
import { useSettingsStore } from '../../stores';
import { resolveThemeMode } from '../../hooks';
import type { ThemeMode } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type ToastType = 'success' | 'error' | 'info' | 'bitcoin_received' | 'bitcoin_sent' | 'minimal' | 'alert_bar';

export type AlertLevel = 'success' | 'error' | 'info' | 'neutral';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  amount?: number; // in satoshis
  duration?: number; // in ms
  alertLevel?: AlertLevel;
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const getToastIcons = (themeMode: ThemeMode): Record<ToastType, { name: keyof typeof Ionicons.glyphMap; color: string } | null> => {
  const c = getColors(themeMode);
  return {
    success: { name: 'checkmark-circle', color: c.toast.successIcon },
    error: { name: 'alert-circle', color: c.toast.errorIcon },
    info: { name: 'information-circle', color: c.toast.infoIcon },
    bitcoin_received: { name: 'arrow-down-circle', color: c.toast.successIcon },
    bitcoin_sent: { name: 'arrow-up-circle', color: c.brand.bitcoin },
    minimal: null,
    alert_bar: null,
  };
};

function formatSatoshisDefault(sats: number): string {
  const denomination = useSettingsStore.getState().denomination;
  return formatUnitAmount(sats, denomination);
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const userTheme = useSettingsStore(s => s.theme);
  const themeMode = resolveThemeMode(userTheme, colorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const c = getColors(themeMode);
  const denomination = useSettingsStore(s => s.denomination);
  const formatSatoshis = (sats: number) => formatUnitAmount(sats, denomination);

  const translateY = useSharedValue(-150);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);

  const { type, title, message, amount, duration = 4000 } = toast;
  const toastIcons = getToastIcons(themeMode);
  const icon = toastIcons[type];

  const isMinimal = type === 'minimal';

  // Animate in
  useEffect(() => {
    if (isMinimal) {
      // Minimal toast - quick fade in
      opacity.value = withTiming(1, { duration: 150 });
    } else {
      // Standard toast - slide + fade
      translateY.value = withSpring(0, {
        damping: 15,
        stiffness: 100,
      });
      opacity.value = withTiming(1, { duration: 200 });
    }

    // Auto dismiss
    const timer = setTimeout(() => {
      dismissToast();
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const dismissToast = () => {
    if (isMinimal) {
      // Minimal toast - quick fade out
      opacity.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(onDismiss)(toast.id);
      });
    } else {
      // Standard toast - slide + fade
      translateY.value = withTiming(-150, { duration: 200, easing: Easing.out(Easing.cubic) });
      opacity.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(onDismiss)(toast.id);
      });
    }
  };

  // Swipe to dismiss
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY < 0) {
        translateY.value = event.translationY;
      }
      translateX.value = event.translationX * 0.5;
    })
    .onEnd((event) => {
      if (event.translationY < -50 || Math.abs(event.velocityY) > 500) {
        translateY.value = withTiming(-150, { duration: 150 });
        opacity.value = withTiming(0, { duration: 150 }, () => {
          runOnJS(onDismiss)(toast.id);
        });
      } else {
        translateY.value = withSpring(0, { damping: 15 });
        translateX.value = withSpring(0, { damping: 15 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
    ],
    opacity: opacity.value,
  }));

  const isBitcoinToast = type === 'bitcoin_received' || type === 'bitcoin_sent';
  const isMinimalToast = type === 'minimal';

  // Minimal toast - simple fade only animation
  const minimalAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // Minimal toast - compact centered pill with fade only
  if (isMinimalToast) {
    return (
      <Animated.View
        style={[
          styles.minimalContainer,
          { top: insets.top + 12 },
          minimalAnimatedStyle,
        ]}
        pointerEvents="none"
        accessible
        accessibilityRole="alert"
        accessibilityLabel={title}
      >
        <View
          style={[
            styles.minimalContent,
            {
              backgroundColor: c.toast.minimalBg,
            },
          ]}
        >
          <Text style={styles.minimalText}>{title}</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          styles.container,
          { top: insets.top + 8 },
          animatedStyle,
        ]}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${title}${message ? `. ${message}` : ''}${amount !== undefined ? `. ${formatSatoshis(amount)}` : ''}`}
      >
        <BlurView
          intensity={isDark ? 80 : 60}
          tint={isDark ? 'dark' : 'light'}
          style={styles.blurContainer}
        >
          <View
            style={[
              styles.content,
              {
                backgroundColor: c.toast.bg,
                borderColor: c.toast.border,
              },
            ]}
          >
            {/* Icon */}
            {icon && (
              <View style={[styles.iconContainer, { backgroundColor: icon.color + '20' }]}>
                <Ionicons name={icon.name} size={24} color={icon.color} />
              </View>
            )}

            {/* Text Content */}
            <View style={styles.textContainer}>
              <Text style={[styles.title, { color: c.toast.title }]} numberOfLines={1}>
                {title}
              </Text>
              {isBitcoinToast && amount !== undefined ? (
                <Text style={[styles.amount, { color: icon!.color }]}>
                  {type === 'bitcoin_received' ? '+' : '-'}{formatSatoshis(amount)}
                </Text>
              ) : message ? (
                <Text style={[styles.message, { color: c.toast.message }]} numberOfLines={2}>
                  {message}
                </Text>
              ) : null}
            </View>

            {/* Bitcoin Icon for BTC toasts */}
            {isBitcoinToast && (
              <View style={styles.btcIcon}>
                <Text style={{ fontSize: 20 }}>₿</Text>
              </View>
            )}
          </View>
        </BlurView>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Standard toast
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  blurContainer: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    fontSize: 13,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
  },
  btcIcon: {
    marginLeft: 8,
    opacity: 0.3,
  },

  // Minimal toast - compact centered pill
  minimalContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  minimalBlur: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  minimalContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  minimalText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
