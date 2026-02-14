/**
 * RestorationProgressSheet — Step-based restoration progress visualization
 *
 * Shows real-time progress while restoring preserved wallet data from the
 * iOS Keychain after a reinstall. Modeled after ConnectionProgressSheet.
 *
 * 5 Steps:
 *   1. Preparing restore      → Brief animated step
 *   2. Decrypting wallet data → PreservedArchiveService.restoreFullState(password)
 *   3. Restoring wallets      → Re-register wallets & apply snapshots
 *   4. Restoring settings     → Apply settings/contacts from payload
 *   5. Complete!              → Success state, haptics, auto-dismiss
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme, useHaptics } from '../../hooks';
import { THEME } from '../../constants';
import * as SecureStore from 'expo-secure-store';
import { PreservedArchiveService } from '../../services/storage/PreservedArchiveService';
import type { PreservedFullState } from '../../services/storage/PreservedArchiveService';
import { AppStateManager, type ExpandedFullBackupPayload } from '../../services/AppStateManager';
import { BackupService, type BackupPayload } from '../../services/backup/BackupService';
import { useMultiWalletStore } from '../../stores/multiWalletStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useContactStore } from '../../stores/contactStore';
import { useTransactionLabelStore } from '../../stores/transactionLabelStore';
import { useUTXOStore } from '../../stores/utxoStore';
import { useServerStore } from '../../stores/serverStore';
import { useAddressBookStore } from '../../stores/addressBookStore';
import { WalletDatabase } from '../../services/database';

// ─── Types ──────────────────────────────────────────────────────

interface RestorationProgressSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
  onRetry: () => void;
  pin: string;
}

type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StepConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const STEPS: StepConfig[] = [
  { label: 'Preparing restore', icon: 'shield-checkmark-outline' },
  { label: 'Decrypting wallet data', icon: 'lock-open-outline' },
  { label: 'Restoring wallets', icon: 'wallet-outline' },
  { label: 'Restoring settings', icon: 'settings-outline' },
  { label: 'Complete', icon: 'checkmark-circle' },
];

const MIN_STEP_DURATION = 400;
const SUCCESS_DISMISS_DELAY = 1200;

// ─── Animated Step Row ──────────────────────────────────────────

function AnimatedStepRow({
  step,
  index,
  status,
  isDark,
  colors,
}: {
  step: StepConfig;
  index: number;
  status: StepStatus;
  isDark: boolean;
  colors: { text: string; textMuted: string };
}) {
  const pulseOpacity = useSharedValue(1);
  const checkScale = useSharedValue(0);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      checkScale.value = 0;
    } else if (status === 'completed') {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      checkScale.value = withSpring(1, { damping: 12 });
    } else if (status === 'failed') {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      shakeX.value = withSequence(
        withTiming(-4, { duration: 50 }),
        withTiming(4, { duration: 50 }),
        withTiming(-4, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = 1;
      checkScale.value = 0;
    }

    return () => {
      cancelAnimation(pulseOpacity);
    };
  }, [status]);

  const animatedPulse = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const animatedCheck = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const animatedShake = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const circleColor =
    status === 'completed'
      ? '#30D158'
      : status === 'failed'
      ? '#FF453A'
      : status === 'active'
      ? (isDark ? '#FFFFFF' : '#000000')
      : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)');

  const circleBg =
    status === 'completed'
      ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
      : status === 'failed'
      ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
      : status === 'active'
      ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
      : 'transparent';

  const labelColor =
    status === 'completed'
      ? '#30D158'
      : status === 'failed'
      ? '#FF453A'
      : status === 'active'
      ? colors.text
      : colors.textMuted;

  return (
    <Animated.View style={[styles.stepRow, animatedShake]}>
      <Animated.View
        style={[
          styles.stepCircle,
          { backgroundColor: circleBg, borderColor: circleColor },
          status === 'active' && animatedPulse,
        ]}
      >
        {status === 'completed' ? (
          <Animated.View style={animatedCheck}>
            <Ionicons name="checkmark" size={16} color="#30D158" />
          </Animated.View>
        ) : status === 'failed' ? (
          <Ionicons name="close" size={16} color="#FF453A" />
        ) : status === 'active' ? (
          <ActivityIndicator size={14} color={isDark ? '#FFFFFF' : '#000000'} />
        ) : (
          <Text style={[styles.stepNumber, {
            color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
          }]}>
            {index + 1}
          </Text>
        )}
      </Animated.View>

      <Text style={[styles.stepLabel, { color: labelColor }]}>
        {status === 'active' ? `${step.label}...` : step.label}
      </Text>

      {status === 'active' && (
        <Animated.View style={[styles.stepActiveIndicator, animatedPulse]}>
          <View style={[styles.stepActiveDot, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.20)',
          }]} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function RestorationProgressSheet({
  visible,
  onClose,
  onComplete,
  onRetry,
  pin,
}: RestorationProgressSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    STEPS.map(() => 'pending'),
  );
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const isRunning = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to update a single step status
  const setStep = useCallback((index: number, status: StepStatus) => {
    setStepStatuses(prev => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  }, []);

  // Helper to wait minimum duration
  const waitMin = (startMs: number, minMs: number) => {
    const elapsed = Date.now() - startMs;
    const remaining = Math.max(0, minMs - elapsed);
    return new Promise(resolve => setTimeout(resolve, remaining));
  };

  // Run the restoration pipeline
  const runRestore = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;
    try {
      // Step 1: Preparing restore
      let stepStart = Date.now();
      setStep(0, 'active');
      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(0, 'completed');

      // Step 2: Decrypt wallet data (password verified implicitly via decryption)
      stepStart = Date.now();
      setStep(1, 'active');
      const restoredState = await PreservedArchiveService.restoreFullState(pin);
      await waitMin(stepStart, 600);

      if (!restoredState) {
        setStep(1, 'failed');
        setFailed(true);
        setErrorMessage('Failed to decrypt preserved data. Wrong password or corrupted data.');
        haptics.trigger('error');
        isRunning.current = false;
        return;
      }
      setStep(1, 'completed');

      // Step 3: Restore wallets — re-register & apply snapshots
      stepStart = Date.now();
      setStep(2, 'active');

      const restoredWalletIds: string[] = [];
      for (const snapshot of restoredState.walletSnapshots) {
        try {
          // Re-register wallet in multiWalletStore
          const walletInfo = await useMultiWalletStore.getState().addWallet({
            id: snapshot.walletId,
            name: snapshot.name,
            type: snapshot.walletType as any,
          });
          if (walletInfo) {
            restoredWalletIds.push(walletInfo.id);
          }
        } catch (error) {
          // Failed to re-register wallet
        }
      }

      // Apply canonical snapshots directly to the SQLite database
      const { CanonicalSnapshotBuilder } = require('../../services/storage/CanonicalSnapshotBuilder');

      for (const snapshot of restoredState.walletSnapshots) {
        try {
          CanonicalSnapshotBuilder.applyToDatabase(snapshot);
        } catch (error) {
          // Failed to apply snapshot
        }
      }

      await waitMin(stepStart, 600);
      setStep(2, 'completed');

      // Step 4: Restore settings
      stepStart = Date.now();
      setStep(3, 'active');

      if (restoredState.settings) {
        const { settings, contacts, transactionLabels, utxoMetadata } = restoredState.settings;

        // Restore settings
        if (settings) {
          const store = useSettingsStore.getState();
          if (settings.denomination) {
            // Map legacy denomination values
            const denomMap: Record<string, string> = { sats: 'sat', fiat: 'sat' };
            const mapped = denomMap[settings.denomination] || settings.denomination;
            const validUnits = ['btc', 'mbtc', 'ubtc', 'sat', 'cbtc', 'dbtc'];
            if (validUnits.includes(mapped)) store.setDenomination(mapped as any);
          }
          if (settings.currency) store.setCurrency(settings.currency);
          if (settings.theme) store.setTheme(settings.theme);
          if (settings.feePreference) store.setFeePreference(settings.feePreference as any);
          if (settings.customFeeRate !== undefined) store.setCustomFeeRate(settings.customFeeRate);
          if (settings.customElectrumServer !== undefined) store.setCustomElectrumServer(settings.customElectrumServer);
          if (settings.useCustomElectrum !== undefined) store.setUseCustomElectrum(settings.useCustomElectrum);
          if (settings.defaultCurrencyDisplay) store.setDefaultCurrencyDisplay(settings.defaultCurrencyDisplay as any);
          if (settings.gapLimit !== undefined) store.setGapLimit(settings.gapLimit);
          if (settings.walletMode) store.setWalletMode(settings.walletMode as any);
          if (settings.walletName) store.setWalletName(settings.walletName);
          if (settings.hapticsEnabled !== undefined) store.setHapticsEnabled(settings.hapticsEnabled);
          if (settings.biometricsEnabled !== undefined) store.setBiometricsEnabled(settings.biometricsEnabled);
          if (settings.autoLockTimeout !== undefined) store.setAutoLockTimeout(settings.autoLockTimeout);
          // Re-enable preserve data on delete
          store.setPreserveDataOnDelete(true);
          // Restore extended settings
          if (settings.iCloudBackupEnabled !== undefined) store.setICloudBackupEnabled(settings.iCloudBackupEnabled);
          if (settings.autoBackupEnabled !== undefined) store.setAutoBackupEnabled(settings.autoBackupEnabled);
          if (settings.analyticsEnabled !== undefined) store.setAnalyticsEnabled(settings.analyticsEnabled);
          if (settings.inAppAlertsEnabled !== undefined) store.setInAppAlertsEnabled(settings.inAppAlertsEnabled);
          if (settings.nearbyNickname) store.setNearbyNickname(settings.nearbyNickname);
          if (settings.maxFeeRateSatPerVb !== undefined) store.setMaxFeeRateSatPerVb(settings.maxFeeRateSatPerVb);
          if (settings.maxFeeTotalSats !== undefined) store.setMaxFeeTotalSats(settings.maxFeeTotalSats);
          if (settings.feeCapRequireConfirmation !== undefined) store.setFeeCapRequireConfirmation(settings.feeCapRequireConfirmation);
          if (settings.defaultFeeTier) store.setDefaultFeeTier(settings.defaultFeeTier as any);
          if (settings.rememberLastFeeTier !== undefined) store.setRememberLastFeeTier(settings.rememberLastFeeTier);
          if (settings.defaultCustomFeeRate !== undefined) store.setDefaultCustomFeeRate(settings.defaultCustomFeeRate);
          if (settings.privacyModeDefault !== undefined) store.setPrivacyModeDefault(settings.privacyModeDefault);
          if (settings.avoidConsolidation !== undefined) store.setAvoidConsolidation(settings.avoidConsolidation);
          if (settings.preferSingleInput !== undefined) store.setPreferSingleInput(settings.preferSingleInput);
          if (settings.avoidUnconfirmedDefault) store.setAvoidUnconfirmedDefault(settings.avoidUnconfirmedDefault as any);
          if (settings.largeAmountWarningPct !== undefined) store.setLargeAmountWarningPct(settings.largeAmountWarningPct);
          if (settings.largeAmountConfirmPct !== undefined) store.setLargeAmountConfirmPct(settings.largeAmountConfirmPct);
          if (settings.tagPresets) store.setTagPresets(settings.tagPresets);
        }

        // Restore contacts
        if (contacts && contacts.length > 0) {
          useContactStore.getState().importContacts(contacts);
        }

        // Restore tx labels
        if (transactionLabels && Object.keys(transactionLabels).length > 0) {
          useTransactionLabelStore.setState({ labels: transactionLabels as Record<string, any> });
        }

        // Restore UTXO metadata
        if (utxoMetadata && Object.keys(utxoMetadata).length > 0) {
          useUTXOStore.setState({ utxoMetadata: utxoMetadata as Record<string, any> });
        }

        // Restore recent recipients (v2.2+)
        const recentRecipients = restoredState.settings?.recentRecipients;
        if (recentRecipients && recentRecipients.length > 0) {
          try {
            const db = WalletDatabase.shared();
            for (const r of recentRecipients) {
              db.upsertRecipient({
                address: r.address,
                contactId: r.contactId,
                label: r.label,
                firstUsed: r.firstUsed,
                lastUsed: r.lastUsed,
                useCount: r.useCount,
              });
            }
          } catch {}
        }

        // Restore saved servers — favorites, notes, user-added (v2.2+)
        const savedServers = restoredState.settings?.savedServers;
        if (savedServers && savedServers.length > 0) {
          try {
            const db = WalletDatabase.shared();
            const now = Date.now();
            for (const s of savedServers) {
              db.upsertSavedServer({
                id: s.isUserAdded ? `user_${now}_${Math.random().toString(36).slice(2, 10)}` : `restored_${s.host}_${s.port}`,
                host: s.host,
                port: s.port,
                ssl: s.ssl ? 1 : 0,
                isBuiltIn: 0,
                isUserAdded: s.isUserAdded ? 1 : 0,
                isFavorite: s.isFavorite ? 1 : 0,
                notes: s.notes,
                label: s.label,
                createdAt: now,
                updatedAt: now,
              });
            }
            // Reload server store so UI reflects restored servers
            useServerStore.getState().loadServers();
          } catch {}
        }

        // Restore active server config (v2.2+)
        const activeServerConfig = restoredState.settings?.activeServer;
        if (activeServerConfig) {
          useServerStore.getState().setActiveServer(activeServerConfig);
        }

        // Restore address book entries (v2.2+)
        const addressBook = restoredState.settings?.addressBook;
        if (addressBook && addressBook.length > 0) {
          const store = useAddressBookStore.getState();
          for (const entry of addressBook) {
            store.addEntry(entry.address, entry.label, entry.note);
          }
        }
      }

      await waitMin(stepStart, MIN_STEP_DURATION);
      setStep(3, 'completed');

      // Step 5: Complete
      setStep(4, 'completed');
      setCompleted(true);

      // Set first restored wallet as active
      if (restoredWalletIds.length > 0) {
        await useMultiWalletStore.getState().setActiveWallet(restoredWalletIds[0]);
      }

      // Mark recovery as dismissed so the sheet doesn't reappear
      try {
        await SecureStore.setItemAsync('preserved_recovery_dismissed', 'true', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } catch (e) {
        // Failed to mark recovery dismissed
      }

      haptics.trigger('success');

      // Auto-dismiss after delay
      dismissTimer.current = setTimeout(() => {
        onComplete();
      }, SUCCESS_DISMISS_DELAY);
    } catch (error) {
      // Restore failed
      setFailed(true);
      setErrorMessage('An unexpected error occurred during restoration.');
      haptics.trigger('error');
    } finally {
      isRunning.current = false;
    }
  }, [pin, setStep, haptics, onComplete]);

  // Start restoration when visible
  useEffect(() => {
    if (visible && !isRunning.current && !completed && !failed) {
      // Reset state
      setStepStatuses(STEPS.map(() => 'pending'));
      setFailed(false);
      setErrorMessage(null);
      setCompleted(false);

      // Slight delay to let the sheet animate in
      const timer = setTimeout(() => runRestore(), 300);
      return () => clearTimeout(timer);
    }

    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [visible]);

  const handleRetry = () => {
    // Close this sheet and re-open the password input so the user can
    // enter the correct password rather than retrying the same one.
    setStepStatuses(STEPS.map(() => 'pending'));
    setFailed(false);
    setErrorMessage(null);
    setCompleted(false);
    isRunning.current = false;
    onRetry();
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing="auto"
      dismissible={false}
    >
      <View style={styles.container}>
        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>
          {completed ? 'Restoration Complete' : failed ? 'Restoration Failed' : 'Restoring Your Data'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {completed
            ? 'All your data has been recovered'
            : failed
            ? 'Something went wrong'
            : 'Please wait while we recover everything'
          }
        </Text>

        {/* Steps */}
        <View style={[styles.stepsContainer, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
          borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        }]}>
          {STEPS.map((step, index) => (
            <AnimatedStepRow
              key={index}
              step={step}
              index={index}
              status={stepStatuses[index]}
              isDark={isDark}
              colors={colors}
            />
          ))}
        </View>

        {/* Error card */}
        {failed && errorMessage && (
          <View style={[styles.errorCard, {
            backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.05)',
            borderColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
          }]}>
            <Ionicons name="alert-circle" size={16} color="#FF453A" style={{ marginRight: 8 }} />
            <Text style={[styles.errorText, { color: '#FF453A' }]}>
              {errorMessage}
            </Text>
          </View>
        )}

        {/* Retry / Close buttons */}
        {failed && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={handleRetry}
              activeOpacity={0.7}
              style={[styles.retryButton, {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              }]}
            >
              <Text style={[styles.retryButtonText, {
                color: '#FFFFFF',
              }]}>
                Try Again
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={styles.cancelButton}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },

  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 20,
  },

  stepsContainer: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    marginBottom: 16,
  },

  // Step row
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  stepActiveIndicator: {
    marginLeft: 8,
  },
  stepActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },

  // Buttons
  buttonRow: {
    gap: 8,
  },
  retryButton: {
    height: 50,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cancelButton: {
    height: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
