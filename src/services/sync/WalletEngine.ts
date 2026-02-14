/**
 * WalletEngine — Orchestrator for wallet sync, queries, and state management
 *
 * Singleton orchestrator that all wallet types use.
 * walletStore becomes a thin reactive wrapper around this engine.
 *
 * Responsibilities:
 * - Load wallet from V2 file → instant UI from LKG
 * - Trigger background sync via SyncPipeline
 * - Validate staging via SyncValidator
 * - Two-phase commit: staging → validate → commit or discard
 * - Provide synchronous queries from LKG (getUtxos, getTransactions, etc.)
 * - Event system for UI updates (onSyncStatusChange, onLkgUpdate)
 *
 * CRITICAL INVARIANT: On sync failure, LKG is NEVER modified.
 * The user always sees the last successful data.
 */

import { ElectrumAPI } from '../electrum/ElectrumAPI';
import { SubscriptionManager } from '../electrum/SubscriptionManager';
import { ServerCacheManager } from '../electrum/ServerCacheManager';
import { WalletDatabase } from '../database/WalletDatabase';
import type { TransactionRow, UtxoRow, TxDetailRow } from '../database/types';
import { SyncLogger } from '../SyncLogger';
import { SyncPipeline } from './SyncPipeline';
import { SyncValidator } from './SyncValidator';
import { GapLimitDiscovery } from './GapLimitDiscovery';
import {
  computeBalanceFromUtxos,
  createEmptyLkg,
} from './types';
import type {
  WalletFileV2Schema,
  LkgUtxo,
  LkgTransaction,
  LkgSnapshot,
  TxDetailEntry,
  StagingSnapshot,
  SyncOptions,
  SyncOutcome,
  SyncStateData,
  TrackedTransaction,
  TxUserMetadata,
  UtxoUserMetadata,
} from './types';
import type { AddressInfo } from '../../types';
import { logger } from '../../utils/logger';
import { loadWalletSnapshot, snapshotToV2Schema } from '../wallet/WalletLoaderService';

// ─── Types ────────────────────────────────────────────────────────────

type SyncStatusCallback = (walletId: string, status: SyncStateData) => void;
type LkgUpdateCallback = (walletId: string) => void;

// ─── WalletEngine ─────────────────────────────────────────────────────

export class WalletEngine {
  // In-memory cache of loaded wallet files
  private loadedWallets: Map<string, WalletFileV2Schema> = new Map();

  // Active sync tracking — prevents duplicate concurrent syncs
  private activeSyncs: Map<string, { cancel: boolean }> = new Map();

  // Event listeners
  private syncStatusListeners: Set<SyncStatusCallback> = new Set();
  private lkgUpdateListeners: Set<LkgUpdateCallback> = new Set();

  // Dependencies
  private pipeline: SyncPipeline;
  private validator: SyncValidator;

  constructor() {
    this.pipeline = new SyncPipeline();
    this.validator = new SyncValidator();
  }

  // ─── Queries (synchronous, from LKG) ─────────────────────────────

  /**
   * Load a wallet into memory from the SQLite database.
   * Constructs a WalletFileV2Schema shape from DB data for pipeline compatibility.
   * If already loaded, returns cached version.
   */
  loadWallet(walletId: string, _walletName?: string): WalletFileV2Schema | null {
    // Check in-memory cache first
    const cached = this.loadedWallets.get(walletId);
    if (cached) {
      return cached;
    }

    // Load from SQLite database (primary source of truth)
    const data = this.buildSchemaFromDB(walletId);
    if (!data) {
      return null;
    }


    this.loadedWallets.set(walletId, data);
    return data;
  }

  /**
   * Build a WalletFileV2Schema from SQLite database data.
   * Delegates to WalletLoaderService for unified data loading.
   */
  private buildSchemaFromDB(walletId: string): WalletFileV2Schema | null {
    try {
      const snapshot = loadWalletSnapshot(walletId);
      if (!snapshot) return null;
      return snapshotToV2Schema(snapshot);
    } catch (e: any) {
      return null;
    }
  }

  /**
   * Get the cached LKG snapshot for instant UI display.
   */
  getCachedSnapshot(walletId: string): LkgSnapshot {
    const data = this.loadedWallets.get(walletId);
    return data?.lkg ?? createEmptyLkg();
  }

  /**
   * Get UTXOs from LKG.
   */
  getUtxos(walletId: string): LkgUtxo[] {
    return this.getCachedSnapshot(walletId).utxos;
  }

  /**
   * Get transactions from LKG.
   */
  getTransactions(walletId: string): LkgTransaction[] {
    return this.getCachedSnapshot(walletId).transactions;
  }

  /**
   * Get full transaction details from LKG.
   */
  getTxDetails(walletId: string, txid: string): TxDetailEntry | null {
    const snapshot = this.getCachedSnapshot(walletId);
    return snapshot.txDetails[txid] ?? null;
  }

  /**
   * Compute balance from LKG UTXOs.
   * This is the ONLY way balance is derived.
   */
  computeBalance(walletId: string): { confirmed: number; unconfirmed: number; total: number } {
    const utxos = this.getUtxos(walletId);
    return computeBalanceFromUtxos(utxos);
  }

  /**
   * Get sync state for a wallet.
   */
  getSyncStatus(walletId: string): SyncStateData | null {
    const data = this.loadedWallets.get(walletId);
    return data?.syncState ?? null;
  }

  /**
   * Get the full loaded V2 schema (for store integration).
   */
  getWalletFile(walletId: string): WalletFileV2Schema | null {
    return this.loadedWallets.get(walletId) ?? null;
  }

  // ─── Sync (async, background) ─────────────────────────────────────

  /**
   * Sync a wallet — the main entry point.
   *
   * 1. Connect to Electrum server (via ServerCacheManager)
   * 2. Run 3-stage SyncPipeline
   * 3. Validate staging via SyncValidator
   * 4. Two-phase commit: promote to LKG or discard
   *
   * On failure: LKG is NEVER modified. UI keeps showing cached data.
   */
  async syncWallet(
    walletId: string,
    options: SyncOptions = {}
  ): Promise<SyncOutcome> {
    // Prevent duplicate concurrent syncs
    if (this.activeSyncs.has(walletId)) {
      return { ok: false, error: 'Sync already in progress', preservedLkg: true };
    }

    const syncToken = { cancel: false };
    this.activeSyncs.set(walletId, syncToken);
    const startTime = Date.now();
    logger.perfStart('engine-sync');

    try {
      // Invalidate cache so loadWallet re-reads from DB to pick up addresses
      // derived since last sync (e.g., change addresses, new addresses).
      // Mark as dirty rather than deleting — loadWallet will reload from DB.
      this.loadedWallets.delete(walletId);
      let walletFile = this.loadWallet(walletId);
      if (!walletFile) {
        SyncLogger.error('engine', `syncWallet: wallet file not found for ${walletId}`);
        return { ok: false, error: 'Wallet file not found', preservedLkg: true };
      }

      SyncLogger.log('engine', `syncWallet START: ${walletId}, addrs=${walletFile.scriptInventory.addresses.length}, lkgUtxos=${walletFile.lkg.utxos.length}, lkgTxs=${(walletFile.lkg.transactions||[]).length}, lkgBal=${walletFile.lkg.confirmedBalanceSat}+${walletFile.lkg.unconfirmedBalanceSat}`);

      // Check staleness (unless force=true)
      if (!options.force && !this.shouldSync(walletFile)) {
        SyncLogger.log('engine', `syncWallet: not stale, skipping`);
        return { ok: false, error: 'Not stale, skipping sync', preservedLkg: true };
      }

      // Update sync state to 'syncing'
      walletFile.syncState.status = 'syncing';
      walletFile.syncState.lastAttemptAt = Date.now();
      this.notifySyncStatus(walletId, walletFile.syncState);

      // Use the singleton ElectrumAPI client — stays connected for subscriptions
      const api = ElectrumAPI.shared('mainnet');
      const client = api.getClient();

      try {
        logger.perfStart('engine-api-connect');
        await api.connect();
        logger.perfEnd('engine-api-connect');
      } catch (error: any) {
        logger.perfEnd('engine-api-connect');
        // Record connection failure in server cache
        const serverInfo = client.getCurrentServer();
        if (serverInfo) {
          ServerCacheManager.shared().recordFailure(
            serverInfo.host,
            serverInfo.port,
            error
          );
        }

        const errorMsg = error?.message || 'Connection failed';
        this.handleSyncError(walletId, walletFile, errorMsg);
        return { ok: false, error: errorMsg, preservedLkg: true };
      }

      // Check if cancelled
      if (syncToken.cancel) {
        return { ok: false, error: 'Sync cancelled', preservedLkg: true };
      }

      // Record server connection success
      const serverInfo = client.getCurrentServer();
      if (serverInfo) {
        ServerCacheManager.shared().recordSuccess(
          serverInfo.host,
          serverInfo.port,
          Date.now() - startTime
        );
        walletFile.syncState.lastServerUsed =
          `${serverInfo.host}:${serverInfo.port}`;
      }

      // Run the 3-stage pipeline (no height probe — pipeline gets its own tip)
      let pipelineResult = await this.pipeline.execute(
        walletFile,
        client,
        options
      );

      // DO NOT disconnect — connection stays alive for subscriptions

      // Check if cancelled
      if (syncToken.cancel) {
        return { ok: false, error: 'Sync cancelled', preservedLkg: true };
      }

      if (!pipelineResult.ok) {
        SyncLogger.error('engine', `Pipeline failed: ${pipelineResult.error}`);
        this.handleSyncError(walletId, walletFile, pipelineResult.error);
        return { ok: false, error: pipelineResult.error, preservedLkg: true };
      }

      const historyTxCount = new Set(Object.values(pipelineResult.staging.historyMap).flatMap(h => h.map(e => e.txHash))).size;
      SyncLogger.log('engine', `Pipeline OK: stagingUtxos=${pipelineResult.staging.utxos.length}, uniqueTxids=${historyTxCount}, txDetails=${Object.keys(pipelineResult.staging.txDetails).length}`);

      // ── Gap Limit Discovery ────────────────────────────────────────
      // Extend addresses if used addresses are found near the frontier.
      // Runs before commit so discovered addresses + data are included.
      if (!options.skipDiscovery) {
        try {
          logger.perfStart('engine-discovery');
          const discoveryResult = await GapLimitDiscovery.discover(
            walletId,
            client,
            pipelineResult.staging,
            'mainnet'
          );
          logger.perfEnd('engine-discovery');

          if (discoveryResult.newAddressCount > 0) {
            SyncLogger.log('engine',
              `Discovery: derived ${discoveryResult.newAddressCount} new addresses, ${discoveryResult.newUsedAddressCount} used`
            );
            // Use updated staging for the rest of the commit
            pipelineResult = { ...pipelineResult, staging: discoveryResult.updatedStaging };
            // Rebuild walletFile to include new addresses in scriptInventory
            const rebuilt = this.buildSchemaFromDB(walletId);
            if (rebuilt) {
              walletFile = rebuilt;
            }
          }
        } catch (discoveryErr: any) {
          // Discovery failure is non-fatal — proceed with existing addresses
          logger.perfEnd('engine-discovery');
          SyncLogger.warn('engine', `Discovery failed (non-fatal): ${discoveryErr?.message || discoveryErr}`);
        }
      }

      // ── Two-Phase Commit ──────────────────────────────────────────

      // Phase 1: VALIDATE
      logger.perfStart('engine-validate');
      const validation = this.validator.validate(
        pipelineResult.staging,
        walletFile.lkg,
        walletFile
      );
      logger.perfEnd('engine-validate');

      if (!validation.valid) {
        const errorMsg = `Validation failed: ${validation.errors.join('; ')}`;
        SyncLogger.error('engine', errorMsg);
        this.handleSyncError(walletId, walletFile, errorMsg);
        return { ok: false, error: errorMsg, preservedLkg: true };
      }

      if (validation.warnings.length > 0) {
        SyncLogger.warn('engine', `Validation warnings: ${validation.warnings.join('; ')}`);
      }

      // Phase 2: BUILD new LKG from staging
      logger.perfStart('engine-build-lkg');
      const previousBalance = walletFile.lkg.confirmedBalanceSat + walletFile.lkg.unconfirmedBalanceSat;
      const newLkg = this.buildLkgFromStaging(
        pipelineResult.staging,
        walletFile
      );
      logger.perfEnd('engine-build-lkg');

      SyncLogger.log('engine', `New LKG built: utxos=${newLkg.utxos.length}, txs=${(newLkg.transactions||[]).length}, confirmed=${newLkg.confirmedBalanceSat}, unconfirmed=${newLkg.unconfirmedBalanceSat}, prevBal=${previousBalance}`);

      // Phase 3: ATOMIC COMMIT — dual write to both SQLite DB and V2 JSON
      // SQLite is the primary store; V2 JSON kept as backup during transition

      // 3a. Commit to SQLite database (primary)
      try {
        logger.perfStart('engine-db-mapping');
        const db = WalletDatabase.shared();
        const dbUtxos: UtxoRow[] = newLkg.utxos.map(u => ({
          walletId,
          txid: u.txid,
          vout: u.vout,
          valueSat: u.valueSat,
          height: u.height,
          address: u.address,
          scriptPubKey: u.scriptPubKey,
          scriptType: u.scriptType,
          scripthash: u.scripthash,
          confirmations: u.confirmations,
          isFrozen: 0,
          isLocked: 0,
          userNote: null,
          userTags: null,
        }));

        const dbTransactions: TransactionRow[] = newLkg.transactions.map(tx => ({
          walletId,
          txid: tx.txid,
          firstSeenAt: tx.firstSeenAt,
          blockHeight: tx.blockHeight ?? null,
          confirmations: tx.confirmations,
          direction: tx.direction,
          valueDeltaSat: tx.valueDeltaSat,
          feeSat: tx.feeSat,
          feeRate: tx.feeRate,
          isRBF: tx.isRBF ? 1 : 0,
          status: tx.status,
          inputCount: tx.inputCount,
          outputCount: tx.outputCount,
          size: tx.size,
          vsize: tx.vsize,
          userNote: null,
          userTags: null,
        }));

        const dbTxDetails: TxDetailRow[] = Object.entries(newLkg.txDetails).map(([txid, detail]) => ({
          walletId,
          txid,
          rawHex: detail.rawHex,
          inputs: JSON.stringify(detail.inputs),
          outputs: JSON.stringify(detail.outputs),
          blockTime: detail.blockTime,
          size: detail.size,
          vsize: detail.vsize,
        }));

        logger.perfEnd('engine-db-mapping');
        db.commitSyncResults(walletId, {
          utxos: dbUtxos,
          transactions: dbTransactions,
          txDetails: dbTxDetails,
          tipHeight: newLkg.tipHeightAtCommit ?? pipelineResult.staging.meta.tipHeight,
          serverUsed: pipelineResult.staging.meta.serverUsed,
        });

        SyncLogger.log('engine', `DB commit OK: ${dbUtxos.length} utxos, ${dbTransactions.length} txs, ${dbTxDetails.length} details`);
      } catch (dbError: any) {
        SyncLogger.warn('engine', `DB commit failed (non-fatal): ${dbError?.message || dbError}`);
      }

      // 3b. Update in-memory cache directly from the new LKG (DB is the source of truth)
      walletFile.lkg = newLkg;
      walletFile.syncState.status = 'synced';
      walletFile.syncState.lastSuccessfulSyncAt = Date.now();
      walletFile.syncState.lastKnownTipHeight = newLkg.tipHeightAtCommit ?? pipelineResult.staging.meta.tipHeight;
      walletFile.syncState.lastServerUsed = pipelineResult.staging.meta.serverUsed;
      walletFile.syncState.failureCount = 0;
      walletFile.syncState.lastError = null;
      walletFile.syncState.lastErrorAt = null;
      walletFile.syncState.isStale = false;
      this.loadedWallets.set(walletId, walletFile);

      // Compute outcome metrics
      const newBalance = newLkg.confirmedBalanceSat + newLkg.unconfirmedBalanceSat;
      const newTxCount = this.countNewTransactions(
        newLkg.transactions,
        walletFile.lkg.transactions
      );

      // Reconcile UTXO metadata (prune stale entries for spent UTXOs)
      this.reconcileUtxoMetadata(walletId);

      // Notify listeners
      this.notifySyncStatus(walletId, walletFile.syncState);
      this.notifyLkgUpdate(walletId);

      // Activate real-time subscriptions in background (non-blocking)
      // Subscriptions enable real-time updates but are not needed for sync result
      const knownTxids = new Set(newLkg.transactions.map(tx => tx.txid));
      logger.perfStart('subscription-activate');
      SubscriptionManager.shared().activate(
        client,
        walletFile.scriptInventory.addresses,
        'mainnet',
        knownTxids,
        newLkg.utxos,
        newLkg.txDetails,
        newLkg.tipHeightAtCommit ?? 0,
      ).then(() => {
        logger.perfEnd('subscription-activate');
        SyncLogger.log('engine', `Subscriptions activated: ${walletFile.scriptInventory.addresses.length} addresses`);
      }).catch((subErr: any) => {
        logger.perfEnd('subscription-activate');
        SyncLogger.warn('engine', `Subscription activation failed (non-fatal): ${subErr?.message || subErr}`);
      });

      const durationMs = Date.now() - startTime;

      // Log warnings if any
      if (validation.warnings.length > 0) {
      }

      return {
        ok: true,
        newTxCount,
        balanceChanged: newBalance !== previousBalance,
        durationMs,
      };
    } finally {
      logger.perfEnd('engine-sync');
      this.activeSyncs.delete(walletId);
    }
  }

  /**
   * Cancel an in-progress sync for a wallet.
   */
  cancelSync(walletId: string): void {
    const token = this.activeSyncs.get(walletId);
    if (token) {
      token.cancel = true;
    }
  }

  /**
   * Check if a sync is currently in progress for a wallet.
   */
  isSyncing(walletId: string): boolean {
    return this.activeSyncs.has(walletId);
  }

  // ─── LKG Builder ─────────────────────────────────────────────────

  /**
   * Build a new LKG snapshot from validated staging data.
   *
   * - Preserves firstSeenAt from previous LKG entries
   * - Preserves trackedTransactions from previous LKG
   * - Recomputes balances from staging UTXOs
   * - Sorts: pending first (newest), then confirmed (newest)
   */
  private buildLkgFromStaging(
    staging: StagingSnapshot,
    walletFile: WalletFileV2Schema
  ): LkgSnapshot {
    const previousLkg = walletFile.lkg;

    // Build lookup for previous transaction data
    const prevTxMap = new Map<string, LkgTransaction>();
    for (const tx of previousLkg.transactions) {
      prevTxMap.set(tx.txid, tx);
    }

    // Build LkgTransaction[] from staging history + tx details
    // Single pass: collect both txids and height map simultaneously
    const allTxids = new Set<string>();
    const heightMap = new Map<string, number>();
    for (const entries of Object.values(staging.historyMap)) {
      for (const entry of entries) {
        allTxids.add(entry.txHash);
        const existing = heightMap.get(entry.txHash);
        // Keep the best-known height (highest, or keep confirmed over unconfirmed)
        if (!existing || entry.height > existing) {
          heightMap.set(entry.txHash, entry.height);
        }
      }
    }

    // Build wallet address set for ownership detection
    const walletAddresses = new Set(
      walletFile.scriptInventory.addresses.map(a => a.address)
    );

    const transactions: LkgTransaction[] = [];

    for (const txid of allTxids) {
      const height = heightMap.get(txid) ?? 0;
      const detail = staging.txDetails[txid];
      const prevTx = prevTxMap.get(txid);

      // Compute value delta and fee from tx details
      let valueDeltaSat = 0;
      let feeSat = 0;
      let inputCount = 0;
      let outputCount = 0;
      let size = 0;
      let vsize = 0;
      let feeRate = 0;
      let isRBF = false;
      let isSelfTransfer = false;

      if (detail) {
        // Compute wallet balance change
        let walletInputSum = 0;
        let walletOutputSum = 0;
        let totalInputSum = 0;
        let totalOutputSum = 0;
        let walletInputCount = 0;
        let walletOutputCount = 0;
        const hasResolvedInputs = detail.inputs.length === 0 ||
          detail.inputs.some(inp => inp.valueSat > 0 || inp.address !== '' || inp.prevTxid === '');

        for (const inp of detail.inputs) {
          totalInputSum += inp.valueSat;
          if (inp.isWalletOwned || walletAddresses.has(inp.address)) {
            walletInputSum += inp.valueSat;
            walletInputCount++;
          }
        }
        for (const out of detail.outputs) {
          totalOutputSum += out.valueSat;
          if (out.isWalletOwned || (out.address && walletAddresses.has(out.address))) {
            walletOutputSum += out.valueSat;
            walletOutputCount++;
          }
        }

        valueDeltaSat = walletOutputSum - walletInputSum;
        feeSat = totalInputSum > 0 ? totalInputSum - totalOutputSum : 0;
        inputCount = detail.inputs.length;
        outputCount = detail.outputs.length;
        size = detail.size;
        vsize = detail.vsize;
        feeRate = vsize > 0 ? Math.round(feeSat / vsize) : 0;

        // Detect self-transfer: all inputs owned by wallet AND all outputs owned by wallet
        // Only if we have resolved inputs (otherwise we can't reliably detect)
        if (hasResolvedInputs && walletInputCount > 0 && walletInputCount === inputCount) {
          // All inputs are wallet-owned — check if all outputs are too
          if (walletOutputCount === outputCount) {
            isSelfTransfer = true;
            // For self-transfer, valueDelta = negative fee (wallet lost only the fee)
            valueDeltaSat = -feeSat;
          }
        }
      } else if (prevTx) {
        // Fallback to previous LKG data
        valueDeltaSat = prevTx.valueDeltaSat;
        feeSat = prevTx.feeSat;
        inputCount = prevTx.inputCount;
        outputCount = prevTx.outputCount;
        size = prevTx.size;
        vsize = prevTx.vsize;
        feeRate = prevTx.feeRate;
        isRBF = prevTx.isRBF;
      }

      transactions.push({
        txid,
        firstSeenAt: prevTx?.firstSeenAt ?? Date.now(),
        blockHeight: height > 0 ? height : null,
        confirmations: height > 0
          ? Math.max(0, staging.meta.tipHeight - height + 1)
          : 0,
        direction: isSelfTransfer ? 'self-transfer' : (valueDeltaSat >= 0 ? 'incoming' : 'outgoing'),
        valueDeltaSat,
        feeSat,
        feeRate,
        isRBF,
        status: height > 0 ? 'confirmed' : 'pending',
        inputCount,
        outputCount,
        size,
        vsize,
      });
    }

    // Sort: pending first (newest firstSeenAt), then confirmed (newest blockHeight)
    transactions.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      if (a.status === 'pending' && b.status === 'pending') {
        return b.firstSeenAt - a.firstSeenAt;
      }
      // Both confirmed — sort by block height descending
      return (b.blockHeight ?? 0) - (a.blockHeight ?? 0);
    });

    // Compute balance from UTXOs only
    const balance = computeBalanceFromUtxos(staging.utxos);

    // Preserve tracked transactions from previous LKG
    const trackedMap = new Map<string, TrackedTransaction>(
      previousLkg.trackedTransactions
    );

    return {
      utxos: staging.utxos,
      transactions,
      txDetails: staging.txDetails,
      confirmedBalanceSat: balance.confirmed,
      unconfirmedBalanceSat: balance.unconfirmed,
      trackedTransactions: Array.from(trackedMap.entries()),
      committedAt: Date.now(),
      tipHeightAtCommit: staging.meta.tipHeight,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Check if a wallet should be synced based on staleness.
   * Default: stale after 2 minutes.
   */
  private shouldSync(walletFile: WalletFileV2Schema): boolean {
    const STALE_THRESHOLD_MS = 120_000; // 2 minutes
    const lastSync = walletFile.syncState.lastSuccessfulSyncAt;
    if (!lastSync) return true;
    return Date.now() - lastSync > STALE_THRESHOLD_MS;
  }

  /**
   * Handle a sync error — update DB and in-memory cache.
   * NEVER modifies LKG.
   */
  private handleSyncError(
    walletId: string,
    walletFile: WalletFileV2Schema,
    error: string
  ): void {
    // Record error in DB
    try {
      WalletDatabase.shared().recordSyncError(walletId, error);
    } catch {}

    // Update in-memory cache sync state
    walletFile.syncState.status = 'error';
    walletFile.syncState.lastError = error;
    walletFile.syncState.lastErrorAt = Date.now();
    walletFile.syncState.failureCount = (walletFile.syncState.failureCount ?? 0) + 1;
    this.loadedWallets.set(walletId, walletFile);
    this.notifySyncStatus(walletId, walletFile.syncState);
  }

  /**
   * Count new transactions compared to previous LKG.
   */
  private countNewTransactions(
    newTxs: LkgTransaction[],
    prevTxs: LkgTransaction[]
  ): number {
    const prevIds = new Set(prevTxs.map(tx => tx.txid));
    return newTxs.filter(tx => !prevIds.has(tx.txid)).length;
  }

  // ─── Events ───────────────────────────────────────────────────────

  /**
   * Subscribe to sync status changes.
   * Returns unsubscribe function.
   */
  onSyncStatusChange(cb: SyncStatusCallback): () => void {
    this.syncStatusListeners.add(cb);
    return () => this.syncStatusListeners.delete(cb);
  }

  /**
   * Subscribe to LKG updates (new data committed).
   * Returns unsubscribe function.
   */
  onLkgUpdate(cb: LkgUpdateCallback): () => void {
    this.lkgUpdateListeners.add(cb);
    return () => this.lkgUpdateListeners.delete(cb);
  }

  private notifySyncStatus(walletId: string, status: SyncStateData): void {
    for (const cb of this.syncStatusListeners) {
      try { cb(walletId, status); } catch {}
    }
  }

  private notifyLkgUpdate(walletId: string): void {
    for (const cb of this.lkgUpdateListeners) {
      try { cb(walletId); } catch {}
    }
  }

  // ─── User Metadata Migration ─────────────────────────────────────

  /**
   * Migrate transaction labels and UTXO metadata from legacy
   * AsyncStorage-based stores into the wallet file.
   * Runs once per wallet on first loadWallet() after upgrade.
   * Detected by checking if txUserMetadata has never been initialized.
   */
  private migrateUserMetadataIfNeeded(data: WalletFileV2Schema): void {
    try {
      // Only migrate if txUserMetadata was just defaulted (empty object from applyOptionalDefaults)
      // AND there are transactions in LKG that might have labels
      if (
        data.txUserMetadata !== undefined &&
        Object.keys(data.txUserMetadata).length === 0 &&
        data.lkg.transactions.length > 0
      ) {
        this.migrateTransactionLabels(data);
      }

      if (
        data.utxoUserMetadata !== undefined &&
        Object.keys(data.utxoUserMetadata).length === 0 &&
        data.lkg.utxos.length > 0
      ) {
        this.migrateUtxoMetadata(data);
      }
    } catch (error) {
      // Migration is best-effort — don't block wallet loading
    }
  }

  /**
   * Migrate transaction labels from useTransactionLabelStore (AsyncStorage)
   * into the in-memory schema's txUserMetadata.
   */
  private migrateTransactionLabels(data: WalletFileV2Schema): void {
    try {
      // Dynamically import to avoid circular dependency
      const { useTransactionLabelStore } = require('../../stores/transactionLabelStore');
      const labelStore = useTransactionLabelStore.getState();
      const labels = labelStore.labels;
      if (!labels || Object.keys(labels).length === 0) return;

      // Build set of txids in this wallet
      const walletTxids = new Set(data.lkg.transactions.map(tx => tx.txid));

      const migrated: Record<string, TxUserMetadata> = {};

      for (const [txid, label] of Object.entries(labels)) {
        if (walletTxids.has(txid)) {
          migrated[txid] = {
            note: (label as any).note ?? undefined,
            tags: (label as any).tags ?? undefined,
            createdAt: (label as any).createdAt ?? Date.now(),
            editedAt: (label as any).updatedAt ?? Date.now(),
          };
        }
      }

      if (Object.keys(migrated).length > 0) {
        data.txUserMetadata = migrated;
      }
    } catch {
      // Best effort — legacy store may not be available
    }
  }

  /**
   * Migrate UTXO metadata from useUTXOStore (AsyncStorage)
   * into the in-memory schema's utxoUserMetadata.
   */
  private migrateUtxoMetadata(data: WalletFileV2Schema): void {
    try {
      const { useUTXOStore } = require('../../stores/utxoStore');
      const utxoStore = useUTXOStore.getState();
      const utxoMeta = utxoStore.utxoMetadata;
      if (!utxoMeta || Object.keys(utxoMeta).length === 0) return;

      // Build set of outpoints in this wallet
      const walletOutpoints = new Set(
        data.lkg.utxos.map(u => `${u.txid}:${u.vout}`)
      );

      const migrated: Record<string, UtxoUserMetadata> = {};

      for (const [outpoint, meta] of Object.entries(utxoMeta)) {
        if (walletOutpoints.has(outpoint)) {
          const m = meta as any;
          migrated[outpoint] = {
            note: m.note ?? undefined,
            tags: m.tags ?? undefined,
            isFrozen: m.isFrozen ?? false,
            isLocked: m.isLocked ?? false,
            createdAt: m.createdAt ?? Date.now(),
          };
        }
      }

      if (Object.keys(migrated).length > 0) {
        data.utxoUserMetadata = migrated;
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Reconcile UTXO user metadata after a sync commit.
   * - Retains metadata for UTXOs that still exist
   * - For spent UTXOs: retains metadata for 90 days
   * - Prunes metadata older than 90 days for spent UTXOs
   */
  reconcileUtxoMetadata(walletId: string): void {
    try {
      const data = this.loadedWallets.get(walletId);
      if (!data?.utxoUserMetadata) return;
      if (Object.keys(data.utxoUserMetadata).length === 0) return;

      const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
      const now = Date.now();
      const currentOutpoints = new Set(
        data.lkg.utxos.map(u => `${u.txid}:${u.vout}`)
      );

      const reconciled: Record<string, UtxoUserMetadata> = {};
      let pruned = 0;

      for (const [outpoint, meta] of Object.entries(data.utxoUserMetadata)) {
        if (currentOutpoints.has(outpoint)) {
          // UTXO still exists — keep metadata
          reconciled[outpoint] = meta;
        } else {
          // UTXO spent — keep if within retention period
          const createdAt = meta.createdAt ?? 0;
          if (now - createdAt < RETENTION_MS) {
            reconciled[outpoint] = meta;
          } else {
            pruned++;
          }
        }
      }

      if (pruned > 0) {
        data.utxoUserMetadata = reconciled;
      }
    } catch {
      // Best effort
    }
  }

  // ─── Cache Management ─────────────────────────────────────────────

  /**
   * Evict a wallet from the in-memory cache.
   * Useful when switching wallets to free memory.
   */
  evictWallet(walletId: string): void {
    this.loadedWallets.delete(walletId);
  }

  /**
   * Clear all in-memory caches.
   */
  clearAll(): void {
    this.loadedWallets.clear();
    this.activeSyncs.clear();
  }

  // ─── Singleton ────────────────────────────────────────────────────

  private static _instance: WalletEngine | null = null;

  static shared(): WalletEngine {
    if (!this._instance) {
      this._instance = new WalletEngine();
    }
    return this._instance;
  }
}
