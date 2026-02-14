/**
 * UnitPickerSheet — Bottom sheet to pick Bitcoin unit or fiat currency for amount input.
 * Two sections: Bitcoin units (compact cards) and local currencies (searchable list).
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { useTheme } from '../../hooks';
import { BITCOIN_UNITS, THEME } from '../../constants';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import type { BitcoinUnit } from '../../types';

// ─── Bitcoin Unit Data ──────────────────────────────────────────

interface UnitOption {
  key: BitcoinUnit;
  label: string;
  symbol: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  example: string;
}

const UNIT_OPTIONS: UnitOption[] = [
  {
    key: 'sat',
    label: 'Satoshi',
    symbol: 'SAT',
    icon: 'grid-outline',
    color: '#007AFF',
    example: formatUnitAmount(100_000, 'sat', true),
  },
  {
    key: 'btc',
    label: 'Bitcoin',
    symbol: 'BTC',
    icon: 'logo-bitcoin',
    color: '#FF9F0A',
    example: formatUnitAmount(100_000, 'btc', true),
  },
  {
    key: 'mbtc',
    label: 'Millibitcoin',
    symbol: 'mBTC',
    icon: 'flash-outline',
    color: '#FF6B6B',
    example: formatUnitAmount(100_000, 'mbtc', true),
  },
  {
    key: 'ubtc',
    label: 'Bits',
    symbol: 'bits',
    icon: 'diamond-outline',
    color: '#BF5AF2',
    example: formatUnitAmount(100_000, 'ubtc', true),
  },
  {
    key: 'cbtc',
    label: 'Centibitcoin',
    symbol: 'cBTC',
    icon: 'layers-outline',
    color: '#30D158',
    example: formatUnitAmount(100_000, 'cbtc', true),
  },
  {
    key: 'dbtc',
    label: 'Decibitcoin',
    symbol: 'dBTC',
    icon: 'pie-chart-outline',
    color: '#FFD60A',
    example: formatUnitAmount(100_000, 'dbtc', true),
  },
];

// ─── Currency Data ──────────────────────────────────────────────

interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

const CURRENCIES: CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC', flag: '\u{1F1EA}\u{1F1FA}' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', flag: '\u{1F1E8}\u{1F1ED}' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '\u00A5', flag: '\u{1F1E8}\u{1F1F3}' },
  { code: 'AED', name: 'UAE Dirham', symbol: '\u062F.\u0625', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '\uFDFC', flag: '\u{1F1F8}\u{1F1E6}' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '\uFDFC', flag: '\u{1F1F6}\u{1F1E6}' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: '\u062F.\u0643', flag: '\u{1F1F0}\u{1F1FC}' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.\u062F.\u0628', flag: '\u{1F1E7}\u{1F1ED}' },
  { code: 'OMR', name: 'Omani Rial', symbol: '\uFDFC', flag: '\u{1F1F4}\u{1F1F2}' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: '\u062F.\u0627', flag: '\u{1F1EF}\u{1F1F4}' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: '\u00A3', flag: '\u{1F1EA}\u{1F1EC}' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: '\u062F.\u0645.', flag: '\u{1F1F2}\u{1F1E6}' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: '\u062F.\u062A', flag: '\u{1F1F9}\u{1F1F3}' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '\u20AA', flag: '\u{1F1EE}\u{1F1F1}' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '\u20BA', flag: '\u{1F1F9}\u{1F1F7}' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '\u{1F1FF}\u{1F1E6}' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '\u20A6', flag: '\u{1F1F3}\u{1F1EC}' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '\u{1F1F0}\u{1F1EA}' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '\u20B5', flag: '\u{1F1EC}\u{1F1ED}' },
  { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9', flag: '\u{1F1EE}\u{1F1F3}' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '\u20A8', flag: '\u{1F1F5}\u{1F1F0}' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '\u09F3', flag: '\u{1F1E7}\u{1F1E9}' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: '\u20A8', flag: '\u{1F1F1}\u{1F1F0}' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: '\u20A8', flag: '\u{1F1F3}\u{1F1F5}' },
  { code: 'KRW', name: 'South Korean Won', symbol: '\u20A9', flag: '\u{1F1F0}\u{1F1F7}' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', flag: '\u{1F1F9}\u{1F1FC}' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', flag: '\u{1F1ED}\u{1F1F0}' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '\u{1F1F8}\u{1F1EC}' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '\u{1F1F2}\u{1F1FE}' },
  { code: 'THB', name: 'Thai Baht', symbol: '\u0E3F', flag: '\u{1F1F9}\u{1F1ED}' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '\u{1F1EE}\u{1F1E9}' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '\u20B1', flag: '\u{1F1F5}\u{1F1ED}' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '\u20AB', flag: '\u{1F1FB}\u{1F1F3}' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', flag: '\u{1F1F3}\u{1F1FF}' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', flag: '\u{1F1F8}\u{1F1EA}' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', flag: '\u{1F1F3}\u{1F1F4}' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', flag: '\u{1F1E9}\u{1F1F0}' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'z\u0142', flag: '\u{1F1F5}\u{1F1F1}' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'K\u010D', flag: '\u{1F1E8}\u{1F1FF}' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', flag: '\u{1F1ED}\u{1F1FA}' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', flag: '\u{1F1F7}\u{1F1F4}' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: '\u043B\u0432', flag: '\u{1F1E7}\u{1F1EC}' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', flag: '\u{1F1ED}\u{1F1F7}' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '\u20BD', flag: '\u{1F1F7}\u{1F1FA}' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '\u20B4', flag: '\u{1F1FA}\u{1F1E6}' },
  { code: 'ISK', name: 'Icelandic Kr\u00F3na', symbol: 'kr', flag: '\u{1F1EE}\u{1F1F8}' },
  { code: 'GEL', name: 'Georgian Lari', symbol: '\u20BE', flag: '\u{1F1EC}\u{1F1EA}' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', flag: '\u{1F1F2}\u{1F1FD}' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', flag: '\u{1F1E6}\u{1F1F7}' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', flag: '\u{1F1E8}\u{1F1F1}' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', flag: '\u{1F1E8}\u{1F1F4}' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', flag: '\u{1F1F5}\u{1F1EA}' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', flag: '\u{1F1FA}\u{1F1FE}' },
];

// ─── Props ──────────────────────────────────────────────────────

interface UnitPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  activeUnit: string; // BitcoinUnit | 'fiat'
  activeCurrency: string;
  onSelectUnit: (unit: BitcoinUnit) => void;
  onSelectCurrency: (code: string) => void;
}

// ─── Component ──────────────────────────────────────────────────

export function UnitPickerSheet({
  visible,
  onClose,
  activeUnit,
  activeCurrency,
  onSelectUnit,
  onSelectCurrency,
}: UnitPickerSheetProps) {
  const { isDark, colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const isFiatActive = activeUnit === 'fiat';

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';

  const filteredCurrencies = useMemo(() => {
    if (!searchQuery.trim()) return CURRENCIES;
    const q = searchQuery.toLowerCase();
    return CURRENCIES.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleSelectUnit = useCallback((key: BitcoinUnit) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectUnit(key);
    setSearchQuery('');
    onClose();
  }, [onSelectUnit, onClose]);

  const handleSelectCurrency = useCallback((code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectCurrency(code);
    setSearchQuery('');
    onClose();
  }, [onSelectCurrency, onClose]);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={() => { setSearchQuery(''); onClose(); }}
      title="Input Currency"
      sizing="large"
      scrollable
    >
      {/* Bitcoin Units Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>
          BITCOIN UNITS
        </Text>
        {UNIT_OPTIONS.map((opt) => {
          const isSelected = !isFiatActive && activeUnit === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.unitCard, {
                backgroundColor: surfaceBg,
                borderColor: isSelected ? opt.color : 'transparent',
                borderWidth: isSelected ? 1.5 : 0,
              }]}
              activeOpacity={0.7}
              onPress={() => handleSelectUnit(opt.key)}
            >
              <View style={[styles.unitIconCircle, {
                backgroundColor: isDark ? `${opt.color}1F` : `${opt.color}14`,
              }]}>
                <Ionicons name={opt.icon} size={20} color={opt.color} />
              </View>
              <View style={styles.unitContent}>
                <Text style={[styles.unitTitle, { color: textPrimary }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.unitSymbol, { color: textSecondary }]}>
                  {opt.symbol}
                </Text>
              </View>
              <Text style={[styles.unitExample, { color: textMuted }]}>
                {opt.example}
              </Text>
              {isSelected && (
                <View style={[styles.checkmark, { backgroundColor: opt.color }]}>
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Local Currency Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>
          LOCAL CURRENCY
        </Text>

        {/* Search */}
        <View style={styles.searchContainer}>
          <PremiumInputCard>
            <PremiumInput
              ref={searchInputRef}
              icon="search"
              iconColor="#8E8E93"
              placeholder="Search currencies..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              showClear
            />
          </PremiumInputCard>
        </View>

        {/* Currency list */}
        {filteredCurrencies.map((cur) => {
          const isCurSelected = isFiatActive && activeCurrency === cur.code;
          return (
            <TouchableOpacity
              key={cur.code}
              style={[styles.currencyItem, {
                backgroundColor: isCurSelected
                  ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)')
                  : 'transparent',
              }]}
              activeOpacity={0.7}
              onPress={() => handleSelectCurrency(cur.code)}
            >
              <Text style={styles.currencyFlag}>{cur.flag}</Text>
              <View style={styles.currencyInfo}>
                <View style={styles.currencyTopRow}>
                  <Text style={[styles.currencyCode, { color: textPrimary }]}>{cur.code}</Text>
                  <Text style={[styles.currencySymbolBadge, {
                    color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }]}>{cur.symbol}</Text>
                </View>
                <Text style={[styles.currencyName, { color: textSecondary }]}>{cur.name}</Text>
              </View>
              {isCurSelected && (
                <View style={[styles.checkmark, {
                  backgroundColor: isDark ? THEME.brand.bitcoin : '#000000',
                }]}>
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {filteredCurrencies.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={32} color={textMuted} />
            <Text style={[styles.emptyText, { color: textMuted }]}>No currencies found</Text>
          </View>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingLeft: 2,
  },

  // Unit cards
  unitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    padding: 14,
    borderRadius: 16,
    gap: 12,
  },
  unitIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitContent: { flex: 1 },
  unitTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  unitSymbol: { fontSize: 13, fontWeight: '500', marginTop: 1 },
  unitExample: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    marginRight: 8,
  },

  // Search
  searchContainer: {
    marginBottom: 8,
  },

  // Currency items
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 2,
  },
  currencyFlag: { fontSize: 28, marginRight: 14 },
  currencyInfo: { flex: 1 },
  currencyTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currencyCode: { fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  currencySymbolBadge: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    overflow: 'hidden',
  },
  currencyName: { fontSize: 13, marginTop: 2 },

  // Checkmark
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: { fontSize: 15, fontWeight: '500' },
});
