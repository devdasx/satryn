/**
 * StepBroadcasting — Animated progress: signing -> broadcasting -> confirming.
 *
 * Reads real state from sendStore (isBroadcasting, signedTx, broadcastTxid, error)
 * to show accurate progress instead of hardcoded timers.
 *
 * On error:
 *  - Auto-syncs wallet via Electrum to refresh UTXOs & balances
 *  - Shows "Try Again" button (retries signAndBroadcast with cached PIN)
 *  - Shows "Go Home" button as escape hatch
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';
import { useSendStore } from '../../stores/sendStore';
import { useWalletStore } from '../../stores/walletStore';
import { WalletSyncManager } from '../../services/sync/WalletSyncManager';
import { SensitiveSession } from '../../services/auth/SensitiveSession';

const STAGES = [
  { label: 'Signing transaction...', icon: 'key-outline' },
  { label: 'Broadcasting to network...', icon: 'radio-outline' },
  { label: 'Broadcast complete', icon: 'checkmark-circle-outline' },
] as const;

const ERROR_STAGE = { label: 'Transaction failed', icon: 'close-circle-outline' } as const;
const SYNCING_STAGE = { label: 'Updating wallet...', icon: 'sync-outline' } as const;

interface StepBroadcastingProps {
  onGoHome?: () => void;
}

export function StepBroadcasting({ onGoHome }: StepBroadcastingProps) {
  const { colors } = useTheme();

  // Read real state from sendStore
  const isBroadcasting = useSendStore((s) => s.isBroadcasting);
  const signedTx = useSendStore((s) => s.signedTx);
  const broadcastTxid = useSendStore((s) => s.broadcastTxid);
  const error = useSendStore((s) => s.error);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const hasSyncedRef = useRef(false);

  // Derive stage from actual store state
  const stageIndex = useMemo(() => {
    if (error) return -1; // Error state
    if (broadcastTxid) return 2; // Broadcast complete
    if (signedTx) return 1; // Signed, broadcasting
    return 0; // Signing
  }, [error, broadcastTxid, signedTx]);

  // Auto-sync wallet when error is detected
  useEffect(() => {
    if (!error || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    const walletId = useWalletStore.getState().walletId;
    if (!walletId) {
      setSyncDone(true);
      return;
    }

    setIsSyncing(true);

    // Race: sync vs 10s timeout
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    const sync = WalletSyncManager.shared().refreshWallet(walletId).catch(() => {});

    Promise.race([sync, timeout]).then(() => {
      setIsSyncing(false);
      setSyncDone(true);
    });
  }, [error]);

  // Retry handler — re-sign and re-broadcast with cached PIN
  const handleRetry = useCallback(async () => {
    const pin = SensitiveSession.getPin();
    if (!pin) {
      // PIN expired — go home, user will need to re-enter PIN
      onGoHome?.();
      return;
    }

    setIsRetrying(true);
    hasSyncedRef.current = false;
    setSyncDone(false);

    // Clear previous error
    useSendStore.setState({ error: null, errorLevel: null });

    try {
      const { signAndBroadcast } = useSendStore.getState();
      await signAndBroadcast(pin);
      // Success — send-pin's .then() handler will navigate to success
      // But since we're already on broadcasting, let the router in send-broadcasting handle it
    } catch {
      // Error is set in store — useEffect above will trigger sync again
    } finally {
      setIsRetrying(false);
    }
  }, [onGoHome]);

  // Pulse animation
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const isError = stageIndex === -1 && !isRetrying;
  const showButtons = isError && syncDone && !isRetrying;

  // Pick display stage
  let stage: { label: string; icon: string };
  if (isRetrying) {
    stage = STAGES[0]; // Show "Signing transaction..." during retry
  } else if (isError && isSyncing) {
    stage = SYNCING_STAGE;
  } else if (isError) {
    stage = ERROR_STAGE;
  } else {
    stage = (stageIndex >= 0 ? STAGES[stageIndex as 0 | 1 | 2] : undefined) ?? STAGES[0];
  }

  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
      {/* Pulsing icon */}
      <Animated.View style={[styles.iconContainer, pulseStyle]}>
        <View style={[styles.iconCircle, { backgroundColor: isError ? colors.errorMuted || 'rgba(255,59,48,0.12)' : colors.fillSecondary }]}>
          <Ionicons
            name={stage.icon as any}
            size={48}
            color={isError ? '#FF3B30' : THEME.brand.bitcoin}
          />
        </View>
      </Animated.View>

      {/* Stage label */}
      <Animated.Text
        entering={FadeInUp.duration(300)}
        key={`${isError}-${isSyncing}-${isRetrying}-${stageIndex}`}
        style={[styles.stageLabel, { color: isError ? '#FF3B30' : colors.text }]}
      >
        {stage.label}
      </Animated.Text>

      {/* Error message */}
      {isError && error && !isSyncing && (
        <Animated.Text
          entering={FadeInUp.delay(100).duration(300)}
          style={[styles.errorMessage, { color: colors.textMuted }]}
          numberOfLines={3}
        >
          {error}
        </Animated.Text>
      )}

      {/* Syncing status */}
      {isError && isSyncing && (
        <Animated.Text
          entering={FadeInUp.delay(100).duration(300)}
          style={[styles.errorMessage, { color: colors.textMuted }]}
        >
          Refreshing balances and UTXOs...
        </Animated.Text>
      )}

      {/* Progress dots — only when actively broadcasting */}
      {!isError && !isRetrying && (
        <View style={styles.dotsRow}>
          {STAGES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                {
                  backgroundColor: i <= stageIndex
                    ? THEME.brand.bitcoin
                    : colors.fillTertiary,
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* Action buttons — shown after sync completes on error */}
      {showButtons && (
        <Animated.View entering={FadeInUp.delay(200).duration(300)} style={styles.buttonsContainer}>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.text }]}
            onPress={handleRetry}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={18} color={colors.background} />
            <Text style={[styles.retryButtonText, { color: colors.background }]}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.homeButton, { backgroundColor: colors.fillSecondary }]}
            onPress={onGoHome}
            activeOpacity={0.7}
          >
            <Ionicons name="home-outline" size={16} color={colors.text} />
            <Text style={[styles.homeButtonText, { color: colors.text }]}>Go Home</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Hint */}
      {!showButtons && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {isError && isSyncing
            ? 'Syncing wallet data...'
            : isError
              ? 'Preparing to retry...'
              : 'Please wait \u2014 do not close the app'}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
  iconContainer: {
    marginBottom: 8,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageLabel: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    marginTop: -8,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  buttonsContainer: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  retryButton: {
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  homeButton: {
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  homeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    fontSize: 14,
    marginTop: 16,
  },
});
