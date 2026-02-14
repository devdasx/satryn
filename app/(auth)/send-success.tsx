/**
 * Send — Success step route (no header, no swipe-back).
 */

import '../../shim';
import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { useSendStore } from '../../src/stores/sendStore';
import { StepSuccess } from '../../src/components/send/StepSuccess';
import type { SuccessTxData } from '../../src/components/send/StepSuccess';

export default function SendSuccessRoute() {
  const { colors } = useTheme();
  const router = useRouter();
  const reset = useSendStore((s) => s.reset);

  // Snapshot tx data once on mount — sendStore will be reset on Done
  const txData = useMemo<SuccessTxData>(() => {
    const state = useSendStore.getState();
    // preparedFee is set during tx preparation; signedTx.fee may be 0 if preparedFee was null at sign time
    const fee = state.preparedFee || state.signedTx?.fee || 0;
    const recipientTotal = state.recipients.reduce((sum, r) => sum + r.amountSats, 0);
    return {
      txid: state.broadcastTxid ?? state.signedTx?.txid ?? '',
      recipients: state.recipients.map(r => ({
        address: r.address,
        amountSats: r.amountSats,
        label: r.label,
      })),
      fee,
      feeRate: state.feeRate,
      enableRBF: state.enableRBF,
      memo: state.memo,
      totalSats: recipientTotal + fee,
    };
  }, []);

  const handleDone = useCallback(() => {
    reset();
    // Always go home after successful broadcast — never back through send flow
    router.replace('/(auth)/(tabs)');
  }, [reset, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StepSuccess txData={txData} onDone={handleDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
