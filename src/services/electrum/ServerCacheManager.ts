/**
 * ServerCacheManager — Persistent server health cache (ccache)
 *
 * Tracks server health, latency, and reliability metrics across sessions.
 * Uses weighted random selection instead of deterministic "first-in-list" sorting.
 *
 * Design principles:
 * - Health-weighted random: higher-scored servers are MORE likely to be picked, not guaranteed
 * - Exploration sampling: every ~10th connection picks a random unknown server
 * - Exponential backoff blacklisting: repeated failures → longer cooldowns
 * - Persistent across app restarts via AsyncStorage
 * - Prune records older than 7 days with no success
 *
 * Scoring (0–100):
 *   Success rate   → 0–40 points
 *   Latency        → 0–30 points (lower is better)
 *   Recency        → 0–20 points (recent success = higher)
 *   Consecutive failures → penalty (0 to -30)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ElectrumServerInfo } from './types';
import type { ServerHealthRecord } from '../sync/types';
import servers from './servers.json';

// ─── Constants ────────────────────────────────────────────────────────

const STORAGE_KEY = 'electrum_server_ccache';
const MAX_AGE_MS = 90 * 24 * 3600_000;      // 90 days — only prune never-succeeded servers
const SAVE_DEBOUNCE_MS = 500;
const EXPLORATION_RATE = 10;                  // Every Nth connection, explore

/** Blacklist durations based on consecutive failures (exponential backoff) */
const BLACKLIST_DURATIONS_MS = [
  60_000,     // 1 fail  → 1min
  300_000,    // 2 fails → 5min
  900_000,    // 3 fails → 15min
  1_800_000,  // 4 fails → 30min
  3_600_000,  // 5+ fails → 1 hour
];

// ─── Error Classification ──────────────────────────────────────────

/** Fine-grained error classes for connection failure tracking */
export type ElectrumErrorClass =
  | 'DNS_ERROR'            // ENOTFOUND, getaddrinfo
  | 'TLS_ERROR'            // Certificate/handshake failures
  | 'TIMEOUT'              // Connection or request timeout
  | 'PROTOCOL_ERROR'       // JSON parse, version mismatch
  | 'SERVER_ERROR'         // JSON-RPC error response
  | 'NETWORK_UNREACHABLE'  // ENETUNREACH, ECONNREFUSED
  | 'CONNECTION_RESET';    // ECONNRESET, EPIPE

/** Classify an Electrum connection/request error into a category */
export function classifyElectrumError(error: any): ElectrumErrorClass {
  const msg = (error?.message || error?.toString?.() || '').toLowerCase();
  if (msg.includes('enotfound') || msg.includes('getaddrinfo') || msg.includes('dns')) return 'DNS_ERROR';
  if (msg.includes('certificate') || msg.includes('tls') || msg.includes('ssl') ||
      msg.includes('self signed') || msg.includes('unable to verify')) return 'TLS_ERROR';
  if (msg.includes('enetunreach') || msg.includes('econnrefused') || msg.includes('ehostunreach') ||
      msg.includes('network is unreachable')) return 'NETWORK_UNREACHABLE';
  if (msg.includes('econnreset') || msg.includes('epipe') || msg.includes('socket hang up') ||
      msg.includes('broken pipe') || msg.includes('connection lost')) return 'CONNECTION_RESET';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('unexpected') ||
      msg.includes('protocol') || msg.includes('version mismatch')) return 'PROTOCOL_ERROR';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return 'TIMEOUT';
  if (error?.code) return 'SERVER_ERROR';
  return 'TIMEOUT'; // default
}

/** Blacklist duration multipliers by error class */
const ERROR_CLASS_BLACKLIST_MULTIPLIER: Record<string, number> = {
  DNS_ERROR: 10,            // 5min → 50min, effectively permanent for session
  TLS_ERROR: 6,             // 3min → 18min
  TIMEOUT: 1,               // Standard: 30s, 60s, 2min, 5min, 15min
  PROTOCOL_ERROR: 20,       // Effectively permanent
  SERVER_ERROR: 2,          // Double standard
  NETWORK_UNREACHABLE: 8,   // Long blacklist
  CONNECTION_RESET: 1,      // Same as timeout
};

// ─── Helpers ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function serverKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function parseServerList(serverStrings: string[]): ElectrumServerInfo[] {
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

// ─── ServerCacheManager ───────────────────────────────────────────────

export class ServerCacheManager {
  private records: Map<string, ServerHealthRecord> = new Map();
  private allServers: ElectrumServerInfo[];
  private connectionCount: number = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded: boolean = false;

  constructor() {
    this.allServers = parseServerList(servers as string[]);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  /**
   * Load cached records from AsyncStorage.
   * Call this on app startup.
   */
  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: ServerHealthRecord[] = JSON.parse(raw);
        const now = Date.now();
        for (const r of parsed) {
          // Only prune servers that have NEVER succeeded and haven't been tried in MAX_AGE
          // Servers that have succeeded at least once are kept permanently
          if (r.lastSuccessAt === 0 && now - r.lastTriedAt > MAX_AGE_MS) continue;
          const key = serverKey(r.host, r.port);
          this.records.set(key, r);
        }
      }
      this.loaded = true;
    } catch {
      // First run or corrupt data — start fresh
      this.loaded = true;
    }
  }

  /**
   * Debounced save to AsyncStorage.
   */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private async persistNow(): Promise<void> {
    try {
      const arr = Array.from(this.records.values());
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // Best effort
    }
  }

  // ─── Score Computation ────────────────────────────────────────────

  /**
   * Compute a 0–100 score for a server based on its health record.
   */
  computeScore(r: ServerHealthRecord): number {
    // Success rate: 0–40 points
    const total = r.successCount + r.failureCount;
    const successRate = total > 0 ? r.successCount / total : 0.5;
    const successPoints = successRate * 40;

    // Latency: 0–30 points (lower is better, use p50 when available)
    let latencyMs = r.avgLatencyMs;
    if (r.latencyHistory?.length >= 3) {
      const sorted = [...r.latencyHistory].sort((a, b) => a - b);
      latencyMs = sorted[Math.floor(sorted.length / 2)]; // p50
    }
    let latencyPoints = 15; // Default for unknown
    if (latencyMs > 0) {
      // 0ms → 30pts, 3000ms+ → 0pts
      latencyPoints = Math.max(0, 30 - (latencyMs / 100));
    }

    // Recency: 0–20 points (recent success = higher)
    let recencyPoints = 0;
    if (r.lastSuccessAt > 0) {
      const hoursSinceSuccess = (Date.now() - r.lastSuccessAt) / 3_600_000;
      recencyPoints = Math.max(0, 20 - hoursSinceSuccess);
    }

    // Consecutive failures penalty: 0 to -30
    const failPenalty = Math.min(30, r.consecutiveFailures * 10);

    // DNS/TLS error penalty: -15 if last error was a hard failure
    const hardErrorPenalty =
      (r.lastErrorClass === 'DNS_ERROR' || r.lastErrorClass === 'TLS_ERROR') ? 15 : 0;

    // Server implementation bonus: Fulcrum (best batch perf) +5, ElectrumX +2
    const implBonus =
      r.serverImpl?.toLowerCase().startsWith('fulcrum') ? 5 :
      r.serverImpl?.toLowerCase().startsWith('electrumx') ? 2 : 0;

    return clamp(
      successPoints + latencyPoints + recencyPoints - failPenalty - hardErrorPenalty + implBonus,
      0,
      100
    );
  }

  // ─── Record Management ────────────────────────────────────────────

  /**
   * Get or create a health record for a server.
   */
  private getOrCreate(host: string, port: number): ServerHealthRecord {
    const key = serverKey(host, port);
    let record = this.records.get(key);
    if (!record) {
      record = {
        host,
        port,
        transport: port === 50001 ? 'tcp' : 'tls',
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        avgLatencyMs: 0,
        latencySamples: 0,
        lastTriedAt: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        protocolVersion: null,
        serverImpl: null,
        supportsBatchArray: false,
        pruningLimit: null,
        score: 50, // Neutral starting score
        blacklistUntil: 0,
        lastErrorClass: null,
        errorClassCounts: {},
        latencyHistory: [],
      };
      this.records.set(key, record);
    }
    return record;
  }

  /**
   * Record a successful connection/request.
   */
  recordSuccess(
    host: string,
    port: number,
    latencyMs: number,
    serverInfo?: {
      protocolVersion?: string;
      serverImpl?: string;
      supportsBatchArray?: boolean;
      pruningLimit?: number | null;
    }
  ): void {
    const r = this.getOrCreate(host, port);

    r.successCount += 1;
    r.consecutiveFailures = 0;
    r.lastTriedAt = Date.now();
    r.lastSuccessAt = Date.now();
    r.blacklistUntil = 0; // Clear blacklist on success

    // Update rolling average latency
    if (r.latencySamples === 0) {
      r.avgLatencyMs = latencyMs;
      r.latencySamples = 1;
    } else {
      // Exponential moving average (weight recent more heavily)
      const alpha = Math.min(0.3, 1 / (r.latencySamples + 1));
      r.avgLatencyMs = Math.round(r.avgLatencyMs * (1 - alpha) + latencyMs * alpha);
      r.latencySamples = Math.min(r.latencySamples + 1, 100); // Cap sample count
    }

    // Maintain latency histogram (circular buffer of 20)
    if (!r.latencyHistory) r.latencyHistory = [];
    r.latencyHistory.push(latencyMs);
    if (r.latencyHistory.length > 20) {
      r.latencyHistory = r.latencyHistory.slice(-20);
    }

    // Clear error class on success
    r.lastErrorClass = null;

    // Update server info if provided
    if (serverInfo) {
      if (serverInfo.protocolVersion) r.protocolVersion = serverInfo.protocolVersion;
      if (serverInfo.serverImpl) r.serverImpl = serverInfo.serverImpl;
      if (serverInfo.supportsBatchArray !== undefined) r.supportsBatchArray = serverInfo.supportsBatchArray;
      if (serverInfo.pruningLimit !== undefined) r.pruningLimit = serverInfo.pruningLimit;
    }

    r.score = this.computeScore(r);
    this.scheduleSave();
  }

  /**
   * Record a failed connection/request.
   */
  recordFailure(host: string, port: number, error?: any): void {
    const r = this.getOrCreate(host, port);

    r.failureCount += 1;
    r.consecutiveFailures += 1;
    r.lastTriedAt = Date.now();
    r.lastFailureAt = Date.now();

    // Classify the error
    const errorClass = error ? classifyElectrumError(error) : 'TIMEOUT';
    r.lastErrorClass = errorClass;
    if (!r.errorClassCounts) r.errorClassCounts = {};
    r.errorClassCounts[errorClass] = (r.errorClassCounts[errorClass] || 0) + 1;

    // Error-class-aware blacklist duration
    const baseIdx = Math.min(r.consecutiveFailures - 1, BLACKLIST_DURATIONS_MS.length - 1);
    const baseDuration = BLACKLIST_DURATIONS_MS[baseIdx];
    const multiplier = ERROR_CLASS_BLACKLIST_MULTIPLIER[errorClass] ?? 1;
    r.blacklistUntil = Date.now() + baseDuration * multiplier;

    // PROTOCOL_ERROR with 3+ consecutive: effectively permanent blacklist
    if (errorClass === 'PROTOCOL_ERROR' && r.consecutiveFailures >= 3) {
      r.blacklistUntil = Date.now() + 24 * 3600_000; // 24 hours
    }

    r.score = this.computeScore(r);
    this.scheduleSave();
  }

  // ─── Server Selection ─────────────────────────────────────────────

  /**
   * Get all non-blacklisted servers with positive scores.
   */
  private getHealthyServers(exclude: string[] = []): ServerHealthRecord[] {
    const now = Date.now();
    return Array.from(this.records.values())
      .filter(r => {
        if (exclude.includes(serverKey(r.host, r.port))) return false;
        if (r.blacklistUntil > now) return false;
        return true;
      });
  }

  /**
   * Select a server using weighted random selection.
   * Higher-scored servers are more likely to be picked, but not guaranteed.
   *
   * Every EXPLORATION_RATE-th call picks a random server from the full pool
   * to discover new good servers and avoid stale bias.
   */
  selectServer(exclude: string[] = []): ElectrumServerInfo | null {
    this.connectionCount += 1;

    // Cold-start boost: on the first connection after launch, prefer the
    // last known good server if it scored well (skip random exploration).
    // This avoids the latency of trying random servers on app startup.
    if (this.connectionCount === 1) {
      const topServers = this.getTopServersForColdStart(1);
      if (topServers.length > 0) {
        const top = topServers[0];
        const key = serverKey(top.host, top.port);
        if (!exclude.includes(key)) {
          const record = this.records.get(key);
          if (record && record.score > 70) {
            return top;
          }
        }
      }
    }

    // Exploration: every Nth connection, pick a random unknown/untried server
    if (this.connectionCount % EXPLORATION_RATE === 0) {
      const explored = this.selectExplorationServer(exclude);
      if (explored) return explored;
    }

    // Get healthy candidates from known records
    const healthy = this.getHealthyServers(exclude);

    if (healthy.length > 0) {
      return this.weightedRandomPick(healthy);
    }

    // No healthy known servers — try clearing oldest blacklists
    this.clearOldestBlacklists(5);
    const retryHealthy = this.getHealthyServers(exclude);
    if (retryHealthy.length > 0) {
      return this.weightedRandomPick(retryHealthy);
    }

    // Last resort: pick random from full server list (excluding already tried)
    return this.selectFromFullPool(exclude);
  }

  /**
   * Select multiple servers for racing (parallel connection attempts).
   * When preferBatchArray is true, front-loads servers known to support batch arrays.
   */
  selectServersForRace(count: number, exclude: string[] = [], preferBatchArray: boolean = false): ElectrumServerInfo[] {
    const selected: ElectrumServerInfo[] = [];
    const usedKeys = new Set(exclude);

    // If preferBatchArray, front-load servers with batch support
    if (preferBatchArray) {
      const batchCapable = Array.from(this.records.values())
        .filter(r =>
          r.supportsBatchArray &&
          !usedKeys.has(serverKey(r.host, r.port)) &&
          r.blacklistUntil < Date.now()
        )
        .sort((a, b) => b.score - a.score);

      for (const r of batchCapable.slice(0, Math.ceil(count / 2))) {
        const key = serverKey(r.host, r.port);
        usedKeys.add(key);
        selected.push({ host: r.host, port: r.port, ssl: r.transport === 'tls' });
      }
    }

    // Fill remaining slots with normal weighted selection
    for (let i = selected.length; i < count; i++) {
      const server = this.selectServer(Array.from(usedKeys));
      if (!server) break;
      const key = serverKey(server.host, server.port);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      selected.push(server);
    }

    return selected;
  }

  /**
   * Get the best N servers from cache for fast cold start.
   * Returns servers sorted by score descending, then by p50 latency ascending.
   * Used by ElectrumClient hedged dialing Phase 1.
   */
  getTopServersForColdStart(count: number = 3): ElectrumServerInfo[] {
    const healthy = this.getHealthyServers();
    if (healthy.length === 0) return [];

    // Sort by score descending, then by p50 latency ascending
    healthy.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aLat = a.latencyHistory?.length
        ? [...a.latencyHistory].sort((x, y) => x - y)[Math.floor(a.latencyHistory.length / 2)]
        : a.avgLatencyMs || Infinity;
      const bLat = b.latencyHistory?.length
        ? [...b.latencyHistory].sort((x, y) => x - y)[Math.floor(b.latencyHistory.length / 2)]
        : b.avgLatencyMs || Infinity;
      return aLat - bLat;
    });

    return healthy.slice(0, count).map(r => ({
      host: r.host,
      port: r.port,
      ssl: r.transport === 'tls',
    }));
  }

  /**
   * Weighted random pick from a list of health records.
   * Weight = max(1, score) — ensures even low-score servers have a chance.
   */
  private weightedRandomPick(candidates: ServerHealthRecord[]): ElectrumServerInfo {
    const totalWeight = candidates.reduce((sum, r) => sum + Math.max(1, r.score), 0);
    let roll = Math.random() * totalWeight;

    for (const r of candidates) {
      roll -= Math.max(1, r.score);
      if (roll <= 0) {
        return { host: r.host, port: r.port, ssl: r.transport === 'tls' };
      }
    }

    // Fallback (shouldn't happen)
    const idx = Math.floor(Math.random() * candidates.length);
    return {
      host: candidates[idx].host,
      port: candidates[idx].port,
      ssl: candidates[idx].transport === 'tls',
    };
  }

  /**
   * Pick a random server from the full pool that we haven't tried recently.
   * Used for exploration sampling to discover new good servers.
   */
  private selectExplorationServer(exclude: string[] = []): ElectrumServerInfo | null {
    const now = Date.now();
    const candidates = this.allServers.filter(s => {
      const key = serverKey(s.host, s.port);
      if (exclude.includes(key)) return false;
      const record = this.records.get(key);
      // Prefer servers we haven't tried, or tried long ago
      if (!record) return true;
      if (now - record.lastTriedAt > 3_600_000) return true; // Last tried >1hr ago
      return false;
    });

    if (candidates.length === 0) return null;
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  /**
   * Pick a random server from the full pool (last resort).
   */
  private selectFromFullPool(exclude: string[] = []): ElectrumServerInfo | null {
    const candidates = this.allServers.filter(s => {
      return !exclude.includes(serverKey(s.host, s.port));
    });

    if (candidates.length === 0) return null;
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  /**
   * Clear the N oldest blacklist entries to allow retries.
   */
  private clearOldestBlacklists(count: number): void {
    const blacklisted = Array.from(this.records.values())
      .filter(r => r.blacklistUntil > Date.now())
      .sort((a, b) => a.blacklistUntil - b.blacklistUntil);

    for (let i = 0; i < Math.min(count, blacklisted.length); i++) {
      blacklisted[i].blacklistUntil = 0;
    }
  }

  // ─── Query Methods ────────────────────────────────────────────────

  /**
   * Get the health record for a specific server.
   */
  getRecord(host: string, port: number): ServerHealthRecord | null {
    return this.records.get(serverKey(host, port)) ?? null;
  }

  /**
   * Check if a server supports batch array requests.
   */
  supportsBatchArray(host: string, port: number): boolean {
    return this.records.get(serverKey(host, port))?.supportsBatchArray ?? false;
  }

  /**
   * Get server implementation name (ElectrumX, Fulcrum, electrs, etc.)
   */
  getServerImpl(host: string, port: number): string | null {
    return this.records.get(serverKey(host, port))?.serverImpl ?? null;
  }

  /**
   * Get all known records sorted by score (highest first).
   */
  getAllRecordsSorted(): ServerHealthRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get the number of known servers.
   */
  get knownServerCount(): number {
    return this.records.size;
  }

  /**
   * Get the number of healthy (non-blacklisted) servers.
   */
  get healthyServerCount(): number {
    return this.getHealthyServers().length;
  }

  // ─── Reset ──────────────────────────────────────────────────────

  /**
   * Clear all in-memory records, cancel pending saves, and mark as unloaded.
   * Used during full app reset to ensure no stale server data persists.
   */
  reset(): void {
    this.records.clear();
    this.connectionCount = 0;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.loaded = false;
  }

  // ─── Singleton ────────────────────────────────────────────────────

  private static _instance: ServerCacheManager | null = null;

  static shared(): ServerCacheManager {
    if (!this._instance) {
      this._instance = new ServerCacheManager();
    }
    return this._instance;
  }

  /**
   * Initialize the singleton — load from storage.
   * Safe to call multiple times (idempotent after first load).
   */
  static async initialize(): Promise<ServerCacheManager> {
    const instance = this.shared();
    if (!instance.loaded) {
      await instance.load();
    }
    return instance;
  }
}
