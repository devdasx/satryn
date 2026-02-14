import React, { useEffect, useRef, useMemo, memo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { FORMATTING, BITCOIN_UNITS } from '../../constants';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import type { BitcoinUnit } from '../../types';

interface AnimatedBalanceProps {
  balanceSats: number;
  fiatValue?: number;
  currency?: string;
  denomination: BitcoinUnit;
  colors: any;
  theme: any;
}

export const AnimatedBalance = memo(function AnimatedBalance({
  balanceSats,
  fiatValue,
  currency = 'USD',
  denomination,
  colors,
  theme,
}: AnimatedBalanceProps) {
  // Animated values using standard React Native Animated API
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Create a pulse animation when balance changes
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
  }, [balanceSats]);

  const unitSymbol = getUnitSymbol(denomination);

  // Memoize formatted values to avoid recreation on every render
  const formattedBalance = useMemo(
    () => formatUnitAmount(balanceSats, denomination, false),
    [balanceSats, denomination],
  );

  const formattedFiat = useMemo(() => {
    if (fiatValue === undefined) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(fiatValue);
  }, [fiatValue, currency]);

  return (
    <View style={styles.container}>
      {/* Balance Label */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        TOTAL BALANCE
      </Text>

      {/* Main Balance */}
      <Animated.View
        style={[
          styles.balanceContainer,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <Text style={[styles.balanceValue, { color: colors.text }]}>
          {formattedBalance}
        </Text>
        <View style={[styles.unitBadge, { backgroundColor: theme.brand.bitcoin }]}>
          <Text style={styles.unitText}>
            {unitSymbol}
          </Text>
        </View>
      </Animated.View>

      {/* Fiat Value */}
      {fiatValue !== undefined && (
        <Animated.View
          style={{
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          }}
        >
          <Text style={[styles.fiatValue, { color: colors.textSecondary }]}>
            ≈ {formattedFiat}
          </Text>
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  balanceValue: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  unitBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 10,
    marginBottom: 8,
  },
  unitText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  fiatValue: {
    fontSize: 18,
    fontWeight: '500',
    marginTop: 8,
  },
});
