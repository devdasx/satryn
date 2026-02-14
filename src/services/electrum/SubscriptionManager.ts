/**
 * SubscriptionManager — Real-Time Subscription Engine
 *
 * Uses blockchain.scripthash.subscribe + blockchain.headers.subscribe
 * to detect new transactions and block confirmations in near-real-time (<2s).
 *
 * Flow:
 * 1. After initial sync, activate() subscribes to all wallet scripthashes + headers
 * 2. Server pushes notification when any scripthash's history changes
 * 3. We fetch ONLY the changed scripthash's history + UTXOs (~200ms)
 * 4. Diff against known data, fetch new tx details
 * 5. Emit events for UI to update
 *
 * Reconnection: On auto-reconnect, re-subscribes everything automatically.
 */

import { ElectrumClient } from './ElectrumClient';
import { addressToScripthash } from './scripthash';
import { SyncLogger } from '../SyncLogger';
import type { ElectrumHeader, ElectrumUTXO, ElectrumHistoryItem } from './types';
import type { AddressInfo, BalanceInfo } from '../../types';
import type {
  LkgUtxo,
  LkgTransaction,
  TxDetailEntry,
  TxDetailInput,
  TxDetailOutput,
  CanonicalScriptType,
} from '../sync/types';
import { computeBalanceFromUtxos } from '../sync/types';

// ─── Types ──────────────────────────────────────────────────────────

interface ScripthashInfo {
  scripthash: string;
  address: string;
  isChange: boolean;
  lastStatus: string | null;
}

export interface RealtimeUpdate {
  transactions: LkgTransaction[];
  balance: { confirmed: number; unconfirmed: number; total: number };
  utxos: LkgUtxo[];
  newTxids: string[];
  txDetails: Record<string, TxDetailEntry>;
}

type TransactionCallback = (update: RealtimeUpdate) => void;
type BalanceCallback = (balance: { confirmed: number; unconfirmed: number; total: number }) => void;
type BlockHeightCallback = (height: number) => void;

// ─── SubscriptionManager ────────────────────────────────────────────

export class SubscriptionManager {
  private static _instance: SubscriptionManager | null = null;

  private client: ElectrumClient | null = null;
  private active = false;
  private scripthashMap: Map<string, ScripthashInfo> = new Map(); // scripthash → info
  private addressToScripthashMap: Map<string, string> = new Map(); // address → scripthash
  private walletAddresses: Set<string> = new Set();
  private knownTxids: Set<string> = new Set();
  private knownUtxos: Map<string, LkgUtxo> = new Map(); // "txid:vout" → utxo
  private knownTxDetails: Record<string, TxDetailEntry> = {};
  private tipHeight: number = 0;
  private network: 'mainnet' | 'testnet' = 'mainnet';

  // Reconnect handler reference (so we can remove it)
  private reconnectHandler: (() => void) | null = null;

  // Event callbacks
  private transactionListeners: Set<TransactionCallback> = new Set();
  private balanceListeners: Set<BalanceCallback> = new Set();
  private blockHeightListeners: Set<BlockHeightCallback> = new Set();

  // Debounce: batch multiple scripthash notifications
  private pendingScripthashes: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static DEBOUNCE_MS = 300; // Batch notifications within 300ms window

  static shared(): SubscriptionManager {
    if (!SubscriptionManager._instance) {
      SubscriptionManager._instance = new SubscriptionManager();
    }
    return SubscriptionManager._instance;
  }

  // ─── Activation ────────────────────────────────────────────────────

  /**
   * Activate subscriptions for a wallet.
   * Call after initial sync succeeds.
   *
   * @param client - Connected ElectrumClient (persistent, NOT throwaway)
   * @param addresses - All wallet addresses (receive + change)
   * @param network - Bitcoin network
   * @param knownTxids - Set of txids already known from LKG
   * @param knownUtxos - Current UTXO set from LKG
   * @param knownTxDetails - Current tx details from LKG
   * @param tipHeight - Current chain tip height
   */
  async activate(
    client: ElectrumClient,
    addresses: AddressInfo[],
    network: 'mainnet' | 'testnet',
    knownTxids: Set<string>,
    knownUtxos: LkgUtxo[],
    knownTxDetails: Record<string, TxDetailEntry>,
    tipHeight: number,
  ): Promise<void> {
    // Deactivate previous if any
    if (this.active) {
      this.deactivate();
    }

    this.client = client;
    this.network = network;
    this.active = true;
    this.tipHeight = tipHeight;
    this.knownTxids = new Set(knownTxids);
    this.knownTxDetails = { ...knownTxDetails };

    // Build address → scripthash mappings
    this.walletAddresses = new Set(addresses.map(a => a.address));
    this.scripthashMap.clear();
    this.addressToScripthashMap.clear();
    this.knownUtxos.clear();

    for (const utxo of knownUtxos) {
      this.knownUtxos.set(`${utxo.txid}:${utxo.vout}`, utxo);
    }

    for (const addr of addresses) {
      try {
        const sh = addressToScripthash(addr.address, network);
        this.scripthashMap.set(sh, {
          scripthash: sh,
          address: addr.address,
          isChange: addr.isChange,
          lastStatus: null,
        });
        this.addressToScripthashMap.set(addr.address, sh);
      } catch (e) {
        SyncLogger.warn('subscriptions', `Failed to compute scripthash for ${addr.address}: ${e}`);
      }
    }

    // Register reconnect handler
    this.reconnectHandler = () => this.handleReconnect();
    client.onReconnect(this.reconnectHandler);

    // Subscribe to all scripthashes + headers
    await this.subscribeAll();

    SyncLogger.log('subscriptions', `Activated: ${this.scripthashMap.size} scripthashes, tip=${tipHeight}`);
  }

  /**
   * Deactivate all subscriptions.
   */
  deactivate(): void {
    if (this.client && this.reconnectHandler) {
      this.client.offReconnect(this.reconnectHandler);
    }
    if (this.client) {
      this.client.clearSubscriptions();
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.active = false;
    this.client = null;
    this.reconnectHandler = null;
    this.scripthashMap.clear();
    this.addressToScripthashMap.clear();
    this.walletAddresses.clear();
    this.knownTxids.clear();
    this.knownUtxos.clear();
    this.knownTxDetails = {};
    this.pendingScripthashes.clear();
    this.tipHeight = 0;

    SyncLogger.log('subscriptions', 'Deactivated');
  }

  isActive(): boolean {
    return this.active;
  }

  // ─── Event Registration ────────────────────────────────────────────

  onTransaction(cb: TransactionCallback): () => void {
    this.transactionListeners.add(cb);
    return () => this.transactionListeners.delete(cb);
  }

  onBalanceChange(cb: BalanceCallback): () => void {
    this.balanceListeners.add(cb);
    return () => this.balanceListeners.delete(cb);
  }

  onBlockHeight(cb: BlockHeightCallback): () => void {
    this.blockHeightListeners.add(cb);
    return () => this.blockHeightListeners.delete(cb);
  }

  // ─── Internal: Subscribe All ───────────────────────────────────────

  private async subscribeAll(): Promise<void> {
    if (!this.client || !this.active) return;

    const scripthashes = Array.from(this.scripthashMap.keys());
    if (scripthashes.length === 0) return;

    try {
      // Subscribe to all scripthashes in one batch
      const statuses = await this.client.subscribeScripthashes(
        scripthashes,
        (scripthash, status) => this.handleScripthashChange(scripthash, status),
      );

      // Record initial statuses
      for (let i = 0; i < scripthashes.length; i++) {
        const info = this.scripthashMap.get(scripthashes[i]);
        if (info) {
          info.lastStatus = statuses[i];
        }
      }

      SyncLogger.log('subscriptions', `Subscribed to ${scripthashes.length} scripthashes`);
    } catch (e) {
      SyncLogger.error('subscriptions', `Failed to subscribe scripthashes: ${e}`);
    }

    try {
      // Subscribe to block headers
      const header = await this.client.subscribeHeaders(
        (header) => this.handleNewBlock(header),
      );
      if (header) {
        this.tipHeight = header.height;
      }
      SyncLogger.log('subscriptions', `Subscribed to headers, tip=${this.tipHeight}`);
    } catch (e) {
      SyncLogger.error('subscriptions', `Failed to subscribe headers: ${e}`);
    }
  }

  // ─── Handlers ──────────────────────────────────────────────────────

  /**
   * Called when a scripthash status changes (new tx, confirmation, etc.)
   * Uses debouncing to batch multiple rapid notifications.
   */
  private handleScripthashChange(scripthash: string, newStatus: string | null): void {
    if (!this.active) return;

    const info = this.scripthashMap.get(scripthash);
    if (!info) return;

    // Skip if status hasn't actually changed
    if (info.lastStatus === newStatus) return;
    info.lastStatus = newStatus;

    SyncLogger.log('subscriptions', `Scripthash changed: ${info.address} (${scripthash.slice(0, 12)}...)`);

    // Add to pending batch
    this.pendingScripthashes.add(scripthash);

    // Debounce: wait for more notifications before processing
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, SubscriptionManager.DEBOUNCE_MS);
  }

  /**
   * Process all pending scripthash changes in one batch.
   */
  private async processPendingChanges(): Promise<void> {
    if (!this.client || !this.active || this.pendingScripthashes.size === 0) return;

    const changedScripthashes = Array.from(this.pendingScripthashes);
    this.pendingScripthashes.clear();

    SyncLogger.log('subscriptions', `Processing ${changedScripthashes.length} changed scripthashes`);

    try {
      // Fetch histories + UTXOs for changed scripthashes in parallel
      const historyRequests = changedScripthashes.map(sh => ({
        method: 'blockchain.scripthash.get_history',
        params: [sh],
      }));
      const utxoRequests = changedScripthashes.map(sh => ({
        method: 'blockchain.scripthash.listunspent',
        params: [sh],
      }));

      const [histories, utxoSets] = await Promise.all([
        this.client.batchRequest<ElectrumHistoryItem[]>(historyRequests),
        this.client.batchRequest<ElectrumUTXO[]>(utxoRequests),
      ]);

      // Identify new txids
      const newTxids: string[] = [];
      for (const history of histories) {
        if (!history || !Array.isArray(history)) continue;
        for (const item of history) {
          if (!this.knownTxids.has(item.tx_hash)) {
            newTxids.push(item.tx_hash);
            this.knownTxids.add(item.tx_hash);
          }
        }
      }

      // Also check for confirmation changes on known txids
      const heightChanges = new Map<string, number>();
      for (const history of histories) {
        if (!history || !Array.isArray(history)) continue;
        for (const item of history) {
          if (item.height > 0) {
            heightChanges.set(item.tx_hash, item.height);
          }
        }
      }

      // Update UTXOs from changed scripthashes
      // Build set of changed addresses for O(1) lookup instead of O(n²) nested loop
      const changedAddresses = new Set<string>();
      for (const sh of changedScripthashes) {
        const info = this.scripthashMap.get(sh);
        if (info) changedAddresses.add(info.address);
      }
      // Single pass: remove UTXOs belonging to changed addresses
      const newUtxoMap = new Map<string, LkgUtxo>();
      for (const [key, utxo] of this.knownUtxos) {
        if (!changedAddresses.has(utxo.address)) {
          newUtxoMap.set(key, utxo);
        }
      }
      // Add fresh UTXOs
      for (let i = 0; i < changedScripthashes.length; i++) {
        const sh = changedScripthashes[i];
        const info = this.scripthashMap.get(sh);
        const utxos = utxoSets[i];
        if (!info || !utxos || !Array.isArray(utxos)) continue;

        for (const u of utxos) {
          const key = `${u.tx_hash}:${u.tx_pos}`;
          newUtxoMap.set(key, {
            txid: u.tx_hash,
            vout: u.tx_pos,
            valueSat: u.value,
            height: u.height,
            address: info.address,
            scriptPubKey: '',
            scriptType: 'p2wpkh' as CanonicalScriptType, // Will be refined by full sync
            scripthash: sh,
            confirmations: u.height > 0 ? Math.max(0, this.tipHeight - u.height + 1) : 0,
          });
        }
      }
      this.knownUtxos = newUtxoMap;

      // Fetch tx details for new txids
      let newTxDetails: Record<string, TxDetailEntry> = {};
      if (newTxids.length > 0) {
        newTxDetails = await this.fetchTxDetails(newTxids);
        Object.assign(this.knownTxDetails, newTxDetails);
      }

      // Build updated transactions list and balance
      const allUtxos = Array.from(this.knownUtxos.values());
      const balance = computeBalanceFromUtxos(allUtxos);

      // Build LkgTransactions for new txids
      const newTransactions: LkgTransaction[] = [];
      for (const txid of newTxids) {
        const detail = this.knownTxDetails[txid];
        const height = heightChanges.get(txid) ?? 0;
        const tx = this.buildLkgTransaction(txid, height, detail);
        newTransactions.push(tx);
      }

      // Check for confirmation updates on existing txs
      for (const [txid, newHeight] of heightChanges) {
        if (newTxids.includes(txid)) continue; // Already handled above
        // Update confirmation for existing txs — emit as part of the update
      }

      // Emit events
      if (newTxids.length > 0 || this.hasBalanceChanged(balance)) {
        const update: RealtimeUpdate = {
          transactions: newTransactions,
          balance,
          utxos: allUtxos,
          newTxids,
          txDetails: newTxDetails,
        };

        for (const listener of this.transactionListeners) {
          try { listener(update); } catch (e) {
            SyncLogger.error('subscriptions', `Transaction listener error: ${e}`);
          }
        }
      }

      // Always emit balance
      for (const listener of this.balanceListeners) {
        try { listener(balance); } catch (e) {
          SyncLogger.error('subscriptions', `Balance listener error: ${e}`);
        }
      }

      SyncLogger.log('subscriptions', `Processed: ${newTxids.length} new txs, balance=${balance.total} sat`);
    } catch (e) {
      SyncLogger.error('subscriptions', `Error processing changes: ${e}`);
    }
  }

  /**
   * Called when a new block is found.
   */
  private handleNewBlock(header: ElectrumHeader): void {
    if (!this.active) return;

    const oldHeight = this.tipHeight;
    this.tipHeight = header.height;

    SyncLogger.log('subscriptions', `New block: ${header.height} (was ${oldHeight})`);

    // Update confirmations on all UTXOs
    for (const utxo of this.knownUtxos.values()) {
      if (utxo.height > 0) {
        utxo.confirmations = Math.max(0, this.tipHeight - utxo.height + 1);
      }
    }

    // Emit block height
    for (const listener of this.blockHeightListeners) {
      try { listener(header.height); } catch (e) {
        SyncLogger.error('subscriptions', `Block height listener error: ${e}`);
      }
    }
  }

  /**
   * Called after auto-reconnect: re-subscribe all scripthashes + headers.
   */
  private async handleReconnect(): Promise<void> {
    if (!this.active) return;
    SyncLogger.log('subscriptions', 'Reconnected — re-subscribing all...');

    try {
      await this.subscribeAll();

      // Quick refresh: check for changes missed while disconnected
      const allScripthashes = Array.from(this.scripthashMap.keys());
      // Mark all as pending to force a full refresh
      for (const sh of allScripthashes) {
        this.pendingScripthashes.add(sh);
      }
      await this.processPendingChanges();
    } catch (e) {
      SyncLogger.error('subscriptions', `Reconnect re-subscribe failed: ${e}`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Fetch transaction details for a set of txids.
   * Uses verbose=true first, falls back to raw hex.
   */
  private async fetchTxDetails(txids: string[]): Promise<Record<string, TxDetailEntry>> {
    if (!this.client || txids.length === 0) return {};

    const details: Record<string, TxDetailEntry> = {};

    try {
      const requests = txids.map(txid => ({
        method: 'blockchain.transaction.get',
        params: [txid, true], // verbose=true
      }));

      const results = await this.client.batchRequest<any>(requests);

      for (let i = 0; i < results.length; i++) {
        const txid = txids[i];
        const result = results[i];

        if (!result || typeof result !== 'object') continue;

        try {
          details[txid] = this.decodeTxResult(result, txid);
        } catch {
          // Skip this tx — will be picked up by full sync
        }
      }
    } catch (e) {
      SyncLogger.error('subscriptions', `Failed to fetch tx details: ${e}`);
    }

    return details;
  }

  /**
   * Decode a verbose tx result into TxDetailEntry.
   */
  private extractAddress(scriptPubKey: any): string {
    if (!scriptPubKey) return '';
    if (scriptPubKey.address) return scriptPubKey.address;
    if (Array.isArray(scriptPubKey.addresses) && scriptPubKey.addresses.length > 0) {
      return scriptPubKey.addresses[0];
    }
    return '';
  }

  private decodeTxResult(tx: any, txid: string): TxDetailEntry {
    const inputs: TxDetailInput[] = (tx.vin || []).map((vin: any) => {
      // Use prevout if available (electrs 0.10+, some fulcrum versions)
      // Do NOT fall back to vin.address/vin.value — they don't exist in Electrum protocol
      const address = vin.prevout?.scriptpubkey_address ?? '';
      const valueSat = vin.prevout?.value ?? 0;
      return {
        prevTxid: vin.txid ?? '',
        prevVout: vin.vout ?? 0,
        address,
        valueSat,
        isWalletOwned: address ? this.walletAddresses.has(address) : false,
      };
    });

    const outputs: TxDetailOutput[] = (tx.vout || []).map((vout: any, idx: number) => {
      const address = this.extractAddress(vout.scriptPubKey);
      return {
        index: vout.n ?? idx,
        address: address || null,
        valueSat: typeof vout.value === 'number'
          ? Math.round(vout.value * 1e8)
          : vout.value ?? 0,
        scriptPubKey: vout.scriptPubKey?.hex ?? '',
        isWalletOwned: address ? this.walletAddresses.has(address) : false,
      };
    });

    return {
      txid,
      rawHex: tx.hex ?? '',
      inputs,
      outputs,
      blockTime: tx.blocktime ?? tx.time ?? null,
      size: tx.size ?? 0,
      vsize: tx.vsize ?? 0,
    };
  }

  /**
   * Build a LkgTransaction from txid + detail.
   */
  private buildLkgTransaction(
    txid: string,
    height: number,
    detail: TxDetailEntry | undefined,
  ): LkgTransaction {
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
      let walletInputSum = 0;
      let walletOutputSum = 0;
      let totalInputSum = 0;
      let totalOutputSum = 0;
      let walletInputCount = 0;
      let walletOutputCount = 0;

      for (const inp of detail.inputs) {
        totalInputSum += inp.valueSat;
        if (inp.isWalletOwned) {
          walletInputSum += inp.valueSat;
          walletInputCount++;
        }
      }
      for (const out of detail.outputs) {
        totalOutputSum += out.valueSat;
        if (out.isWalletOwned) {
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

      // Self-transfer detection
      if (walletInputCount > 0 && walletInputCount === inputCount && walletOutputCount === outputCount) {
        isSelfTransfer = true;
        valueDeltaSat = -feeSat;
      }
    }

    return {
      txid,
      firstSeenAt: Date.now(),
      blockHeight: height > 0 ? height : null,
      confirmations: height > 0 ? Math.max(0, this.tipHeight - height + 1) : 0,
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
    };
  }

  private lastEmittedBalance = { confirmed: 0, unconfirmed: 0 };

  private hasBalanceChanged(balance: { confirmed: number; unconfirmed: number; total: number }): boolean {
    const changed = balance.confirmed !== this.lastEmittedBalance.confirmed ||
      balance.unconfirmed !== this.lastEmittedBalance.unconfirmed;
    if (changed) {
      this.lastEmittedBalance = { confirmed: balance.confirmed, unconfirmed: balance.unconfirmed };
    }
    return changed;
  }

  /**
   * Get diagnostics for debugging.
   */
  getDiagnostics(): {
    active: boolean;
    scripthashCount: number;
    knownTxCount: number;
    utxoCount: number;
    tipHeight: number;
    pendingChanges: number;
  } {
    return {
      active: this.active,
      scripthashCount: this.scripthashMap.size,
      knownTxCount: this.knownTxids.size,
      utxoCount: this.knownUtxos.size,
      tipHeight: this.tipHeight,
      pendingChanges: this.pendingScripthashes.size,
    };
  }
}
