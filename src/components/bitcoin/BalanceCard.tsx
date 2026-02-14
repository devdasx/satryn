import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Card } from '../ui/Card';
import { formatAmount, formatFiat, satsToFiat } from '../../utils/formatting';
import { getColors } from '../../constants';
import { useTheme } from '../../hooks';
import { useSettingsStore, usePriceStore } from '../../stores';

interface BalanceCardProps {
  confirmedBalance: number; // in satoshis
  unconfirmedBalance: number; // in satoshis
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function BalanceCard({
  confirmedBalance,
  unconfirmedBalance,
  onRefresh,
  isLoading,
}: BalanceCardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const denomination = useSettingsStore(s => s.denomination);
  const currency = useSettingsStore(s => s.currency);
  const price = usePriceStore(s => s.price);
  const change24h = usePriceStore(s => s.change24h);

  const totalBalance = confirmedBalance + unconfirmedBalance;
  const fiatValue = price ? satsToFiat(totalBalance, price) : null;

  return (
    <Card variant="elevated" style={[styles.card, { backgroundColor: c.primaryButton.bg }]}>
      <View style={styles.header}>
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500' }}>Total Balance</Text>
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} disabled={isLoading}>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500', opacity: isLoading ? 0.5 : 1 }}>
              {isLoading ? 'Syncing...' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.balance, { color: '#FFFFFF' }]}>
        {formatAmount(totalBalance, denomination, true)}
      </Text>

      {fiatValue !== null && (
        <Text style={[styles.fiatValue, { color: 'rgba(255,255,255,0.9)' }]}>
          {formatFiat(fiatValue, currency)}
        </Text>
      )}

      {unconfirmedBalance > 0 && (
        <View style={styles.pendingContainer}>
          <View style={[styles.pendingDot, { backgroundColor: c.semantic.warning }]} />
          <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
            {formatAmount(unconfirmedBalance, denomination, false)} pending
          </Text>
        </View>
      )}

      {price && (
        <View style={styles.priceContainer}>
          <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
            1 BTC = {formatFiat(price, currency)}
          </Text>
          <Text style={[
            styles.changeText,
            { color: change24h >= 0 ? c.semantic.success : c.semantic.error },
          ]}>
            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balance: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 4,
  },
  fiatValue: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 12,
  },
  pendingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  changeText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
});
