import '../../shim';
import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSettingsStore } from '../../src/stores';
import { usePriceStore } from '../../src/stores/priceStore';
import { useTheme, useHaptics } from '../../src/hooks';
import { THEME } from '../../src/constants';

// ─── Currency Data ──────────────────────────────────────────────

const CURRENCIES = [
  // Major currencies
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC', flag: '\u{1F1EA}\u{1F1FA}' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', flag: '\u{1F1E8}\u{1F1ED}' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '\u00A5', flag: '\u{1F1E8}\u{1F1F3}' },
  // Middle East & Africa
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
  // Asia Pacific
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
  // Europe
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
  // Americas
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', flag: '\u{1F1F2}\u{1F1FD}' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', flag: '\u{1F1E6}\u{1F1F7}' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', flag: '\u{1F1E8}\u{1F1F1}' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', flag: '\u{1F1E8}\u{1F1F4}' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', flag: '\u{1F1F5}\u{1F1EA}' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', flag: '\u{1F1FA}\u{1F1FE}' },
];

// ─── Component ──────────────────────────────────────────────────

export default function LocalCurrencyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const currency = useSettingsStore(s => s.currency);
  const setCurrency = useSettingsStore(s => s.setCurrency);
  const priceCurrency = usePriceStore(s => s.currency);
  const setPriceCurrency = usePriceStore(s => s.setCurrency);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const selectedCurrency = currency || priceCurrency || 'USD';

  const filteredCurrencies = useMemo(() => {
    if (!searchQuery.trim()) return CURRENCIES;
    const q = searchQuery.toLowerCase();
    return CURRENCIES.filter(
      c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleSelect = useCallback(async (code: string) => {
    setCurrency(code);
    setPriceCurrency(code);
    await haptics.trigger('success');
  }, [setCurrency, setPriceCurrency, haptics]);

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const searchBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  const selectedInfo = CURRENCIES.find(c => c.code === selectedCurrency);

  const renderCurrency = useCallback(({ item }: { item: typeof CURRENCIES[0] }) => {
    const isSelected = item.code === selectedCurrency;
    return (
      <TouchableOpacity
        style={[styles.currencyItem, {
          backgroundColor: isSelected
            ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)')
            : 'transparent',
        }]}
        activeOpacity={0.7}
        onPress={() => handleSelect(item.code)}
      >
        <Text style={styles.currencyFlag}>{item.flag}</Text>
        <View style={styles.currencyInfo}>
          <View style={styles.currencyTopRow}>
            <Text style={[styles.currencyCode, { color: textPrimary }]}>{item.code}</Text>
            <Text style={[styles.currencySymbolBadge, {
              color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}>{item.symbol}</Text>
          </View>
          <Text style={[styles.currencyName, { color: textSecondary }]}>{item.name}</Text>
        </View>
        {isSelected && (
          <View style={[styles.checkmark, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [selectedCurrency, isDark, textPrimary, textSecondary, handleSelect]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Animated.Text
          entering={FadeIn.duration(300)}
          style={[styles.largeTitle, { color: textPrimary }]}
        >
          Local Currency
        </Animated.Text>

        {/* Current selection badge */}
        {selectedInfo && (
          <Animated.View entering={FadeIn.delay(50).duration(300)} style={[styles.currentBadge, {
            backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.06)',
          }]}>
            <Text style={styles.currentBadgeFlag}>{selectedInfo.flag}</Text>
            <Text style={[styles.currentBadgeCode, {
              color: isDark ? 'rgba(48,209,88,0.90)' : '#30D158',
            }]}>{selectedInfo.code}</Text>
          </Animated.View>
        )}

        {/* Search Bar */}
        <Animated.View entering={FadeIn.delay(80).duration(300)}>
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
        </Animated.View>
      </View>

      {/* Currency List */}
      <FlatList
        data={filteredCurrencies}
        renderItem={renderCurrency}
        keyExtractor={item => item.code}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={36} color={textMuted} />
            <Text style={[styles.emptyText, { color: textMuted }]}>No currencies found</Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 4 },
  backButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    marginLeft: -8, marginBottom: 4,
  },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8 },
  currentBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginBottom: 14,
  },
  currentBadgeFlag: { fontSize: 16 },
  currentBadgeCode: { fontSize: 13, fontWeight: '700' },


  listContent: { paddingHorizontal: 24 },

  currencyItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 2,
  },
  currencyFlag: { fontSize: 28, marginRight: 14 },
  currencyInfo: { flex: 1 },
  currencyTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currencyCode: { fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  currencySymbolBadge: {
    fontSize: 11, fontWeight: '600',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, overflow: 'hidden',
  },
  currencyName: { fontSize: 13, marginTop: 2 },
  checkmark: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontWeight: '500' },
});
