/**
 * Send — Broadcasting step route (no header, no swipe-back).
 *
 * Shows signing/broadcasting progress. On error, auto-syncs wallet
 * and presents retry + go home buttons.
 * On successful broadcast (including retry), navigates to success screen.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { useSendStore } from '../../src/stores/sendStore';
import { StepBroadcasting } from '../../src/components/send/StepBroadcasting';

export default function SendBroadcastingRoute() {
  const { colors } = useTheme();
  const router = useRouter();
  const reset = useSendStore((s) => s.reset);

  // Watch for successful broadcast (including from retry inside StepBroadcasting)
  const broadcastTxid = useSendStore((s) => s.broadcastTxid);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (broadcastTxid && !hasNavigated.current) {
      hasNavigated.current = true;
      router.replace('/(auth)/send-success');
    }
  }, [broadcastTxid, router]);

  const handleGoHome = useCallback(() => {
    reset();
    router.replace('/(auth)/(tabs)');
  }, [reset, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StepBroadcasting onGoHome={handleGoHome} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
