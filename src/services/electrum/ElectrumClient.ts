/**
 * ElectrumClient - TCP/TLS-based Electrum Protocol Client
 *
 * Manages TCP/TLS connections to Electrum servers with:
 * - Smart server selection: races multiple servers in parallel, picks fastest
 * - Persistent best-server caching: remembers which server works best
 * - Automatic failover: switches to next server on timeout/error
 * - Batch request support using JSON array format (Electrum protocol standard)
 * - Keepalive ping to prevent idle connection drops
 * - Subscription support for real-time updates
 *
 * Based on patterns from BlueWallet's rn-electrum-client and Muun's recovery tool.
 * Requires react-native-tcp-socket native module (development build)
 */

import TcpSocket from 'react-native-tcp-socket';
import type {
  ElectrumServerInfo,
  ElectrumRequest,
  ElectrumResponse,
  ElectrumHeader,
  ConnectionState,
} from './types';
import servers from './servers.json';
import { ServerCacheManager } from './ServerCacheManager';
import { SyncLogger } from '../SyncLogger';
import { logger } from '../../utils/logger';

// Debug flag — disable to reduce log noise
const DEBUG = false;
const log = (...args: any[]) => DEBUG && console.log('[Electrum]', ...args);
// Use console.warn instead of console.error to avoid triggering React Native's red error overlay
const logError = (...args: any[]) => __DEV__ && console.warn('[Electrum ERROR]', ...args);

const CONNECTION_TIMEOUT = 5000; // 5 seconds for individual connection attempt (was 8s)
const REQUEST_TIMEOUT = 15000; // 15 seconds for individual requests
const BATCH_REQUEST_TIMEOUT = 20000; // 20 seconds base for batch requests
const KEEPALIVE_INTERVAL = 20000; // 20 seconds keepalive ping (reduced from 30s for stability)
const PROTOCOL_VERSION = '1.4';
const CLIENT_NAME = 'bitcoin-wallet-rn';
const MAX_BATCH_SIZE = 50; // Max requests per batch chunk
const BATCH_CHUNK_DELAY = 25; // 25ms delay between chunks (was 50ms)
const RACE_COUNT = 5; // Number of servers to race in parallel
const SERVER_FAIL_COOLDOWN = 60000; // 1 minute cooldown for failed servers
const HEDGED_DIAL_STAGGER = 600; // 600ms between hedged connection attempts (was 1500ms)
const TOTAL_CONNECT_BUDGET = 8000; // 8s max for all connection phases combined (was 12s)
const MAX_CONCURRENT_REQUESTS = 30; // Request queue concurrency limit (was 10)
const MAX_QUEUE_SIZE = 500; // Maximum queued requests before dropping oldest
const MAX_AUTO_RECONNECT_ATTEMPTS = 5; // Max auto-reconnect attempts before giving up
const AUTO_RECONNECT_BASE_DELAY = 1000; // Base delay for exponential backoff (1s)
const AUTO_RECONNECT_MAX_DELAY = 15000; // Max delay between reconnects (15s)
const MAX_BLOCK_LAG = 2; // Reject servers more than 2 blocks behind best known tip

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ServerScore {
  host: string;
  port: number;
  latency: number;
  lastSuccess: number;
  failCount: number;
  lastFail: number;
}

/** Request waiting in the queue before being sent to the socket */
interface QueuedRequest {
  id: number;
  method: string;
  params: any[];
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
  enqueuedAt: number;
  retryCount: number;
}

/** Valid state transitions for the connection state machine */
const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  disconnected: ['connecting'],
  connecting: ['handshaking', 'error', 'disconnected'],
  handshaking: ['ready', 'error', 'disconnected'],
  ready: ['draining', 'error', 'disconnected'],
  draining: ['disconnected', 'error'],
  error: ['disconnected', 'error'], // Allow staying in error state (multiple errors can occur)
};

export class ElectrumClient {
  private socket: any = null;
  private serverList: ElectrumServerInfo[];
  private connectionState: ConnectionState = 'disconnected';
  private requestId: number = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private buffer: string = '';
  private network: 'mainnet' | 'testnet';
  private subscriptions: Map<string, (params: any[]) => void> = new Map();
  // Per-scripthash subscription callbacks (keyed by scripthash, not method)
  private scripthashCallbacks: Map<string, (status: string | null) => void> = new Map();
  // Header subscription callback
  private headerCallback: ((header: ElectrumHeader) => void) | null = null;
  // Reconnect callbacks — fired after successful auto-reconnect
  private reconnectCallbacks: Set<() => void> = new Set();
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  // Keepalive
  private keepAliveTimer: ReturnType<typeof setTimeout> | null = null;

  // Smart server tracking
  private currentServer: ElectrumServerInfo | null = null;
  private serverScores: Map<string, ServerScore> = new Map();
  private consecutiveTimeouts: number = 0;
  private static _bestServers: Map<string, string> = new Map(); // network → "host:port"
  private static _bestKnownHeight: number = 0; // Highest block height seen across all connections

  // Server implementation detection (e.g., 'electrs-esplora', 'ElectrumX', 'Fulcrum')
  // electrs < 0.9.0 does NOT support JSON array batch requests
  private serverImplementation: string = '';
  private supportsBatchArray: boolean = false;

  // Request queue with concurrency limit
  private requestQueue: QueuedRequest[] = [];
  private activeRequestCount: number = 0;

  // Auto-reconnect state
  private autoReconnectAttempts: number = 0;
  private autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect: boolean = false;
  private lastConnectedAt: number = 0;
  private lastDisconnectedAt: number = 0;

  constructor(network: 'mainnet' | 'testnet' = 'mainnet') {
    this.network = network;
    log('Creating ElectrumClient for network:', network);
    this.serverList = this.parseServerList(servers as string[]);
    log('Parsed', this.serverList.length, 'servers');
  }

  private parseServerList(serverStrings: string[]): ElectrumServerInfo[] {
    return serverStrings.map(s => {
      const [host, portStr] = s.split(':');
      const port = parseInt(portStr, 10);
      return {
        host,
        port,
        ssl: port === 50002 || port === 50006,
      };
    });
  }

  private serverKey(server: ElectrumServerInfo): string {
    return `${server.host}:${server.port}`;
  }

  /**
   * Enforce state machine transitions. Logs and rejects invalid transitions.
   */
  private transitionTo(newState: ConnectionState): void {
    const allowed = VALID_TRANSITIONS[this.connectionState];
    if (!allowed?.includes(newState)) {
      logError(`Invalid state transition: ${this.connectionState} -> ${newState} (server: ${this.currentServer ? this.serverKey(this.currentServer) : 'none'})`);
      SyncLogger.error('electrum', `Invalid state transition: ${this.connectionState} → ${newState}`);
      return;
    }
    const server = this.currentServer ? this.serverKey(this.currentServer) : 'none';
    log(`State: ${this.connectionState} -> ${newState} (server: ${server})`);
    if (newState === 'error' || newState === 'disconnected') {
      SyncLogger.warn('electrum', `State: ${this.connectionState} → ${newState} (server: ${server})`);
    }
    this.connectionState = newState;
  }

  // ============================================
  // Keepalive
  // ============================================

  /**
   * Reset the keepalive timer. Called after every successful activity.
   * Pings the server after KEEPALIVE_INTERVAL of inactivity to prevent drops.
   */
  private resetKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.keepAliveTimer = setTimeout(() => this.sendKeepAlive(), KEEPALIVE_INTERVAL);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private async sendKeepAlive(): Promise<void> {
    if (this.connectionState !== 'ready') {
      log('keepAlive: not ready (state:', this.connectionState, '), skipping ping');
      return;
    }
    const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
    try {
      log(`keepAlive: pinging ${server}...`);
      const pingStart = Date.now();
      await this.ping();
      const pingMs = Date.now() - pingStart;
      log(`keepAlive: ping OK (${pingMs}ms) on ${server}`);
      SyncLogger.log('electrum', `Keepalive ping OK (${pingMs}ms) on ${server}`);
      this.autoReconnectAttempts = 0; // Reset on successful ping
      this.resetKeepAlive();
    } catch (e: any) {
      logError(`keepAlive: ping FAILED on ${server}:`, e?.message || e);
      SyncLogger.error('electrum', `Keepalive ping failed on ${server}: ${e?.message || e}`);
      this.stopKeepAlive();
      // Trigger auto-reconnect (the socket close handler or this will handle it)
      this.scheduleAutoReconnect('keepalive_failure');
    }
  }

  // ============================================
  // Auto-Reconnect with Exponential Backoff
  // ============================================

  /**
   * Schedule an automatic reconnection attempt with exponential backoff.
   * Called when:
   * - Socket closes unexpectedly (while in 'ready' state)
   * - Keepalive ping fails
   * - Connection is lost during active use
   */
  private scheduleAutoReconnect(reason: string): void {
    // Don't reconnect if this was an intentional disconnect
    if (this.intentionalDisconnect) {
      log(`autoReconnect: skipping — intentional disconnect (reason: ${reason})`);
      SyncLogger.log('electrum', `Auto-reconnect skipped — intentional disconnect`);
      return;
    }

    // Don't reconnect if already connecting
    if (this.isConnecting) {
      log(`autoReconnect: skipping — already connecting (reason: ${reason})`);
      return;
    }

    // Don't reconnect if max attempts reached
    if (this.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS) {
      logError(`autoReconnect: giving up after ${this.autoReconnectAttempts} attempts (reason: ${reason})`);
      SyncLogger.error('electrum', `Auto-reconnect gave up after ${this.autoReconnectAttempts} attempts (${reason})`);
      this.autoReconnectAttempts = 0; // Reset for next time
      return;
    }

    // Cancel any pending reconnect timer
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 15s (capped)
    const delay = Math.min(
      AUTO_RECONNECT_BASE_DELAY * Math.pow(2, this.autoReconnectAttempts),
      AUTO_RECONNECT_MAX_DELAY,
    );
    this.autoReconnectAttempts++;

    log(`autoReconnect: scheduling attempt ${this.autoReconnectAttempts}/${MAX_AUTO_RECONNECT_ATTEMPTS} in ${delay}ms (reason: ${reason})`);
    SyncLogger.warn('electrum', `Auto-reconnect #${this.autoReconnectAttempts} in ${delay}ms (${reason})`);

    this.autoReconnectTimer = setTimeout(async () => {
      this.autoReconnectTimer = null;

      // Double check we still need to reconnect
      if (this.connectionState === 'ready') {
        log('autoReconnect: already connected, cancelling');
        this.autoReconnectAttempts = 0;
        return;
      }

      if (this.intentionalDisconnect) {
        log('autoReconnect: intentional disconnect flag set, cancelling');
        return;
      }

      const attemptNum = this.autoReconnectAttempts;
      log(`autoReconnect: attempt ${attemptNum}/${MAX_AUTO_RECONNECT_ATTEMPTS} starting...`);
      SyncLogger.log('electrum', `Auto-reconnect attempt ${attemptNum} starting...`);

      try {
        // Cleanup old socket state
        this.cleanupSocket();
        if (this.connectionState === 'error') {
          this.transitionTo('disconnected');
        }
        if (this.connectionState !== 'disconnected') {
          this.connectionState = 'disconnected'; // Force reset
        }

        await this.connect();

        log(`autoReconnect: SUCCESS on attempt ${attemptNum} — connected to ${this.currentServer ? this.serverKey(this.currentServer) : 'unknown'}`);
        SyncLogger.log('electrum', `Auto-reconnect succeeded on attempt ${attemptNum} — ${this.currentServer ? this.serverKey(this.currentServer) : 'unknown'}`);
        this.autoReconnectAttempts = 0;

        // Fire reconnect callbacks so SubscriptionManager can re-subscribe
        for (const cb of this.reconnectCallbacks) {
          try { cb(); } catch (e) { logError('reconnect callback error:', e); }
        }
      } catch (err: any) {
        logError(`autoReconnect: attempt ${attemptNum} FAILED:`, err?.message || err);
        SyncLogger.error('electrum', `Auto-reconnect attempt ${attemptNum} failed: ${err?.message || err}`);
        // Schedule next attempt
        this.scheduleAutoReconnect(reason);
      }
    }, delay);
  }

  /**
   * Cancel any pending auto-reconnect timer.
   */
  private cancelAutoReconnect(): void {
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }
  }

  // ============================================
  // Server Scoring
  // ============================================

  /**
   * Get servers sorted by score (best first), excluding recently failed ones.
   */
  private getSortedServers(): ElectrumServerInfo[] {
    const now = Date.now();
    const cachedBest = ElectrumClient._bestServers.get(this.network);

    return [...this.serverList].sort((a, b) => {
      const keyA = this.serverKey(a);
      const keyB = this.serverKey(b);

      // Cached best server always goes first
      if (cachedBest === keyA) return -1;
      if (cachedBest === keyB) return 1;

      const scoreA = this.serverScores.get(keyA);
      const scoreB = this.serverScores.get(keyB);

      // Deprioritize recently failed servers
      const aFailed = scoreA && scoreA.lastFail > 0 && (now - scoreA.lastFail) < SERVER_FAIL_COOLDOWN;
      const bFailed = scoreB && scoreB.lastFail > 0 && (now - scoreB.lastFail) < SERVER_FAIL_COOLDOWN;
      if (aFailed && !bFailed) return 1;
      if (!aFailed && bFailed) return -1;

      // Sort by latency (known good servers first)
      const latA = scoreA?.latency ?? Infinity;
      const latB = scoreB?.latency ?? Infinity;
      return latA - latB;
    });
  }

  private markServerSuccess(server: ElectrumServerInfo, latency: number): void {
    const key = this.serverKey(server);
    const existing = this.serverScores.get(key);
    const prevLatency = existing?.latency ?? Infinity;
    this.serverScores.set(key, {
      host: server.host,
      port: server.port,
      latency: prevLatency === Infinity ? latency : Math.round((prevLatency + latency) / 2),
      lastSuccess: Date.now(),
      failCount: 0,
      lastFail: existing?.lastFail ?? 0,
    });
    ElectrumClient._bestServers.set(this.network, key);
    this.consecutiveTimeouts = 0;

    // Delegate to persistent ccache
    ServerCacheManager.shared().recordSuccess(server.host, server.port, latency, {
      supportsBatchArray: this.supportsBatchArray,
      serverImpl: this.serverImplementation || undefined,
    });
  }

  private markServerFail(server: ElectrumServerInfo, error?: any): void {
    const key = this.serverKey(server);
    const existing = this.serverScores.get(key);
    this.serverScores.set(key, {
      host: server.host,
      port: server.port,
      latency: existing?.latency ?? Infinity,
      lastSuccess: existing?.lastSuccess ?? 0,
      failCount: (existing?.failCount ?? 0) + 1,
      lastFail: Date.now(),
    });
    if (ElectrumClient._bestServers.get(this.network) === key) {
      ElectrumClient._bestServers.delete(this.network);
    }

    // Delegate to persistent ccache with error classification
    ServerCacheManager.shared().recordFailure(server.host, server.port, error);
  }

  // ============================================
  // Connection Management
  // ============================================

  /**
   * Connect to the best available Electrum server.
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'ready') {
      log('connect(): already connected to', this.currentServer ? this.serverKey(this.currentServer) : 'unknown');
      return;
    }

    if (this.isConnecting && this.connectionPromise) {
      log('connect(): already connecting, waiting...');
      return this.connectionPromise;
    }

    log('connect(): starting connection...');
    logger.perfStart('electrum-connect');
    SyncLogger.log('electrum', 'Connecting to Electrum server...');
    this.isConnecting = true;
    this.intentionalDisconnect = false; // Clear flag on explicit connect
    this.cancelAutoReconnect(); // Cancel any pending auto-reconnect
    this.transitionTo('connecting');
    this.connectionPromise = this.doConnect();

    try {
      await this.connectionPromise;
      this.lastConnectedAt = Date.now();
      this.autoReconnectAttempts = 0; // Reset on successful connect
      logger.perfEnd('electrum-connect');
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Connect with hedged dialing and total budget.
   * Phase 1: Hedged dial — top 3 from cache, staggered 1.5s apart, 5s budget
   * Phase 2: Race — RACE_COUNT servers, remaining budget
   * Phase 3: Sequential fallback — remaining budget
   * Total budget: TOTAL_CONNECT_BUDGET (12s)
   */
  private async doConnect(): Promise<void> {
    // Ensure server cache is loaded before selecting servers
    const ccache = await ServerCacheManager.initialize();
    const triedKeys: string[] = [];
    const budgetStart = Date.now();
    const budgetRemaining = () => Math.max(0, TOTAL_CONNECT_BUDGET - (Date.now() - budgetStart));

    // ── Phase 1: Hedged Dial (top 3 from cache, 5s budget) ──
    const hedgeBudget = Math.min(5000, TOTAL_CONNECT_BUDGET);
    const topCandidates = ccache.getTopServersForColdStart(3);
    if (topCandidates.length > 0) {
      for (const c of topCandidates) triedKeys.push(this.serverKey(c));
      log(`doConnect() Phase 1: hedged dial with ${topCandidates.length} candidates: ${topCandidates.map(s => this.serverKey(s)).join(', ')}`);

      const hedgeResult = await this.hedgedDial(topCandidates, hedgeBudget);
      if (hedgeResult) {
        const key = this.serverKey(hedgeResult.server);
        log(`doConnect() Phase 1: hedged winner ${key} in ${hedgeResult.latency}ms, handshaking...`);
        this.currentServer = hedgeResult.server;
        this.socket = hedgeResult.socket;
        // Async socket events may have disrupted state — ensure we're in 'connecting' before handshake
        if (this.connectionState !== 'connecting') {
          if (this.connectionState === 'error') this.transitionTo('disconnected');
          if (this.connectionState === 'disconnected') this.transitionTo('connecting');
        }
        this.transitionTo('handshaking');
        this.configureSocket(hedgeResult.socket);
        this.setupSocketHandlers(hedgeResult.socket);

        try {
          const version = await this.serverVersion();
          this.transitionTo('ready');
          const tipHeight = await this.validateBlockHeight(key);
          this.markServerSuccess(hedgeResult.server, hedgeResult.latency);
          this.resetKeepAlive();
          log(`doConnect() Phase 1: connected to ${key}, version: ${JSON.stringify(version)}, tip: ${tipHeight}`);
          SyncLogger.log('electrum', `Connected (hedged) to ${key} in ${hedgeResult.latency}ms, tip: ${tipHeight}`);
          return;
        } catch (e: any) {
          logError(`doConnect() Phase 1: handshake/validation failed for ${key}:`, e?.message || e);
          SyncLogger.warn('electrum', `Hedged handshake failed for ${key}: ${e?.message || e}`);
          this.markServerFail(hedgeResult.server, e);
          this.cleanupSocket();
          this.transitionTo('error');
          this.transitionTo('disconnected');
          this.transitionTo('connecting');
        }
      } else {
        log('doConnect() Phase 1: all hedged candidates failed');
      }
    }

    // ── Phase 2: Race (RACE_COUNT servers, remaining budget) ──
    const phase2Budget = budgetRemaining();
    if (phase2Budget > 2000) {
      const candidates = ccache.selectServersForRace(RACE_COUNT, triedKeys);
      for (const c of candidates) triedKeys.push(this.serverKey(c));
      log(`doConnect() Phase 2: racing ${candidates.length} candidates, budget: ${phase2Budget}ms`);

      const raceResult = await this.raceServers(candidates, phase2Budget);
      if (raceResult) {
        const key = this.serverKey(raceResult.server);
        log(`doConnect() Phase 2: race winner ${key} in ${raceResult.latency}ms`);
        this.currentServer = raceResult.server;
        this.socket = raceResult.socket;
        if (this.connectionState !== 'connecting') {
          if (this.connectionState === 'error') this.transitionTo('disconnected');
          if (this.connectionState === 'disconnected') this.transitionTo('connecting');
        }
        this.transitionTo('handshaking');
        this.configureSocket(raceResult.socket);
        this.setupSocketHandlers(raceResult.socket);

        try {
          const version = await this.serverVersion();
          this.transitionTo('ready');
          const tipHeight = await this.validateBlockHeight(key);
          this.markServerSuccess(raceResult.server, raceResult.latency);
          this.resetKeepAlive();
          log(`doConnect() Phase 2: connected to ${key}, version: ${JSON.stringify(version)}, tip: ${tipHeight}`);
          SyncLogger.log('electrum', `Connected (race) to ${key} in ${raceResult.latency}ms, tip: ${tipHeight}`);
          return;
        } catch (e: any) {
          logError(`doConnect() Phase 2: handshake/validation failed for ${key}:`, e?.message || e);
          SyncLogger.warn('electrum', `Race handshake failed for ${key}: ${e?.message || e}`);
          this.markServerFail(raceResult.server, e);
          this.cleanupSocket();
          this.transitionTo('error');
          this.transitionTo('disconnected');
          this.transitionTo('connecting');
        }
      } else {
        log('doConnect() Phase 2: all race candidates failed');
      }
    }

    // ── Phase 3: Sequential fallback (remaining budget) ──
    const MAX_SEQUENTIAL_ATTEMPTS = 5;
    for (let i = 0; i < MAX_SEQUENTIAL_ATTEMPTS; i++) {
      const remaining = budgetRemaining();
      if (remaining < 1500) {
        log(`doConnect() Phase 3: budget exhausted (${remaining}ms left), giving up`);
        break;
      }

      const server = ccache.selectServer(triedKeys);
      if (!server) break;

      const key = this.serverKey(server);
      triedKeys.push(key);
      log(`doConnect() Phase 3: sequential attempt ${i + 1} → ${key}, budget: ${remaining}ms`);

      try {
        const start = Date.now();
        await this.connectToServer(server);
        if (this.connectionState !== 'connecting') {
          if (this.connectionState === 'error') this.transitionTo('disconnected');
          if (this.connectionState === 'disconnected') this.transitionTo('connecting');
        }
        this.transitionTo('handshaking');
        await this.serverVersion();
        this.transitionTo('ready');
        const tipHeight = await this.validateBlockHeight(key);
        this.currentServer = server;
        this.markServerSuccess(server, Date.now() - start);
        this.resetKeepAlive();
        log(`doConnect() Phase 3: connected to ${key} in ${Date.now() - start}ms, tip: ${tipHeight}`);
        SyncLogger.log('electrum', `Connected (sequential) to ${key} in ${Date.now() - start}ms, tip: ${tipHeight}`);
        return;
      } catch (e: any) {
        this.markServerFail(server, e);
        SyncLogger.warn('electrum', `Sequential attempt ${key} failed: ${e?.message || e}`);
        this.cleanupSocket();
        this.transitionTo('error');
        this.transitionTo('disconnected');
        this.transitionTo('connecting');
        continue;
      }
    }

    const elapsed = Date.now() - budgetStart;
    this.transitionTo('error');
    SyncLogger.error('electrum', `ALL connection attempts failed — tried ${triedKeys.length} servers in ${elapsed}ms`);
    throw new Error(`Failed to connect to any Electrum server (tried ${triedKeys.length} servers in ${elapsed}ms)`);
  }

  /**
   * Hedged dial: launch connections staggered HEDGED_DIAL_STAGGER apart.
   * First TCP/TLS connect wins; losers are destroyed immediately.
   */
  private hedgedDial(
    candidates: ElectrumServerInfo[],
    budget: number,
  ): Promise<{ server: ElectrumServerInfo; socket: any; latency: number } | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const sockets: any[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];

      const cleanup = (winnerSocket?: any) => {
        for (const t of timers) clearTimeout(t);
        for (const s of sockets) {
          if (s !== winnerSocket) {
            try { s.destroy(); } catch {}
          }
        }
      };

      // Overall budget timeout
      const budgetTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          log(`hedgedDial: budget exhausted (${budget}ms)`);
          cleanup();
          resolve(null);
        }
      }, budget);
      timers.push(budgetTimer);

      // Launch candidates staggered by HEDGED_DIAL_STAGGER
      candidates.forEach((server, idx) => {
        const launchDelay = idx * HEDGED_DIAL_STAGGER;
        const launchTimer = setTimeout(() => {
          if (resolved) return;

          const start = Date.now();
          const key = `${server.host}:${server.port}`;
          log(`hedgedDial: launching candidate ${idx + 1}/${candidates.length} → ${key} (stagger: ${launchDelay}ms)`);

          try {
            const options: any = { host: server.host, port: server.port };
            let sock: any;

            const onConnect = () => {
              if (resolved) {
                try { sock.destroy(); } catch {}
                return;
              }
              resolved = true;
              const latency = Date.now() - start;
              log(`hedgedDial: winner → ${key} in ${latency}ms`);
              cleanup(sock);
              resolve({ server, socket: sock, latency });
            };

            if (server.ssl) {
              sock = TcpSocket.connectTLS(options, onConnect);
            } else {
              sock = TcpSocket.createConnection(options, onConnect);
            }

            sockets.push(sock);
            sock.on('error', (err: any) => {
              log(`hedgedDial: ${key} error: ${err?.message || err}`);
            });

            // Per-server timeout (shorter than budget)
            const perTimeout = setTimeout(() => {
              if (!resolved) {
                try { sock.destroy(); } catch {}
              }
            }, Math.min(CONNECTION_TIMEOUT, budget - launchDelay));
            timers.push(perTimeout);
          } catch {
            // Skip this server
          }
        }, launchDelay);
        timers.push(launchTimer);
      });
    });
  }

  /**
   * Race multiple servers — return the first that connects.
   * @param budget - Total time budget for the race (default: CONNECTION_TIMEOUT + 2000)
   */
  private raceServers(
    candidates: ElectrumServerInfo[],
    budget: number = CONNECTION_TIMEOUT + 2000,
  ): Promise<{ server: ElectrumServerInfo; socket: any; latency: number } | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const sockets: any[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];

      const cleanup = (winnerSocket?: any) => {
        for (const s of sockets) {
          if (s !== winnerSocket) {
            try { s.destroy(); } catch {}
          }
        }
        for (const t of timers) clearTimeout(t);
      };

      const raceTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, budget);
      timers.push(raceTimeout);

      for (const server of candidates) {
        const start = Date.now();
        try {
          const options: any = { host: server.host, port: server.port };
          let sock: any;

          const onConnect = () => {
            if (resolved) {
              try { sock.destroy(); } catch {}
              return;
            }
            resolved = true;
            cleanup(sock);
            resolve({ server, socket: sock, latency: Date.now() - start });
          };

          if (server.ssl) {
            sock = TcpSocket.connectTLS(options, onConnect);
          } else {
            sock = TcpSocket.createConnection(options, onConnect);
          }

          sockets.push(sock);
          sock.on('error', () => { /* ignore — race timeout handles total failure */ });

          const perServerTimeout = setTimeout(() => {
            if (!resolved) {
              try { sock.destroy(); } catch {}
            }
          }, CONNECTION_TIMEOUT);
          timers.push(perServerTimeout);
        } catch {
          // Skip this server
        }
      }
    });
  }

  /**
   * Configure socket options for reliability (based on BlueWallet's approach).
   * - setKeepAlive: TCP-level keepalive to detect dead connections
   * - setNoDelay: Disable Nagle's algorithm for faster small writes
   */
  private configureSocket(socket: any): void {
    try {
      if (typeof socket.setKeepAlive === 'function') {
        socket.setKeepAlive(true, 0);
      }
      if (typeof socket.setNoDelay === 'function') {
        socket.setNoDelay(true);
      }
      log('configureSocket: keepAlive=true, noDelay=true');
    } catch (e: any) {
      log('configureSocket: some options not supported:', e?.message);
    }
  }

  private setupSocketHandlers(socket: any): void {
    socket.on('data', (data: Buffer | string) => {
      const dataStr = data.toString();
      this.handleData(dataStr);
    });

    socket.on('error', (error: any) => {
      const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
      const errorMsg = error?.message || error?.toString?.() || 'Unknown socket error';
      const errorCode = error?.code || 'UNKNOWN';
      logError(`socket.error on ${server} [${errorCode}]:`, errorMsg);
      SyncLogger.error('electrum', `Socket error on ${server} [${errorCode}]: ${errorMsg}`);
      this.transitionTo('error');
      this.stopKeepAlive();
    });

    socket.on('close', (hadError: boolean) => {
      const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
      const prevState = this.connectionState;
      const uptime = this.lastConnectedAt > 0 ? Math.round((Date.now() - this.lastConnectedAt) / 1000) : 0;
      log(`socket.close on ${server}, state was: ${prevState}, hadError: ${hadError}, uptime: ${uptime}s`);
      SyncLogger.warn('electrum', `Socket closed on ${server} (state: ${prevState}, hadError: ${hadError}, uptime: ${uptime}s)`);

      this.lastDisconnectedAt = Date.now();
      this.stopKeepAlive();

      if (prevState === 'ready' || prevState === 'handshaking') {
        this.transitionTo('disconnected');
        this.handleDisconnect();

        // Auto-reconnect if this was an unexpected close (not intentional)
        if (!this.intentionalDisconnect) {
          log(`socket.close: unexpected disconnect from ${server} — scheduling auto-reconnect`);
          SyncLogger.warn('electrum', `Unexpected disconnect from ${server} — auto-reconnecting`);
          this.scheduleAutoReconnect('socket_close');
        }
      }
    });
  }

  private connectToServer(server: ElectrumServerInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanupSocket();
        reject(new Error('Connection timeout'));
      }, CONNECTION_TIMEOUT);

      try {
        const options: any = { host: server.host, port: server.port };

        if (server.ssl) {
          this.socket = TcpSocket.connectTLS(options, () => {
            clearTimeout(timeout);
            this.configureSocket(this.socket);
            resolve();
          });
        } else {
          this.socket = TcpSocket.createConnection(options, () => {
            clearTimeout(timeout);
            this.configureSocket(this.socket);
            resolve();
          });
        }

        this.setupSocketHandlers(this.socket);
      } catch (error: any) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private cleanupSocket(): void {
    this.stopKeepAlive();
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }
    this.buffer = '';
  }

  // ============================================
  // Data Handling — supports both individual and array responses
  // ============================================

  private handleData(data: string): void {
    this.buffer += data;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          // Handle both array responses (from batch) and individual responses
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              this.handleSingleResponse(item);
            }
          } else {
            this.handleSingleResponse(parsed);
          }
        } catch (e) {
          logError('Failed to parse response:', e);
        }
      }
    }
  }

  /**
   * Handle a single JSON-RPC response (either from individual request or batch array).
   */
  private handleSingleResponse(response: ElectrumResponse | { method: string; params: any[] }): void {
    // Subscription notification (no id)
    if ('method' in response && !('id' in response)) {
      const method = (response as { method: string; params: any[] }).method;
      const params = (response as { method: string; params: any[] }).params;

      // Route scripthash notifications to per-scripthash callback
      if (method === 'blockchain.scripthash.subscribe' && params.length >= 2) {
        const scripthash = params[0] as string;
        const status = params[1] as string | null;
        const cb = this.scripthashCallbacks.get(scripthash);
        if (cb) {
          log(`Scripthash notification: ${scripthash.slice(0, 12)}... → status changed`);
          cb(status);
        }
        return;
      }

      // Route header notifications to header callback
      if (method === 'blockchain.headers.subscribe' && this.headerCallback) {
        const header = params[0] as ElectrumHeader;
        if (header) {
          log(`Header notification: height ${header.height}`);
          this.headerCallback(header);
        }
        return;
      }

      // Legacy fallback: route to old subscriptions map
      const callback = this.subscriptions.get(method);
      if (callback) callback(params);
      return;
    }

    const resp = response as ElectrumResponse;
    const pending = this.pendingRequests.get(resp.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(resp.id);

      if (resp.error) {
        logError(`Server error for request #${resp.id}:`, JSON.stringify(resp.error));
        pending.reject(new Error(resp.error.message));
      } else {
        pending.resolve(resp.result);
      }
    }
  }

  private handleDisconnect(): void {
    const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
    const inFlight = this.pendingRequests.size;
    const queued = this.requestQueue.length;
    const uptime = this.lastConnectedAt > 0 ? Math.round((Date.now() - this.lastConnectedAt) / 1000) : 0;

    logError(`handleDisconnect: ${server} — ${inFlight} in-flight, ${queued} queued, uptime was ${uptime}s`);
    SyncLogger.error('electrum', `Connection lost to ${server} — ${inFlight} in-flight + ${queued} queued requests cancelled (uptime: ${uptime}s)`);

    // Cancel all in-flight requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Connection lost to ${server}`));
    }
    this.pendingRequests.clear();

    // Cancel all queued requests
    for (const queued of this.requestQueue) {
      if (!queued.cancelled) {
        queued.cancelled = true;
        queued.reject(new Error(`Connection lost to ${server}`));
      }
    }
    this.requestQueue = [];
    this.activeRequestCount = 0;

    this.buffer = '';
  }

  /**
   * Force reconnect to a different server.
   */
  private async reconnectToNextServer(error?: any): Promise<void> {
    const failedServer = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
    log(`reconnectToNextServer: failed server was ${failedServer}`);

    // Guard: prevent infinite reconnection loops
    const MAX_CONSECUTIVE_RECONNECTS = 3;
    if (this.consecutiveTimeouts >= MAX_CONSECUTIVE_RECONNECTS) {
      logError(`reconnectToNextServer: ${this.consecutiveTimeouts} consecutive failures — aborting to prevent loop`);
      SyncLogger.error('electrum', `Reconnect loop aborted after ${this.consecutiveTimeouts} consecutive failures`);
      throw new Error(`Electrum connection failed after ${this.consecutiveTimeouts} consecutive attempts`);
    }

    if (this.currentServer) {
      this.markServerFail(this.currentServer, error);
    }
    this.cleanupSocket();
    // Transition through error → disconnected to reset state machine
    if (this.connectionState !== 'disconnected' && this.connectionState !== 'error') {
      this.transitionTo('error');
    }
    if (this.connectionState === 'error') {
      this.transitionTo('disconnected');
    }
    this.currentServer = null;
    this.serverImplementation = '';
    this.supportsBatchArray = false;
    log('reconnectToNextServer: attempting fresh connect...');
    await this.connect();
    log(`reconnectToNextServer: now connected to ${this.currentServer ? this.serverKey(this.currentServer) : 'unknown'}`);
  }

  // ============================================
  // Request Methods
  // ============================================

  /**
   * Send a single request with concurrency limiting.
   * When MAX_CONCURRENT_REQUESTS are in-flight, additional requests queue.
   * Auto-retries on connection errors by switching servers.
   * @param retryCount - Internal retry counter (max 1 retry)
   */
  async request<T = any>(method: string, params: any[] = [], retryCount: number = 0): Promise<T> {
    // Allow requests during 'handshaking' (for serverVersion()) and 'ready' states.
    // During handshaking the socket is connected but protocol negotiation is in progress.
    // Calling connect() here while handshaking causes a deadlock because connect() waits
    // for doConnect() which waits for serverVersion() which calls request().
    if (this.connectionState !== 'ready' && this.connectionState !== 'handshaking') {
      await this.connect();
    }

    if (!this.socket) {
      throw new Error('Not connected to Electrum server');
    }

    // If at concurrency limit, queue the request
    if (this.activeRequestCount >= MAX_CONCURRENT_REQUESTS) {
      // Prevent unbounded queue growth — drop oldest requests if over limit
      if (this.requestQueue.length >= MAX_QUEUE_SIZE) {
        const dropped = this.requestQueue.shift()!;
        if (!dropped.cancelled) {
          dropped.cancelled = true;
          dropped.reject(new Error('Request queue overflow — oldest request dropped'));
        }
        logError(`request(): queue overflow (${MAX_QUEUE_SIZE}), dropped oldest: ${dropped.method}`);
      }

      // Silently queue — only log if queue is getting large
      if (this.requestQueue.length > 50) {
        log(`request(): queue growing (${this.requestQueue.length} queued, ${this.activeRequestCount} active)`);
      }
      return new Promise<T>((resolve, reject) => {
        this.requestQueue.push({
          id: 0, // assigned when dequeued
          method,
          params,
          resolve,
          reject,
          cancelled: false,
          enqueuedAt: Date.now(),
          retryCount,
        });
      });
    }

    return this.sendRequestImmediate<T>(method, params, retryCount);
  }

  /**
   * Send a request immediately to the socket (no queue check).
   * Called directly for requests under the concurrency limit,
   * and by drainQueue() for dequeued requests.
   */
  private async sendRequestImmediate<T = any>(method: string, params: any[], retryCount: number): Promise<T> {
    this.activeRequestCount++;
    const id = ++this.requestId;
    const request: ElectrumRequest = { id, method, params };
    const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';

    const requestStart = Date.now();

    try {
      const result = await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(id);
          logError(`Request TIMEOUT #${id}: ${method} on ${server} after ${Date.now() - requestStart}ms`);
          SyncLogger.error('electrum', `Request timeout: ${method} on ${server}`);
          reject(new Error(`Request timeout: ${method}`));
        }, REQUEST_TIMEOUT);

        this.pendingRequests.set(id, {
          resolve: (result: any) => {
            this.resetKeepAlive();
            resolve(result);
          },
          reject: (error: Error) => {
            reject(error);
          },
          timeout,
        });

        try {
          const payload = JSON.stringify(request) + '\n';
          this.socket.write(payload);
        } catch (error: any) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          logError(`Request write error #${id}: ${method}:`, error?.message || error);
          reject(error);
        }
      });

      this.consecutiveTimeouts = 0;
      return result;
    } catch (error: any) {
      // On any error, retry once on a different server (Muun pattern)
      if (retryCount === 0) {
        logError(`request() #${id}: "${error?.message}", switching server for retry...`);
        this.consecutiveTimeouts++;
        await this.reconnectToNextServer(error);
        return this.sendRequestImmediate<T>(method, params, 1);
      }
      throw error;
    } finally {
      this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
      this.drainQueue();
    }
  }

  /**
   * Dequeue and send requests up to the concurrency limit.
   */
  private drainQueue(): void {
    while (this.requestQueue.length > 0 && this.activeRequestCount < MAX_CONCURRENT_REQUESTS) {
      const queued = this.requestQueue.shift()!;
      if (queued.cancelled) continue;

      // Silently dequeue

      // Fire and forget — the queued promise resolve/reject handles the result
      this.sendRequestImmediate(queued.method, queued.params, queued.retryCount)
        .then(queued.resolve)
        .catch(queued.reject);
    }
  }

  /**
   * Send multiple requests in parallel. Auto-chunks large batches.
   * Uses JSON array format per Electrum protocol standard.
   * Retries on a different server if the batch times out.
   */
  async batchRequest<T = any>(
    requests: Array<{ method: string; params: any[] }>
  ): Promise<T[]> {
    if (requests.length === 0) return [];

    if (requests.length > MAX_BATCH_SIZE) {
      const allResults: T[] = [];
      for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
        const chunk = requests.slice(i, i + MAX_BATCH_SIZE);
        const chunkResults = await this._sendBatch<T>(chunk);
        allResults.push(...chunkResults);
        if (i + MAX_BATCH_SIZE < requests.length) {
          await new Promise(r => setTimeout(r, BATCH_CHUNK_DELAY));
        }
      }
      return allResults;
    }

    return this._sendBatch<T>(requests);
  }

  /**
   * Internal batch sender.
   * Format depends on server implementation:
   * - ElectrumX/Fulcrum: JSON array [{...},{...}]\n (standard batch)
   * - electrs < 0.9.0: individual messages {...}\n{...}\n (electrs closes connection on JSON arrays)
   * Retries once on a different server if timeout.
   */
  private async _sendBatch<T = any>(
    requests: Array<{ method: string; params: any[] }>,
    isRetry: boolean = false,
  ): Promise<T[]> {
    if (this.connectionState !== 'ready') {
      log(`_sendBatch: not ready (state=${this.connectionState}), reconnecting...`);
      await this.connect();
    }

    if (!this.socket) {
      throw new Error('Not connected to Electrum server');
    }

    const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
    const startId = this.requestId + 1;
    const individualRequests = requests.map((req, index) => ({
      id: startId + index,
      method: req.method,
      params: req.params,
    }));
    this.requestId += requests.length;

    // Adaptive timeout: base 20s + 200ms per request, capped at 30s
    const batchTimeout = Math.min(BATCH_REQUEST_TIMEOUT + requests.length * 200, 30000);

    // Log what we're sending
    const methodCounts = new Map<string, number>();
    for (const req of requests) {
      methodCounts.set(req.method, (methodCounts.get(req.method) || 0) + 1);
    }
    const methodSummary = Array.from(methodCounts.entries()).map(([m, c]) => `${m}×${c}`).join(', ');
    log(`_sendBatch: ${requests.length} requests [${methodSummary}] → ${server} (timeout: ${batchTimeout}ms${isRetry ? ', RETRY' : ''})`);
    const batchStart = Date.now();

    try {
      const results = await new Promise<T[]>((resolve, reject) => {
        const resultMap: Map<number, any> = new Map();
        const errorMap: Map<number, Error> = new Map();
        const expectedCount = requests.length;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            const elapsed = Date.now() - batchStart;
            logError(`Batch TIMEOUT after ${elapsed}ms on ${server}. Got ${resultMap.size}/${expectedCount}. [${methodSummary}]`);
            SyncLogger.error('electrum', `Batch timeout after ${elapsed}ms on ${server} (${resultMap.size}/${expectedCount})`);
            individualRequests.forEach(req => this.pendingRequests.delete(req.id));
            reject(new Error(`Batch request timeout after ${elapsed}ms for ${expectedCount} requests on ${server}`));
          }
        }, batchTimeout);

        const checkComplete = () => {
          if (resultMap.size + errorMap.size === expectedCount && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const elapsed = Date.now() - batchStart;

            if (errorMap.size > 0) {
              const firstError = errorMap.values().next().value;
              logError(`_sendBatch: completed in ${elapsed}ms with ${errorMap.size} errors on ${server}. First error:`, firstError?.message);
              reject(firstError);
              return;
            }

            log(`_sendBatch: SUCCESS — ${expectedCount} responses in ${elapsed}ms from ${server}`);
            this.resetKeepAlive();
            const orderedResults = individualRequests.map(r => resultMap.get(r.id));
            resolve(orderedResults as T[]);
          }
        };

        individualRequests.forEach((req) => {
          this.pendingRequests.set(req.id, {
            resolve: (result: any) => { resultMap.set(req.id, result); checkComplete(); },
            reject: (error: Error) => { errorMap.set(req.id, error); checkComplete(); },
            timeout,
          });
        });

        try {
          if (this.supportsBatchArray) {
            const batchPayload = JSON.stringify(individualRequests) + '\n';
            this.socket.write(batchPayload);
          } else {
            const messages = individualRequests.map(req => JSON.stringify(req) + '\n').join('');
            this.socket.write(messages);
          }
        } catch (error: any) {
          resolved = true;
          clearTimeout(timeout);
          individualRequests.forEach(req => this.pendingRequests.delete(req.id));
          logError(`_sendBatch: write error on ${server}:`, error?.message || error);
          reject(error);
        }
      });

      // Success
      this.consecutiveTimeouts = 0;
      if (this.currentServer) {
        this.markServerSuccess(this.currentServer, 0);
      }
      return results;
    } catch (error: any) {
      // On any connection/timeout error, switch server and retry once (Muun pattern)
      if (!isRetry) {
        const errMsg = error?.message || '';
        logError(`_sendBatch: error on ${server}: "${errMsg}", switching server for retry...`);
        this.consecutiveTimeouts++;
        await this.reconnectToNextServer(error);
        return this._sendBatch<T>(requests, true);
      }
      throw error;
    }
  }

  // ============================================
  // Subscriptions
  // ============================================

  /**
   * Subscribe to a single scripthash. Callback fires on every status change.
   * Returns the current status hash (or null if no history).
   */
  async subscribeScripthash(
    scripthash: string,
    callback: (status: string | null) => void,
  ): Promise<string | null> {
    this.scripthashCallbacks.set(scripthash, callback);
    return this.request<string | null>('blockchain.scripthash.subscribe', [scripthash]);
  }

  /**
   * Batch-subscribe to multiple scripthashes with a shared callback.
   * Callback receives (scripthash, status) on each change.
   * Returns array of initial statuses in same order as input.
   */
  async subscribeScripthashes(
    scripthashes: string[],
    callback: (scripthash: string, status: string | null) => void,
  ): Promise<(string | null)[]> {
    // Register per-scripthash callback
    for (const sh of scripthashes) {
      this.scripthashCallbacks.set(sh, (status) => callback(sh, status));
    }

    // Batch subscribe for speed
    const requests = scripthashes.map((sh) => ({
      method: 'blockchain.scripthash.subscribe' as const,
      params: [sh],
    }));

    const results = await this.batchRequest<string | null>(requests);
    return results;
  }

  /**
   * Subscribe to new block headers. Callback fires on each new block.
   * Returns the current tip header.
   */
  async subscribeHeaders(
    callback: (header: ElectrumHeader) => void,
  ): Promise<ElectrumHeader> {
    this.headerCallback = callback;
    return this.request<ElectrumHeader>('blockchain.headers.subscribe', []);
  }

  /**
   * Unsubscribe from a single scripthash.
   */
  async unsubscribeScripthash(scripthash: string): Promise<boolean> {
    this.scripthashCallbacks.delete(scripthash);
    return this.request<boolean>('blockchain.scripthash.unsubscribe', [scripthash]);
  }

  /**
   * Register a callback that fires after a successful auto-reconnect.
   * Used by SubscriptionManager to re-subscribe after connection loss.
   */
  onReconnect(callback: () => void): void {
    this.reconnectCallbacks.add(callback);
  }

  /**
   * Remove a reconnect callback.
   */
  offReconnect(callback: () => void): void {
    this.reconnectCallbacks.delete(callback);
  }

  /**
   * Clear all subscription callbacks (scripthash + headers).
   * Does NOT send unsubscribe requests to the server.
   */
  clearSubscriptions(): void {
    this.scripthashCallbacks.clear();
    this.headerCallback = null;
    this.subscriptions.clear();
  }

  /**
   * Get count of active scripthash subscriptions for diagnostics.
   */
  getSubscriptionCount(): number {
    return this.scripthashCallbacks.size;
  }

  // ============================================
  // Server Methods
  // ============================================

  /**
   * Negotiate protocol version with server
   */
  private async serverVersion(): Promise<[string, string]> {
    SyncLogger.log('electrum', 'Sending server.version handshake...');
    const result = await this.request<[string, string]>('server.version', [CLIENT_NAME, PROTOCOL_VERSION]);
    SyncLogger.log('electrum', `Handshake OK: ${result?.[0] || 'unknown'} (protocol ${result?.[1] || '?'})`);
    log('Server version:', result);

    // Detect server implementation to determine batch format support
    // result[0] is the server software string, e.g. "electrs-esplora 0.4.1", "ElectrumX 1.16.0", "Fulcrum 1.9.1"
    if (result && result[0]) {
      this.serverImplementation = result[0];
      const implLower = result[0].toLowerCase();

      if (implLower.startsWith('electrs')) {
        // electrs < 0.9.0 does NOT support JSON array batch
        // Parse version: "electrs-esplora 0.4.1" or "electrs 0.9.0"
        const versionMatch = result[0].match(/(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1], 10);
          const minor = parseInt(versionMatch[2], 10);
          // 0.9.0+ supports batch arrays
          this.supportsBatchArray = major > 0 || (major === 0 && minor >= 9);
        } else {
          this.supportsBatchArray = false;
        }
        log(`Server is electrs (${result[0]}), supportsBatchArray: ${this.supportsBatchArray}`);
      } else {
        // ElectrumX, Fulcrum, and others support JSON array batch
        this.supportsBatchArray = true;
        log(`Server is ${result[0]}, supportsBatchArray: true`);
      }
    }

    return result;
  }

  /**
   * Validate that the server's chain tip is not too far behind the best known height.
   * Returns the server's tip height, or throws if the server is stale.
   */
  private async validateBlockHeight(serverKey: string): Promise<number> {
    const header = await this.request<ElectrumHeader>('blockchain.headers.subscribe', []);
    const serverHeight = header.height;

    // Update best known height
    if (serverHeight > ElectrumClient._bestKnownHeight) {
      ElectrumClient._bestKnownHeight = serverHeight;
    }

    // Check if server is too far behind
    const lag = ElectrumClient._bestKnownHeight - serverHeight;
    if (lag > MAX_BLOCK_LAG) {
      throw new Error(`Server ${serverKey} is ${lag} blocks behind (tip: ${serverHeight}, best: ${ElectrumClient._bestKnownHeight})`);
    }

    return serverHeight;
  }

  /**
   * Ping the server to keep connection alive
   */
  async ping(): Promise<null> {
    return this.request<null>('server.ping', []);
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    const server = this.currentServer ? this.serverKey(this.currentServer) : 'unknown';
    const wasReady = this.connectionState === 'ready';
    log(`disconnect(): intentional disconnect from ${server} (state: ${this.connectionState})`);
    SyncLogger.log('electrum', `Intentional disconnect from ${server}`);

    this.intentionalDisconnect = true; // Mark as intentional — prevents auto-reconnect
    this.cancelAutoReconnect(); // Cancel any pending auto-reconnect
    this.cleanupSocket();
    // Force state to disconnected (bypass state machine for explicit disconnect)
    if (wasReady) {
      this.transitionTo('draining');
      this.transitionTo('disconnected');
    } else if (this.connectionState !== 'disconnected') {
      // Force reset for non-standard states during disconnect
      this.connectionState = 'disconnected';
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
    this.activeRequestCount = 0;
    this.clearSubscriptions();
    this.serverImplementation = '';
    this.supportsBatchArray = false;
    this.autoReconnectAttempts = 0;
  }

  getState(): ConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === 'ready';
  }

  getCurrentServer(): ElectrumServerInfo | null {
    return this.currentServer;
  }

  /**
   * Get connection diagnostics for debugging.
   */
  getDiagnostics(): {
    state: ConnectionState;
    server: string | null;
    uptime: number;
    autoReconnectAttempts: number;
    intentionalDisconnect: boolean;
    pendingRequests: number;
    queuedRequests: number;
    lastConnectedAt: number;
    lastDisconnectedAt: number;
    scripthashSubscriptions: number;
    hasHeaderSubscription: boolean;
  } {
    return {
      state: this.connectionState,
      server: this.currentServer ? this.serverKey(this.currentServer) : null,
      uptime: this.lastConnectedAt > 0 && this.connectionState === 'ready'
        ? Math.round((Date.now() - this.lastConnectedAt) / 1000)
        : 0,
      autoReconnectAttempts: this.autoReconnectAttempts,
      intentionalDisconnect: this.intentionalDisconnect,
      pendingRequests: this.pendingRequests.size,
      queuedRequests: this.requestQueue.length,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      scripthashSubscriptions: this.scripthashCallbacks.size,
      hasHeaderSubscription: this.headerCallback !== null,
    };
  }
}
