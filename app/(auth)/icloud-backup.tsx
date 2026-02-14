import '../../shim';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated as RNAnimated } from 'react-native';
import { useSettingsStore, useMultiWalletStore, type ICloudBackupEntry } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import { getColors } from '../../src/constants/colors';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import {
  ICloudService,
  type BackupListItem,
  type FullBackupListItem,
} from '../../src/services/backup';
import {
  AppBottomSheet,
  SheetSectionFooter,
  SheetPrimaryButton,
  PremiumInput,
  PremiumInputCard,
} from '../../src/components/ui';
import { FastSwitch } from '../../src/components/ui/FastSwitch';
import { getDeviceId } from '../../src/services/DeviceIdentity';
import { ICloudBackupCreateSheet } from '../../src/components/backup';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ICloudBackupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors, themeMode } = useTheme();
  const haptics = useHaptics();
  const c = getColors(themeMode);

  const addICloudBackup = useSettingsStore(s => s.addICloudBackup);
  const removeICloudBackup = useSettingsStore(s => s.removeICloudBackup);
  const iCloudBackupHistory = useSettingsStore(s => s.iCloudBackupHistory);
  const autoBackupEnabled = useSettingsStore(s => s.autoBackupEnabled);
  const setAutoBackupEnabled = useSettingsStore(s => s.setAutoBackupEnabled);
  const autoBackupPassword = useSettingsStore(s => s.autoBackupPassword);
  const setAutoBackupPassword = useSettingsStore(s => s.setAutoBackupPassword);
  const lastAutoBackupDate = useSettingsStore(s => s.lastAutoBackupDate);

  const { wallets } = useMultiWalletStore();

  // ─── Backup lists from iCloud KVS ──────────────────────────
  const [fullBackups, setFullBackups] = useState<FullBackupListItem[]>([]);
  const [singleBackups, setSingleBackups] = useState<BackupListItem[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(true);

  // ─── Create backup states ──────────────────────────────────
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [verifiedPin, setVerifiedPin] = useState('');

  // ─── Auto-backup password sheet ──────────────────────────
  const [showAutoBackupPasswordSheet, setShowAutoBackupPasswordSheet] = useState(false);
  const [autoBackupPass, setAutoBackupPass] = useState('');
  const [autoBackupPassConfirm, setAutoBackupPassConfirm] = useState('');
  const [autoBackupPassError, setAutoBackupPassError] = useState<string | null>(null);

  // ─── Deleted IDs tracking (prevents reappearance after stale iCloud reads) ──
  const deletedFullBackupIds = useRef<Set<string>>(new Set());
  const deletedSingleBackupIds = useRef<Set<string>>(new Set());

  // ─── Delete states ─────────────────────────────────────────
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'full'; item: FullBackupListItem } | { type: 'single'; item: BackupListItem } | null>(null);
  // Ref mirror of deleteTarget — survives the bottom sheet onClose clearing state
  const deleteTargetRef = useRef<typeof deleteTarget>(null);

  // ─── How it works sheet ────────────────────────────────────
  const [showHowItWorksSheet, setShowHowItWorksSheet] = useState(false);

  // ─── Manage backup sheet states ─────────────────────────────
  const [showManageSheet, setShowManageSheet] = useState(false);
  const [managedBackup, setManagedBackup] = useState<FullBackupListItem | null>(null);

  // ─── Swipe single-open + auto-close ──────────────────────────
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Swipe hint ──────────────────────────────────────────────
  const SWIPE_HINT_KEY = 'icloud_backup_swipe_hint_dismissed';
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const swipeHintOpacity = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(SWIPE_HINT_KEY).then((val) => {
      if (val !== 'true') {
        setShowSwipeHint(true);
        RNAnimated.timing(swipeHintOpacity, {
          toValue: 1,
          duration: 600,
          delay: 800,
          useNativeDriver: true,
        }).start();
      }
    });
  }, []);

  const dismissSwipeHint = useCallback(() => {
    if (!showSwipeHint) return;
    RNAnimated.timing(swipeHintOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowSwipeHint(false);
    });
    AsyncStorage.setItem(SWIPE_HINT_KEY, 'true');
  }, [showSwipeHint]);

  const handleSwipeableOpen = useCallback((swipeable: Swipeable) => {
    // Close previously open swipeable if different
    if (openSwipeableRef.current && openSwipeableRef.current !== swipeable) {
      openSwipeableRef.current.close();
    }
    openSwipeableRef.current = swipeable;

    // Clear any existing timer
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
    }
    // Auto-close after 10 seconds
    autoCloseTimerRef.current = setTimeout(() => {
      swipeable.close();
      if (openSwipeableRef.current === swipeable) {
        openSwipeableRef.current = null;
      }
      autoCloseTimerRef.current = null;
    }, 10000);

    dismissSwipeHint();
  }, [dismissSwipeHint]);

  const handleSwipeableClose = useCallback((swipeable: Swipeable) => {
    if (openSwipeableRef.current === swipeable) {
      openSwipeableRef.current = null;
    }
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  // Press animation for CTA
  const ctaScale = useSharedValue(1);
  const ctaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ctaScale.value }],
  }));

  // ─── Load backups from iCloud KVS ──────────────────────────
  // Merge iCloud KVS results with locally-persisted iCloudBackupHistory
  // from settingsStore. This ensures recently-created backups always appear
  // even if iCloud KVS hasn't fully synced yet (synchronize() is async/fire-and-forget).
  const loadBackupsFromICloud = useCallback(async () => {
    setIsLoadingBackups(true);
    try {
      const deviceId = await getDeviceId();
      let kvsFulls: FullBackupListItem[] = [];
      let kvsSingles: BackupListItem[] = [];

      if (ICloudService.isAvailable()) {
        kvsFulls = ICloudService.listFullBackups(deviceId)
          .filter(b => !deletedFullBackupIds.current.has(b.backupId));
        kvsSingles = ICloudService.listBackups(deviceId)
          .filter(b => !deletedSingleBackupIds.current.has(b.walletId));
      }

      // Merge: any entry in local iCloudBackupHistory that isn't in KVS results
      // gets added as a FullBackupListItem. This covers the case where KVS
      // hasn't synced yet after writeFullBackup().
      const localHistory = useSettingsStore.getState().iCloudBackupHistory;
      const kvsIds = new Set(kvsFulls.map(b => b.backupId));
      for (const entry of localHistory) {
        if (kvsIds.has(entry.id)) continue; // already present from KVS
        if (deletedFullBackupIds.current.has(entry.id)) continue; // was deleted
        kvsFulls.push({
          backupId: entry.id,
          backupName: entry.name,
          backupDate: entry.timestamp,
          walletCount: entry.walletCount,
          walletNames: entry.walletNames || [],
        });
      }

      // Sort by backup date (newest first)
      kvsFulls.sort((a, b) => b.backupDate - a.backupDate);

      setFullBackups(kvsFulls);
      setSingleBackups(kvsSingles);
    } catch {
      // Silently fail — user will see empty state
    }
    setIsLoadingBackups(false);
  }, []);

  useEffect(() => {
    loadBackupsFromICloud();
  }, [loadBackupsFromICloud]);

  const handleBack = async () => {
    await haptics.trigger('light');
    router.back();
  };

  // ─── Create Backup Flow ──────────────────────────────────────
  const handleCreateBackupPress = async () => {
    await haptics.trigger('selection');
    const pin = await SensitiveSession.ensureAuth();
    if (!pin) {
      await haptics.trigger('error');
      return;
    }
    setVerifiedPin(pin);
    setShowCreateSheet(true);
  };

  const handleBackupComplete = useCallback((entry: ICloudBackupEntry) => {
    // First dismiss the sheet — do NOT clear verifiedPin yet!
    // Clearing verifiedPin unmounts the component before TrueSheet can animate dismiss.
    // The pin will be cleared in the onClose callback once the sheet is fully dismissed.
    setShowCreateSheet(false);
    addICloudBackup(entry);

    // Optimistically add the new backup to the UI state immediately.
    // Reading back from iCloud KVS right after writing can miss the entry
    // because NSUbiquitousKeyValueStore.synchronize() is asynchronous.
    // We do NOT call loadBackupsFromICloud() afterwards — a delayed reload
    // would overwrite this optimistic state with empty results if KVS hasn't
    // synced yet. The next screen visit will refresh from iCloud.
    setFullBackups(prev => {
      // Avoid duplicates if it somehow already appears
      if (prev.some(b => b.backupId === entry.id)) return prev;
      const newItem: FullBackupListItem = {
        backupId: entry.id,
        backupName: entry.name,
        backupDate: entry.timestamp,
        walletCount: entry.walletCount,
        walletNames: entry.walletNames || [],
      };
      return [newItem, ...prev];
    });
  }, [addICloudBackup]);

  // ─── Delete Flow ───────────────────────────────────────────
  const handleDeleteFullBackup = (item: FullBackupListItem) => {
    const target = { type: 'full' as const, item };
    setDeleteTarget(target);
    deleteTargetRef.current = target;
    setShowDeleteSheet(true);
  };

  const handleDeleteSingleBackup = (item: BackupListItem) => {
    const target = { type: 'single' as const, item };
    setDeleteTarget(target);
    deleteTargetRef.current = target;
    setShowDeleteSheet(true);
  };

  const handleDeleteConfirm = async () => {
    setShowDeleteSheet(false);
    await haptics.trigger('medium');

    const currentDeleteTarget = deleteTargetRef.current;
    if (!currentDeleteTarget) return;

    if (__DEV__) ICloudService.debugDumpKeys();

    try {
      if (currentDeleteTarget.type === 'full') {
        const backupId = currentDeleteTarget.item.backupId;
        deletedFullBackupIds.current.add(backupId);
        ICloudService.deleteFullBackup(backupId);
        removeICloudBackup(backupId);
      } else {
        const walletId = currentDeleteTarget.item.walletId;
        deletedSingleBackupIds.current.add(walletId);
        ICloudService.deleteBackup(walletId);
      }

      if (__DEV__) ICloudService.debugDumpKeys();
      await haptics.trigger('success');
    } catch {
      await haptics.trigger('error');
    }

    // Update local state immediately for instant UI feedback
    if (currentDeleteTarget.type === 'full') {
      setFullBackups(prev => prev.filter(b => b.backupId !== currentDeleteTarget.item.backupId));
    } else {
      setSingleBackups(prev => prev.filter(b => b.walletId !== currentDeleteTarget.item.walletId));
    }

    setDeleteTarget(null);
    deleteTargetRef.current = null;

    // Also reload from iCloud to ensure consistency (longer delay to let KVS sync)
    setTimeout(() => {
      if (__DEV__) ICloudService.debugDumpKeys();
      loadBackupsFromICloud();
    }, 1500);
  };

  // ─── Toggle handlers ───────────────────────────────────────
  const handleToggleAutoBackup = async (value: boolean) => {
    if (value) {
      // If enabling, need to set a password first
      if (!autoBackupPassword) {
        setAutoBackupPass('');
        setAutoBackupPassConfirm('');
        setAutoBackupPassError(null);
        setShowAutoBackupPasswordSheet(true);
        return;
      }
      setAutoBackupEnabled(true);
    } else {
      setAutoBackupEnabled(false);
    }
  };

  const handleAutoBackupPasswordConfirm = async () => {
    if (autoBackupPass.length < 6) {
      setAutoBackupPassError('Password must be at least 6 characters');
      return;
    }
    if (autoBackupPass !== autoBackupPassConfirm) {
      setAutoBackupPassError('Passwords do not match');
      return;
    }
    setAutoBackupPassword(autoBackupPass);
    setAutoBackupEnabled(true);
    setShowAutoBackupPasswordSheet(false);
    const password = autoBackupPass;
    setAutoBackupPass('');
    setAutoBackupPassConfirm('');
    haptics.trigger('success');

    // Trigger immediate first backup in background
    const pin = SensitiveSession.getPin();
    if (pin) {
      try {
        const { AutoBackupManager } = require('../../src/services/backup/AutoBackupManager');
        const success = await AutoBackupManager.performImmediate(pin, password);
        if (success) {
          // Refresh the backup list to show the new auto-backup
          loadBackupsFromICloud();
        }
      } catch {
        // Non-critical — the daily trigger will retry
      }
    }
  };

  // ─── Manage Backup Flow ─────────────────────────────────────
  const handleManageBackup = (item: FullBackupListItem) => {
    setManagedBackup(item);
    setShowManageSheet(true);
  };

  // ─── Helpers ─────────────────────────────────────────────────
  const formatFullDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatShortDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getWalletTypeBadge = (type: string): string => {
    switch (type) {
      case 'hd': return 'HD Wallet';
      case 'multisig': return 'Multisig';
      case 'watch_xpub': return 'Watch-only';
      case 'watch_descriptor': return 'Watch-only';
      case 'watch_addresses': return 'Watch-only';
      default: return type;
    }
  };

  // ─── Colors ──────────────────────────────────────────────────
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';

  const totalBackups = fullBackups.length + singleBackups.length;

  const deleteItemName = deleteTarget
    ? deleteTarget.type === 'full'
      ? deleteTarget.item.backupName
      : deleteTarget.item.metadata.walletName
    : '';

  const deleteTypeLabel = deleteTarget?.type === 'full' ? 'full backup' : 'wallet backup';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Animated.Text entering={FadeIn.duration(300)} style={[styles.largeTitle, { color: textPrimary }]}>
          iCloud Backup
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Section ──────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(50).duration(400)} style={styles.heroSection}>
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.10)',
            }]}>
              <Ionicons name="cloud" size={28} color="#007AFF" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>iCloud Backup</Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Encrypted snapshots stored securely in iCloud
          </Text>
          <View style={[styles.statusBadge, {
            backgroundColor: totalBackups > 0
              ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
              : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
          }]}>
            <View style={[styles.statusDot, {
              backgroundColor: totalBackups > 0 ? '#30D158' : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)'),
            }]} />
            <Text style={[styles.statusText, {
              color: totalBackups > 0
                ? (isDark ? 'rgba(48,209,88,0.90)' : 'rgba(48,209,88,0.80)')
                : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'),
            }]}>
              {totalBackups > 0 ? `${totalBackups} Backup${totalBackups !== 1 ? 's' : ''}` : 'No Backups'}
            </Text>
          </View>
        </Animated.View>

        {/* ── Create Backup CTA ────────────────────────────────── */}
        <View style={styles.ctaContainer}>
          <AnimatedPressable
            onPress={handleCreateBackupPress}
            onPressIn={() => { ctaScale.value = withSpring(0.97, { damping: 15, stiffness: 400 }); }}
            onPressOut={() => { ctaScale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
            style={[ctaAnimStyle, styles.ctaButton, {
              backgroundColor: '#007AFF',
            }]}
          >
            <Ionicons name="cloud-upload" size={18} color="#FFFFFF" />
            <Text style={styles.ctaButtonText}>Create New Backup</Text>
          </AnimatedPressable>
          <Text style={[styles.ctaHint, { color: textMuted }]}>
            Encrypt all wallets and save to iCloud
          </Text>
        </View>

        {/* ── Loading State ──────────────────────────────────── */}
        {isLoadingBackups && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={textMuted} />
          </View>
        )}

        {/* ── Swipe Hint Capsule ─────────────────────────────── */}
        {showSwipeHint && !isLoadingBackups && totalBackups > 0 && (
          <RNAnimated.View style={[styles.swipeHintCapsule, {
            opacity: swipeHintOpacity,
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }]}>
            <Ionicons name="arrow-back" size={13} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'} />
            <Text style={[styles.swipeHintText, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
              Swipe left on a backup to delete or manage
            </Text>
          </RNAnimated.View>
        )}

        {/* ── Full Backups Section ───────────────────────────── */}
        {!isLoadingBackups && fullBackups.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>FULL BACKUPS</Text>
            {fullBackups.map((item) => {
              let swipeRef: Swipeable | null = null;
              return (
              <Swipeable
                key={item.backupId}
                ref={(ref) => { swipeRef = ref; }}
                renderRightActions={() => (
                  <View style={styles.swipeActionsRow}>
                    <RectButton
                      onPress={() => handleManageBackup(item)}
                      style={styles.swipeSettingsAction}
                    >
                      <Ionicons name="settings-sharp" size={18} color="#FFFFFF" />
                      <Text style={styles.swipeActionLabel}>Settings</Text>
                    </RectButton>
                    <RectButton
                      onPress={() => handleDeleteFullBackup(item)}
                      style={styles.swipeDeleteBackupAction}
                    >
                      <Ionicons name="trash" size={18} color="#FFFFFF" />
                      <Text style={styles.swipeActionLabel}>Delete</Text>
                    </RectButton>
                  </View>
                )}
                overshootRight={false}
                friction={2}
                rightThreshold={40}
                onSwipeableWillOpen={() => { if (swipeRef) handleSwipeableOpen(swipeRef); }}
                onSwipeableClose={() => { if (swipeRef) handleSwipeableClose(swipeRef); }}
                enableTrackpadTwoFingerGesture
              >
                  <View style={[styles.backupCard, {
                    backgroundColor: surfaceBg,
                    overflow: 'hidden',
                  }]}>
                    <View style={styles.backupCardRow}>
                      <View style={[styles.backupIconFull, {
                        backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
                      }]}>
                        <Ionicons name="cloud" size={22} color="#007AFF" />
                      </View>
                      <View style={styles.backupCardInfo}>
                        <View style={styles.backupCardTitleRow}>
                          <Text style={[styles.backupCardName, { color: textPrimary }]} numberOfLines={1}>
                            {item.backupName}
                          </Text>
                          <View style={[styles.countBadge, {
                            backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
                          }]}>
                            <Ionicons name="wallet" size={10} color="#007AFF" />
                            <Text style={styles.countBadgeText}>{item.walletCount}</Text>
                          </View>
                        </View>
                        <Text style={[styles.backupCardDate, { color: textMuted }]}>
                          {formatFullDate(item.backupDate)}
                        </Text>
                        {item.walletNames.length > 0 && (
                          <Text style={[styles.backupCardWallets, { color: textMuted }]} numberOfLines={1}>
                            {item.walletNames.join(' · ')}
                          </Text>
                        )}
                      </View>
                      <Ionicons
                        name="chevron-back"
                        size={14}
                        color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}
                        style={{ transform: [{ rotate: '180deg' }] }}
                      />
                    </View>
                  </View>
                </Swipeable>
              );
            })}
          </>
        )}

        {/* ── Single Wallet Backups Section ──────────────────── */}
        {!isLoadingBackups && singleBackups.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>
              {fullBackups.length > 0 ? 'INDIVIDUAL WALLET BACKUPS' : 'WALLET BACKUPS'}
            </Text>
            {singleBackups.map((item) => {
              let swipeRef: Swipeable | null = null;
              return (
              <Swipeable
                key={item.walletId}
                ref={(ref) => { swipeRef = ref; }}
                renderRightActions={() => (
                  <View style={styles.swipeActionsRow}>
                    <RectButton
                      onPress={() => handleDeleteSingleBackup(item)}
                      style={styles.swipeDeleteBackupAction}
                    >
                      <Ionicons name="trash" size={18} color="#FFFFFF" />
                      <Text style={styles.swipeActionLabel}>Delete</Text>
                    </RectButton>
                  </View>
                )}
                overshootRight={false}
                friction={2}
                rightThreshold={40}
                onSwipeableWillOpen={() => { if (swipeRef) handleSwipeableOpen(swipeRef); }}
                onSwipeableClose={() => { if (swipeRef) handleSwipeableClose(swipeRef); }}
                enableTrackpadTwoFingerGesture
              >
                  <View style={[styles.backupCard, {
                    backgroundColor: surfaceBg,
                    overflow: 'hidden',
                  }]}>
                    <View style={styles.backupCardRow}>
                      <View style={[styles.backupIconSingle, {
                        backgroundColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.08)',
                      }]}>
                        <Ionicons name="shield-checkmark" size={20} color="#FF9F0A" />
                      </View>
                      <View style={styles.backupCardInfo}>
                        <Text style={[styles.backupCardName, { color: textPrimary }]} numberOfLines={1}>
                          {item.metadata.walletName}
                        </Text>
                        <View style={styles.backupCardMeta}>
                          <View style={[styles.typeBadge, {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                          }]}>
                            <Text style={[styles.typeBadgeText, { color: textMuted }]}>
                              {getWalletTypeBadge(item.metadata.walletType)}
                            </Text>
                          </View>
                          <Text style={[styles.backupCardDate, { color: textMuted }]}>
                            {formatShortDate(item.metadata.backupDate)}
                          </Text>
                        </View>
                      </View>
                      <Ionicons
                        name="chevron-back"
                        size={14}
                        color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}
                        style={{ transform: [{ rotate: '180deg' }] }}
                      />
                    </View>
                  </View>
                </Swipeable>
              );
            })}
          </>
        )}

        {/* ── Empty State ────────────────────────────────────── */}
        {!isLoadingBackups && totalBackups === 0 && (
          <View
            style={[styles.emptyState, {
              backgroundColor: surfaceBg,
              overflow: 'hidden',
            }]}
          >
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
                <Ionicons name="cloud-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
              </View>
            </View>
            <Text style={[styles.emptyTitle, { color: textPrimary }]}>No Backups Yet</Text>
            <Text style={[styles.emptySubtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
              Create your first encrypted backup to protect your wallets
            </Text>
          </View>
        )}

        {/* ── Settings Section ─────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 8 }]}>SETTINGS</Text>
        <View
          style={[styles.settingsCard, {
            backgroundColor: surfaceBg,
            overflow: 'hidden',
          }]}
        >
          {/* Auto-backup Toggle */}
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.08)',
            }]}>
              <Ionicons name="timer" size={16} color="#30D158" />
            </View>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: textPrimary }]}>Auto-Backup Daily</Text>
              <Text style={[styles.settingSubtitle, { color: textMuted }]}>
                {autoBackupEnabled && lastAutoBackupDate
                  ? `Last: ${formatShortDate(lastAutoBackupDate)}`
                  : 'Recommended — backs up every 24h'}
              </Text>
            </View>
            <FastSwitch
              value={autoBackupEnabled}
              onValueChange={handleToggleAutoBackup}
            />
          </View>
          {autoBackupEnabled && (
            <View style={[styles.autoBackupNote, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.04)',
            }]}>
              <Ionicons name="checkmark-circle" size={14} color="#30D158" />
              <Text style={[styles.autoBackupNoteText, { color: isDark ? 'rgba(48,209,88,0.80)' : '#1B8A3E' }]}>
                Your wallets are automatically encrypted and backed up to iCloud every 24 hours. No action needed.
              </Text>
            </View>
          )}
        </View>

        {/* ── How It Works — Tappable Row ──────────────────────── */}
        <TouchableOpacity
            onPress={async () => {
              await haptics.trigger('selection');
              setShowHowItWorksSheet(true);
            }}
            activeOpacity={0.7}
            style={[styles.howItWorksRow, {
              backgroundColor: surfaceBg,
              overflow: 'hidden',
            }]}
          >
            <View style={[styles.howItWorksIcon, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.10)' : 'rgba(0,122,255,0.08)',
            }]}>
              <Ionicons name="information-circle" size={18} color="#007AFF" />
            </View>
            <Text style={[styles.howItWorksText, { color: textPrimary }]}>How it Works</Text>
            <Ionicons name="chevron-down" size={16} color={textMuted} />
          </TouchableOpacity>

        {/* ── Warning Footer ───────────────────────────────────── */}
        <View
          style={[styles.warningCard, {
            backgroundColor: isDark ? 'rgba(255,159,10,0.08)' : 'rgba(255,159,10,0.06)',
            borderColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.10)',
            overflow: 'hidden',
          }]}
        >
          <Ionicons name="warning" size={18} color="#FF9F0A" />
          <Text style={[styles.warningText, { color: isDark ? 'rgba(255,159,10,0.85)' : '#C65D00' }]}>
            iCloud backup is an additional recovery option. Always keep your seed phrase written down and stored securely offline.
          </Text>
        </View>

      </ScrollView>

      {/* ── Unified Create Backup Sheet (naming → password → progress) ── */}
      {verifiedPin !== '' && (
        <ICloudBackupCreateSheet
          visible={showCreateSheet}
          onClose={() => {
            setShowCreateSheet(false);
            setVerifiedPin('');
          }}
          onComplete={handleBackupComplete}
          pin={verifiedPin}
          existingBackupCount={fullBackups.length}
        />
      )}

      {/* ── Delete Warning Sheet ──────────────────────────── */}
      <AppBottomSheet
        visible={showDeleteSheet}
        onClose={() => { setShowDeleteSheet(false); setDeleteTarget(null); }}
        title="Delete Backup"
        subtitle="This action cannot be undone"
        sizing="auto"
        footer={
          <View style={styles.sheetFooter}>
            <SheetPrimaryButton
              label="Delete Permanently"
              onPress={handleDeleteConfirm}
              variant="destructive"
            />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <View style={[styles.deleteWarningCard, {
            backgroundColor: c.alertBar.errorBg,
            overflow: 'hidden',
          }]}>
            <Ionicons name="warning" size={22} color={c.semantic.error} />
            <View style={styles.deleteWarningContent}>
              <Text style={[styles.deleteWarningTitle, { color: c.semantic.error }]}>
                Permanent Deletion
              </Text>
              <Text style={[styles.deleteWarningText, { color: c.alertBar.errorText }]}>
                You are about to permanently delete the {deleteTypeLabel} "{deleteItemName}" from iCloud. This cannot be recovered once deleted.
              </Text>
            </View>
          </View>
          {deleteTarget?.type === 'full' && (
            <View style={[styles.deleteInfoRow, {
              backgroundColor: c.card.bg,
              overflow: 'hidden',
            }]}>
              <Ionicons name="wallet" size={16} color={textMuted} />
              <Text style={[styles.deleteInfoText, { color: textSecondary }]}>
                This backup contains {deleteTarget.item.walletCount} wallet{deleteTarget.item.walletCount !== 1 ? 's' : ''}: {deleteTarget.item.walletNames.join(', ')}
              </Text>
            </View>
          )}
          <SheetSectionFooter
            text="This will permanently remove the backup from iCloud. This cannot be undone."
            variant="warning"
          />
        </View>
      </AppBottomSheet>

      {/* ── Manage Backup Sheet ───────────────────────────── */}
      <AppBottomSheet
        visible={showManageSheet}
        onClose={() => { setShowManageSheet(false); setManagedBackup(null); }}
        title="Manage Backup"
        subtitle={managedBackup?.backupName || ''}
        sizing="large"
        scrollable
        footer={
          <View style={styles.sheetFooter}>
            <SheetPrimaryButton
              label="Delete Entire Backup"
              onPress={() => {
                if (!managedBackup) return;
                setShowManageSheet(false);
                setTimeout(() => {
                  handleDeleteFullBackup(managedBackup);
                }, 350);
              }}
              variant="destructive"
            />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          {/* Backup info header */}
          <View style={[styles.manageHeader, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.04)',
            borderColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
            overflow: 'hidden',
          }]}>
            <View style={[styles.manageHeaderIcon, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.10)',
            }]}>
              <Ionicons name="cloud" size={20} color="#007AFF" />
            </View>
            <View style={styles.manageHeaderInfo}>
              <Text style={[styles.manageHeaderName, { color: textPrimary }]} numberOfLines={1}>
                {managedBackup?.backupName}
              </Text>
              <Text style={[styles.manageHeaderDate, { color: textSecondary }]}>
                {managedBackup ? formatFullDate(managedBackup.backupDate) : ''}
              </Text>
            </View>
            <View style={[styles.countBadge, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
            }]}>
              <Ionicons name="wallet" size={10} color="#007AFF" />
              <Text style={styles.countBadgeText}>{managedBackup?.walletCount ?? 0}</Text>
            </View>
          </View>

          {/* Wallet list (read-only) */}
          <Text style={[styles.manageSectionLabel, { color: sectionLabelColor }]}>
            WALLETS IN THIS BACKUP
          </Text>
          {managedBackup?.walletNames.map((walletName, index) => (
              <View
                key={`${managedBackup.backupId}-${index}`}
                style={[styles.manageWalletRow, {
                  backgroundColor: surfaceBg,
                  overflow: 'hidden',
                }]}
              >
                <View style={[styles.manageWalletIcon, {
                  backgroundColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.08)',
                }]}>
                  <Ionicons name="wallet" size={16} color="#FF9F0A" />
                </View>
                <Text style={[styles.manageWalletName, { color: textPrimary }]} numberOfLines={1}>
                  {walletName}
                </Text>
              </View>
          ))}

          <SheetSectionFooter
            text="This backup is encrypted — individual wallets cannot be removed. To update, delete this backup and create a new one."
            variant="info"
          />
        </View>
      </AppBottomSheet>

      {/* ── How It Works Sheet — Premium Redesign ──────────────── */}
      <AppBottomSheet
        visible={showHowItWorksSheet}
        onClose={() => setShowHowItWorksSheet(false)}
        sizing="large"
        scrollable
      >
        <View style={styles.howItWorksSheetContent}>
          {/* Hero icon */}
          <View style={[styles.howItWorksHero, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.06)' : 'rgba(0,122,255,0.05)',
          }]}>
            <View style={[styles.howItWorksHeroInner, {
              backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.10)',
            }]}>
              <Ionicons name="shield-checkmark" size={26} color="#007AFF" />
            </View>
          </View>

          {/* Title */}
          <Text style={[styles.howItWorksTitle, { color: textPrimary }]}>
            How iCloud Backup Works
          </Text>
          <Text style={[styles.howItWorksSubtitle, { color: textSecondary }]}>
            Your data is protected by multiple layers of encryption
          </Text>

          {/* Steps card */}
          <View style={[styles.howItWorksCard, { backgroundColor: surfaceBg }]}>
            {/* Step 1 */}
            <View style={styles.howItWorksStepRow}>
              <View style={[styles.howItWorksStepNum, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
              }]}>
                <Text style={[styles.howItWorksStepNumText, { color: '#30D158' }]}>1</Text>
              </View>
              <View style={styles.howItWorksStepContent}>
                <Text style={[styles.howItWorksStepTitle, { color: textPrimary }]}>Device-Side Encryption</Text>
                <Text style={[styles.howItWorksStepDesc, { color: textSecondary }]}>
                  Wallet data is encrypted with AES-256-GCM using a key derived from your password
                </Text>
              </View>
            </View>

            <View style={[styles.howItWorksStepDivider, { backgroundColor: dividerColor }]} />

            {/* Step 2 */}
            <View style={styles.howItWorksStepRow}>
              <View style={[styles.howItWorksStepNum, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
              }]}>
                <Text style={[styles.howItWorksStepNumText, { color: '#007AFF' }]}>2</Text>
              </View>
              <View style={styles.howItWorksStepContent}>
                <Text style={[styles.howItWorksStepTitle, { color: textPrimary }]}>Password Never Leaves Device</Text>
                <Text style={[styles.howItWorksStepDesc, { color: textSecondary }]}>
                  Only you have the key — not Apple, not us, not anyone else
                </Text>
              </View>
            </View>

            <View style={[styles.howItWorksStepDivider, { backgroundColor: dividerColor }]} />

            {/* Step 3 */}
            <View style={styles.howItWorksStepRow}>
              <View style={[styles.howItWorksStepNum, {
                backgroundColor: isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)',
              }]}>
                <Text style={[styles.howItWorksStepNumText, { color: '#8E8E93' }]}>3</Text>
              </View>
              <View style={styles.howItWorksStepContent}>
                <Text style={[styles.howItWorksStepTitle, { color: textPrimary }]}>Double-Encrypted in iCloud</Text>
                <Text style={[styles.howItWorksStepDesc, { color: textSecondary }]}>
                  Apple adds its own encryption layer on top of your already-encrypted data
                </Text>
              </View>
            </View>

            <View style={[styles.howItWorksStepDivider, { backgroundColor: dividerColor }]} />

            {/* Step 4 */}
            <View style={styles.howItWorksStepRow}>
              <View style={[styles.howItWorksStepNum, {
                backgroundColor: isDark ? 'rgba(191,90,242,0.12)' : 'rgba(191,90,242,0.08)',
              }]}>
                <Text style={[styles.howItWorksStepNumText, { color: '#BF5AF2' }]}>4</Text>
              </View>
              <View style={styles.howItWorksStepContent}>
                <Text style={[styles.howItWorksStepTitle, { color: textPrimary }]}>Zero-Knowledge Design</Text>
                <Text style={[styles.howItWorksStepDesc, { color: textSecondary }]}>
                  No server can read your backup — seed phrases and private keys are never exposed
                </Text>
              </View>
            </View>
          </View>

          {/* What's backed up section */}
          <View style={styles.howItWorksWhatSection}>
            <Text style={[styles.howItWorksSectionLabel, { color: sectionLabelColor }]}>WHAT GETS BACKED UP</Text>
            <View style={[styles.howItWorksCard, { backgroundColor: surfaceBg }]}>
              <View style={styles.howItWorksItemRow}>
                <Ionicons name="checkmark-circle" size={16} color="#30D158" />
                <Text style={[styles.howItWorksItemText, { color: textPrimary }]}>Wallet seed phrases</Text>
              </View>
              <View style={styles.howItWorksItemRow}>
                <Ionicons name="checkmark-circle" size={16} color="#30D158" />
                <Text style={[styles.howItWorksItemText, { color: textPrimary }]}>Wallet names and configuration</Text>
              </View>
              <View style={styles.howItWorksItemRow}>
                <Ionicons name="close-circle" size={16} color={textMuted} />
                <Text style={[styles.howItWorksItemText, { color: textSecondary }]}>Transaction history (synced from network)</Text>
              </View>
              <View style={styles.howItWorksItemRow}>
                <Ionicons name="close-circle" size={16} color={textMuted} />
                <Text style={[styles.howItWorksItemText, { color: textSecondary }]}>Balances (synced from network)</Text>
              </View>
            </View>
          </View>
        </View>
      </AppBottomSheet>

      {/* ── Auto-Backup Password Sheet ──────────────────────── */}
      <AppBottomSheet
        visible={showAutoBackupPasswordSheet}
        onClose={() => setShowAutoBackupPasswordSheet(false)}
        title="Auto-Backup Password"
        subtitle="Set a password for automatic backups"
        sizing="auto"
        footer={
          <View style={styles.sheetFooter}>
            <SheetPrimaryButton label="Enable Auto-Backup" onPress={handleAutoBackupPasswordConfirm} />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <PremiumInputCard>
            <PremiumInput
              icon="key"
              iconColor="#FF9F0A"
              placeholder="Enter password (min 6 characters)"
              value={autoBackupPass}
              onChangeText={(t: string) => { setAutoBackupPass(t); setAutoBackupPassError(null); }}
              secureTextEntry
              autoFocus
            />
            <PremiumInput
              icon="shield-checkmark"
              iconColor="#5E5CE6"
              placeholder="Confirm password"
              value={autoBackupPassConfirm}
              onChangeText={(t: string) => { setAutoBackupPassConfirm(t); setAutoBackupPassError(null); }}
              secureTextEntry
            />
          </PremiumInputCard>
          {autoBackupPassError && (
            <Text style={styles.passwordErrorText}>{autoBackupPassError}</Text>
          )}
          <SheetSectionFooter
            text="This password will be used to encrypt all automatic backups. You'll need it to restore from an auto-backup. Store it safely."
            variant="info"
          />
        </View>
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 4,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  // Hero Section
  heroSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  heroRingOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroRingInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: '88%',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // ── CTA Button ─────────────────────────────────────────────
  ctaContainer: {
    marginBottom: 24,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    gap: 10,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  ctaHint: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 8,
  },

  // ── Loading ─────────────────────────────────────────────────
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 24,
  },

  // ── Section Label ───────────────────────────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    paddingLeft: 2,
  },

  // ── Backup Card ─────────────────────────────────────────────
  backupCard: {
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
  },
  backupCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backupIconFull: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backupIconSingle: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backupCardInfo: {
    flex: 1,
    marginRight: 8,
  },
  backupCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  backupCardName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  backupCardDate: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 1,
  },
  backupCardWallets: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  backupCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // ── Swipe Actions ──────────────────────────────────────────
  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 10,
    marginLeft: 8,
    gap: 6,
  },
  swipeDeleteBackupAction: {
    backgroundColor: '#FF453A',
    justifyContent: 'center',
    alignItems: 'center',
    width: 68,
    borderRadius: 16,
    gap: 4,
  },
  swipeSettingsAction: {
    backgroundColor: '#8E8E93',
    justifyContent: 'center',
    alignItems: 'center',
    width: 68,
    borderRadius: 16,
    gap: 4,
  },
  swipeActionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // ── Swipe Hint ──────────────────────────────────────────────
  swipeHintCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 14,
  },
  swipeHintText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Empty State ─────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    padding: 36,
    borderRadius: 20,
    marginBottom: 24,
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
  },
  emptyRing2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
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
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },

  // ── Settings Card ──────────────────────────────────────────
  settingsCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 1,
  },
  settingSubtitle: {
    fontSize: 12,
    fontWeight: '400',
  },
  settingDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
    marginLeft: 44,
  },
  autoBackupNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
  },
  autoBackupNoteText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },

  // ── How It Works Row ────────────────────────────────────────
  howItWorksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  howItWorksIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howItWorksText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  // ── How It Works Sheet (redesigned) ────────────────────────
  howItWorksSheetContent: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
  },
  howItWorksHero: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  howItWorksHeroInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howItWorksTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  howItWorksSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  howItWorksCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  howItWorksStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  howItWorksStepNum: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  howItWorksStepNumText: {
    fontSize: 15,
    fontWeight: '700',
  },
  howItWorksStepContent: {
    flex: 1,
  },
  howItWorksStepTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  howItWorksStepDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },
  howItWorksStepDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
    marginRight: 16,
  },
  howItWorksWhatSection: {
    marginTop: 20,
  },
  howItWorksSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingLeft: 2,
  },
  howItWorksItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  howItWorksItemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Warning Card ────────────────────────────────────────────
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },

  // ── Sheet ───────────────────────────────────────────────────
  sheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  sheetFooter: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  passwordErrorText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 4,
  },

  // ── Delete Warning ──────────────────────────────────────────
  deleteWarningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  deleteWarningContent: {
    flex: 1,
  },
  deleteWarningTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  deleteWarningText: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  deleteInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  deleteInfoText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },

  // ── Manage Backup Sheet ─────────────────────────────────────
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 16,
  },
  manageHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  manageHeaderInfo: {
    flex: 1,
    marginRight: 8,
  },
  manageHeaderName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  manageHeaderDate: {
    fontSize: 12,
    fontWeight: '400',
  },
  manageSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingLeft: 2,
  },
  manageWalletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  manageWalletIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  manageWalletName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    marginRight: 8,
  },
  removedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
  },
  removedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF453A',
  },
  swipeDeleteAction: {
    backgroundColor: '#FF453A',
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: 14,
    marginBottom: 6,
    marginLeft: 6,
  },

});
