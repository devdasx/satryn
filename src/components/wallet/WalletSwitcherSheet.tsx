/**
 * WalletSwitcherSheet
 *
 * Premium wallet management sheet built on the unified AppBottomSheet.
 *
 * Features:
 * - Portfolio summary with total balance across all wallets
 * - Active wallet highlighted with accent border
 * - Sync status indicators per wallet (dot color)
 * - Type-specific iconography (HD, imported key, multisig, watch-only)
 * - Animated press feedback with Reanimated spring
 * - Long-press debug copy (development helper)
 * - Empty state with illustration
 * - Responsive sizing: auto-height for ≤5 wallets, scrollable for more
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { SheetPrimaryButton } from '../ui/SheetComponents';
import {
  useMultiWalletStore,
  useWalletStore,
  useSettingsStore,
  getSyncStatusInfo,
  formatLastSyncTime,
  type WalletInfo,
  type WalletType,
} from '../../stores';
import { usePriceStore } from '../../stores/priceStore';
import { useTheme } from '../../hooks';
import { FORMATTING, BITCOIN_UNITS } from '../../constants';
import { PriceAPI } from '../../services/api/PriceAPI';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import type { BitcoinUnit } from '../../types';
import { WalletDatabase } from '../../services/database/WalletDatabase';
import { SecureStorage } from '../../services/storage/SecureStorage';

// ─── Props ───────────────────────────────────────────────────────

interface WalletSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatBalanceValue(sats: number, denomination: BitcoinUnit): string {
  return formatUnitAmount(sats, denomination, false);
}

function formatBalanceUnitLabel(denomination: BitcoinUnit): string {
  return getUnitSymbol(denomination);
}

type WalletTypeInfo = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

function getWalletTypeInfo(type: WalletType): WalletTypeInfo {
  switch (type) {
    case 'watch_xpub':
    case 'watch_descriptor':
    case 'watch_addresses':
      return { label: 'Watch-only', icon: 'eye-outline', color: '#5AC8FA' };
    case 'multisig':
      return { label: 'Multisig Vault', icon: 'shield-checkmark-outline', color: '#BF5AF2' };
    case 'imported_key':
    case 'imported_keys':
      return { label: 'Imported Key', icon: 'key-outline', color: '#FF9F0A' };
    case 'hd_xprv':
      return { label: 'Extended Key', icon: 'git-branch-outline', color: '#30D158' };
    case 'hd_seed':
      return { label: 'Seed Bytes', icon: 'finger-print-outline', color: '#30D158' };
    case 'hd_descriptor':
      return { label: 'Descriptor', icon: 'code-slash-outline', color: '#30D158' };
    case 'hd_electrum':
      return { label: 'Electrum', icon: 'flash-outline', color: '#FFD60A' };
    case 'hd':
    default:
      return { label: 'HD Wallet', icon: 'wallet-outline', color: '#30D158' };
  }
}

// ─── Main Component ──────────────────────────────────────────────

export function WalletSwitcherSheet({ visible, onClose }: WalletSwitcherSheetProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const { wallets, activeWalletId, setActiveWallet } = useMultiWalletStore();
  const switchToWallet = useWalletStore(s => s.switchToWallet);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingWalletId, setSwitchingWalletId] = useState<string | null>(null);

  // ─── Derived data ──────────────────────────────────────────────

  const activeWallet = useMemo(
    () => wallets.find(w => w.id === activeWalletId) ?? null,
    [wallets, activeWalletId],
  );

  const otherWallets = useMemo(
    () => wallets.filter(w => w.id !== activeWalletId),
    [wallets, activeWalletId],
  );

  // ─── Handlers ──────────────────────────────────────────────────

  const handleSelectWallet = useCallback(async (wallet: WalletInfo) => {
    if (wallet.id === activeWalletId || isSwitching) {
      if (wallet.id === activeWalletId) onClose();
      return;
    }

    setSwitchingWalletId(wallet.id);
    setIsSwitching(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const success = await switchToWallet(wallet.id);
      if (success) {
        await setActiveWallet(wallet.id);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      } else {
        const storeError = useWalletStore.getState().error;
        Alert.alert('Error', storeError || 'Failed to switch wallet.');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to switch wallet.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSwitching(false);
      setSwitchingWalletId(null);
    }
  }, [activeWalletId, isSwitching, switchToWallet, setActiveWallet, onClose]);

  const handleAddWallet = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    router.push('/(auth)/wallet-hub');
  }, [onClose, router]);

  // ─── Debug: Long-press to copy wallet JSON ─────────────────────

  const handleCopyWalletFile = useCallback(async (wallet: WalletInfo) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const debug: Record<string, any> = {
        _debug: true,
        _walletId: wallet.id,
        _walletName: wallet.name,
        _walletType: wallet.type,
        _timestamp: new Date().toISOString(),
      };

      try {
        const db = WalletDatabase.shared();
        const dbWallet = db.getWallet(wallet.id);
        if (dbWallet) {
          const addresses = db.getAddresses(wallet.id);
          const utxos = db.getUtxos(wallet.id);
          const txs = db.getTransactions(wallet.id);

          debug.dbWallet = {
            ...dbWallet,
            mnemonic: dbWallet.mnemonic ? '[REDACTED]' : null,
            masterXprv: dbWallet.masterXprv ? '[REDACTED]' : null,
            seedHex: dbWallet.seedHex ? '[REDACTED]' : null,
          };
          debug.dbAddresses = `[${addresses.length} addresses]`;
          debug.dbUtxos = {
            count: utxos.length,
            totalValue: utxos.reduce((s: number, u: any) => s + (u.valueSat || 0), 0),
          };
          debug.dbTransactions = { count: txs.length };
        }
      } catch (e) {
        debug.dbError = e instanceof Error ? e.message : String(e);
      }

      try {
        const perWallet = await SecureStorage.getWalletMetadataById<any>(wallet.id);
        debug.perWalletMeta = perWallet;
      } catch (e) {
        debug.perWalletMetaError = e instanceof Error ? e.message : String(e);
      }

      try {
        const legacy = await SecureStorage.getWalletMetadata<any>();
        debug.legacyMeta = legacy;
      } catch (e) {
        debug.legacyMetaError = e instanceof Error ? e.message : String(e);
      }

      if (wallet.type === 'multisig' || wallet.id.startsWith('multisig-')) {
        const timestampMatch = wallet.id.match(/multisig-(\d+)/);
        const candidateIds = [0, 1, 2];
        if (timestampMatch) candidateIds.push(Number(timestampMatch[1]));
        const msConfigs: Record<string, any> = {};
        for (const accId of candidateIds) {
          try {
            const cfg = await SecureStorage.getMultisigConfig<any>(accId);
            if (cfg) msConfigs[`account_${accId}`] = cfg;
          } catch {}
        }
        debug.multisigConfigs = Object.keys(msConfigs).length > 0 ? msConfigs : 'none found';
      }

      const zustandState = useWalletStore.getState();
      debug.zustandState = {
        walletId: zustandState.walletId,
        isMultisig: zustandState.isMultisig,
        addressCount: zustandState.addresses?.length ?? 0,
        balance: zustandState.balance,
        utxoCount: zustandState.utxos?.length ?? 0,
        txCount: zustandState.transactions?.length ?? 0,
      };

      const json = JSON.stringify(debug, null, 2);
      await Clipboard.setStringAsync(json);
      if (__DEV__) {
        Alert.alert('Debug Copied', `"${wallet.name}" debug copied (${json.length} chars)`);
      }
    } catch (e) {
      Alert.alert('Error', `Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ─── Sizing ────────────────────────────────────────────────────

  const sheetSizing = useMemo(() => {
    if (wallets.length > 5) return ['auto', 'large'] as ('auto' | 'large')[];
    return 'auto' as const;
  }, [wallets.length]);

  // ─── Footer ────────────────────────────────────────────────────

  const footer = useMemo(() => (
    <View style={styles.footerContainer}>
      <SheetPrimaryButton label="Add Wallet" onPress={handleAddWallet} />
    </View>
  ), [handleAddWallet]);

  // ─── Render ────────────────────────────────────────────────────

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Wallets"
      subtitle={wallets.length === 0 ? 'No wallets' : wallets.length === 1 ? '1 wallet' : `${wallets.length} wallets`}
      sizing={sheetSizing}
      scrollable={wallets.length > 5}
      footer={footer}
      contentKey={`${wallets.length}-${activeWalletId}`}
    >
      <View style={styles.content}>

        {/* ─── Empty state ─────────────────────────────────── */}
        {wallets.length === 0 && (
          <Animated.View
            entering={FadeIn.duration(300)}
            style={styles.emptyState}
          >
            <View style={[styles.emptyIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            }]}>
              <Ionicons name="wallet-outline" size={36} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No wallets yet
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              Create or import your first Bitcoin wallet to get started.
            </Text>
          </Animated.View>
        )}

        {/* ─── Active wallet card ──────────────────────────── */}
        {activeWallet && (
          <Animated.View entering={FadeIn.delay(50).duration(250)}>
            {wallets.length >= 2 && (
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                ACTIVE
              </Text>
            )}
            <ActiveWalletCard
              wallet={activeWallet}
              isDark={isDark}
              colors={colors}
              denomination={denomination}
              price={price}
              currency={currency}
              onPress={() => onClose()}
              onLongPress={() => handleCopyWalletFile(activeWallet)}
            />
          </Animated.View>
        )}

        {/* ─── Other wallets ───────────────────────────────── */}
        {otherWallets.length > 0 && (
          <Animated.View entering={FadeIn.delay(100).duration(250)}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              {wallets.length >= 2 ? 'OTHER WALLETS' : 'WALLETS'}
            </Text>
            <View style={[styles.listCard, {
              backgroundColor: isDark ? colors.surfacePrimary : 'rgba(0,0,0,0.03)',
            }]}>
              {otherWallets.map((wallet, index) => (
                <WalletRow
                  key={wallet.id}
                  wallet={wallet}
                  index={index}
                  isLast={index === otherWallets.length - 1}
                  isSwitching={isSwitching}
                  isCurrentlySwitching={switchingWalletId === wallet.id}
                  isDark={isDark}
                  colors={colors}
                  denomination={denomination}
                  price={price}
                  currency={currency}
                  onPress={() => handleSelectWallet(wallet)}
                  onLongPress={() => handleCopyWalletFile(wallet)}
                />
              ))}
            </View>
          </Animated.View>
        )}

      </View>
    </AppBottomSheet>
  );
}

// ─── Active Wallet Card ──────────────────────────────────────────

function ActiveWalletCard({
  wallet,
  isDark,
  colors,
  denomination,
  price,
  currency,
  onPress,
  onLongPress,
}: {
  wallet: WalletInfo;
  isDark: boolean;
  colors: any;
  denomination: BitcoinUnit;
  price: number | null;
  currency: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const typeInfo = getWalletTypeInfo(wallet.type);
  const syncInfo = getSyncStatusInfo(wallet.syncStatus);
  const lastSync = formatLastSyncTime(wallet.lastSyncedAt);

  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const balanceValue = formatBalanceValue(wallet.balanceSat, denomination);
  const balanceUnit = formatBalanceUnitLabel(denomination);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={800}
        onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
        style={[styles.activeCard, {
          backgroundColor: isDark ? colors.surfacePrimary : 'rgba(0,0,0,0.03)',
        }]}
      >
        {/* Top row: icon + name + sync status */}
        <View style={styles.activeCardTop}>
          <View style={[styles.activeIcon, { backgroundColor: `${typeInfo.color}${isDark ? '1A' : '12'}` }]}>
            <Ionicons name={typeInfo.icon} size={22} color={typeInfo.color} />
          </View>
          <View style={styles.activeCardInfo}>
            <Text style={[styles.activeCardName, { color: colors.text }]} numberOfLines={1}>
              {wallet.name}
            </Text>
            <View style={styles.activeCardMeta}>
              <View style={[styles.syncDot, { backgroundColor: syncInfo.color }]} />
              <Text style={[styles.activeCardType, { color: colors.textMuted }]}>
                {typeInfo.label}
              </Text>
              {lastSync ? (
                <>
                  <Text style={[styles.metaSeparator, { color: colors.textDisabled }]}> · </Text>
                  <Text style={[styles.activeCardSync, { color: colors.textMuted }]}>
                    {lastSync}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={typeInfo.color} />
        </View>

        {/* Balance row */}
        <View style={[styles.activeCardBalanceRow, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        }]}>
          <Text style={[styles.activeCardBalanceLabel, { color: colors.textMuted }]}>
            Balance
          </Text>
          <View style={styles.activeCardBalanceValue}>
            <Text style={[styles.activeCardBalance, { color: colors.text }]}>
              {balanceValue}
            </Text>
            <Text style={[styles.activeCardUnit, { color: colors.textMuted }]}>
              {' '}{balanceUnit}
            </Text>
          </View>
        </View>

        {/* Pending indicator */}
        {wallet.unconfirmedSat > 0 && (
          <View style={styles.activeCardPending}>
            <Ionicons name="time-outline" size={12} color={colors.warning} />
            <Text style={[styles.activeCardPendingText, { color: colors.warning }]}>
              {formatBalanceValue(wallet.unconfirmedSat, denomination)} {balanceUnit} pending
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Wallet Row (for other wallets list) ─────────────────────────

function WalletRow({
  wallet,
  index,
  isLast,
  isSwitching,
  isCurrentlySwitching,
  isDark,
  colors,
  denomination,
  price,
  currency,
  onPress,
  onLongPress,
}: {
  wallet: WalletInfo;
  index: number;
  isLast: boolean;
  isSwitching: boolean;
  isCurrentlySwitching: boolean;
  isDark: boolean;
  colors: any;
  denomination: BitcoinUnit;
  price: number | null;
  currency: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const typeInfo = getWalletTypeInfo(wallet.type);
  const syncInfo = getSyncStatusInfo(wallet.syncStatus);

  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const balanceValue = formatBalanceValue(wallet.balanceSat, denomination);
  const balanceUnit = formatBalanceUnitLabel(denomination);

  return (
    <Animated.View
      style={animatedStyle}
      entering={FadeIn.delay(120 + index * 50).duration(200)}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={800}
        onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
        disabled={isSwitching && !isCurrentlySwitching}
        style={[
          styles.walletRow,
          (isSwitching && !isCurrentlySwitching) && { opacity: 0.35 },
        ]}
      >
        {/* Icon */}
        <View style={[styles.walletIcon, { backgroundColor: `${typeInfo.color}${isDark ? '18' : '10'}` }]}>
          <Ionicons name={typeInfo.icon} size={18} color={typeInfo.color} />
        </View>

        {/* Name + type */}
        <View style={styles.walletInfo}>
          <Text style={[styles.walletName, { color: colors.text }]} numberOfLines={1}>
            {wallet.name}
          </Text>
          <View style={styles.walletMeta}>
            <View style={[styles.syncDotSmall, { backgroundColor: syncInfo.color }]} />
            <Text style={[styles.walletType, { color: colors.textMuted }]}>
              {typeInfo.label}
            </Text>
          </View>
        </View>

        {/* Balance or spinner */}
        <View style={styles.walletBalance}>
          {isCurrentlySwitching ? (
            <ActivityIndicator size="small" color={typeInfo.color} />
          ) : (
            <View style={styles.balanceInline}>
              <Text style={[styles.balanceAmount, { color: colors.text }]}>
                {balanceValue}
              </Text>
              <Text style={[styles.balanceUnit, { color: colors.textMuted }]}>
                {' '}{balanceUnit}
              </Text>
            </View>
          )}
        </View>

        {/* Chevron */}
        <Ionicons
          name="chevron-forward"
          size={15}
          color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}
          style={{ marginLeft: 6 }}
        />
      </Pressable>

      {/* Divider */}
      {!isLast && (
        <View style={[styles.divider, {
          marginLeft: 68,
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        }]} />
      )}
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },

  footerContainer: {
    // SheetPrimaryButton handles its own styling
  },

  // ── Empty State ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 21,
  },

  // ── Section Label ──
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },

  // ── Active Wallet Card ──
  activeCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    marginBottom: 20,
  },
  activeCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  activeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  activeCardInfo: {
    flex: 1,
    marginRight: 8,
  },
  activeCardName: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  activeCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  activeCardType: {
    fontSize: 13,
    fontWeight: '400',
  },
  metaSeparator: {
    fontSize: 13,
  },
  activeCardSync: {
    fontSize: 13,
    fontWeight: '400',
  },
  activeCardBalanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activeCardBalanceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  activeCardBalanceValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  activeCardBalance: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  activeCardUnit: {
    fontSize: 13,
    fontWeight: '500',
  },
  activeCardPending: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 8,
  },
  activeCardPendingText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // ── Wallet Row (other wallets) ──
  listCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 4,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  walletInfo: {
    flex: 1,
    marginRight: 10,
  },
  walletName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  walletMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  walletType: {
    fontSize: 13,
    fontWeight: '400',
  },
  walletBalance: {
    alignItems: 'flex-end',
  },
  balanceInline: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceAmount: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  balanceUnit: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginRight: 14,
  },
});

export default WalletSwitcherSheet;
