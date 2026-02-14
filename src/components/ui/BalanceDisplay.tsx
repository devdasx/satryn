import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME } from '../../constants/theme';
import { FORMATTING, BITCOIN_UNITS } from '../../constants';
import { useTheme } from '../../hooks/useTheme';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import type { BitcoinUnit } from '../../types';

interface BalanceDisplayProps {
  balanceSats: number;
  usdValue?: number;
  denomination: BitcoinUnit;
  showChange?: boolean;
  change24h?: number;
  compact?: boolean;
  /** Enable pulse animation when balance changes */
  animated?: boolean;
  currency?: string;
}

export function BalanceDisplay({
  balanceSats,
  usdValue,
  denomination,
  showChange = false,
  change24h = 0,
  compact = false,
  animated = false,
  currency = 'USD',
}: BalanceDisplayProps) {
  const { colors, theme } = useTheme();

  // Animation values (only used when animated=true)
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1.02,
          friction: 8,
          tension: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 10,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [balanceSats, animated]);

  const unitSymbol = getUnitSymbol(denomination);

  const formatBtcAmount = (sats: number): string => {
    return formatUnitAmount(sats, denomination, false);
  };

  const formatUsd = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const isPositiveChange = change24h >= 0;

  const animStyle = animated
    ? { transform: [{ scale: scaleAnim }], opacity: opacityAnim }
    : undefined;

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <Text style={[styles.compactAmount, { color: colors.text }]}>
          {formatBtcAmount(balanceSats)}
          <Text style={[styles.compactUnit, { color: colors.textSecondary }]}>
            {` ${unitSymbol}`}
          </Text>
        </Text>
        {usdValue !== undefined && (
          <Text style={[styles.compactUsd, { color: colors.textSecondary }]}>{formatUsd(usdValue)}</Text>
        )}
      </View>
    );
  }

  const content = (
    <>
      {/* Main Balance */}
      <View style={styles.balanceRow}>
        <Text style={[styles.amount, { color: colors.text }]}>
          {formatBtcAmount(balanceSats)}
        </Text>
        <LinearGradient
          colors={[...THEME.gradients.bitcoin]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.unitBadge}
        >
          <Text style={styles.unit}>
            {unitSymbol}
          </Text>
        </LinearGradient>
      </View>

      {/* USD Value */}
      {usdValue !== undefined && (
        <View style={styles.usdRow}>
          <Text style={[styles.usdValue, { color: colors.textSecondary }]}>{formatUsd(usdValue)}</Text>
          {showChange && (
            <View
              style={[
                styles.changeBadge,
                { backgroundColor: isPositiveChange ? colors.successMuted : colors.errorMuted },
              ]}
            >
              <Text
                style={[
                  styles.changeText,
                  { color: isPositiveChange ? colors.success : colors.error },
                ]}
              >
                {isPositiveChange ? '+' : ''}{change24h.toFixed(2)}%
              </Text>
            </View>
          )}
        </View>
      )}
    </>
  );

  if (animated) {
    return (
      <Animated.View style={[styles.container, animStyle]}>
        {content}
      </Animated.View>
    );
  }

  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  amount: {
    fontSize: THEME.typography.size['4xl'],
    fontWeight: THEME.typography.weight.bold,
    letterSpacing: THEME.typography.letterSpacing.tight,
    fontVariant: ['tabular-nums'],
  },
  unitBadge: {
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.xs,
    borderRadius: THEME.radius.sm,
    marginLeft: THEME.spacing.sm,
    marginBottom: 6,
  },
  unit: {
    fontSize: THEME.typography.size.sm,
    fontWeight: THEME.typography.weight.bold,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  usdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: THEME.spacing.sm,
  },
  usdValue: {
    fontSize: THEME.typography.size.lg,
    fontWeight: THEME.typography.weight.medium,
  },
  changeBadge: {
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.xs,
    borderRadius: THEME.radius.full,
    marginLeft: THEME.spacing.sm,
  },
  changeText: {
    fontSize: THEME.typography.size.sm,
    fontWeight: THEME.typography.weight.semibold,
  },
  // Compact styles
  compactContainer: {
    alignItems: 'flex-start',
  },
  compactAmount: {
    fontSize: THEME.typography.size.xl,
    fontWeight: THEME.typography.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  compactUnit: {
    fontSize: THEME.typography.size.sm,
    fontWeight: THEME.typography.weight.medium,
  },
  compactUsd: {
    fontSize: THEME.typography.size.sm,
    marginTop: 2,
  },
});
