/**
 * WalletHubEmptyState
 * Premium empty state when no wallets exist.
 * Matches Portfolio design: 3 concentric rings + title + subtitle + CTAs.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';

export interface WalletHubEmptyStateProps {
  onCreateWallet: () => void;
  onImportWallet: () => void;
}

export function WalletHubEmptyState({
  onCreateWallet,
  onImportWallet,
}: WalletHubEmptyStateProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  return (
    <View style={styles.container}>
      {/* Decorative rings — matches Portfolio design */}
      <View style={styles.rings}>
        <Animated.View
          entering={FadeInDown.duration(600).delay(100)}
          style={[styles.ring3, {
            borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          }]}
        />
        <Animated.View
          entering={FadeInDown.duration(600).delay(50)}
          style={[styles.ring2, {
            borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
          }]}
        />
        <Animated.View
          entering={FadeInDown.duration(500)}
          style={[styles.iconCircle, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
          }]}
        >
          <Ionicons
            name="wallet-outline"
            size={30}
            color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}
          />
        </Animated.View>
      </View>

      <Animated.Text
        entering={FadeInDown.duration(500).delay(150)}
        style={[styles.title, { color: colors.text }]}
      >
        No wallets yet
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(500).delay(200)}
        style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}
      >
        Create or restore a wallet to get started.
      </Animated.Text>

      <Animated.View entering={FadeInDown.duration(500).delay(280)} style={styles.actions}>
        <Pressable
          style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
          onPress={() => {
            haptics.trigger('light');
            onCreateWallet();
          }}
        >
          <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
            Create New Wallet
          </Text>
        </Pressable>

        <Pressable
          style={[styles.secondaryButton, {
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
          }]}
          onPress={() => {
            haptics.trigger('light');
            onImportWallet();
          }}
        >
          <Text style={[styles.secondaryButtonText, {
            color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
          }]}>
            Restore from iCloud
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 40,
  },
  rings: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ring3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  ring2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '400',
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  secondaryButton: {
    height: 45,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
