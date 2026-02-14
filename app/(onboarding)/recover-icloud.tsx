import '../../shim';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME, getThemeColors } from '../../src/constants';
import { useSettingsStore } from '../../src/stores';
import { resolveThemeMode } from '../../src/hooks';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import {
  BackupService,
  ICloudService,
  type BackupListItem,
  type FullBackupListItem,
} from '../../src/services/backup';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer } from '../../src/services/auth/SecureSessionTransfer';
import { getDeviceId } from '../../src/services/DeviceIdentity';

type Step = 'loading' | 'list' | 'password' | 'error';
type SheetState = 'idle' | 'restoring' | 'success' | 'error';
type RestoreStep = 'reading' | 'decrypting' | 'preparing' | 'done';

export default function RecoverICloudScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();
  const { theme } = useSettingsStore();
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const [step, setStep] = useState<Step>('loading');
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [fullBackups, setFullBackups] = useState<FullBackupListItem[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<BackupListItem | null>(null);
  const [selectedFullBackup, setSelectedFullBackup] = useState<FullBackupListItem | null>(null);
  const [isFullRestore, setIsFullRestore] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Bottom sheet state
  const [sheetState, setSheetState] = useState<SheetState>('idle');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoredPayload, setRestoredPayload] = useState<any>(null);
  const [restoreStep, setRestoreStep] = useState<RestoreStep>('reading');
  const [restoredWalletCount, setRestoredWalletCount] = useState(0);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setStep('loading');
    try {
      if (!ICloudService.isAvailable()) {
        setErrorMessage('iCloud is not available. Please sign in to iCloud in Settings and try again.');
        setStep('error');
        return;
      }

      const deviceId = await getDeviceId();
      const items = ICloudService.listBackups(deviceId);
      const fullItems = ICloudService.listFullBackups(deviceId);
      setBackups(items);
      setFullBackups(fullItems);
      setStep('list');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to access iCloud.');
      setStep('error');
    }
  };

  const handleSelectBackup = (item: BackupListItem) => {
    setSelectedBackup(item);
    setSelectedFullBackup(null);
    setIsFullRestore(false);
    const needsPw = BackupService.requiresPassword(item.metadata.walletType);
    if (needsPw) {
      setPassword('');
      setPasswordError(null);
      setStep('password');
    } else {
      handleRestore(item, '');
    }
  };

  const handleSelectFullBackup = (item: FullBackupListItem) => {
    setSelectedFullBackup(item);
    setSelectedBackup(null);
    setIsFullRestore(true);
    setPassword('');
    setPasswordError(null);
    setStep('password');
  };

  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 50));

  const handleRestore = async (backup: BackupListItem, pw: string) => {
    setRestoreStep('reading');
    setSheetState('restoring');
    setRestoreError(null);
    setSheetVisible(true);
    setRestoredWalletCount(0);

    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const blob = ICloudService.readBackup(backup.walletId);
      if (!blob) throw new Error('Backup not found in iCloud.');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoreStep('decrypting');
      await yieldToUI();
      const payload = await BackupService.decryptBackup(blob, pw);
      if (!payload) {
        setRestoreError('Incorrect password. Please check your password and try again.');
        setSheetState('error');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoreStep('preparing');
      await yieldToUI();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoredPayload(payload);
      setRestoredWalletCount(1);
      setRestoreStep('done');
      setSheetState('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      setRestoreError(error?.message || 'Failed to restore backup.');
      setSheetState('error');
    }
  };

  const handleFullRestore = async (fullBackup: FullBackupListItem, pw: string) => {
    setRestoreStep('reading');
    setSheetState('restoring');
    setRestoreError(null);
    setSheetVisible(true);
    setRestoredWalletCount(0);

    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const blob = ICloudService.readFullBackup(fullBackup.backupId);
      if (!blob) throw new Error('Full backup not found in iCloud.');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoreStep('decrypting');
      await yieldToUI();
      const payload = await BackupService.decryptFullBackup(blob, pw);
      if (!payload) {
        setRestoreError('Incorrect password. Please check your password and try again.');
        setSheetState('error');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoreStep('preparing');
      await yieldToUI();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setRestoredPayload(payload);
      setRestoredWalletCount(payload.wallets.length);
      setRestoreStep('done');
      setSheetState('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      setRestoreError(error?.message || 'Failed to restore backup.');
      setSheetState('error');
    }
  };

  const handleSheetClose = () => {
    if (sheetState === 'success' && restoredPayload) {
      setSheetVisible(false);
      navigateWithPayload(restoredPayload);
    } else if (sheetState === 'error') {
      setSheetVisible(false);
      setSheetState('idle');
      setStep('list');
    }
  };

  const navigateWithPayload = async (payload: any) => {
    let baseParams: Record<string, string>;

    if (payload.type === 'full_backup') {
      baseParams = {
        restorePayload: JSON.stringify(payload),
        walletName: payload.backupName,
        source: 'icloud_restore',
      };
    } else if (payload.walletType === 'hd' && payload.mnemonic) {
      baseParams = {
        mnemonic: payload.mnemonic,
        passphrase: payload.passphrase || '',
        walletName: payload.walletName,
        source: 'icloud_restore',
      };
    } else {
      baseParams = {
        restorePayload: JSON.stringify(payload),
        walletName: payload.walletName,
        source: 'icloud_restore',
      };
    }

    const cachedPin = await SensitiveSession.ensureAuth();
    if (cachedPin) {
      const token = SecureSessionTransfer.store({
        ...baseParams,
        mnemonic: baseParams.mnemonic || 'icloud_restore_payload',
        pin: cachedPin,
      });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      } as any);
    } else {
      const hasPinSet = await SecureStorage.hasPinSet();
      if (hasPinSet) {
        const token = SecureSessionTransfer.store({
          ...baseParams,
          mnemonic: baseParams.mnemonic || 'icloud_restore_payload',
          verifyOnly: 'true',
        });
        router.replace({
          pathname: '/(onboarding)/pin',
          params: { _sst: token },
        } as any);
      } else {
        const token = SecureSessionTransfer.store({
          ...baseParams,
          mnemonic: baseParams.mnemonic || 'icloud_restore_payload',
        });
        router.replace({
          pathname: '/(onboarding)/pin',
          params: { _sst: token },
        } as any);
      }
    }
  };

  const handleRetryRestore = () => {
    setSheetVisible(false);
    setSheetState('idle');
    setPassword('');
    setPasswordError(null);
    setStep('password');
  };

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

  // ─── Bottom Sheet Content ──────────────────────────────────

  const getRestoreStepLabel = (): string => {
    switch (restoreStep) {
      case 'reading': return 'Reading from iCloud...';
      case 'decrypting': return 'Deriving encryption key...';
      case 'preparing': return isFullRestore ? 'Preparing wallet data...' : 'Preparing wallet data...';
      case 'done': return 'Done';
    }
  };

  const getRestoreStepIndex = (): number => {
    switch (restoreStep) {
      case 'reading': return 0;
      case 'decrypting': return 1;
      case 'preparing': return 2;
      case 'done': return 3;
    }
  };

  const renderSheetContent = () => {
    if (sheetState === 'restoring') {
      const stepIndex = getRestoreStepIndex();
      return (
        <View style={styles.sheetBody}>
          <ActivityIndicator size="large" color={colors.text} style={{ marginBottom: 16 }} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            {isFullRestore ? 'Restoring wallets' : 'Restoring wallet'}
          </Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
            {getRestoreStepLabel()}
          </Text>
          <View style={styles.progressRow}>
            {['Read', 'Decrypt', 'Prepare'].map((label, i) => (
              <View key={label} style={styles.progressItem}>
                <View style={[
                  styles.progressDot,
                  {
                    backgroundColor: i < stepIndex ? '#30D158'
                      : i === stepIndex ? (colors.text)
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
      );
    }

    if (sheetState === 'success') {
      const successTitle = isFullRestore
        ? `${restoredWalletCount} wallet${restoredWalletCount !== 1 ? 's' : ''} restored`
        : 'Wallet restored';
      const successSubtitle = isFullRestore
        ? `Your full backup has been decrypted successfully. Set up your PIN to continue.`
        : `${selectedBackup?.metadata.walletName || 'Wallet'} has been decrypted successfully. Set up your PIN to continue.`;

      return (
        <View style={styles.sheetBody}>
          <View style={[styles.sheetIcon, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
            <Ionicons name="checkmark-circle" size={36} color="#30D158" />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{successTitle}</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
            {successSubtitle}
          </Text>
          <TouchableOpacity
            style={[styles.sheetButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D', marginTop: 20 }]}
            onPress={() => {
              setSheetVisible(false);
              if (restoredPayload) {
                setTimeout(() => navigateWithPayload(restoredPayload), 200);
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetButtonText, { color: '#FFFFFF' }]}>Continue</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (sheetState === 'error') {
      const isWrongPassword = restoreError?.includes('Incorrect password');
      return (
        <View style={styles.sheetBody}>
          <View style={[styles.sheetIcon, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
            <Ionicons name={isWrongPassword ? 'key-outline' : 'cloud-offline'} size={36} color="#FF453A" />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            {isWrongPassword ? 'Wrong password' : 'Restore failed'}
          </Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
            {restoreError || 'Something went wrong. Please try again.'}
          </Text>
          <TouchableOpacity
            style={[styles.sheetButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D', marginTop: 20 }]}
            onPress={handleRetryRestore}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetButtonText, { color: '#FFFFFF' }]}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetSecondaryButton, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', marginTop: 10 }]}
            onPress={() => {
              setSheetVisible(false);
              setSheetState('idle');
              setStep('list');
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.sheetSecondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  // ─── Loading ──────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Restore from iCloud</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Checking iCloud...
          </Text>
        </View>
      </View>
    );
  }

  // ─── Error (iCloud unavailable) ─────────────────────────────

  if (step === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Restore from iCloud</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.centerContent}>
          <View style={[styles.errorIconLarge, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
            <Ionicons name="cloud-offline" size={40} color="#FF453A" />
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Cannot connect</Text>
          <Text style={[styles.errorSubtitle, { color: colors.textSecondary }]}>
            {errorMessage}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={loadBackups}
          >
            <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Password Entry ───────────────────────────────────────

  if (step === 'password' && (selectedBackup || selectedFullBackup)) {
    const passwordTitle = isFullRestore ? 'Enter backup password' : 'Enter password';

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => setStep('list')} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{passwordTitle}</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={[styles.stepInstruction, { color: colors.textSecondary }]}>
              Enter the password you used when creating this backup.
            </Text>
          </Animated.View>

          {/* Info card for selected backup */}
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={[
            styles.selectedCard,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            },
          ]}>
            <View style={[styles.selectedCardIcon, {
              backgroundColor: isFullRestore
                ? (isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)')
                : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            }]}>
              <Ionicons
                name={isFullRestore ? 'cloud' : 'wallet-outline'}
                size={20}
                color={isFullRestore ? '#007AFF' : colors.textSecondary}
              />
            </View>
            <View style={styles.selectedCardContent}>
              <Text style={[styles.selectedCardTitle, { color: colors.text }]}>
                {isFullRestore ? selectedFullBackup!.backupName : selectedBackup!.metadata.walletName}
              </Text>
              <Text style={[styles.selectedCardSub, { color: colors.textMuted }]}>
                {isFullRestore
                  ? `${selectedFullBackup!.walletCount} wallet${selectedFullBackup!.walletCount !== 1 ? 's' : ''} · ${formatDate(selectedFullBackup!.backupDate)}`
                  : `${getWalletTypeBadge(selectedBackup!.metadata.walletType)} · ${formatDate(selectedBackup!.metadata.backupDate)}`
                }
              </Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <PremiumInputCard>
              <PremiumInput
                icon="lock-closed-outline"
                iconColor="#FF9500"
                placeholder="Backup password"
                value={password}
                onChangeText={(t) => { setPassword(t); setPasswordError(null); }}
                secureTextEntry
                autoFocus
                error={!!passwordError}
              />
            </PremiumInputCard>

            {passwordError && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" />
                <Text style={[styles.errorText, { color: '#FF453A' }]}>{passwordError}</Text>
              </Animated.View>
            )}
          </Animated.View>

          <View style={styles.forgotRow}>
            <Ionicons name="help-circle-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.forgotText, { color: colors.textMuted }]}>
              Forgot your password? Use your recovery phrase to import your wallet instead.
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              !password && { opacity: 0.4 },
            ]}
            onPress={() => {
              if (isFullRestore && selectedFullBackup) {
                handleFullRestore(selectedFullBackup, password);
              } else if (selectedBackup) {
                handleRestore(selectedBackup, password);
              }
            }}
            disabled={!password}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Restore</Text>
          </TouchableOpacity>
        </View>

        <AppBottomSheet
          visible={sheetVisible}
          onClose={handleSheetClose}
          dismissible={sheetState !== 'restoring'}
        >
          {renderSheetContent()}
        </AppBottomSheet>
      </View>
    );
  }

  // ─── Backup List (Premium Redesign) ──────────────────────────

  const totalBackups = backups.length + fullBackups.length;
  const hasFullBackups = fullBackups.length > 0;
  const hasIndividualBackups = backups.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Restore from iCloud</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {totalBackups === 0 ? (
          /* ─── Empty State (Premium) ─── */
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.emptyState}>
            <View style={styles.emptyRings}>
              <View style={[styles.emptyRing3, {
                borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }]} />
              <View style={[styles.emptyRing2, {
                borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
              }]} />
              <View style={[styles.emptyIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
              }]}>
                <Ionicons name="cloud-download-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
              </View>
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No backups found</Text>
            <Text style={[styles.emptySubtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
              No wallet backups were found in your iCloud account. Create a new wallet or import using a recovery phrase.
            </Text>
          </Animated.View>
        ) : (
          <>
            {/* ─── Hero Section ─── */}
            <Animated.View entering={FadeInDown.delay(80).duration(500)} style={styles.heroSection}>
              <View style={[styles.heroIconOuter, { backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.04)' }]}>
                <View style={[styles.heroIconInner, { backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)' }]}>
                  <Ionicons name="cloud-download" size={40} color="#007AFF" />
                </View>
              </View>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Restore from iCloud</Text>
              <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
                Select a backup to restore your wallets
              </Text>
            </Animated.View>

            {/* ─── Full Backups Section ─── */}
            {hasFullBackups && (
              <>
                <Animated.View entering={FadeInDown.delay(150).duration(500)}>
                  <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>FULL BACKUPS</Text>
                </Animated.View>
                {fullBackups.map((item, index) => (
                  <Animated.View
                    key={item.backupId}
                    entering={FadeInDown.delay(200 + index * 60).duration(500)}
                  >
                    <TouchableOpacity
                      style={[styles.fullBackupCard, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                        borderWidth: 1,
                        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      }]}
                      onPress={() => handleSelectFullBackup(item)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.fullBackupIcon, { backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)' }]}>
                        <Ionicons name="cloud" size={24} color="#007AFF" />
                      </View>
                      <View style={styles.fullBackupContent}>
                        <View style={styles.fullBackupHeader}>
                          <Text style={[styles.fullBackupName, { color: colors.text }]} numberOfLines={1}>
                            {item.backupName}
                          </Text>
                          <View style={[styles.walletCountBadge, { backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)' }]}>
                            <Ionicons name="wallet" size={10} color="#007AFF" />
                            <Text style={styles.walletCountText}>
                              {item.walletCount}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.fullBackupDate, { color: colors.textMuted }]}>
                          {formatDate(item.backupDate)}
                        </Text>
                        {item.walletNames.length > 0 && (
                          <Text style={[styles.walletNamesPreview, { color: colors.textMuted }]} numberOfLines={1}>
                            {item.walletNames.join(' · ')}
                          </Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Animated.View>
                ))}
              </>
            )}

            {/* ─── Individual Wallets Section ─── */}
            {hasIndividualBackups && (
              <>
                <Animated.View entering={FadeInDown.delay(hasFullBackups ? 300 : 150).duration(500)}>
                  <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                    {hasFullBackups ? 'INDIVIDUAL WALLET BACKUPS' : 'WALLET BACKUPS'}
                  </Text>
                </Animated.View>
                {backups.map((item, index) => (
                  <Animated.View
                    key={item.walletId}
                    entering={FadeInDown.delay((hasFullBackups ? 350 : 200) + index * 50).duration(500)}
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
                      <View style={[styles.backupIconContainer, { backgroundColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.08)' }]}>
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
              </>
            )}

            {/* ─── Info Footer ─── */}
            <Animated.View
              entering={FadeInDown.delay(hasFullBackups ? 450 : 300).duration(500)}
              style={[styles.infoFooter, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                borderWidth: 1,
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}
            >
              <View style={styles.infoFooterRow}>
                <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                <Text style={[styles.infoFooterText, { color: colors.textMuted }]}>
                  Encrypted end-to-end · PIN required to restore
                </Text>
              </View>
            </Animated.View>
          </>
        )}
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
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 15,
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // Hero Section
  heroSection: {
    alignItems: 'center',
    marginBottom: 28,
    paddingTop: 8,
  },
  heroIconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroIconInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },

  // Section Labels
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },

  // Full Backup Cards
  fullBackupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 14,
    marginBottom: 10,
  },
  fullBackupIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullBackupContent: {
    flex: 1,
  },
  fullBackupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  fullBackupName: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  walletCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
  },
  walletCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  fullBackupDate: {
    fontSize: 12,
    marginBottom: 2,
  },
  walletNamesPreview: {
    fontSize: 12,
    marginTop: 1,
  },

  // Individual Backup Cards
  backupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 14,
    marginBottom: 10,
  },
  backupIconContainer: {
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

  // Info Footer
  infoFooter: {
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
  },
  infoFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  infoFooterText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  emptyRings: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  emptyRing3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  emptyRing2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
  },

  // Password Step
  stepInstruction: {
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
  stickyBottom: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  errorIconLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    height: 44,
    paddingHorizontal: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Bottom sheet styles
  sheetBody: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sheetIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  sheetButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  sheetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  sheetSecondaryButton: {
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  sheetSecondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
});
