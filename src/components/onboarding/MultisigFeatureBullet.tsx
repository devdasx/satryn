/**
 * MultisigFeatureBullet — Security highlight bullet with icon and text.
 * Used in the Multisig Intro screen hero section.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';

interface MultisigFeatureBulletProps {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}

export function MultisigFeatureBullet({ icon, text }: MultisigFeatureBulletProps) {
  const { isDark } = useTheme();

  const iconBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const iconColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';
  const textColor = isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.60)';

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
});
