/**
 * Wallet Tab Screen - Premium Redesign
 *
 * Black-first, modern, calm aesthetic with clean hierarchy.
 * Replaces stacked cards with premium dashboard feel.
 */

import '../../../shim';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletStore, useSettingsStore, useMultiWalletStore, useSyncStore } from '../../../src/stores';
import { WalletType, isWalletNameTaken } from '../../../src/stores/multiWalletStore';
import { useTheme, useHaptics } from '../../../src/hooks';
import { AppBottomSheet } from '../../../src/components/ui/AppBottomSheet';
import { SensitiveSession } from '../../../src/services/auth/SensitiveSession';
import { WalletSyncManager } from '../../../src/services/sync/WalletSyncManager';
import {
  WalletSwitcherSheet,
  WalletHeader,
  SecurityBanner,
  ActionRow,
  SectionHeader,
  DetailsGrid,
  WalletCard,
  WalletRemovalSheet,
} from '../../../src/components/wallet';
import { PremiumInput, PremiumInputCard } from '../../../src/components/ui/PremiumInput';

import { exportAllTransactionsPDF, exportAllAddressesPDF } from '../../../src/services/export/TransactionPDFService';
import { useTransactionLabelStore } from '../../../src/stores';

// ─── Constants ────────────────────────────────────────────────────────

const AVATAR_STORAGE_KEY = 'wallet_avatar';

type WalletAvatar = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

const WALLET_AVATARS: WalletAvatar[] = [
  { id: 'wallet', icon: 'wallet-outline', label: 'Wallet' },
  { id: 'shield', icon: 'shield-checkmark-outline', label: 'Shield' },
  { id: 'diamond', icon: 'diamond-outline', label: 'Diamond' },
  { id: 'lock', icon: 'lock-closed-outline', label: 'Lock' },
  { id: 'key', icon: 'key-outline', label: 'Key' },
  { id: 'cube', icon: 'cube-outline', label: 'Cube' },
  { id: 'flash', icon: 'flash-outline', label: 'Flash' },
  { id: 'planet', icon: 'planet-outline', label: 'Planet' },
  { id: 'rocket', icon: 'rocket-outline', label: 'Rocket' },
  { id: 'star', icon: 'star-outline', label: 'Star' },
  { id: 'heart', icon: 'heart-outline', label: 'Heart' },
  { id: 'snow', icon: 'snow-outline', label: 'Snow' },
];

function getAvatarById(id: string): WalletAvatar {
  return WALLET_AVATARS.find(a => a.id === id) || WALLET_AVATARS[0];
}

// ─── Main Component ───────────────────────────────────────────────────

export default function WalletScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();


  // ─── Stores ───────────────────────────────────────────────────────
  const network = useWalletStore(s => s.network);
  const preferredAddressType = useWalletStore(s => s.preferredAddressType);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const walletId = useWalletStore(s => s.walletId);

  const {
    wallets,
    activeWalletId,
    renameWallet,
  } = useMultiWalletStore();

  const getBackupStatus = useSettingsStore(s => s.getBackupStatus);
  const walletMode = useSettingsStore(s => s.walletMode);
  const iCloudBackupEnabled = useSettingsStore(s => s.iCloudBackupEnabled);
  const iCloudBackupHistory = useSettingsStore(s => s.iCloudBackupHistory);
  const preserveDataOnDelete = useSettingsStore(s => s.preserveDataOnDelete);
  const { syncState, startSyncing } = useSyncStore();

  // ─── Derived State ─────────────────────────────────────────────────
  const activeWallet = useMemo(() =>
    wallets.find(w => w.id === activeWalletId),
    [wallets, activeWalletId]
  );

  const walletType = activeWallet?.type || 'hd';
  const isWatchOnly = walletType.startsWith('watch_');
  const isAddressOnly = walletType === 'watch_addresses';
  const isMultisig = walletType === 'multisig';
  const hasMultipleWallets = wallets.length > 1;
  const backupStatus = activeWallet ? getBackupStatus(activeWallet.id) : null;
  // Wallet is considered backed up if: explicitly marked, iCloud backup exists, or preserve data is on
  const isBackedUp = (backupStatus?.isBackedUp ?? false)
    || (iCloudBackupEnabled && iCloudBackupHistory.length > 0)
    || preserveDataOnDelete;

  // ─── Local State ───────────────────────────────────────────────────
  const [walletName, setWalletName] = useState(activeWallet?.name || 'My Wallet');
  const [selectedAvatar, setSelectedAvatar] = useState('wallet');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Sheet states
  const [showRenameSheet, setShowRenameSheet] = useState(false);
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [showWalletInfoSheet, setShowWalletInfoSheet] = useState(false);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [showWalletSwitcher, setShowWalletSwitcher] = useState(false);
  const [showRemovalSheet, setShowRemovalSheet] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const awaitingPinReturn = useRef(false);

  // ─── Effects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (activeWallet?.name) {
      setWalletName(activeWallet.name);
    }
  }, [activeWallet?.name]);

  useEffect(() => {
    const loadAvatar = async () => {
      if (activeWallet?.id) {
        const savedAvatar = await AsyncStorage.getItem(
          `${AVATAR_STORAGE_KEY}_${activeWallet.id}`
        );
        if (savedAvatar) setSelectedAvatar(savedAvatar);
        else setSelectedAvatar('wallet');
      }
    };
    loadAvatar();
  }, [activeWallet?.id]);

  // ─── Detect return from PIN screen ──────────────────────────────────
  // Listen on the parent Stack navigator for focus (fires when (tabs) regains focus
  // after verify-pin screen pops).
  useEffect(() => {
    const nav = navigation.getParent() ?? navigation;
    const unsubscribe = nav.addListener('focus', () => {
      if (awaitingPinReturn.current) {
        awaitingPinReturn.current = false;
        if (SensitiveSession.isActive()) {
          // PIN verified successfully — reopen sheet with pinVerified
          setPinVerified(true);
          setTimeout(() => setShowRemovalSheet(true), 300);
        } else {
          // User cancelled — don't reopen
          setPinVerified(false);
        }
      }
    });
    return unsubscribe;
  }, [navigation]);

  // ─── Computed Values ───────────────────────────────────────────────
  const currentAvatar = getAvatarById(selectedAvatar);

  const getScriptTypeLabel = useCallback(() => {
    switch (walletType) {
      case 'watch_addresses': return 'Address';
      case 'watch_descriptor': return 'Descriptor';
      case 'watch_xpub':
      case 'hd':
      case 'imported_key':
      default:
        switch (preferredAddressType) {
          case 'taproot': return 'Taproot';
          case 'native_segwit': return 'Native SegWit';
          case 'wrapped_segwit': return 'Wrapped SegWit';
          case 'legacy': return 'Legacy';
          default: return preferredAddressType;
        }
    }
  }, [walletType, preferredAddressType]);

  const getCreatedDate = useCallback(() => {
    if (!activeWallet?.createdAt) return 'Unknown';
    return new Date(activeWallet.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [activeWallet?.createdAt]);

  const getWalletTypeDisplay = useCallback(() => {
    switch (walletType) {
      case 'hd': return 'HD Wallet';
      case 'imported_key': return 'Imported Key';
      case 'watch_xpub': return 'Watch-only';
      case 'watch_descriptor': return 'Watch-only';
      case 'watch_addresses': return 'Watch-only';
      case 'multisig': return multisigConfig ? `${multisigConfig.m}-of-${multisigConfig.n}` : 'Multisig';
      default: return 'Wallet';
    }
  }, [walletType, multisigConfig]);

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleOpenRename = useCallback(async () => {
    await haptics.trigger('selection');
    setRenameValue(walletName);
    setShowRenameSheet(true);
  }, [walletName, haptics]);

  const handleSaveRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== walletName && activeWallet) {
      if (isWalletNameTaken(trimmed, activeWallet.id)) {
        await haptics.trigger('error');
        return; // Don't close sheet — name is taken
      }
      await renameWallet(activeWallet.id, trimmed);
      setWalletName(trimmed);
      await haptics.trigger('success');
    }
    setShowRenameSheet(false);
  }, [renameValue, walletName, activeWallet, renameWallet, haptics]);

  const handleOpenAvatarPicker = useCallback(async () => {
    await haptics.trigger('selection');
    setShowAvatarSheet(true);
  }, [haptics]);

  const handleSelectAvatar = useCallback(async (avatarId: string) => {
    setSelectedAvatar(avatarId);
    await AsyncStorage.setItem(
      `${AVATAR_STORAGE_KEY}_${activeWallet?.id || 'default'}`,
      avatarId
    );
    await haptics.trigger('selection');
    setShowAvatarSheet(false);
  }, [activeWallet?.id, haptics]);

  const handleSwitchWallet = useCallback(async () => {
    await haptics.trigger('selection');
    setShowWalletSwitcher(true);
  }, [haptics]);

  const handleSync = useCallback(async () => {
    await haptics.trigger('light');
    startSyncing();
    if (walletId) WalletSyncManager.shared().triggerSync(walletId, 'pull-to-refresh').catch(() => {});
  }, [haptics, walletId, startSyncing]);

  const handleBackupPress = useCallback(async () => {
    await haptics.trigger('light');
    router.push('/(auth)/backup-flow');
  }, [haptics, router]);

  const getSecurityLabel = useCallback(() => {
    if (isMultisig) return 'Manage Keys';
    switch (walletType) {
      case 'hd_xprv': return 'Extended Private Key';
      case 'imported_key': return 'Private Key (WIF)';
      case 'imported_keys': return 'Private Keys';
      case 'hd_seed': return 'Seed Bytes (Hex)';
      default: return 'Recovery Phrase';
    }
  }, [walletType, isMultisig]);

  const handleRecoveryPhrase = useCallback(async () => {
    await haptics.trigger('selection');
    const label = getSecurityLabel();
    Alert.alert(
      label,
      isMultisig
        ? 'You will need to enter your PIN to view and manage your multisig keys.'
        : `You will need to enter your PIN to view your ${label.toLowerCase()}. Never share it with anyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => router.push('/(auth)/backup') },
      ]
    );
  }, [isMultisig, haptics, router, getSecurityLabel]);

  const handleViewAddresses = useCallback(async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/addresses');
  }, [haptics, router]);

  const handleViewXpub = useCallback(async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/xpub');
  }, [haptics, router]);

  const handleViewDescriptors = useCallback(async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/descriptors');
  }, [haptics, router]);

  const handleManageUtxos = useCallback(async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/utxo-management');
  }, [haptics, router]);

  const handleExportPress = useCallback(async () => {
    await haptics.trigger('selection');
    setShowExportSheet(true);
  }, [haptics]);

  const handleWalletInfo = useCallback(async () => {
    await haptics.trigger('selection');
    setShowWalletInfoSheet(true);
  }, [haptics]);

  const handleExportTransactionsPDF = useCallback(async () => {
    setIsExporting(true);
    try {
      const { transactions, network: net } = useWalletStore.getState();
      const labels = useTransactionLabelStore.getState().labels;
      await exportAllTransactionsPDF(transactions, walletName, net, labels);
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message || 'Export failed');
    } finally {
      setIsExporting(false);
      setShowExportSheet(false);
    }
  }, [walletName]);

  const handleExportAddressesPDF = useCallback(async () => {
    setIsExporting(true);
    try {
      const { addresses: addrs, usedAddresses: used, network: net } = useWalletStore.getState();
      await exportAllAddressesPDF(addrs, used, walletName, net);
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message || 'Export failed');
    } finally {
      setIsExporting(false);
      setShowExportSheet(false);
    }
  }, [walletName]);

  // ── PIN auth for wallet removal ──

  const handleNavigateToPin = useCallback(() => {
    setPinVerified(false);
    awaitingPinReturn.current = true;
    // Dismiss the native sheet first so navigation works cleanly
    setShowRemovalSheet(false);
    // Navigate to full-screen PIN verification
    setTimeout(() => {
      router.push({
        pathname: '/(auth)/verify-pin',
        params: {
          purpose: 'remove-wallet',
          title: 'Verify Identity',
          subtitle: 'Enter your PIN to remove wallet',
          icon: 'trash-outline',
          iconColor: '#FF453A',
        },
      });
    }, 300);
  }, [router]);

  const handleRemoveWallet = useCallback(async () => {
    if (!activeWallet || isDeleting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowRemovalSheet(true);
  }, [activeWallet, isDeleting, haptics]);

  const handleRemovalComplete = useCallback(async (action: 'stay' | 'reset') => {
    setShowRemovalSheet(false);
    setPinVerified(false);
    if (action === 'stay') {
      // Stay in app with empty states — walletStore already cleared by sheet
    } else {
      // Reset all data and go to onboarding
      try {
        const { SecureStorage } = require('../../../src/services/storage/SecureStorage');
        await SecureStorage.deleteWallet().catch(() => {});
        useWalletStore.setState({ hasPinSet: false });
      } catch {}
      router.replace('/(onboarding)');
    }
  }, [router]);

  // ─── Details Grid Data ─────────────────────────────────────────────
  const detailsItems = useMemo(() => [
    { label: 'Type', value: getWalletTypeDisplay() },
    { label: 'Script', value: getScriptTypeLabel() },
    { label: 'Created', value: getCreatedDate() },
  ], [getWalletTypeDisplay, getScriptTypeLabel, getCreatedDate]);

  // ─── Render ────────────────────────────────────────────────────────

  // Single render tree: WalletRemovalSheet must remain the SAME instance
  // even when activeWallet becomes null mid-removal (removeWallet() clears the store).
  // Using an early return would mount a new instance and lose the ref + state.

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

    {/* Empty state when no wallets exist */}
    {!activeWallet ? (
      <View style={[styles.emptyRoot, { paddingTop: insets.top + 60 }]}>
        {/* Decorative rings — matches Portfolio design */}
        <View style={styles.emptyRings}>
          <View style={[styles.emptyRing3, {
            borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          }]} />
          <View style={[styles.emptyRing2, {
            borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
          }]} />
          <View style={[styles.emptyIconWrap, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
          }]}>
            <Ionicons name="wallet" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
          </View>
        </View>
        <Text style={[styles.emptyTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          No Wallets
        </Text>
        <Text style={[styles.emptySubtitle, {
          color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
        }]}>
          Add a wallet from the Portfolio tab{'\n'}to manage it here.
        </Text>
      </View>
    ) : (
      <>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <WalletHeader
          walletName={walletName}
          walletType={walletType}
          avatar={currentAvatar}
          hasMultipleWallets={hasMultipleWallets}
          onEditName={handleOpenRename}
          onEditAvatar={handleOpenAvatarPicker}
          onSwitchWallet={handleSwitchWallet}
          onSyncTap={handleSync}
        />

        {/* ── Security Banner ──────────────────────────────────────── */}
        <SecurityBanner
          isBackedUp={isBackedUp}
          onBackupPress={handleBackupPress}
          walletType={walletType}
        />

        {/* ── Details Section ──────────────────────────────────────── */}
        <SectionHeader title="Details" marginTop={20} />
        <WalletCard>
          <Pressable onPress={handleWalletInfo}>
            <DetailsGrid items={detailsItems} columns={3} />
          </Pressable>
        </WalletCard>

        {/* ── Wallet Management ────────────────────────────────────── */}
        <SectionHeader title="Wallet Management" marginTop={20} />
        <WalletCard noPadding>
          <ActionRow
            icon="layers-outline"
            label="Addresses"
            onPress={handleViewAddresses}
          />
          <ActionRow
            icon="cube-outline"
            label="Coin Control (UTXOs)"
            onPress={handleManageUtxos}
          />
          {!isAddressOnly && (
            <ActionRow
              icon="key-outline"
              label="Extended Public Keys"
              onPress={handleViewXpub}
            />
          )}
          {!isAddressOnly && (
            <ActionRow
              icon="code-slash-outline"
              label="Output Descriptors"
              onPress={handleViewDescriptors}
            />
          )}
          <ActionRow
            icon="document-text-outline"
            label="Export Data"
            onPress={handleExportPress}
            isLast
          />
        </WalletCard>

        {/* ── Security Section ─────────────────────────────────────── */}
        {!isWatchOnly && (
          <>
            <SectionHeader title="Security" marginTop={20} />
            <WalletCard noPadding>
              <ActionRow
                icon={isMultisig ? 'key-outline' : 'shield-checkmark-outline'}
                label={getSecurityLabel()}
                onPress={handleRecoveryPhrase}
                variant="protected"
                isLast
              />
            </WalletCard>
          </>
        )}

        {/* ── Danger Zone ──────────────────────────────────────────── */}
        <View style={styles.dangerSection}>
          <TouchableOpacity
            style={[
              styles.removeButton,
              {
                backgroundColor: isDark ? 'rgba(255, 69, 58, 0.08)' : 'rgba(255, 69, 58, 0.05)',
              },
            ]}
            onPress={handleRemoveWallet}
            activeOpacity={0.6}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#FF453A" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={16} color="#FF453A" style={{ marginRight: 8 }} />
                <Text style={styles.removeButtonText}>Remove Wallet</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Bottom Sheets ──────────────────────────────────────────── */}

      {/* Rename Sheet */}
      <AppBottomSheet
        visible={showRenameSheet}
        onClose={() => setShowRenameSheet(false)}
        title="Rename Wallet"
        subtitle="Give your wallet a name you'll recognize."
        sizing="auto"
        footer={
          <View>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
                  opacity: renameValue.trim().length === 0 || (activeWallet && isWalletNameTaken(renameValue.trim(), activeWallet.id)) ? 0.4 : 1,
                },
              ]}
              onPress={handleSaveRename}
              activeOpacity={0.7}
              disabled={renameValue.trim().length === 0 || (!!activeWallet && isWalletNameTaken(renameValue.trim(), activeWallet.id))}
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: isDark ? '#000000' : '#FFFFFF' },
                ]}
              >
                Save
              </Text>
            </TouchableOpacity>
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <PremiumInputCard>
            <PremiumInput
              icon="text-outline"
              iconColor="#007AFF"
              placeholder="Wallet name"
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={handleSaveRename}
              showClear={true}
            />
          </PremiumInputCard>
          {renameValue.trim() && activeWallet && renameValue.trim() !== walletName && isWalletNameTaken(renameValue.trim(), activeWallet.id) ? (
            <Text style={[styles.renameHint, { color: '#FF453A' }]}>
              This name is already taken by another wallet.
            </Text>
          ) : (
            <Text style={[styles.renameHint, { color: colors.textMuted }]}>
              {renameValue.trim().length}/30 characters
            </Text>
          )}
        </View>
      </AppBottomSheet>

      {/* Avatar Picker Sheet */}
      <AppBottomSheet
        visible={showAvatarSheet}
        onClose={() => setShowAvatarSheet(false)}
        sizing="auto"
      >
        <View style={styles.avatarSheetContent}>
          {/* Header */}
          <View style={styles.avatarHeader}>
            <View style={[styles.avatarHeaderIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}>
              <Ionicons
                name={getAvatarById(selectedAvatar).icon}
                size={22}
                color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'}
              />
            </View>
            <Text style={[styles.avatarTitle, { color: colors.text }]}>Choose Avatar</Text>
            <Text style={[styles.avatarSubtitle, {
              color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
            }]}>
              Pick an icon for your wallet
            </Text>
          </View>

          {/* Grid */}
          <View style={[styles.avatarGridContainer, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
            borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          }]}>
            <View style={styles.avatarGrid}>
              {WALLET_AVATARS.map((avatar) => {
                const isSelected = avatar.id === selectedAvatar;
                return (
                  <TouchableOpacity
                    key={avatar.id}
                    style={[styles.avatarOption]}
                    onPress={() => handleSelectAvatar(avatar.id)}
                    activeOpacity={0.6}
                  >
                    <View style={[
                      styles.avatarIconCircle,
                      {
                        backgroundColor: isSelected
                          ? isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)'
                          : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                        borderColor: isSelected
                          ? isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.12)'
                          : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      },
                    ]}>
                      <Ionicons
                        name={avatar.icon}
                        size={22}
                        color={isSelected
                          ? (isDark ? '#FFFFFF' : '#000000')
                          : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)')
                        }
                      />
                    </View>
                    <Text
                      style={[
                        styles.avatarOptionLabel,
                        {
                          color: isSelected
                            ? colors.text
                            : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'),
                          fontWeight: isSelected ? '600' : '400',
                        },
                      ]}
                    >
                      {avatar.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </AppBottomSheet>

      {/* Wallet Info Sheet */}
      <AppBottomSheet
        visible={showWalletInfoSheet}
        onClose={() => setShowWalletInfoSheet(false)}
        title="Wallet Details"
        sizing="auto"
      >
        <View style={styles.sheetContent}>
          <SheetInfoRow label="Name" value={walletName} isDark={isDark} />
          <SheetInfoRow label="Type" value={getWalletTypeDisplay()} isDark={isDark} />
          <SheetInfoRow label="Script Type" value={getScriptTypeLabel()} isDark={isDark} />
          <SheetInfoRow label="Network" value={network === 'mainnet' ? 'Mainnet' : 'Testnet'} isDark={isDark} />
          <SheetInfoRow label="Created" value={getCreatedDate()} isDark={isDark} />
          {isMultisig && multisigConfig && (
            <SheetInfoRow
              label="Quorum"
              value={`${multisigConfig.m} of ${multisigConfig.n} signatures`}
              isDark={isDark}
            />
          )}
          <SheetInfoRow
            label="Status"
            value={syncState === 'synced' ? 'Synced' : syncState === 'syncing' ? 'Syncing...' : 'Not synced'}
            isDark={isDark}
            isLast
          />
        </View>
      </AppBottomSheet>

      {/* Export Sheet */}
      <AppBottomSheet
        visible={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        title="Export"
        subtitle="Export wallet data"
        sizing="auto"
      >
        <View style={{ paddingBottom: 8 }}>
          <TouchableOpacity
            style={[
              styles.exportOption,
              { borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
            ]}
            onPress={handleExportTransactionsPDF}
            disabled={isExporting}
            activeOpacity={0.6}
          >
            <View
              style={[
                styles.exportOptionIcon,
                { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' },
              ]}
            >
              <Ionicons name="receipt-outline" size={18} color="#30D158" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exportOptionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                Export Transactions
              </Text>
              <Text
                style={[
                  styles.exportOptionSubtitle,
                  { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' },
                ]}
              >
                All transactions as PDF
              </Text>
            </View>
            {isExporting ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.exportOption,
              { borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
            ]}
            onPress={handleExportAddressesPDF}
            disabled={isExporting}
            activeOpacity={0.6}
          >
            <View
              style={[
                styles.exportOptionIcon,
                { backgroundColor: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(10,132,255,0.08)' },
              ]}
            >
              <Ionicons name="list-outline" size={18} color="#0A84FF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exportOptionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                Export Addresses
              </Text>
              <Text
                style={[
                  styles.exportOptionSubtitle,
                  { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' },
                ]}
              >
                All addresses as PDF
              </Text>
            </View>
            {isExporting ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}
              />
            )}
          </TouchableOpacity>

          {!isAddressOnly && (
            <TouchableOpacity
              style={[styles.exportOption, { borderBottomWidth: 0 }]}
              onPress={() => {
                setShowExportSheet(false);
                handleViewDescriptors();
              }}
              activeOpacity={0.6}
            >
              <View
                style={[
                  styles.exportOptionIcon,
                  { backgroundColor: isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)' },
                ]}
              >
                <Ionicons name="key-outline" size={18} color="#8E8E93" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                  Keys & Descriptors
                </Text>
                <Text
                  style={[
                    styles.exportOptionSubtitle,
                    { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' },
                  ]}
                >
                  View xpub and output descriptors
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}
              />
            </TouchableOpacity>
          )}
        </View>
      </AppBottomSheet>

      {/* Wallet Switcher */}
      <WalletSwitcherSheet visible={showWalletSwitcher} onClose={() => setShowWalletSwitcher(false)} />

      </>
    )}

      {/* Wallet Removal Sheet — single instance outside both branches so it
          survives the activeWallet→null transition during removal */}
      <WalletRemovalSheet
        visible={showRemovalSheet}
        onClose={() => { setShowRemovalSheet(false); setPinVerified(false); }}
        wallet={activeWallet ?? null}
        isLastWallet={wallets.length <= 1}
        onRemoved={handleRemovalComplete}
        onNavigateToPin={handleNavigateToPin}
        pinVerified={pinVerified}
      />

    </View>
  );
}

// ─── Sheet Info Row Component ─────────────────────────────────────────

function SheetInfoRow({
  label,
  value,
  isDark,
  isLast = false,
}: {
  label: string;
  value: string;
  isDark: boolean;
  isLast?: boolean;
}) {
  return (
    <>
      <View style={styles.sheetInfoRow}>
        <Text
          style={[
            styles.sheetInfoLabel,
            { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' },
          ]}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.sheetInfoValue,
            { color: isDark ? '#FFFFFF' : '#000000' },
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
      {!isLast && (
        <View
          style={[
            styles.sheetInfoDivider,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
          ]}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // Danger Zone
  dangerSection: {
    marginTop: 32,
    marginBottom: 16,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    height: 50,
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF453A',
  },

  // Sheets
  sheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 8,
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
  renameHint: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'right',
    paddingRight: 4,
  },
  avatarSheetContent: {
    paddingBottom: 16,
  },
  avatarHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 4,
    marginBottom: 20,
  },
  avatarHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  avatarSubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  avatarGridContainer: {
    marginHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  avatarOption: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  avatarIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatarOptionLabel: {
    fontSize: 11,
    letterSpacing: 0.1,
  },
  sheetInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetInfoLabel: {
    fontSize: 13,
    fontWeight: '400',
  },
  sheetInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: '60%',
  },
  sheetInfoDivider: {
    height: StyleSheet.hairlineWidth,
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  exportOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportOptionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  exportOptionSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },

  // Empty state — premium
  emptyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
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
  emptyIconWrap: {
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
    marginBottom: 28,
  },
});
