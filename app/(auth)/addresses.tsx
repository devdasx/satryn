import '../../shim';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SectionList,
  RefreshControl,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/hooks';
import { useWalletStore, useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { AddressOptionsModal } from '../../src/components/bitcoin/AddressOptionsModal';
import { ADDRESS_TYPES, THEME } from '../../src/constants';
import { ElectrumAPI } from '../../src/services/electrum';
import { formatAmount, truncateAddress } from '../../src/utils/formatting';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import type { AddressInfo, AddressType, BalanceInfo } from '../../src/types';

// ─── Types ──────────────────────────────────────────────────────

type RoleFilter = 'all' | 'receiving' | 'change';
type FormatFilter = 'all' | AddressType;
type SortMode = 'index' | 'balance' | 'txCount' | 'recent';

interface AddressStats {
  balance: BalanceInfo;
  txCount: number;
}

interface AddressSection {
  title: string;
  data: AddressInfo[];
}

const ADDRESS_FORMAT_LABELS: Partial<Record<AddressType | 'all', string>> = {
  all: 'All Formats',
  native_segwit: 'Native SegWit',
  wrapped_segwit: 'Wrapped SegWit',
  legacy: 'Legacy',
  taproot: 'Taproot',
};

const SORT_MODE_LABELS: Record<SortMode, string> = {
  index: 'Index',
  balance: 'Balance',
  txCount: 'Tx Count',
  recent: 'Recent',
};

const STATS_CACHE_KEY = 'address_stats_cache_';
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Icon Colors ────────────────────────────────────────────────
// Semantic tinting for address role icons — matches settings/wallet design language.

const ROLE_ICON_COLORS = {
  receive: {
    light: { bg: 'rgba(52,199,89,0.10)', color: '#34C759' },
    dark:  { bg: 'rgba(48,209,88,0.18)', color: '#30D158' },
  },
  change: {
    light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' },
    dark:  { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' },
  },
};

// ─── Stats Cache Helpers ────────────────────────────────────────

interface CachedStatsData {
  stats: Record<string, AddressStats>;
  timestamp: number;
}

async function loadCachedStats(walletId: string): Promise<Map<string, AddressStats> | null> {
  try {
    const raw = await AsyncStorage.getItem(STATS_CACHE_KEY + walletId);
    if (!raw) return null;
    const parsed: CachedStatsData = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > STATS_CACHE_TTL) return null; // stale but still return for instant display
    const map = new Map<string, AddressStats>();
    for (const [k, v] of Object.entries(parsed.stats)) {
      map.set(k, v);
    }
    return map;
  } catch {
    return null;
  }
}

async function loadCachedStatsAny(walletId: string): Promise<Map<string, AddressStats> | null> {
  try {
    const raw = await AsyncStorage.getItem(STATS_CACHE_KEY + walletId);
    if (!raw) return null;
    const parsed: CachedStatsData = JSON.parse(raw);
    const map = new Map<string, AddressStats>();
    for (const [k, v] of Object.entries(parsed.stats)) {
      map.set(k, v);
    }
    return map;
  } catch {
    return null;
  }
}

async function saveCachedStats(walletId: string, stats: Map<string, AddressStats>) {
  try {
    const obj: Record<string, AddressStats> = {};
    stats.forEach((v, k) => { obj[k] = v; });
    const data: CachedStatsData = { stats: obj, timestamp: Date.now() };
    await AsyncStorage.setItem(STATS_CACHE_KEY + walletId, JSON.stringify(data));
  } catch {}
}

function isCacheStale(walletId: string): Promise<boolean> {
  return AsyncStorage.getItem(STATS_CACHE_KEY + walletId).then(raw => {
    if (!raw) return true;
    try {
      const parsed: CachedStatsData = JSON.parse(raw);
      return Date.now() - parsed.timestamp > STATS_CACHE_TTL;
    } catch { return true; }
  });
}

// ─── Component ──────────────────────────────────────────────────

export default function AddressesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const addresses = useWalletStore(s => s.addresses);
  const network = useWalletStore(s => s.network);
  const usedAddresses = useWalletStore(s => s.usedAddresses);
  const isMultisig = useWalletStore(s => s.isMultisig);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const utxos = useWalletStore(s => s.utxos);
  const transactions = useWalletStore(s => s.transactions);
  const denomination = useSettingsStore(s => s.denomination);
  const { getActiveWallet } = useMultiWalletStore();
  const activeWallet = getActiveWallet();
  const walletId = activeWallet?.id || 'default';

  // Wallet capabilities
  const isWatchOnly = activeWallet?.type === 'watch_xpub'
    || activeWallet?.type === 'watch_descriptor'
    || activeWallet?.type === 'watch_addresses';
  const showFormatFilter = !isMultisig;

  // ─── State ─────────────────────────
  const [selectedAddress, setSelectedAddress] = useState<AddressInfo | null>(null);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Filters (applied on confirm)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('index');

  // Temp filter state (for bottom sheet)
  const [tempRole, setTempRole] = useState<RoleFilter>('all');
  const [tempFormat, setTempFormat] = useState<FormatFilter>('all');
  const [tempSort, setTempSort] = useState<SortMode>('index');

  // Address stats cache
  const [statsMap, setStatsMap] = useState<Map<string, AddressStats>>(new Map());
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsReady, setStatsReady] = useState(false);
  const statsLoadedRef = useRef(false);
  const networkFetchingRef = useRef(false);

  // ─── Derived Colors ───────────────────
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const chipActiveBg = isDark ? THEME.brand.bitcoin : '#0A0A0A';
  const chipActiveText = '#FFFFFF';
  const searchBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
  const subtleText = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const greenColor = isDark ? '#30D158' : '#34C759';

  // ─── Instant stats from local UTXO + transaction data ─────────
  useEffect(() => {
    if (addresses.length === 0 || statsReady) return;

    // Build per-address balance from the wallet's UTXO set
    const localMap = new Map<string, AddressStats>();

    // Count per-address balance from UTXOs
    const balanceByAddr = new Map<string, { confirmed: number; unconfirmed: number }>();
    for (const utxo of utxos) {
      const prev = balanceByAddr.get(utxo.address) || { confirmed: 0, unconfirmed: 0 };
      if (utxo.confirmations > 0) {
        prev.confirmed += utxo.value;
      } else {
        prev.unconfirmed += utxo.value;
      }
      balanceByAddr.set(utxo.address, prev);
    }

    // Count per-address tx count from transaction inputs/outputs
    const txCountByAddr = new Map<string, Set<string>>();
    for (const tx of transactions) {
      const touchedAddrs = new Set<string>();
      for (const inp of tx.inputs || []) {
        if (inp.address) touchedAddrs.add(inp.address);
      }
      for (const out of tx.outputs || []) {
        if (out.address) touchedAddrs.add(out.address);
      }
      for (const addr of touchedAddrs) {
        if (!txCountByAddr.has(addr)) txCountByAddr.set(addr, new Set());
        txCountByAddr.get(addr)!.add(tx.txid);
      }
    }

    // Build stats map for addresses that have either balance or tx count
    for (const addr of addresses) {
      const bal = balanceByAddr.get(addr.address);
      const txSet = txCountByAddr.get(addr.address);
      if (bal || txSet) {
        localMap.set(addr.address, {
          balance: {
            confirmed: bal?.confirmed || 0,
            unconfirmed: bal?.unconfirmed || 0,
            total: (bal?.confirmed || 0) + (bal?.unconfirmed || 0),
          },
          txCount: txSet?.size || 0,
        });
      }
    }

    if (localMap.size > 0) {
      setStatsMap(localMap);
      setStatsReady(true);
      statsLoadedRef.current = true;
    }
  }, [addresses.length, utxos.length, transactions.length]);

  // ─── Cache-First Stats Loading ─────────
  const loadStats = useCallback(async (force = false) => {
    if (addresses.length === 0) return;

    // Step 1: Instantly load from cache
    if (!statsReady && !force) {
      const cached = await loadCachedStatsAny(walletId);
      if (cached && cached.size > 0) {
        setStatsMap(cached);
        setStatsReady(true);
        statsLoadedRef.current = true;
      }
    }

    // Step 2: Check if we need a network refresh
    const stale = await isCacheStale(walletId);
    if (!stale && !force && statsLoadedRef.current) return;

    // Prevent duplicate network fetches
    if (networkFetchingRef.current && !force) return;
    networkFetchingRef.current = true;
    setStatsLoading(true);

    const api = ElectrumAPI.shared(network);
    try {
      const newMap = new Map<string, AddressStats>();

      // Batch in chunks of 20
      const chunks: AddressInfo[][] = [];
      for (let i = 0; i < addresses.length; i += 20) {
        chunks.push(addresses.slice(i, i + 20));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (addr) => {
            if (!force && statsMap.has(addr.address)) {
              newMap.set(addr.address, statsMap.get(addr.address)!);
              return;
            }
            try {
              const [balance, history] = await Promise.all([
                api.getAddressBalance(addr.address),
                api.getAddressHistory(addr.address),
              ]);
              newMap.set(addr.address, { balance, txCount: history.length });
            } catch {
              newMap.set(addr.address, {
                balance: { confirmed: 0, unconfirmed: 0, total: 0 },
                txCount: 0,
              });
            }
          }),
        );
      }

      setStatsMap(newMap);
      setStatsReady(true);
      statsLoadedRef.current = true;

      // Persist to cache
      await saveCachedStats(walletId, newMap);
    } catch (err) {
      console.error('[Addresses] Failed to load stats:', err);
    } finally {
      api.disconnect();
      setStatsLoading(false);
      networkFetchingRef.current = false;
    }
  }, [addresses, network, walletId, statsMap, statsReady]);

  useEffect(() => {
    loadStats();
  }, [addresses.length]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats(true);
    setRefreshing(false);
  }, [loadStats]);

  // ─── Active filter count ──────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (roleFilter !== 'all') count++;
    if (formatFilter !== 'all') count++;
    if (sortMode !== 'index') count++;
    return count;
  }, [roleFilter, formatFilter, sortMode]);

  // ─── Filtering + Search + Sort ────────
  const filteredAddresses = useMemo(() => {
    let result = addresses;

    if (roleFilter === 'receiving') result = result.filter(a => !a.isChange);
    if (roleFilter === 'change') result = result.filter(a => a.isChange);

    if (formatFilter !== 'all' && showFormatFilter) {
      result = result.filter(a => a.type === formatFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(a => {
        if (a.address.toLowerCase().includes(q)) return true;
        if (a.path.toLowerCase().includes(q)) return true;
        if (a.label?.toLowerCase().includes(q)) return true;
        if (`#${a.index}`.includes(q)) return true;
        return false;
      });
    }

    result = [...result].sort((a, b) => {
      if (sortMode === 'balance') {
        const aStats = statsMap.get(a.address);
        const bStats = statsMap.get(b.address);
        return (bStats?.balance.total || 0) - (aStats?.balance.total || 0);
      }
      if (sortMode === 'txCount') {
        const aStats = statsMap.get(a.address);
        const bStats = statsMap.get(b.address);
        return (bStats?.txCount || 0) - (aStats?.txCount || 0);
      }
      if (sortMode === 'recent') {
        const aUsed = usedAddresses.has(a.address) ? 1 : 0;
        const bUsed = usedAddresses.has(b.address) ? 1 : 0;
        if (aUsed !== bUsed) return bUsed - aUsed;
        return b.index - a.index;
      }
      if (a.isChange !== b.isChange) return a.isChange ? 1 : -1;
      return a.index - b.index;
    });

    return result;
  }, [addresses, roleFilter, formatFilter, searchQuery, sortMode, statsMap, usedAddresses, showFormatFilter]);

  // Group into sections
  const sections = useMemo((): AddressSection[] => {
    if (isMultisig && multisigConfig) {
      const label = `${multisigConfig.m}-of-${multisigConfig.n} Multisig`;
      return filteredAddresses.length > 0
        ? [{ title: label, data: filteredAddresses }]
        : [];
    }

    if (formatFilter !== 'all' || sortMode !== 'index') {
      const filterLabel = searchQuery.trim()
        ? `Search Results (${filteredAddresses.length})`
        : formatFilter !== 'all'
          ? ADDRESS_FORMAT_LABELS[formatFilter] || 'Addresses'
          : 'All Addresses';
      return filteredAddresses.length > 0
        ? [{ title: filterLabel, data: filteredAddresses }]
        : [];
    }

    const groups = new Map<string, AddressInfo[]>();
    for (const addr of filteredAddresses) {
      const key = addr.type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(addr);
    }

    const order: AddressType[] = ['native_segwit', 'wrapped_segwit', 'legacy', 'taproot'];
    const result: AddressSection[] = [];
    for (const type of order) {
      const data = groups.get(type);
      if (data && data.length > 0) {
        result.push({ title: ADDRESS_FORMAT_LABELS[type] || type, data });
      }
    }
    return result;
  }, [filteredAddresses, filteredAddresses.length, formatFilter, sortMode, searchQuery, isMultisig, multisigConfig]);

  // Available address types
  const availableTypes = useMemo(() => {
    const types = new Set(addresses.map(a => a.type));
    return Array.from(types) as AddressType[];
  }, [addresses]);

  // ─── Handlers ─────────────────────────
  const handleAddressPress = useCallback((addr: AddressInfo) => {
    setSelectedAddress(addr);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedAddress(null);
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // Filter sheet handlers
  const handleOpenFilters = useCallback(() => {
    setTempRole(roleFilter);
    setTempFormat(formatFilter);
    setTempSort(sortMode);
    setShowFilterSheet(true);
  }, [roleFilter, formatFilter, sortMode]);

  const handleApplyFilters = useCallback(() => {
    setRoleFilter(tempRole);
    setFormatFilter(tempFormat);
    setSortMode(tempSort);
    setShowFilterSheet(false);
  }, [tempRole, tempFormat, tempSort]);

  const handleResetFilters = useCallback(() => {
    setTempRole('all');
    setTempFormat('all');
    setTempSort('index');
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setRoleFilter('all');
    setFormatFilter('all');
    setSortMode('index');
  }, []);

  // ─── Filter description ───────────────
  const filterDescription = useMemo(() => {
    const parts: string[] = [];
    if (roleFilter !== 'all') parts.push(roleFilter === 'receiving' ? 'Receiving' : 'Change');
    if (formatFilter !== 'all' && showFormatFilter) parts.push(ADDRESS_FORMAT_LABELS[formatFilter] || '');
    if (sortMode !== 'index') parts.push(`by ${SORT_MODE_LABELS[sortMode]}`);

    if (parts.length === 0) return `${filteredAddresses.length} addresses`;
    return `${parts.join(' · ')} · ${filteredAddresses.length}`;
  }, [roleFilter, formatFilter, sortMode, filteredAddresses.length, showFormatFilter]);

  // ─── Filter Chip (for bottom sheet) ───
  const FilterChip = useCallback(({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.filterChip, { backgroundColor: active ? chipActiveBg : chipBg }]}
    >
      <Text style={[styles.filterChipText, { color: active ? chipActiveText : subtleText }, active && { fontWeight: '600' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  ), [chipActiveBg, chipActiveText, chipBg, subtleText]);

  // ─── Render: Address Row ──────────────
  const renderAddress = useCallback(({ item: addr, index: itemIndex, section }: { item: AddressInfo; index: number; section: AddressSection }) => {
    const isUsed = usedAddresses.has(addr.address);
    const stats = statsMap.get(addr.address);
    const hasBalance = stats && stats.balance.total > 0;
    const isLast = itemIndex === section.data.length - 1;

    // Semantic icon tinting based on role
    const roleTheme = addr.isChange ? ROLE_ICON_COLORS.change : ROLE_ICON_COLORS.receive;
    const iconBg = isDark ? roleTheme.dark.bg : roleTheme.light.bg;
    const iconColor = isDark ? roleTheme.dark.color : roleTheme.light.color;

    return (
      <TouchableOpacity
        onPress={() => handleAddressPress(addr)}
        activeOpacity={0.7}
        style={styles.addressRow}
      >
        {/* Icon circle — 36x36 semantic tint */}
        <View style={[styles.addressIconCircle, { backgroundColor: iconBg }]}>
          <Ionicons
            name={addr.isChange ? 'swap-horizontal' : 'arrow-down'}
            size={16}
            color={iconColor}
          />
        </View>

        {/* Content */}
        <View style={styles.addressRowContent}>
          {/* Top line: Address + index */}
          <View style={styles.addressRowTopLine}>
            <Text style={[styles.addressRowLabel, { color: colors.text }]} numberOfLines={1}>
              {truncateAddress(addr.address, 10, 8)}
            </Text>
            <View style={styles.addressRowRight}>
              {stats && (
                <Text style={[styles.addressRowValue, {
                  color: hasBalance ? greenColor : mutedText,
                }]}>
                  {formatAmount(stats.balance.total, denomination)}
                </Text>
              )}
              {!stats && statsLoading && (
                <ActivityIndicator size={10} color={mutedText} />
              )}
              <Ionicons name="chevron-forward" size={16} color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'} />
            </View>
          </View>

          {/* Bottom line: Role · #index · Used · Path · Tx count */}
          <View style={styles.addressRowBottomLine}>
            <Text style={[styles.addressRowMeta, { color: iconColor }]}>
              {addr.isChange ? 'Change' : 'Receive'}
            </Text>
            <Text style={[styles.addressRowMetaDot, { color: mutedText }]}>·</Text>
            <Text style={[styles.addressRowMeta, { color: mutedText }]}>
              #{addr.index}
            </Text>
            {isUsed && (
              <>
                <Text style={[styles.addressRowMetaDot, { color: mutedText }]}>·</Text>
                <Text style={[styles.addressRowMeta, { color: mutedText }]}>Used</Text>
              </>
            )}
            <Text style={[styles.addressRowMetaDot, { color: mutedText }]}>·</Text>
            <Text style={[styles.addressRowMeta, { color: mutedText }]} numberOfLines={1}>
              {addr.path}
            </Text>
            {stats && stats.txCount > 0 && (
              <>
                <Text style={[styles.addressRowMetaDot, { color: mutedText }]}>·</Text>
                <Text style={[styles.addressRowMeta, { color: mutedText }]}>
                  {stats.txCount} tx{stats.txCount !== 1 ? 's' : ''}
                </Text>
              </>
            )}
          </View>

          {/* Divider at left: 64 (matching settings/wallet design language) */}
          {!isLast && (
            <View style={[styles.addressRowDivider, { backgroundColor: dividerColor }]} />
          )}
        </View>
      </TouchableOpacity>
    );
  }, [
    usedAddresses, statsMap, statsLoading, denomination, colors, isDark,
    mutedText, dividerColor, greenColor, handleAddressPress,
  ]);

  // ─── Render: Section Header ───────────
  const renderSectionHeader = useCallback(({ section }: { section: AddressSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
        {section.title.toUpperCase()}
      </Text>
      <Text style={[styles.sectionCount, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
        {section.data.length}
      </Text>
    </View>
  ), [isDark]);

  // ─── Render: Section Card Wrapper ─────
  // Wraps each section's items in a borderRadius:20 card (matching settings/wallet)
  const renderSectionFooter = useCallback(() => null, []);

  // ─── Render: Empty ────────────────────
  const renderEmpty = useCallback(() => {
    if (statsLoading && addresses.length === 0) return null;

    const hasFilters = roleFilter !== 'all' || formatFilter !== 'all' || searchQuery.trim();
    if (hasFilters) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyRings}>
            <View style={[styles.emptyRing3, { borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }]} />
            <View style={[styles.emptyRing2, { borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]} />
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }]}>
              <Ionicons name="search-outline" size={28} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
            </View>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No addresses match</Text>
          <Text style={[styles.emptySubtitle, { color: mutedText }]}>
            Try adjusting your search or filters
          </Text>
          <TouchableOpacity
            onPress={() => { handleClearAllFilters(); setSearchQuery(''); }}
            style={[styles.emptyAction, { backgroundColor: chipBg }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.emptyActionText, { color: colors.text }]}>Clear Filters</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyRings}>
          <View style={[styles.emptyRing3, { borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }]} />
          <View style={[styles.emptyRing2, { borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]} />
          <View style={[styles.emptyIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }]}>
            <Ionicons name="wallet-outline" size={28} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
          </View>
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No addresses yet</Text>
        <Text style={[styles.emptySubtitle, { color: mutedText }]}>
          Addresses will appear here once your wallet is set up
        </Text>
      </View>
    );
  }, [statsLoading, addresses.length, roleFilter, formatFilter, searchQuery, colors, mutedText, chipBg, handleClearAllFilters]);

  // ─── Render: Section with Card Wrapper ──
  // To match design language, we use CellRendererComponent to wrap each section in a card
  const renderSectionWithCard = useCallback(({ section }: { section: AddressSection }) => {
    return (
      <>
        {/* Section header */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            {section.title.toUpperCase()}
          </Text>
          <Text style={[styles.sectionCount, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            {section.data.length}
          </Text>
        </View>
      </>
    );
  }, [isDark]);

  // ─── Main Render ──────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ──────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <Text style={[styles.headerTitle, { color: colors.text }]}>Addresses</Text>

          {/* Filter button */}
          <TouchableOpacity
            onPress={handleOpenFilters}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.filterButton, activeFilterCount > 0 && {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            }]}
          >
            <Ionicons name="options-outline" size={20} color={activeFilterCount > 0 ? colors.text : subtleText} />
            {activeFilterCount > 0 && (
              <View style={[styles.filterBadge, { backgroundColor: greenColor }]}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Search ──────────────────── */}
        <PremiumInputCard>
          <PremiumInput
            icon="search"
            iconColor="#8E8E93"
            placeholder="Search by address, label, derivation..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            showClear
          />
        </PremiumInputCard>

        {/* ── Filter description + sync indicator ─── */}
        <View style={styles.filterDescRow}>
          <Text style={[styles.filterDescText, { color: mutedText }]} numberOfLines={1}>
            {filterDescription}
          </Text>
          {statsLoading && (
            <View style={[styles.syncIndicator, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}>
              <ActivityIndicator size={8} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'} />
              <Text style={[styles.syncText, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)' }]}>Syncing</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Address List ────────────── */}
      <SectionList
        sections={sections}
        renderItem={(info) => {
          const isFirst = info.index === 0;
          const isLast = info.index === info.section.data.length - 1;
          return (
            <View style={[
              { backgroundColor: surfaceBg },
              isFirst && { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
              isLast && { borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
              isFirst && isLast && { borderRadius: 20 },
            ]}>
              {renderAddress({ item: info.item, index: info.index, section: info.section })}
            </View>
          );
        }}
        renderSectionHeader={renderSectionWithCard}
        keyExtractor={item => item.address}
        ListEmptyComponent={renderEmpty}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 32 },
          sections.length === 0 && { flex: 1 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={isDark ? '#FFFFFF' : '#000000'}
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      {/* ── Filter Bottom Sheet ────── */}
      <AppBottomSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        title="Filter & Sort"
        subtitle="Customize which addresses are shown"
        sizing="auto"
        footer={
          <View style={styles.filterSheetFooter}>
            <TouchableOpacity
              style={[styles.filterApplyButton, {
                backgroundColor: isDark ? '#FFFFFF' : '#0A0A0A',
              }]}
              onPress={handleApplyFilters}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterApplyText, {
                color: isDark ? '#000000' : '#FFFFFF',
              }]}>Apply</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <View style={styles.filterSheetContent}>
          {/* Role */}
          <Text style={[styles.filterGroupLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>ADDRESS TYPE</Text>
          <View style={styles.filterChipRow}>
            <FilterChip label="All" active={tempRole === 'all'} onPress={() => setTempRole('all')} />
            <FilterChip label="Receiving" active={tempRole === 'receiving'} onPress={() => setTempRole('receiving')} />
            <FilterChip label="Change" active={tempRole === 'change'} onPress={() => setTempRole('change')} />
          </View>

          {/* Format */}
          {showFormatFilter && availableTypes.length > 1 && (
            <>
              <Text style={[styles.filterGroupLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)', marginTop: 20 }]}>FORMAT</Text>
              <View style={styles.filterChipRow}>
                <FilterChip label="All Formats" active={tempFormat === 'all'} onPress={() => setTempFormat('all')} />
                {availableTypes.map(type => (
                  <FilterChip
                    key={type}
                    label={ADDRESS_FORMAT_LABELS[type] || type}
                    active={tempFormat === type}
                    onPress={() => setTempFormat(type)}
                  />
                ))}
              </View>
            </>
          )}

          {/* Sort */}
          <Text style={[styles.filterGroupLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)', marginTop: 20 }]}>SORT BY</Text>
          <View style={styles.filterChipRow}>
            {(['index', 'balance', 'txCount', 'recent'] as SortMode[]).map(mode => (
              <FilterChip
                key={mode}
                label={SORT_MODE_LABELS[mode]}
                active={tempSort === mode}
                onPress={() => setTempSort(mode)}
              />
            ))}
          </View>

          {/* Reset */}
          <TouchableOpacity
            onPress={handleResetFilters}
            style={styles.resetButton}
            activeOpacity={0.7}
          >
            <Text style={[styles.resetText, { color: mutedText }]}>Reset All</Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>

      {/* ── Address Options Modal ───── */}
      <AddressOptionsModal
        visible={selectedAddress !== null}
        address={selectedAddress}
        onClose={handleCloseModal}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  filterButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  filterBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },


  // Filter description
  filterDescRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  filterDescText: {
    fontSize: 13,
    fontWeight: '400',
    flex: 1,
  },
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  syncText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // List
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },

  // Section Header — 13px/700 uppercase, 0.8 letter-spacing, 30% opacity
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },

  // Address Row — matches ActionRow from wallet tab
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
    minHeight: 52,
  },
  addressIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressRowContent: {
    flex: 1,
    marginLeft: 12,
    paddingVertical: 12,
  },
  addressRowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addressRowLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
    flex: 1,
    marginRight: 8,
  },
  addressRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addressRowValue: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  addressRowBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
    flexWrap: 'nowrap',
  },
  addressRowMeta: {
    fontSize: 12,
    fontWeight: '400',
    flexShrink: 1,
  },
  addressRowMetaDot: {
    fontSize: 10,
  },
  addressRowDivider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },

  // Empty
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
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
  emptyIcon: {
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
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyActionText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Filter Bottom Sheet
  filterSheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 8,
  },
  filterGroupLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resetButton: {
    alignSelf: 'center',
    marginTop: 24,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterSheetFooter: {},
  filterApplyButton: {
    height: 48,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterApplyText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
