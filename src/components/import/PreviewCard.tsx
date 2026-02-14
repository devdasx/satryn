import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PreviewCardProps {
  address: string;
  scriptType: string;
  isDark: boolean;
}

export function PreviewCard({ address, scriptType, isDark }: PreviewCardProps) {
  const scriptTypeLabels: Record<string, string> = {
    native_segwit: 'Native SegWit (bc1q...)',
    wrapped_segwit: 'Wrapped SegWit (3...)',
    legacy: 'Legacy (1...)',
    taproot: 'Taproot (bc1p...)',
  };

  return (
    <View style={[
      styles.card,
      { backgroundColor: isDark ? '#161618' : '#F5F5F7' },
    ]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
          Address Type
        </Text>
        <Text style={[styles.value, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
          {scriptTypeLabels[scriptType] || scriptType}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
      <View style={styles.row}>
        <Text style={[styles.label, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
          First Address
        </Text>
        <Text
          style={[styles.addressValue, { color: isDark ? '#FFFFFF' : '#000000' }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {address}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 16,
    gap: 0,
  },
  row: {
    paddingVertical: 6,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
  addressValue: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  divider: {
    height: 1,
    marginVertical: 6,
  },
});
