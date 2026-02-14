/**
 * WalletRestoreSheet — Unified wallet restore component
 *
 * A reusable component for restoring wallets from iCloud backup.
 * Handles the full flow: backup selection → password entry → decryption
 *
 * Usage:
 * ```tsx
 * <WalletRestoreSheet
 *   visible={showRestore}
 *   onClose={() => setShowRestore(false)}
 *   onRestoreComplete={(payload) => console.log('Restored:', payload)}
 * />
 * ```
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';
import {
  BackupService,
  ICloudService,
  type BackupListItem,
  type BackupPayload,
} from '../../services/backup';
import { getDeviceId } from '../../services/DeviceIdentity';
import { AppBottomSheet, SheetPrimaryButton, SheetSectionFooter } from '../ui';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';

export interface WalletRestoreSheetProps {
  /** Whether the sheet is visible */
  visible: boolean;
  /** Called when the sheet should close */
  onClose: () => void;
  /**
   * Called when a wallet is successfully decrypted.
   * The parent component is responsible for the actual restoration logic.
   */
  onRestoreComplete: (payload: BackupPayload, backup: BackupListItem) => void;
  /** Optional: filter to show only specific wallet types */
  walletTypeFilter?: string[];
  /** Optional: title override */
  title?: string;
  /** Optional: subtitle override */
  subtitle?: string;
}

type Step = 'loading' | 'list' | 'password' | 'restoring' | 'success' | 'error';
type RestoreStep = 'reading' | 'decrypting' | 'done';

export function WalletRestoreSheet({
  visible,
  onClose,
  onRestoreComplete,
  walletTypeFilter,
  title = 'Restore from iCloud',
  subtitle,
}: WalletRestoreSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  // State
  const [step, setStep] = useState<Step>('loading');
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<BackupListItem | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoreStep, setRestoreStep] = useState<RestoreStep>('reading');
  const [restoredPayload, setRestoredPayload] = useState<BackupPayload | null>(null);

  // Load backups when sheet becomes visible
  useEffect(() => {
    if (visible) {
      loadBackups();
    } else {
      // Reset state when closing
      setStep('loading');
      setSelectedBackup(null);
      setPassword('');
      setPasswordError(null);
      setErrorMessage(null);
      setRestoredPayload(null);
    }
  }, [visible]);

  const loadBackups = useCallback(async () => {
    setStep('loading');
    try {
      if (!ICloudService.isAvailable()) {
        setErrorMessage('iCloud is not available. Please sign in to iCloud in Settings and try again.');
        setStep('error');
        return;
      }

      const deviceId = await getDeviceId();
      let items = ICloudService.listBackups(deviceId);

      // Apply filter if provided
      if (walletTypeFilter && walletTypeFilter.length > 0) {
        items = items.filter(item => walletTypeFilter.includes(item.metadata.walletType));
      }

      setBackups(items);
      setStep('list');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to access iCloud.');
      setStep('error');
    }
  }, [walletTypeFilter]);

  // ─── Backup Selection ─────────────────────────────────────

  const handleSelectBackup = useCallback((item: BackupListItem) => {
    setSelectedBackup(item);
    const needsPassword = BackupService.requiresPassword(item.metadata.walletType);

    if (needsPassword) {
      setPassword('');
      setPasswordError(null);
      setStep('password');
    } else {
      // Watch-only wallets don't need password
      handleRestore(item, '');
    }
  }, []);

  // ─── Restore ──────────────────────────────────────────────

  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 50));

  const handleRestore = async (backup: BackupListItem, pw: string) => {
    setRestoreStep('reading');
    setStep('restoring');

    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const blob = ICloudService.readBackup(backup.walletId);
      if (!blob) throw new Error('Backup not found in iCloud.');
      await haptics.trigger('light');

      setRestoreStep('decrypting');
      await yieldToUI();
      const payload = await BackupService.decryptBackup(blob, pw);
      if (!payload) {
        setPasswordError('Incorrect password. Please check your password and try again.');
        setStep('password');
        return;
      }
      await haptics.trigger('light');

      setRestoredPayload(payload);
      setRestoreStep('done');
      await haptics.trigger('success');
      setStep('success');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to restore backup.');
      await haptics.trigger('error');
      setStep('error');
    }
  };

  const handleRetryPassword = useCallback(() => {
    setPassword('');
    setPasswordError(null);
    setStep('password');
  }, []);

  const handleComplete = useCallback(() => {
    if (restoredPayload && selectedBackup) {
      onRestoreComplete(restoredPayload, selectedBackup);
    }
    onClose();
  }, [restoredPayload, selectedBackup, onRestoreComplete, onClose]);

  // ─── Helpers ──────────────────────────────────────────────

  const getWalletTypeBadge = (type: string): string => {
    switch (type) {
      case 'hd': return 'HD Wallet';
      case 'multisig': return 'Multisig';
      case 'watch_xpub': return 'Watch-only (xpub)';
      case 'watch_descriptor': return 'Watch-only (descriptor)';
      case 'watch_addresses': return 'Watch-only (addresses)';
      default: return type;
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const getRestoreStepLabel = (): string => {
    switch (restoreStep) {
      case 'reading': return 'Reading from iCloud...';
      case 'decrypting': return 'Deriving encryption key...';
      case 'done': return 'Done';
    }
  };

  const getRestoreStepIndex = (): number => {
    switch (restoreStep) {
      case 'reading': return 0;
      case 'decrypting': return 1;
      case 'done': return 2;
    }
  };

  // ─── Render Content ───────────────────────────────────────

  const renderContent = () => {
    // Loading
    if (step === 'loading') {
      return (
        <View style={styles.sheetContent}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Checking iCloud...
            </Text>
          </View>
        </View>
      );
    }

    // Backup List
    if (step === 'list') {
      if (backups.length === 0) {
        return (
          <View style={styles.sheetContent}>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconOuter, { backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.04)' }]}>
                <View style={[styles.emptyIconInner, { backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)' }]}>
                  <Ionicons name="cloud-download-outline" size={36} color="#007AFF" />
                </View>
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No backups found</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                No wallet backups were found in your iCloud account.
              </Text>
            </View>
          </View>
        );
      }

      return (
        <ScrollView
          style={styles.listContainer}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {backups.map((item, index) => (
            <Animated.View
              key={item.walletId}
              entering={FadeInDown.delay(index * 50).duration(400)}
            >
              <TouchableOpacity
                style={[styles.backupCard, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}
                onPress={() => handleSelectBackup(item)}
                activeOpacity={0.7}
              >
                <View style={[styles.backupIcon, { backgroundColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.08)' }]}>
                  <Ionicons name="shield-checkmark" size={20} color="#FF9F0A" />
                </View>
                <View style={styles.backupContent}>
                  <Text style={[styles.backupName, { color: colors.text }]}>{item.metadata.walletName}</Text>
                  <View style={styles.backupMeta}>
                    <View style={[styles.typeBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Text style={[styles.typeBadgeText, { color: colors.textMuted }]}>
                        {getWalletTypeBadge(item.metadata.walletType)}
                      </Text>
                    </View>
                    <Text style={[styles.backupDate, { color: colors.textMuted }]}>
                      {formatDate(item.metadata.backupDate)}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </Animated.View>
          ))}
        </ScrollView>
      );
    }

    // Password Entry
    if (step === 'password' && selectedBackup) {
      return (
        <View style={styles.sheetContent}>
          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={[styles.instruction, { color: colors.textSecondary }]}>
              Enter the password you used when creating this backup.
            </Text>
          </Animated.View>

          {/* Selected backup info */}
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={[
            styles.selectedCard,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            },
          ]}>
            <View style={[styles.selectedCardIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}>
              <Ionicons name="wallet-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.selectedCardContent}>
              <Text style={[styles.selectedCardTitle, { color: colors.text }]}>
                {selectedBackup.metadata.walletName}
              </Text>
              <Text style={[styles.selectedCardSub, { color: colors.textMuted }]}>
                {getWalletTypeBadge(selectedBackup.metadata.walletType)} · {formatDate(selectedBackup.metadata.backupDate)}
              </Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <PremiumInputCard>
              <PremiumInput
                icon="key"
                iconColor="#FF9F0A"
                placeholder="Backup password"
                value={password}
                onChangeText={(t) => { setPassword(t); setPasswordError(null); }}
                secureTextEntry
                autoFocus
              />
            </PremiumInputCard>

            {passwordError && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" />
                <Text style={styles.errorText}>{passwordError}</Text>
              </Animated.View>
            )}
          </Animated.View>

          <View style={styles.forgotRow}>
            <Ionicons name="help-circle-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.forgotText, { color: colors.textMuted }]}>
              Forgot your password? Use your recovery phrase to import your wallet instead.
            </Text>
          </View>
        </View>
      );
    }

    // Restoring
    if (step === 'restoring') {
      const stepIndex = getRestoreStepIndex();
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color={colors.text} style={{ marginBottom: 16 }} />
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              Restoring wallet
            </Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
              {getRestoreStepLabel()}
            </Text>
            <View style={styles.progressRow}>
              {['Read', 'Decrypt'].map((label, i) => (
                <View key={label} style={styles.progressItem}>
                  <View style={[
                    styles.progressDot,
                    {
                      backgroundColor: i < stepIndex ? '#30D158'
                        : i === stepIndex ? colors.text
                        : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
                    },
                  ]} />
                  <Text style={[styles.progressLabel, { color: i <= stepIndex ? colors.textSecondary : colors.textMuted }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      );
    }

    // Success
    if (step === 'success' && selectedBackup) {
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIcon, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
              <Ionicons name="checkmark-circle" size={36} color="#30D158" />
            </View>
            <Text style={[styles.statusTitle, { color: colors.text }]}>Wallet restored</Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
              {selectedBackup.metadata.walletName} has been decrypted successfully.
            </Text>
          </View>
        </View>
      );
    }

    // Error
    if (step === 'error') {
      const isWrongPassword = errorMessage?.includes('Incorrect password');
      return (
        <View style={styles.sheetContent}>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIcon, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
              <Ionicons name={isWrongPassword ? 'key-outline' : 'cloud-offline'} size={36} color="#FF453A" />
            </View>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              {isWrongPassword ? 'Wrong password' : 'Restore failed'}
            </Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
              {errorMessage || 'Something went wrong. Please try again.'}
            </Text>
          </View>
        </View>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (step === 'list' && backups.length === 0) {
      return (
        <SheetPrimaryButton label="Close" onPress={onClose} />
      );
    }

    if (step === 'password' && selectedBackup) {
      return (
        <SheetPrimaryButton
          label="Restore"
          onPress={() => handleRestore(selectedBackup, password)}
          disabled={!password}
        />
      );
    }

    if (step === 'success') {
      return (
        <SheetPrimaryButton label="Continue" onPress={handleComplete} />
      );
    }

    if (step === 'error') {
      const isWrongPassword = errorMessage?.includes('Incorrect password');
      return (
        <View style={styles.errorButtonsRow}>
          <SheetPrimaryButton
            label={isWrongPassword ? 'Try again' : 'Retry'}
            onPress={isWrongPassword ? handleRetryPassword : loadBackups}
          />
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  const getSheetTitle = () => {
    if (step === 'password') return 'Enter Password';
    if (step === 'restoring') return 'Restoring';
    if (step === 'success') return 'Restore Complete';
    if (step === 'error') return 'Restore Failed';
    return title;
  };

  const getSheetSubtitle = () => {
    if (step === 'password' && selectedBackup) return selectedBackup.metadata.walletName;
    if (step === 'list' && backups.length > 0) return `${backups.length} backup${backups.length !== 1 ? 's' : ''} found`;
    return subtitle;
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={getSheetTitle()}
      subtitle={getSheetSubtitle()}
      sizing={step === 'list' && backups.length > 3 ? 'large' : 'auto'}
      scrollable={step === 'list' && backups.length > 3}
      dismissible={step !== 'restoring'}
      footer={renderFooter()}
    >
      {renderContent()}
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 15,
    marginTop: 16,
  },
  listContainer: {
    maxHeight: 400,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  backupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 14,
    marginBottom: 10,
  },
  backupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupContent: {
    flex: 1,
  },
  backupName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  backupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  backupDate: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyIconOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyIconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  instruction: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    gap: 12,
    marginBottom: 20,
  },
  selectedCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCardContent: {
    flex: 1,
  },
  selectedCardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  selectedCardSub: {
    fontSize: 12,
    marginTop: 2,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#FF453A',
  },
  forgotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 4,
  },
  forgotText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  statusContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  statusSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  progressItem: {
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  errorButtonsRow: {
    gap: 10,
  },
  secondaryButton: {
    height: 45,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default WalletRestoreSheet;
