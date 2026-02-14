/**
 * StepReview — Premium transaction review screen.
 * 3-zone layout: scrollable summary card + options pill, sticky footer CTA.
 * Uses SlideToPayButton for amounts >= 100k sats, regular button otherwise.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { useHaptics } from '../../hooks/useHaptics';
import { getColors } from '../../constants';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { useWalletStore } from '../../stores/walletStore';
import { useSendStore } from '../../stores/sendStore';
import { useUTXOStore } from '../../stores/utxoStore';
import { SecureStorage } from '../../services/storage/SecureStorage';
import { SensitiveSession } from '../../services/auth/SensitiveSession';
import { formatUnitAmount } from '../../utils/formatting';
import { PriceAPI } from '../../services/api/PriceAPI';
import { AppButton } from '../ui/AppButton';
import { SlideToPayButton } from '../ui/SlideToPayButton';
import { PinCodeScreen } from '../security';
import { ReviewOptionsSheet } from './ReviewOptionsSheet';

const SLIDE_THRESHOLD_SATS = 100_000;

export function StepReview() {
  const { isDark, themeMode, colors } = useTheme();
  const c = getColors(themeMode);
  const haptics = useHaptics();
  const router = useRouter();
  const denomination = useSettingsStore(s => s.denomination);
  const currency = useSettingsStore(s => s.currency);
  const price = usePriceStore(s => s.price);

  const recipients = useSendStore(s => s.recipients);
  const feeRate = useSendStore(s => s.feeRate);
  const preparedFee = useSendStore(s => s.preparedFee);
  const selectedUtxos = useSendStore(s => s.selectedUtxos);
  const enableRBF = useSendStore(s => s.enableRBF);
  const memo = useSendStore(s => s.memo);
  const isSendMax = useSendStore(s => s.isSendMax);
  const walletCapability = useSendStore(s => s.walletCapability);
  const error = useSendStore(s => s.error);
  const errorLevel = useSendStore(s => s.errorLevel);
  const isBroadcasting = useSendStore(s => s.isBroadcasting);
  const preparedPsbtBase64 = useSendStore(s => s.preparedPsbtBase64);
  const signedRawHex = useSendStore(s => s.signedRawHex);

  const fetchFees = useSendStore(s => s.fetchFees);
  const prepareTx = useSendStore(s => s.prepareTx);
  const exportPSBT = useSendStore(s => s.exportPSBT);
  const detectWalletCapability = useSendStore(s => s.detectWalletCapability);
  const signOnly = useSendStore(s => s.signOnly);
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);

  const getUTXOs = useWalletStore(s => s.getUTXOs);

  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [sliderResetKey, setSliderResetKey] = useState(0);
  const [copiedHex, setCopiedHex] = useState(false);
  const [showSignPin, setShowSignPin] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [autoSignAttempted, setAutoSignAttempted] = useState(false);

  // ── Signed tx handlers ──────────────────────────────────────────

  const handleCopySignedHex = useCallback(async () => {
    if (!signedRawHex) return;
    await Clipboard.setStringAsync(signedRawHex);
    haptics.trigger('light');
    setCopiedHex(true);
    setTimeout(() => setCopiedHex(false), 2000);
  }, [signedRawHex, haptics]);

  const handleShareSignedHex = useCallback(async () => {
    if (!signedRawHex) return;
    haptics.trigger('light');
    try {
      await Share.share({ message: signedRawHex });
    } catch {
      // User cancelled
    }
  }, [signedRawHex, haptics]);

  // ── Inline PIN verification for sign flow ──────────────────────

  const handleSignPinVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const valid = await SecureStorage.verifyPin(pin);
    if (valid) {
      SensitiveSession.start(pin);
      return { success: true };
    }
    return { success: false, error: 'Incorrect PIN' };
  }, []);

  const handleSignPinSuccess = useCallback(async (pin: string) => {
    setShowSignPin(false);
    setIsSigning(true);
    try {
      await signOnly(pin);
      haptics.trigger('success');
    } catch (err: any) {
      useSendStore.setState({ error: err.message || 'Signing failed', errorLevel: 'error' });
    } finally {
      setIsSigning(false);
    }
  }, [signOnly, haptics]);

  const handleSignBiometricSuccess = useCallback(async (): Promise<{ success: boolean; pin?: string }> => {
    const pin = await SecureStorage.getPinForBiometrics();
    if (pin) {
      const valid = await SecureStorage.verifyPin(pin);
      if (valid) {
        SensitiveSession.start(pin);
        return { success: true, pin };
      }
    }
    return { success: false };
  }, []);

  // ── Effects ────────────────────────────────────────────────────

  // Fetch fees, detect capability, ensure UTXOs loaded on mount
  useEffect(() => {
    fetchFees();
    detectWalletCapability();
    getUTXOs();
    useUTXOStore.getState().initFromDb();
  }, []);

  // Re-prepare tx when fee, UTXOs, or RBF changes
  useEffect(() => {
    useSendStore.setState({ signedRawHex: null, signedTx: null });
    setAutoSignAttempted(false);
    const prepare = async () => {
      setIsPreparing(true);
      await prepareTx();
      setIsPreparing(false);
    };
    prepare();
  }, [feeRate, selectedUtxos, enableRBF]);

  // Auto-sign when PSBT is prepared (full_sign wallets only)
  useEffect(() => {
    if (!preparedPsbtBase64 || isPreparing || autoSignAttempted) return;
    if (walletCapability !== 'full_sign') return;
    if (signedRawHex) return;

    setAutoSignAttempted(true);

    const autoSign = async () => {
      const pin = await SensitiveSession.ensureAuth();
      if (pin) {
        setIsSigning(true);
        try {
          await signOnly(pin);
          haptics.trigger('success');
        } catch (err: any) {
          useSendStore.setState({ error: err.message || 'Signing failed', errorLevel: 'error' });
        } finally {
          setIsSigning(false);
        }
      } else {
        setShowSignPin(true);
      }
    };
    autoSign();
  }, [preparedPsbtBase64, isPreparing, autoSignAttempted, walletCapability, signedRawHex, signOnly, haptics]);

  // ── Derived values ─────────────────────────────────────────────

  const totalAmount = useMemo(() => {
    return recipients.reduce((sum, r) => sum + r.amountSats, 0);
  }, [recipients]);

  const totalWithFee = useMemo(() => {
    return totalAmount + (preparedFee || 0);
  }, [totalAmount, preparedFee]);

  const fiatTotal = useMemo(() => {
    if (!price || !totalWithFee) return null;
    return (totalWithFee / 100_000_000) * price;
  }, [totalWithFee, price]);

  const isLargeAmount = totalAmount >= SLIDE_THRESHOLD_SATS;
  const isButtonDisabled = isPreparing || isBroadcasting || errorLevel === 'error';

  const handleConfirm = useCallback(async () => {
    haptics.trigger('medium');
    try {
      if (walletCapability === 'watch_only') {
        await exportPSBT();
        router.push('/(auth)/send-psbt');
      } else {
        router.push('/(auth)/send-pin');
      }
    } catch (err: any) {
      useSendStore.setState({ error: err.message || 'An error occurred', errorLevel: 'error' });
      setSliderResetKey(prev => prev + 1);
    }
  }, [walletCapability, haptics, exportPSBT, router]);

  const confirmLabel = walletCapability === 'watch_only'
    ? 'Export PSBT'
    : walletCapability === 'multisig'
      ? 'Sign & Export'
      : 'Send Bitcoin';

  // ── Render ─────────────────────────────────────────────────────

  return (
    <Animated.View entering={FadeInDown.duration(300).springify()} style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Summary Card ──────────────────────────────── */}
        <View style={[
          styles.summaryCard,
          {
            backgroundColor: c.reviewCard.bg,
            borderColor: isDark ? 'transparent' : c.reviewCard.border,
            borderWidth: isDark ? 0 : StyleSheet.hairlineWidth,
          },
        ]}>
          {/* Recipients */}
          {recipients.filter(r => r.address).map((r, i) => (
            <View key={i}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.reviewCard.label }]}>
                  {recipients.length > 1 ? `To #${i + 1}` : 'To'}
                </Text>
                <View style={styles.valueColumn}>
                  <Text style={[styles.addressValue, { color: c.reviewCard.value }]} numberOfLines={1}>
                    {r.label || `${r.address.slice(0, 10)}...${r.address.slice(-6)}`}
                  </Text>
                  {r.amountSats > 0 && (
                    <Text style={[styles.amountValue, { color: c.reviewCard.value }]}>
                      {isSendMax ? 'MAX' : formatUnitAmount(r.amountSats, denomination)}
                    </Text>
                  )}
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />
            </View>
          ))}

          {/* Network Fee */}
          <View style={styles.row}>
            <Text style={[styles.label, { color: c.reviewCard.label }]}>Network Fee</Text>
            <Text style={[styles.feeValue, { color: c.reviewCard.value }]}>
              {isPreparing
                ? 'Calculating...'
                : preparedFee !== null
                  ? `${formatUnitAmount(preparedFee, denomination)} (${feeRate} sat/vB)`
                  : 'N/A'
              }
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />

          {/* Total */}
          <View style={styles.row}>
            <Text style={[styles.totalLabel, { color: c.reviewCard.totalValue }]}>Total</Text>
            <View style={styles.valueColumn}>
              <Text style={[styles.totalAmount, { color: c.reviewCard.totalValue }]}>
                {isSendMax ? 'Entire Balance' : formatUnitAmount(totalWithFee, denomination)}
              </Text>
              {fiatTotal !== null && (
                <Text style={[styles.fiatSubtext, { color: c.reviewCard.fiatSubtext }]}>
                  {'\u2248 '}{PriceAPI.formatPrice(fiatTotal, currency || 'USD')}
                </Text>
              )}
            </View>
          </View>

          {/* Memo */}
          {memo ? (
            <>
              <View style={[styles.divider, { backgroundColor: c.reviewCard.divider }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.reviewCard.label }]}>Memo</Text>
                <Text style={[styles.memoValue, { color: c.reviewCard.value }]} numberOfLines={2}>
                  {memo}
                </Text>
              </View>
            </>
          ) : null}

          {/* RBF badge */}
          {enableRBF && (
            <View style={[styles.rbfBadge, { backgroundColor: c.fill.tertiary }]}>
              <Text style={[styles.rbfBadgeText, { color: c.text.muted }]}>
                RBF Enabled
              </Text>
            </View>
          )}

          {/* Irreversibility warning */}
          {walletCapability !== 'watch_only' && (
            <View style={[styles.irreversibleWarning, { backgroundColor: isDark ? 'rgba(255,180,0,0.08)' : 'rgba(255,160,0,0.06)' }]}>
              <Ionicons name="warning-outline" size={14} color={isDark ? '#FFB400' : '#E6A000'} />
              <Text style={[styles.irreversibleText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)' }]}>
                Bitcoin transactions cannot be reversed once broadcast.
              </Text>
            </View>
          )}
        </View>

        {/* ── Options Pill ──────────────────────────────── */}
        <TouchableOpacity
          style={[styles.optionsPill, { backgroundColor: c.reviewCard.optionsPillBg }]}
          onPress={() => setShowOptionsSheet(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="options-outline" size={16} color={c.reviewCard.optionsPillText} />
          <Text style={[styles.optionsPillText, { color: c.reviewCard.optionsPillText }]}>
            Options
          </Text>
        </TouchableOpacity>

        {/* ── Signed Transaction ─────────────────────────── */}
        {signedRawHex && walletCapability === 'full_sign' && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.text.tertiary }]}>
              SIGNED TRANSACTION
            </Text>
            <Animated.View entering={FadeInUp.duration(250)}>
              <View style={[styles.txDataCard, {
                backgroundColor: c.reviewCard.bg,
                borderColor: isDark ? 'transparent' : c.reviewCard.border,
                borderWidth: isDark ? 0 : StyleSheet.hairlineWidth,
              }]}>
                <View style={styles.txDataHeader}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={c.text.muted} />
                  <Text style={[styles.txDataTitle, { color: c.text.secondary }]}>
                    Signed Raw Hex
                  </Text>
                </View>

                <Text
                  style={[styles.hexPreview, { color: c.text.muted }]}
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {signedRawHex}
                </Text>

                <View style={styles.txDataActions}>
                  <TouchableOpacity
                    style={[styles.txCapsuleBtn, { backgroundColor: c.fill.secondary }]}
                    onPress={handleCopySignedHex}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={copiedHex ? 'checkmark-circle' : 'copy-outline'}
                      size={14}
                      color={c.text.muted}
                    />
                    <Text style={[styles.txCapsuleText, { color: c.text.muted }]}>
                      {copiedHex ? 'Copied' : 'Copy'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.txCapsuleBtn, { backgroundColor: c.fill.secondary }]}
                    onPress={handleShareSignedHex}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="share-outline" size={14} color={c.text.muted} />
                    <Text style={[styles.txCapsuleText, { color: c.text.muted }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>
          </View>
        )}

        {/* ── Inline Error / Warning ────────────────────── */}
        {error && (
          <View style={[styles.errorBox, {
            backgroundColor: errorLevel === 'warning'
              ? 'rgba(255,159,10,0.12)'
              : c.semantic.errorMuted,
          }]}>
            <Ionicons
              name={errorLevel === 'warning' ? 'warning' : 'alert-circle'}
              size={16}
              color={errorLevel === 'warning' ? '#FF9F0A' : c.semantic.error}
            />
            <Text
              style={[styles.errorText, {
                color: errorLevel === 'warning' ? '#FF9F0A' : c.semantic.error,
              }]}
              numberOfLines={2}
            >
              {error}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky Footer CTA ────────────────────────────── */}
      <View style={styles.footer}>
        {isLargeAmount && walletCapability === 'full_sign' ? (
          <SlideToPayButton
            onConfirm={handleConfirm}
            label={confirmLabel}
            disabled={isButtonDisabled}
            loading={isBroadcasting}
            resetKey={sliderResetKey}
          />
        ) : (
          <AppButton
            title={confirmLabel}
            onPress={handleConfirm}
            variant="primary"
            disabled={isButtonDisabled}
            loading={isBroadcasting}
          />
        )}
      </View>

      {/* ── Options Sheet ─────────────────────────────────── */}
      <ReviewOptionsSheet
        visible={showOptionsSheet}
        onClose={() => setShowOptionsSheet(false)}
      />

      {/* ── PIN Modal (auto-sign flow — hidden, no visual feedback) ── */}
      <Modal visible={showSignPin} animationType="slide" presentationStyle="fullScreen">
        <PinCodeScreen
          mode="verify"
          title="Sign Transaction"
          subtitle="Enter your PIN to sign the transaction."
          icon="key-outline"
          onVerify={handleSignPinVerify}
          onSuccess={handleSignPinSuccess}
          onCancel={() => setShowSignPin(false)}
          biometricEnabled={biometricsEnabled}
          onBiometricSuccess={handleSignBiometricSuccess}
        />
      </Modal>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 100,
    gap: 20,
  },

  // ─── Summary Card ─────────────────────────────
  summaryCard: {
    borderRadius: 24,
    padding: 24,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    minWidth: 90,
  },
  valueColumn: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  addressValue: {
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  amountValue: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  feeValue: {
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fiatSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
  memoValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  rbfBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  rbfBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  irreversibleWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  irreversibleText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },

  // ─── Options Pill ─────────────────────────────
  optionsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  optionsPillText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ─── Section ──────────────────────────────────
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },

  // ─── Signed Transaction ───────────────────────
  txDataCard: {
    padding: 16,
    borderRadius: 14,
    gap: 12,
  },
  txDataHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  txDataTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  txDataActions: {
    flexDirection: 'row',
    gap: 8,
  },
  txCapsuleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  txCapsuleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  hexPreview: {
    fontSize: 11,
    lineHeight: 16,
  },

  // ─── Error / Warning ──────────────────────────
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },

  // ─── Footer ───────────────────────────────────
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 30,
  },

});
