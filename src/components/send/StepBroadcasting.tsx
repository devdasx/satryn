/**
 * StepBroadcasting — Animated progress: signing → broadcasting → confirming.
 *
 * Reads real state from sendStore (isBroadcasting, signedTx, broadcastTxid, error)
 * to show accurate progress instead of hardcoded timers.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';
import { useSendStore } from '../../stores/sendStore';

const STAGES = [
  { label: 'Signing transaction...', icon: 'key-outline' },
  { label: 'Broadcasting to network...', icon: 'radio-outline' },
  { label: 'Broadcast complete', icon: 'checkmark-circle-outline' },
] as const;

const ERROR_STAGE = { label: 'Transaction failed', icon: 'close-circle-outline' } as const;

export function StepBroadcasting() {
  const { colors } = useTheme();

  // Read real state from sendStore
  const isBroadcasting = useSendStore((s) => s.isBroadcasting);
  const signedTx = useSendStore((s) => s.signedTx);
  const broadcastTxid = useSendStore((s) => s.broadcastTxid);
  const error = useSendStore((s) => s.error);

  // Derive stage from actual store state
  const stageIndex = useMemo(() => {
    if (error) return -1; // Error state
    if (broadcastTxid) return 2; // Broadcast complete
    if (signedTx) return 1; // Signed, broadcasting
    return 0; // Signing
  }, [error, broadcastTxid, signedTx]);

  // Pulse animation
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const isError = stageIndex === -1;
  const stage = isError ? ERROR_STAGE : STAGES[stageIndex];

  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
      {/* Pulsing icon */}
      <Animated.View style={[styles.iconContainer, pulseStyle]}>
        <View style={[styles.iconCircle, { backgroundColor: isError ? colors.errorMuted || 'rgba(255,59,48,0.12)' : colors.fillSecondary }]}>
          <Ionicons
            name={stage.icon as any}
            size={48}
            color={isError ? '#FF3B30' : THEME.brand.bitcoin}
          />
        </View>
      </Animated.View>

      {/* Stage label */}
      <Animated.Text
        entering={FadeInUp.duration(300)}
        key={isError ? 'error' : stageIndex}
        style={[styles.stageLabel, { color: isError ? '#FF3B30' : colors.text }]}
      >
        {stage.label}
      </Animated.Text>

      {/* Error message */}
      {isError && error && (
        <Animated.Text
          entering={FadeInUp.delay(100).duration(300)}
          style={[styles.errorMessage, { color: colors.textMuted }]}
          numberOfLines={3}
        >
          {error}
        </Animated.Text>
      )}

      {/* Progress dots */}
      {!isError && (
        <View style={styles.dotsRow}>
          {STAGES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                {
                  backgroundColor: i <= stageIndex
                    ? THEME.brand.bitcoin
                    : colors.fillTertiary,
                },
              ]}
            />
          ))}
        </View>
      )}

      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {isError
          ? 'Go back and try again'
          : 'Please wait — do not close the app'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
  iconContainer: {
    marginBottom: 8,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageLabel: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    marginTop: -8,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  hint: {
    fontSize: 14,
    marginTop: 16,
  },
});
