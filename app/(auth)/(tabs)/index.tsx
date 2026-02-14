import '../../../shim';
import React, { useEffect, useCallback, useRef, useState, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Pressable,
  Dimensions,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  withSpring,
  withTiming,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import { useWalletStore, usePriceStore, useSettingsStore, useSyncStore, useMultiWalletStore } from '../../../src/stores';
import { logger } from '../../../src/utils/logger';
import { useTheme, useCopyFeedback, useConnectionState } from '../../../src/hooks';
import { FORMATTING, THEME, BITCOIN_UNITS } from '../../../src/constants';
import { PriceAPI } from '../../../src/services/api/PriceAPI';
import { formatUnitAmount, getUnitSymbol } from '../../../src/utils/formatting';
import { WalletSyncManager } from '../../../src/services/sync/WalletSyncManager';
import { SyncDetailsSheet, WalletSwitcherSheet } from '../../../src/components/wallet';
import { TransactionRow as UnifiedTransactionRow } from '../../../src/components/bitcoin';

import type { DetailedTransactionInfo } from '../../../src/types';

// Animated Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Hints & Tips ──────────────────────────────────────────────

const TIPS = [
  'Send & receive Bitcoin quickly',
  'Create multi-signature vaults',
  'Full coin control with UTXO management',
  'Watch-only wallets for cold storage',
  'Custom Electrum server support',
  'Automatic iCloud encrypted backups',
  'BIP39 passphrase support',
  'Batch transactions to save on fees',
  'Address book for frequent recipients',
  'Built-in transaction fee estimator',
  'Sign & verify messages on-chain',
  'Export descriptors for any wallet',
  'Nearby peer-to-peer payments via Bluetooth',
  'Replace-by-fee (RBF) for stuck transactions',
  'Full transaction history with labels',
  'Taproot, SegWit, and Legacy address support',
  'Hardware wallet compatibility',
  'Advanced fee control per transaction',
  'Privacy mode to hide balances',
  'Import wallets from seed, xprv, or WIF',
  'PDF export for transactions and addresses',

  'Child pays for parent (CPFP) support',
  'Encrypted local storage for keys',
  'Multiple wallets in a single app',
];

const TYPEWRITER_CHAR_MS = 28;
const TIP_PAUSE_MS = 1200;

const TypewriterTips = memo(({ isDark }: { isDark: boolean }) => {
  const [tipIndex, setTipIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tip = TIPS[tipIndex];
  const displayText = tip.slice(0, charIndex);
  const isTyping = charIndex < tip.length;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (charIndex < tip.length) {
      // Still typing — advance one character
      timerRef.current = setTimeout(() => {
        setCharIndex(c => c + 1);
      }, TYPEWRITER_CHAR_MS);
    } else {
      // Finished typing — pause then move to next tip
      timerRef.current = setTimeout(() => {
        setTipIndex(i => (i + 1) % TIPS.length);
        setCharIndex(0);
      }, TIP_PAUSE_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [charIndex, tipIndex, tip.length]);

  const chipBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
  const borderColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
  const textColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)';
  const cursorColor = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';

  return (
    <View style={tipStyles.container}>
      <View style={[tipStyles.chip, { backgroundColor: chipBg, borderColor }]}>
        <Ionicons
          name="sparkles"
          size={13}
          color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'}
          style={tipStyles.icon}
        />
        <Text style={[tipStyles.text, { color: textColor }]} numberOfLines={1}>
          {displayText}
          {isTyping && <Text style={{ color: cursorColor, fontWeight: '300' }}>|</Text>}
        </Text>
      </View>
    </View>
  );
});

const tipStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: 24,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 40,
    minWidth: 240,
  },
  icon: {
    marginRight: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
});

// ─── Dashboard ──────────────────────────────────────────────────

export default function DashboardScreen() {
  const renderStartRef = useRef(Date.now());
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const balance = useWalletStore(s => s.balance);
  const addresses = useWalletStore(s => s.addresses);
  const network = useWalletStore(s => s.network);
  const cachedTransactions = useWalletStore(s => s.transactions);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);
  const fetchPrice = usePriceStore(s => s.fetchPrice);
  const lastUpdated = usePriceStore(s => s.lastUpdated);
  const denomination = useSettingsStore(s => s.denomination);
  const setDenomination = useSettingsStore(s => s.setDenomination);
  const discreetMode = useSettingsStore(s => s.discreetMode);
  const setDiscreetMode = useSettingsStore(s => s.setDiscreetMode);
  const syncState = useSyncStore(s => s.syncState);
  const failSyncing = useSyncStore(s => s.failSyncing);
  const lastSyncTime = useSyncStore(s => s.lastSyncTime);
  const { copied, copy } = useCopyFeedback();
  const connection = useConnectionState();

  const [refreshing, setRefreshing] = useState(false);
  const [recentTxs, setRecentTxs] = useState<DetailedTransactionInfo[]>([]);
  const [showSyncSheet, setShowSyncSheet] = useState(false);
  const [showWalletSwitcher, setShowWalletSwitcher] = useState(false);
  const [showFiat, setShowFiat] = useState(false);

  const getActiveWallet = useMultiWalletStore(s => s.getActiveWallet);
  const hasMultipleWallets = useMultiWalletStore(s => s.hasMultipleWallets);
  const activeWallet = getActiveWallet();
  const pendingTxCount = useMemo(() => recentTxs.filter(tx => !tx.confirmed).length, [recentTxs]);
  const txsRef = useRef<DetailedTransactionInfo[]>([]);
  const ownAddressSet = useMemo(() => new Set(addresses.map(a => a.address)), [addresses]);
  const hasDetectedBestType = useRef(false);

  // Log dashboard render + mount time
  useEffect(() => {
    const mountTime = Date.now() - renderStartRef.current;
    logger.info('Dashboard', `Mounted in ${mountTime}ms`);
  }, []);

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    try {
      const walletId = useWalletStore.getState().walletId;
      // Cancel + restart full sync via WalletSyncManager + fetch price in parallel
      await Promise.allSettled([
        walletId
          ? WalletSyncManager.shared().refreshWallet(walletId)
          : Promise.resolve(),
        fetchPrice(),
      ]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      failSyncing(error instanceof Error ? error.message : 'Sync failed');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRefreshing(false);
    }
  }, [fetchPrice, failSyncing]);

  useEffect(() => {
    if (cachedTransactions && cachedTransactions.length > 0) {
      txsRef.current = cachedTransactions.slice(0, 10);
      setRecentTxs(txsRef.current);
    } else {
      txsRef.current = [];
      setRecentTxs([]);
    }
  }, [cachedTransactions]);

  const prevBalanceRef = useRef(balance.total);
  useEffect(() => {
    prevBalanceRef.current = balance.total;
  }, [balance.total]);

  useEffect(() => {
    if (addresses.length > 0) {
      const walletId = useWalletStore.getState().walletId;
      if (walletId) {
        WalletSyncManager.shared().triggerSync(walletId, 'foreground').catch(() => {});
      }
    }
    fetchPrice().catch(() => {});
    // Price polling only — balance updates come from subscriptions
    const priceInterval = setInterval(() => { fetchPrice().catch(() => {}); }, 60000);
    return () => { clearInterval(priceInterval); };
  }, [addresses.length]);

  // After first sync, detect best address type for imported wallets
  useEffect(() => {
    if (hasDetectedBestType.current) return;
    if (syncState !== 'synced') return;
    if (!activeWallet) return;
    // Only for imported HD wallets — 'hd' type covers all mnemonic imports
    // Created wallets already default to native_segwit which is correct
    if (activeWallet.type !== 'hd') return;
    // Check if this wallet was just imported (has balance or tx activity)
    const walletStore = useWalletStore.getState();
    const bestType = walletStore.detectBestAddressType();
    if (bestType !== walletStore.preferredAddressType) {
      walletStore.setPreferredAddressType(bestType);
    }
    hasDetectedBestType.current = true;
  }, [syncState, activeWallet]);

  // Format helpers
  const unitInfo = BITCOIN_UNITS[denomination];
  const formatUnitBalance = (sats: number) => formatUnitAmount(sats, denomination, false);
  const formatFiatBalance = (sats: number) => {
    if (!price) return '---';
    return PriceAPI.formatPrice((sats / FORMATTING.SATS_PER_BTC) * price, currency);
  };

  // Balance transition animation
  const balanceOpacity = useSharedValue(1);
  const balanceScale = useSharedValue(1);
  const balanceTranslateY = useSharedValue(0);

  const balanceAnimStyle = useAnimatedStyle(() => ({
    opacity: balanceOpacity.value,
    transform: [
      { scale: balanceScale.value },
      { translateY: balanceTranslateY.value },
    ],
  }));

  const handleBalanceTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Animate out
    balanceOpacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.ease) });
    balanceScale.value = withTiming(0.95, { duration: 120, easing: Easing.out(Easing.ease) });
    balanceTranslateY.value = withTiming(-6, { duration: 120, easing: Easing.out(Easing.ease) });
    // Toggle between chosen unit and fiat
    setTimeout(() => {
      setShowFiat(prev => !prev);
      balanceScale.value = 1.03;
      balanceTranslateY.value = 6;
      balanceOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
      balanceScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
      balanceTranslateY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) });
    }, 130);
  };

  const handleBalanceLongPress = async () => {
    const text = showFiat
      ? formatFiatBalance(balance.total)
      : `${formatUnitBalance(balance.total)} ${unitInfo.symbol}`;
    await copy(text);
  };

  const getSyncStatusColor = () => {
    // If the ElectrumClient FSM reports 'ready' (real TCP connection alive),
    // show green even if syncState hasn't caught up yet (e.g. after foreground)
    if (connection.isConnected && syncState !== 'offline') {
      if (syncState === 'syncing') return THEME.syncStatus.syncing;
      return THEME.syncStatus.synced;
    }
    switch (syncState) {
      case 'synced': return THEME.syncStatus.synced;
      case 'syncing': return THEME.syncStatus.syncing;
      case 'not_synced': return THEME.syncStatus.notSynced;
      case 'offline': return THEME.syncStatus.offline;
      default: return colors.textMuted;
    }
  };

  const formatSyncTime = () => {
    if (!lastSyncTime) return '';
    const diff = Math.floor(Date.now() / 1000) - Math.floor(lastSyncTime / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // Action handlers
  const handleSend = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(auth)/send');
  };
  const handleReceive = async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/receive'); };
  const handleScan = async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/scan'); };

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // Scroll tracking for collapsible navbar
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Navbar appears after scrolling past the balance area (~160px)
  const NAVBAR_THRESHOLD = 160;
  const navbarAnimStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [NAVBAR_THRESHOLD - 40, NAVBAR_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollY.value,
      [NAVBAR_THRESHOLD - 40, NAVBAR_THRESHOLD],
      [-8, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  // Compact balance text for navbar
  const getCompactBalance = () => {
    if (discreetMode) return '••••••';
    if (showFiat) return formatFiatBalance(balance.total);
    return `${formatUnitBalance(balance.total)} ${unitInfo.symbol}`;
  };

  const getSyncLabel = () => {
    // If ElectrumClient is connected, show positive label even if sync pipeline
    // hasn't completed yet (avoids flashing "Not synced" on foreground)
    if (connection.isConnected && syncState !== 'offline') {
      if (syncState === 'syncing') return 'Syncing';
      return 'Synced';
    }
    switch (syncState) {
      case 'synced': return 'Synced';
      case 'syncing': return 'Syncing';
      case 'not_synced': return 'Not synced';
      case 'offline': return 'Offline';
      default: return '';
    }
  };

  // Price change
  // Price change data available via change24h if needed in future

  // ActionCircle defined at module level below (ActionCircleMemo)

  // Transaction row press handler
  const handleTxPress = useCallback(async (tx: DetailedTransactionInfo) => {
    await Haptics.selectionAsync();
    router.push({ pathname: '/(auth)/transaction-details', params: { txData: JSON.stringify(tx) } });
  }, [router]);

  // FlatList renderItem for recent transactions
  const renderTxItem = useCallback(({ item, index }: { item: DetailedTransactionInfo; index: number }) => (
    <UnifiedTransactionRow
      key={item.txid}
      tx={item}
      ownAddresses={ownAddressSet}
      onPress={handleTxPress}
      showDivider={index !== recentTxs.length - 1}
    />
  ), [ownAddressSet, handleTxPress, recentTxs.length]);

  const txKeyExtractor = useCallback((item: DetailedTransactionInfo) => item.txid, []);

  // Empty state when no wallets exist
  if (!activeWallet) {
    return (
      <View style={styles.container}>
        <View style={[styles.emptyRoot, { paddingTop: insets.top + 60 }]}>
          {/* Decorative rings */}
          <View style={styles.emptyRings}>
            <Animated.View
              entering={FadeInDown.duration(600).delay(100)}
              style={[styles.emptyRing3, {
                borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }]}
            />
            <Animated.View
              entering={FadeInDown.duration(600).delay(50)}
              style={[styles.emptyRing2, {
                borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
              }]}
            />
            <Animated.View
              entering={FadeInDown.duration(500)}
              style={[styles.emptyIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
              }]}
            >
              <Ionicons name="diamond" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
            </Animated.View>
          </View>

          <Animated.Text
            entering={FadeInDown.duration(500).delay(150)}
            style={[styles.emptyTitle, { color: colors.text }]}
          >
            Welcome to Satryn
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.duration(500).delay(200)}
            style={[styles.emptySubtitle, {
              color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
            }]}
          >
            Your self-custody Bitcoin wallet.{'\n'}Create or import to get started.
          </Animated.Text>

          {/* Feature pills */}
          <Animated.View entering={FadeInDown.duration(500).delay(280)} style={styles.featurePills}>
            {[
              { icon: 'shield-checkmark-outline' as const, label: 'Self-custody' },
              { icon: 'eye-off-outline' as const, label: 'Private' },
              { icon: 'hardware-chip-outline' as const, label: 'Open source' },
            ].map((item) => (
              <View
                key={item.label}
                style={[styles.featurePill, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                }]}
              >
                <Ionicons name={item.icon} size={13} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'} />
                <Text style={[styles.featurePillText, {
                  color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)',
                }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </Animated.View>

          {/* Action buttons — onboarding style */}
          <Animated.View entering={FadeInDown.duration(500).delay(350)} style={styles.emptyActions}>
            <TouchableOpacity
              onPress={() => router.push('/(onboarding)/create')}
              activeOpacity={0.85}
              style={[styles.emptyBtnPrimary, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
            >
              <Text style={[styles.emptyBtnPrimaryText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
                Create New Wallet
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(onboarding)/import')}
              activeOpacity={0.8}
              style={[styles.emptyBtnSecondary, {
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
              }]}
            >
              <Text style={[styles.emptyBtnSecondaryText, {
                color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
              }]}>
                Import Wallet
              </Text>
            </TouchableOpacity>

            <View style={styles.emptyChips}>
              <TouchableOpacity
                onPress={() => router.push('/(onboarding)/recover-icloud')}
                activeOpacity={0.7}
                style={[styles.emptyChip, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}
              >
                <Ionicons name="cloud-download" size={13} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.emptyChipText, {
                  color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
                }]}>iCloud</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/(onboarding)/multisig-intro')}
                activeOpacity={0.7}
                style={[styles.emptyChip, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}
              >
                <Ionicons name="people" size={13} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.emptyChipText, {
                  color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
                }]}>Multisig</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/(auth)/import-watch-only')}
                activeOpacity={0.7}
                style={[styles.emptyChip, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}
              >
                <Ionicons name="eye" size={13} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.emptyChipText, {
                  color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
                }]}>Watch-Only</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Typewriter hints */}
          <Animated.View entering={FadeInDown.duration(500).delay(500)}>
            <TypewriterTips isDark={isDark} />
          </Animated.View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 100 }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFFFFF' : '#000000'} colors={['#000000']} progressBackgroundColor={isDark ? '#1A1A1A' : '#F5F5F5'} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header — minimal: wallet name + sync dot */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.walletBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowWalletSwitcher(true); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.walletName, { color: colors.textSecondary }]} numberOfLines={1}>
              {activeWallet?.name || 'Personal Wallet'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={styles.headerRightActions}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDiscreetMode(!discreetMode); }}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name={discreetMode ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSyncSheet(true); }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.syncCapsule, { backgroundColor: `${getSyncStatusColor()}18` }]}>
                <View style={[styles.syncDot, { backgroundColor: getSyncStatusColor() }]} />
                <Text style={[styles.syncCapsuleText, { color: getSyncStatusColor() }]}>{getSyncLabel()}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Balance — centered, dominant, with transition animation */}
        <TouchableOpacity
          style={styles.balanceArea}
          onPress={handleBalanceTap}
          onLongPress={handleBalanceLongPress}
          delayLongPress={400}
          activeOpacity={1}
        >
          <Animated.View style={[styles.balanceAnimWrap, balanceAnimStyle]}>
            {discreetMode ? (
              <>
                <Text style={[styles.balanceMain, { color: colors.text }]}>••••••</Text>
                <Text style={[styles.balanceSecondary, { color: colors.textTertiary }]}>Discreet Mode</Text>
              </>
            ) : showFiat ? (
              <>
                <Text style={[styles.balanceMain, { color: colors.text }]} adjustsFontSizeToFit minimumFontScale={0.4} numberOfLines={1}>
                  {formatFiatBalance(balance.total)}
                </Text>
                <Text style={[styles.balanceSecondary, { color: colors.textTertiary }]}>
                  {formatUnitBalance(balance.total)} {unitInfo.symbol}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.balanceRow}>
                  <Text style={[styles.balanceMain, { color: colors.text }]} adjustsFontSizeToFit minimumFontScale={0.4} numberOfLines={1}>
                    {formatUnitBalance(balance.total)}
                  </Text>
                  <Text style={[styles.balanceUnit, { color: colors.textTertiary }]}>{unitInfo.symbol}</Text>
                </View>
                <Text style={[styles.balanceSecondary, { color: colors.textTertiary }]}>
                  {formatFiatBalance(balance.total)}
                </Text>
              </>
            )}
          </Animated.View>
          {/* Sync status */}
          <Text style={[styles.syncLabel, { color: copied ? '#30D158' : colors.textTertiary }]}>
            {copied ? 'Copied!' : syncState === 'syncing' ? 'Syncing\u2026' : (syncState === 'synced' || connection.isConnected) && lastSyncTime ? `Updated ${formatSyncTime()}` : ''}
          </Text>
        </TouchableOpacity>

        {/* Bitcoin price capsule — tappable */}
        {price != null && (
          <TouchableOpacity
            style={[styles.priceCapsule, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(auth)/bitcoin-details');
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.priceCapsuleText, { color: colors.textTertiary }]}>
              BTC ≈ {PriceAPI.formatPrice(price, currency)}
            </Text>
          </TouchableOpacity>
        )}

        {/* Action circles — centered row */}
        <View style={styles.actionRow}>
          <ActionCircle icon="arrow-up" label="Send" onPress={handleSend} styles={styles} isDark={isDark} textColor={colors.text} mutedColor={colors.textMuted} />
          <ActionCircle icon="arrow-down" label="Receive" onPress={handleReceive} styles={styles} isDark={isDark} textColor={colors.text} mutedColor={colors.textMuted} />
          <ActionCircle icon="scan-outline" label="Scan" onPress={handleScan} styles={styles} isDark={isDark} textColor={colors.text} mutedColor={colors.textMuted} />
        </View>

        {/* Transactions section */}
        {recentTxs.length > 0 ? (
          <View style={[
            styles.txCard,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }
          ]}>
            <View style={styles.txCardHeader}>
              <Text style={[styles.txCardTitle, { color: colors.text }]}>Recent Activity</Text>
              <TouchableOpacity
                onPress={() => { Haptics.selectionAsync(); router.push('/(auth)/transactions'); }}
                activeOpacity={0.7}
                style={[styles.seeAllCapsule, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
              >
                <Text style={[styles.txCardAction, { color: colors.textTertiary }]}>See all</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={recentTxs}
              renderItem={renderTxItem}
              keyExtractor={txKeyExtractor}
              scrollEnabled={false}
              initialNumToRender={5}
              maxToRenderPerBatch={3}
              windowSize={3}
            />
          </View>
        ) : (
          /* Premium empty state — standalone, no card */
          <Animated.View entering={FadeInDown.duration(500)} style={styles.emptyState}>
            <View style={[styles.emptyTxIconWrap, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
            }]}>
              <View style={[styles.emptyTxIconInner, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
              }]}>
                <Ionicons name="swap-vertical-outline" size={24} color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'} />
              </View>
            </View>
            <Text style={[styles.emptyTxTitle, { color: colors.text }]}>
              No activity yet
            </Text>
            <Text style={[styles.emptyTxSubtitle, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }]}>
              Transactions will appear here once{'\n'}you send or receive bitcoin.
            </Text>
            <TouchableOpacity
              style={[styles.emptyTxBtn, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              }]}
              onPress={handleReceive}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-down" size={16} color={colors.text} />
              <Text style={[styles.emptyTxBtnText, { color: colors.text }]}>
                Receive Bitcoin
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </Animated.ScrollView>

      {/* Collapsible navbar — appears when balance scrolls off screen */}
      <Animated.View style={[styles.navbar, { paddingTop: insets.top }, navbarAnimStyle]}>
        <View style={styles.navbarInner}>
          <Text style={[styles.navbarBalance, { color: colors.text }]} numberOfLines={1}>
            {getCompactBalance()}
          </Text>
          <View style={[styles.navbarSyncCapsule, { backgroundColor: `${getSyncStatusColor()}18` }]}>
            <View style={[styles.navbarSyncDot, { backgroundColor: getSyncStatusColor() }]} />
            <Text style={[styles.navbarSyncText, { color: getSyncStatusColor() }]}>
              {getSyncLabel()}
            </Text>
          </View>
        </View>
      </Animated.View>

      <SyncDetailsSheet visible={showSyncSheet} onClose={() => setShowSyncSheet(false)} />
      <WalletSwitcherSheet visible={showWalletSwitcher} onClose={() => setShowWalletSwitcher(false)} />

    </View>
  );
}

// Circular action button (Strike/Revolut/Phantom style) — extracted to module level to avoid re-allocation per render
const ActionCircle = memo(({ icon, label, onPress, styles, isDark, textColor, mutedColor }: {
  icon: string; label: string; onPress: () => void;
  styles: any; isDark: boolean; textColor: string; mutedColor: string;
}) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      style={[styles.actionCircleWrap, animatedStyle]}
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.9, { damping: 15, stiffness: 300 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
    >
      <View style={[styles.actionCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
        <Ionicons name={icon as any} size={22} color={textColor} />
      </View>
      <Text style={[styles.actionCircleLabel, { color: mutedColor }]}>{label}</Text>
    </AnimatedPressable>
  );
});

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 24,
    },

    // Collapsible navbar — fixed at top
    navbar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderBottomWidth: 0.5,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      zIndex: 100,
    },
    navbarInner: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    navbarBalance: {
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'] as any,
      flexShrink: 1,
    },
    navbarSyncCapsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
    },
    navbarSyncDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    navbarSyncText: {
      fontSize: 12,
      fontWeight: '600',
    },

    // Header — ultra minimal
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 40,
    },
    walletBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    walletName: {
      fontSize: 15,
      fontWeight: '500',
      maxWidth: 180,
    },
    headerRightActions: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 14,
    },
    syncCapsule: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
    },
    syncDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    syncCapsuleText: {
      fontSize: 12,
      fontWeight: '600' as const,
    },

    // Balance — centered, massive, Strike-style
    balanceArea: {
      alignItems: 'center',
      marginBottom: 36,
    },
    balanceAnimWrap: {
      alignItems: 'center',
    },
    balanceRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 8,
    },
    balanceMain: {
      fontSize: 56,
      fontWeight: '700',
      letterSpacing: -2.5,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
      flexShrink: 1,
    },
    balanceUnit: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 2,
    },
    balanceSecondary: {
      fontSize: 16,
      fontWeight: '500',
      marginTop: 4,
    },
    syncLabel: {
      fontSize: 11,
      marginTop: 6,
    },

    // Bitcoin price capsule
    priceCapsule: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 20,
      marginBottom: 32,
    },
    priceCapsuleText: {
      fontSize: 13,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    priceCapsuleChange: {
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },

    // Action circles — Strike/Revolut style
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 32,
      marginBottom: 48,
    },
    actionCircleWrap: {
      alignItems: 'center',
      gap: 8,
    },
    actionCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionCircleLabel: {
      fontSize: 12,
      fontWeight: '500',
    },

    // Transaction card with header inside
    txCard: {
      borderRadius: 20,
      overflow: 'hidden',
    },
    txCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
    },
    txCardTitle: {
      fontSize: 20,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    seeAllCapsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 5,
      paddingLeft: 12,
      paddingRight: 8,
      borderRadius: 14,
    },
    txCardAction: {
      fontSize: 13,
      fontWeight: '500',
    },

    // Full-screen empty state (no wallets) — premium
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
      marginBottom: 24,
    },
    featurePills: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 32,
    },
    featurePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 6,
      paddingHorizontal: 11,
      borderRadius: 20,
    },
    featurePillText: {
      fontSize: 12,
      fontWeight: '500',
    },
    emptyActions: {
      width: '100%',
      gap: 10,
    },
    emptyBtnPrimary: {
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyBtnPrimaryText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    emptyBtnSecondary: {
      height: 46,
      borderRadius: 13,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyBtnSecondaryText: {
      fontSize: 15,
      fontWeight: '600',
    },
    emptyChips: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 10,
      marginTop: 4,
    },
    emptyChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 22,
    },
    emptyChipText: {
      fontSize: 13,
      fontWeight: '600',
    },

    // In-page empty state (has wallet, no transactions) — premium
    emptyState: {
      alignItems: 'center',
      paddingVertical: 48,
      paddingHorizontal: 32,
    },
    emptyTxIconWrap: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    emptyTxIconInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTxTitle: {
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: -0.3,
      marginBottom: 6,
    },
    emptyTxSubtitle: {
      fontSize: 14,
      fontWeight: '400',
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 24,
    },
    emptyTxBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 11,
      paddingHorizontal: 20,
      borderRadius: 20,
    },
    emptyTxBtnText: {
      fontSize: 14,
      fontWeight: '600',
    },

  });
