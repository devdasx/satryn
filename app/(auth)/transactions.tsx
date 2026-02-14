import '../../shim';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SectionList,
  ScrollView,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useWalletStore, useSettingsStore, useMultiWalletStore, useTransactionLabelStore } from '../../src/stores';
import { usePriceStore } from '../../src/stores/priceStore';
import { WalletEngine } from '../../src/services/sync/WalletEngine';
import { WalletSyncManager } from '../../src/services/sync/WalletSyncManager';
import type { TxUserMetadata } from '../../src/services/sync/types';
import { useTheme, useHaptics } from '../../src/hooks';
import { fiatToSats, unitToSats, getUnitSymbol } from '../../src/utils/formatting';
import { FORMATTING, BITCOIN_UNITS, THEME } from '../../src/constants';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import { TransactionActionsSheet } from '../../src/components/bitcoin/TransactionActionsSheet';
import { TransactionRow } from '../../src/components/bitcoin/TransactionRow';
import type { DetailedTransactionInfo, BitcoinUnit } from '../../src/types';

// ─── Types ──────────────────────────────────────────────────────

type AmountUnit = BitcoinUnit | 'fiat';

interface FilterState {
  direction: 'all' | 'incoming' | 'outgoing';
  status: 'any' | 'confirmed' | 'pending';
  dateRange: 'any' | 'today' | 'week' | 'month' | 'year' | 'custom';
  customDateFrom: number | null; // Unix timestamp (seconds)
  customDateTo: number | null;   // Unix timestamp (seconds)
  amountMin: string;
  amountMax: string;
  amountUnit: AmountUnit;
}

interface DateSection {
  title: string;
  data: DetailedTransactionInfo[];
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  direction: 'all',
  status: 'any',
  dateRange: 'any',
  customDateFrom: null,
  customDateTo: null,
  amountMin: '',
  amountMax: '',
  amountUnit: 'sat',
};

// ─── Helpers ────────────────────────────────────────────────────

function getDateGroup(timestamp: number): string {
  if (!timestamp) return 'Pending';

  const now = new Date();
  const txDate = new Date(timestamp * 1000);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  if (txDate >= todayStart) return 'Today';
  if (txDate >= yesterdayStart) return 'Yesterday';

  // Show individual day name + date (e.g. "Monday, Feb 3")
  // For dates within the current year, omit year; for older dates include year
  const isSameYear = txDate.getFullYear() === now.getFullYear();
  const dayName = txDate.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = txDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
  return `${dayName}, ${monthDay}`;
}

function matchesSearch(
  tx: DetailedTransactionInfo,
  query: string,
  ownAddresses: Set<string>,
  txUserMetadata?: Record<string, TxUserMetadata>,
  txLabels?: Record<string, { label?: string; note?: string; tags?: string[] }>,
): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;

  // Match txid
  if (tx.txid.toLowerCase().includes(q)) return true;

  // Match addresses (inputs + outputs)
  for (const input of tx.inputs) {
    if (input.address?.toLowerCase().includes(q)) return true;
  }
  for (const output of tx.outputs) {
    if (output.address?.toLowerCase().includes(q)) return true;
  }

  // Match amount (user types "0.5" or "50000")
  const absDiff = Math.abs(tx.balanceDiff);
  const btcStr = (absDiff / 100_000_000).toString();
  const satsStr = absDiff.toString();
  if (btcStr.includes(q) || satsStr.includes(q)) return true;

  // Match status keywords
  if (q === 'pending' || q === 'unconfirmed') return !tx.confirmed;
  if (q === 'confirmed') return tx.confirmed;

  // Match type keywords
  if (q === 'received' || q === 'incoming') return tx.type === 'incoming';
  if (q === 'sent' || q === 'outgoing') return tx.type === 'outgoing';
  if (q === 'self' || q === 'self-transfer' || q === 'self transfer') return tx.type === 'self-transfer';

  // Match transaction notes (V2 wallet file)
  const meta = txUserMetadata?.[tx.txid];
  if (meta?.note?.toLowerCase().includes(q)) return true;
  if (meta?.tags?.some(tag => tag.toLowerCase().includes(q))) return true;

  // Match legacy transaction labels (backward compat)
  const label = txLabels?.[tx.txid];
  if (label?.label?.toLowerCase().includes(q)) return true;
  if (label?.note?.toLowerCase().includes(q)) return true;
  if (label?.tags?.some(tag => tag.toLowerCase().includes(q))) return true;

  return false;
}

function matchesAdvancedFilters(
  tx: DetailedTransactionInfo,
  filters: FilterState,
  btcPrice: number | null,
): boolean {
  // Status filter
  if (filters.status === 'confirmed' && !tx.confirmed) return false;
  if (filters.status === 'pending' && tx.confirmed) return false;

  // Date range filter
  if (filters.dateRange !== 'any') {
    const now = Date.now() / 1000;
    const txTime = tx.blockTime || now;

    if (filters.dateRange === 'custom') {
      if (filters.customDateFrom && txTime < filters.customDateFrom) return false;
      if (filters.customDateTo && txTime > filters.customDateTo + 86400) return false; // End of day
    } else {
      const diff = now - txTime;
      if (filters.dateRange === 'today' && diff > 86400) return false;
      if (filters.dateRange === 'week' && diff > 604800) return false;
      if (filters.dateRange === 'month' && diff > 2592000) return false;
      if (filters.dateRange === 'year' && diff > 31536000) return false;
    }
  }

  // Amount filter — convert user input to sats based on selected unit
  const absSats = Math.abs(tx.balanceDiff);

  const toSats = (val: number): number => {
    if (filters.amountUnit === 'fiat' && btcPrice && btcPrice > 0) return fiatToSats(val, btcPrice);
    if (filters.amountUnit !== 'fiat') return unitToSats(val, filters.amountUnit);
    return val;
  };

  if (filters.amountMin) {
    const minVal = parseFloat(filters.amountMin);
    if (!isNaN(minVal) && minVal > 0) {
      if (absSats < toSats(minVal)) return false;
    }
  }
  if (filters.amountMax) {
    const maxVal = parseFloat(filters.amountMax);
    if (!isNaN(maxVal) && maxVal > 0) {
      if (absSats > toSats(maxVal)) return false;
    }
  }

  return true;
}

function sortTransactions(txs: DetailedTransactionInfo[]): DetailedTransactionInfo[] {
  return [...txs].sort((a, b) => {
    // Unconfirmed first
    if (!a.confirmed && b.confirmed) return -1;
    if (a.confirmed && !b.confirmed) return 1;
    return (b.blockTime || Date.now() / 1000) - (a.blockTime || Date.now() / 1000);
  });
}

function groupByDate(txs: DetailedTransactionInfo[]): DateSection[] {
  const groups = new Map<string, DetailedTransactionInfo[]>();

  for (const tx of txs) {
    const group = tx.confirmed ? getDateGroup(tx.blockTime) : 'Pending';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(tx);
  }

  // Fixed sections first: Pending, Today, Yesterday
  const fixedOrder = ['Pending', 'Today', 'Yesterday'];
  const sections: DateSection[] = [];

  for (const key of fixedOrder) {
    if (groups.has(key)) {
      sections.push({ title: key, data: groups.get(key)! });
      groups.delete(key);
    }
  }

  // All remaining day sections in reverse chronological order
  const remaining = Array.from(groups.entries()).sort((a, b) => {
    const aTime = a[1][0]?.blockTime || 0;
    const bTime = b[1][0]?.blockTime || 0;
    return bTime - aTime;
  });
  for (const [title, data] of remaining) {
    sections.push({ title, data });
  }

  return sections;
}

// ─── Component ──────────────────────────────────────────────────

export default function TransactionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const addresses = useWalletStore(s => s.addresses);
  const activeWalletId = useWalletStore(s => s.walletId);
  const cachedTransactions = useWalletStore(s => s.transactions);
  const getCachedTransactions = useWalletStore(s => s.getCachedTransactions);
  const isCacheStale = useWalletStore(s => s.isCacheStale);
  const currency = useSettingsStore(s => s.currency);
  const denomination = useSettingsStore(s => s.denomination);
  const { getActiveWallet } = useMultiWalletStore();
  const activeWallet = getActiveWallet();
  const txLabels = useTransactionLabelStore(s => s.labels);
  const price = usePriceStore((s) => s.price);
  const fetchPrice = usePriceStore((s) => s.fetchPrice);
  const haptics = useHaptics();

  // Load tx user metadata from V2 wallet file for search
  const txUserMetadata = useMemo(() => {
    if (!activeWalletId) return undefined;
    try {
      const engine = WalletEngine.shared();
      const walletFile = engine.getWalletFile(activeWalletId);
      return walletFile?.txUserMetadata;
    } catch {
      return undefined;
    }
  }, [activeWalletId]);

  // ─── Design Tokens ────────────────────
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const subtleText = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const searchBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const chipActiveBg = isDark ? THEME.brand.bitcoin : '#000000';
  const chipActiveText = '#FFFFFF';

  // ─── State ──────────────────────────────

  const [allTransactions, setAllTransactions] = useState<DetailedTransactionInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const initialFilters = useMemo(() => ({ ...DEFAULT_FILTERS, amountUnit: denomination as AmountUnit }), []);
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>(initialFilters);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [selectedTx, setSelectedTx] = useState<DetailedTransactionInfo | null>(null);
  const [tempFilters, setTempFilters] = useState<FilterState>(initialFilters);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showDateFromPicker, setShowDateFromPicker] = useState(false);
  const [showDateToPicker, setShowDateToPicker] = useState(false);

  const txsRef = useRef<DetailedTransactionInfo[]>([]);
  const searchInputRef = useRef<TextInput>(null);

  // Build set of own addresses for smart labeling
  const ownAddressSet = useMemo(
    () => new Set(addresses.map(a => a.address)),
    [addresses],
  );

  // Collect all unique tags from labels and V2 metadata
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    if (txLabels) {
      for (const key of Object.keys(txLabels)) {
        const entry = txLabels[key];
        if (entry?.tags) {
          for (const tag of entry.tags) tagSet.add(tag);
        }
      }
    }
    if (txUserMetadata) {
      for (const key of Object.keys(txUserMetadata)) {
        const meta = txUserMetadata[key];
        if (meta?.tags) {
          for (const tag of meta.tags) tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }, [txLabels, txUserMetadata]);

  // Active filter count (for badge)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (advancedFilters.direction !== 'all') count++;
    if (advancedFilters.status !== 'any') count++;
    if (advancedFilters.dateRange !== 'any') count++;
    if (advancedFilters.amountMin) count++;
    if (advancedFilters.amountMax) count++;
    return count;
  }, [advancedFilters]);

  // Fetch BTC price for fiat filter conversion
  useEffect(() => { fetchPrice(); }, []);

  // ─── Data Loading (DB-first) ────────

  const loadTransactions = useCallback(async (forceRefresh = false) => {
    if (addresses.length === 0) {
      setIsLoading(false);
      return;
    }

    // Show cached data from store immediately (populated from DB)
    const cached = getCachedTransactions();
    if (cached && cached.length > 0) {
      const sorted = sortTransactions(cached);
      txsRef.current = sorted;
      setAllTransactions(sorted);
      setIsLoading(false);
    }

    if (forceRefresh && activeWalletId) {
      // Pull-to-refresh: trigger full sync via WalletSyncManager
      // This goes through: Electrum → DB → walletStore.reloadFromDB()
      try {
        await WalletSyncManager.shared().refreshWallet(activeWalletId);
        // After sync, walletStore.transactions is updated from DB
        // The useEffect on cachedTransactions will pick up the new data
      } catch (err) {
        console.error('[Activity] Sync failed:', err);
      }
    } else if (!cached || cached.length === 0 || isCacheStale()) {
      // Initial load with stale or empty cache — trigger a sync
      if (activeWalletId) {
        try {
          await WalletSyncManager.shared().triggerSync(activeWalletId, 'manual');
        } catch (err) {
          console.error('[Activity] Sync failed:', err);
        }
      }
    }

    setIsLoading(false);
  }, [addresses, activeWalletId, getCachedTransactions, isCacheStale]);

  // Initial load
  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Show cached transactions immediately on wallet switch
  useEffect(() => {
    if (cachedTransactions && cachedTransactions.length > 0) {
      const sorted = sortTransactions(cachedTransactions);
      txsRef.current = sorted;
      setAllTransactions(sorted);
      setIsLoading(false);
    } else {
      txsRef.current = [];
      setAllTransactions([]);
    }
  }, [cachedTransactions]);

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions(true);
    setRefreshing(false);
  }, [loadTransactions]);

  // ─── Filtering + Search + Pagination ───

  const filteredTransactions = useMemo(() => {
    let txs = allTransactions;

    // Direction filter (from advanced filters)
    if (advancedFilters.direction !== 'all') {
      txs = txs.filter(tx =>
        advancedFilters.direction === 'outgoing'
          ? (tx.type === 'outgoing' || tx.type === 'self-transfer')
          : tx.type === advancedFilters.direction
      );
    }

    // Search
    if (searchQuery.trim()) {
      txs = txs.filter(tx => matchesSearch(tx, searchQuery, ownAddressSet, txUserMetadata, txLabels));
    }

    // Advanced filters
    if (activeFilterCount > 0) {
      txs = txs.filter(tx => matchesAdvancedFilters(tx, advancedFilters, price));
    }

    // Tag filter
    if (selectedTag) {
      txs = txs.filter(tx => {
        const labelTags = txLabels[tx.txid]?.tags;
        const metaTags = txUserMetadata?.[tx.txid]?.tags;
        return (labelTags?.includes(selectedTag)) || (metaTags?.includes(selectedTag));
      });
    }

    return txs;
  }, [allTransactions, searchQuery, ownAddressSet, advancedFilters, activeFilterCount, price, txUserMetadata, txLabels, selectedTag]);

  // Paginated slice
  const paginatedTransactions = useMemo(
    () => filteredTransactions.slice(0, pageCount * PAGE_SIZE),
    [filteredTransactions, pageCount],
  );

  const hasMore = paginatedTransactions.length < filteredTransactions.length;

  // Date-grouped sections
  const sections = useMemo(
    () => groupByDate(paginatedTransactions),
    [paginatedTransactions],
  );

  const handleLoadMore = useCallback(() => {
    if (hasMore) {
      setPageCount(prev => prev + 1);
    }
  }, [hasMore]);

  // Reset pagination when filters change
  useEffect(() => {
    setPageCount(1);
  }, [searchQuery, advancedFilters, selectedTag]);

  // ─── Navigation ────────────────────────

  const handleTransactionPress = useCallback((tx: DetailedTransactionInfo) => {
    router.push({
      pathname: '/(auth)/transaction-details',
      params: { txData: JSON.stringify(tx) },
    });
  }, [router]);

  const handleTransactionLongPress = useCallback((tx: DetailedTransactionInfo) => {
    setSelectedTx(tx);
    setShowActionsSheet(true);
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // ─── Filter Sheet ─────────────────────

  const openFilterSheet = useCallback(() => {
    setTempFilters({ ...advancedFilters });
    setShowDateFromPicker(false);
    setShowDateToPicker(false);
    setShowFilterSheet(true);
  }, [advancedFilters]);

  const applyFilters = useCallback(() => {
    setAdvancedFilters({ ...tempFilters });
    setShowFilterSheet(false);
  }, [tempFilters]);

  const resetFilters = useCallback(() => {
    setTempFilters({ ...DEFAULT_FILTERS, amountUnit: denomination as AmountUnit });
    setShowDateFromPicker(false);
    setShowDateToPicker(false);
  }, [denomination]);

  // Cycle amount unit: denomination → fiat (skip fiat if no price)
  const handleCycleAmountUnit = useCallback(() => {
    haptics.trigger('light');
    setTempFilters(f => {
      const next: AmountUnit = f.amountUnit === denomination
        ? (price ? 'fiat' : denomination)
        : denomination;
      return { ...f, amountUnit: next, amountMin: '', amountMax: '' };
    });
  }, [price, haptics, denomination]);

  // Amount unit label for display
  const amountUnitLabel = useMemo(() => {
    if (tempFilters.amountUnit === 'fiat') return currency || 'USD';
    return getUnitSymbol(tempFilters.amountUnit);
  }, [tempFilters.amountUnit, currency]);

  // Format custom date for display
  const formatDateShort = useCallback((timestamp: number | null): string => {
    if (!timestamp) return 'Select';
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  // ─── Render: Transaction Row ──────────

  const renderTransaction = useCallback(({ item }: { item: DetailedTransactionInfo }) => {
    const txNote = txLabels[item.txid]?.note || undefined;
    const txTags = txLabels[item.txid]?.tags || txUserMetadata?.[item.txid]?.tags || undefined;

    return (
      <View style={[styles.txRowWrap, { backgroundColor: surfaceBg }]}>
        <TransactionRow
          tx={item}
          ownAddresses={ownAddressSet}
          onPress={handleTransactionPress}
          onLongPress={handleTransactionLongPress}
          showDivider={false}
          showChevron={true}
          note={txNote}
          tags={txTags}
        />
      </View>
    );
  }, [
    surfaceBg, ownAddressSet, handleTransactionPress, handleTransactionLongPress, txLabels, txUserMetadata,
  ]);

  // ─── Render: Section Header ───────────

  const renderSectionHeader = useCallback(({ section }: { section: DateSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: sectionHeaderColor }]}>
        {section.title.toUpperCase()}
      </Text>
    </View>
  ), [sectionHeaderColor]);

  // ─── Render: Empty State ──────────────

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;

    const hasSearch = !!searchQuery.trim();
    const hasAdvanced = activeFilterCount > 0;
    const hasTag = selectedTag !== null;
    const hasFilters = hasSearch || hasAdvanced || hasTag;

    // Determine contextual empty state based on direction filter
    const directionFilter = advancedFilters.direction;

    // Icon, title, and subtitle per context
    let icon: React.ComponentProps<typeof Ionicons>['name'] = 'receipt-outline';
    let title = 'No transactions yet';
    let subtitle = 'Your activity will appear here once\nyou send or receive Bitcoin';

    if (hasSearch) {
      icon = 'search-outline';
      title = 'No matches';
      subtitle = 'Try adjusting your search or filters';
    } else if (directionFilter === 'incoming' && !hasSearch) {
      icon = 'arrow-down-outline';
      title = 'No received transactions';
      subtitle = 'Incoming transactions will appear here\nonce someone sends you Bitcoin';
    } else if (directionFilter === 'outgoing' && !hasSearch) {
      icon = 'arrow-up-outline';
      title = 'No sent transactions';
      subtitle = 'Outgoing and self-transfer transactions\nwill appear here once you send Bitcoin';
    } else if (hasAdvanced || hasTag) {
      icon = 'funnel-outline';
      title = 'No matches';
      subtitle = 'No transactions match your current filters';
    }

    return (
      <Animated.View entering={FadeIn.duration(300)} style={styles.emptyContainer}>
        <View style={styles.emptyRings}>
          <View style={[styles.emptyRing3, { borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }]} />
          <View style={[styles.emptyRing2, { borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]} />
          <View style={[styles.emptyIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }]}>
            <Ionicons name={icon} size={28} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
          </View>
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.emptySubtitle, { color: mutedText }]}>
          {subtitle}
        </Text>
        {hasFilters ? (
          <TouchableOpacity
            onPress={() => {
              setSearchQuery('');
              setAdvancedFilters(DEFAULT_FILTERS);
              setSelectedTag(null);
            }}
            style={[styles.emptyAction, { backgroundColor: surfaceBg }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.emptyActionText, { color: colors.text }]}>Clear All Filters</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => router.push('/(auth)/receive')}
            style={[styles.emptyAction, { backgroundColor: chipActiveBg }]}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-down" size={16} color={chipActiveText} style={{ marginRight: 6 }} />
            <Text style={[styles.emptyActionText, { color: chipActiveText }]}>Receive Bitcoin</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    );
  }, [isLoading, searchQuery, activeFilterCount, selectedTag, advancedFilters.direction, colors, isDark, mutedText, surfaceBg, chipActiveBg, chipActiveText, router]);

  // ─── Render: Footer (Load More) ──────

  const renderFooter = useCallback(() => {
    if (!hasMore) return null;
    return (
      <TouchableOpacity
        onPress={handleLoadMore}
        style={[styles.loadMoreButton, { backgroundColor: surfaceBg }]}
        activeOpacity={0.7}
      >
        <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More</Text>
        <Ionicons name="chevron-down" size={16} color={mutedText} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  }, [hasMore, handleLoadMore, surfaceBg, colors.text, mutedText]);

  // ─── Render: Filter Chip ─────────────

  // ─── Filter Sheet Option ─────────────

  const FilterOption = useCallback(({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.filterOption,
        { backgroundColor: active ? chipActiveBg : chipBg },
      ]}
    >
      <Text
        style={[
          styles.filterOptionText,
          { color: active ? chipActiveText : colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  ), [chipActiveBg, chipActiveText, chipBg, colors.text]);

  // ─── Main Render ──────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {/* App Bar — back button + title + filter */}
        <Animated.View entering={FadeIn.duration(250)} style={styles.appBar}>
          <TouchableOpacity
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.appBarSpacer} />

          <TouchableOpacity
            onPress={openFilterSheet}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.appBarFilterButton}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={activeFilterCount > 0 ? colors.text : mutedText}
            />
            {activeFilterCount > 0 && (
              <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Large Title */}
        <Animated.View entering={FadeIn.duration(300).delay(40)}>
          <Text style={[styles.largeTitle, { color: colors.text }]}>Activity</Text>
          {activeWallet && (
            <Text style={[styles.walletName, { color: mutedText }]} numberOfLines={1}>
              {activeWallet.name}
            </Text>
          )}
        </Animated.View>

        {/* Search Bar */}
        <Animated.View entering={FadeIn.duration(300).delay(80)}>
          <PremiumInputCard>
            <PremiumInput
              ref={searchInputRef}
              icon="search"
              iconColor="#8E8E93"
              placeholder="Search txid, address, amount..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              returnKeyType="search"
              showClear
            />
          </PremiumInputCard>
        </Animated.View>

        {/* Tag Filter Chips */}
        {allTags.length > 0 && (
          <Animated.View entering={FadeIn.duration(300).delay(160)}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagChipRow}
            >
              <TouchableOpacity
                onPress={() => { setSelectedTag(null); haptics.trigger('light'); }}
                activeOpacity={0.7}
                style={[styles.tagChip, {
                  backgroundColor: !selectedTag ? chipActiveBg : chipBg,
                }]}
              >
                <Ionicons name="pricetags-outline" size={12} color={!selectedTag ? chipActiveText : mutedText} />
                <Text style={[styles.tagChipText, {
                  color: !selectedTag ? chipActiveText : mutedText,
                  fontWeight: !selectedTag ? '600' : '500',
                }]}>All Tags</Text>
              </TouchableOpacity>
              {allTags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => { setSelectedTag(selectedTag === tag ? null : tag); haptics.trigger('light'); }}
                  activeOpacity={0.7}
                  style={[styles.tagChip, {
                    backgroundColor: selectedTag === tag ? chipActiveBg : chipBg,
                  }]}
                >
                  <Text style={[styles.tagChipText, {
                    color: selectedTag === tag ? chipActiveText : mutedText,
                    fontWeight: selectedTag === tag ? '600' : '500',
                  }]}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        )}
      </View>

      {/* ── Transaction List ──────────── */}
      {isLoading && allTransactions.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={isDark ? '#FFFFFF' : '#000000'} />
          <Text style={[styles.loadingText, { color: mutedText }]}>Loading activity...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderTransaction}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.txid}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
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
              progressViewOffset={8}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}

      {/* ── Advanced Filter Sheet ─────── */}
      <AppBottomSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        title="Filters"
        subtitle="Refine your transaction list"
        sizing="auto"
      >
        <View style={styles.sheetContent}>
          {/* Direction */}
          <View style={styles.sheetSection}>
            <Text style={[styles.sheetSectionTitle, { color: sectionHeaderColor }]}>DIRECTION</Text>
            <View style={styles.sheetOptions}>
              <FilterOption label="All" active={tempFilters.direction === 'all'} onPress={() => setTempFilters(f => ({ ...f, direction: 'all' }))} />
              <FilterOption label="Received" active={tempFilters.direction === 'incoming'} onPress={() => setTempFilters(f => ({ ...f, direction: 'incoming' }))} />
              <FilterOption label="Sent" active={tempFilters.direction === 'outgoing'} onPress={() => setTempFilters(f => ({ ...f, direction: 'outgoing' }))} />
            </View>
          </View>

          {/* Status */}
          <View style={styles.sheetSection}>
            <Text style={[styles.sheetSectionTitle, { color: sectionHeaderColor }]}>STATUS</Text>
            <View style={styles.sheetOptions}>
              <FilterOption label="Any" active={tempFilters.status === 'any'} onPress={() => setTempFilters(f => ({ ...f, status: 'any' }))} />
              <FilterOption label="Confirmed" active={tempFilters.status === 'confirmed'} onPress={() => setTempFilters(f => ({ ...f, status: 'confirmed' }))} />
              <FilterOption label="Pending" active={tempFilters.status === 'pending'} onPress={() => setTempFilters(f => ({ ...f, status: 'pending' }))} />
            </View>
          </View>

          {/* Date Range */}
          <View style={styles.sheetSection}>
            <Text style={[styles.sheetSectionTitle, { color: sectionHeaderColor }]}>DATE RANGE</Text>
            <View style={styles.sheetOptions}>
              <FilterOption label="Any" active={tempFilters.dateRange === 'any'} onPress={() => { setTempFilters(f => ({ ...f, dateRange: 'any', customDateFrom: null, customDateTo: null })); setShowDateFromPicker(false); setShowDateToPicker(false); }} />
              <FilterOption label="Today" active={tempFilters.dateRange === 'today'} onPress={() => setTempFilters(f => ({ ...f, dateRange: 'today', customDateFrom: null, customDateTo: null }))} />
              <FilterOption label="This Week" active={tempFilters.dateRange === 'week'} onPress={() => setTempFilters(f => ({ ...f, dateRange: 'week', customDateFrom: null, customDateTo: null }))} />
              <FilterOption label="This Month" active={tempFilters.dateRange === 'month'} onPress={() => setTempFilters(f => ({ ...f, dateRange: 'month', customDateFrom: null, customDateTo: null }))} />
              <FilterOption label="This Year" active={tempFilters.dateRange === 'year'} onPress={() => setTempFilters(f => ({ ...f, dateRange: 'year', customDateFrom: null, customDateTo: null }))} />
              <FilterOption label="Custom" active={tempFilters.dateRange === 'custom'} onPress={() => { haptics.trigger('light'); setTempFilters(f => ({ ...f, dateRange: 'custom' })); }} />
            </View>

            {/* Custom Date Range Picker */}
            {tempFilters.dateRange === 'custom' && (
              <View style={styles.customDateContainer}>
                {/* From Date */}
                <View style={styles.datePickerRow}>
                  <Text style={[styles.datePickerLabel, { color: mutedText }]}>From</Text>
                  <TouchableOpacity
                    onPress={() => { haptics.trigger('light'); setShowDateFromPicker(!showDateFromPicker); setShowDateToPicker(false); }}
                    activeOpacity={0.7}
                    style={[styles.datePickerButton, {
                      backgroundColor: searchBg,
                      borderColor: showDateFromPicker ? (isDark ? '#FFFFFF' : '#000000') : 'transparent',
                      borderWidth: showDateFromPicker ? 1 : 0,
                    }]}
                  >
                    <Ionicons name="calendar-outline" size={14} color={mutedText} />
                    <Text style={[styles.datePickerButtonText, {
                      color: tempFilters.customDateFrom ? colors.text : mutedText,
                    }]}>
                      {formatDateShort(tempFilters.customDateFrom)}
                    </Text>
                  </TouchableOpacity>
                </View>

                {showDateFromPicker && (
                  <View style={[styles.datePickerInline, { backgroundColor: searchBg }]}>
                    <DateTimePicker
                      value={tempFilters.customDateFrom ? new Date(tempFilters.customDateFrom * 1000) : new Date()}
                      mode="date"
                      display="spinner"
                      maximumDate={tempFilters.customDateTo ? new Date(tempFilters.customDateTo * 1000) : new Date()}
                      themeVariant={isDark ? 'dark' : 'light'}
                      onChange={(_event: any, date?: Date) => {
                        if (date) {
                          const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                          setTempFilters(f => ({ ...f, customDateFrom: Math.floor(startOfDay.getTime() / 1000) }));
                        }
                      }}
                      style={styles.datePicker}
                    />
                  </View>
                )}

                {/* To Date */}
                <View style={styles.datePickerRow}>
                  <Text style={[styles.datePickerLabel, { color: mutedText }]}>To</Text>
                  <TouchableOpacity
                    onPress={() => { haptics.trigger('light'); setShowDateToPicker(!showDateToPicker); setShowDateFromPicker(false); }}
                    activeOpacity={0.7}
                    style={[styles.datePickerButton, {
                      backgroundColor: searchBg,
                      borderColor: showDateToPicker ? (isDark ? '#FFFFFF' : '#000000') : 'transparent',
                      borderWidth: showDateToPicker ? 1 : 0,
                    }]}
                  >
                    <Ionicons name="calendar-outline" size={14} color={mutedText} />
                    <Text style={[styles.datePickerButtonText, {
                      color: tempFilters.customDateTo ? colors.text : mutedText,
                    }]}>
                      {formatDateShort(tempFilters.customDateTo)}
                    </Text>
                  </TouchableOpacity>
                </View>

                {showDateToPicker && (
                  <View style={[styles.datePickerInline, { backgroundColor: searchBg }]}>
                    <DateTimePicker
                      value={tempFilters.customDateTo ? new Date(tempFilters.customDateTo * 1000) : new Date()}
                      mode="date"
                      display="spinner"
                      minimumDate={tempFilters.customDateFrom ? new Date(tempFilters.customDateFrom * 1000) : undefined}
                      maximumDate={new Date()}
                      themeVariant={isDark ? 'dark' : 'light'}
                      onChange={(_event: any, date?: Date) => {
                        if (date) {
                          const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                          setTempFilters(f => ({ ...f, customDateTo: Math.floor(startOfDay.getTime() / 1000) }));
                        }
                      }}
                      style={styles.datePicker}
                    />
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Amount Range with Unit Switcher */}
          <View style={styles.sheetSection}>
            <View style={styles.amountHeaderRow}>
              <Text style={[styles.sheetSectionTitle, { color: sectionHeaderColor, marginBottom: 0 }]}>AMOUNT</Text>
              <TouchableOpacity
                onPress={handleCycleAmountUnit}
                activeOpacity={0.7}
                style={[styles.amountUnitPill, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                }]}
              >
                <Text style={[styles.amountUnitPillText, { color: colors.text }]}>
                  {amountUnitLabel}
                </Text>
                <Ionicons name="chevron-expand-outline" size={10} color={mutedText} />
              </TouchableOpacity>
            </View>
            <PremiumInputCard>
              <PremiumInput
                icon="arrow-down"
                iconColor="#30D158"
                placeholder="Min"
                value={tempFilters.amountMin}
                onChangeText={v => setTempFilters(f => ({ ...f, amountMin: v }))}
                keyboardType={tempFilters.amountUnit === 'sat' ? 'number-pad' : 'decimal-pad'}
              />
              <PremiumInput
                icon="arrow-up"
                iconColor="#FF453A"
                placeholder="Max"
                value={tempFilters.amountMax}
                onChangeText={v => setTempFilters(f => ({ ...f, amountMax: v }))}
                keyboardType={tempFilters.amountUnit === 'sat' ? 'number-pad' : 'decimal-pad'}
              />
            </PremiumInputCard>
          </View>

          {/* Actions */}
          <View style={styles.sheetActions}>
            <TouchableOpacity
              onPress={resetFilters}
              activeOpacity={0.7}
              style={[styles.sheetResetButton, { backgroundColor: surfaceBg }]}
            >
              <Text style={[styles.sheetResetText, { color: colors.text }]}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={applyFilters}
              activeOpacity={0.85}
              style={[styles.sheetApplyButton, { backgroundColor: chipActiveBg }]}
            >
              <Text style={[styles.sheetApplyText, { color: chipActiveText }]}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </AppBottomSheet>

      {/* Transaction Actions Sheet (long-press) */}
      <TransactionActionsSheet
        visible={showActionsSheet}
        onClose={() => setShowActionsSheet(false)}
        transaction={selectedTx}
        isDark={isDark}
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
    paddingBottom: 4,
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  appBarSpacer: {
    flex: 1,
  },
  appBarFilterButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  walletName: {
    fontSize: 15,
    fontWeight: '400',
    marginTop: 2,
    marginBottom: 16,
  },


  // Filter Row
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Tag Chips
  tagChipRow: {
    gap: 6,
    paddingTop: 10,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  tagChipText: {
    fontSize: 12,
    letterSpacing: -0.1,
  },

  // List
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 0,
  },

  // Section Headers
  sectionHeader: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  // Transaction Row Wrapper (card style)
  txRowWrap: {
    borderRadius: 20,
    marginBottom: 6,
    overflow: 'hidden' as const,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '400',
  },

  // Empty State
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

  // Load More
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Filter Sheet
  sheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 16,
  },
  sheetSection: {
    marginBottom: 24,
  },
  sheetSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  sheetOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  filterOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  amountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  amountUnitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  amountUnitPillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountInput: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  amountInputText: {
    fontSize: 15,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  amountDash: {
    fontSize: 16,
    fontWeight: '300',
  },
  customDateContainer: {
    marginTop: 12,
    gap: 8,
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerLabel: {
    fontSize: 14,
    fontWeight: '500',
    width: 44,
  },
  datePickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  datePickerButtonText: {
    fontSize: 15,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  datePickerInline: {
    borderRadius: 14,
    overflow: 'hidden',
    marginLeft: 44,
  },
  datePicker: {
    height: 150,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  sheetResetButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetResetText: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetApplyButton: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetApplyText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
