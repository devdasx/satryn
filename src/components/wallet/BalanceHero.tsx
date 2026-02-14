/**
 * BalanceHero - Large balance display
 *
 * Prominent balance with BTC/sats toggle and fiat conversion.
 * Premium typography with no card wrapper.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';
import { formatAmount, formatFiat, formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import { FORMATTING, BITCOIN_UNITS } from '../../constants';
import type { BitcoinUnit } from '../../types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface BalanceHeroProps {
  balanceSat: number;
  unconfirmedSat?: number;
  fiatValue?: number;
  denomination: BitcoinUnit;
  onToggleDenomination: () => void;
  currency?: string;
}

export function BalanceHero({
  balanceSat,
  unconfirmedSat = 0,
  fiatValue,
  denomination,
  onToggleDenomination,
  currency = 'USD',
}: BalanceHeroProps) {
  const { isDark } = useTheme();
  const { trigger } = useHaptics();
  const scale = useSharedValue(1);

  const unitSymbol = getUnitSymbol(denomination);

  // Format balance based on denomination
  const formattedBalance = formatUnitAmount(balanceSat, denomination, false);
  const unit = unitSymbol;

  // Format unconfirmed if present
  const hasUnconfirmed = unconfirmedSat !== 0;
  const unconfirmedFormatted = hasUnconfirmed
    ? `${unconfirmedSat > 0 ? '+' : ''}${formatAmount(unconfirmedSat, denomination, false)}`
    : null;

  // Format fiat
  const fiatFormatted = fiatValue !== undefined
    ? formatFiat(fiatValue, currency)
    : null;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const handlePress = () => {
    trigger('selection');
    onToggleDenomination();
  };

  return (
    <AnimatedPressable
      entering={FadeIn.duration(400)}
      style={[styles.container, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      {/* Main balance */}
      <View style={styles.balanceRow}>
        <Text
          style={[
            styles.balance,
            {
              color: isDark ? '#FFFFFF' : '#000000',
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {formattedBalance}
        </Text>
        <Text
          style={[
            styles.unit,
            {
              color: isDark
                ? 'rgba(255,255,255,0.45)'
                : 'rgba(0,0,0,0.45)',
            },
          ]}
        >
          {unit}
        </Text>
      </View>

      {/* Unconfirmed indicator */}
      {hasUnconfirmed && (
        <Text
          style={[
            styles.unconfirmed,
            {
              color: unconfirmedSat > 0 ? '#30D158' : '#FF453A',
            },
          ]}
        >
          {unconfirmedFormatted} pending
        </Text>
      )}

      {/* Secondary value — fiat equivalent */}
      {fiatFormatted ? (
        <Text
          style={[
            styles.fiat,
            { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)' },
          ]}
        >
          ≈ {fiatFormatted}
        </Text>
      ) : null}

      {/* Toggle hint */}
      <Text
        style={[
          styles.hint,
          {
            color: isDark
              ? 'rgba(255,255,255,0.20)'
              : 'rgba(0,0,0,0.20)',
          },
        ]}
      >
        Tap to toggle {currency}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  balance: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  unconfirmed: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  fiat: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 6,
    letterSpacing: -0.2,
  },
  hint: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 12,
    letterSpacing: 0.2,
  },
});

export default BalanceHero;
