/**
 * MempoolFeeService — Fetches fee estimates from mempool.space API.
 *
 * Primary source for fee data across all send screens.
 * Caches fees in SQLite app_config table for offline fallback.
 *
 * API: https://mempool.space/api/v1/fees/recommended
 * Response: { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
 */

import { API } from '../../constants';
import { WalletDatabase } from '../database/WalletDatabase';
import { SyncLogger } from '../SyncLogger';
import type { FeeRecommendation } from '../../types';

// ─── Constants ────────────────────────────────────────────────────────

const CACHE_TTL = 30_000; // 30 seconds in-memory cache
const FETCH_TIMEOUT = 10_000; // 10 second HTTP timeout
const DB_CACHE_KEY = 'mempool_fees';

const FALLBACK_FEES: FeeRecommendation = {
  fastest: 1,
  halfHour: 1,
  hour: 1,
  economy: 1,
  minimum: 1,
};

// ─── In-memory cache ──────────────────────────────────────────────────

let cachedFees: FeeRecommendation | null = null;
let cacheTimestamp = 0;

// ─── Mempool API response type ────────────────────────────────────────

interface MempoolFeesResponse {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

// ─── Service ──────────────────────────────────────────────────────────

export const MempoolFeeService = {
  /**
   * Fetch recommended fees from mempool.space.
   * Falls back to DB cache, then to hardcoded minimums.
   */
  async fetchFees(network: 'mainnet' | 'testnet' = 'mainnet'): Promise<FeeRecommendation> {
    // 1. Return in-memory cache if fresh
    if (cachedFees && Date.now() - cacheTimestamp < CACHE_TTL) {
      return cachedFees;
    }

    // 2. Try fetching from mempool.space
    const baseUrl = network === 'testnet' ? API.MEMPOOL_TESTNET : API.MEMPOOL_MAINNET;
    const url = `${baseUrl}/v1/fees/recommended`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Mempool API error: ${response.status}`);
      }

      const data: MempoolFeesResponse = await response.json();

      const fees: FeeRecommendation = {
        fastest: Math.max(data.fastestFee, 1),
        halfHour: Math.max(data.halfHourFee, 1),
        hour: Math.max(data.hourFee, 1),
        economy: Math.max(data.economyFee, 1),
        minimum: Math.max(data.minimumFee, 1),
      };

      // Update caches
      cachedFees = fees;
      cacheTimestamp = Date.now();

      // Persist to DB (non-blocking)
      try {
        const db = WalletDatabase.shared();
        db.setConfig(DB_CACHE_KEY, JSON.stringify(fees));
      } catch {}

      SyncLogger.log('mempool-fees', `Fetched: fast=${fees.fastest} half=${fees.halfHour} hour=${fees.hour} eco=${fees.economy} min=${fees.minimum}`);
      return fees;
    } catch (err: any) {
      SyncLogger.warn('mempool-fees', `Fetch failed: ${err?.message || err} — trying DB cache`);

      // 3. Try DB cache
      try {
        const db = WalletDatabase.shared();
        const cached = db.getConfig(DB_CACHE_KEY);
        if (cached) {
          const fees: FeeRecommendation = JSON.parse(cached);
          cachedFees = fees;
          cacheTimestamp = Date.now();
          SyncLogger.log('mempool-fees', 'Using DB-cached fees');
          return fees;
        }
      } catch {}

      // 4. Last resort fallback
      SyncLogger.warn('mempool-fees', 'No cache available — using fallback 1 sat/vB');
      return FALLBACK_FEES;
    }
  },

  /**
   * Broadcast a raw transaction via mempool.space API.
   * POST /api/tx with raw hex body (not JSON).
   * Returns the txid on success.
   */
  async broadcastTransaction(
    txHex: string,
    network: 'mainnet' | 'testnet' = 'mainnet',
  ): Promise<string> {
    const baseUrl = network === 'testnet' ? API.MEMPOOL_TESTNET : API.MEMPOOL_MAINNET;
    const url = `${baseUrl}/tx`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const responseText = await response.text();

      if (!response.ok) {
        SyncLogger.warn('mempool-broadcast', `Broadcast failed: ${response.status} — ${responseText}`);
        throw new Error(responseText || `Mempool broadcast failed: ${response.status}`);
      }

      const txid = responseText.trim();
      SyncLogger.log('mempool-broadcast', `Broadcast success: ${txid}`);
      return txid;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        throw new Error('Mempool broadcast timed out (15s)');
      }
      throw err;
    }
  },

  /** Clear in-memory cache (for testing or forced refresh) */
  clearCache(): void {
    cachedFees = null;
    cacheTimestamp = 0;
  },
};
