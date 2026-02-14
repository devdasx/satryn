import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DetectionResult } from '../../services/import/types';

interface DetectedBadgeProps {
  detection: DetectionResult;
  isDark: boolean;
}

export function DetectedBadge({ detection, isDark }: DetectedBadgeProps) {
  if (!detection.isMainnet) {
    return (
      <View style={[styles.badge, styles.badgeError, isDark && styles.badgeErrorDark]}>
        <Text style={[styles.badgeText, styles.badgeTextError]}>
          Testnet — Not Supported
        </Text>
      </View>
    );
  }

  const bgColor = detection.confidence === 'definite'
    ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)')
    : detection.confidence === 'likely'
      ? (isDark ? 'rgba(255,214,10,0.12)' : 'rgba(255,214,10,0.10)')
      : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)');

  const textColor = detection.confidence === 'definite'
    ? '#30D158'
    : detection.confidence === 'likely'
      ? '#FFD60A'
      : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)');

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>
        {detection.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  badgeError: {
    backgroundColor: 'rgba(255,69,58,0.12)',
  },
  badgeErrorDark: {
    backgroundColor: 'rgba(255,69,58,0.15)',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  badgeTextError: {
    color: '#FF453A',
  },
});
