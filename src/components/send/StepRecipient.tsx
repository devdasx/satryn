/**
 * StepRecipient — Conversation-style recipient input for the send flow.
 *
 * Each filled recipient appears as a card. The PremiumInput sits at the
 * bottom with capsule action buttons (Paste / Scan / Contacts) below it.
 *
 * A recipient count capsule appears at the top once addresses are added.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { THEME, getColors } from '../../constants';
import { useHaptics } from '../../hooks/useHaptics';
import { useWalletStore } from '../../stores/walletStore';
import { useSendStore } from '../../stores/sendStore';
import { TransactionBuilder } from '../../core/transaction/TransactionBuilder';
import { AppButton } from '../ui/AppButton';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { RecipientCard } from './RecipientCard';
import { ContactPickerSheet } from './ContactPickerSheet';
import { AddressVerifySheet } from './AddressVerifySheet';

// ─── Animated Pressable ──────────────────────────────────────────
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Premium spring config ───────────────────────────────────────
const SPRING_SNAPPY = { damping: 18, stiffness: 350, mass: 0.8 };

// ─── Animated Bubble Wrapper ─────────────────────────────────────
/** Premium entrance: scale from 0.88 + translateY from 30 + opacity from 0 */
function AnimatedBubble({
  children,
  index,
}: {
  children: React.ReactNode;
  index: number;
}) {
  const scale = useSharedValue(0.88);
  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const delay = index * 100;
    opacity.value = withDelay(delay, withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) }));
    scale.value = withDelay(delay, withSpring(1, { damping: 14, stiffness: 200, mass: 0.7 }));
    translateY.value = withDelay(delay, withSpring(0, { damping: 16, stiffness: 180, mass: 0.8 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View style={animStyle}>
      {children}
    </Animated.View>
  );
}

// ─── Action Capsule (text-only, no icon, no color) ──────────────
function ActionCapsule({
  label,
  onPress,
  mutedColor,
  capsuleBg,
}: {
  label: string;
  onPress: () => void;
  mutedColor: string;
  capsuleBg: string;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[styles.actionCapsule, { backgroundColor: capsuleBg }, animStyle]}
      onPressIn={() => {
        scale.value = withSpring(0.92, SPRING_SNAPPY);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_SNAPPY);
      }}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Text style={[styles.actionCapsuleText, { color: mutedColor }]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function StepRecipient() {
  const { isDark, colors, themeMode } = useTheme();
  const c = useMemo(() => getColors(themeMode), [themeMode]);
  const haptics = useHaptics();
  const router = useRouter();
  const network = useWalletStore((s) => s.network);
  const scrollRef = useRef<ScrollView>(null);

  const recipients = useSendStore((s) => s.recipients);
  const activeIndex = useSendStore((s) => s.activeRecipientIndex);
  const updateRecipient = useSendStore((s) => s.updateRecipient);
  const addRecipient = useSendStore((s) => s.addRecipient);
  const removeRecipient = useSendStore((s) => s.removeRecipient);
  const setActiveRecipientIndex = useSendStore((s) => s.setActiveRecipientIndex);

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [verifyAddress, setVerifyAddress] = useState<{ address: string; label?: string } | null>(null);
  const [addressInput, setAddressInput] = useState(recipients[activeIndex]?.address || '');

  // Sync local input when store changes externally (scan screen, deep link, etc.)
  const storeAddress = recipients[activeIndex]?.address || '';
  useEffect(() => {
    if (storeAddress !== addressInput) {
      setAddressInput(storeAddress);
    }
  }, [storeAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  const builder = useMemo(() => new TransactionBuilder(network), [network]);

  // ── Design tokens (from theme — respects light / dim / midnight) ─
  const mutedColor = c.settingsRow.description;

  // ── Address validation ──────────────────────────────────────────
  const addressValid = useMemo(() => {
    if (!addressInput) return null;
    return builder.validateAddress(addressInput);
  }, [addressInput, builder]);

  // Validation per recipient (for filled bubbles)
  const recipientValidations = useMemo(() => {
    return recipients.map((r) => {
      if (!r.address) return null;
      return builder.validateAddress(r.address);
    });
  }, [recipients, builder]);

  // Check if current active recipient has a valid address
  const canAddRecipient = addressValid === true;

  // Check if any recipients have addresses (for empty state)
  const hasAnyAddress = recipients.some((r) => r.address);

  // Count filled recipients
  const filledCount = recipients.filter((r) => r.address).length;
  const prevFilledCount = useRef(filledCount);

  // Auto-scroll to bottom when a new bubble appears
  useEffect(() => {
    if (filledCount > prevFilledCount.current) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 200);
    }
    prevFilledCount.current = filledCount;
  }, [filledCount]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleAddressChange = useCallback((text: string) => {
    const trimmed = text.trim();
    setAddressInput(trimmed);
    updateRecipient(activeIndex, { address: trimmed });
  }, [activeIndex, updateRecipient]);

  const handlePaste = useCallback(async () => {
    haptics.trigger('light');
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) return;

      // BIP21 URI detection
      if (text.toLowerCase().startsWith('bitcoin:')) {
        const parsed = TransactionBuilder.parseBitcoinUri(text);
        updateRecipient(activeIndex, {
          address: parsed.address,
          amountSats: parsed.amount ? Math.round(parsed.amount * 100_000_000) : 0,
        });
        setAddressInput(parsed.address);
        if (parsed.message) {
          useSendStore.getState().setMemo(parsed.message);
        }
        return;
      }

      const trimmed = text.trim();
      updateRecipient(activeIndex, { address: trimmed });
      setAddressInput(trimmed);
    } catch {
      // Clipboard access denied
    }
  }, [activeIndex, haptics, updateRecipient]);

  const handleScan = useCallback(() => {
    haptics.trigger('light');
    router.push('/scan');
  }, [haptics, router]);

  const handleOpenContacts = useCallback(() => {
    haptics.trigger('light');
    setShowContactPicker(true);
  }, [haptics]);

  const handleNearby = useCallback(() => {
    haptics.trigger('light');
    router.push({ pathname: '/(auth)/nearby', params: { mode: 'send' } });
  }, [haptics, router]);

  const handleContactSelect = useCallback((address: string, label?: string) => {
    updateRecipient(activeIndex, { address, label });
    setAddressInput(address);
  }, [activeIndex, updateRecipient]);

  const handleAddRecipient = useCallback(() => {
    haptics.trigger('light');
    addRecipient();
    setAddressInput('');
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, [addRecipient, haptics]);

  const handleBubblePress = useCallback((index: number) => {
    if (index === activeIndex) return;
    haptics.trigger('light');
    setActiveRecipientIndex(index);
    setAddressInput(recipients[index]?.address || '');
  }, [activeIndex, recipients, setActiveRecipientIndex, haptics]);

  const handleClearRecipient = useCallback((index: number) => {
    haptics.trigger('light');
    if (recipients.length > 1) {
      removeRecipient(index);
      const newActive = Math.min(index, recipients.length - 2);
      setAddressInput(recipients[newActive === index ? (index > 0 ? index - 1 : 0) : newActive]?.address || '');
    } else {
      updateRecipient(0, { address: '', label: undefined });
      setAddressInput('');
    }
  }, [haptics, recipients, removeRecipient, updateRecipient]);

  const handleVerifyAddress = useCallback((address: string, label?: string) => {
    haptics.trigger('light');
    setVerifyAddress({ address, label });
  }, [haptics]);

  const handleContinue = useCallback(() => {
    const validRecipients = recipients.filter((r) => r.address);
    if (validRecipients.length === 0) {
      useSendStore.setState({
        error: 'No valid recipients: Enter at least one valid Bitcoin address.',
        errorLevel: 'error',
      });
      return;
    }

    for (const r of validRecipients) {
      if (!builder.validateAddress(r.address)) {
        useSendStore.setState({
          error: `Invalid address: "${r.address.slice(0, 20)}..." is not a valid ${network} address.`,
          errorLevel: 'error',
        });
        return;
      }
    }

    haptics.trigger('medium');
    router.push('/(auth)/send-amount');
  }, [recipients, network, builder, haptics, router]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <View style={styles.flex}>
        {/* ── Conversation Area ─────────────────────────── */}
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.conversationContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Recipient count capsule — appears when recipients are added */}
          {hasAnyAddress && (
            <Animated.View
              entering={FadeIn.delay(50).duration(300)}
              style={styles.countRow}
            >
              <View style={[styles.countCapsule, { backgroundColor: c.settingsRow.iconBg }]}>
                <Text style={[styles.countText, { color: mutedColor }]}>
                  {filledCount} {filledCount === 1 ? 'recipient' : 'recipients'}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Empty state */}
          {!hasAnyAddress && (
            <Animated.View
              entering={FadeIn.delay(200).duration(500)}
              style={styles.emptyState}
            >
              <View style={[
                styles.emptyIcon,
                { backgroundColor: c.settingsRow.iconBg },
              ]}>
                <Ionicons
                  name="arrow-up-outline"
                  size={28}
                  color={mutedColor}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: c.settingsRow.value }]}>
                Enter an address to start
              </Text>
              <Text style={[styles.emptySubtitle, { color: c.settingsRow.arrow }]}>
                Paste, scan a QR code, or choose a contact
              </Text>
            </Animated.View>
          )}

          {/* Recipient Cards */}
          {recipients.map((r, i) => {
            if (!r.address) return null;
            return (
              <AnimatedBubble key={`bubble-${i}`} index={i}>
                <RecipientCard
                  address={r.address}
                  label={r.label}
                  index={i}
                  isActive={i === activeIndex}
                  addressValid={recipientValidations[i]}
                  onVerify={() => handleVerifyAddress(r.address, r.label)}
                  onClear={() => handleClearRecipient(i)}
                  onPress={() => handleBubblePress(i)}
                  isDark={isDark}
                  themeMode={themeMode}
                  colors={colors}
                />
              </AnimatedBubble>
            );
          })}

          {/* Add Recipient capsule */}
          {canAddRecipient && (
            <Animated.View
              entering={FadeIn.delay(150).duration(300)}
              style={styles.addRow}
            >
              <TouchableOpacity
                style={[
                  styles.addCapsule,
                  {
                    backgroundColor: c.settingsRow.iconBg,
                    borderColor: c.settingsCard.border,
                  },
                ]}
                onPress={handleAddRecipient}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={14} color={mutedColor} />
                <Text style={[styles.addText, { color: mutedColor }]}>
                  ADD ANOTHER
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </ScrollView>

        {/* ── Input + Action Capsules ─────────────────── */}
        <Animated.View
          entering={FadeIn.delay(100).duration(400)}
          style={styles.inputArea}
        >
          <PremiumInputCard>
            <PremiumInput
              icon="arrow-up"
              iconColor={THEME.brand.bitcoin}
              placeholder="Enter address or scan to send"
              value={addressInput}
              onChangeText={handleAddressChange}
              showClear
              monospace={addressInput.length > 0}
              returnKeyType="done"
              blurOnSubmit
              selectionColor={THEME.brand.bitcoin}
            />
          </PremiumInputCard>

          {/* Capsule buttons row */}
          <View style={styles.capsuleRow}>
            <ActionCapsule
              label="Paste"
              onPress={handlePaste}
              mutedColor={mutedColor}
              capsuleBg={c.settingsRow.iconBg}
            />
            <ActionCapsule
              label="Scan"
              onPress={handleScan}
              mutedColor={mutedColor}
              capsuleBg={c.settingsRow.iconBg}
            />
            <ActionCapsule
              label="Contacts"
              onPress={handleOpenContacts}
              mutedColor={mutedColor}
              capsuleBg={c.settingsRow.iconBg}
            />
            <ActionCapsule
              label="Nearby"
              onPress={handleNearby}
              mutedColor={mutedColor}
              capsuleBg={c.settingsRow.iconBg}
            />
          </View>
        </Animated.View>

        {/* ── Footer ─────────────────────────────────────── */}
        <View style={styles.footer}>
          <AppButton
            title="Continue"
            onPress={handleContinue}
            variant="primary"
            disabled={!recipients.some((r) => r.address)}
          />
        </View>

        {/* ── Contact Picker ─────────────────────────────── */}
        <ContactPickerSheet
          visible={showContactPicker}
          onClose={() => setShowContactPicker(false)}
          onSelect={handleContactSelect}
        />

        {/* ── Address Verify Sheet ────────────────────────── */}
        <AddressVerifySheet
          visible={!!verifyAddress}
          onClose={() => setVerifyAddress(null)}
          address={verifyAddress?.address || ''}
          label={verifyAddress?.label}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  // ── Conversation area ─────────
  conversationContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexGrow: 1,
  },

  // ── Recipient count capsule ─────────
  countRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  countCapsule: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  countText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // ── Empty state ─────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
  },

  // ── Add recipient ─────────
  addRow: {
    alignItems: 'flex-end',
    paddingVertical: 4,
  },
  addCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  addText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  // ── Input area ─────────
  inputArea: {
    marginHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },

  // ── Action capsules ─────────
  capsuleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  actionCapsule: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  actionCapsuleText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },

  // ── Footer ─────────
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
});
