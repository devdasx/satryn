/**
 * PreservedDataRecoverySheet — Post-reinstall recovery bottom sheet
 *
 * Shown on the onboarding screen when preserved wallet data is detected in the
 * iOS Keychain after a reinstall. Allows the user to recover all data or dismiss.
 *
 * Design: premium glass card with animated shield icon, wallet summary,
 * and primary "Recover My Data" button.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme, useHaptics } from '../../hooks';
import type { PreservedManifest } from '../../services/storage/PreservedArchiveService';

// ─── Props ──────────────────────────────────────────────────────

interface PreservedDataRecoverySheetProps {
  visible: boolean;
  onClose: () => void;
  manifest: PreservedManifest;
  onRecover: () => void;
  onStartFresh: () => void;
  onDismissForever: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────

function formatTimeAgo(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  }
  if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  }
  const days = Math.floor(diffSec / 86400);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ─── Component ──────────────────────────────────────────────────

export function PreservedDataRecoverySheet({
  visible,
  onClose,
  manifest,
  onRecover,
  onStartFresh,
  onDismissForever,
}: PreservedDataRecoverySheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  // Animated shield glow
  const glowOpacity = useSharedValue(0.3);
  const iconScale = useSharedValue(0.8);

  useEffect(() => {
    if (visible) {
      glowOpacity.value = withRepeat(
        withTiming(0.8, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      iconScale.value = withSpring(1, { damping: 12, stiffness: 100 });
    }
  }, [visible]);

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const animatedIcon = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const handleStartFresh = () => {
    haptics.trigger('warning');
    Alert.alert(
      'Start Fresh?',
      'This will permanently delete all preserved wallet data from this device. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete & Start Fresh',
          style: 'destructive',
          onPress: onStartFresh,
        },
      ],
    );
  };

  const handleDismissForever = () => {
    Alert.alert(
      'Don\'t Show Again?',
      'Your preserved data will remain in the Keychain but this recovery prompt won\'t appear again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Don\'t Show Again',
          onPress: onDismissForever,
        },
      ],
    );
  };

  const walletCount = manifest.walletCount;
  const walletNames = manifest.wallets.map(w => w.walletName).join(', ');
  const totalBalance = manifest.wallets.reduce((sum, w) => sum + w.balanceSat, 0);
  const timeAgo = formatTimeAgo(manifest.preservedAt);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing="auto"
      dismissible={false}
    >
      <View style={styles.container}>
        {/* Animated Shield Icon */}
        <View style={styles.iconContainer}>
          <Animated.View style={[styles.glowCircle, animatedGlow, {
            backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.10)',
          }]} />
          <Animated.View style={[styles.iconCircle, animatedIcon, {
            backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
          }]}>
            <Ionicons name="shield-checkmark" size={36} color="#30D158" />
          </Animated.View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          We found your preserved wallet data
        </Text>

        {/* Wallet Summary Card */}
        <View style={[styles.summaryCard, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        }]}>
          {/* Wallet count */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryIcon, {
              backgroundColor: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(10,132,255,0.08)',
            }]}>
              <Ionicons name="wallet-outline" size={16} color="#0A84FF" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Wallets</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
              </Text>
            </View>
          </View>

          {/* Wallet names */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryIcon, {
              backgroundColor: isDark ? 'rgba(175,130,255,0.12)' : 'rgba(175,130,255,0.08)',
            }]}>
              <Ionicons name="list-outline" size={16} color="#AF82FF" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Names</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]} numberOfLines={2}>
                {walletNames}
              </Text>
            </View>
          </View>

          {/* Last saved */}
          <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
            <View style={[styles.summaryIcon, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
            }]}>
              <Ionicons name="time-outline" size={16} color="#30D158" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Last Saved</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {timeAgo}
              </Text>
            </View>
          </View>
        </View>

        {/* Primary Button — Recover */}
        <TouchableOpacity
          onPress={() => {
            haptics.trigger('selection');
            onRecover();
          }}
          activeOpacity={0.7}
          style={[styles.primaryButton, {
            backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
          }]}
        >
          <Ionicons
            name="refresh-outline"
            size={18}
            color={isDark ? '#000000' : '#FFFFFF'}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.primaryButtonText, {
            color: isDark ? '#000000' : '#FFFFFF',
          }]}>
            Recover My Data
          </Text>
        </TouchableOpacity>

        {/* Secondary — Start Fresh */}
        <TouchableOpacity
          onPress={handleStartFresh}
          activeOpacity={0.7}
          style={styles.secondaryButton}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textMuted }]}>
            Start Fresh
          </Text>
        </TouchableOpacity>

        {/* Dismiss Forever */}
        <TouchableOpacity
          onPress={handleDismissForever}
          activeOpacity={0.7}
          style={styles.dismissButton}
        >
          <Text style={[styles.dismissButtonText, {
            color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)',
          }]}>
            Don't show again
          </Text>
        </TouchableOpacity>
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    alignItems: 'center',
  },

  // Icon
  iconContainer: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  glowCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Title
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 20,
  },

  // Summary Card
  summaryCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.12)',
  },
  summaryIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  summaryContent: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Buttons
  primaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    marginBottom: 4,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dismissButton: {
    paddingVertical: 8,
  },
  dismissButtonText: {
    fontSize: 12,
    fontWeight: '400',
  },
});
