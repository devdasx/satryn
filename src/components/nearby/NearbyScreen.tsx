/**
 * NearbyScreen — Main screen with premium animated transitions
 *
 * Routes to the appropriate sub-component based on the
 * current session state (receive-only).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import { NearbyReceiveSetup } from './NearbyReceiveSetup';
import { NearbyAdvertising } from './NearbyAdvertising';
import { NearbyReceiveWaiting } from './NearbyReceiveWaiting';
import { NearbyError } from './NearbyError';
import { NearbyTimeout } from './NearbyTimeout';

export function NearbyScreen() {
  const { colors } = useTheme();
  const state = useNearbySessionStore((s) => s.state);

  const renderContent = () => {
    switch (state) {
      case 'idle':
      case 'initializing':
        return (
          <Animated.View key="setup" entering={FadeIn.duration(250)} style={styles.full}>
            <NearbyReceiveSetup />
          </Animated.View>
        );
      case 'advertising':
      case 'exchanging':
        return (
          <Animated.View key="advertising" entering={FadeIn.duration(250)} style={styles.full}>
            <NearbyAdvertising />
          </Animated.View>
        );
      case 'pending_acceptance':
      case 'completed':
        return (
          <Animated.View key="waiting" entering={FadeIn.duration(250)} style={styles.full}>
            <NearbyReceiveWaiting />
          </Animated.View>
        );
      case 'timeout':
        return (
          <Animated.View key="timeout" entering={FadeIn.duration(250)} style={styles.full}>
            <NearbyTimeout />
          </Animated.View>
        );
      case 'error':
        return (
          <Animated.View key="error" entering={FadeIn.duration(250)} style={styles.full}>
            <NearbyError />
          </Animated.View>
        );
      default:
        return <NearbyReceiveSetup />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  full: {
    flex: 1,
  },
});
