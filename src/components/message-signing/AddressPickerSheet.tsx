/**
 * AddressPickerSheet — Bottom sheet with search bar, filter chips, and address list.
 * Used in the Sign Message screen for selecting a wallet address.
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics } from '../../hooks';
import { useWalletStore } from '../../stores';
import type { AddressInfo } from '../../types';
import {
  AppBottomSheet,
  SheetOptionRow,
} from '../ui';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';

// ─── Types ──────────────────────────────────────────────────────────

type AddressFilter = 'all' | 'unused' | 'used';

interface AddressPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  addresses: AddressInfo[];
  selectedAddress: string;
  onSelect: (address: string) => void;
}

// ─── Filter Chip ────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { isDark } = useTheme();
  const haptics = useHaptics();

  const bg = active
    ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
    : 'transparent';
  const textColor = active
    ? (isDark ? '#FFFFFF' : '#000000')
    : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)');
  const borderColor = active
    ? 'transparent'
    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');

  return (
    <Pressable
      onPress={() => { haptics.trigger('selection'); onPress(); }}
      style={[styles.chip, { backgroundColor: bg, borderColor }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

// ─── AddressPickerSheet ─────────────────────────────────────────────

export function AddressPickerSheet({
  visible,
  onClose,
  addresses,
  selectedAddress,
  onSelect,
}: AddressPickerSheetProps) {
  const { isDark } = useTheme();
  const haptics = useHaptics();

  // Search state with debounce
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<AddressFilter>('all');
  const searchTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Used addresses from wallet store
  const usedAddresses = useWalletStore((s) => s.usedAddresses);

  const handleSearch = useCallback((text: string) => {
    setSearchInput(text);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(text.toLowerCase().trim());
    }, 200);
  }, []);

  // Filter and search addresses
  const filteredAddresses = useMemo(() => {
    let result = addresses;

    // Apply filter
    if (filter === 'used') {
      result = result.filter(a => usedAddresses.has(a.address));
    } else if (filter === 'unused') {
      result = result.filter(a => !usedAddresses.has(a.address));
    }

    // Apply search
    if (debouncedQuery) {
      result = result.filter(a =>
        a.address.toLowerCase().includes(debouncedQuery)
        || String(a.index).includes(debouncedQuery)
        || a.path.toLowerCase().includes(debouncedQuery)
      );
    }

    return result;
  }, [addresses, filter, debouncedQuery, usedAddresses]);

  const truncateAddress = (addr: string) => {
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
  };

  const handleSelect = (addr: string) => {
    haptics.trigger('success');
    onSelect(addr);
  };

  // Reset state when sheet closes
  const handleClose = () => {
    setSearchInput('');
    setDebouncedQuery('');
    setFilter('all');
    onClose();
  };

  const emptyIconColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
  const emptyTextColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={handleClose}
      title="Select Address"
      subtitle="Choose an address from your wallet"
      sizing="large"
      scrollable
    >
      {/* Search Bar */}
      <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
        <PremiumInputCard>
          <PremiumInput
            icon="search"
            placeholder="Search address, index, or path..."
            value={searchInput}
            onChangeText={handleSearch}
            showClear
          />
        </PremiumInputCard>
      </View>

      {/* Filter Chips */}
      <View style={styles.chipRow}>
        <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterChip label="Unused" active={filter === 'unused'} onPress={() => setFilter('unused')} />
        <FilterChip label="Used" active={filter === 'used'} onPress={() => setFilter('used')} />
      </View>

      {/* Address List */}
      {filteredAddresses.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={32} color={emptyIconColor} />
          <Text style={[styles.emptyText, { color: emptyTextColor }]}>
            {debouncedQuery ? 'No matching addresses' : 'No addresses available'}
          </Text>
        </View>
      ) : (
        filteredAddresses.map((addr, idx) => (
          <SheetOptionRow
            key={addr.address}
            icon="location-outline"
            label={truncateAddress(addr.address)}
            description={`Index ${addr.index} \u2022 ${addr.path}`}
            selected={addr.address === selectedAddress}
            onPress={() => handleSelect(addr.address)}
            showDivider={idx !== filteredAddresses.length - 1}
          />
        ))
      )}

      <View style={{ height: 40 }} />
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
