/**
 * WalletSyncManager — Central orchestrator for wallet sync lifecycle
 *
 * Singleton that owns:
 * 1. Post-transaction sync — every broadcast → Electrum sync to fetch real data
 * 2. Refresh cancel + restart — pull-to-refresh cancels in-flight, reconnects, syncs fresh
 * 3. Connection-aware sync — leverages existing ElectrumAPI health monitor + auto-reconnect
 *
 * DOES NOT replace ElectrumAPI/ElectrumClient (they handle connection lifecycle).
 * DOES NOT replace WalletEngine (it handles the actual sync pipeline + validation).
 * This module ORCHESTRATES on top of both.
 *
 * All code paths that broadcast MUST call:
 *   WalletSyncManager.shared().onTransactionBroadcasted(walletId) → triggerSync
 */

import { ElectrumAPI } from '../electrum/ElectrumAPI';
import { WalletEngine } from './WalletEngine';
import { SyncLogger } from '../SyncLogger';
import { logger } from '../../utils/logger';
import { useSyncStore } from '../../stores/syncStore';
import { useWalletStore } from '../../stores/walletStore';

// ─── Constants ────────────────────────────────────────────────────────────

/** Delay before first post-broadcast sync (mempool propagation) */
const POST_BROADCAST_SYNC_DELAY = 1000;

/** Delay for second post-broadcast sync retry (catches slow propagation) */
const POST_BROADCAST_RETRY_DELAY = 8000;

/** Minimum delay between consecutive syncs (debounce) */
const MIN_SYNC_INTERVAL = 3000;

/** Connection timeout for refresh-triggered reconnect */
const REFRESH_CONNECT_TIMEOUT = 15000;

export type SyncTrigger = 'post-broadcast' | 'pull-to-refresh' | 'foreground' | 'subscription' | 'manual';

// ─── Logging ──────────────────────────────────────────────────────────────

const log = (..._args: any[]) => {};
const logWarn = (..._args: any[]) => {};

// ─── WalletSyncManager ───────────────────────────────────────────────────

export class WalletSyncManager {
  // Singleton
  private static _instance: WalletSyncManager | null = null;

  /** Active sync token — set cancel=true to abort */
  private activeSyncToken: { cancel: boolean; trigger: SyncTrigger } | null = null;

  /** Timestamp of last completed sync */
  private lastSyncCompletedAt: number = 0;

  /** Pending post-broadcast sync timer */
  private postBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending post-broadcast retry timer */
  private postBroadcastRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Lock to prevent concurrent sync operations */
  private isSyncing: boolean = false;

  static shared(): WalletSyncManager {
    if (!this._instance) {
      this._instance = new WalletSyncManager();
    }
    return this._instance;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 1. POST-BROADCAST SYNC
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Called after every successful broadcast.
   * Schedules an Electrum sync to fetch the real transaction data from the network.
   * No local/optimistic updates — Electrum is the single source of truth.
   */
  async onTransactionBroadcasted(walletId: string): Promise<void> {
    SyncLogger.log('sync-manager', `Broadcast received — scheduling Electrum sync for wallet ${walletId}`);
    this.schedulePostBroadcastSync(walletId);
  }

  /**
   * Schedule post-broadcast Electrum sync after a delay.
   */
  private schedulePostBroadcastSync(walletId: string): void {
    // Cancel any existing post-broadcast timers
    if (this.postBroadcastTimer) {
      clearTimeout(this.postBroadcastTimer);
      this.postBroadcastTimer = null;
    }
    if (this.postBroadcastRetryTimer) {
      clearTimeout(this.postBroadcastRetryTimer);
      this.postBroadcastRetryTimer = null;
    }

    log(`scheduling post-broadcast sync in ${POST_BROADCAST_SYNC_DELAY}ms for wallet ${walletId}`);
    SyncLogger.log('sync-manager', `Post-broadcast sync scheduled in ${POST_BROADCAST_SYNC_DELAY}ms`);

    // First sync attempt after 1s
    this.postBroadcastTimer = setTimeout(async () => {
      this.postBroadcastTimer = null;
      try {
        await this.triggerSync(walletId, 'post-broadcast');
      } catch (err: any) {
        SyncLogger.error('sync-manager', `Post-broadcast sync failed: ${err?.message || err}`);
      }

      // Second attempt after 8s — catches cases where mempool propagation was slow
      this.postBroadcastRetryTimer = setTimeout(async () => {
        this.postBroadcastRetryTimer = null;
        try {
          await this.triggerSync(walletId, 'post-broadcast');
        } catch (err: any) {
          SyncLogger.error('sync-manager', `Post-broadcast retry failed: ${err?.message || err}`);
        }
      }, POST_BROADCAST_RETRY_DELAY);
    }, POST_BROADCAST_SYNC_DELAY);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. REFRESH: CANCEL + RESTART
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Full refresh — cancels any in-flight sync, reconnects, syncs fresh.
   * Called by pull-to-refresh on dashboard.
   *
   * Flow:
   * 1. Cancel any active sync
   * 2. Clear Electrum cache
   * 3. Disconnect + reconnect (clean TCP state)
   * 4. Full sync from scratch
   */
  async refreshWallet(walletId: string): Promise<void> {
    logger.perfStart('full-refresh');
    const startTime = Date.now();
    log(`refreshWallet: starting full refresh for ${walletId}`);
    SyncLogger.log('sync-manager', `Full refresh START for ${walletId}`);

    // Step 1: Cancel any in-flight operations
    this.cancelActiveSyncs(walletId);

    // Step 2: Clear caches
    const api = ElectrumAPI.shared('mainnet');
    api.clearCache();

    // Step 3: Ensure connection is ready (reconnect only if disconnected)
    try {
      const isConnected = api.isClientConnected();
      if (!isConnected) {
        log('refreshWallet: not connected — reconnecting...');
        SyncLogger.log('sync-manager', 'Not connected — reconnecting');
        api.disconnect(); // Clean up stale socket
        await Promise.race([
          api.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Refresh connect timeout')), REFRESH_CONNECT_TIMEOUT)
          ),
        ]);
        log(`refreshWallet: reconnected in ${Date.now() - startTime}ms`);
        SyncLogger.log('sync-manager', `Reconnected in ${Date.now() - startTime}ms`);
      } else {
        SyncLogger.log('sync-manager', 'Already connected — skipping reconnect');
      }
    } catch (err: any) {
      logWarn('refreshWallet: reconnect failed:', err?.message || err);
      SyncLogger.error('sync-manager', `Refresh reconnect failed: ${err?.message || err}`);
      // Continue to sync anyway — triggerSync will try to connect
    }

    // Step 4: Full sync
    await this.triggerSync(walletId, 'pull-to-refresh');

    logger.perfEnd('full-refresh');
    log(`refreshWallet: completed in ${Date.now() - startTime}ms`);
    SyncLogger.log('sync-manager', `Full refresh completed in ${Date.now() - startTime}ms`);
  }

  /**
   * Cancel all in-flight sync operations for a wallet.
   */
  private cancelActiveSyncs(walletId: string): void {
    // Cancel our local sync token
    if (this.activeSyncToken) {
      log(`cancelling active sync (trigger: ${this.activeSyncToken.trigger})`);
      SyncLogger.log('sync-manager', `Cancelling active sync (${this.activeSyncToken.trigger})`);
      this.activeSyncToken.cancel = true;
      this.activeSyncToken = null;
    }

    // Cancel post-broadcast timers
    if (this.postBroadcastTimer) {
      clearTimeout(this.postBroadcastTimer);
      this.postBroadcastTimer = null;
    }
    if (this.postBroadcastRetryTimer) {
      clearTimeout(this.postBroadcastRetryTimer);
      this.postBroadcastRetryTimer = null;
    }

    // Cancel WalletEngine's active sync
    const engine = WalletEngine.shared();
    if (engine.isSyncing(walletId)) {
      log('cancelling WalletEngine active sync');
      SyncLogger.log('sync-manager', 'Cancelling WalletEngine active sync');
      engine.cancelSync(walletId);
    }

    this.isSyncing = false;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. CORE SYNC TRIGGER
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Trigger a full wallet sync via WalletEngine.
   * Manages sync state, deduplication, and error handling.
   */
  async triggerSync(walletId: string, trigger: SyncTrigger): Promise<void> {
    // Debounce rapid syncs (except pull-to-refresh which always runs)
    if (trigger !== 'pull-to-refresh') {
      const timeSinceLastSync = Date.now() - this.lastSyncCompletedAt;
      if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
        log(`sync debounced — ${timeSinceLastSync}ms since last sync (min: ${MIN_SYNC_INTERVAL}ms)`);
        return;
      }
    }

    // Prevent concurrent syncs (except pull-to-refresh which cancels and restarts)
    if (this.isSyncing) {
      if (trigger === 'pull-to-refresh') {
        this.cancelActiveSyncs(walletId);
      } else {
        log(`sync skipped — already syncing (trigger: ${trigger})`);
        return;
      }
    }

    const syncToken = { cancel: false, trigger };
    this.activeSyncToken = syncToken;
    this.isSyncing = true;

    const startTime = Date.now();
    log(`triggerSync: START (trigger: ${trigger}, wallet: ${walletId})`);
    SyncLogger.log('sync-manager', `Sync START — trigger=${trigger}, wallet=${walletId}`);

    // Update sync store
    useSyncStore.getState().startSyncing();

    try {
      // Check if cancelled before proceeding
      if (syncToken.cancel) {
        log('sync cancelled before start');
        return;
      }

      // Delegate to walletStore's refreshBalance which uses WalletEngine
      // This is the canonical sync path — it handles everything:
      // - Connection to Electrum
      // - 3-stage pipeline (UTXOs + histories + tx details)
      // - Validation + two-phase commit
      // - State update in Zustand stores
      // - Subscription wiring
      await useWalletStore.getState().refreshBalance();

      // Check if cancelled during sync
      if (syncToken.cancel) {
        log('sync completed but was cancelled — results may have been discarded');
        SyncLogger.warn('sync-manager', 'Sync completed but cancel was requested');
        return;
      }

      const syncMs = Date.now() - startTime;
      this.lastSyncCompletedAt = Date.now();

      // Update sync store with success
      const api = ElectrumAPI.shared('mainnet');
      const server = api.getCurrentServer();
      useSyncStore.getState().completeSyncing(
        undefined,
        server ? `${server.host}:${server.port}` : undefined,
      );

      log(`triggerSync: SUCCESS in ${syncMs}ms (trigger: ${trigger})`);
      SyncLogger.log('sync-manager', `Sync SUCCESS in ${syncMs}ms — trigger=${trigger}`);

    } catch (err: any) {
      const syncMs = Date.now() - startTime;
      const errorMsg = err?.message || 'Unknown sync error';

      logWarn(`triggerSync: FAILED in ${syncMs}ms:`, errorMsg);
      SyncLogger.error('sync-manager', `Sync FAILED in ${syncMs}ms — trigger=${trigger}: ${errorMsg}`);

      useSyncStore.getState().failSyncing(errorMsg);
    } finally {
      this.isSyncing = false;
      if (this.activeSyncToken === syncToken) {
        this.activeSyncToken = null;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. UTILITIES
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Check if a sync is currently in progress.
   */
  getIsSyncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Get the trigger of the current active sync, if any.
   */
  getActiveSyncTrigger(): SyncTrigger | null {
    return this.activeSyncToken?.trigger ?? null;
  }

  /**
   * Reset state (e.g., on wallet delete or logout).
   */
  reset(): void {
    log('reset: clearing all state');
    if (this.postBroadcastTimer) {
      clearTimeout(this.postBroadcastTimer);
      this.postBroadcastTimer = null;
    }
    if (this.postBroadcastRetryTimer) {
      clearTimeout(this.postBroadcastRetryTimer);
      this.postBroadcastRetryTimer = null;
    }
    if (this.activeSyncToken) {
      this.activeSyncToken.cancel = true;
      this.activeSyncToken = null;
    }
    this.isSyncing = false;
    this.lastSyncCompletedAt = 0;
  }
}
