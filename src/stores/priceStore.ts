import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PriceAPI } from '../services/api/PriceAPI';

// Singleton PriceAPI to avoid re-instantiation on every fetch
let _priceApiInstance: PriceAPI | null = null;

interface PriceState {
  price: number | null;
  currency: string;
  change24h: number;
  lastUpdated: number | null;
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;

  // Actions
  fetchPrice: (forceCurrency?: string) => Promise<void>;
  clearError: () => void;
  setCurrency: (currency: string) => void;
}

const CACHE_DURATION = 60000; // 1 minute

export const usePriceStore = create<PriceState>()(
  persist(
    (set, get) => ({
  price: null,
  currency: 'USD',
  change24h: 0,
  lastUpdated: null,
  isLoading: false,
  error: null,
  lastFetched: null,

  fetchPrice: async (forceCurrency?: string) => {
    const { lastFetched, isLoading, price, currency } = get();

    // Don't fetch if already loading
    if (isLoading) return;

    // Use cached price if recent enough and no forced currency change
    if (!forceCurrency && lastFetched && Date.now() - lastFetched < CACHE_DURATION) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Reuse singleton to avoid re-instantiation on every fetch
      if (!_priceApiInstance) _priceApiInstance = new PriceAPI();
      // Use persisted currency to avoid IP detection on every fetch
      const priceData = await _priceApiInstance.getCurrentPrice(forceCurrency || currency || undefined);

      set({
        price: priceData.price,
        currency: priceData.currency,
        change24h: priceData.change24h || 0,
        lastUpdated: Date.now(),
        isLoading: false,
        lastFetched: Date.now(),
      });
    } catch (error) {
      // On network error, keep existing price data if available
      // and don't set error to avoid showing error UI
      const isNetworkError = error instanceof Error &&
        (error.message.includes('Network request failed') || error.name === 'AbortError');

      set({
        isLoading: false,
        // Only set error for non-network errors, and only if we don't have cached price
        error: isNetworkError || price !== null
          ? null
          : (error instanceof Error ? error.message : 'Failed to fetch price'),
      });
    }
  },

  clearError: () => set({ error: null }),

  setCurrency: (currency: string) => {
    set({ currency, lastFetched: null });
    // Clear the cached currency and refetch
    PriceAPI.clearCurrencyCache();
    get().fetchPrice(currency);
  },
    }),
    {
      name: 'price-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist price data for offline access and faster startup
      partialize: (state) => ({
        price: state.price,
        currency: state.currency,
        change24h: state.change24h,
        lastUpdated: state.lastUpdated,
        lastFetched: state.lastFetched,
      }),
    }
  )
);
