/**
 * AmountHeroDisplay — Large centered amount with unit inline + fiat conversion subtitle.
 * Cash App / Strike inspired hero number display.
 *
 * The unit symbol or currency sign is displayed inline with the amount:
 *   - Fiat: "$420" or "420 €"  (prefix or suffix depending on currency convention)
 *   - BTC units: "0.005 BTC", "50000 SAT", etc. (suffix)
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { useWalletStore } from '../../stores/walletStore';
import { getUnitSymbol, unitToSats, formatUnitAmount } from '../../utils/formatting';
import { PriceAPI, CURRENCY_SYMBOLS } from '../../services/api/PriceAPI';
import type { InputUnit } from '../../stores/sendStore';

// Currencies that show the symbol AFTER the amount (e.g. "420 €")
const SUFFIX_CURRENCIES = new Set([
  'EUR', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK',
]);

export type AmountWarningType = 'over-balance' | 'dust' | null;

interface AmountHeroDisplayProps {
  amountInput: string;
  inputUnit: InputUnit;
  isSendMax: boolean;
  onCycleUnit: () => void;
  /** When set, turns the hero amount text red */
  warningType?: AmountWarningType;
  /** Override balance used for MAX subtitle (e.g. available balance for multi-recipient) */
  availableBalanceSats?: number;
}

export function AmountHeroDisplay({
  amountInput,
  inputUnit,
  isSendMax,
  onCycleUnit,
  warningType,
  availableBalanceSats: availableBalanceOverride,
}: AmountHeroDisplayProps) {
  const { isDark, colors } = useTheme();
  const hasWarning = !!warningType;
  const { currency, denomination } = useSettingsStore();
  const price = usePriceStore((s) => s.price);
  const walletBalanceSats = useWalletStore((s) => s.balance.total);
  const balanceSats = availableBalanceOverride ?? walletBalanceSats;

  const displayAmount = isSendMax ? 'MAX' : amountInput || '0';

  // Determine the inline symbol and its position
  const { prefix, suffix } = useMemo(() => {
    if (isSendMax) return { prefix: '', suffix: '' };

    if (inputUnit === 'fiat') {
      const currCode = currency || 'USD';
      const symbol = CURRENCY_SYMBOLS[currCode] || currCode;
      if (SUFFIX_CURRENCIES.has(currCode)) {
        return { prefix: '', suffix: ` ${symbol}` };
      }
      return { prefix: symbol, suffix: '' };
    }

    // BTC unit — show symbol as suffix
    const symbol = getUnitSymbol(inputUnit);
    return { prefix: '', suffix: ` ${symbol}` };
  }, [inputUnit, currency, isSendMax]);

  // Calculate conversion subtitle
  const subtitle = useMemo(() => {
    if (isSendMax) {
      // Show balance in the current input unit instead of "Sending entire balance"
      if (inputUnit === 'fiat') {
        if (!price || !balanceSats) return '';
        const fiatValue = (balanceSats / 100_000_000) * price;
        return PriceAPI.formatPrice(fiatValue, currency || 'USD');
      }
      return formatUnitAmount(balanceSats, inputUnit);
    }
    if (!amountInput || amountInput === '0') return '';

    const numValue = parseFloat(amountInput);
    if (isNaN(numValue) || numValue <= 0) return '';

    if (inputUnit === 'fiat') {
      if (!price) return '';
      const sats = Math.round((numValue / price) * 100_000_000);
      return formatUnitAmount(sats, denomination);
    }

    const sats = unitToSats(numValue, inputUnit);
    if (sats <= 0 || !price) return '';
    const fiatValue = (sats / 100_000_000) * price;
    return PriceAPI.formatPrice(fiatValue, currency || 'USD');
  }, [amountInput, inputUnit, price, currency, denomination, isSendMax, balanceSats]);

  return (
    <View style={styles.container}>
      {/* Hero number with inline unit */}
      <TouchableOpacity
        onPress={onCycleUnit}
        activeOpacity={0.7}
        style={styles.heroRow}
      >
        <Text
          style={[
            styles.heroAmount,
            { color: hasWarning ? colors.error : colors.text },
            isSendMax && styles.heroMax,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.3}
        >
          {prefix ? (
            <Text style={[styles.unitInline, { color: hasWarning ? colors.errorLight : colors.textTertiary }]}>
              {prefix}
            </Text>
          ) : null}
          {displayAmount}
          {suffix ? (
            <Text style={[styles.unitInline, { color: hasWarning ? colors.errorLight : colors.textTertiary }]}>
              {suffix}
            </Text>
          ) : null}
        </Text>
      </TouchableOpacity>

      {/* Tap hint pill */}
      <TouchableOpacity
        style={[styles.unitPill, { backgroundColor: colors.fillSecondary }]}
        onPress={onCycleUnit}
        activeOpacity={0.7}
      >
        <Text style={[styles.unitPillText, { color: colors.textSecondary }]}>
          {inputUnit === 'fiat' ? (currency || 'USD') : getUnitSymbol(inputUnit)}
        </Text>
        <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
      </TouchableOpacity>

      {/* Conversion subtitle */}
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
          {'\u2248 '}{subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  heroRow: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  heroAmount: {
    fontSize: 56,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    textAlign: 'center',
    maxWidth: '100%',
  },
  heroMax: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: 2,
  },
  unitInline: {
    fontSize: 32,
    fontWeight: '500',
    letterSpacing: 0,
  },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  unitPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 8,
  },
});
