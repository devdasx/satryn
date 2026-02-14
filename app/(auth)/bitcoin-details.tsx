/**
 * Bitcoin Details Screen
 * Premium screen showing Bitcoin price, interactive chart, and market stats
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  AppState,
  AppStateStatus,
  TextInput,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  withTiming,
  useDerivedValue,
  useAnimatedProps,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../src/hooks';

// Create Animated TextInput for price display
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
import { THEME, typography, spacing, radius } from '../../src/constants';
import { MarketAPI, BinanceWebSocket, type TimeRange, type MarketData, type ChartData, type LivePriceData, type PricePoint } from '../../src/services/api';
import { PriceChart } from '../../src/components/market';
import { useSyncStore } from '../../src/stores/syncStore';

// Time range options
const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: '1D', label: '1D' },
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '1Y', label: '1Y' },
  { key: 'LIVE', label: 'LIVE' },
];

// Live chart window: 15 minutes in milliseconds
const LIVE_WINDOW_MS = 15 * 60 * 1000;

// Stale data threshold (5 minutes)
const STALE_THRESHOLD = 5 * 60 * 1000;

export default function BitcoinDetailsScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const isNetworkConnected = useSyncStore((state) => state.isNetworkConnected);

  // State
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1D');
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [isLoadingMarket, setIsLoadingMarket] = useState(true);
  const [isLoadingChart, setIsLoadingChart] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  // Touch price state (for chart interaction)
  const [touchPrice, setTouchPrice] = useState<number | null>(null);
  const [touchTimestamp, setTouchTimestamp] = useState<number | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Live streaming state
  const [liveData, setLiveData] = useState<PricePoint[]>([]);
  const [livePriceData, setLivePriceData] = useState<LivePriceData | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  // Animated price for smooth transitions
  const animatedPrice = useSharedValue(0);
  const isTouching = useSharedValue(false);

  // Prevent double fetching
  const hasFetchedRef = useRef(false);

  // Track if this is the first price load
  const isFirstPriceLoad = useRef(true);

  // Update animated price when market data changes (but not while touching)
  useEffect(() => {
    if (marketData?.currentPrice && !isTouching.value) {
      if (isFirstPriceLoad.current) {
        // Set immediately on first load (no animation)
        animatedPrice.value = marketData.currentPrice;
        isFirstPriceLoad.current = false;
      } else {
        // Animate subsequent updates
        animatedPrice.value = withTiming(marketData.currentPrice, {
          duration: 300,
          easing: Easing.out(Easing.quad),
        });
      }
    }
  }, [marketData?.currentPrice]);

  // Check if data is stale
  const isStale = useMemo(() => {
    return Date.now() - lastUpdated > STALE_THRESHOLD;
  }, [lastUpdated]);

  // Calculate price change and high/low from chart data
  // Only use chart data if it matches the selected time range
  const chartStats = useMemo(() => {
    // Handle LIVE mode with live data
    if (selectedRange === 'LIVE') {
      if (liveData.length < 2) {
        // Use live price data for change stats if available
        if (livePriceData) {
          return {
            change: livePriceData.priceChange24h ?? 0,
            percent: livePriceData.priceChangePercent24h ?? 0,
            high: livePriceData.price,
            low: livePriceData.price,
          };
        }
        return null;
      }

      const prices = liveData.map(p => p.price);
      const first = prices[0];
      const last = prices[prices.length - 1];
      const change = last - first;
      const percent = (change / first) * 100;
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      return { change, percent, high, low };
    }

    // Handle historical data
    if (!chartData || chartData.prices.length < 2) return null;
    // Make sure chart data matches the selected range
    if (chartData.timeRange !== selectedRange) return null;

    const prices = chartData.prices.map(p => p.price);
    const first = prices[0];
    const last = prices[prices.length - 1];
    const change = last - first;
    const percent = (change / first) * 100;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    return { change, percent, high, low };
  }, [chartData, selectedRange, liveData, livePriceData]);

  // For backward compatibility
  const priceChangeFromChart = chartStats;

  // Determine if price is positive
  const isPositive = useMemo(() => {
    if (priceChangeFromChart) return priceChangeFromChart.percent >= 0;
    if (marketData) return marketData.changePercent24h >= 0;
    return true;
  }, [priceChangeFromChart, marketData]);

  // Fetch market data with rate limit handling
  const fetchMarketData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoadingMarket(true);
      setError(null);
      const data = await MarketAPI.getMarketData('usd');
      setMarketData(data);
      setLastUpdated(data.lastUpdated || Date.now());
      setError(null); // Clear any previous error on success
    } catch (err: any) {
      // Failed to fetch market data
      // Only show error if we don't have any data to display
      if (!marketData) {
        setError('Unable to load data. Check your connection.');
      }
    } finally {
      setIsLoadingMarket(false);
    }
  }, [marketData]);

  // Fetch chart data (caching is handled in MarketAPI)
  const fetchChartData = useCallback(async (range: TimeRange, showLoading = true) => {
    try {
      if (showLoading) setIsLoadingChart(true);
      const data = await MarketAPI.getChartData('usd', range);
      // Only update if data matches the requested range
      if (data.timeRange === range) {
        setChartData(data);
      }
    } catch (err: any) {
      // Failed to fetch chart data
      // If we have no data for this range, clear chart to show loading/empty state
      // This prevents showing wrong data from a different time range
      if (chartData?.timeRange !== range) {
        // Keep showing old data but user will see the loading indicator
      }
    } finally {
      setIsLoadingChart(false);
    }
  }, [chartData?.timeRange]);

  // Initial fetch - only once
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    // Fetch market data (caching is handled internally by MarketAPI)
    fetchMarketData();

    // Delay chart fetch by 500ms to spread out API calls
    const timer = setTimeout(() => {
      fetchChartData(selectedRange);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Fetch chart when range changes (but not on initial mount)
  const isFirstRangeChange = useRef(true);
  useEffect(() => {
    if (isFirstRangeChange.current) {
      isFirstRangeChange.current = false;
      return;
    }
    // Fetch new chart data for the selected range
    // Keep old data visible while loading to prevent flicker
    fetchChartData(selectedRange);
  }, [selectedRange, fetchChartData]);

  // Auto-refresh market data every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      fetchMarketData(false);
    }, 60 * 1000);

    // Also refresh when app comes to foreground
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        fetchMarketData(false);
      }
    });

    return () => {
      clearInterval(refreshInterval);
      subscription.remove();
    };
  }, [fetchMarketData]);

  // Handle LIVE mode WebSocket subscription
  // Throttle chart updates for smooth animation (every 2 seconds)
  const lastChartUpdateRef = useRef<number>(0);
  const pendingPriceRef = useRef<{ timestamp: number; price: number } | null>(null);
  const chartUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (selectedRange !== 'LIVE') {
      // Not in LIVE mode, no WebSocket needed
      setIsLiveConnected(false);
      if (chartUpdateIntervalRef.current) {
        clearInterval(chartUpdateIntervalRef.current);
        chartUpdateIntervalRef.current = null;
      }
      return;
    }

    // Set up interval to update chart smoothly every 2 seconds
    chartUpdateIntervalRef.current = setInterval(() => {
      if (pendingPriceRef.current) {
        const { timestamp, price } = pendingPriceRef.current;
        setLiveData((prev) => {
          // Filter out points older than 15 minutes
          const cutoffTime = timestamp - LIVE_WINDOW_MS;
          const filtered = prev.filter(p => p.timestamp > cutoffTime);

          // Only add if this is a new point (avoid duplicates)
          const lastPoint = filtered[filtered.length - 1];
          if (!lastPoint || lastPoint.timestamp !== timestamp) {
            return [...filtered, { timestamp, price }];
          }
          return filtered;
        });
        pendingPriceRef.current = null;
      }
    }, 2000);

    const unsubscribe = BinanceWebSocket.subscribe((data: LivePriceData) => {
      setIsLiveConnected(true);
      setLivePriceData(data);
      setLastUpdated(data.timestamp);

      // Update animated price smoothly (this can be frequent)
      if (!isTouching.value) {
        animatedPrice.value = withTiming(data.price, {
          duration: 300,
          easing: Easing.out(Easing.quad),
        });
      }

      // Store pending price for next chart update
      pendingPriceRef.current = { timestamp: data.timestamp, price: data.price };

      // Immediately update chart if this is the first point or first update in a while
      const now = Date.now();
      if (now - lastChartUpdateRef.current > 2000) {
        lastChartUpdateRef.current = now;
        setLiveData((prev) => {
          const cutoffTime = data.timestamp - LIVE_WINDOW_MS;
          const filtered = prev.filter(p => p.timestamp > cutoffTime);
          return [...filtered, { timestamp: data.timestamp, price: data.price }];
        });
        pendingPriceRef.current = null;
      }
    });

    return () => {
      unsubscribe();
      setIsLiveConnected(false);
      if (chartUpdateIntervalRef.current) {
        clearInterval(chartUpdateIntervalRef.current);
        chartUpdateIntervalRef.current = null;
      }
    };
  }, [selectedRange, animatedPrice, isTouching]);

  // Handle time range change
  const handleRangeChange = useCallback((range: TimeRange) => {
    if (range === selectedRange) return;
    Haptics.selectionAsync();

    // Clear live data when switching away from LIVE
    if (selectedRange === 'LIVE' && range !== 'LIVE') {
      setLiveData([]);
      setLivePriceData(null);
    }

    setSelectedRange(range);
  }, [selectedRange]);

  // Handle chart touch with animated price updates
  const handlePriceSelect = useCallback((price: number | null, timestamp: number | null) => {
    setTouchPrice(price);
    setTouchTimestamp(timestamp);

    if (price !== null) {
      isTouching.value = true;
      // Animate to the new price smoothly
      animatedPrice.value = withTiming(price, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    } else {
      isTouching.value = false;
      // Animate back to current market price
      if (marketData?.currentPrice) {
        animatedPrice.value = withTiming(marketData.currentPrice, {
          duration: 200,
          easing: Easing.out(Easing.quad),
        });
      }
    }
  }, [marketData?.currentPrice, animatedPrice, isTouching]);

  // Format display price
  const displayPrice = useMemo(() => {
    if (touchPrice !== null) return touchPrice;
    if (selectedRange === 'LIVE' && livePriceData) return livePriceData.price;
    return marketData?.currentPrice ?? 0;
  }, [touchPrice, selectedRange, livePriceData, marketData?.currentPrice]);

  // Use chart-based change for selected time range, fallback to 24h change only for 1D
  const displayChange = useMemo(() => {
    // If we have chart data, calculate change from chart (for any time range)
    if (priceChangeFromChart) {
      return { amount: priceChangeFromChart.change, percent: priceChangeFromChart.percent };
    }
    // Fallback to 24h market data change
    return { amount: marketData?.change24h ?? 0, percent: marketData?.changePercent24h ?? 0 };
  }, [priceChangeFromChart, marketData?.change24h, marketData?.changePercent24h]);

  // Animated price text using derived value
  const animatedPriceText = useDerivedValue(() => {
    'worklet';
    const price = animatedPrice.value;
    if (price === 0) return '—'; // Show dash while loading
    // Format with commas and 2 decimal places
    const formatted = price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + formatted;
  });

  // Animated props for the price TextInput
  const priceAnimatedProps = useAnimatedProps(() => {
    return {
      text: animatedPriceText.value,
    } as any; // TextInput doesn't have 'text' in types, but it works for animated values
  });

  // Format timestamp for display
  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    if (selectedRange === '1D' || selectedRange === 'LIVE') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: selectedRange === 'LIVE' ? '2-digit' : undefined });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: selectedRange === '1Y' ? 'numeric' : undefined });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.glass }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>BITCOIN</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textTertiary }]}>BTC/USD</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Offline Banner */}
      {!isNetworkConnected && (
        <View style={[styles.offlineBanner, { backgroundColor: isDark ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 59, 48, 0.12)' }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
          <Text style={[styles.offlineText, { color: colors.error }]}>No connection</Text>
        </View>
      )}

      {/* Stale Data Banner */}
      {isStale && isNetworkConnected && !isLoadingMarket && (
        <View style={[styles.staleBanner, { backgroundColor: isDark ? 'rgba(255, 214, 10, 0.15)' : 'rgba(255, 149, 0, 0.12)' }]}>
          <Ionicons name="time-outline" size={16} color={colors.warning} />
          <Text style={[styles.staleText, { color: colors.warning }]}>Data may be outdated</Text>
        </View>
      )}

      {/* Error Banner */}
      {error && !marketData && (
        <View style={[styles.errorBanner, { backgroundColor: isDark ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 59, 48, 0.12)' }]}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* Price Block */}
        <View style={styles.priceBlock}>
          {isLoadingMarket && !marketData ? (
            <View style={styles.priceLoading}>
              <View style={[styles.priceSkeleton, { backgroundColor: colors.glass }]} />
              <View style={[styles.changeSkeleton, { backgroundColor: colors.glass }]} />
            </View>
          ) : (
            <>
              <AnimatedTextInput
                style={[styles.price, styles.animatedPrice, { color: colors.text }]}
                animatedProps={priceAnimatedProps}
                editable={false}
                pointerEvents="none"
              />
              <View style={styles.changeRow}>
                <Text
                  style={[
                    styles.changeText,
                    { color: isPositive ? colors.success : colors.error },
                  ]}
                >
                  {MarketAPI.formatPercentChange(displayChange.percent)}
                </Text>
                <Text style={[styles.changeAmount, { color: colors.textTertiary }]}>
                  {' '}({MarketAPI.formatPriceChange(displayChange.amount)})
                </Text>
                {touchTimestamp && (
                  <Text style={[styles.touchTime, { color: colors.textTertiary }]}>
                    {' '}{formatTimestamp(touchTimestamp)}
                  </Text>
                )}
              </View>
              {(chartStats || marketData) && (
                <View style={styles.highLowRow}>
                  <Text style={[styles.highLowText, { color: colors.textMuted }]}>
                    H: ${(chartStats?.high ?? marketData?.high24h ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[styles.highLowSeparator, { color: colors.textMuted }]}> / </Text>
                  <Text style={[styles.highLowText, { color: colors.textMuted }]}>
                    L: ${(chartStats?.low ?? marketData?.low24h ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Chart */}
        <View style={styles.chartContainer}>
          <PriceChart
            data={selectedRange === 'LIVE' ? liveData : (chartData?.timeRange === selectedRange ? chartData.prices : [])}
            isLoading={selectedRange === 'LIVE' ? (liveData.length < 2 && !isLiveConnected) : (isLoadingChart || chartData?.timeRange !== selectedRange)}
            isPositive={isPositive}
            onPriceSelect={handlePriceSelect}
            onTouchStart={() => setScrollEnabled(false)}
            onTouchEnd={() => setScrollEnabled(true)}
            height={220}
            isLive={selectedRange === 'LIVE'}
          />
        </View>

        {/* Time Range Selector */}
        <View style={styles.rangeSelector}>
          {TIME_RANGES.map((range) => {
            const isSelected = selectedRange === range.key;
            const isLiveButton = range.key === 'LIVE';
            return (
              <Pressable
                key={range.key}
                onPress={() => handleRangeChange(range.key)}
                style={[
                  styles.rangeButton,
                  isSelected && { backgroundColor: colors.text },
                ]}
              >
                <View style={styles.rangeButtonContent}>
                  {isLiveButton && (
                    <Animated.View
                      style={[
                        styles.liveDot,
                        {
                          backgroundColor: isSelected ? colors.background : colors.error,
                        },
                      ]}
                    />
                  )}
                  <Text
                    style={[
                      styles.rangeButtonText,
                      { color: isSelected ? colors.background : colors.textTertiary },
                      isSelected && styles.rangeButtonTextSelected,
                    ]}
                  >
                    {range.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Stats Section */}
        <View style={styles.statsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>MARKET STATS</Text>

          <View style={styles.statsGrid}>
            {/* Market Cap */}
            <View style={[styles.statCard, { backgroundColor: colors.glass }]}>
              {Platform.OS === 'ios' && (
                <BlurView
                  intensity={isDark ? 30 : 60}
                  tint={isDark ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Market Cap</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {isLoadingMarket && !marketData ? '—' : MarketAPI.formatLargeNumber(marketData?.marketCap ?? null)}
              </Text>
            </View>

            {/* 24h Volume */}
            <View style={[styles.statCard, { backgroundColor: colors.glass }]}>
              {Platform.OS === 'ios' && (
                <BlurView
                  intensity={isDark ? 30 : 60}
                  tint={isDark ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>24h Volume</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {isLoadingMarket && !marketData ? '—' : MarketAPI.formatLargeNumber(marketData?.totalVolume24h ?? null)}
              </Text>
            </View>

            {/* Circulating Supply */}
            <View style={[styles.statCard, { backgroundColor: colors.glass }]}>
              {Platform.OS === 'ios' && (
                <BlurView
                  intensity={isDark ? 30 : 60}
                  tint={isDark ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Circulating</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {isLoadingMarket && !marketData ? '—' : MarketAPI.formatSupply(marketData?.circulatingSupply ?? null)}
              </Text>
            </View>

            {/* Max Supply */}
            <View style={[styles.statCard, { backgroundColor: colors.glass }]}>
              {Platform.OS === 'ios' && (
                <BlurView
                  intensity={isDark ? 30 : 60}
                  tint={isDark ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Max Supply</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>21M BTC</Text>
            </View>
          </View>
        </View>

        {/* Last Updated */}
        <View style={styles.footer}>
          <Text style={[styles.lastUpdated, { color: colors.textMuted }]}>
            {selectedRange === 'LIVE' && isLiveConnected ? (
              'Live • ' + new Date(lastUpdated).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            ) : (
              'Last updated: ' + new Date(lastUpdated).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            )}
          </Text>
          <Text style={[styles.dataSource, { color: colors.textMuted }]}>
            {selectedRange === 'LIVE' ? 'Live data from Binance' : 'Data from CoinGecko'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    letterSpacing: 1.5,
  },
  headerSubtitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginTop: 2,
  },
  headerSpacer: {
    width: 40,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  offlineText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  staleText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  errorText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['3xl'],
  },
  priceBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  priceLoading: {
    gap: spacing.sm,
  },
  priceSkeleton: {
    width: 200,
    height: 48,
    borderRadius: radius.md,
  },
  changeSkeleton: {
    width: 120,
    height: 24,
    borderRadius: radius.sm,
  },
  price: {
    fontSize: typography.size['4xl'],
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  animatedPrice: {
    padding: 0,
    margin: 0,
    // Remove default TextInput styling
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  changeText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    fontVariant: ['tabular-nums'],
  },
  changeAmount: {
    fontSize: typography.size.base,
    fontWeight: typography.weight.medium,
    fontVariant: ['tabular-nums'],
  },
  touchTime: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  highLowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  highLowText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    fontVariant: ['tabular-nums'],
  },
  highLowSeparator: {
    fontSize: typography.size.sm,
  },
  chartContainer: {
    // Full width - no horizontal padding for professional look
    paddingVertical: spacing.md,
  },
  rangeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  rangeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rangeButtonText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  rangeButtonTextSelected: {
    fontWeight: typography.weight.bold,
  },
  statsSection: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '45%',
    padding: spacing.base,
    borderRadius: radius.lg,
    overflow: 'hidden' as const,
  },
  statLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  lastUpdated: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  dataSource: {
    fontSize: typography.size['2xs'],
    fontWeight: typography.weight.regular,
  },
});
