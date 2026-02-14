/**
 * pay.tsx — Deep link handler for satryn://pay?data=<base64url-json>
 *
 * When a user taps a payment request link, Expo Router resolves
 * satryn://pay → app/pay.tsx. This screen decodes the payload,
 * validates it, stores it in the deep link store, then redirects
 * to the send flow (or onboarding if no wallet exists).
 */

import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWalletStore, useSettingsStore, useDeepLinkStore } from '../src/stores';
import { getThemeColors } from '../src/constants';
import { resolveThemeMode } from '../src/hooks';
import type { PaymentLinkPayload } from '../src/types/contacts';

/**
 * Decode a base64url string back to UTF-8.
 * Reverses: replace(+→-) replace(/→_) strip(=)
 */
function base64urlDecode(encoded: string): string {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8');
  }
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Validate decoded JSON is a well-formed PaymentLinkPayload.
 */
function isValidPayload(obj: unknown): obj is PaymentLinkPayload {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  if (p.v !== 1) return false;
  if (p.action !== 'send') return false;
  if (!Array.isArray(p.recipients) || p.recipients.length === 0) return false;
  for (const r of p.recipients) {
    if (!r || typeof r !== 'object') return false;
    if (typeof (r as Record<string, unknown>).address !== 'string') return false;
    if ((r as Record<string, unknown>).address === '') return false;
  }
  return true;
}

export default function PayDeepLinkHandler() {
  const router = useRouter();
  const params = useLocalSearchParams<{ data?: string }>();
  const isInitialized = useWalletStore(s => s.isInitialized);
  const walletId = useWalletStore(s => s.walletId);
  const isLocked = useWalletStore(s => s.isLocked);
  const systemColorScheme = useColorScheme();
  const theme = useSettingsStore(s => s.theme);
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const colors = getThemeColors(themeMode);

  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (!isInitialized) return; // Wait for wallet init

    handled.current = true;

    // 1. Decode the data param
    const raw = params.data;
    if (!raw) {
      if (__DEV__) console.warn('[DeepLink] /pay opened with no data param');
      router.replace('/');
      return;
    }

    let payload: PaymentLinkPayload;
    try {
      const json = base64urlDecode(raw);
      const parsed = JSON.parse(json);
      if (!isValidPayload(parsed)) {
        throw new Error('Invalid payload structure');
      }
      payload = parsed;
    } catch (err) {
      if (__DEV__) console.warn('[DeepLink] Failed to decode payment link:', err);
      router.replace('/');
      return;
    }

    // 2. Store in deep link store
    useDeepLinkStore.getState().setPendingPayload(payload);

    // 3. Route based on wallet state
    if (!walletId) {
      // No wallet → send to onboarding (payload stays pending)
      router.replace('/(onboarding)');
      return;
    }

    if (isLocked) {
      // Wallet locked → unlock first (payload stays pending, consumed after unlock)
      router.replace('/(lock)');
      return;
    }

    // 4. Wallet ready → go to send flow with prefill from first recipient
    const firstRecipient = payload.recipients[0];
    router.replace({
      pathname: '/(auth)/send',
      params: {
        address: firstRecipient.address,
        amount: firstRecipient.amountSats ? String(firstRecipient.amountSats) : undefined,
        memo: payload.memo || undefined,
      },
    });
  }, [isInitialized]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
