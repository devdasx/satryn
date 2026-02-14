import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PinCodeScreen } from '../../src/components/security';
import { useTheme, useHaptics } from '../../src/hooks';
import { useMultiWalletStore, useSettingsStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import type { BackupStatusInfo } from '../../src/stores/settingsStore';

const DEFAULT_BACKUP_STATUS: BackupStatusInfo = { isBackedUp: false, method: null, lastBackupDate: null };

export default function BackupFlowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const { activeWalletId } = useMultiWalletStore();
  const wallets = useMultiWalletStore((s: any) => s.wallets);
  const activeWallet = wallets.find((w: any) => w.id === activeWalletId);
  const walletType = activeWallet?.type || 'hd';
  const isWatchOnly = walletType.startsWith('watch_');
  const isMultisig = walletType === 'multisig';

  const backupStatus: BackupStatusInfo = useSettingsStore(
    s => s.backupStatus[activeWalletId || ''] || DEFAULT_BACKUP_STATUS
  );

  // Auth gating — show PIN if no active session
  const [authenticated, setAuthenticated] = useState(SensitiveSession.isActive());

  useEffect(() => {
    if (authenticated) return;
    // Try silent biometric auth on mount
    (async () => {
      const pin = await SensitiveSession.ensureAuth();
      if (pin) setAuthenticated(true);
    })();
  }, []);

  // ─── PIN callbacks ───────────────────────────────────────────

  const handleVerify = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const valid = await SecureStorage.verifyPin(pin);
    if (valid) {
      SensitiveSession.start(pin);
      return { success: true };
    }
    return { success: false, error: 'Incorrect PIN' };
  }, []);

  const handleVerifySuccess = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const handleBiometricSuccess = useCallback(async (): Promise<{ success: boolean; pin?: string }> => {
    const pin = await SecureStorage.getPinForBiometrics();
    if (pin) {
      const valid = await SecureStorage.verifyPin(pin);
      if (valid) {
        SensitiveSession.start(pin);
        return { success: true, pin };
      }
    }
    return { success: false };
  }, []);

  // ─── PIN screen ──────────────────────────────────────────────

  if (!authenticated) {
    return (
      <PinCodeScreen
        mode="verify"
        title="Verify Identity"
        subtitle="Enter your PIN to access backup options"
        icon="shield"
        iconColor={colors.text}
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── Navigation handlers ─────────────────────────────────────

  const handleManualBackup = () => {
    haptics.trigger('selection');
    router.push('/(auth)/backup-manual' as any);
  };

  const handleICloudBackup = () => {
    haptics.trigger('selection');
    router.push('/(auth)/backup-icloud' as any);
  };

  const handleExport = () => {
    haptics.trigger('selection');
    router.push('/(auth)/backup-export' as any);
  };

  // ─── Determine which cards to show ───────────────────────────

  const showManualCard = walletType === 'hd';
  const showExportCard = isWatchOnly || isMultisig;
  const exportLabel = isMultisig ? 'Export keys' : 'Export config';
  const exportDescription = isMultisig
    ? 'View and share your multisig descriptor and cosigner data'
    : 'View and share your wallet configuration';

  // ─── Render ──────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Back up wallet</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subtitle */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Choose how you want to back up. You can change this later.
          </Text>
        </Animated.View>

        {/* Backup status indicator */}
        {backupStatus.isBackedUp && (
          <Animated.View
            entering={FadeInDown.delay(150).duration(500)}
            style={[styles.statusCard, { backgroundColor: isDark ? 'rgba(48,209,88,0.08)' : 'rgba(48,209,88,0.06)' }]}
          >
            <Ionicons name="checkmark-circle" size={20} color="#30D158" />
            <View style={styles.statusContent}>
              <Text style={[styles.statusTitle, { color: colors.text }]}>
                Backed up ({backupStatus.method === 'icloud' ? 'iCloud' : 'Manual'})
              </Text>
              {backupStatus.lastBackupDate && (
                <Text style={[styles.statusDate, { color: colors.textMuted }]}>
                  {new Date(backupStatus.lastBackupDate).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </Text>
              )}
            </View>
          </Animated.View>
        )}

        {/* Manual Backup Hero Card (HD wallets only) */}
        {showManualCard && (
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <TouchableOpacity
              style={[styles.heroCard, { backgroundColor: colors.surface }]}
              onPress={handleManualBackup}
              activeOpacity={0.7}
            >
              <View style={[styles.heroIconContainer, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
                <Ionicons name="shield-checkmark" size={28} color="#30D158" />
              </View>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Manual backup</Text>
              <Text style={[styles.heroDescription, { color: colors.textSecondary }]}>
                Write down your recovery phrase and verify it
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Export Card (watch-only / multisig) */}
        {showExportCard && (
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <TouchableOpacity
              style={[styles.heroCard, { backgroundColor: colors.surface }]}
              onPress={handleExport}
              activeOpacity={0.7}
            >
              <View style={[styles.heroIconContainer, { backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)' }]}>
                <Ionicons name="document-text-outline" size={28} color="#FF9F0A" />
              </View>
              <Text style={[styles.heroTitle, { color: colors.text }]}>{exportLabel}</Text>
              <Text style={[styles.heroDescription, { color: colors.textSecondary }]}>
                {exportDescription}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* iCloud Backup Hero Card (all wallet types) */}
        <Animated.View entering={FadeInDown.delay(showManualCard || showExportCard ? 350 : 200).duration(500)}>
          <TouchableOpacity
            style={[styles.heroCard, { backgroundColor: colors.surface }]}
            onPress={handleICloudBackup}
            activeOpacity={0.7}
          >
            <View style={[styles.heroIconContainer, { backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)' }]}>
              <Ionicons name="cloud-upload" size={28} color="#007AFF" />
            </View>
            <Text style={[styles.heroTitle, { color: colors.text }]}>iCloud backup</Text>
            <Text style={[styles.heroDescription, { color: colors.textSecondary }]}>
              {isWatchOnly
                ? 'Store wallet configuration in iCloud'
                : 'Encrypt and store in iCloud with a password'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Safety note */}
        <Animated.View entering={FadeInDown.delay(450).duration(500)} style={styles.safetyNote}>
          <Ionicons name="shield-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.safetyNoteText, { color: colors.textMuted }]}>
            Backups contain sensitive data. Keep it private.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 12,
    marginBottom: 20,
  },
  statusContent: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  statusDate: {
    fontSize: 12,
    marginTop: 2,
  },

  // Hero cards
  heroCard: {
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
    alignItems: 'center',
  },
  heroIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  heroDescription: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 260,
  },

  // Safety note
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  safetyNoteText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
