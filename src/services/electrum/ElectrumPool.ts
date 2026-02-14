/**
 * ElectrumPool - Multi-Server Parallel Query Manager
 *
 * Manages a pool of Electrum connections to enable parallel queries across
 * multiple servers, dramatically speeding up wallet sync operations.
 *
 * Key Features:
 * - Maintains N concurrent server connections as "workers"
 * - Distributes batch requests across workers using Promise.all
 * - Automatic failover and server rotation
 * - Load balancing based on server performance
 * - Race queries for fastest response
 *
 * Usage:
 *   const pool = ElectrumPool.shared('mainnet');
 *   await pool.initialize(3); // Start 3 worker connections
 *   const results = await pool.parallelBatch(requests); // Distributed across workers
 */

import { ElectrumClient } from './ElectrumClient';
import type { ElectrumServerInfo } from './types';
import servers from './servers.json';
import { SyncLogger } from '../SyncLogger';

// Debug logging - disabled to reduce console noise (enable for pool debugging)
const DEBUG = false;
const log = (...args: any[]) => DEBUG && console.log('[ElectrumPool]', ...args);
const logError = (...args: any[]) => DEBUG && console.error('[ElectrumPool ERROR]', ...args);

// Pool configuration
const DEFAULT_WORKER_COUNT = 3; // Number of parallel connections
const MAX_WORKER_COUNT = 5; // Maximum workers
const MIN_WORKER_COUNT = 2; // Minimum workers
const WORKER_INIT_TIMEOUT = 10000; // 10s timeout for worker initialization
const WORKER_HEALTH_CHECK_INTERVAL = 60000; // Health check every 60s

// Jitter & circuit breaker configuration
const WORKER_RECONNECT_BASE_DELAY = 1000; // 1s base reconnect delay
const WORKER_RECONNECT_JITTER = 3000; // Up to 3s random jitter
const WORKER_CIRCUIT_FAILURE_THRESHOLD = 3; // 3 consecutive failures → open circuit
const WORKER_CIRCUIT_COOLDOWN = 30000; // 30s before half-open probe
const BACKGROUND_RECOVERY_MAX_ATTEMPTS = 5; // Max recovery attempts

interface PoolWorker {
  id: number;
  client: ElectrumClient;
  isConnected: boolean;
  isBusy: boolean;
  successCount: number;
  failCount: number;
  lastUsed: number;
  avgLatency: number;
  // Circuit breaker
  consecutiveFailures: number;
  circuitState: 'closed' | 'open' | 'half-open';
  circuitOpenedAt: number;
}

interface BatchRequest {
  method: string;
  params: any[];
}

/**
 * ElectrumPool manages multiple server connections for parallel queries.
 */
export class ElectrumPool {
  private workers: PoolWorker[] = [];
  private network: 'mainnet' | 'testnet';
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;
  private isDegraded: boolean = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private serverList: ElectrumServerInfo[];
  private usedServerIndices: Set<number> = new Set();

  // Singleton instances
  private static _instances: Map<string, ElectrumPool> = new Map();

  /**
   * Get a shared singleton instance for the given network.
   */
  static shared(network: 'mainnet' | 'testnet' = 'mainnet'): ElectrumPool {
    let instance = this._instances.get(network);
    if (!instance) {
      instance = new ElectrumPool(network);
      this._instances.set(network, instance);
    }
    return instance;
  }

  constructor(network: 'mainnet' | 'testnet' = 'mainnet') {
    this.network = network;
    this.serverList = this.parseServerList(servers as string[]);
  }

  private parseServerList(serverStrings: string[]): ElectrumServerInfo[] {
    return serverStrings.map(s => {
      const [host, portStr] = s.split(':');
      const port = parseInt(portStr, 10);
      return {
        host,
        port,
        ssl: port === 50002 || port === 50006 || port === 443,
      };
    });
  }

  /**
   * Initialize the pool with N worker connections.
   * Each worker connects to a different server for true parallelism.
   */
  async initialize(workerCount: number = DEFAULT_WORKER_COUNT): Promise<void> {
    if (this.isInitialized) {
      log('Pool already initialized');
      return;
    }

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = this._doInitialize(workerCount);

    try {
      await this.initPromise;
    } finally {
      this.isInitializing = false;
    }
  }

  private async _doInitialize(workerCount: number): Promise<void> {
    const count = Math.max(MIN_WORKER_COUNT, Math.min(workerCount, MAX_WORKER_COUNT));
    log(`Initializing pool with ${count} workers...`);

    const startTime = Date.now();

    // Try to connect workers in parallel
    const workerPromises: Promise<PoolWorker | null>[] = [];

    for (let i = 0; i < count; i++) {
      workerPromises.push(this.createWorker(i));
    }

    const results = await Promise.allSettled(workerPromises);

    // Collect successful workers
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        this.workers.push(result.value);
      }
    }

    const elapsed = Date.now() - startTime;
    log(`Pool initialized with ${this.workers.length} workers in ${elapsed}ms`);
    SyncLogger.log('pool', `Pool init: ${this.workers.length}/${count} workers in ${elapsed}ms`);

    // Graceful degradation: allow pool to function even with fewer workers
    if (this.workers.length >= MIN_WORKER_COUNT) {
      this.isInitialized = true;
      this.isDegraded = false;
      this.startHealthCheck();
    } else if (this.workers.length > 0) {
      // Degraded mode: some workers connected but below minimum
      this.isInitialized = true;
      this.isDegraded = true;
      log(`Pool running in degraded mode with ${this.workers.length} worker(s)`);
      SyncLogger.warn('pool', `Degraded mode: only ${this.workers.length} worker(s) connected`);
      this.startHealthCheck();
      // Non-blocking: schedule background recovery instead of blocking init
      this.scheduleBackgroundRecovery();
    } else {
      // 0 workers: mark as degraded but don't block callers
      this.isInitialized = false;
      this.isDegraded = true;
      logError('Pool failed to initialize: 0 workers connected. Will fallback to single client.');
      SyncLogger.error('pool', 'Pool failed: 0 workers connected — falling back to single client');
      // Non-blocking: try to recover in the background
      this.scheduleBackgroundRecovery();
    }
  }

  /**
   * Create a single worker connection.
   */
  private async createWorker(id: number): Promise<PoolWorker | null> {
    try {
      const client = new ElectrumClient(this.network);

      // Connect with timeout
      const connectPromise = client.connect();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Worker init timeout')), WORKER_INIT_TIMEOUT)
      );

      await Promise.race([connectPromise, timeoutPromise]);

      const worker: PoolWorker = {
        id,
        client,
        isConnected: true,
        isBusy: false,
        successCount: 0,
        failCount: 0,
        lastUsed: 0,
        avgLatency: 0,
        consecutiveFailures: 0,
        circuitState: 'closed',
        circuitOpenedAt: 0,
      };

      log(`Worker ${id} connected successfully`);
      return worker;
    } catch (error: any) {
      logError(`Failed to create worker ${id}:`, error?.message || error);
      return null;
    }
  }

  /**
   * Ensure we have at least the minimum number of workers.
   */
  private async ensureMinimumWorkers(): Promise<void> {
    while (this.workers.length < MIN_WORKER_COUNT) {
      const newWorker = await this.createWorker(this.workers.length);
      if (newWorker) {
        this.workers.push(newWorker);
      } else {
        break;
      }
    }
  }

  /**
   * Random jittered delay to prevent thundering herd on reconnection.
   */
  private jitteredDelay(): Promise<void> {
    const delay = WORKER_RECONNECT_BASE_DELAY + Math.random() * WORKER_RECONNECT_JITTER;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Non-blocking background recovery: tries to bring pool up to MIN_WORKER_COUNT.
   * Runs with jittered delays between attempts to avoid thundering herd.
   */
  private scheduleBackgroundRecovery(): void {
    // Fire and forget — does not block callers
    (async () => {
      for (let attempt = 0; attempt < BACKGROUND_RECOVERY_MAX_ATTEMPTS; attempt++) {
        await this.jitteredDelay();

        if (this.workers.filter(w => w.isConnected).length >= MIN_WORKER_COUNT) {
          this.isDegraded = false;
          log(`Background recovery: pool recovered (${this.workers.length} workers)`);
          if (!this.healthCheckTimer) this.startHealthCheck();
          return;
        }

        log(`Background recovery: attempt ${attempt + 1}/${BACKGROUND_RECOVERY_MAX_ATTEMPTS}`);
        const newWorker = await this.createWorker(this.workers.length);
        if (newWorker) {
          this.workers.push(newWorker);
          if (!this.isInitialized) {
            this.isInitialized = true;
            this.isDegraded = true;
            if (!this.healthCheckTimer) this.startHealthCheck();
          }
        }
      }

      if (this.workers.filter(w => w.isConnected).length >= MIN_WORKER_COUNT) {
        this.isDegraded = false;
        log('Background recovery: pool fully recovered');
      } else {
        log(`Background recovery: gave up after ${BACKGROUND_RECOVERY_MAX_ATTEMPTS} attempts (${this.workers.length} workers)`);
      }
    })().catch(err => {
      logError('Background recovery error:', err?.message || err);
    });
  }

  /**
   * Start periodic health check for workers.
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, WORKER_HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check health of all workers and replace failed ones with jittered reconnection.
   */
  private async performHealthCheck(): Promise<void> {
    log('Performing health check...');

    // Check circuit breaker cooldowns first
    const now = Date.now();
    for (const worker of this.workers) {
      if (worker.circuitState === 'open' && (now - worker.circuitOpenedAt) >= WORKER_CIRCUIT_COOLDOWN) {
        log(`Worker ${worker.id}: circuit half-open (cooldown elapsed)`);
        worker.circuitState = 'half-open';
      }
    }

    const checkPromises = this.workers.map(async (worker) => {
      if (!worker.isConnected) return false;
      if (worker.circuitState === 'open') return false; // Don't ping open-circuit workers

      try {
        await worker.client.ping();
        return true;
      } catch {
        worker.isConnected = false;
        return false;
      }
    });

    // Use allSettled so one slow/stuck worker doesn't block the entire health check
    const settled = await Promise.allSettled(checkPromises);
    const results = settled.map(r => r.status === 'fulfilled' ? r.value : false);

    // Count disconnected workers
    const disconnectedCount = results.filter(r => !r).length;

    if (disconnectedCount > 0) {
      log(`${disconnectedCount} workers disconnected, scheduling jittered replacements...`);

      // Remove disconnected workers with open circuits
      this.workers = this.workers.filter(w => w.isConnected || w.circuitState !== 'open');

      // Jittered reconnection in background (non-blocking)
      for (let i = 0; i < disconnectedCount; i++) {
        (async () => {
          await this.jitteredDelay();
          const newWorker = await this.createWorker(this.workers.length);
          if (newWorker) {
            this.workers.push(newWorker);
            log(`Health check: replacement worker ${newWorker.id} connected`);
          }
        })().catch(() => { /* silent */ });
      }
    }

    // Update degraded status
    const connectedCount = this.workers.filter(w => w.isConnected).length;
    if (connectedCount >= MIN_WORKER_COUNT) {
      if (this.isDegraded) {
        this.isDegraded = false;
        log('Pool recovered from degraded mode');
      }
    } else {
      if (!this.isDegraded) {
        this.isDegraded = true;
        log('Pool entering degraded mode');
      }
      // Schedule background recovery
      this.scheduleBackgroundRecovery();
    }

    log(`Health check complete. ${connectedCount} workers connected${this.isDegraded ? ' (degraded)' : ''}`);
  }

  /**
   * Get the least busy worker for a request.
   * Skips workers with open circuit breakers; allows half-open as last resort.
   */
  private getLeastBusyWorker(): PoolWorker | null {
    // Single pass: find best available (idle+closed), best busy (closed), and first half-open
    let bestIdle: PoolWorker | null = null;
    let bestBusy: PoolWorker | null = null;
    let firstHalfOpen: PoolWorker | null = null;

    for (const w of this.workers) {
      if (!w.isConnected) continue;
      if (w.circuitState === 'closed') {
        if (!w.isBusy) {
          if (!bestIdle || w.avgLatency < bestIdle.avgLatency) bestIdle = w;
        } else {
          if (!bestBusy || w.avgLatency < bestBusy.avgLatency) bestBusy = w;
        }
      } else if (w.circuitState === 'half-open' && !firstHalfOpen) {
        firstHalfOpen = w;
      }
    }

    if (bestIdle) return bestIdle;
    if (bestBusy) return bestBusy;
    if (firstHalfOpen) {
      log('getLeastBusyWorker: using half-open worker as last resort');
      return firstHalfOpen;
    }
    return null;
  }

  /**
   * Execute a batch request using a single worker.
   * Respects circuit breaker state — throws if circuit is open.
   */
  private async executeWithWorker<T>(
    worker: PoolWorker,
    requests: BatchRequest[]
  ): Promise<T[]> {
    // Circuit breaker check
    const now = Date.now();
    if (worker.circuitState === 'open') {
      if ((now - worker.circuitOpenedAt) >= WORKER_CIRCUIT_COOLDOWN) {
        worker.circuitState = 'half-open';
        log(`Worker ${worker.id}: circuit → half-open (probe request)`);
      } else {
        throw new Error(`Worker ${worker.id}: circuit breaker open`);
      }
    }

    const startTime = Date.now();
    worker.isBusy = true;
    worker.lastUsed = startTime;

    try {
      const results = await worker.client.batchRequest<T>(requests);
      const latency = Date.now() - startTime;

      // Success: reset circuit breaker
      worker.successCount++;
      worker.consecutiveFailures = 0;
      if (worker.circuitState !== 'closed') {
        log(`Worker ${worker.id}: circuit → closed (success)`);
        worker.circuitState = 'closed';
      }
      worker.avgLatency = worker.avgLatency === 0
        ? latency
        : (worker.avgLatency + latency) / 2;

      return results;
    } catch (error) {
      worker.failCount++;
      worker.consecutiveFailures++;

      // Open circuit if threshold reached
      if (worker.consecutiveFailures >= WORKER_CIRCUIT_FAILURE_THRESHOLD) {
        worker.circuitState = 'open';
        worker.circuitOpenedAt = Date.now();
        log(`Worker ${worker.id}: circuit → open (${worker.consecutiveFailures} consecutive failures)`);
      }

      worker.isConnected = false;
      throw error;
    } finally {
      worker.isBusy = false;
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Execute a batch request using the pool.
   * If pool not initialized, falls back to single connection.
   */
  async batchRequest<T>(requests: BatchRequest[]): Promise<T[]> {
    if (!this.isInitialized || this.workers.length === 0) {
      // Fallback to single client
      log('Pool not ready, using single client');
      const client = new ElectrumClient(this.network);
      await client.connect();
      return client.batchRequest<T>(requests);
    }

    const worker = this.getLeastBusyWorker();
    if (!worker) {
      throw new Error('No workers available');
    }

    return this.executeWithWorker<T>(worker, requests);
  }

  /**
   * Execute multiple batch requests in parallel across different workers.
   * This is the key method for speedup - distributes work across servers.
   *
   * @param requestGroups - Array of request arrays, each group sent to different worker
   * @returns Array of result arrays, one per request group
   */
  async parallelBatch<T>(requestGroups: BatchRequest[][]): Promise<T[][]> {
    if (!this.isInitialized || this.workers.length === 0) {
      try {
        await this.initialize();
      } catch {
        // Initialization failed — continue to fallback below
      }
    }

    if (requestGroups.length === 0) {
      return [];
    }

    // Fallback: if no workers available, use a single ephemeral client
    if (this.workers.length === 0) {
      log('parallelBatch: 0 workers, falling back to single ephemeral client');
      const client = new ElectrumClient(this.network);
      try {
        await client.connect();
        const results: T[][] = [];
        for (const group of requestGroups) {
          try {
            const result = await client.batchRequest<T>(group);
            results.push(result);
          } catch (error) {
            logError('Single-client fallback batch failed:', error);
            results.push([]);
          }
        }
        return results;
      } finally {
        try { client.disconnect(); } catch { /* ignore */ }
      }
    }

    const connectedWorkers = this.workers.filter(w => w.isConnected && w.circuitState !== 'open');
    if (connectedWorkers.length === 0) {
      throw new Error('No connected workers available for parallelBatch');
    }

    log(`parallelBatch: ${requestGroups.length} groups across ${connectedWorkers.length} connected workers`);
    const startTime = Date.now();

    // Distribute groups across connected workers, tracking original indices
    const workerAssignments: Map<number, { originalIndex: number; group: BatchRequest[] }[]> = new Map();

    for (let i = 0; i < requestGroups.length; i++) {
      const workerIdx = i % connectedWorkers.length;
      const workerId = connectedWorkers[workerIdx].id;
      const existing = workerAssignments.get(workerId) || [];
      existing.push({ originalIndex: i, group: requestGroups[i] });
      workerAssignments.set(workerId, existing);
    }

    // Execute in parallel, preserving original group indices in results
    const resultsByOriginalIndex: Map<number, T[]> = new Map();
    const workerPromises: Promise<void>[] = [];

    for (const [workerId, assignments] of workerAssignments) {
      const worker = connectedWorkers.find(w => w.id === workerId);
      if (!worker) continue;

      const workerPromise = (async () => {
        for (const { originalIndex, group } of assignments) {
          try {
            const result = await this.executeWithWorker<T>(worker, group);
            resultsByOriginalIndex.set(originalIndex, result);
          } catch (error) {
            logError(`Worker ${worker.id} failed for group ${originalIndex}:`, error);
            resultsByOriginalIndex.set(originalIndex, []);
          }
        }
      })();

      workerPromises.push(workerPromise);
    }

    // Wait for all workers to complete
    await Promise.all(workerPromises);

    // Reconstruct ordered results from the map
    const allResults: T[][] = [];
    for (let i = 0; i < requestGroups.length; i++) {
      allResults.push(resultsByOriginalIndex.get(i) || []);
    }

    const elapsed = Date.now() - startTime;
    log(`parallelBatch completed in ${elapsed}ms`);

    return allResults;
  }

  /**
   * Race a request across all workers - returns first successful response.
   * Useful for critical queries where speed matters most.
   */
  async raceRequest<T>(request: BatchRequest): Promise<T> {
    if (!this.isInitialized || this.workers.length === 0) {
      await this.initialize();
    }

    const connectedWorkers = this.workers.filter(w => w.isConnected);
    if (connectedWorkers.length === 0) {
      throw new Error('No workers available');
    }

    log(`raceRequest across ${connectedWorkers.length} workers`);

    // Race all workers
    return Promise.any(
      connectedWorkers.map(async (worker) => {
        const results = await this.executeWithWorker<T>(worker, [request]);
        return results[0];
      })
    );
  }

  /**
   * Execute requests with automatic chunking and parallel distribution.
   * Splits large request arrays into chunks and distributes across workers.
   *
   * @param requests - Array of requests to execute
   * @param chunkSize - Size of each chunk (default 50)
   * @returns Flattened array of all results
   */
  async distributedBatch<T>(
    requests: BatchRequest[],
    chunkSize: number = 50
  ): Promise<T[]> {
    if (requests.length === 0) {
      return [];
    }

    // Split into chunks
    const chunks: BatchRequest[][] = [];
    for (let i = 0; i < requests.length; i += chunkSize) {
      chunks.push(requests.slice(i, i + chunkSize));
    }

    log(`distributedBatch: ${requests.length} requests in ${chunks.length} chunks`);

    // Execute chunks in parallel
    const chunkResults = await this.parallelBatch<T>(chunks);

    // Flatten results
    return chunkResults.flat();
  }

  /**
   * Shutdown the pool and disconnect all workers.
   */
  shutdown(): void {
    log('Shutting down pool...');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    for (const worker of this.workers) {
      try {
        worker.client.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
    }

    this.workers = [];
    this.isInitialized = false;
    this.usedServerIndices.clear();

    log('Pool shutdown complete');
  }

  /**
   * Get pool statistics.
   */
  getStats(): {
    workerCount: number;
    connectedCount: number;
    totalSuccess: number;
    totalFail: number;
    avgLatency: number;
  } {
    const connected = this.workers.filter(w => w.isConnected).length;
    const totalSuccess = this.workers.reduce((sum, w) => sum + w.successCount, 0);
    const totalFail = this.workers.reduce((sum, w) => sum + w.failCount, 0);
    const avgLatency = this.workers.length > 0
      ? this.workers.reduce((sum, w) => sum + w.avgLatency, 0) / this.workers.length
      : 0;

    return {
      workerCount: this.workers.length,
      connectedCount: connected,
      totalSuccess,
      totalFail,
      avgLatency: Math.round(avgLatency),
    };
  }

  /**
   * Check if pool is ready for use.
   */
  isReady(): boolean {
    return this.isInitialized && this.workers.filter(w => w.isConnected).length >= MIN_WORKER_COUNT;
  }

  /**
   * Shutdown all pool instances.
   */
  static shutdownAll(): void {
    for (const [network, pool] of this._instances) {
      log(`Shutting down ${network} pool`);
      pool.shutdown();
    }
    this._instances.clear();
  }
}

export default ElectrumPool;
