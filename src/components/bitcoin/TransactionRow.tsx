import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useSettingsStore } from '../../stores';
import { usePriceStore } from '../../stores/priceStore';
import { PriceAPI } from '../../services/api/PriceAPI';
import { formatUnitAmount, formatRelativeTime } from '../../utils/formatting';
import { FORMATTING, THEME, BITCOIN_UNITS, getColors } from '../../constants';
import type { DetailedTransactionInfo } from '../../types';

// ─── Props ──────────────────────────────────────────────────────

interface TransactionRowProps {
  tx: DetailedTransactionInfo;
  /** Set of own wallet addresses — used to detect self-transfers */
  ownAddresses: Set<string>;
  /** Called when user taps the row */
  onPress?: (tx: DetailedTransactionInfo) => void;
  /** Called on long press */
  onLongPress?: (tx: DetailedTransactionInfo) => void;
  /** Show a divider at the bottom (default: true) */
  showDivider?: boolean;
  /** Show chevron arrow on the right (default: false) */
  showChevron?: boolean;
  /** Optional note text (from tx labels) */
  note?: string;
  /** Optional tags (from tx labels) */
  tags?: string[];
}

// ─── Component ──────────────────────────────────────────────────

export const TransactionRow = memo(function TransactionRow({
  tx,
  ownAddresses,
  onPress,
  onLongPress,
  showDivider = true,
  showChevron = false,
  note,
  tags,
}: TransactionRowProps) {
  const { isDark, themeMode, colors } = useTheme();
  const c = getColors(themeMode);
  const denomination = useSettingsStore(s => s.denomination);
  const currency = useSettingsStore(s => s.currency);
  const discreetMode = useSettingsStore(s => s.discreetMode);
  const price = usePriceStore((s) => s.price);

  const isReceive = tx.type === 'incoming';
  const isPending = !tx.confirmed;
  const isSelf = tx.type === 'self-transfer';

  // ─── Label ──────────────────────────────────────────────

  const label = isPending
    ? (isReceive ? 'Receiving' : isSelf ? 'Self Transfer' : 'Sending')
    : isSelf ? 'Self Transfer' : isReceive ? 'Received' : 'Sent';

  const txTime = tx.blockTime ? formatRelativeTime(tx.blockTime) : 'Just now';

  // ─── Icon ───────────────────────────────────────────────

  const iconName = isPending
    ? 'time-outline' as const
    : isSelf
      ? 'swap-horizontal' as const
      : isReceive
        ? 'arrow-down' as const
        : 'arrow-up' as const;

  const receiveColor = c.sync.synced;

  const iconBg = isPending
    ? c.txRowExtended.pendingIconBg
    : isSelf
      ? c.txRowExtended.selfIconBg
      : isReceive
        ? c.txRowExtended.receiveIconBg
        : c.txRowExtended.sendIconBg;

  const iconColor = isPending
    ? colors.warning
    : isSelf
      ? colors.textTertiary
      : isReceive
        ? receiveColor
        : colors.textSecondary;

  // ─── Amount ─────────────────────────────────────────────

  const amountColor = isSelf
    ? colors.textTertiary
    : isReceive
      ? (isPending ? c.txRowExtended.pendingReceiveAmount : receiveColor)
      : colors.text;

  const amountPrefix = isReceive ? '+' : isSelf ? '' : '\u2212';

  const formatTxAmount = (sats: number) => {
    return formatUnitAmount(Math.abs(sats), denomination, true);
  };

  const formatTxSecondary = (sats: number) => {
    if (!price) return null;
    return PriceAPI.formatPrice((Math.abs(sats) / FORMATTING.SATS_PER_BTC) * price, currency);
  };

  const fiatValue = formatTxSecondary(tx.balanceDiff);

  // ─── Render ─────────────────────────────────────────────

  return (
    <Pressable
      style={styles.row}
      onPress={onPress ? () => onPress(tx) : undefined}
      onLongPress={onLongPress ? () => onLongPress(tx) : undefined}
      android_ripple={{ color: 'rgba(128,128,128,0.1)' }}
    >
      {/* Icon */}
      <View style={[styles.icon, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName} size={16} color={iconColor} />
      </View>

      {/* Middle: label + time */}
      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{label}</Text>
          {isPending && (
            <View style={[styles.pendingBadge, { backgroundColor: c.txRowExtended.pendingBadgeBg }]}>
              <Text style={[styles.pendingText, { color: colors.warning }]}>Pending</Text>
            </View>
          )}
        </View>
        <Text style={[styles.sub, { color: colors.textTertiary }]}>{txTime}</Text>
        {note ? (
          <Text style={[styles.note, { color: c.txRowExtended.noteText }]} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
        {tags && tags.length > 0 ? (
          <View style={styles.tagRow}>
            {tags.slice(0, 3).map((tag) => (
              <View key={tag} style={[styles.tagBadge, {
                backgroundColor: c.txRowExtended.tagBadgeBg,
              }]}>
                <Text style={[styles.tagText, { color: colors.textTertiary }]} numberOfLines={1}>{tag}</Text>
              </View>
            ))}
            {tags.length > 3 && (
              <Text style={[styles.tagMore, { color: c.txRowExtended.tagMoreText }]}>+{tags.length - 3}</Text>
            )}
          </View>
        ) : null}
      </View>

      {/* Trailing: amount + fiat */}
      <View style={styles.trailing}>
        {discreetMode ? (
          <Text style={[styles.amount, { color: colors.textTertiary }]}>••••</Text>
        ) : (
          <>
            <Text style={[styles.amount, { color: amountColor }]}>
              {amountPrefix}{formatTxAmount(tx.balanceDiff)}
            </Text>
            {fiatValue ? (
              <Text style={[styles.subRight, { color: colors.textTertiary }]}>{fiatValue}</Text>
            ) : null}
          </>
        )}
      </View>

      {/* Optional chevron */}
      {showChevron && (
        <Ionicons
          name="chevron-forward"
          size={14}
          color={c.txRowExtended.chevron}
          style={{ marginLeft: 4 }}
        />
      )}

      {/* Divider */}
      {showDivider && (
        <View style={[styles.divider, { backgroundColor: c.txRowExtended.divider }]} />
      )}
    </Pressable>
  );
});

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    position: 'relative',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  middle: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  pendingBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pendingText: {
    fontSize: 10,
    fontWeight: '600',
  },
  sub: {
    fontSize: 12,
  },
  note: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    fontStyle: 'italic',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  tagMore: {
    fontSize: 10,
    fontWeight: '500',
  },
  trailing: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  subRight: {
    fontSize: 12,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 64,
    right: 16,
    height: StyleSheet.hairlineWidth,
  },
});
