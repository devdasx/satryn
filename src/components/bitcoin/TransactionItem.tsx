import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatAmount, formatRelativeTime, truncateAddress } from '../../utils/formatting';
import { useTheme } from '../../hooks/useTheme';
import { useSettingsStore } from '../../stores';
import type { TransactionInfo } from '../../types';

interface TransactionItemProps {
  transaction: TransactionInfo;
  onPress?: () => void;
}

export const TransactionItem = memo(function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const denomination = useSettingsStore(s => s.denomination);
  const { colors } = useTheme();

  const isIncoming = transaction.type === 'incoming';
  const amountColor = isIncoming ? colors.success : colors.text;
  const amountPrefix = isIncoming ? '+' : '-';

  const statusIcon = useMemo((): { name: keyof typeof Ionicons.glyphMap; color: string } => {
    switch (transaction.status) {
      case 'pending':
        return { name: 'time-outline', color: colors.warning };
      case 'confirmed':
        return isIncoming
          ? { name: 'arrow-down', color: colors.success }
          : { name: 'arrow-up', color: colors.text };
      case 'failed':
        return { name: 'close-circle-outline', color: colors.error };
      default:
        return { name: 'ellipse-outline', color: colors.textSecondary };
    }
  }, [transaction.status, isIncoming, colors]);

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
        <Ionicons name={statusIcon.name} size={20} color={statusIcon.color} />
      </View>

      <View style={styles.details}>
        <Text style={[styles.type, { color: colors.text }]}>
          {isIncoming ? 'Received' : 'Sent'}
        </Text>
        <Text style={[styles.address, { color: colors.textSecondary }]} numberOfLines={1}>
          {truncateAddress(transaction.address)}
        </Text>
      </View>

      <View style={styles.amountContainer}>
        <Text style={[styles.amount, { color: amountColor }]}>
          {amountPrefix}{formatAmount(Math.abs(transaction.amount), denomination, false)}
        </Text>
        <Text style={[styles.time, { color: colors.textSecondary }]}>
          {formatRelativeTime(transaction.timestamp)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  details: {
    flex: 1,
  },
  type: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  address: {
    fontSize: 14,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  time: {
    fontSize: 12,
  },
});
