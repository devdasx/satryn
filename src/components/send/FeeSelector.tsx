/**
 * FeeSelector — Inline horizontal segmented fee bar (Fast / Normal / Slow) with sat/vB display.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import type { FeeOption } from '../../stores/sendStore';
import type { FeeRecommendation } from '../../types';

interface FeeSelectorProps {
  selected: FeeOption;
  feeRate: number;
  estimates: FeeRecommendation | null;
  onSelect: (option: FeeOption) => void;
  onCustomPress: () => void;
}

const OPTIONS: { key: FeeOption; label: string; icon: string }[] = [
  { key: 'fast', label: 'Fast', icon: 'flash' },
  { key: 'normal', label: 'Normal', icon: 'time' },
  { key: 'slow', label: 'Slow', icon: 'leaf' },
];

function getFeeForOption(option: FeeOption, estimates: FeeRecommendation | null): number | null {
  if (!estimates) return null;
  switch (option) {
    case 'fast': return estimates.fastest;
    case 'normal': return estimates.halfHour;
    case 'slow': return estimates.hour;
    default: return null;
  }
}

function getTimeLabel(option: FeeOption): string {
  switch (option) {
    case 'fast': return '~10 min';
    case 'normal': return '~30 min';
    case 'slow': return '~60 min';
    default: return '';
  }
}

export function FeeSelector({
  selected,
  feeRate,
  estimates,
  onSelect,
  onCustomPress,
}: FeeSelectorProps) {
  const { isDark, colors } = useTheme();

  return (
    <View style={styles.container}>
      {/* Segmented bar */}
      <View style={[styles.segmentedBar, { backgroundColor: colors.fillSecondary }]}>
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.key;
          const optFee = getFeeForOption(opt.key, estimates);

          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.segment,
                isSelected && {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                },
              ]}
              onPress={() => onSelect(opt.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={opt.icon as any}
                size={14}
                color={isSelected ? colors.text : colors.textTertiary}
              />
              <Text style={[
                styles.segmentLabel,
                { color: isSelected ? colors.text : colors.textSecondary },
              ]}>
                {opt.label}
              </Text>
              {optFee !== null && (
                <Text style={[styles.segmentRate, { color: colors.textMuted }]}>
                  {optFee} sat/vB
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Custom fee & current rate */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.customButton}
          onPress={onCustomPress}
          activeOpacity={0.7}
        >
          <Ionicons name="options-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.customText, { color: colors.textTertiary }]}>
            {selected === 'custom' ? `Custom: ${feeRate} sat/vB` : 'Custom fee'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.etaText, { color: colors.textMuted }]}>
          {selected !== 'custom' ? getTimeLabel(selected) : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  segmentedBar: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 2,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  segmentRate: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  customText: {
    fontSize: 13,
    fontWeight: '500',
  },
  etaText: {
    fontSize: 12,
  },
});
