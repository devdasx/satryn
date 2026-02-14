/**
 * NearbyReceiveSetup — Premium receive setup with glass inputs
 *
 * Allows the receiver to optionally set an amount and memo
 * before starting nearby broadcasting. Supports sats, BTC, and
 * fiat denomination for the amount.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics } from '../../hooks';
import { useWalletStore } from '../../stores';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePriceStore } from '../../stores/priceStore';
import { fiatToSats, formatSats, formatUnitAmount, getUnitSymbol, unitToSats } from '../../utils/formatting';
import { FORMATTING } from '../../constants';
import { useNearby } from './NearbyProvider';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { AppButton } from '../ui/AppButton';
import type { BitcoinUnit } from '../../types';

type DisplayUnit = BitcoinUnit | 'fiat';

export function NearbyReceiveSetup() {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const { startReceive } = useNearby();
  const getFirstUnusedAddress = useWalletStore(s => s.getFirstUnusedAddress);
  const savedNickname = useSettingsStore((s) => s.nearbyNickname);
  const currency = useSettingsStore((s) => s.currency);
  const denomination = useSettingsStore((s) => s.denomination);
  const price = usePriceStore((s) => s.price);
  const fetchPrice = usePriceStore((s) => s.fetchPrice);

  const [nickname, setNickname] = useState(savedNickname);
  const [amountStr, setAmountStr] = useState('');
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>(denomination);
  const [memo, setMemo] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [nicknameFocused, setNicknameFocused] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);
  const [memoFocused, setMemoFocused] = useState(false);

  const nicknameValid = nickname.trim().length > 0;

  // Fetch price on mount for fiat conversion
  useEffect(() => {
    fetchPrice();
  }, []);

  // Cycle through denominations: denomination → fiat (skip fiat if no price)
  const handleCycleUnit = useCallback(() => {
    haptics.trigger('light');
    setAmountStr('');
    setDisplayUnit((prev) => {
      if (prev === denomination) return price ? 'fiat' : denomination;
      return denomination; // fiat → denomination
    });
  }, [price, haptics, denomination]);

  // Unit label for the cycle pill
  const unitLabel = displayUnit === 'fiat'
    ? (currency || 'USD')
    : getUnitSymbol(displayUnit);

  // Compute sats equivalent for conversion preview
  const getPreviewSats = useCallback((): number | null => {
    if (!amountStr) return null;
    const parsed = parseFloat(amountStr);
    if (isNaN(parsed) || parsed <= 0) return null;

    if (displayUnit === 'fiat') {
      if (price && price > 0) return fiatToSats(parsed, price);
      return null;
    }
    // For any non-sat denomination, show preview in user's denomination
    if (displayUnit === denomination) return null; // No preview when already in denomination
    return unitToSats(parsed, displayUnit);
  }, [amountStr, displayUnit, price, denomination]);

  const previewSats = getPreviewSats();

  const handleStart = useCallback(async () => {
    if (isStarting || !nicknameValid) return;
    setIsStarting(true);

    // Persist nickname for future sessions
    useSettingsStore.getState().setNearbyNickname(nickname.trim());

    await haptics.trigger('medium');

    const address = getFirstUnusedAddress('native_segwit');
    if (!address) {
      setIsStarting(false);
      return;
    }

    // Convert to sats based on display unit
    let amountSats: number | undefined;
    let displayAmount: number | undefined;

    if (amountStr) {
      const parsed = parseFloat(amountStr);
      if (!isNaN(parsed) && parsed > 0) {
        displayAmount = parsed;

        if (displayUnit === 'fiat') {
          if (price && price > 0) {
            amountSats = fiatToSats(parsed, price);
          }
        } else {
          amountSats = unitToSats(parsed, displayUnit);
          if (displayUnit === 'sat') {
            displayAmount = Math.round(parsed);
          }
        }
      }
    }

    startReceive({
      address: address.address,
      amountSats: amountSats && amountSats > 0 ? amountSats : undefined,
      memo: memo.trim() || undefined,
      displayDenomination: amountSats ? displayUnit : undefined,
      displayAmount: amountSats ? displayAmount : undefined,
      displayCurrency: displayUnit === 'fiat' ? (currency || 'USD') : undefined,
    });
  }, [amountStr, displayUnit, memo, nickname, nicknameValid, getFirstUnusedAddress, startReceive, haptics, isStarting, price, currency]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.content}>
        {/* Hero icon with gradient glow */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={styles.iconOuter}
        >
          <LinearGradient
            colors={isDark
              ? ['rgba(48, 209, 88, 0.12)', 'rgba(48, 209, 88, 0.02)']
              : ['rgba(52, 199, 89, 0.12)', 'rgba(52, 199, 89, 0.02)']}
            style={styles.iconGradient}
          />
          <View style={[styles.iconContainer, {
            backgroundColor: isDark ? 'rgba(48, 209, 88, 0.12)' : 'rgba(52, 199, 89, 0.1)',
          }]}>
            <Ionicons name="arrow-down" size={28} color={colors.success} />
          </View>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(100).duration(400)}
          style={[styles.title, { color: colors.textPrimary }]}
        >
          Request Payment
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(200).duration(400)}
          style={[styles.subtitle, { color: colors.textSecondary }]}
        >
          Set an optional amount and memo, then{'\n'}start broadcasting nearby.
        </Animated.Text>

        {/* Nickname Input — PremiumInput card (required) */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(400)}
          style={{ width: '100%' }}
        >
          <PremiumInputCard label="YOUR NICKNAME">
            <PremiumInput
              icon="person"
              iconColor="#007AFF"
              placeholder="e.g. Alex, Mom, Shop"
              value={nickname}
              onChangeText={setNickname}
              maxLength={20}
              autoCapitalize="words"
              returnKeyType="next"
              onFocus={() => setNicknameFocused(true)}
              onBlur={() => {
                setNicknameFocused(false);
                if (nickname.trim()) useSettingsStore.getState().setNearbyNickname(nickname.trim());
              }}
            />
          </PremiumInputCard>
        </Animated.View>

        {/* Amount Input — PremiumInput card with denomination picker */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(400)}
          style={{ width: '100%' }}
        >
          <PremiumInputCard label="AMOUNT">
            <PremiumInput
              icon="cash"
              iconColor="#30D158"
              placeholder="Optional"
              value={amountStr}
              onChangeText={setAmountStr}
              keyboardType={displayUnit === 'sat' ? 'number-pad' : 'decimal-pad'}
              returnKeyType="next"
              centered
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              rightElement={
                <TouchableOpacity
                  onPress={handleCycleUnit}
                  activeOpacity={0.7}
                  style={[styles.unitPill, {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  }]}
                >
                  <Text style={[styles.unitPillText, { color: colors.textSecondary }]}>
                    {unitLabel}
                  </Text>
                  <Ionicons name="chevron-expand-outline" size={10} color={colors.textTertiary} />
                </TouchableOpacity>
              }
            />
          </PremiumInputCard>
          {/* Conversion preview (fiat → denomination) */}
          {displayUnit === 'fiat' && previewSats != null && (
            <Text style={[styles.conversionPreview, { color: colors.textTertiary, marginTop: -8, marginBottom: 12 }]}>
              ≈ {formatUnitAmount(previewSats, denomination)}
            </Text>
          )}
        </Animated.View>

        {/* Memo Input — PremiumInput card */}
        <Animated.View
          entering={FadeInDown.delay(500).duration(400)}
          style={{ width: '100%' }}
        >
          <PremiumInputCard label="MEMO">
            <PremiumInput
              icon="document-text"
              iconColor="#8E8E93"
              placeholder="e.g. Dinner, Coffee"
              value={memo}
              onChangeText={setMemo}
              maxLength={100}
              returnKeyType="done"
              onFocus={() => setMemoFocused(true)}
              onBlur={() => setMemoFocused(false)}
            />
          </PremiumInputCard>
        </Animated.View>
      </View>

      {/* Bottom CTA */}
      <Animated.View
        entering={FadeInDown.delay(600).duration(400)}
        style={styles.bottomBar}
      >
        {!nicknameValid && (
          <Text style={[styles.nicknameHint, { color: colors.textTertiary }]}>
            Set a nickname so the sender knows who you are
          </Text>
        )}
        <AppButton
          title={isStarting ? 'Starting...' : 'Start Nearby'}
          onPress={handleStart}
          disabled={isStarting || !nicknameValid}
          loading={isStarting}
          variant="primary"
          haptic="medium"
        />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    alignItems: 'center',
  },
  iconOuter: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 40,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    marginBottom: 32,
    letterSpacing: -0.2,
  },
  inputCard: {
    width: '100%',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inputIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContent: {
    flex: 1,
  },
  amountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  input: {
    fontSize: 17,
    fontWeight: '500',
    padding: 0,
    letterSpacing: -0.3,
  },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  unitPillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  conversionPreview: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    marginTop: 4,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  nicknameHint: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.1,
  },
});
