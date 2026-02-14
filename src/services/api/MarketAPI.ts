/**
 * MarketAPI
 * Fetches historical Bitcoin price data and market stats from CoinGecko
 * With built-in caching (memory + AsyncStorage) to handle rate limits gracefully
 */

import { API } from '../../constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
  MARKET_DATA: 'market_data_cache',
  CHART_DATA: 'chart_data_cache',
};

// Time ranges for chart data
export type TimeRange = '1D' | '1W' | '1M' | '1Y' | 'LIVE';

// Price point for chart
export interface PricePoint {
  timestamp: number;
  price: number;
}

// Market data structure
export interface MarketData {
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  marketCap: number | null;
  circulatingSupply: number | null;
  totalVolume24h: number | null;
  lastUpdated: number;
}

// Chart data response
export interface ChartData {
  prices: PricePoint[];
  timeRange: TimeRange;
  currency: string;
}

// CoinGecko response types
interface CoinGeckoBitcoinPrice {
  [currency: string]: number | undefined;
}

interface CoinGeckoMarketData {
  bitcoin: CoinGeckoBitcoinPrice;
}

interface CoinGeckoHistoryResponse {
  prices: [number, number][];
}

interface CoinGeckoDetailResponse {
  market_data: {
    current_price: { [key: string]: number };
    price_change_24h: number;
    price_change_percentage_24h: number;
    high_24h: { [key: string]: number };
    low_24h: { [key: string]: number };
    market_cap: { [key: string]: number };
    circulating_supply: number;
    total_volume: { [key: string]: number };
  };
  last_updated: string;
}

// Cache interfaces
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// In-memory cache
const marketDataCache: Map<string, CacheEntry<MarketData>> = new Map();
const chartDataCache: Map<string, CacheEntry<ChartData>> = new Map();

// Cache durations
const MARKET_CACHE_DURATION = 30 * 1000; // 30 seconds for market data
const CHART_CACHE_DURATION = 60 * 1000; // 1 minute for chart data
const STALE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // Use stale cache up to 24 hours old (persistent)

// Flag to track if persistent cache has been loaded
let persistentCacheLoaded = false;

/**
 * Map time range to CoinGecko days parameter
 */
function getTimeRangeDays(range: TimeRange): number {
  switch (range) {
    case '1D':
      return 1;
    case '1W':
      return 7;
    case '1M':
      return 30;
    case '1Y':
      return 365;
    case 'LIVE':
      return 1; // LIVE uses WebSocket, but fallback to 1D for historical
    default:
      return 1;
  }
}

/**
 * Downsample data points for performance
 */
function downsamplePrices(prices: PricePoint[], targetPoints: number): PricePoint[] {
  if (prices.length <= targetPoints) return prices;

  const result: PricePoint[] = [];
  const step = (prices.length - 1) / (targetPoints - 1);

  for (let i = 0; i < targetPoints; i++) {
    const index = Math.round(i * step);
    result.push(prices[Math.min(index, prices.length - 1)]);
  }

  return result;
}

/**
 * Get target data points based on time range
 */
function getTargetPoints(range: TimeRange): number {
  switch (range) {
    case '1D':
      return 96; // ~15 min intervals
    case '1W':
      return 168; // hourly
    case '1M':
      return 120; // ~6 hour intervals
    case '1Y':
      return 365; // daily
    case 'LIVE':
      return 60; // 60 points for live streaming
    default:
      return 100;
  }
}

export class MarketAPI {
  private static baseUrl = API.COINGECKO;

  /**
   * Load persistent cache from AsyncStorage into memory
   */
  private static async loadPersistentCache(): Promise<void> {
    if (persistentCacheLoaded) return;

    try {
      // Load market data cache
      const marketDataJson = await AsyncStorage.getItem(STORAGE_KEYS.MARKET_DATA);
      if (marketDataJson) {
        const parsed = JSON.parse(marketDataJson) as Record<string, CacheEntry<MarketData>>;
        Object.entries(parsed).forEach(([key, value]) => {
          marketDataCache.set(key, value);
        });
        // Loaded market data from persistent cache
      }

      // Load chart data cache
      const chartDataJson = await AsyncStorage.getItem(STORAGE_KEYS.CHART_DATA);
      if (chartDataJson) {
        const parsed = JSON.parse(chartDataJson) as Record<string, CacheEntry<ChartData>>;
        Object.entries(parsed).forEach(([key, value]) => {
          chartDataCache.set(key, value);
        });
        // Loaded chart data from persistent cache
      }

      persistentCacheLoaded = true;
    } catch (error) {
      // Failed to load persistent cache
      persistentCacheLoaded = true; // Don't retry on error
    }
  }

  /**
   * Save market data to persistent storage
   */
  private static async saveMarketDataToPersistent(): Promise<void> {
    try {
      const cacheObject: Record<string, CacheEntry<MarketData>> = {};
      marketDataCache.forEach((value, key) => {
        cacheObject[key] = value;
      });
      await AsyncStorage.setItem(STORAGE_KEYS.MARKET_DATA, JSON.stringify(cacheObject));
    } catch (error) {
      // Failed to save market data to persistent cache
    }
  }

  /**
   * Save chart data to persistent storage
   */
  private static async saveChartDataToPersistent(): Promise<void> {
    try {
      const cacheObject: Record<string, CacheEntry<ChartData>> = {};
      chartDataCache.forEach((value, key) => {
        cacheObject[key] = value;
      });
      await AsyncStorage.setItem(STORAGE_KEYS.CHART_DATA, JSON.stringify(cacheObject));
    } catch (error) {
      // Failed to save chart data to persistent cache
    }
  }

  /**
   * Get cached market data if available and fresh
   */
  private static getCachedMarketData(currency: string): MarketData | null {
    const cached = marketDataCache.get(currency);
    if (cached && Date.now() - cached.timestamp < MARKET_CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  /**
   * Get stale cached market data (for fallback on API error)
   * Returns ANY cached data regardless of age as fallback
   */
  private static getStaleCachedMarketData(currency: string): MarketData | null {
    const cached = marketDataCache.get(currency);
    if (cached) {
      // Return cached data regardless of age - better to show old data than nothing
      return cached.data;
    }
    return null;
  }

  /**
   * Get cached chart data if available and fresh
   */
  private static getCachedChartData(currency: string, timeRange: TimeRange): ChartData | null {
    const cacheKey = `${currency}_${timeRange}`;
    const cached = chartDataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CHART_CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  /**
   * Get stale cached chart data (for fallback on API error)
   * Returns ANY cached data regardless of age as fallback
   */
  private static getStaleCachedChartData(currency: string, timeRange: TimeRange): ChartData | null {
    const cacheKey = `${currency}_${timeRange}`;
    const cached = chartDataCache.get(cacheKey);
    if (cached) {
      // Return cached data regardless of age - better to show old data than nothing
      return cached.data;
    }
    return null;
  }

  /**
   * Fetch current market data for Bitcoin
   */
  static async getMarketData(currency: string = 'usd'): Promise<MarketData> {
    const currencyLower = currency.toLowerCase();

    // Load persistent cache on first call
    await this.loadPersistentCache();

    // Check fresh cache first
    const freshCached = this.getCachedMarketData(currencyLower);
    if (freshCached) {
      return freshCached;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(
        `${this.baseUrl}/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        // On rate limit or error, try to return stale cache
        const staleCache = this.getStaleCachedMarketData(currencyLower);
        if (staleCache) {
          return staleCache;
        }
        throw new Error(`Market API error: ${response.status}`);
      }

      const data: CoinGeckoDetailResponse = await response.json();
      const marketData = data.market_data;

      const result: MarketData = {
        currentPrice: marketData.current_price[currencyLower] || marketData.current_price.usd,
        change24h: marketData.price_change_24h || 0,
        changePercent24h: marketData.price_change_percentage_24h || 0,
        high24h: marketData.high_24h[currencyLower] || marketData.high_24h.usd || 0,
        low24h: marketData.low_24h[currencyLower] || marketData.low_24h.usd || 0,
        marketCap: marketData.market_cap[currencyLower] || marketData.market_cap.usd || null,
        circulatingSupply: marketData.circulating_supply || null,
        totalVolume24h: marketData.total_volume[currencyLower] || marketData.total_volume.usd || null,
        lastUpdated: new Date(data.last_updated).getTime(),
      };

      // Cache the result in memory
      marketDataCache.set(currencyLower, { data: result, timestamp: Date.now() });

      // Save to persistent storage (don't await)
      this.saveMarketDataToPersistent();

      return result;
    } catch (error) {
      // On any error, try to return stale cache
      const staleCache = this.getStaleCachedMarketData(currencyLower);
      if (staleCache) {
        return staleCache;
      }

      throw error;
    }
  }

  /**
   * Fetch historical price data for chart
   */
  static async getChartData(
    currency: string = 'usd',
    timeRange: TimeRange = '1D'
  ): Promise<ChartData> {
    const currencyLower = currency.toLowerCase();
    const days = getTimeRangeDays(timeRange);

    // Load persistent cache on first call
    await this.loadPersistentCache();

    // Check fresh cache first
    const freshCached = this.getCachedChartData(currencyLower, timeRange);
    if (freshCached) {
      return freshCached;
    }

    try {
      const controller = new AbortController();
      // Longer timeout for larger data sets (5Y, ALL)
      const timeout = days > 365 ? 30000 : 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(
        `${this.baseUrl}/coins/bitcoin/market_chart?vs_currency=${currencyLower}&days=${days}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        // On rate limit or error, try to return stale cache
        const staleCache = this.getStaleCachedChartData(currencyLower, timeRange);
        if (staleCache) {
          return staleCache;
        }
        throw new Error(`Chart API error: ${response.status}`);
      }

      const data: CoinGeckoHistoryResponse = await response.json();

      // Convert to PricePoint array
      let prices: PricePoint[] = data.prices.map(([timestamp, price]) => ({
        timestamp,
        price,
      }));

      // Downsample for performance
      const targetPoints = getTargetPoints(timeRange);
      prices = downsamplePrices(prices, targetPoints);

      const result: ChartData = {
        prices,
        timeRange,
        currency: currencyLower,
      };

      // Cache the result in memory
      const cacheKey = `${currencyLower}_${timeRange}`;
      chartDataCache.set(cacheKey, { data: result, timestamp: Date.now() });

      // Save to persistent storage (don't await)
      this.saveChartDataToPersistent();

      return result;
    } catch (error) {
      // On any error, try to return stale cache
      const staleCache = this.getStaleCachedChartData(currencyLower, timeRange);
      if (staleCache) {
        return staleCache;
      }

      throw error;
    }
  }

  /**
   * Clear all caches (useful for debugging)
   */
  static clearCache(): void {
    marketDataCache.clear();
    chartDataCache.clear();
  }

  /**
   * Initialize cache - call this early in app lifecycle
   * Returns true if cached data exists
   */
  static async initializeCache(): Promise<boolean> {
    await this.loadPersistentCache();
    return marketDataCache.size > 0 || chartDataCache.size > 0;
  }

  /**
   * Check if we have any cached data available
   */
  static hasCachedData(currency: string = 'usd'): boolean {
    return marketDataCache.has(currency.toLowerCase());
  }

  /**
   * Get cached market data directly (without fetching)
   */
  static getCachedMarketDataDirect(currency: string = 'usd'): MarketData | null {
    const cached = marketDataCache.get(currency.toLowerCase());
    return cached?.data ?? null;
  }

  /**
   * Get cached chart data directly (without fetching)
   */
  static getCachedChartDataDirect(currency: string = 'usd', timeRange: TimeRange = '1D'): ChartData | null {
    const cacheKey = `${currency.toLowerCase()}_${timeRange}`;
    const cached = chartDataCache.get(cacheKey);
    return cached?.data ?? null;
  }

  /**
   * Format large numbers (market cap, volume)
   */
  static formatLargeNumber(num: number | null, currency: string = 'USD'): string {
    if (num === null) return '—';

    const symbol = currency === 'USD' ? '$' : currency + ' ';

    if (num >= 1e12) {
      return `${symbol}${(num / 1e12).toFixed(2)}T`;
    }
    if (num >= 1e9) {
      return `${symbol}${(num / 1e9).toFixed(2)}B`;
    }
    if (num >= 1e6) {
      return `${symbol}${(num / 1e6).toFixed(2)}M`;
    }

    return `${symbol}${num.toLocaleString()}`;
  }

  /**
   * Format supply number
   */
  static formatSupply(num: number | null): string {
    if (num === null) return '—';

    if (num >= 1e6) {
      return `${(num / 1e6).toFixed(2)}M BTC`;
    }

    return `${num.toLocaleString()} BTC`;
  }

  /**
   * Format percent change with sign
   */
  static formatPercentChange(percent: number): string {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  }

  /**
   * Format price change with sign and currency
   */
  static formatPriceChange(change: number, currency: string = 'USD'): string {
    const symbol = currency === 'USD' ? '$' : currency + ' ';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${symbol}${Math.abs(change).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
