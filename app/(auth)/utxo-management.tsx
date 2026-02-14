import '../../shim';
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore, useUTXOStore, usePriceStore } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import { formatAmount, formatUnitAmount, truncateAddress } from '../../src/utils/formatting';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { PriceAPI } from '../../src/services/api/PriceAPI';
import { FORMATTING, THEME } from '../../src/constants';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import type { ManagedUTXO } from '../../src/types';

// ─── Types ──────────────────────────────────────────────────────

type FilterType = 'all' | 'available' | 'frozen' | 'locked';
type SortMode = 'amount_desc' | 'amount_asc' | 'confirmations_asc' | 'confirmations_desc' | 'newest' | 'status';

const SORT_LABELS: Record<SortMode, string> = {
  amount_desc: 'Amount (High → Low)',
  amount_asc: 'Amount (Low → High)',
  confirmations_asc: 'Confirmations (Low → High)',
  confirmations_desc: 'Confirmations (High → Low)',
  newest: 'Newest First',
  status: 'Status (Available First)',
};

const FILTER_LABELS: Record<FilterType, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  all: { label: 'All', icon: 'grid-outline' },
  available: { label: 'Available', icon: 'checkmark-circle-outline' },
  frozen: { label: 'Frozen', icon: 'snow-outline' },
  locked: { label: 'Locked', icon: 'lock-closed-outline' },
};

const EMPTY_MESSAGES: Record<FilterType, { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = {
  all: {
    title: 'No UTXOs yet',
    subtitle: 'Unspent outputs will appear here once you receive Bitcoin. Each incoming payment creates a UTXO.',
    icon: 'cube-outline',
  },
  available: {
    title: 'No available UTXOs',
    subtitle: 'All your UTXOs are currently frozen or locked. Unfreeze or unlock them to make them available for spending.',
    icon: 'checkmark-circle-outline',
  },
  frozen: {
    title: 'No frozen UTXOs',
    subtitle: 'Freeze UTXOs to exclude them from automatic coin selection. Frozen UTXOs can still be spent manually.',
    icon: 'snow-outline',
  },
  locked: {
    title: 'No locked UTXOs',
    subtitle: 'Lock UTXOs to prevent them from being spent entirely. Useful for long-term holding or reserving funds.',
    icon: 'lock-closed-outline',
  },
};

// ─── Component ──────────────────────────────────────────────────

export default function UTXOManagementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const utxos = useWalletStore(s => s.utxos);
  const isMultisig = useWalletStore(s => s.isMultisig);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);
  const {
    getManagedUtxo,
    getAvailableUtxos,
    getFrozenUtxos,
    getLockedUtxos,
    utxoMetadata,
  } = useUTXOStore();

  // State
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortMode, setSortMode] = useState<SortMode>('amount_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Colors
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const chipActiveBg = isDark ? THEME.brand.bitcoin : '#0A0A0A';
  const chipActiveText = '#FFFFFF';
  const searchBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
  const subtleText = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const greenColor = '#30D158';
  const orangeColor = '#FF9500';
  const redColor = '#FF453A';

  // Status colors
  const getStatusColor = (utxo: ManagedUTXO) => {
    if (utxo.isFrozen) return orangeColor;
    if (utxo.isLocked) return redColor;
    return greenColor;
  };

  const getStatusLabel = (utxo: ManagedUTXO) => {
    if (utxo.isFrozen) return 'Frozen';
    if (utxo.isLocked) return 'Locked';
    return 'Available';
  };

  const getStatusBg = (utxo: ManagedUTXO) => {
    if (utxo.isFrozen) return isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.08)';
    if (utxo.isLocked) return isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)';
    return isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.08)';
  };

  // ─── Data ──────────────────────────
  const allManaged = useMemo(
    () => utxos.map(getManagedUtxo),
    [utxos, getManagedUtxo, utxoMetadata],
  );

  // All unique tags across UTXOs
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    allManaged.forEach(u => u.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [allManaged]);

  // Counts for breakdown — single pass instead of 3 separate .filter() calls
  const { availableCount, frozenCount, lockedCount } = useMemo(() => {
    let available = 0, frozen = 0, locked = 0;
    for (const u of allManaged) {
      if (u.isLocked) locked++;
      else if (u.isFrozen) frozen++;
      else available++;
    }
    return { availableCount: available, frozenCount: frozen, lockedCount: locked };
  }, [allManaged]);

  // Filtered
  const filteredUtxos = useMemo(() => {
    let result: ManagedUTXO[];
    switch (filter) {
      case 'available':
        result = getAvailableUtxos(utxos);
        break;
      case 'frozen':
        result = getFrozenUtxos(utxos);
        break;
      case 'locked':
        result = getLockedUtxos(utxos);
        break;
      default:
        result = allManaged;
    }

    // Tag filter
    if (activeTag) {
      result = result.filter(u => u.tags?.includes(activeTag));
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(u => {
        if (u.txid.toLowerCase().includes(q)) return true;
        if (u.address.toLowerCase().includes(q)) return true;
        if (u.note?.toLowerCase().includes(q)) return true;
        if (u.tags?.some(t => t.toLowerCase().includes(q))) return true;
        if (String(u.vout).includes(q)) return true;
        return false;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortMode) {
        case 'amount_desc': return b.value - a.value;
        case 'amount_asc': return a.value - b.value;
        case 'confirmations_asc': return a.confirmations - b.confirmations;
        case 'confirmations_desc': return b.confirmations - a.confirmations;
        case 'newest': return a.confirmations - b.confirmations; // fewer confirmations = newer
        case 'status': {
          const statusOrder = (u: ManagedUTXO) => u.isLocked ? 2 : u.isFrozen ? 1 : 0;
          return statusOrder(a) - statusOrder(b);
        }
        default: return 0;
      }
    });

    return result;
  }, [utxos, filter, searchQuery, sortMode, activeTag, allManaged, utxoMetadata, getManagedUtxo, getAvailableUtxos, getFrozenUtxos, getLockedUtxos]);

  // Total value
  const totalValue = useMemo(
    () => filteredUtxos.reduce((sum, u) => sum + u.value, 0),
    [filteredUtxos],
  );

  const fiatTotal = price ? (totalValue / FORMATTING.SATS_PER_BTC) * price : null;

  // ─── Handlers ─────────────────────────
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleUtxoPress = useCallback((utxo: ManagedUTXO) => {
    haptics.trigger('selection');
    router.push({
      pathname: '/(auth)/utxo-detail',
      params: { utxoId: utxo.id },
    });
  }, [haptics, router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // The UTXO list comes from the wallet store sync
    // Just toggle refreshing for the visual feedback
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  // ─── Render: UTXO Card ────────────────
  const renderUtxo = useCallback(({ item: utxo }: { item: ManagedUTXO }) => {
    const statusColor = getStatusColor(utxo);
    const statusLabel = getStatusLabel(utxo);
    const statusBg = getStatusBg(utxo);
    const fiatValue = price ? (utxo.value / FORMATTING.SATS_PER_BTC) * price : null;

    return (
      <TouchableOpacity
        style={[styles.utxoCard, { backgroundColor: surfaceBg }]}
        onPress={() => handleUtxoPress(utxo)}
        activeOpacity={0.7}
      >
        <View style={styles.utxoCardInner}>
          {/* Top: Status pill + Confirmations */}
          <View style={styles.utxoTopRow}>
            <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <View style={[styles.confirmCapsule, {
              backgroundColor: utxo.confirmations > 0
                ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.08)')
                : (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)'),
            }]}>
              <Text style={[styles.confirmCapsuleText, {
                color: utxo.confirmations > 0 ? greenColor : redColor,
              }]}>
                {utxo.confirmations > 0 ? `${utxo.confirmations} conf` : 'Unconfirmed'}
              </Text>
            </View>
          </View>

          {/* Amount */}
          <Text style={[styles.utxoAmount, { color: colors.text }]}>
            {formatAmount(utxo.value, denomination)}
          </Text>

          {/* Secondary: alternate unit + fiat */}
          <Text style={[styles.utxoSecondary, { color: mutedText }]}>
            {denomination === 'sat'
              ? formatUnitAmount(utxo.value, 'btc')
              : formatUnitAmount(utxo.value, 'sat')
            }
            {fiatValue != null && ` · ${PriceAPI.formatPrice(fiatValue, currency)}`}
          </Text>

          {/* Meta row: TXID, Output, Address */}
          <View style={[styles.utxoMetaRow, { borderTopColor: dividerColor }]}>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: mutedText }]}>TXID</Text>
              <Text style={[styles.metaValue, { color: subtleText }]} numberOfLines={1}>
                {utxo.txid.substring(0, 8)}…
              </Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: dividerColor }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: mutedText }]}>Output</Text>
              <Text style={[styles.metaValue, { color: subtleText }]}>#{utxo.vout}</Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: dividerColor }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: mutedText }]}>Address</Text>
              <Text style={[styles.metaValue, { color: subtleText }]} numberOfLines={1}>
                {truncateAddress(utxo.address, 6, 4)}
              </Text>
            </View>
          </View>

          {/* Note badge */}
          {utxo.note && (
            <View style={[styles.noteBadge, { backgroundColor: chipBg }]}>
              <Ionicons name="document-text-outline" size={12} color={mutedText} />
              <Text style={[styles.noteBadgeText, { color: subtleText }]} numberOfLines={1}>
                {utxo.note}
              </Text>
            </View>
          )}

          {/* Tag badges */}
          {utxo.tags && utxo.tags.length > 0 && (
            <View style={styles.utxoTagsRow}>
              {utxo.tags.map(tag => (
                <View key={tag} style={[styles.utxoTagPill, { backgroundColor: isDark ? 'rgba(88,86,214,0.15)' : 'rgba(88,86,214,0.08)' }]}>
                  <Text style={[styles.utxoTagText, { color: isDark ? '#8E8EF5' : '#5856D6' }]}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Chevron */}
        <View style={styles.utxoChevron}>
          <Ionicons name="chevron-forward" size={16} color={isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'} />
        </View>
      </TouchableOpacity>
    );
  }, [
    colors, isDark, denomination, price, currency, surfaceBg,
    mutedText, subtleText, dividerColor, chipBg, handleUtxoPress,
  ]);

  // ─── Render: Empty ────────────────────
  const renderEmpty = useCallback(() => {
    const hasSearch = searchQuery.trim().length > 0;
    const hasFilterOrSearch = filter !== 'all' || hasSearch || activeTag !== null;

    // Search/filter produced no results
    if (hasFilterOrSearch && utxos.length > 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyRings}>
            <View style={[styles.emptyRing3, {
              borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
            }]} />
            <View style={[styles.emptyRing2, {
              borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
            }]} />
            <View style={[styles.emptyIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
            }]}>
              <Ionicons name="search-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
            </View>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No matches</Text>
          <Text style={[styles.emptySubtitle, { color: mutedText }]}>
            Try adjusting your search or filters
          </Text>
          <TouchableOpacity
            onPress={() => {
              setSearchQuery('');
              setFilter('all');
              setActiveTag(null);
            }}
            style={[styles.emptyAction, { backgroundColor: chipBg }]}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
            <Text style={[styles.emptyActionText, { color: colors.text }]}>Clear All Filters</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // True empty state per filter
    const msg = EMPTY_MESSAGES[filter];
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyRings}>
          <View style={[styles.emptyRing3, {
            borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          }]} />
          <View style={[styles.emptyRing2, {
            borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
          }]} />
          <View style={[styles.emptyIcon, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
          }]}>
            <Ionicons name={msg.icon} size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
          </View>
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>{msg.title}</Text>
        <Text style={[styles.emptySubtitle, { color: mutedText }]}>{msg.subtitle}</Text>
        {filter === 'all' && (
          <TouchableOpacity
            onPress={() => router.push('/(auth)/receive')}
            style={[styles.emptyAction, { backgroundColor: chipActiveBg }]}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-down" size={16} color={chipActiveText} style={{ marginRight: 6 }} />
            <Text style={[styles.emptyActionText, { color: chipActiveText }]}>Receive Bitcoin</Text>
          </TouchableOpacity>
        )}
        {filter === 'available' && (
          <TouchableOpacity
            onPress={() => setFilter('all')}
            style={[styles.emptyAction, { backgroundColor: chipBg }]}
            activeOpacity={0.7}
          >
            <Ionicons name="grid-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
            <Text style={[styles.emptyActionText, { color: colors.text }]}>View All UTXOs</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [filter, searchQuery, activeTag, utxos.length, colors, mutedText, chipBg, chipActiveBg, chipActiveText, router]);

  // ─── Main Render ──────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <Text style={[styles.headerTitle, { color: colors.text }]}>UTXO Management</Text>

          {/* Sort button */}
          <TouchableOpacity
            onPress={() => setShowSortSheet(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.sortButton, sortMode !== 'amount_desc' && {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            }]}
          >
            <Ionicons name="swap-vertical" size={20} color={sortMode !== 'amount_desc' ? colors.text : subtleText} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <PremiumInputCard>
          <PremiumInput
            icon="search"
            iconColor="#8E8E93"
            placeholder="Search by TXID, address, note..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            showClear
          />
        </PremiumInputCard>

        {/* Filter chips */}
        <View
          style={styles.filterRow}
        >
          {(Object.keys(FILTER_LABELS) as FilterType[]).map(key => {
            const active = filter === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => { haptics.trigger('selection'); setFilter(key); }}
                activeOpacity={0.7}
                style={[styles.filterChip, { backgroundColor: active ? chipActiveBg : chipBg }]}
              >
                <Text style={[styles.filterChipText, { color: active ? chipActiveText : subtleText }, active && { fontWeight: '600' }]}>
                  {FILTER_LABELS[key].label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagFilterRow}
          >
            {allTags.map(tag => {
              const active = activeTag === tag;
              return (
                <TouchableOpacity
                  key={tag}
                  onPress={() => {
                    haptics.trigger('selection');
                    setActiveTag(active ? null : tag);
                  }}
                  activeOpacity={0.7}
                  style={[styles.tagFilterChip, {
                    backgroundColor: active
                      ? (isDark ? 'rgba(88,86,214,0.25)' : 'rgba(88,86,214,0.12)')
                      : chipBg,
                  }]}
                >
                  <Ionicons
                    name="pricetag"
                    size={10}
                    color={active ? (isDark ? '#8E8EF5' : '#5856D6') : mutedText}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.tagFilterText, {
                    color: active ? (isDark ? '#8E8EF5' : '#5856D6') : subtleText,
                    fontWeight: active ? '600' : '500',
                  }]}>
                    {tag}
                  </Text>
                  {active && (
                    <Ionicons name="close" size={10} color={isDark ? '#8E8EF5' : '#5856D6'} style={{ marginLeft: 3 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* UTXO List */}
      <FlatList
        data={filteredUtxos}
        renderItem={renderUtxo}
        keyExtractor={item => item.id}
        ListEmptyComponent={renderEmpty}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (filteredUtxos.length > 1 ? 80 : 32) },
          filteredUtxos.length === 0 && { flex: 1 },
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

      {/* Sort Bottom Sheet */}
      <AppBottomSheet
        visible={showSortSheet}
        onClose={() => setShowSortSheet(false)}
        title="Sort UTXOs"
        sizing="auto"
      >
        <View style={styles.sortSheetContent}>
          {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => {
            const active = sortMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.sortOption, active && { backgroundColor: chipBg }]}
                onPress={() => {
                  setSortMode(mode);
                  setShowSortSheet(false);
                  haptics.trigger('selection');
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sortOptionText, {
                  color: active ? colors.text : subtleText,
                  fontWeight: active ? '600' : '400',
                }]}>
                  {SORT_LABELS[mode]}
                </Text>
                {active && (
                  <Ionicons name="checkmark" size={18} color={greenColor} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </AppBottomSheet>

      {/* Floating Summary Capsule — hide when 1 or fewer UTXOs */}
      {filteredUtxos.length > 1 && (
        <View style={[styles.floatingCapsule, {
          bottom: insets.bottom + 12,
          backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
        }]}>
          <Text style={[styles.capsuleCount, { color: colors.text }]}>
            {filteredUtxos.length}
          </Text>
          <Text style={[styles.capsuleLabel, { color: mutedText }]}>
            {filteredUtxos.length === 1 ? 'UTXO' : 'UTXOs'}
          </Text>
          <View style={[styles.capsuleDot, { backgroundColor: mutedText }]} />
          <Text style={[styles.capsuleValue, { color: colors.text }]}>
            {formatAmount(totalValue, denomination)}
          </Text>
          {fiatTotal != null && (
            <Text style={[styles.capsuleFiat, { color: mutedText }]}>
              {PriceAPI.formatPrice(fiatTotal, currency)}
            </Text>
          )}
        </View>
      )}
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
    paddingBottom: 8,
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
  sortButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },


  // Filter
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // List
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },

  // UTXO Card
  utxoCard: {
    flexDirection: 'row',
    borderRadius: 20,
    marginBottom: 10,
    overflow: 'hidden',
  },
  utxoCardInner: {
    flex: 1,
    padding: 16,
  },
  utxoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  confirmCapsule: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  confirmCapsuleText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  utxoAmount: {
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  utxoSecondary: {
    fontSize: 14,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  utxoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  metaItem: {
    flex: 1,
  },
  metaDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 10,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '400',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  noteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    alignSelf: 'flex-start',
  },
  noteBadgeText: {
    fontSize: 12,
    fontWeight: '400',
    flexShrink: 1,
  },
  utxoTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  utxoTagPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  utxoTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  utxoChevron: {
    justifyContent: 'center',
    paddingRight: 12,
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
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 20,
  },
  emptyActionText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },

  // Sort Sheet
  sortSheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 8,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 2,
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '400',
  },

  // Tag Filter
  tagFilterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 4,
  },
  tagFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tagFilterText: {
    fontSize: 12,
  },

  // Floating Capsule
  floatingCapsule: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  capsuleCount: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  capsuleLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  capsuleDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    marginHorizontal: 2,
  },
  capsuleValue: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  capsuleFiat: {
    fontSize: 13,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
});
