/**
 * Send — Amount step route.
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { useSendStore } from '../../src/stores/sendStore';
import { SendHeader } from '../../src/components/send/SendHeader';
import { StepAmount } from '../../src/components/send/StepAmount';
import { SendErrorSheet } from '../../src/components/send/SendErrorSheet';

export default function SendAmountRoute() {
  const { colors } = useTheme();
  const router = useRouter();
  const error = useSendStore((s) => s.error);
  const errorLevel = useSendStore((s) => s.errorLevel);
  const reset = useSendStore((s) => s.reset);

  const [showErrorSheet, setShowErrorSheet] = useState(false);

  const handleClose = useCallback(() => {
    reset();
    if (router.canGoBack()) {
      router.dismissAll();
    } else {
      router.replace('/(auth)/(tabs)');
    }
  }, [reset, router]);

  const handleErrorPress = useCallback(() => {
    setShowErrorSheet(true);
  }, []);

  const handleDismissError = useCallback(() => {
    setShowErrorSheet(false);
    useSendStore.setState({ error: null, errorLevel: null });
  }, []);

  React.useEffect(() => {
    if (error) setShowErrorSheet(true);
  }, [error]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SendHeader
        step="amount"
        onClose={handleClose}
        onErrorPress={handleErrorPress}
      />
      <View style={styles.content}>
        <StepAmount />
      </View>
      <SendErrorSheet
        visible={showErrorSheet}
        onClose={handleDismissError}
        error={error}
        errorLevel={errorLevel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
