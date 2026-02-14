/**
 * NearbyTimeout — Friendly "no devices found" screen
 *
 * This is NOT an error — it simply means no nearby devices were
 * discovered within the scan window. Shows a calm, non-alarming
 * design with helpful tips and a retry button.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { useNearby } from './NearbyProvider';
import { AppButton } from '../ui/AppButton';

export function NearbyTimeout() {
  const { colors, isDark } = useTheme();
  const { retry } = useNearby();

  return (
    <View style={styles.container}>
      {/* Friendly icon — subtle, not alarming */}
      <Animated.View
        entering={FadeIn.duration(500)}
        style={styles.iconSection}
      >
        <View style={[styles.iconOuter, {
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.04)'
            : 'rgba(0, 0, 0, 0.03)',
        }]}>
          <View style={[styles.iconInner, {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.06)'
              : 'rgba(0, 0, 0, 0.04)',
          }]}>
            <Ionicons
              name="radio-outline"
              size={32}
              color={colors.textTertiary}
            />
          </View>
        </View>
      </Animated.View>

      {/* Title */}
      <Animated.Text
        entering={FadeInDown.delay(100).duration(400)}
        style={[styles.title, { color: colors.textPrimary }]}
      >
        No Devices Nearby
      </Animated.Text>

      {/* Subtitle */}
      <Animated.Text
        entering={FadeInDown.delay(200).duration(400)}
        style={[styles.subtitle, { color: colors.textSecondary }]}
      >
        We couldn't find any nearby devices.{'\n'}Make sure both devices are close together.
      </Animated.Text>

      {/* Tips card */}
      <Animated.View
        entering={FadeInDown.delay(300).duration(400)}
        style={styles.tipsWrapper}
      >
        <View style={[styles.tipsCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
          <View style={styles.tipsContent}>
            <Text style={[styles.tipsTitle, { color: colors.textSecondary }]}>
              Tips
            </Text>
            <View style={styles.tipRow}>
              <Ionicons name="radio" size={14} color={colors.textTertiary} />
              <Text style={[styles.tipText, { color: colors.textTertiary }]}>
                Both devices need the Nearby screen open
              </Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="location-outline" size={14} color={colors.textTertiary} />
              <Text style={[styles.tipText, { color: colors.textTertiary }]}>
                Keep devices within a few feet of each other
              </Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="wifi-outline" size={14} color={colors.textTertiary} />
              <Text style={[styles.tipText, { color: colors.textTertiary }]}>
                Ensure Wi-Fi and Bluetooth are turned on
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Retry button */}
      <Animated.View
        entering={FadeInDown.delay(400).duration(400)}
        style={styles.actions}
      >
        <AppButton
          title="Search Again"
          onPress={retry}
          variant="primary"
          icon="refresh"
          haptic="light"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  iconSection: {
    marginBottom: 24,
  },
  iconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 10,
    letterSpacing: -0.2,
  },
  tipsWrapper: {
    width: '100%',
    marginBottom: 32,
  },
  tipsCard: {
    borderRadius: 16,
    padding: 16,
  },
  tipsContent: {
    gap: 10,
  },
  tipsTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  actions: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
  },
});
