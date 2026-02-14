/**
 * Send — Entry point. Resets store, prefills params, detects capability,
 * then immediately redirects to send-recipient.
 */

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSendStore } from '../../src/stores/sendStore';
import { useDeepLinkStore } from '../../src/stores';
import { useTheme } from '../../src/hooks';

export default function SendRoute() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    address?: string;
    amount?: string;
    memo?: string;
    bip21?: string;
  }>();

  useEffect(() => {
    const store = useSendStore.getState();
    store.reset();
    store.detectWalletCapability();
    if (params.address || params.bip21) {
      store.prefillFromParams(params);
    }

    // Clear any pending deep link payload now that send flow has consumed it
    useDeepLinkStore.getState().clearPending();

    // If both address and amount are already prefilled (e.g. from a payment link),
    // skip directly to the review screen — no need to re-enter what's already set.
    const hasAddress = !!(params.address || params.bip21);
    const hasAmount = !!(params.amount && parseInt(params.amount, 10) > 0);

    if (hasAddress && hasAmount) {
      router.replace('/(auth)/send-review');
    } else {
      router.replace('/(auth)/send-recipient');
    }
  }, []);

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
