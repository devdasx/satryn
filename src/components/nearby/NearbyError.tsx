/**
 * NearbyError — Error state for real failures only
 *
 * Shows a clear error message with appropriate icon, description,
 * and recovery actions. Only used for actual errors (connection failed,
 * payload invalid, signature mismatch, etc.) — NOT for timeouts.
 */

import React from 'react';
import { View, Text, StyleSheet, Linking, Platform } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import { useNearby } from './NearbyProvider';
import { AppButton } from '../ui/AppButton';
import type { NearbyErrorCode } from '../../services/nearby/types';

const ERROR_CONFIG: Record<string, {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
}> = {
  BLE_UNAVAILABLE: {
    icon: 'bluetooth-outline',
    title: 'Bluetooth Unavailable',
    hint: 'This device does not support Bluetooth Low Energy.',
  },
  BLE_PERMISSION_DENIED: {
    icon: 'lock-closed-outline',
    title: 'Permission Required',
    hint: 'Allow Bluetooth access in Settings to use nearby payments.',
  },
  BLE_POWERED_OFF: {
    icon: 'bluetooth-outline',
    title: 'Bluetooth is Off',
    hint: 'Turn on Bluetooth in Settings to discover nearby devices.',
  },
  NEARBY_UNAVAILABLE: {
    icon: 'radio-outline',
    title: 'Nearby Unavailable',
    hint: 'Wireless discovery is not available on this device.',
  },
  CONNECTION_FAILED: {
    icon: 'close-circle-outline',
    title: 'Connection Failed',
    hint: 'Could not connect to the other device. Make sure both devices are nearby.',
  },
  EXCHANGE_FAILED: {
    icon: 'swap-horizontal-outline',
    title: 'Exchange Failed',
    hint: 'The payment data could not be exchanged. Try again.',
  },
  PAYLOAD_INVALID: {
    icon: 'alert-circle-outline',
    title: 'Invalid Payment Data',
    hint: 'The payment request could not be read. Ask the receiver to try again.',
  },
  PAYLOAD_EXPIRED: {
    icon: 'time-outline',
    title: 'Request Expired',
    hint: 'This payment request has expired. Ask the receiver to create a new one.',
  },
  SIGNATURE_INVALID: {
    icon: 'shield-outline',
    title: 'Verification Failed',
    hint: 'The payment request signature could not be verified.',
  },
  ADDRESS_INVALID: {
    icon: 'alert-circle-outline',
    title: 'Invalid Address',
    hint: 'The Bitcoin address in this request is not valid.',
  },
  NETWORK_MISMATCH: {
    icon: 'git-network-outline',
    title: 'Network Mismatch',
    hint: 'The receiver is on a different Bitcoin network (mainnet vs testnet).',
  },
  AMOUNT_INVALID: {
    icon: 'alert-circle-outline',
    title: 'Invalid Amount',
    hint: 'The requested amount is not valid.',
  },
  UNKNOWN: {
    icon: 'warning-outline',
    title: 'Something Went Wrong',
  },
};

export function NearbyError() {
  const { colors, isDark } = useTheme();
  const { retry, cancel } = useNearby();
  const error = useNearbySessionStore((s) => s.error);

  const code = error?.code ?? 'UNKNOWN';
  const config = ERROR_CONFIG[code] ?? ERROR_CONFIG.UNKNOWN;
  const message = error?.message ?? 'An unexpected error occurred. Please try again.';

  const showSettings = code === 'BLE_POWERED_OFF' || code === 'BLE_PERMISSION_DENIED';

  const handleOpenSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const errorRed = isDark ? 'rgba(255, 69, 58,' : 'rgba(255, 59, 48,';

  return (
    <View style={styles.container}>
      {/* Error icon */}
      <Animated.View
        entering={FadeIn.duration(400)}
        style={styles.iconSection}
      >
        <View style={[styles.iconOuter, {
          backgroundColor: `${errorRed} 0.08)`,
        }]}>
          <LinearGradient
            colors={[`${errorRed} 0.12)`, `${errorRed} 0.03)`]}
            style={styles.iconGlow}
          />
          <View style={[styles.iconInner, {
            backgroundColor: `${errorRed} 0.15)`,
          }]}>
            <Ionicons name={config.icon} size={28} color={colors.error} />
          </View>
        </View>
      </Animated.View>

      {/* Title */}
      <Animated.Text
        entering={FadeInDown.delay(100).duration(400)}
        style={[styles.title, { color: colors.textPrimary }]}
      >
        {config.title}
      </Animated.Text>

      {/* Error message */}
      <Animated.Text
        entering={FadeInDown.delay(200).duration(400)}
        style={[styles.message, { color: colors.textSecondary }]}
      >
        {message}
      </Animated.Text>

      {/* Hint card */}
      {config.hint && (
        <Animated.View
          entering={FadeInDown.delay(300).duration(400)}
          style={styles.hintWrapper}
        >
          <View style={[styles.hintCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
            <View style={styles.hintRow}>
              <Ionicons
                name="information-circle"
                size={16}
                color={colors.textTertiary}
              />
              <Text style={[styles.hintText, { color: colors.textTertiary }]}>
                {config.hint}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Actions */}
      <Animated.View
        entering={FadeInDown.delay(400).duration(400)}
        style={styles.actions}
      >
        <AppButton
          title="Try Again"
          onPress={retry}
          variant="primary"
          icon="refresh"
          haptic="medium"
        />

        {showSettings && (
          <AppButton
            title="Open Settings"
            onPress={handleOpenSettings}
            variant="secondary"
            icon="settings-outline"
            haptic="light"
          />
        )}
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
  iconGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44,
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
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
    letterSpacing: -0.2,
  },
  hintWrapper: {
    width: '100%',
    marginBottom: 32,
  },
  hintCard: {
    borderRadius: 16,
    padding: 8,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintText: {
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
