/**
 * StepAmount — Hero amount display + numeric keypad + unit cycling.
 * Cash App / Strike style amount input.
 *
 * Multi-recipient mode: Steps through each recipient one at a time,
 * showing "Recipient X of N" with address preview + progress indicator.
 *
 * Includes real-time validation:
 *   - Over-balance: red amount, warning haptic on every keypress, shake, disable Continue
 *   - Dust (<547 sats): warning banner, disable Continue
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  FadeIn,
  FadeInUp,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { useHaptics } from '../../hooks/useHaptics';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { useWalletStore } from '../../stores/walletStore';
import { useUTXOStore } from '../../stores/utxoStore';
import { useSendStore } from '../../stores/sendStore';
import { unitToSats, formatUnitAmount } from '../../utils/formatting';
import { PriceAPI } from '../../services/api/PriceAPI';
import { AppButton } from '../ui/AppButton';
import { AmountHeroDisplay } from './AmountHeroDisplay';
import { AmountKeypad } from './AmountKeypad';
import { UnitPickerSheet } from './UnitPickerSheet';
import { CoinControlSheet } from './CoinControlSheet';
import type { AmountWarningType } from './AmountHeroDisplay';
import type { BitcoinUnit } from '../../types';

/** Bitcoin dust threshold in satoshis */
const DUST_THRESHOLD_SATS = 547;

export function StepAmount() {
  const { colors } = useTheme();
  const haptics = useHaptics();
  const router = useRouter();
  const denomination = useSettingsStore(s => s.denomination);
  const setDenomination = useSettingsStore(s => s.setDenomination);
  const currency = useSettingsStore(s => s.currency);
  const setCurrency = useSettingsStore(s => s.setCurrency);
  const setLastInputUnit = useSettingsStore(s => s.setLastInputUnit);
  const price = usePriceStore((s) => s.price);
  const setPriceCurrency = usePriceStore(s => s.setCurrency);

  // Wallet balance (in sats)
  const balance = useWalletStore((s) => s.balance);
  const balanceSats = balance.total;
  const utxos = useWalletStore((s) => s.utxos);
  const getUTXOs = useWalletStore((s) => s.getUTXOs);

  // Ensure UTXOs are loaded from DB on mount (store may be empty after lock/unlock)
  useEffect(() => {
    if (utxos.length === 0) {
      getUTXOs();
    }
    useUTXOStore.getState().initFromDb();
  }, []);

  // Available balance: total minus amounts already allocated to previous recipients
  // For multi-recipient sends, this shows how much is left for the current recipient

  const amountInput = useSendStore((s) => s.amountInput);
  const inputUnit = useSendStore((s) => s.inputUnit);
  const isSendMax = useSendStore((s) => s.isSendMax);
  const setAmountInput = useSendStore((s) => s.setAmountInput);
  const setInputUnit = useSendStore((s) => s.setInputUnit);
  const setSendMax = useSendStore((s) => s.setSendMax);
  const recipients = useSendStore((s) => s.recipients);
  const updateRecipient = useSendStore((s) => s.updateRecipient);
  const amountRecipientIndex = useSendStore((s) => s.amountRecipientIndex);
  const nextAmountRecipient = useSendStore((s) => s.nextAmountRecipient);
  const selectedUtxos = useSendStore((s) => s.selectedUtxos);
  const setSelectedUtxos = useSendStore((s) => s.setSelectedUtxos);

  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [showCoinControl, setShowCoinControl] = useState(false);

  // Shake animation for the hero amount
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 40, easing: Easing.linear }),
      withTiming(10, { duration: 40, easing: Easing.linear }),
      withTiming(-10, { duration: 40, easing: Easing.linear }),
      withTiming(10, { duration: 40, easing: Easing.linear }),
      withTiming(-4, { duration: 40, easing: Easing.linear }),
      withTiming(4, { duration: 40, easing: Easing.linear }),
      withTiming(0, { duration: 40, easing: Easing.linear }),
    );
  }, [shakeX]);

  // Only count valid recipients (with addresses)
  const validRecipients = useMemo(
    () => recipients.filter((r) => r.address),
    [recipients],
  );
  const isMultiRecipient = validRecipients.length > 1;
  const currentRecipient = validRecipients[amountRecipientIndex];
  const isLastRecipient = amountRecipientIndex >= validRecipients.length - 1;

  // Available balance: if UTXOs are manually selected, use their sum; otherwise full wallet balance
  // For multi-recipient sends, subtract amounts already committed to previous recipients
  const availableBalanceSats = useMemo(() => {
    const base = selectedUtxos
      ? selectedUtxos.reduce((sum, u) => sum + u.value, 0)
      : balanceSats;
    if (!isMultiRecipient) return base;
    let allocated = 0;
    for (let i = 0; i < amountRecipientIndex; i++) {
      if (validRecipients[i]) allocated += validRecipients[i].amountSats;
    }
    return Math.max(0, base - allocated);
  }, [balanceSats, selectedUtxos, validRecipients, amountRecipientIndex, isMultiRecipient]);

  const handleOpenUnitPicker = useCallback(() => {
    setShowUnitPicker(true);
  }, []);

  const handleSelectUnit = useCallback((unit: BitcoinUnit) => {
    setDenomination(unit);
    setInputUnit(unit);
    setLastInputUnit(unit);
    setAmountInput('');
  }, [setDenomination, setInputUnit, setLastInputUnit, setAmountInput]);

  const handleSelectCurrency = useCallback((code: string) => {
    setCurrency(code);
    setPriceCurrency(code);
    setInputUnit('fiat');
    setLastInputUnit('fiat');
    setAmountInput('');
  }, [setCurrency, setPriceCurrency, setInputUnit, setLastInputUnit, setAmountInput]);

  // Determine if decimal input is allowed (not for sat unit)
  const allowDecimal = inputUnit !== 'sat';

  // ── Validation (computed from current state) ──────────────────

  // Calculate sats for validation
  const amountInSats = useMemo(() => {
    if (isSendMax) return 1; // placeholder, actual calculated during prepareTx
    if (!amountInput || amountInput === '0') return 0;
    const num = parseFloat(amountInput);
    if (isNaN(num) || num <= 0) return 0;
    if (inputUnit === 'fiat') {
      if (!price) return 0;
      return Math.round((num / price) * 100_000_000);
    }
    return unitToSats(num, inputUnit);
  }, [amountInput, inputUnit, price, isSendMax]);

  // Over-balance check — compare against available balance (accounts for multi-recipient)
  const isOverBalance = !isSendMax && amountInSats > 0 && amountInSats > availableBalanceSats;

  // Dust check (only when user has entered a positive non-zero amount)
  const isDust = !isSendMax && amountInSats > 0 && amountInSats < DUST_THRESHOLD_SATS;

  // Warning type for hero display coloring
  const warningType: AmountWarningType = isOverBalance
    ? 'over-balance'
    : isDust
      ? 'dust'
      : null;

  // Continue button disabled when: no amount, over balance, or dust
  const isContinueDisabled = (!isSendMax && amountInSats <= 0) || isOverBalance || isDust;

  // ── Helpers to check over-balance after key input ─────────────

  /** Compute sats from a raw input string (used inline after key press) */
  const computeSatsForInput = useCallback((input: string): number => {
    if (!input || input === '0') return 0;
    const num = parseFloat(input);
    if (isNaN(num) || num <= 0) return 0;
    if (inputUnit === 'fiat') {
      const currentPrice = usePriceStore.getState().price;
      if (!currentPrice) return 0;
      return Math.round((num / currentPrice) * 100_000_000);
    }
    return unitToSats(num, inputUnit);
  }, [inputUnit]);

  /** Fire warning haptic + shake if the new input exceeds available balance */
  const checkAndWarnOverBalance = useCallback((newInput: string) => {
    const sats = computeSatsForInput(newInput);
    if (sats > 0 && sats > availableBalanceSats) {
      haptics.trigger('warning');
      triggerShake();
    }
  }, [computeSatsForInput, availableBalanceSats, haptics, triggerShake]);

  // ── Key handlers ──────────────────────────────────────────────

  // Max decimal places per unit type
  const maxDecimalPlaces = useMemo(() => {
    switch (inputUnit) {
      case 'btc': return 8;
      case 'mbtc': return 5;
      case 'ubtc': case 'cbtc': return 2;
      case 'sat': return 0;
      case 'fiat': return 2;
      default: return 8;
    }
  }, [inputUnit]);

  const handleKeyPress = useCallback((key: string) => {
    if (isSendMax) return;
    const current = useSendStore.getState().amountInput;
    let newInput: string;

    // Leading dot → prefix with "0"
    if (key === '.' && (!current || current === '0')) {
      newInput = '0.';
    } else if (current === '0' && key !== '.') {
      newInput = key;
    } else if (key === '.' && current.includes('.')) {
      return; // Already has decimal
    } else if (current.length >= 15) {
      return; // Max length guard
    } else {
      newInput = current + key;
    }

    // Enforce max decimal places for the current unit
    if (newInput.includes('.')) {
      const parts = newInput.split('.');
      if (parts[1] && parts[1].length > maxDecimalPlaces) {
        return; // Don't allow more decimal places than the unit supports
      }
    }

    setAmountInput(newInput);
    checkAndWarnOverBalance(newInput);
  }, [isSendMax, setAmountInput, checkAndWarnOverBalance, maxDecimalPlaces]);

  const handleBackspace = useCallback(() => {
    if (isSendMax) {
      setSendMax(false);
      return;
    }
    const current = useSendStore.getState().amountInput;
    setAmountInput(current.slice(0, -1));
  }, [isSendMax, setAmountInput, setSendMax]);

  const handleMax = useCallback(() => {
    haptics.trigger('medium');
    setSendMax(true);
  }, [haptics, setSendMax]);

  // ── Navigation ────────────────────────────────────────────────

  const handleContinue = useCallback(() => {
    if (isContinueDisabled) return;
    haptics.trigger('medium');

    if (isMultiRecipient) {
      // Save amount to current recipient, then advance
      if (!isSendMax) {
        updateRecipient(
          recipients.indexOf(currentRecipient),
          { amountSats: amountInSats },
        );
      }
      const result = nextAmountRecipient();
      if (result === 'review') {
        router.push('/(auth)/send-review');
      }
    } else {
      // Single recipient — write amount and go to review
      if (!isSendMax) {
        updateRecipient(0, { amountSats: amountInSats });
      }
      router.push('/(auth)/send-review');
    }
  }, [isContinueDisabled, amountInSats, isSendMax, haptics, router, recipients, updateRecipient, isMultiRecipient, currentRecipient, nextAmountRecipient]);

  // Format address preview
  const addressPreview = currentRecipient?.address
    ? `${currentRecipient.address.slice(0, 8)}...${currentRecipient.address.slice(-6)}`
    : '';

  // Format available balance for display in warning + balance label — uses the current input unit
  const formattedBalance = useMemo(() => {
    if (inputUnit === 'fiat') {
      if (!price) return formatUnitAmount(availableBalanceSats, denomination);
      const fiatValue = (availableBalanceSats / 100_000_000) * price;
      return PriceAPI.formatPrice(fiatValue, currency || 'USD');
    }
    return formatUnitAmount(availableBalanceSats, inputUnit);
  }, [availableBalanceSats, inputUnit, price, currency, denomination]);

  return (
    <Animated.View entering={FadeInDown.duration(300).springify()} style={styles.container}>
      {/* Multi-recipient indicator */}
      {isMultiRecipient && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.recipientIndicator}>
          {/* Progress pills */}
          <View style={styles.progressRow}>
            {validRecipients.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressPill,
                  {
                    backgroundColor: i <= amountRecipientIndex
                      ? colors.text
                      : colors.fillTertiary,
                    flex: 1,
                  },
                ]}
              />
            ))}
          </View>

          {/* Recipient info */}
          <View style={styles.recipientInfo}>
            <Text style={[styles.recipientLabel, { color: colors.textTertiary }]}>
              Recipient {amountRecipientIndex + 1} of {validRecipients.length}
            </Text>
            <Text style={[styles.recipientAddress, { color: colors.textSecondary }]} numberOfLines={1}>
              {currentRecipient?.label || addressPreview}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Hero display — fixed position, not shifted by warnings */}
      <View style={styles.heroSection}>
        <Animated.View style={shakeStyle}>
          <AmountHeroDisplay
            amountInput={amountInput}
            inputUnit={inputUnit}
            isSendMax={isSendMax}
            onCycleUnit={handleOpenUnitPicker}
            warningType={warningType}
            availableBalanceSats={availableBalanceSats}
          />
        </Animated.View>

        {/* Warning banners — absolutely positioned below hero, no layout shift */}
        <View style={styles.warningSlot}>
          {isOverBalance && (
            <Animated.View
              entering={FadeInUp.duration(250)}
              exiting={FadeOut.duration(150)}
              style={[styles.warningBanner, { backgroundColor: colors.errorMuted }]}
            >
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={[styles.warningText, { color: colors.error }]}>
                Exceeds balance of {formattedBalance}
              </Text>
            </Animated.View>
          )}
          {isDust && !isOverBalance && (
            <Animated.View
              entering={FadeInUp.duration(250)}
              exiting={FadeOut.duration(150)}
              style={[styles.warningBanner, { backgroundColor: colors.warningMuted }]}
            >
              <Ionicons name="warning" size={16} color={colors.warningLight} />
              <Text style={[styles.warningText, { color: colors.warningLight }]}>
                Below dust limit (547 sats) — cannot be sent
              </Text>
            </Animated.View>
          )}
        </View>
      </View>

      {/* Available balance */}
      <View style={styles.availableBalanceRow}>
        <Text style={[styles.availableBalanceLabel, { color: colors.textTertiary }]}>
          Available
        </Text>
        <Text style={[styles.availableBalanceValue, { color: colors.textSecondary }]}>
          {formattedBalance}
        </Text>
      </View>

      {/* Coin Control pill */}
      <View style={styles.coinControlRow}>
        <TouchableOpacity
          style={[styles.coinControlPill, { backgroundColor: colors.fillSecondary }]}
          onPress={() => setShowCoinControl(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="layers-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.coinControlText, { color: colors.textSecondary }]}>
            {selectedUtxos ? `${selectedUtxos.length} coins selected` : 'Coin Control'}
          </Text>
          <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Keypad */}
      <View style={styles.keypadSection}>
        <AmountKeypad
          onKeyPress={handleKeyPress}
          onBackspace={handleBackspace}
          onMax={handleMax}
          allowDecimal={allowDecimal}
        />
      </View>

      {/* Continue / Next button */}
      <View style={styles.footer}>
        <AppButton
          title={isMultiRecipient && !isLastRecipient ? 'Next Recipient' : 'Continue'}
          onPress={handleContinue}
          variant="primary"
          disabled={isContinueDisabled}
        />
      </View>

      {/* Unit / Currency Picker Sheet */}
      <UnitPickerSheet
        visible={showUnitPicker}
        onClose={() => setShowUnitPicker(false)}
        activeUnit={inputUnit}
        activeCurrency={currency || 'USD'}
        onSelectUnit={handleSelectUnit}
        onSelectCurrency={handleSelectCurrency}
      />

      {/* Coin Control Sheet */}
      <CoinControlSheet
        visible={showCoinControl}
        onClose={() => setShowCoinControl(false)}
        utxos={utxos}
        selectedUtxos={selectedUtxos}
        onApply={setSelectedUtxos}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Multi-recipient indicator
  recipientIndicator: {
    paddingHorizontal: 24,
    paddingTop: 4,
    gap: 8,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
  },
  progressPill: {
    height: 3,
    borderRadius: 1.5,
  },
  recipientInfo: {
    alignItems: 'center',
    gap: 2,
  },
  recipientLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  recipientAddress: {
    fontSize: 13,
    fontWeight: '500',
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
  },
  // Warning slot — fixed height reserved below hero, prevents layout shift
  warningSlot: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Warning banner pill
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  warningText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  availableBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 6,
  },
  availableBalanceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  availableBalanceValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  coinControlRow: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  coinControlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  coinControlText: {
    fontSize: 13,
    fontWeight: '500',
  },
  keypadSection: {
    paddingBottom: 8,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
});
