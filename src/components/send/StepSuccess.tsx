/**
 * StepSuccess — Transaction sent confirmation with details.
 *
 * 4-zone layout:
 *  1. Compact header (checkmark + title + status pill)
 *  2. Summary card (amount + fiat + recipient preview)
 *  3. Details section (recipients + tx details)
 *  4. Sticky bottom actions (Done + View Transaction)
 */

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { getColors } from '../../constants';
import { formatUnitAmount } from '../../utils/formatting';
import { PriceAPI } from '../../services/api/PriceAPI';
import { AppButton } from '../ui/AppButton';

export interface SuccessTxData {
  txid: string;
  recipients: { address: string; amountSats: number; label?: string }[];
  fee: number;
  feeRate: number;
  enableRBF: boolean;
  memo: string;
  totalSats: number;
}

interface StepSuccessProps {
  txData: SuccessTxData;
  onDone: () => void;
}

export function StepSuccess({ txData, onDone }: StepSuccessProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const insets = useSafeAreaInsets();
  const denomination = useSettingsStore((s) => s.denomination);
  const price = usePriceStore((s) => s.price);
  const currency = usePriceStore((s) => s.currency);

  const [copiedTxid, setCopiedTxid] = useState(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleCopyTxid = useCallback(async () => {
    if (!txData.txid) return;
    await Clipboard.setStringAsync(txData.txid);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopiedTxid(true);
    setTimeout(() => setCopiedTxid(false), 2000);
  }, [txData.txid]);

  const recipientTotal = useMemo(
    () => txData.recipients.reduce((sum, r) => sum + r.amountSats, 0),
    [txData.recipients],
  );

  const fiatAmount = useMemo(() => {
    if (!price || !recipientTotal) return null;
    return (recipientTotal / 100_000_000) * price;
  }, [price, recipientTotal]);

  const fiatTotal = useMemo(() => {
    if (!price || !txData.totalSats) return null;
    return (txData.totalSats / 100_000_000) * price;
  }, [price, txData.totalSats]);

  const truncatedTxid = txData.txid
    ? `${txData.txid.slice(0, 10)}...${txData.txid.slice(-6)}`
    : '';

  const truncateAddress = (addr: string) =>
    addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

  const isMultiRecipient = txData.recipients.length > 1;

  const cardBorder = isDark
    ? undefined
    : { borderWidth: StyleSheet.hairlineWidth, borderColor: c.card.border };

  return (
    <Animated.View entering={FadeIn.duration(400)} style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Zone 1: Compact Header ──────────────────────── */}
        <View style={styles.header}>
          <Animated.View entering={ZoomIn.delay(200).springify()}>
            <View style={[styles.checkCircle, { backgroundColor: c.successScreen.headerBg }]}>
              <Ionicons name="checkmark" size={24} color={c.successScreen.headerIcon} />
            </View>
          </Animated.View>

          <Animated.Text
            entering={FadeInUp.delay(400).duration(300)}
            style={[styles.title, { color: c.text.primary }]}
          >
            Transaction Sent
          </Animated.Text>

          <Animated.View
            entering={FadeInUp.delay(500).duration(300)}
            style={[styles.statusPill, { backgroundColor: c.successScreen.statusPillBg }]}
          >
            <View style={[styles.statusDot, { backgroundColor: c.successScreen.statusPillText }]} />
            <Text style={[styles.statusText, { color: c.successScreen.statusPillText }]}>
              Broadcasted
            </Text>
          </Animated.View>
        </View>

        {/* ── Zone 2: Summary Card ────────────────────────── */}
        <Animated.View
          entering={FadeInUp.delay(550).duration(300)}
          style={[styles.card, { backgroundColor: c.card.bg }, cardBorder]}
        >
          {/* Amount */}
          <View style={styles.summaryAmount}>
            <Text style={[styles.amountText, { color: c.text.primary }]}>
              {formatUnitAmount(recipientTotal, denomination)}
            </Text>
            {fiatAmount !== null && (
              <Text style={[styles.fiatText, { color: c.text.muted }]}>
                {'\u2248 '}{PriceAPI.formatPrice(fiatAmount, currency || 'USD')}
              </Text>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />

          {/* Recipient preview */}
          <View style={styles.recipientPreview}>
            <Text style={[styles.recipientLabel, { color: c.text.tertiary }]}>To</Text>
            <Text style={[styles.recipientValue, { color: c.text.primary }]} numberOfLines={1}>
              {isMultiRecipient
                ? `${txData.recipients.length} recipients`
                : txData.recipients[0]?.label || truncateAddress(txData.recipients[0]?.address ?? '')}
            </Text>
          </View>
        </Animated.View>

        {/* ── Zone 3: Details ─────────────────────────────── */}

        {/* Recipients card (multi-recipient only) */}
        {isMultiRecipient && (
          <Animated.View entering={FadeInUp.delay(600).duration(300)}>
            <Text style={[styles.sectionLabel, { color: c.sectionLabel.text }]}>RECIPIENTS</Text>
            <View style={[styles.card, { backgroundColor: c.card.bg }, cardBorder]}>
              {txData.recipients.map((r, i) => (
                <View key={`${r.address}-${i}`}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />}
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: c.text.tertiary }]} numberOfLines={1}>
                      {r.label || truncateAddress(r.address)}
                    </Text>
                    <Text style={[styles.detailValue, { color: c.text.primary }]}>
                      {formatUnitAmount(r.amountSats, denomination)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Transaction Details card */}
        <Animated.View entering={FadeInUp.delay(isMultiRecipient ? 650 : 600).duration(300)}>
          <Text style={[styles.sectionLabel, { color: c.sectionLabel.text }]}>TRANSACTION DETAILS</Text>
          <View style={[styles.card, { backgroundColor: c.card.bg }, cardBorder]}>
            {/* Network Fee */}
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>Network Fee</Text>
              <Text style={[styles.detailValue, { color: c.text.primary }]}>
                {formatUnitAmount(txData.fee, denomination)} ({txData.feeRate} sat/vB)
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />

            {/* Total */}
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>Total</Text>
              <View style={styles.detailValueColumn}>
                <Text style={[styles.totalValue, { color: c.text.primary }]}>
                  {formatUnitAmount(txData.totalSats, denomination)}
                </Text>
                {fiatTotal !== null && (
                  <Text style={[styles.fiatSmall, { color: c.text.muted }]}>
                    {'\u2248 '}{PriceAPI.formatPrice(fiatTotal, currency || 'USD')}
                  </Text>
                )}
              </View>
            </View>

            {/* RBF */}
            {txData.enableRBF && (
              <>
                <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>RBF</Text>
                  <Text style={[styles.detailValue, { color: c.text.primary }]}>Enabled</Text>
                </View>
              </>
            )}

            {/* Memo */}
            {txData.memo ? (
              <>
                <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>Memo</Text>
                  <Text
                    style={[styles.detailValue, { color: c.text.primary, fontStyle: 'italic' }]}
                    numberOfLines={1}
                  >
                    {txData.memo}
                  </Text>
                </View>
              </>
            ) : null}

            <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />

            {/* Transaction ID */}
            <TouchableOpacity style={styles.detailRow} onPress={handleCopyTxid} activeOpacity={0.7}>
              <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>
                {copiedTxid ? 'Copied!' : 'Transaction ID'}
              </Text>
              <View style={styles.txidRow}>
                <Text style={[styles.txidText, { color: c.text.primary }]}>{truncatedTxid}</Text>
                <Ionicons
                  name={copiedTxid ? 'checkmark' : 'copy-outline'}
                  size={14}
                  color={copiedTxid ? c.successScreen.headerIcon : c.text.muted}
                />
              </View>
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />

            {/* Status */}
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: c.text.tertiary }]}>Status</Text>
              <Text style={[styles.detailValue, { color: c.successScreen.statusPillText }]}>
                Broadcasted
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* ── Zone 4: Sticky Footer ─────────────────────────── */}
      <Animated.View
        entering={FadeInUp.delay(700).duration(300)}
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <AppButton title="Done" onPress={onDone} variant="primary" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },

  // ── Zone 1: Header ──────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 24,
    gap: 8,
  },
  checkCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Zone 2: Summary Card ────────────────────────────
  card: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  summaryAmount: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  amountText: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  fiatText: {
    fontSize: 14,
    fontWeight: '400',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  recipientPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recipientLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  recipientValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },

  // ── Zone 3: Details ─────────────────────────────────
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 22,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    marginLeft: 12,
  },
  detailValueColumn: {
    alignItems: 'flex-end',
    gap: 2,
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fiatSmall: {
    fontSize: 12,
  },
  txidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  txidText: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },

  // ── Zone 4: Footer ──────────────────────────────────
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 10,
  },
});
