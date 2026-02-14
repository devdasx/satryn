/**
 * RequestFromContactSheet
 * Generate a payment request link to share with a contact.
 * Amount input supports any Bitcoin denomination and fiat (matching receive screen design).
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCodeSVG from 'react-native-qrcode-svg';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import { useWalletStore } from '../../stores/walletStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { PriceAPI } from '../../services/api/PriceAPI';
import { shareQRAsPNG } from '../../utils/qrExport';

/** Inline payment link encoder (base64url JSON) */
function encodePaymentLink(payload: PaymentLinkPayload): string {
  const json = JSON.stringify(payload);
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(json, 'utf-8').toString('base64');
  } else {
    b64 = btoa(unescape(encodeURIComponent(json)));
  }
  const encoded = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `satryn://pay?data=${encoded}`;
}
import { getUnitSymbol, unitToSats, formatUnitAmount } from '../../utils/formatting';
import type { Contact, PaymentLinkPayload } from '../../types/contacts';
import type { BitcoinUnit } from '../../types';

type InputUnit = BitcoinUnit | 'fiat';

export interface RequestFromContactSheetProps {
  visible: boolean;
  onClose: () => void;
  contact: Contact | null;
}

export function RequestFromContactSheet({
  visible,
  onClose,
  contact,
}: RequestFromContactSheetProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const walletAddresses = useWalletStore(s => s.addresses);
  const currency = useSettingsStore(s => s.currency);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore((s) => s.price);

  const [amountInput, setAmountInput] = useState('');
  const [inputUnit, setInputUnit] = useState<InputUnit>(denomination);
  const [memo, setMemo] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [bitcoinUri, setBitcoinUri] = useState<string | null>(null);
  const qrRef = useRef<any>(null);

  if (!contact) return null;

  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // Calculate amount in satoshis based on input unit
  const amountInSats = useMemo(() => {
    if (!amountInput || amountInput === '0') return 0;
    const numValue = parseFloat(amountInput);
    if (isNaN(numValue)) return 0;

    if (inputUnit === 'fiat') {
      if (!price) return 0;
      return Math.round((numValue / price) * 100_000_000);
    }
    return unitToSats(numValue, inputUnit);
  }, [amountInput, inputUnit, price]);

  // Fiat equivalent for preview
  const fiatValue = useMemo(() => {
    if (!amountInSats || !price) return null;
    return (amountInSats / 100_000_000) * price;
  }, [amountInSats, price]);

  const cycleInputUnit = useCallback(() => {
    haptics.trigger('light');
    setInputUnit((prev) => (prev === denomination ? 'fiat' : denomination));
    setAmountInput('');
  }, [denomination, haptics]);

  const getUnitLabel = (): string => {
    if (inputUnit === 'fiat') return currency || 'USD';
    return getUnitSymbol(inputUnit);
  };

  const getAmountPreview = (): string => {
    if (amountInSats <= 0) return '';
    const parts: string[] = [];
    parts.push(formatUnitAmount(amountInSats, denomination));
    if (fiatValue) {
      parts.push(PriceAPI.formatPrice(fiatValue, currency || 'USD'));
    }
    return `= ${parts.join(' ≈ ')}`;
  };

  const handleGenerate = () => {
    const receiveAddr = walletAddresses?.[0];
    const address = typeof receiveAddr === 'string'
      ? receiveAddr
      : receiveAddr?.address || '';

    if (!address) {
      Alert.alert('Error', 'No receiving address available');
      return;
    }

    const payload: PaymentLinkPayload = {
      v: 1,
      action: 'send',
      recipients: [
        {
          address,
          amountSats: amountInSats > 0 ? amountInSats : undefined,
        },
      ],
      memo: memo.trim() || undefined,
      createdAt: Date.now(),
      contactName: 'Me',
    };

    const link = encodePaymentLink(payload);
    setGeneratedLink(link);

    // Build standard BIP21 bitcoin: URI for the QR code (universally scannable)
    let uri = `bitcoin:${address}`;
    const params: string[] = [];
    if (amountInSats > 0) {
      params.push(`amount=${(amountInSats / 100_000_000).toFixed(8)}`);
    }
    if (memo.trim()) {
      params.push(`message=${encodeURIComponent(memo.trim())}`);
    }
    if (params.length > 0) uri += `?${params.join('&')}`;
    setBitcoinUri(uri);

    haptics.trigger('success');
  };

  const handleShareLink = async () => {
    if (!generatedLink) return;
    try {
      await Share.share({
        message: memo.trim()
          ? `${memo.trim()}\n\n${generatedLink}`
          : generatedLink,
        ...(Platform.OS === 'ios' ? { url: generatedLink } : {}),
      });
    } catch {
      // User cancelled share
    }
  };

  const handleShareQR = async () => {
    if (!qrRef.current) return;
    haptics.trigger('light');
    try {
      await shareQRAsPNG(qrRef.current, generatedLink || undefined, 'payment-request');
    } catch {
      Alert.alert('Error', 'Failed to share QR');
    }
  };

  const handleClose = () => {
    setAmountInput('');
    setInputUnit(denomination);
    setMemo('');
    setGeneratedLink(null);
    setBitcoinUri(null);
    qrRef.current = null;
    onClose();
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={handleClose}
      title={`Request from ${contact.name}`}
      sizing="auto"
    >
      <View style={styles.content}>
        {!generatedLink ? (
          <>
            {/* Amount with unit cycling using PremiumInput */}
            <PremiumInputCard label="AMOUNT — OPTIONAL">
              <PremiumInput
                icon="cash-outline"
                iconColor="#30D158"
                placeholder="0"
                value={amountInput}
                onChangeText={(text) => setAmountInput(text.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                centered
                rightElement={
                  <TouchableOpacity
                    style={[styles.unitPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={cycleInputUnit}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.unitPillText, { color: colors.text }]}>{getUnitLabel()}</Text>
                    <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                  </TouchableOpacity>
                }
              />
            </PremiumInputCard>

            {/* Amount preview */}
            {amountInSats > 0 && (
              <Text style={[styles.amountPreview, { color: colors.textMuted }]}>
                {getAmountPreview()}
              </Text>
            )}

            {/* Memo using PremiumInput */}
            <PremiumInputCard label="MEMO — OPTIONAL" style={{ marginTop: 16 }}>
              <PremiumInput
                icon="create-outline"
                iconColor="#007AFF"
                placeholder="What's this for?"
                value={memo}
                onChangeText={setMemo}
                showClear
              />
            </PremiumInputCard>

            {/* Generate */}
            <TouchableOpacity
              style={[
                styles.generateButton,
                { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' },
              ]}
              onPress={handleGenerate}
            >
              <Text
                style={[
                  styles.generateText,
                  { color: isDark ? '#000000' : '#FFFFFF' },
                ]}
              >
                Generate Link
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* QR Code — uses standard bitcoin: URI so any scanner can read it */}
            <View style={styles.qrContainer}>
              <View style={styles.qrWrapper}>
                <QRCodeSVG
                  value={bitcoinUri || generatedLink!}
                  size={180}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  ecl="H"
                  quietZone={0}
                  getRef={(ref: any) => { qrRef.current = ref; }}
                  logo={require('../../../appIcon.png')}
                  logoSize={32}
                  logoBackgroundColor="#FFFFFF"
                  logoMargin={3}
                  logoBorderRadius={6}
                />
              </View>
            </View>

            {/* Amount & memo badges */}
            {(amountInSats > 0 || memo.trim()) && (
              <View style={styles.badgesRow}>
                {amountInSats > 0 && (
                  <View style={[styles.infoBadge, { backgroundColor: inputBg }]}>
                    <Ionicons name="wallet-outline" size={12} color={colors.textMuted} />
                    <Text style={[styles.infoBadgeText, { color: colors.text }]}>
                      {formatUnitAmount(amountInSats, denomination)}
                    </Text>
                    {fiatValue && (
                      <Text style={[styles.infoBadgeSub, { color: colors.textMuted }]}>
                        ≈ {PriceAPI.formatPrice(fiatValue, currency || 'USD')}
                      </Text>
                    )}
                  </View>
                )}
                {memo.trim() ? (
                  <View style={[styles.infoBadge, { backgroundColor: inputBg }]}>
                    <Ionicons name="chatbubble-outline" size={12} color={colors.textMuted} />
                    <Text style={[styles.infoBadgeText, { color: colors.text }]} numberOfLines={1}>
                      {memo.trim()}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Share as QR image */}
            <TouchableOpacity
              style={[
                styles.generateButton,
                { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' },
              ]}
              onPress={handleShareQR}
            >
              <Ionicons
                name="image-outline"
                size={18}
                color={isDark ? '#000000' : '#FFFFFF'}
              />
              <Text
                style={[
                  styles.generateText,
                  { color: isDark ? '#000000' : '#FFFFFF' },
                ]}
              >
                Share QR Code
              </Text>
            </TouchableOpacity>

            {/* Share as link */}
            <TouchableOpacity
              style={[styles.secondaryShareBtn, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}
              onPress={handleShareLink}
            >
              <Ionicons name="link-outline" size={16} color={colors.text} />
              <Text style={[styles.secondaryShareText, { color: colors.text }]}>
                Share as Link
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.newLinkButton}
              onPress={() => { setGeneratedLink(null); setBitcoinUri(null); qrRef.current = null; }}
            >
              <Text style={[styles.newLinkText, { color: colors.textSecondary }]}>
                Generate new request
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  unitPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  amountPreview: {
    fontSize: 13,
    marginTop: -6,
    marginBottom: 6,
    textAlign: 'center',
  },
  generateButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  generateText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // QR display
  qrContainer: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Badges
  badgesRow: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  infoBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  infoBadgeSub: {
    fontSize: 12,
  },
  // Secondary share
  secondaryShareBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  secondaryShareText: {
    fontSize: 15,
    fontWeight: '600',
  },
  newLinkButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  newLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
