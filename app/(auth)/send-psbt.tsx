/**
 * Send — PSBT signing step route.
 * For multisig: shows the full Multisig Signature Manager (sign locally, import, finalize).
 * For watch-only: shows simple PSBT export (QR, copy, share).
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { useSendStore } from '../../src/stores/sendStore';
import { SendHeader } from '../../src/components/send/SendHeader';
import { StepPSBT } from '../../src/components/send/StepPSBT';
import { SendErrorSheet } from '../../src/components/send/SendErrorSheet';

export default function SendPSBTRoute() {
  const { colors } = useTheme();
  const router = useRouter();
  const error = useSendStore((s) => s.error);
  const errorLevel = useSendStore((s) => s.errorLevel);
  const reset = useSendStore((s) => s.reset);

  const [showErrorSheet, setShowErrorSheet] = useState(() => !!error);

  const handleClose = useCallback(() => {
    reset();
    router.dismissAll();
  }, [reset, router]);

  const handleErrorPress = useCallback(() => {
    setShowErrorSheet(true);
  }, []);

  const handleDismissError = useCallback(() => {
    setShowErrorSheet(false);
    useSendStore.setState({ error: null, errorLevel: null });
  }, []);

  const handleBroadcastSuccess = useCallback(() => {
    router.replace('/(auth)/send-success');
  }, [router]);

  React.useEffect(() => {
    if (error) setShowErrorSheet(true);
  }, [error]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SendHeader
        step="psbt"
        onClose={handleClose}
        onErrorPress={handleErrorPress}
      />
      <View style={styles.content}>
        <StepPSBT
          onDone={handleClose}
          onBroadcastSuccess={handleBroadcastSuccess}
        />
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
