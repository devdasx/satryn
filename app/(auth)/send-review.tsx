/**
 * Send — Review step route.
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks';
import { useSendStore } from '../../src/stores/sendStore';
import { SendHeader } from '../../src/components/send/SendHeader';
import { StepReview } from '../../src/components/send/StepReview';
import { SendErrorSheet } from '../../src/components/send/SendErrorSheet';

export default function SendReviewRoute() {
  const { colors } = useTheme();
  const router = useRouter();
  const error = useSendStore((s) => s.error);
  const errorLevel = useSendStore((s) => s.errorLevel);
  const reset = useSendStore((s) => s.reset);

  // Initialize to true if error already exists on mount (e.g., returning from failed broadcast)
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

  // Also react to error changes after mount (e.g., fee estimation errors)
  React.useEffect(() => {
    if (error) setShowErrorSheet(true);
  }, [error]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SendHeader
        step="review"
        onClose={handleClose}
        onErrorPress={handleErrorPress}
      />
      <View style={styles.content}>
        <StepReview />
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
