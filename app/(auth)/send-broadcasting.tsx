/**
 * Send — Broadcasting step route (no header, no swipe-back).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../src/hooks';
import { StepBroadcasting } from '../../src/components/send/StepBroadcasting';

export default function SendBroadcastingRoute() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StepBroadcasting />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
