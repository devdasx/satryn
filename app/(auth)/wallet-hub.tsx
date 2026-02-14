/**
 * Wallet Hub Screen
 * Single entry point for creating, importing, and managing wallets.
 * Accessible from the wallet switcher sheet and settings.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Pressable,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useTheme, useHaptics } from '../../src/hooks';
import { useMultiWalletStore, isWalletNameTaken } from '../../src/stores/multiWalletStore';
import { useWalletStore } from '../../src/stores/walletStore';

import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { WalletFileService } from '../../src/services/storage/WalletFileService';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { HelpSheet } from '../../src/components/wallet-hub';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import { SheetOptionRow } from '../../src/components/ui/SheetComponents';
import { THEME } from '../../src/constants';

import type { WalletInfo } from '../../src/stores/multiWalletStore';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const AVATAR_STORAGE_KEY = 'wallet_avatar';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Data
// ─────────────────────────────────────────────────────────────────────────────

interface HubOption {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  badge?: { label: string; variant: 'recommended' | 'advanced' };
}

const CREATE_OPTIONS: HubOption[] = [
  {
    id: 'create',
    title: 'Create New Wallet',
    description: 'Standard single-sig wallet for everyday use',
    icon: 'add-circle-outline',
    route: '/(onboarding)/create',
  },
  {
    id: 'multisig',
    title: 'Create Multisig Wallet',
    description: 'm-of-n shared custody and higher security',
    icon: 'shield-checkmark-outline',
    route: '/(onboarding)/multisig-intro',
    badge: { label: 'Advanced', variant: 'advanced' },
  },
];

const IMPORT_OPTIONS: HubOption[] = [
  {
    id: 'import',
    title: 'Import Existing Wallet',
    description: 'Restore using recovery phrase or wallet backup',
    icon: 'document-text-outline',
    route: '/(onboarding)/import',
  },
  {
    id: 'icloud',
    title: 'Restore from iCloud',
    description: 'Encrypted backup stored in your iCloud',
    icon: 'cloud-download-outline',
    route: '/(onboarding)/recover-icloud',
    badge: { label: 'Recommended', variant: 'recommended' },
  },
  {
    id: 'watch-only',
    title: 'Add Watch-Only Wallet',
    description: 'Track funds without spending keys (xpub/descriptor)',
    icon: 'eye-outline',
    route: '/(auth)/import-watch-only',
  },
];

// Semantic icon tinting
const ICON_COLORS: Record<string, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
  'add-circle-outline':       { light: { bg: 'rgba(247,147,26,0.10)', color: '#F7931A' }, dark: { bg: 'rgba(247,147,26,0.18)', color: '#F7931A' } },
  'shield-checkmark-outline': { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  'document-text-outline':    { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  'cloud-download-outline':   { light: { bg: 'rgba(0,122,255,0.10)', color: '#007AFF' },  dark: { bg: 'rgba(10,132,255,0.18)', color: '#0A84FF' } },
  'eye-outline':              { light: { bg: 'rgba(90,200,250,0.10)', color: '#5AC8FA' },  dark: { bg: 'rgba(100,210,255,0.18)', color: '#64D2FF' } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hub Row — interactive row with press animation + chevron
// ─────────────────────────────────────────────────────────────────────────────

function HubRow({ option, onPress, isDark, isLast }: {
  option: HubOption;
  onPress: (option: HubOption) => void;
  isDark: boolean;
  isLast: boolean;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const iconTheme = ICON_COLORS[option.icon as string];
  const iconBg = iconTheme ? (isDark ? iconTheme.dark.bg : iconTheme.light.bg) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
  const iconColor = iconTheme ? (isDark ? iconTheme.dark.color : iconTheme.light.color) : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)');

  const isRecommended = option.badge?.variant === 'recommended';

  return (
    <AnimatedPressable
      onPress={() => onPress(option)}
      onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
    >
      <Animated.View style={[styles.optionRow, animStyle]}>
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={option.icon} size={16} color={iconColor} />
        </View>
        <View style={styles.optionContent}>
          <View style={styles.optionTitleRow}>
            <Text style={[styles.optionTitle, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]} numberOfLines={1}>
              {option.title}
            </Text>
            {option.badge && (
              <View style={[styles.badge, {
                backgroundColor: isRecommended
                  ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.10)')
                  : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'),
              }]}>
                <Text style={[styles.badgeText, {
                  color: isRecommended
                    ? (isDark ? '#30D158' : '#34C759')
                    : (isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)'),
                }]}>
                  {option.badge.label}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.optionDesc, {
            color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
          }]}>
            {option.description}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'} />
        {!isLast && (
          <View style={[styles.rowDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />
        )}
      </Animated.View>
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function WalletHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  // ─── Stores ────────────────────────────────────────────────
  const {
    wallets,
    activeWalletId,
    setActiveWallet,
    removeWallet,
    renameWallet,
  } = useMultiWalletStore();
  const switchToWallet = useWalletStore(s => s.switchToWallet);

  // ─── State ─────────────────────────────────────────────────
  const [showHelp, setShowHelp] = useState(false);
  const [showWalletActions, setShowWalletActions] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletInfo | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingWalletId, setSwitchingWalletId] = useState<string | null>(null);

  // Rename state
  const [showRenameSheet, setShowRenameSheet] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // ─── Sorted wallets: active first, then by createdAt desc ──
  const sortedWallets = useMemo(() => {
    return [...wallets].sort((a, b) => {
      if (a.id === activeWalletId) return -1;
      if (b.id === activeWalletId) return 1;
      return b.createdAt - a.createdAt;
    });
  }, [wallets, activeWalletId]);

  // ─── Active wallet info ────────────────────────────────────
  const activeWallet = useMemo(
    () => wallets.find((w) => w.id === activeWalletId),
    [wallets, activeWalletId],
  );

  // ─── Handlers ──────────────────────────────────────────────

  const handleSwitchWallet = useCallback(
    async (wallet: WalletInfo) => {
      if (wallet.id === activeWalletId || isSwitching) {
        return;
      }

      setSwitchingWalletId(wallet.id);
      setIsSwitching(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      try {
        const success = await switchToWallet(wallet.id);

        if (success) {
          await setActiveWallet(wallet.id);
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );

        } else {
          Alert.alert('Error', 'Failed to switch wallet. Please try again.');
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Error,
          );
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to switch wallet. Please try again.');
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
      } finally {
        setIsSwitching(false);
        setSwitchingWalletId(null);
      }
    },
    [activeWalletId, isSwitching, switchToWallet, setActiveWallet],
  );

  const handleLongPressWallet = useCallback(
    (wallet: WalletInfo) => {
      setSelectedWallet(wallet);
      setShowWalletActions(true);
    },
    [],
  );

  const handleOpenRename = useCallback(() => {
    if (!selectedWallet) return;
    setShowWalletActions(false);
    setRenameValue(selectedWallet.name);
    setTimeout(() => setShowRenameSheet(true), 300);
  }, [selectedWallet]);

  const handleSaveRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && selectedWallet && trimmed !== selectedWallet.name) {
      if (isWalletNameTaken(trimmed, selectedWallet.id)) {
        await haptics.trigger('error');
        return; // Don't close sheet — name is taken
      }
      await renameWallet(selectedWallet.id, trimmed);
      await haptics.trigger('success');
    }
    setShowRenameSheet(false);
  }, [renameValue, selectedWallet, renameWallet, haptics]);

  const handleDeleteWallet = useCallback(() => {
    if (!selectedWallet) return;
    setShowWalletActions(false);

    const isActive = selectedWallet.id === activeWalletId;
    const remaining = wallets.filter((w) => w.id !== selectedWallet.id);

    if (remaining.length === 0) {
      Alert.alert(
        'Cannot Delete',
        'You must have at least one wallet. Create or import another wallet first.',
      );
      return;
    }

    Alert.alert(
      'Remove Wallet',
      `Are you sure you want to remove "${selectedWallet.name}"? Make sure you have a backup of your recovery phrase.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              );
              await SecureStorage.deleteWalletData(selectedWallet.id);
              await AsyncStorage.removeItem(
                `wallet_cache_${selectedWallet.id}`,
              );
              await AsyncStorage.removeItem(
                `${AVATAR_STORAGE_KEY}_${selectedWallet.id}`,
              );
              WalletFileService.delete(selectedWallet.id);
              await removeWallet(selectedWallet.id);

              if (isActive && remaining.length > 0) {
                const pin = await SecureStorage.getPinForBiometrics();
                if (pin) {
                  const { switchToWallet: doSwitch } =
                    useWalletStore.getState();
                  await doSwitch(remaining[0].id, pin);
                }
              }

              await Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );

            } catch (error) {
              Alert.alert(
                'Error',
                'Failed to remove wallet. Please try again.',
              );
            }
          },
        },
      ],
    );
  }, [
    selectedWallet,
    activeWalletId,
    wallets,
    removeWallet,
  ]);

  const handleOptionPress = async (option: HubOption) => {
    await haptics.trigger('selection');
    router.push(option.route as any);
  };

  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;

  // ─── Render ────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowHelp(true)}
          style={styles.helpButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="help-circle-outline" size={22} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title — left-aligned */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color: colors.text }]}>Add Wallet</Text>
          <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
            Create a new wallet or import an existing one.
          </Text>
        </View>

        {/* CREATE Section */}
        <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
          CREATE
        </Text>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          {CREATE_OPTIONS.map((option, i) => (
            <HubRow
              key={option.id}
              option={option}
              onPress={handleOptionPress}
              isDark={isDark}
              isLast={i === CREATE_OPTIONS.length - 1}
            />
          ))}
        </View>

        {/* IMPORT & RESTORE Section */}
        <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
          IMPORT & RESTORE
        </Text>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          {IMPORT_OPTIONS.map((option, i) => (
            <HubRow
              key={option.id}
              option={option}
              onPress={handleOptionPress}
              isDark={isDark}
              isLast={i === IMPORT_OPTIONS.length - 1}
            />
          ))}
        </View>

        {/* Security notice — accent bar style */}
        <View style={[styles.securityNotice, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]}>
          <View style={[styles.securityAccent, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)' }]} />
          <View style={styles.securityContent}>
            <Ionicons name="lock-closed-outline" size={16} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)'} />
            <Text style={[styles.securityText, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }]}>
              All wallets are encrypted and stored locally on your device. Your keys never leave this device.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Help Sheet */}
      <HelpSheet visible={showHelp} onClose={() => setShowHelp(false)} />

      {/* Wallet Actions Bottom Sheet (long-press) */}
      <AppBottomSheet
        visible={showWalletActions}
        onClose={() => setShowWalletActions(false)}
        title={selectedWallet?.name || 'Wallet'}
        sizing="auto"
      >
        <SheetOptionRow
          icon="create-outline"
          label="Rename Wallet"
          onPress={handleOpenRename}
          showDivider
        />
        <SheetOptionRow
          icon="trash-outline"
          label="Delete Wallet"
          danger
          onPress={handleDeleteWallet}
          showDivider={false}
        />
      </AppBottomSheet>

      {/* Rename Bottom Sheet */}
      <AppBottomSheet
        visible={showRenameSheet}
        onClose={() => setShowRenameSheet(false)}
        title="Rename Wallet"
        sizing="auto"
      >
        <View style={styles.renameContainer}>
          <PremiumInputCard>
            <PremiumInput
              icon="create-outline"
              iconColor="#FF9F0A"
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Wallet name"
              autoFocus
              maxLength={32}
              returnKeyType="done"
              onSubmitEditing={handleSaveRename}
              showClear
            />
          </PremiumInputCard>
          {renameValue.trim() && selectedWallet && renameValue.trim() !== selectedWallet.name && isWalletNameTaken(renameValue.trim(), selectedWallet.id) && (
            <Text style={[styles.renameError, { color: '#FF453A' }]}>
              This name is already taken by another wallet.
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.renameSaveButton,
              {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
                opacity:
                  renameValue.trim() &&
                  renameValue.trim() !== selectedWallet?.name &&
                  !isWalletNameTaken(renameValue.trim(), selectedWallet?.id)
                    ? 1
                    : 0.4,
              },
            ]}
            onPress={handleSaveRename}
            disabled={
              !renameValue.trim() ||
              renameValue.trim() === selectedWallet?.name ||
              isWalletNameTaken(renameValue.trim(), selectedWallet?.id)
            }
          >
            <Text
              style={[
                styles.renameSaveText,
                { color: '#FFFFFF' },
              ]}
            >
              Save
            </Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  helpButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  // Title — left-aligned
  titleSection: { marginBottom: 20 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, maxWidth: '95%' },

  // Section
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 24, marginBottom: 8, paddingLeft: 4 },
  card: { borderRadius: 20, overflow: 'hidden' },

  // Interactive option rows
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, minHeight: 56, position: 'relative' },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  optionContent: { flex: 1, marginRight: 8 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  optionTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginRight: 8 },
  optionDesc: { fontSize: 13, fontWeight: '500' },
  rowDivider: { position: 'absolute', bottom: 0, left: 64, right: 16, height: StyleSheet.hairlineWidth },

  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },

  // Security notice — accent bar style
  securityNotice: { flexDirection: 'row', borderRadius: 14, marginTop: 28, overflow: 'hidden' },
  securityAccent: { width: 3 },
  securityContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingLeft: 12, gap: 10 },
  securityText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '400' },

  // Rename sheet
  renameContainer: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  renameSaveButton: { height: 50, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  renameSaveText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  renameError: { fontSize: 13, fontWeight: '500', marginTop: -4 },
});
