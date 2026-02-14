import type { PriceData } from '../../types';

// Coinbase API endpoint
const COINBASE_API = 'https://api.coinbase.com/v2/prices/BTC';

// IP Geolocation API (free, no key required)
const IP_API = 'https://ipapi.co/json/';

// Map of country codes to currency codes
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // North America
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',

  // Europe
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  PT: 'EUR',
  GR: 'EUR',
  IE: 'EUR',
  FI: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  CY: 'EUR',
  MT: 'EUR',
  LU: 'EUR',
  GB: 'GBP',
  CH: 'CHF',
  NO: 'NOK',
  SE: 'SEK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  HR: 'HRK',
  RU: 'RUB',
  UA: 'UAH',
  TR: 'TRY',

  // Middle East
  IL: 'ILS',
  JO: 'JOD',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  EG: 'EGP',

  // Asia Pacific
  JP: 'JPY',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  KR: 'KRW',
  SG: 'SGD',
  MY: 'MYR',
  TH: 'THB',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  IN: 'INR',
  PK: 'PKR',
  BD: 'BDT',
  AU: 'AUD',
  NZ: 'NZD',

  // South America
  BR: 'BRL',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',

  // Africa
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  MA: 'MAD',
};

// Currency symbols for display
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF',
  INR: '₹',
  KRW: '₩',
  BRL: 'R$',
  MXN: 'MX$',
  SGD: 'S$',
  HKD: 'HK$',
  NOK: 'kr',
  SEK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  ZAR: 'R',
  RUB: '₽',
  TRY: '₺',
  ILS: '₪',
  JOD: 'JD',
  AED: 'د.إ',
  SAR: 'ر.س',
  THB: '฿',
  PLN: 'zł',
  PHP: '₱',
  CZK: 'Kč',
  TWD: 'NT$',
  MYR: 'RM',
  IDR: 'Rp',
};

interface CoinbaseResponse {
  data: {
    amount: string;
    base: string;
    currency: string;
  };
}

interface IPResponse {
  country_code: string;
  currency: string;
}

interface CachedCurrency {
  currency: string;
  timestamp: number;
}

// Cache the detected currency for 24 hours
let cachedCurrency: CachedCurrency | null = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Price API Client
 * Fetches Bitcoin price data from Coinbase API
 * Auto-detects user's currency based on IP location
 */
export class PriceAPI {
  /**
   * Detect user's currency based on IP location
   */
  static async detectCurrency(): Promise<string> {
    // Check cache first
    if (cachedCurrency && Date.now() - cachedCurrency.timestamp < CACHE_DURATION) {
      return cachedCurrency.currency;
    }

    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(IP_API, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return 'USD';
      }

      const data: IPResponse = await response.json();

      // Try to get currency from country code mapping first
      let currency = COUNTRY_TO_CURRENCY[data.country_code] || data.currency || 'USD';

      // Verify the currency is supported by Coinbase by making a test request
      try {
        const testResponse = await fetch(`${COINBASE_API}-${currency}/spot`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!testResponse.ok) {
          currency = 'USD'; // Fallback to USD if currency not supported
        }
      } catch {
        // If test fails, just use USD
        currency = 'USD';
      }

      // Cache the result
      cachedCurrency = { currency, timestamp: Date.now() };
      return currency;
    } catch (error) {
      // Silently handle network errors - just use USD as default
      // Currency detection failed — use USD as default
      return 'USD';
    }
  }

  /**
   * Get current Bitcoin price from Coinbase
   * @param currency - Currency code (e.g., 'USD', 'EUR', 'JOD')
   */
  async getCurrentPrice(currency?: string): Promise<PriceData> {
    const targetCurrency = currency || await PriceAPI.detectCurrency();

    try {
      // Use AbortController for timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch(`${COINBASE_API}-${targetCurrency}/spot`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Price API error: ${response.status}`);
      }

      const data: CoinbaseResponse = await response.json();

      return {
        price: parseFloat(data.data.amount),
        currency: data.data.currency,
        change24h: 0, // Coinbase spot API doesn't provide 24h change
        lastUpdated: Date.now(),
      };
    } catch (error) {
      // Log but don't show as error - network issues are expected sometimes
      // Price fetch failed — caller handles the error
      throw error;
    }
  }

  /**
   * Get price in multiple currencies at once
   * @param currencies - Array of currency codes
   */
  async getPricesMultiple(currencies: string[]): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    await Promise.all(
      currencies.map(async (curr) => {
        try {
          const response = await fetch(`${COINBASE_API}-${curr}/spot`);
          if (response.ok) {
            const data: CoinbaseResponse = await response.json();
            results[curr] = parseFloat(data.data.amount);
          }
        } catch {
          // Skip failed currencies
        }
      })
    );

    return results;
  }

  /**
   * Convert satoshis to fiat value
   * @param satoshis - Amount in satoshis
   * @param price - Current BTC price in fiat
   */
  static satoshisToFiat(satoshis: number, price: number): number {
    const btc = satoshis / 100000000;
    return btc * price;
  }

  /**
   * Convert fiat to satoshis
   * @param fiatAmount - Amount in fiat currency
   * @param price - Current BTC price in fiat
   */
  static fiatToSatoshis(fiatAmount: number, price: number): number {
    if (price <= 0) return 0;
    const btc = fiatAmount / price;
    return Math.round(btc * 100000000);
  }

  /**
   * Format price with currency symbol
   * @param amount - Amount to format
   * @param currency - Currency code
   */
  static formatPrice(amount: number, currency: string = 'USD'): string {
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' ';

    // Handle different decimal place requirements
    let decimals = 2;
    if (['JPY', 'KRW', 'VND', 'IDR', 'CLP'].includes(currency)) {
      decimals = 0;
    } else if (['BTC', 'ETH'].includes(currency)) {
      decimals = 8;
    }

    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);

    // Position symbol based on currency convention
    if (['EUR', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK'].includes(currency)) {
      return `${formatted} ${symbol}`;
    }

    return `${symbol}${formatted}`;
  }

  /**
   * Get the currency symbol for a given currency code
   */
  static getCurrencySymbol(currency: string): string {
    return CURRENCY_SYMBOLS[currency] || currency;
  }

  /**
   * Clear the cached currency (useful when user wants to refresh location)
   */
  static clearCurrencyCache(): void {
    cachedCurrency = null;
  }
}
