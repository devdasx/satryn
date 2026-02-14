/**
 * Nearby Payments Screen
 *
 * Full-screen modal for BLE-based nearby Bitcoin payments.
 * Supports both 'send' (scan for receivers) and 'receive' (advertise) modes.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { NearbyProvider, NearbyHeader, NearbyScreen } from '../../src/components/nearby';
import type { NearbyMode } from '../../src/services/nearby/types';

export default function NearbyPaymentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ mode?: string }>();

  const mode: NearbyMode = params.mode === 'send' ? 'send' : 'receive';

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
