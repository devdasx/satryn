/**
 * Nearby Payments Screen
 *
 * Full-screen modal for BLE-based nearby Bitcoin payments.
 * Supports both 'send' (scan for receivers) and 'receive' (advertise) modes.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useGlobalSearchParams } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { NearbyProvider, NearbyHeader, NearbyScreen } from '../../src/components/nearby';
import type { NearbyMode } from '../../src/services/nearby/types';

export default function NearbyPaymentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const localParams = useLocalSearchParams<{ mode?: string }>();
  const globalParams = useGlobalSearchParams<{ mode?: string }>();

  // Prefer local params but fall back to global params — expo-router can
  // return empty local params when the screen was pushed from a replaced route.
  const rawMode = localParams.mode || globalParams.mode;
  const mode: NearbyMode = rawMode === 'send' ? 'send' : 'receive';

  const handleClose = () => {
    router.back();
  };

  return (
    <NearbyProvider mode={mode}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <NearbyHeader mode={mode} onClose={handleClose} />
        <NearbyScreen />
      </View>
    </NearbyProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
