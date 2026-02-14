/**
 * ElectrumAPI - High-level Electrum API
 *
 * Provides the same interface as MempoolAPI + ActivityAPI combined.
 * Uses direct TCP/TLS connections to Electrum servers.
 * This is the main API that screens and stores should use.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ElectrumClient } from './ElectrumClient';
import { ElectrumPool } from './ElectrumPool';
import { addressToScripthash } from './scripthash';
import { SyncLogger } from '../SyncLogger';
// Debug logging — disable to reduce log noise
const DEBUG = false;
const log = (...args: any[]) => DEBUG && console.log('[ElectrumAPI]', ...args);
// Use console.warn instead of console.error to avoid triggering React Native's red error overlay
const logError = (...args: any[]) => __DEV__ && console.warn('[ElectrumAPI ERROR]', ...args);
import type {
  ElectrumBalance,
  ElectrumUTXO,
  ElectrumHistoryItem,
  ElectrumTransaction,
  ElectrumHeader,
  ElectrumServerInfo,
} from './types';
import type {
  BalanceInfo,
  UTXO,
  DetailedTransactionInfo,
  TransactionInput,
  TransactionOutput,
  FeeRecommendation,
} from '../../types';

// ─── Typed sync results ──────────────────────────────────────────────
// Discriminated union so callers can distinguish success from failure
// without relying on zero-balance as a sentinel value.

export type SyncLightResult =
  | { ok: true; balance: BalanceInfo; utxos: UTXO[]; historyMap: Map<string, ElectrumHistoryItem[]> }
  | { ok: false; error: string };

export type SyncFullResult =
  | { ok: true; balance: BalanceInfo; utxos: UTXO[]; transactions: DetailedTransactionInfo[] }
  | { ok: false; error: string };

// Cache configuration
const CACHE_TTL = 60000; // 60 seconds

// Post-completion dedup window — recently completed results are reused
// to prevent redundant requests from rapid double-sync or re-render
const RECENT_RESULT_WINDOW = 2000; // 2 seconds

// API-level circuit breaker configuration
const CIRCUIT_FAILURE_THRESHOLD = 5; // 5 consecutive failures → open circuit
const CIRCUIT_RESET_TIMEOUT = 30000; // 30s before half-open probe

// Connection health monitor configuration
const HEALTH_CHECK_INTERVAL = 25000; // Check connection health every 25s
const HEALTH_CHECK_PING_TIMEOUT = 10000; // Ping must respond within 10s

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface RecentResult<T> {
  data: T;
  completedAt: number;
}

/**
 * High-level Electrum API that provides the same interface as MempoolAPI + ActivityAPI
 */
export class ElectrumAPI {
  private client: ElectrumClient;
  private pool: ElectrumPool;
  private network: 'mainnet' | 'testnet';
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private recentResults: Map<string, RecentResult<any>> = new Map();
  private blockHeight: number = 0;
  private usePool: boolean = true; // Enable parallel pool by default

  // API-level circuit breaker
  private circuitState: 'closed' | 'open' | 'half-open' = 'closed';
  private circuitFailureCount: number = 0;
  private circuitLastFailureAt: number = 0;
  private circuitOpenedAt: number = 0;
  private circuitHalfOpenRequests: number = 0;

  // Persistent connection health monitor
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckRunning: boolean = false;
  private lastHealthCheckAt: number = 0;
  private healthCheckFailCount: number = 0;

  // Singleton instances — reuse the same TCP connection across the app
  private static _instances: Map<string, ElectrumAPI> = new Map();

  /**
   * Get a shared singleton instance for the given network.
   * Reuses the same TCP connection across all callers.
   */
  static shared(network: 'mainnet' | 'testnet' = 'mainnet'): ElectrumAPI {
    let instance = this._instances.get(network);
    if (!instance) {
      instance = new ElectrumAPI(network);
      this._instances.set(network, instance);
    }
    return instance;
  }

  constructor(network: 'mainnet' | 'testnet' = 'mainnet') {
    this.network = network;
    this.client = new ElectrumClient(network);
    this.pool = ElectrumPool.shared(network);
  }

  /**
   * Initialize the parallel pool for faster sync.
   * Call this early in app lifecycle for best performance.
   */
  async initializePool(workerCount: number = 3): Promise<void> {
    await this.pool.initialize(workerCount);
    log(`Pool initialized with ${workerCount} workers`);
  }

  // ============================================
  // Persistent Connection Health Monitor
  // ============================================

  /**
   * Start the persistent connection health monitor.
   * Periodically checks if the connection is alive and reconnects if needed.
   * Call this after the first successful connect to keep the connection alive.
   */
  startHealthMonitor(): void {
    if (this.healthCheckTimer) {
      log('startHealthMonitor: already running');
      return;
    }

    log('startHealthMonitor: starting (interval:', HEALTH_CHECK_INTERVAL, 'ms)');
    SyncLogger.log('electrum', `Health monitor started (${HEALTH_CHECK_INTERVAL / 1000}s interval)`);

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);

    // Also do an immediate check
    this.performHealthCheck();
  }

  /**
   * Stop the health monitor (e.g., when app goes to background).
   */
  stopHealthMonitor(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      log('stopHealthMonitor: stopped');
      SyncLogger.log('electrum', 'Health monitor stopped');
    }
  }

  /**
   * Perform a single health check — ping the server and reconnect if needed.
   */
  private async performHealthCheck(): Promise<void> {
    if (this.healthCheckRunning) {
      log('healthCheck: already running, skipping');
      return;
    }

    this.healthCheckRunning = true;
    this.lastHealthCheckAt = Date.now();

    try {
      const isConnected = this.client.isConnected();
      const diag = this.client.getDiagnostics();

      if (!isConnected) {
        log(`healthCheck: client NOT connected (state: ${diag.state}, server: ${diag.server || 'none'})`);
        SyncLogger.warn('electrum', `Health check: disconnected (state: ${diag.state}) — reconnecting`);

        this.healthCheckFailCount++;
        try {
          await this.connect();
          log('healthCheck: reconnected successfully');
          SyncLogger.log('electrum', `Health check: reconnected to ${this.client.getCurrentServer()?.host || 'unknown'}`);
          this.healthCheckFailCount = 0;
        } catch (err: any) {
          logError('healthCheck: reconnect failed:', err?.message || err);
          SyncLogger.error('electrum', `Health check: reconnect failed (attempt ${this.healthCheckFailCount}): ${err?.message || err}`);
        }
        return;
      }

      // Client says it's connected — verify with a ping
      const pingStart = Date.now();
      try {
        await Promise.race([
          this.client.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check ping timeout')), HEALTH_CHECK_PING_TIMEOUT)
          ),
        ]);
        const pingMs = Date.now() - pingStart;
        log(`healthCheck: ping OK (${pingMs}ms) on ${diag.server}`);
        this.healthCheckFailCount = 0;
      } catch (pingErr: any) {
        const pingMs = Date.now() - pingStart;
        logError(`healthCheck: ping failed (${pingMs}ms) on ${diag.server}:`, pingErr?.message || pingErr);
        SyncLogger.error('electrum', `Health check: ping failed (${pingMs}ms) on ${diag.server}: ${pingErr?.message || pingErr}`);
        this.healthCheckFailCount++;

        // Force reconnect
        log('healthCheck: forcing reconnect after ping failure');
        SyncLogger.warn('electrum', `Health check: forcing reconnect after ping failure on ${diag.server}`);
        try {
          this.client.disconnect();
          await this.connect();
          log('healthCheck: reconnected after ping failure');
          SyncLogger.log('electrum', `Health check: reconnected after ping failure to ${this.client.getCurrentServer()?.host || 'unknown'}`);
          this.healthCheckFailCount = 0;
        } catch (err: any) {
          logError('healthCheck: reconnect after ping failure also failed:', err?.message || err);
          SyncLogger.error('electrum', `Health check: reconnect failed: ${err?.message || err}`);
        }
      }
    } finally {
      this.healthCheckRunning = false;
    }
  }

  /**
   * Get health monitor status for debugging.
   */
  getHealthMonitorStatus(): {
    running: boolean;
    lastCheckAt: number;
    failCount: number;
    clientDiag: ReturnType<ElectrumClient['getDiagnostics']>;
  } {
    return {
      running: this.healthCheckTimer !== null,
      lastCheckAt: this.lastHealthCheckAt,
      failCount: this.healthCheckFailCount,
      clientDiag: this.client.getDiagnostics(),
    };
  }

  /**
   * Enable or disable parallel pool usage.
   */
  setUsePool(enabled: boolean): void {
    this.usePool = enabled;
    log(`Pool usage ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get pool statistics for monitoring.
   */
  getPoolStats() {
    return this.pool.getStats();
  }

  /**
   * Get the currently connected server info from the primary client.
   */
  getCurrentServer(): ElectrumServerInfo | null {
    return this.client.getCurrentServer();
  }

  /**
   * Check if the primary client is connected.
   */
  isClientConnected(): boolean {
    return this.client.isConnected();
  }

  // ============================================
  // API-Level Circuit Breaker
  // ============================================

  /**
   * Check circuit breaker before an operation.
   * Throws if the circuit is open and cooldown hasn't elapsed.
   * Transitions to half-open after cooldown.
   */
  private checkCircuitBreaker(): void {
    if (this.circuitState === 'closed') return;

    if (this.circuitState === 'open') {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed >= CIRCUIT_RESET_TIMEOUT) {
        this.circuitState = 'half-open';
        this.circuitHalfOpenRequests = 0;
        log('Circuit breaker: open → half-open (cooldown elapsed)');
      } else {
        const retryIn = Math.ceil((CIRCUIT_RESET_TIMEOUT - elapsed) / 1000);
        throw new Error(`Circuit breaker open (retry in ${retryIn}s)`);
      }
    }
    // half-open: allow request through as a probe
  }

  /**
   * Record a successful operation — resets the circuit breaker.
   */
  private recordCircuitSuccess(): void {
    if (this.circuitState !== 'closed') {
      log(`Circuit breaker: ${this.circuitState} → closed (success)`);
    }
    this.circuitState = 'closed';
    this.circuitFailureCount = 0;
    this.circuitHalfOpenRequests = 0;
  }

  /**
   * Record a failed operation — may open the circuit.
   */
  private recordCircuitFailure(): void {
    this.circuitFailureCount++;
    this.circuitLastFailureAt = Date.now();

    if (this.circuitState === 'half-open') {
      // Half-open probe failed → reopen
      this.circuitState = 'open';
      this.circuitOpenedAt = Date.now();
      log('Circuit breaker: half-open → open (probe failed)');
      return;
    }

    if (this.circuitFailureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitState = 'open';
      this.circuitOpenedAt = Date.now();
      log(`Circuit breaker: closed → open (${this.circuitFailureCount} consecutive failures)`);
    }
  }

  /**
   * Get the current circuit breaker status for UI display.
   */
  getCircuitBreakerStatus(): {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    retryInMs: number | null;
  } {
    let retryInMs: number | null = null;
    if (this.circuitState === 'open') {
      const elapsed = Date.now() - this.circuitOpenedAt;
      retryInMs = Math.max(0, CIRCUIT_RESET_TIMEOUT - elapsed);
    }
    return {
      state: this.circuitState,
      failureCount: this.circuitFailureCount,
      retryInMs,
    };
  }

  /**
   * Ensure connection is established.
   * Also starts the health monitor to keep the connection alive.
   */
  async connect(): Promise<void> {
    this.checkCircuitBreaker();
    try {
      const connectStart = Date.now();
      await this.client.connect();
      const connectMs = Date.now() - connectStart;
      const server = this.client.getCurrentServer();
      log(`connect: connected in ${connectMs}ms to ${server?.host || 'unknown'}:${server?.port || '?'}`);
      SyncLogger.log('electrum', `API connected in ${connectMs}ms to ${server?.host || 'unknown'}:${server?.port || '?'}`);
      this.recordCircuitSuccess();

      // Auto-start health monitor to keep connection alive
      if (!this.healthCheckTimer) {
        this.startHealthMonitor();
      }
    } catch (e: any) {
      logError('connect: failed:', e?.message || e);
      SyncLogger.error('electrum', `API connect failed: ${e?.message || e}`);
      this.recordCircuitFailure();
      throw e;
    }
  }

  /**
   * Disconnect from server and reset circuit breaker.
   */
  disconnect(): void {
    log('disconnect: stopping health monitor and disconnecting client');
    this.stopHealthMonitor();
    this.client.disconnect();
    // Reset circuit breaker on explicit disconnect
    this.circuitState = 'closed';
    this.circuitFailureCount = 0;
    this.circuitHalfOpenRequests = 0;
  }

  /**
   * Disconnect all singleton instances. Only use on app background/logout,
   * NOT after every API call (let keepalive maintain the connection).
   */
  static disconnectAll(): void {
    for (const [network, instance] of this._instances) {
      log(`disconnectAll: disconnecting ${network} instance`);
      instance.stopHealthMonitor();
      instance.disconnect();
    }
    this._instances.clear();
    SyncLogger.log('electrum', 'All API instances disconnected');
  }

  /**
   * Clear the cache (including recent dedup results)
   */
  clearCache(): void {
    this.cache.clear();
    this.recentResults.clear();
  }

  /**
   * Static method to clear cache (for compatibility with old API)
   */
  static clearCache(): void {
    // Instance method should be used instead
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Deduplicate concurrent requests for the same key.
   * If a request with the same key is already in-flight, returns the existing promise.
   * Also checks recent results (post-completion cache, 2s window) to prevent
   * redundant requests from rapid double-sync or re-render.
   */
  private async dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Check recent results (post-completion cache)
    const recent = this.recentResults.get(key);
    if (recent && Date.now() - recent.completedAt < RECENT_RESULT_WINDOW) {
      return recent.data as T;
    }

    // Check in-flight requests
    const existing = this.pendingRequests.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn()
      .then((result) => {
        // Store in recent results for the post-completion window
        this.recentResults.set(key, { data: result, completedAt: Date.now() });
        return result;
      })
      .finally(() => this.pendingRequests.delete(key));
    this.pendingRequests.set(key, promise);
    return promise;
  }

  // ============================================
  // Balance Methods
  // ============================================

  /**
   * Get balance for a single address using UTXOs.
   * @deprecated Use WalletEngine.computeBalance() instead — balance should only be derived from UTXOs in the LKG snapshot.
   */
  async getAddressBalance(address: string): Promise<BalanceInfo> {
    const cacheKey = `balance:${address}`;
    const cached = this.getCached<BalanceInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    return this.dedup(cacheKey, async () => {
      try {
        await this.connect();

        const scripthash = addressToScripthash(address, this.network);

        // Get UTXOs to calculate balance (more reliable than get_balance)
        const utxos = await this.client.request<ElectrumUTXO[]>(
          'blockchain.scripthash.listunspent',
          [scripthash]
        );

        // Calculate confirmed and unconfirmed from UTXOs
        let confirmed = 0;
        let unconfirmed = 0;

        for (const utxo of utxos) {
          if (utxo.height > 0) {
            // Confirmed UTXO (has a block height)
            confirmed += utxo.value;
          } else {
            // Unconfirmed UTXO (height is 0 or -1)
            unconfirmed += utxo.value;
          }
        }

        const balance: BalanceInfo = {
          confirmed,
          unconfirmed,
          total: confirmed + unconfirmed,
        };

        this.setCache(cacheKey, balance);
        return balance;
      } catch (error: any) {
        logError('getAddressBalance failed:', error?.message || error);
        throw error;
      }
    });
  }

  /**
   * Get aggregated balance for multiple addresses using batch requests.
   * @deprecated Use WalletEngine.computeBalance() instead — balance should only be derived from UTXOs in the LKG snapshot.
   */
  async getWalletBalance(addresses: string[]): Promise<BalanceInfo> {
    this.checkCircuitBreaker();

    if (addresses.length === 0) {
      return { confirmed: 0, unconfirmed: 0, total: 0 };
    }

    await this.connect();

    // Convert all addresses to scripthashes
    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));

    // Create batch request for all addresses at once
    const requests = scripthashes.map(sh => ({
      method: 'blockchain.scripthash.listunspent',
      params: [sh],
    }));

    try {
      // Single batch request for all addresses
      // batchRequest<T> returns T[] where T is the result type for each request
      // Each listunspent returns ElectrumUTXO[], so we get ElectrumUTXO[][] back
      const results = await this.client.batchRequest<ElectrumUTXO[]>(requests);

      // Calculate totals from all results
      let confirmed = 0;
      let unconfirmed = 0;

      for (const utxos of results) {
        if (utxos && Array.isArray(utxos)) {
          for (const utxo of utxos) {
            if (utxo.height > 0) {
              confirmed += utxo.value;
            } else {
              unconfirmed += utxo.value;
            }
          }
        }
      }

      const totalBalance = {
        confirmed,
        unconfirmed,
        total: confirmed + unconfirmed,
      };

      this.recordCircuitSuccess();
      return totalBalance;
    } catch (error: any) {
      this.recordCircuitFailure();
      logError('Batch balance request failed:', error?.message || error);
      throw new Error(`Balance fetch failed: ${error?.message || error}`);
    }
  }

  /**
   * Alias for getWalletBalance (compatibility with ActivityAPI).
   * @deprecated Use WalletEngine.computeBalance() instead — balance should only be derived from UTXOs in the LKG snapshot.
   */
  async getBalance(addresses: string[]): Promise<BalanceInfo> {
    return this.getWalletBalance(addresses);
  }

  // ============================================
  // UTXO Methods
  // ============================================

  /**
   * Get UTXOs for a single address
   */
  async getUTXOs(address: string): Promise<UTXO[]> {
    const cacheKey = `utxos:${address}`;
    const cached = this.getCached<UTXO[]>(cacheKey);
    if (cached) return cached;

    await this.connect();

    const scripthash = addressToScripthash(address, this.network);
    const result = await this.client.request<ElectrumUTXO[]>(
      'blockchain.scripthash.listunspent',
      [scripthash]
    );

    // Get current block height for confirmations calculation
    const tipHeight = await this.getBlockHeight();

    const utxos: UTXO[] = result.map(u => ({
      txid: u.tx_hash,
      vout: u.tx_pos,
      value: u.value,
      address,
      scriptPubKey: '', // Not needed for spending with SegWit
      confirmations: u.height > 0 ? tipHeight - u.height + 1 : 0,
    }));

    this.setCache(cacheKey, utxos);
    return utxos;
  }

  /**
   * Get UTXOs for multiple addresses using batch requests
   * Optimized to use a single batch request instead of individual calls
   */
  async getWalletUTXOs(addresses: string[]): Promise<UTXO[]> {
    if (addresses.length === 0) {
      return [];
    }

    await this.connect();

    // Convert all addresses to scripthashes
    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));

    // Create batch request for all addresses at once
    const requests = scripthashes.map(sh => ({
      method: 'blockchain.scripthash.listunspent',
      params: [sh],
    }));

    try {
      // Single batch request for all addresses
      // batchRequest<T> returns T[] where T is each result type
      const results = await this.client.batchRequest<ElectrumUTXO[]>(requests);

      // Get current block height for confirmations calculation
      const tipHeight = await this.getBlockHeight();

      // Flatten and transform all UTXOs
      const allUtxos: UTXO[] = [];
      results.forEach((utxos, index) => {
        if (utxos && Array.isArray(utxos)) {
          for (const u of utxos) {
            allUtxos.push({
              txid: u.tx_hash,
              vout: u.tx_pos,
              value: u.value,
              address: addresses[index],
              scriptPubKey: '',
              confirmations: u.height > 0 ? tipHeight - u.height + 1 : 0,
            });
          }
        }
      });

      return allUtxos;
    } catch (error: any) {
      logError('Batch UTXO request failed:', error?.message || error);
      // Propagate error — callers must handle it, never silently return empty
      throw new Error(`UTXO fetch failed: ${error?.message || error}`);
    }
  }

  // ============================================
  // Transaction History
  // ============================================

  /**
   * Get transaction history for a single address
   * Returns an array of {tx_hash, height} objects
   * Used to check if an address has ever been used
   */
  async getAddressHistory(address: string): Promise<ElectrumHistoryItem[]> {
    const dedupKey = `history:${address}`;
    return this.dedup(dedupKey, async () => {
      await this.connect();

      const scripthash = addressToScripthash(address, this.network);
      try {
        const history = await this.client.request<ElectrumHistoryItem[]>(
          'blockchain.scripthash.get_history',
          [scripthash]
        );
        return history || [];
      } catch (error) {
        if (DEBUG) console.warn(`Failed to get history for ${address}:`, error);
        return [];
      }
    });
  }

  /**
   * Get transaction history for multiple addresses using a single batch request.
   * Returns a Map of address -> ElectrumHistoryItem[] for efficient lookup.
   */
  async getWalletHistory(
    addresses: string[]
  ): Promise<Map<string, ElectrumHistoryItem[]>> {
    if (addresses.length === 0) {
      return new Map();
    }

    await this.connect();

    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));
    const requests = scripthashes.map(sh => ({
      method: 'blockchain.scripthash.get_history',
      params: [sh],
    }));

    try {
      const results = await this.client.batchRequest<ElectrumHistoryItem[]>(requests);
      const historyMap = new Map<string, ElectrumHistoryItem[]>();
      results.forEach((history, index) => {
        historyMap.set(addresses[index], history && Array.isArray(history) ? history : []);
      });
      return historyMap;
    } catch (error: any) {
      logError('Batch wallet history request failed:', error?.message || error);
      return new Map();
    }
  }

  /**
   * Get transaction history for multiple addresses using batch requests
   * Optimized to use batch requests for history, transactions, and prev tx lookups
   * @param addresses - Array of addresses to fetch transactions for
   * @param cachedTransactions - Optional previously cached transactions to preserve firstSeen times
   */
  async getTransactions(
    addresses: string[],
    cachedTransactions?: DetailedTransactionInfo[]
  ): Promise<DetailedTransactionInfo[]> {
    if (addresses.length === 0) {
      return [];
    }

    const cacheKey = `txs:${[...addresses].sort().join(',')}`;
    const cached = this.getCached<DetailedTransactionInfo[]>(cacheKey);
    if (cached) return cached;

    await this.connect();

    // Build map of cached transactions to preserve firstSeen times
    const cachedTxMap = new Map<string, DetailedTransactionInfo>();
    if (cachedTransactions) {
      for (const tx of cachedTransactions) {
        cachedTxMap.set(tx.txid, tx);
      }
    }

    // Create address set for quick lookups
    const addressSet = new Set(addresses);

    // BATCH 1: Get history for all addresses at once
    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));
    const historyRequests = scripthashes.map(sh => ({
      method: 'blockchain.scripthash.get_history',
      params: [sh],
    }));

    let histories: ElectrumHistoryItem[][];
    try {
      // batchRequest<T> returns T[] where T is each result type
      histories = await this.client.batchRequest<ElectrumHistoryItem[]>(historyRequests);
    } catch (error: any) {
      logError('Batch history request failed:', error?.message || error);
      throw new Error(`Transaction history fetch failed: ${error?.message || error}`);
    }

    // Combine and deduplicate by txid
    const txMap = new Map<string, ElectrumHistoryItem>();
    for (const history of histories) {
      if (history && Array.isArray(history)) {
        for (const item of history) {
          if (!txMap.has(item.tx_hash)) {
            txMap.set(item.tx_hash, item);
          }
        }
      }
    }

    if (txMap.size === 0) {
      return [];
    }

    // Fetch current block height
    const tipHeight = await this.getBlockHeight();

    // BATCH 2: Fetch all transaction details at once
    const txids = Array.from(txMap.keys());
    const txRequests = txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, false],
    }));

    let rawTxHexes: string[];
    try {
      // Each tx.get returns a string, so we get string[] back
      rawTxHexes = await this.client.batchRequest<string>(txRequests);
    } catch (error: any) {
      logError('Batch transaction request failed:', error?.message || error);
      throw new Error(`Transaction details fetch failed: ${error?.message || error}`);
    }

    // Parse all transactions
    const rawTxs: Array<{ tx: ElectrumTransaction; historyItem: ElectrumHistoryItem }> = [];
    txids.forEach((txid, index) => {
      const hex = rawTxHexes[index];
      if (hex) {
        try {
          const tx = this.parseRawTransaction(txid, hex);
          const historyItem = txMap.get(txid)!;
          rawTxs.push({ tx, historyItem });
        } catch (error) {
          log(`Failed to parse transaction ${txid}:`, error);
        }
      }
    });
    // Collect all input references (txid:vout) that we need to look up
    const inputRefs = new Set<string>();
    for (const { tx } of rawTxs) {
      for (const vin of tx.vin) {
        if (vin.txid) {
          inputRefs.add(`${vin.txid}:${vin.vout}`);
        }
      }
    }

    // Build a map of "txid:vout" -> { address, value }
    const inputValues = new Map<string, { address: string; value: number }>();

    // Get unique previous txids (excluding ones we already have)
    const prevTxids = new Set<string>();
    for (const ref of inputRefs) {
      const prevTxid = ref.split(':')[0];
      // Skip if we already fetched this tx
      if (!txMap.has(prevTxid)) {
        prevTxids.add(prevTxid);
      }
    }

    // First, index outputs from transactions we already have
    for (const { tx } of rawTxs) {
      for (const vout of tx.vout) {
        const key = `${tx.txid}:${vout.n}`;
        if (inputRefs.has(key)) {
          inputValues.set(key, {
            address: vout.scriptPubKey?.address || '',
            value: vout.value,
          });
        }
      }
    }

    // BATCH 3: Fetch remaining previous transactions for input values
    if (prevTxids.size > 0) {
      const prevTxRequests = Array.from(prevTxids).map(txid => ({
        method: 'blockchain.transaction.get',
        params: [txid, false],
      }));

      try {
        const prevTxHexes = await this.client.batchRequest<string>(prevTxRequests);

        const prevTxidArray = Array.from(prevTxids);
        prevTxHexes.forEach((hex, index) => {
          if (hex) {
            try {
              const prevTx = this.parseRawTransaction(prevTxidArray[index], hex);
              // Index all outputs from this transaction
              for (const vout of prevTx.vout) {
                const key = `${prevTx.txid}:${vout.n}`;
                if (inputRefs.has(key)) {
                  inputValues.set(key, {
                    address: vout.scriptPubKey?.address || '',
                    value: vout.value,
                  });
                }
              }
            } catch (error) {
              log(`Failed to parse prev tx ${prevTxidArray[index]}:`, error);
            }
          }
        });
      } catch (error: any) {
        logError('Batch prev tx request failed:', error?.message || error);
        // Continue without input values - balanceDiff may be inaccurate
      }
    }

    // BATCH 4: Fetch block timestamps for confirmed transactions
    const blockHeights = rawTxs
      .map(({ historyItem }) => historyItem.height)
      .filter(h => h > 0);
    const blockTimestamps = await this.getBlockTimestamps(blockHeights);

    // Transform all transactions
    const transactions = rawTxs.map(({ tx, historyItem }) => {
      return this.transformTransaction(tx, historyItem, addressSet, tipHeight, inputValues, blockTimestamps, cachedTxMap);
    });

    // Sort by block time (pending first, then newest)
    transactions.sort((a, b) => {
      if (!a.confirmed && b.confirmed) return -1;
      if (a.confirmed && !b.confirmed) return 1;
      return (b.blockTime || Date.now() / 1000) - (a.blockTime || Date.now() / 1000);
    });

    this.setCache(cacheKey, transactions);
    return transactions;
  }

  /**
   * Get a single transaction with verbose details
   * Note: Many Electrum servers don't support verbose mode, so we parse raw hex
   */
  async getTransaction(txid: string): Promise<ElectrumTransaction> {
    const cacheKey = `tx:${txid}`;
    const cached = this.getCached<ElectrumTransaction>(cacheKey);
    if (cached) return cached;

    await this.connect();

    // Request without verbose flag - most servers only support raw hex
    const rawHex = await this.client.request<string>(
      'blockchain.transaction.get',
      [txid, false]
    );

    // Parse the raw transaction hex using bitcoinjs-lib
    const tx = this.parseRawTransaction(txid, rawHex);

    this.setCache(cacheKey, tx);
    return tx;
  }

  /**
   * Get the raw transaction hex for a txid.
   * Used by the TransactionBuilder to provide nonWitnessUtxo for Legacy (P2PKH) inputs.
   * Fetches multiple txids in a single batch request for efficiency.
   */
  async getRawTransactionHexBatch(txids: string[]): Promise<Map<string, string>> {
    if (txids.length === 0) return new Map();

    await this.connect();

    const requests = txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, false],
    }));

    const results = await this.client.batchRequest<string>(requests);
    const map = new Map<string, string>();
    txids.forEach((txid, index) => {
      if (results[index]) {
        map.set(txid, results[index]);
      }
    });
    return map;
  }

  /**
   * Parse raw transaction hex into ElectrumTransaction format
   */
  private parseRawTransaction(txid: string, hex: string): ElectrumTransaction {
    try {
      const txBuffer = Buffer.from(hex, 'hex');
      const parsed = bitcoin.Transaction.fromBuffer(txBuffer);

      // Calculate vsize for SegWit transactions
      const hasWitness = parsed.hasWitnesses();
      // Weight calculation: base size * 3 + total size
      const baseSize = parsed.byteLength(false);
      const totalSize = txBuffer.length;
      const weight = hasWitness
        ? baseSize * 3 + totalSize
        : totalSize * 4;
      const vsize = Math.ceil(weight / 4);

      // Parse inputs
      const vin: ElectrumTransaction['vin'] = parsed.ins.map((input, index) => ({
        txid: Buffer.from(input.hash).reverse().toString('hex'),
        vout: input.index,
        scriptSig: {
          asm: '',
          hex: Buffer.from(input.script).toString('hex'),
        },
        txinwitness: input.witness.map(w => Buffer.from(w).toString('hex')),
        sequence: input.sequence,
      }));

      // Parse outputs
      const vout: ElectrumTransaction['vout'] = parsed.outs.map((output, index) => {
        let address: string | undefined;
        const scriptBuf = Buffer.from(output.script);
        try {
          const network = this.network === 'mainnet'
            ? bitcoin.networks.bitcoin
            : bitcoin.networks.testnet;
          address = bitcoin.address.fromOutputScript(scriptBuf, network);
        } catch {
          // OP_RETURN or non-standard script
        }

        // Convert bigint to number (safe for Bitcoin amounts < 21M BTC)
        const value = typeof output.value === 'bigint'
          ? Number(output.value)
          : output.value;

        return {
          value, // In satoshis
          n: index,
          scriptPubKey: {
            asm: '',
            hex: scriptBuf.toString('hex'),
            type: this.getScriptType(scriptBuf),
            address,
          },
        };
      });

      return {
        txid,
        hash: txid,
        version: parsed.version,
        size: txBuffer.length,
        vsize,
        weight,
        locktime: parsed.locktime,
        vin,
        vout,
        hex,
      };
    } catch (error) {
      logError('Failed to parse transaction:', txid, error);
      // Return minimal transaction object on parse failure
      return {
        txid,
        hash: txid,
        version: 2,
        size: hex.length / 2,
        vsize: hex.length / 2,
        weight: hex.length * 2,
        locktime: 0,
        vin: [],
        vout: [],
        hex,
      };
    }
  }

  /**
   * Determine script type from output script
   */
  private getScriptType(script: Buffer): string {
    if (!script || script.length === 0) {
      return 'nonstandard';
    }

    const firstByte = script[0];
    const length = script.length;

    // P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
    if (length === 25 && firstByte === 0x76) {
      return 'pubkeyhash';
    }
    // P2SH: OP_HASH160 <20 bytes> OP_EQUAL
    if (length === 23 && firstByte === 0xa9) {
      return 'scripthash';
    }
    // P2WPKH: OP_0 <20 bytes>
    if (length === 22 && firstByte === 0x00) {
      return 'witness_v0_keyhash';
    }
    // P2WSH: OP_0 <32 bytes>
    if (length === 34 && firstByte === 0x00) {
      return 'witness_v0_scripthash';
    }
    // P2TR: OP_1 <32 bytes>
    if (length === 34 && firstByte === 0x51) {
      return 'witness_v1_taproot';
    }
    // OP_RETURN
    if (firstByte === 0x6a) {
      return 'nulldata';
    }
    return 'nonstandard';
  }

  /**
   * Transform Electrum transaction to DetailedTransactionInfo
   * @param inputValues - Map of "txid:vout" -> { address, value } for input lookup
   * @param blockTimestamps - Map of block height -> unix timestamp
   * @param cachedTxMap - Map of txid -> cached tx (to preserve firstSeen for pending)
   */
  private transformTransaction(
    tx: ElectrumTransaction,
    historyItem: ElectrumHistoryItem,
    walletAddresses: Set<string>,
    tipHeight: number,
    inputValues: Map<string, { address: string; value: number }>,
    blockTimestamps?: Map<number, number>,
    cachedTxMap?: Map<string, DetailedTransactionInfo>
  ): DetailedTransactionInfo {
    // Parse inputs - look up values from previous transactions
    const inputs: TransactionInput[] = tx.vin.map((vin, index) => {
      const key = `${vin.txid}:${vin.vout}`;
      const prevOutput = inputValues.get(key);
      return {
        index,
        prevTxid: vin.txid || '',
        prevVout: vin.vout || 0,
        address: prevOutput?.address || '',
        value: prevOutput?.value || 0,
      };
    });

    // Parse outputs - values from parsed tx are already in satoshis
    const outputs: TransactionOutput[] = tx.vout.map(vout => ({
      index: vout.n,
      address: vout.scriptPubKey?.address || null,
      value: vout.value, // Already in satoshis from our parser
    }));

    // Calculate balance diff
    let balanceDiff = 0;

    // Subtract inputs from wallet addresses
    for (const input of inputs) {
      if (input.address && walletAddresses.has(input.address)) {
        balanceDiff -= input.value;
      }
    }

    // Add outputs to wallet addresses
    for (const output of outputs) {
      if (output.address && walletAddresses.has(output.address)) {
        balanceDiff += output.value;
      }
    }

    const confirmed = historyItem.height > 0;
    const confirmations = confirmed ? tipHeight - historyItem.height + 1 : 0;

    // Calculate fee from inputs - outputs
    const totalIn = inputs.reduce((sum, i) => sum + i.value, 0);
    const totalOut = outputs.reduce((sum, o) => sum + o.value, 0);
    const fee = totalIn > 0 ? totalIn - totalOut : historyItem.fee || 0;

    // Get cached transaction to preserve firstSeen time
    const cachedTx = cachedTxMap?.get(tx.txid);

    // Determine blockTime and firstSeen:
    // - For confirmed: use actual block timestamp from header
    // - For pending: use firstSeen from cache, or current time if new
    let blockTime: number;
    let firstSeen: number | undefined;

    if (confirmed) {
      // Use block timestamp for confirmed transactions
      blockTime = blockTimestamps?.get(historyItem.height) ?? Math.floor(Date.now() / 1000);
      // Preserve firstSeen if it was previously pending
      firstSeen = cachedTx?.firstSeen;
    } else {
      // For pending transactions, preserve the original discovery time
      firstSeen = cachedTx?.firstSeen ?? Math.floor(Date.now() / 1000);
      blockTime = firstSeen; // Display firstSeen as the time for pending tx
    }

    return {
      txid: tx.txid,
      height: historyItem.height,
      confirmed,
      blockTime,
      confirmations,
      firstSeen,
      fee: fee > 0 ? fee : 0,
      feeRate: tx.vsize > 0 && fee > 0 ? Math.round(fee / tx.vsize) : 0,
      isRBF: tx.vin.some(vin => vin.sequence < 0xffffffff - 1),
      rawHex: tx.hex || '',
      inputs,
      outputs,
      size: tx.size,
      vsize: tx.vsize,
      balanceDiff,
      isLastTransaction: false,
      type: balanceDiff >= 0 ? 'incoming' : 'outgoing',
      status: confirmed ? 'confirmed' : 'pending',
    };
  }

  // ============================================
  // Fee Estimation
  // ============================================

  /**
   * Get fee estimates for different confirmation targets using batch request
   * Optimized to use a single batch request instead of 4 separate calls
   */
  async getFeeEstimates(): Promise<FeeRecommendation> {
    const cacheKey = 'fees';
    const cached = this.getCached<FeeRecommendation>(cacheKey);
    if (cached) {
      return cached;
    }

    await this.connect();

    // Batch request all fee estimates at once
    const requests = [
      { method: 'blockchain.estimatefee', params: [1] },   // Next block (~10 min)
      { method: 'blockchain.estimatefee', params: [3] },   // ~30 min
      { method: 'blockchain.estimatefee', params: [6] },   // ~60 min
      { method: 'blockchain.estimatefee', params: [25] },  // ~4 hours (economy)
    ];

    try {
      // Each estimatefee returns a number
      const results = await this.client.batchRequest<number>(requests);

      // Convert BTC/kB to sat/vB
      const toSatPerVb = (btcPerKb: number): number => {
        if (btcPerKb < 0) return 1; // Server returned -1 (cannot estimate)
        return Math.ceil(btcPerKb * 100000); // BTC/kB to sat/vB
      };

      const fees: FeeRecommendation = {
        fastest: Math.max(toSatPerVb(results[0]), 1),
        halfHour: Math.max(toSatPerVb(results[1]), 1),
        hour: Math.max(toSatPerVb(results[2]), 1),
        economy: Math.max(toSatPerVb(results[3]), 1),
        minimum: 1,
      };

      this.setCache(cacheKey, fees);
      return fees;
    } catch (error: any) {
      logError('Batch fee estimate failed:', error?.message || error);
      // Return minimum fees on error
      return {
        fastest: 1,
        halfHour: 1,
        hour: 1,
        economy: 1,
        minimum: 1,
      };
    }
  }

  /**
   * Estimate fee rate for target blocks
   * @param blocks - Number of blocks for confirmation
   * @returns Fee rate in sat/vB
   */
  private async estimateFee(blocks: number): Promise<number> {
    try {
      const result = await this.client.request<number>(
        'blockchain.estimatefee',
        [blocks]
      );

      // Result is in BTC/kB, convert to sat/vB
      // 1 BTC = 100,000,000 sats
      // 1 kB = 1000 bytes
      // So: BTC/kB * 100,000,000 / 1000 = sat/byte = sat/vB
      if (result < 0) {
        // Server returned -1 (cannot estimate)
        return 1; // Fallback to minimum
      }

      return Math.ceil(result * 100000); // BTC/kB to sat/vB
    } catch (error) {
      if (DEBUG) console.warn(`Failed to estimate fee for ${blocks} blocks:`, error);
      return 1;
    }
  }

  // ============================================
  // Transaction Broadcast
  // ============================================

  /**
   * Broadcast a raw transaction
   * @param txHex - Raw transaction hex
   * @returns Transaction ID
   */
  async broadcastTransaction(txHex: string): Promise<string> {
    this.checkCircuitBreaker();
    log('broadcastTransaction: connecting...');
    const connectStart = Date.now();
    await this.connect();
    const server = this.client.getCurrentServer();
    log(`broadcastTransaction: connected in ${Date.now() - connectStart}ms to ${server?.host || 'unknown'}`);
    SyncLogger.log('electrum', `Broadcasting transaction (${txHex.length} hex chars) to ${server?.host || 'unknown'}`);

    log('broadcastTransaction: broadcasting tx (' + txHex.length + ' hex chars)...');
    const broadcastStart = Date.now();
    try {
      const txid = await this.client.request<string>(
        'blockchain.transaction.broadcast',
        [txHex]
      );
      const broadcastMs = Date.now() - broadcastStart;
      log(`broadcastTransaction: SUCCESS in ${broadcastMs}ms, txid: ${txid}`);
      SyncLogger.log('electrum', `Broadcast SUCCESS in ${broadcastMs}ms — txid: ${txid.slice(0, 16)}...`);
      this.recordCircuitSuccess();

      // Clear relevant caches after broadcast
      this.cache.clear();

      return txid;
    } catch (err: any) {
      const broadcastMs = Date.now() - broadcastStart;
      logError(`broadcastTransaction: FAILED in ${broadcastMs}ms:`, err?.message || err);
      SyncLogger.error('electrum', `Broadcast FAILED in ${broadcastMs}ms on ${server?.host || 'unknown'}: ${err?.message || err}`);
      throw err;
    }
  }

  // ============================================
  // Block Height
  // ============================================

  /**
   * Get current block height — simple header subscribe, cached 60s.
   * No multi-server probe. The subscription system handles real-time updates.
   */
  async getBlockHeight(): Promise<number> {
    // Return cached height if recent
    if (this.blockHeight > 0) {
      const cacheKey = 'height';
      const cached = this.getCached<number>(cacheKey);
      if (cached) return cached;
    }

    try {
      await this.connect();

      const header = await this.client.request<ElectrumHeader>(
        'blockchain.headers.subscribe',
        []
      );
      this.blockHeight = header.height;
      this.setCache('height', header.height);
      return header.height;
    } catch (error) {
      if (this.blockHeight > 0) {
        return this.blockHeight;
      }
      throw error;
    }
  }

  /**
   * Expose the underlying ElectrumClient for SubscriptionManager.
   * The client is persistent (singleton) and stays connected for subscriptions.
   */
  getClient(): ElectrumClient {
    return this.client;
  }

  /**
   * Get block header for a specific height
   * Returns the timestamp from the block header
   */
  async getBlockHeader(height: number): Promise<{ timestamp: number }> {
    await this.connect();

    try {
      // blockchain.block.header returns raw header hex
      const headerHex = await this.client.request<string>(
        'blockchain.block.header',
        [height]
      );

      // Bitcoin block header is 80 bytes
      // Timestamp is at bytes 68-72 (little-endian uint32)
      const headerBuffer = Buffer.from(headerHex, 'hex');
      const timestamp = headerBuffer.readUInt32LE(68);

      return { timestamp };
    } catch (error) {
      logError('Failed to get block header:', error);
      throw error;
    }
  }

  /**
   * Get timestamps for multiple block heights using batch requests
   * Returns a map of height -> timestamp
   */
  async getBlockTimestamps(heights: number[]): Promise<Map<number, number>> {
    if (heights.length === 0) {
      return new Map();
    }

    await this.connect();

    // Deduplicate and filter valid heights (> 0)
    const uniqueHeights = [...new Set(heights.filter(h => h > 0))];

    if (uniqueHeights.length === 0) {
      return new Map();
    }

    // Create batch request for all block headers
    const requests = uniqueHeights.map(height => ({
      method: 'blockchain.block.header',
      params: [height],
    }));

    try {
      const headerHexes = await this.client.batchRequest<string>(requests);

      const timestamps = new Map<number, number>();
      headerHexes.forEach((headerHex, index) => {
        if (headerHex) {
          try {
            // Bitcoin block header: timestamp is at bytes 68-72 (little-endian uint32)
            const headerBuffer = Buffer.from(headerHex, 'hex');
            const timestamp = headerBuffer.readUInt32LE(68);
            timestamps.set(uniqueHeights[index], timestamp);
          } catch (error) {
            log('Failed to parse block header for height', uniqueHeights[index]);
          }
        }
      });

      return timestamps;
    } catch (error: any) {
      logError('Batch block header request failed:', error?.message || error);
      return new Map();
    }
  }

  // ============================================
  // Combined Wallet Sync (Most Efficient)
  // ============================================

  /**
   * Light wallet sync — returns balance (derived from UTXOs), UTXOs, and raw history
   * in a SINGLE batch request. No separate balance fetch needed.
   * This is the most efficient approach for refreshBalance.
   */
  async syncWalletLight(
    addresses: string[]
  ): Promise<SyncLightResult> {
    if (addresses.length === 0) {
      return {
        ok: true,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        utxos: [],
        historyMap: new Map(),
      };
    }

    // Circuit breaker check (return error result instead of throwing)
    try {
      this.checkCircuitBreaker();
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Circuit breaker open' };
    }

    await this.connect();

    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));

    // SINGLE BATCH: UTXOs + Histories for all addresses in ONE request
    const requests: Array<{ method: string; params: any[] }> = [];

    // UTXOs first
    scripthashes.forEach(sh => {
      requests.push({ method: 'blockchain.scripthash.listunspent', params: [sh] });
    });

    // Then histories
    scripthashes.forEach(sh => {
      requests.push({ method: 'blockchain.scripthash.get_history', params: [sh] });
    });

    let batchResults: any[];
    try {
      batchResults = await this.client.batchRequest<any>(requests);
    } catch (error: any) {
      this.recordCircuitFailure();
      logError('syncWalletLight batch failed:', error?.message || error);
      return { ok: false, error: error?.message || 'Sync failed' };
    }

    // Split results: first half = UTXOs, second half = histories
    const utxoResults = batchResults.slice(0, addresses.length) as ElectrumUTXO[][];
    const historyResults = batchResults.slice(addresses.length) as ElectrumHistoryItem[][];

    // Get block height for confirmations
    const tipHeight = await this.getBlockHeight();

    // Process UTXOs and derive balance simultaneously
    let confirmed = 0;
    let unconfirmed = 0;
    const utxos: UTXO[] = [];

    utxoResults.forEach((utxoList, index) => {
      if (utxoList && Array.isArray(utxoList)) {
        for (const u of utxoList) {
          if (u.height > 0) {
            confirmed += u.value;
          } else {
            unconfirmed += u.value;
          }

          utxos.push({
            txid: u.tx_hash,
            vout: u.tx_pos,
            value: u.value,
            address: addresses[index],
            scriptPubKey: '',
            confirmations: u.height > 0 ? tipHeight - u.height + 1 : 0,
          });
        }
      }
    });

    // Process histories into a map
    const historyMap = new Map<string, ElectrumHistoryItem[]>();
    historyResults.forEach((history, index) => {
      historyMap.set(addresses[index], history && Array.isArray(history) ? history : []);
    });

    this.recordCircuitSuccess();

    return {
      ok: true,
      balance: { confirmed, unconfirmed, total: confirmed + unconfirmed },
      utxos,
      historyMap,
    };
  }

  /**
   * Sync entire wallet in optimized batch calls
   * Returns balance, UTXOs, and transactions in minimal network operations
   * This is the most efficient way to sync a wallet
   * @param addresses - Array of addresses to sync
   * @param cachedTransactions - Optional previously cached transactions to preserve firstSeen times
   */
  async syncWallet(
    addresses: string[],
    cachedTransactions?: DetailedTransactionInfo[]
  ): Promise<SyncFullResult> {
    if (addresses.length === 0) {
      return {
        ok: true,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        utxos: [],
        transactions: [],
      };
    }

    // Circuit breaker check
    try {
      this.checkCircuitBreaker();
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Circuit breaker open' };
    }

    await this.connect();

    // Build map of cached transactions to preserve firstSeen times
    const cachedTxMap = new Map<string, DetailedTransactionInfo>();
    if (cachedTransactions) {
      for (const tx of cachedTransactions) {
        cachedTxMap.set(tx.txid, tx);
      }
    }

    const addressSet = new Set(addresses);
    const scripthashes = addresses.map(addr => addressToScripthash(addr, this.network));

    // MEGA BATCH: Get UTXOs + Histories for all addresses in ONE request
    const requests: Array<{ method: string; params: any[] }> = [];

    // Add UTXO requests for all addresses
    scripthashes.forEach(sh => {
      requests.push({ method: 'blockchain.scripthash.listunspent', params: [sh] });
    });

    // Add history requests for all addresses
    scripthashes.forEach(sh => {
      requests.push({ method: 'blockchain.scripthash.get_history', params: [sh] });
    });

    let megaResults: any[];
    try {
      // Results will be mixed types (ElectrumUTXO[] and ElectrumHistoryItem[])
      megaResults = await this.client.batchRequest<any>(requests);
    } catch (error: any) {
      this.recordCircuitFailure();
      logError('Mega batch request failed:', error?.message || error);
      return { ok: false, error: error?.message || 'Sync failed' };
    }

    // Split results
    const utxoResults = megaResults.slice(0, addresses.length) as ElectrumUTXO[][];
    const historyResults = megaResults.slice(addresses.length) as ElectrumHistoryItem[][];

    // Get block height for confirmations
    const tipHeight = await this.getBlockHeight();

    // Process UTXOs and calculate balance
    let confirmed = 0;
    let unconfirmed = 0;
    const utxos: UTXO[] = [];

    utxoResults.forEach((utxoList, index) => {
      if (utxoList && Array.isArray(utxoList)) {
        for (const u of utxoList) {
          if (u.height > 0) {
            confirmed += u.value;
          } else {
            unconfirmed += u.value;
          }

          utxos.push({
            txid: u.tx_hash,
            vout: u.tx_pos,
            value: u.value,
            address: addresses[index],
            scriptPubKey: '',
            confirmations: u.height > 0 ? tipHeight - u.height + 1 : 0,
          });
        }
      }
    });

    // Process transaction histories - deduplicate
    const txMap = new Map<string, ElectrumHistoryItem>();
    for (const history of historyResults) {
      if (history && Array.isArray(history)) {
        for (const item of history) {
          if (!txMap.has(item.tx_hash)) {
            txMap.set(item.tx_hash, item);
          }
        }
      }
    }

    // Fetch transaction details if we have any
    let transactions: DetailedTransactionInfo[] = [];
    if (txMap.size > 0) {
      const txids = Array.from(txMap.keys());
      const txRequests = txids.map(txid => ({
        method: 'blockchain.transaction.get',
        params: [txid, false],
      }));

      try {
        const rawTxHexes = await this.client.batchRequest<string>(txRequests);

        // Parse transactions
        const rawTxs: Array<{ tx: ElectrumTransaction; historyItem: ElectrumHistoryItem }> = [];
        txids.forEach((txid, index) => {
          const hex = rawTxHexes[index];
          if (hex) {
            try {
              const tx = this.parseRawTransaction(txid, hex);
              const historyItem = txMap.get(txid)!;
              rawTxs.push({ tx, historyItem });
            } catch (error) {
              log(`Failed to parse tx ${txid}:`, error);
            }
          }
        });

        // Collect input refs needed
        const inputRefs = new Set<string>();
        for (const { tx } of rawTxs) {
          for (const vin of tx.vin) {
            if (vin.txid) {
              inputRefs.add(`${vin.txid}:${vin.vout}`);
            }
          }
        }

        // Build input values map - first from txs we have
        const inputValues = new Map<string, { address: string; value: number }>();
        for (const { tx } of rawTxs) {
          for (const vout of tx.vout) {
            const key = `${tx.txid}:${vout.n}`;
            if (inputRefs.has(key)) {
              inputValues.set(key, {
                address: vout.scriptPubKey?.address || '',
                value: vout.value,
              });
            }
          }
        }

        // Fetch missing prev txs
        const prevTxids = new Set<string>();
        for (const ref of inputRefs) {
          const prevTxid = ref.split(':')[0];
          if (!txMap.has(prevTxid)) {
            prevTxids.add(prevTxid);
          }
        }

        if (prevTxids.size > 0) {
          const prevTxRequests = Array.from(prevTxids).map(txid => ({
            method: 'blockchain.transaction.get',
            params: [txid, false],
          }));

          try {
            const prevTxHexes = await this.client.batchRequest<string>(prevTxRequests);
            const prevTxidArray = Array.from(prevTxids);

            prevTxHexes.forEach((hex, index) => {
              if (hex) {
                try {
                  const prevTx = this.parseRawTransaction(prevTxidArray[index], hex);
                  for (const vout of prevTx.vout) {
                    const key = `${prevTx.txid}:${vout.n}`;
                    if (inputRefs.has(key)) {
                      inputValues.set(key, {
                        address: vout.scriptPubKey?.address || '',
                        value: vout.value,
                      });
                    }
                  }
                } catch (error) {
                  log(`Failed to parse prev tx:`, error);
                }
              }
            });
          } catch (error) {
            log('Failed to fetch prev txs:', error);
          }
        }

        // Fetch block timestamps for confirmed transactions
        const blockHeights = rawTxs
          .map(({ historyItem }) => historyItem.height)
          .filter(h => h > 0);
        const blockTimestamps = await this.getBlockTimestamps(blockHeights);

        // Transform transactions
        transactions = rawTxs.map(({ tx, historyItem }) => {
          return this.transformTransaction(tx, historyItem, addressSet, tipHeight, inputValues, blockTimestamps, cachedTxMap);
        });

        // Sort: pending first, then newest
        transactions.sort((a, b) => {
          if (!a.confirmed && b.confirmed) return -1;
          if (a.confirmed && !b.confirmed) return 1;
          return (b.blockTime || Date.now() / 1000) - (a.blockTime || Date.now() / 1000);
        });
      } catch (error) {
        log('Failed to fetch transaction details:', error);
      }
    }

    this.recordCircuitSuccess();

    return {
      ok: true,
      balance: { confirmed, unconfirmed, total: confirmed + unconfirmed },
      utxos,
      transactions,
    };
  }

  // ============================================
  // PARALLEL SYNC METHODS (Using ElectrumPool)
  // ============================================

  /**
   * Sync wallet using parallel multi-server queries for maximum speed.
   * This is the fastest way to sync a wallet with many addresses.
   *
   * Key optimizations:
   * 1. Scripthash conversion runs in parallel
   * 2. Requests are distributed across multiple server workers
   * 3. Block height and data fetches run concurrently
   *
   * @param addresses - Array of addresses to sync
   * @returns Balance, UTXOs, and history map
   */
  async syncWalletParallel(
    addresses: string[]
  ): Promise<SyncLightResult> {
    if (addresses.length === 0) {
      return {
        ok: true,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        utxos: [],
        historyMap: new Map(),
      };
    }

    // Circuit breaker check
    try {
      this.checkCircuitBreaker();
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Circuit breaker open' };
    }

    // Initialize pool if needed
    if (!this.pool.isReady()) {
      await this.pool.initialize(3);
    }

    // PARALLEL: Convert addresses to scripthashes
    // This is CPU-intensive, so we parallelize it
    const scripthashPromises = addresses.map(addr =>
      Promise.resolve(addressToScripthash(addr, this.network))
    );
    const scripthashes = await Promise.all(scripthashPromises);

    // Build request groups for parallel execution
    // Group 1: UTXOs for first half of addresses
    // Group 2: UTXOs for second half of addresses
    // Group 3: History for first half of addresses
    // Group 4: History for second half of addresses

    const midpoint = Math.ceil(addresses.length / 2);
    const sh1 = scripthashes.slice(0, midpoint);
    const sh2 = scripthashes.slice(midpoint);

    const utxoRequests1 = sh1.map(sh => ({
      method: 'blockchain.scripthash.listunspent',
      params: [sh],
    }));

    const utxoRequests2 = sh2.map(sh => ({
      method: 'blockchain.scripthash.listunspent',
      params: [sh],
    }));

    const historyRequests1 = sh1.map(sh => ({
      method: 'blockchain.scripthash.get_history',
      params: [sh],
    }));

    const historyRequests2 = sh2.map(sh => ({
      method: 'blockchain.scripthash.get_history',
      params: [sh],
    }));

    // PARALLEL: Execute all request groups and get block height simultaneously
    const [
      utxoResults1,
      utxoResults2,
      historyResults1,
      historyResults2,
      tipHeight,
    ] = await Promise.all([
      this.pool.batchRequest<ElectrumUTXO[]>(utxoRequests1),
      this.pool.batchRequest<ElectrumUTXO[]>(utxoRequests2),
      this.pool.batchRequest<ElectrumHistoryItem[]>(historyRequests1),
      this.pool.batchRequest<ElectrumHistoryItem[]>(historyRequests2),
      this.getBlockHeight(),
    ]);

    // Combine results
    const utxoResults = [...utxoResults1, ...utxoResults2];
    const historyResults = [...historyResults1, ...historyResults2];

    // Process UTXOs and calculate balance
    let confirmed = 0;
    let unconfirmed = 0;
    const utxos: UTXO[] = [];

    utxoResults.forEach((utxoList, index) => {
      if (utxoList && Array.isArray(utxoList)) {
        for (const u of utxoList) {
          if (u.height > 0) {
            confirmed += u.value;
          } else {
            unconfirmed += u.value;
          }

          utxos.push({
            txid: u.tx_hash,
            vout: u.tx_pos,
            value: u.value,
            address: addresses[index],
            scriptPubKey: '',
            confirmations: u.height > 0 ? tipHeight - u.height + 1 : 0,
          });
        }
      }
    });

    // Process histories into a map
    const historyMap = new Map<string, ElectrumHistoryItem[]>();
    historyResults.forEach((history, index) => {
      historyMap.set(addresses[index], history && Array.isArray(history) ? history : []);
    });

    this.recordCircuitSuccess();

    return {
      ok: true,
      balance: { confirmed, unconfirmed, total: confirmed + unconfirmed },
      utxos,
      historyMap,
    };
  }

  /**
   * Get balances for multiple wallets in parallel.
   * Much faster than sequential calls when syncing multiple wallets.
   *
   * @param walletAddresses - Array of address arrays (one per wallet)
   * @returns Array of balance info (one per wallet)
   */
  async getMultiWalletBalancesParallel(
    walletAddresses: string[][]
  ): Promise<BalanceInfo[]> {
    if (walletAddresses.length === 0) {
      return [];
    }

    // Initialize pool if needed
    if (!this.pool.isReady()) {
      await this.pool.initialize(3);
    }

    // Prepare all wallet syncs in parallel
    const syncPromises = walletAddresses.map(addresses =>
      this.syncWalletParallel(addresses)
    );

    // Execute all in parallel — use allSettled to not fail on individual wallet errors
    const settled = await Promise.allSettled(syncPromises);

    return settled.map(s => {
      if (s.status === 'fulfilled' && s.value.ok) {
        return s.value.balance;
      }
      // On error, return null balance so caller knows this wallet failed
      return { confirmed: 0, unconfirmed: 0, total: -1 }; // -1 signals failure
    });
  }

  /**
   * Fetch multiple transaction details in parallel across workers.
   * Much faster for fetching large numbers of transactions.
   *
   * @param txids - Array of transaction IDs to fetch
   * @returns Array of raw transaction hex strings
   */
  async getTransactionsParallel(txids: string[]): Promise<string[]> {
    if (txids.length === 0) {
      return [];
    }

    // Initialize pool if needed
    if (!this.pool.isReady()) {
      await this.pool.initialize(3);
    }

    // Use distributed batch for automatic chunking and parallel execution
    const requests = txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, false], // false = return hex, not verbose
    }));

    const results = await this.pool.distributedBatch<string>(requests, 20);

    return results;
  }

  /**
   * Broadcast a transaction using race - sends to all workers,
   * returns as soon as one succeeds.
   *
   * @param txHex - Raw transaction hex
   * @returns Transaction ID
   */
  async broadcastRace(txHex: string): Promise<string> {
    // Initialize pool if needed
    if (!this.pool.isReady()) {
      await this.pool.initialize(3);
    }

    try {
      const txid = await this.pool.raceRequest<string>({
        method: 'blockchain.transaction.broadcast',
        params: [txHex],
      });

      return txid;
    } catch (error: any) {
      // If all workers fail, fallback to single client
      await this.connect();
      return this.client.request<string>('blockchain.transaction.broadcast', [txHex]);
    }
  }

  // ============================================
  // Explorer URLs (for compatibility)
  // ============================================

  /**
   * Get explorer URL for a transaction
   */
  getExplorerUrl(txid: string): string {
    const base = this.network === 'mainnet'
      ? 'https://mempool.space'
      : 'https://mempool.space/testnet';
    return `${base}/tx/${txid}`;
  }

  /**
   * Get explorer URL for an address
   */
  getAddressExplorerUrl(address: string): string {
    const base = this.network === 'mainnet'
      ? 'https://mempool.space'
      : 'https://mempool.space/testnet';
    return `${base}/address/${address}`;
  }
}
