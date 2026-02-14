/**
 * NearbyHeader — Premium glassmorphic header for Nearby Payments
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants/theme';
import type { NearbyMode } from '../../services/nearby/types';

interface NearbyHeaderProps {
  mode: NearbyMode;
  onClose: () => void;
}

export function NearbyHeader({ mode, onClose }: NearbyHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Close button with glass background */}
      <TouchableOpacity
        onPress={onClose}
        style={[styles.closeButton, { backgroundColor: colors.glass }]}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.textPrimary }]}>
        Nearby
      </Text>

      {/* Mode pill with glass effect */}
      <View style={[styles.modePill, {
        backgroundColor: Platform.OS !== 'ios' ? colors.glass : undefined,
        overflow: 'hidden',
      }]}>
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={THEME.liquidGlass.blur.subtle}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={styles.modePillContent}>
          <View style={[styles.modeIconDot, {
            backgroundColor: mode === 'receive'
              ? 'rgba(48, 209, 88, 0.15)'
              : 'rgba(247, 147, 26, 0.15)',
          }]}>
            <Ionicons
              name={mode === 'receive' ? 'arrow-down' : 'arrow-up'}
              size={11}
              color={mode === 'receive' ? colors.success : THEME.brand.bitcoin}
            />
          </View>
          <Text style={[styles.modeText, { color: colors.textSecondary }]}>
            {mode === 'receive' ? 'Receive' : 'Send'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  modePill: {
    borderRadius: 14,
  },
  modePillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modeIconDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
