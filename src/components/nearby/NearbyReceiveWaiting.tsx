/**
 * NearbyReceiveWaiting — Waits for the sender's transaction
 *
 * After the receiver's payment request has been delivered to the sender,
 * this component polls the receiver's address via Electrum to detect
 * incoming payments. Handles exact, underpaid, and overpaid scenarios.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics } from '../../hooks';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import { useNearby } from './NearbyProvider';
import { deriveConfirmationCode } from '../../services/nearby/NearbyPayloadCodec';
import { formatNearbyAmount } from '../../services/nearby/formatNearbyAmount';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import { ElectrumAPI } from '../../services/electrum/ElectrumAPI';
import { AppButton } from '../ui/AppButton';
import { AppBottomSheet } from '../ui/AppBottomSheet';

type InternalState = 'pending_acceptance' | 'waiting' | 'underpaid' | 'overpaid' | 'success';

const POLL_INTERVAL = 5000; // 5 seconds
const POLL_TIMEOUT = 300000; // 5 minutes

export function NearbyReceiveWaiting() {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const denomination = useSettingsStore((s) => s.denomination);
  const { cancel } = useNearby();
  const payload = useNearbySessionStore((s) => s.payload);
  const peerName = useNearbySessionStore((s) => s.peerName);
  const sessionState = useNearbySessionStore((s) => s.state);
  const receivedAmountSats = useNearbySessionStore((s) => s.receivedAmountSats);
  const receivedTxid = useNearbySessionStore((s) => s.receivedTxid);

  // Internal state starts as pending_acceptance if session is in that state,
  // otherwise starts as waiting (already accepted / completed)
  const [internalState, setInternalState] = useState<InternalState>(
    sessionState === 'pending_acceptance' ? 'pending_acceptance' : 'waiting',
  );

  // When session state transitions from pending_acceptance → completed (sender accepted),
  // move internal state from pending_acceptance → waiting to start polling
  useEffect(() => {
    if (sessionState === 'completed' && internalState === 'pending_acceptance') {
      haptics.trigger('success');
      setInternalState('waiting');
    }
  }, [sessionState, internalState]);
  const [showUnderpaidSheet, setShowUnderpaidSheet] = useState(false);
  const [showOverpaidSheet, setShowOverpaidSheet] = useState(false);
  const [askSenderMessage, setAskSenderMessage] = useState<string | null>(null);

  // ─── Waiting pulse animation ─────────────────────────────────
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (internalState !== 'waiting' && internalState !== 'pending_acceptance') return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [internalState]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // ─── Success checkmark animation ────────────────────────────
  const checkScale = useSharedValue(0);

  useEffect(() => {
    if (internalState === 'success') {
      checkScale.value = withDelay(
        200,
        withSpring(1, { damping: 12, stiffness: 180 }),
      );
      haptics.trigger('success');
    }
  }, [internalState]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  // ─── Polling logic ──────────────────────────────────────────
  useEffect(() => {
    if (!payload?.address || internalState !== 'waiting') return;

    const api = ElectrumAPI.shared(payload.network === 'testnet' ? 'testnet' : 'mainnet');
    const store = useNearbySessionStore;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        // Clear cache so we get fresh data each poll
        api.clearCache();

        const utxos = await api.getUTXOs(payload.address);
        const totalReceived = utxos.reduce((sum, u) => sum + u.value, 0);

        if (totalReceived > 0 && !cancelled) {
          // Get txid from the most recent UTXO
          const latestUtxo = utxos[utxos.length - 1];
          store.getState().setReceivedPayment(totalReceived, latestUtxo.txid);

          // Determine match result
          if (!payload.amountSats || totalReceived === payload.amountSats) {
            setInternalState('success');
          } else if (totalReceived < payload.amountSats) {
            setInternalState('underpaid');
            setShowUnderpaidSheet(true);
          } else {
            setInternalState('overpaid');
            setShowOverpaidSheet(true);
          }
        }
      } catch {
        // Silently retry on next interval
      }
    };

    // Initial check immediately
    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, POLL_TIMEOUT);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [payload?.address, internalState]);

  // ─── Actions ─────────────────────────────────────────────────
  const handleAcceptAmount = useCallback(async () => {
    setShowUnderpaidSheet(false);
    setShowOverpaidSheet(false);
    await haptics.trigger('success');
    setInternalState('success');
  }, [haptics]);

  const handleAskSender = useCallback(async () => {
    if (!payload?.amountSats || !receivedAmountSats) return;
    const remaining = payload.amountSats - receivedAmountSats;
    setShowUnderpaidSheet(false);
    setAskSenderMessage(
      `Please ask the sender to send ${formatUnitAmount(remaining, denomination)} to complete the payment.`,
    );
    await haptics.trigger('medium');
    // Go back to waiting and resume polling
    setInternalState('waiting');
  }, [payload?.amountSats, receivedAmountSats, haptics]);

  const handleDone = useCallback(() => {
    cancel();
  }, [cancel]);

  const handleCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  if (!payload) return null;

  const requested = payload.amountSats;
  const received = receivedAmountSats;

  // ─── Success view ───────────────────────────────────────────
  if (internalState === 'success') {
    return (
      <View style={styles.container}>
        <View style={styles.centerSection}>
          <Animated.View style={[styles.successIconOuter, checkStyle]}>
            <LinearGradient
              colors={isDark
                ? ['rgba(48, 209, 88, 0.2)', 'rgba(48, 209, 88, 0.02)']
                : ['rgba(52, 199, 89, 0.15)', 'rgba(52, 199, 89, 0.02)']}
              style={styles.iconGlow}
            />
            <View style={[styles.successIcon, {
              backgroundColor: isDark ? 'rgba(48, 209, 88, 0.15)' : 'rgba(52, 199, 89, 0.12)',
              ...Platform.select({
                ios: {
                  shadowColor: '#30D158',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.3,
                  shadowRadius: 16,
                },
              }),
            }]}>
              <Ionicons name="checkmark" size={36} color={colors.success} />
            </View>
          </Animated.View>

          <Animated.Text
            entering={FadeInDown.delay(300).duration(400)}
            style={[styles.title, { color: colors.textPrimary }]}
          >
            Payment Received!
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).duration(400)}
            style={[styles.subtitle, { color: colors.textSecondary }]}
          >
            {received
              ? `${formatUnitAmount(received, denomination)} received`
              : 'Transaction detected'}
          </Animated.Text>

          {/* Txid card */}
          {receivedTxid && (
            <Animated.View
              entering={FadeInDown.delay(500).duration(400)}
              style={{ width: '100%', marginTop: 20 }}
            >
              <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
                <View style={styles.txidRow}>
                  <Text style={[styles.txidLabel, { color: colors.textTertiary }]}>
                    Transaction
                  </Text>
                  <Text
                    style={[styles.txidValue, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {receivedTxid.slice(0, 12)}...{receivedTxid.slice(-6)}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}
        </View>

        <View style={styles.bottomBar}>
          <Animated.View entering={FadeInDown.delay(600).duration(400)}>
            <AppButton
              title="Done"
              onPress={handleDone}
              variant="primary"
              icon="checkmark-circle"
              haptic="medium"
            />
          </Animated.View>
        </View>
      </View>
    );
  }

  // ─── Pending acceptance view ────────────────────────────────
  if (internalState === 'pending_acceptance') {
    return (
      <View style={styles.container}>
        <View style={styles.centerSection}>
          {/* Animated waiting icon */}
          <Animated.View
            entering={FadeIn.duration(400)}
            style={[styles.waitingIconOuter, pulseStyle]}
          >
            <LinearGradient
              colors={isDark
                ? ['rgba(10, 132, 255, 0.12)', 'rgba(10, 132, 255, 0.02)']
                : ['rgba(0, 122, 255, 0.12)', 'rgba(0, 122, 255, 0.02)']}
              style={styles.iconGlow}
            />
            <View style={[styles.waitingIcon, {
              backgroundColor: isDark
                ? 'rgba(10, 132, 255, 0.12)'
                : 'rgba(0, 122, 255, 0.1)',
            }]}>
              <Ionicons name="time-outline" size={28} color={isDark ? '#0A84FF' : '#007AFF'} />
            </View>
          </Animated.View>

          <Animated.Text
            entering={FadeInDown.delay(100).duration(400)}
            style={[styles.title, { color: colors.textPrimary }]}
          >
            Waiting for Confirmation
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(200).duration(400)}
            style={[styles.subtitle, { color: colors.textSecondary }]}
          >
            The sender is reviewing your{'\n'}payment request...
          </Animated.Text>

          {/* Confirmation code display — individual digit boxes */}
          <Animated.View
            entering={FadeInDown.delay(300).duration(400)}
            style={{ width: '100%', marginBottom: 16 }}
          >
            <View style={styles.codeDisplayContainer}>
              <View style={styles.codeDisplayHeader}>
                <View style={[styles.codeDisplayIcon, {
                  backgroundColor: isDark ? 'rgba(10, 132, 255, 0.12)' : 'rgba(0, 122, 255, 0.08)',
                }]}>
                  <Ionicons name="shield-checkmark" size={16} color={isDark ? '#0A84FF' : '#007AFF'} />
                </View>
                <Text style={[styles.codeDisplayLabel, { color: colors.textTertiary }]}>
                  CONFIRMATION CODE
                </Text>
              </View>
              <View style={styles.codeDigitsRow}>
                {(payload ? deriveConfirmationCode(payload.requestId) : '000000').split('').map((digit, i) => (
                  <Animated.View
                    key={i}
                    entering={FadeInDown.delay(350 + i * 60).duration(300)}
                    style={[styles.codeDigitBox, {
                      backgroundColor: isDark ? 'rgba(10, 132, 255, 0.08)' : 'rgba(0, 122, 255, 0.06)',
                      borderColor: isDark ? 'rgba(10, 132, 255, 0.2)' : 'rgba(0, 122, 255, 0.15)',
                    }]}
                  >
                    <Text style={[styles.codeDigitText, {
                      color: isDark ? '#0A84FF' : '#007AFF',
                    }]}>
                      {digit}
                    </Text>
                  </Animated.View>
                ))}
              </View>
              <View style={styles.codeDisplayHintRow}>
                <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.textTertiary} />
                <Text style={[styles.codeDisplayHint, { color: colors.textTertiary }]}>
                  Share this code with the sender to confirm
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Payment details card */}
          <Animated.View
            entering={FadeInDown.delay(400).duration(400)}
            style={{ width: '100%' }}
          >
            <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
              <View style={styles.detailsContent}>
                {/* Peer name */}
                {peerName ? (
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                      Sender
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                      {peerName}
                    </Text>
                  </View>
                ) : null}

                {/* Requested amount */}
                {requested != null && (
                  <>
                    {peerName && (
                      <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
                    )}
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                        Requested
                      </Text>
                      <Text style={[styles.detailAmount, { color: colors.textPrimary }]}>
                        {formatNearbyAmount(payload)}
                      </Text>
                    </View>
                  </>
                )}

                {/* Address */}
                <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                    Address
                  </Text>
                  <Text
                    style={[styles.detailAddress, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {payload.address.slice(0, 10)}...{payload.address.slice(-6)}
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>
        </View>

        <View style={styles.bottomBar}>
          <Animated.View entering={FadeInDown.delay(500).duration(400)}>
            <AppButton
              title="Cancel"
              onPress={handleCancel}
              variant="secondary"
              icon="close"
              haptic="light"
            />
          </Animated.View>
        </View>
      </View>
    );
  }

  // ─── Waiting view ───────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.centerSection}>
        {/* Animated waiting icon */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={[styles.waitingIconOuter, pulseStyle]}
        >
          <LinearGradient
            colors={isDark
              ? ['rgba(255, 214, 10, 0.12)', 'rgba(255, 214, 10, 0.02)']
              : ['rgba(255, 149, 0, 0.12)', 'rgba(255, 149, 0, 0.02)']}
            style={styles.iconGlow}
          />
          <View style={[styles.waitingIcon, {
            backgroundColor: isDark
              ? 'rgba(255, 214, 10, 0.12)'
              : 'rgba(255, 149, 0, 0.1)',
          }]}>
            <Ionicons name="hourglass-outline" size={28} color={colors.warning} />
          </View>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(100).duration(400)}
          style={[styles.title, { color: colors.textPrimary }]}
        >
          Waiting for Payment
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(200).duration(400)}
          style={[styles.subtitle, { color: colors.textSecondary }]}
        >
          The sender has your payment request.{'\n'}Waiting for the transaction to appear...
        </Animated.Text>

        {/* Ask sender message (after underpaid → "Ask Sender") */}
        {askSenderMessage && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{ width: '100%', marginBottom: 16 }}
          >
            <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
              <View style={styles.messageRow}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.warning} />
                <Text style={[styles.messageText, { color: colors.textPrimary }]}>
                  {askSenderMessage}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Payment details card */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(400)}
          style={{ width: '100%' }}
        >
          <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
            <View style={styles.detailsContent}>
              {/* Peer name */}
              {peerName ? (
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                    Sender
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                    {peerName}
                  </Text>
                </View>
              ) : null}

              {/* Requested amount */}
              {requested != null && (
                <>
                  {peerName && (
                    <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
                  )}
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                      Requested
                    </Text>
                    <Text style={[styles.detailAmount, { color: colors.textPrimary }]}>
                      {formatNearbyAmount(payload)}
                    </Text>
                  </View>
                </>
              )}

              {/* Address */}
              <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>
                  Address
                </Text>
                <Text
                  style={[styles.detailAddress, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {payload.address.slice(0, 10)}...{payload.address.slice(-6)}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Tip card */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(400)}
          style={{ width: '100%', marginTop: 12 }}
        >
          <View style={[styles.infoCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
            <View style={styles.tipRow}>
              <Ionicons name="information-circle" size={16} color={colors.textTertiary} />
              <Text style={[styles.tipText, { color: colors.textTertiary }]}>
                Checking for incoming transactions every few seconds.
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>

      <View style={styles.bottomBar}>
        <Animated.View entering={FadeInDown.delay(500).duration(400)}>
          <AppButton
            title="Cancel"
            onPress={handleCancel}
            variant="secondary"
            icon="close"
            haptic="light"
          />
        </Animated.View>
      </View>

      {/* ─── Underpaid bottom sheet ──────────────────────────────── */}
      <AppBottomSheet
        visible={showUnderpaidSheet}
        onClose={() => setShowUnderpaidSheet(false)}
        title="Payment Amount Mismatch"
        sizing="auto"
        dismissible={false}
        footer={
          <View style={styles.sheetFooter}>
            <AppButton
              title={`Accept ${formatUnitAmount(received ?? 0, denomination)}`}
              onPress={handleAcceptAmount}
              variant="primary"
              icon="checkmark"
              haptic="medium"
            />
            <View style={{ height: 10 }} />
            <AppButton
              title="Ask Sender for Remaining"
              onPress={handleAskSender}
              variant="secondary"
              icon="chatbubble-outline"
              haptic="light"
            />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <View style={[styles.comparisonCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
            <View style={styles.comparisonContent}>
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Requested
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.textPrimary }]}>
                  {formatUnitAmount(requested ?? 0, denomination)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Received
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.warning }]}>
                  {formatUnitAmount(received ?? 0, denomination)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Remaining
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.error }]}>
                  {formatUnitAmount((requested ?? 0) - (received ?? 0), denomination)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </AppBottomSheet>

      {/* ─── Overpaid bottom sheet ───────────────────────────────── */}
      <AppBottomSheet
        visible={showOverpaidSheet}
        onClose={() => setShowOverpaidSheet(false)}
        title="Extra Payment Received"
        sizing="auto"
        dismissible={false}
        footer={
          <View style={styles.sheetFooter}>
            <AppButton
              title="Accept Payment"
              onPress={handleAcceptAmount}
              variant="primary"
              icon="checkmark"
              haptic="medium"
            />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <View style={[styles.comparisonCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
            <View style={styles.comparisonContent}>
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Requested
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.textPrimary }]}>
                  {formatUnitAmount(requested ?? 0, denomination)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Received
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.success }]}>
                  {formatUnitAmount(received ?? 0, denomination)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
              <View style={styles.comparisonRow}>
                <Text style={[styles.comparisonLabel, { color: colors.textTertiary }]}>
                  Extra
                </Text>
                <Text style={[styles.comparisonValue, { color: colors.success }]}>
                  +{formatUnitAmount((received ?? 0) - (requested ?? 0), denomination)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  infoCard: {
    borderRadius: 16,
    padding: 8,
  },
  comparisonCard: {
    borderRadius: 20,
    padding: 16,
  },
  centerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
  },
  // Waiting icon
  waitingIconOuter: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44,
  },
  waitingIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Success icon
  successIconOuter: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: -0.2,
  },
  // Message card (ask sender)
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  // Details card
  detailsContent: {
    gap: 0,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  detailAmount: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  detailAddress: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  // Tip
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  // Txid
  txidRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txidLabel: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  txidValue: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  // Bottom bar
  bottomBar: {
    paddingBottom: 34,
  },
  // Bottom sheet
  sheetContent: {
    paddingHorizontal: 28,
  },
  sheetFooter: {},
  comparisonContent: {
    gap: 0,
  },
  comparisonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  comparisonLabel: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  comparisonValue: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  // Confirmation code — digit boxes
  codeDisplayContainer: {
    alignItems: 'center',
    gap: 14,
  },
  codeDisplayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeDisplayIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDisplayLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  codeDigitsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  codeDigitBox: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0A84FF',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
    }),
  },
  codeDigitText: {
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  codeDisplayHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeDisplayHint: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
});
