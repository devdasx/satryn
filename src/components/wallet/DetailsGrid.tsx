/**
 * DetailsGrid - Compact wallet details display
 *
 * Shows wallet metadata in a clean grid layout.
 * Labels in micro typography, values in caption style.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks';

interface DetailItem {
  label: string;
  value: string;
}

interface DetailsGridProps {
  items: DetailItem[];
  columns?: 2 | 3 | 4;
}

export function DetailsGrid({ items, columns = 3 }: DetailsGridProps) {
  const { isDark } = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.grid, { flexWrap: 'wrap' }]}>
        {items.map((item, index) => (
          <View
            key={item.label}
            style={[
              styles.cell,
              {
                width: `${100 / columns}%`,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: isDark
                    ? 'rgba(255,255,255,0.30)'
                    : 'rgba(0,0,0,0.30)',
                },
              ]}
            >
              {item.label}
            </Text>
            <Text
              style={[
                styles.value,
                {
                  color: isDark
                    ? 'rgba(255,255,255,0.85)'
                    : 'rgba(0,0,0,0.70)',
                },
              ]}
              numberOfLines={1}
            >
              {item.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  grid: {
    flexDirection: 'row',
  },
  cell: {
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  value: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
  },
});

export default DetailsGrid;
