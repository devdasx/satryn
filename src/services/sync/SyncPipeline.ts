/**
 * SyncPipeline — 3-stage fetch algorithm for wallet sync
 *
 * Three stages, all results go to staging. Nothing touches LKG until validated.
 *
 * Stage 1: Fetch UTXOs  (blockchain.scripthash.listunspent)
 * Stage 2: Fetch Histories  (blockchain.scripthash.get_history)
 * Stage 3: Fetch Tx Details (blockchain.transaction.get)
 *
 * CRITICAL: Balance is computed ONLY from UTXOs. NO separate get_balance call.
 *
 * After fetching, the pipeline builds a StagingSnapshot that is passed to
 * SyncValidator for sanity checks, then committed (or discarded) by WalletEngine.
 */

import type { ElectrumClient } from '../electrum/ElectrumClient';
import type {
  ElectrumUTXO,
  ElectrumHistoryItem,
  ElectrumHeader,
} from '../electrum/types';
import { addressToScripthash } from '../electrum/scripthash';
import { WalletDatabase } from '../database/WalletDatabase';
import type {
  WalletFileV2Schema,
  LkgUtxo,
  TxDetailEntry,
  TxDetailInput,
  TxDetailOutput,
  StagingSnapshot,
  StagingHistoryEntry,
  StagingMeta,
  SyncOptions,
} from './types';
import type { CanonicalScriptType } from './types';
import type { AddressInfo } from '../../types';
import { SyncLogger } from '../SyncLogger';
import { logger } from '../../utils/logger';
import { guessScriptType } from '../../utils/addressTypeMap';

// ─── Constants ────────────────────────────────────────────────────────

const SYNC_BATCH_SIZE = 50;      // Larger batches to reduce round-trips (was 20)
const TX_FETCH_BATCH_SIZE = 40;  // Batch size for tx detail fetches (was 20)
const BATCH_DELAY_MS = 0;        // No delay between batch chunks (subscriptions handle real-time)

// ─── Types ────────────────────────────────────────────────────────────

interface ScripthashEntry {
  scripthash: string;
  address: string;
  addressType: CanonicalScriptType;
}

type PipelineResult =
  | { ok: true; staging: StagingSnapshot }
  | { ok: false; error: string };

/**
 * Chunk an array into smaller arrays of a given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SyncPipeline ─────────────────────────────────────────────────────

export class SyncPipeline {
  /**
   * Execute the full 3-stage sync pipeline.
   *
   * @param walletFile — Current V2 wallet file data (for address inventory + existing tx details)
   * @param client — Connected ElectrumClient instance
   * @param options — Sync options (force, fetchTxDetails, etc.)
   * @returns StagingSnapshot on success, or error string on failure
   */
  async execute(
    walletFile: WalletFileV2Schema,
    client: ElectrumClient,
    options: SyncOptions = {}
  ): Promise<PipelineResult> {
    const fetchTxDetails = options.fetchTxDetails ?? true;
    const serverInfo = client.getCurrentServer();
    const serverUsed = serverInfo
      ? `${serverInfo.host}:${serverInfo.port}`
      : 'unknown';

    try {
      // ── Build scripthash inventory from addresses ─────────────────
      const entries = this.buildScripthashEntries(
        walletFile.scriptInventory.addresses
      );

      if (entries.length === 0) {
        const tipHeight = await this.getChainTip(client);
        return {
          ok: true,
          staging: this.buildEmptyStaging(serverUsed, tipHeight),
        };
      }

      // ── Chain tip + Stage 1 + 2: ALL in parallel ────────────────
      // Chain tip is fetched concurrently with UTXO/history to save ~100ms
      logger.perfStart('pipeline-stage1+2');
      const [tipHeight, utxoResult, historyResult] = await Promise.all([
        this.getChainTip(client),
        this.stage1FetchUtxos(client, entries, 0), // tipHeight=0 temporarily
        this.stage2FetchHistories(client, entries),
      ]);
      // Fix up UTXO confirmations now that we have tipHeight
      for (const utxo of utxoResult.utxos) {
        utxo.confirmations = utxo.height > 0 ? Math.max(0, tipHeight - utxo.height + 1) : 0;
      }
      logger.perfEnd('pipeline-stage1+2');

      SyncLogger.log('pipeline', `Stage1 UTXOs: ${utxoResult.utxos.length} utxos, ${utxoResult.succeeded}/${entries.length} succeeded, totalValue=${utxoResult.utxos.reduce((s, u) => s + u.valueSat, 0)} sats`);
      const totalHistoryEntries = Object.values(historyResult.historyMap).reduce((s, h) => s + h.length, 0);
      SyncLogger.log('pipeline', `Stage2 Histories: ${totalHistoryEntries} entries across ${Object.keys(historyResult.historyMap).length} scripthashes, ${historyResult.succeeded}/${entries.length} succeeded`);

      // ── Stage 3: Fetch Transaction Details (optional) ─────────────
      logger.perfStart('pipeline-stage3-prep');
      let txDetails: Record<string, TxDetailEntry> = {};
      let txDetailsFetched = 0;
      let txDetailsMissing: string[] = [];

      if (fetchTxDetails) {
        // Collect all unique txids from history
        const allTxids = new Set<string>();
        for (const entries of Object.values(historyResult.historyMap)) {
          for (const entry of entries) {
            allTxids.add(entry.txHash);
          }
        }

        // Determine which txids we already have — try DB first (fast indexed query),
        // fall back to in-memory LKG txDetails
        let existingTxids: Set<string>;
        try {
          const db = WalletDatabase.shared();
          existingTxids = db.getExistingTxids(walletFile.walletId, Array.from(allTxids));
        } catch {
          // DB not available — fall back to LKG
          existingTxids = new Set(Object.keys(walletFile.lkg.txDetails));
        }

        // Check existing data for stale/broken entries that need re-fetch.
        // If existing tx_details have inputs with address='' and valueSat=0
        // (from a previous sync where prevout was missing), force re-fetch them.
        const staleTxids = new Set<string>();
        const existingDetails = walletFile.lkg.txDetails;

        // Check LKG details for stale inputs
        for (const [txid, detail] of Object.entries(existingDetails)) {
          if (this.hasUnresolvedInputs(detail)) {
            staleTxids.add(txid);
          }
        }

        // Also check DB-stored details for stale inputs
        try {
          const db = WalletDatabase.shared();
          const dbOnlyTxids = Array.from(existingTxids).filter(txid => !existingDetails[txid]);
          if (dbOnlyTxids.length > 0) {
            const dbDetails = db.getTxDetails(walletFile.walletId, dbOnlyTxids);
            for (const [txid, row] of Object.entries(dbDetails)) {
              try {
                const inputs = JSON.parse(row.inputs);
                for (const inp of inputs) {
                  if (inp.address === '' && inp.valueSat === 0 && inp.prevTxid) {
                    staleTxids.add(txid);
                    break;
                  }
                }
              } catch {}
            }
          }
        } catch {}

        if (staleTxids.size > 0) {
          SyncLogger.log('pipeline', `Found ${staleTxids.size} txids with unresolved inputs — will re-fetch`);
        }

        // Combine new txids + stale txids that need re-fetching
        const txidsToFetch = Array.from(allTxids).filter(
          txid => !existingTxids.has(txid) || staleTxids.has(txid)
        );

        // Merge existing details from LKG first (still needed for staging snapshot)
        txDetails = { ...existingDetails };

        // Also load any DB-only details that aren't in LKG
        try {
          const db = WalletDatabase.shared();
          const dbOnlyTxids = Array.from(existingTxids).filter(txid => !existingDetails[txid]);
          if (dbOnlyTxids.length > 0) {
            const dbDetails = db.getTxDetails(walletFile.walletId, dbOnlyTxids);
            for (const [txid, row] of Object.entries(dbDetails)) {
              try {
                txDetails[txid] = {
                  txid,
                  rawHex: row.rawHex,
                  inputs: JSON.parse(row.inputs),
                  outputs: JSON.parse(row.outputs),
                  blockTime: row.blockTime,
                  size: row.size,
                  vsize: row.vsize,
                };
              } catch {}
            }
          }
        } catch {}

        // Fetch new + stale tx details from Electrum
        if (txidsToFetch.length > 0) {
          logger.perfStart('pipeline-stage3-txdetails');
          const fetchResult = await this.stage3FetchTxDetails(
            client, txidsToFetch, entries, walletFile
          );
          logger.perfEnd('pipeline-stage3-txdetails');
          txDetailsFetched = fetchResult.fetched;
          txDetailsMissing = fetchResult.missing;
          // Merge newly fetched details (overwrite stale ones)
          Object.assign(txDetails, fetchResult.details);
        }

        // Also include details for existing txids that were already cached
        txDetailsFetched += allTxids.size - txidsToFetch.length;
      }

      logger.perfEnd('pipeline-stage3-prep');
      SyncLogger.log('pipeline', `Stage3 TxDetails: ${txDetailsFetched} fetched, ${txDetailsMissing.length} missing, totalDetails=${Object.keys(txDetails).length}`);

      // ── Build staging metadata ────────────────────────────────────
      const meta: StagingMeta = {
        serverUsed,
        fetchedAt: Date.now(),
        tipHeight,
        scripthashesQueried: entries.length,
        scripthashesSucceeded: utxoResult.succeeded + historyResult.succeeded
          ? Math.min(entries.length, Math.floor((utxoResult.succeeded + historyResult.succeeded) / 2))
          : 0,
        txDetailsFetched,
        txDetailsMissing,
        isComplete:
          utxoResult.succeeded === entries.length &&
          historyResult.succeeded === entries.length,
      };

      // ── Assemble StagingSnapshot ──────────────────────────────────
      const staging: StagingSnapshot = {
        utxos: utxoResult.utxos,
        historyMap: historyResult.historyMap,
        txDetails,
        meta,
      };

      return { ok: true, staging };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || 'Unknown sync pipeline error',
      };
    }
  }

  // ─── Preliminaries ────────────────────────────────────────────────

  /**
   * Get the current chain tip height.
   */
  private async getChainTip(client: ElectrumClient): Promise<number> {
    const header = await client.request<ElectrumHeader>(
      'blockchain.headers.subscribe',
      []
    );
    return header.height;
  }

  /**
   * Build scripthash entries from the wallet's address inventory.
   */
  private buildScripthashEntries(
    addresses: AddressInfo[]
  ): ScripthashEntry[] {
    return addresses.map(addr => ({
      scripthash: addressToScripthash(addr.address, 'mainnet'),
      address: addr.address,
      addressType: guessScriptType(addr.address),
    }));
  }

  // ─── Stage 1: Fetch UTXOs ────────────────────────────────────────

  /**
   * Fetch UTXOs for all scripthashes via batch listunspent.
   * Balance is computed from these UTXOs — NO separate get_balance call.
   */
  private async stage1FetchUtxos(
    client: ElectrumClient,
    entries: ScripthashEntry[],
    tipHeight: number
  ): Promise<{ utxos: LkgUtxo[]; succeeded: number }> {
    const allUtxos: LkgUtxo[] = [];
    let succeeded = 0;
    const seenOutpoints = new Set<string>();

    const batches = chunk(entries, SYNC_BATCH_SIZE);

    for (const batch of batches) {
      try {
        const requests = batch.map(e => ({
          method: 'blockchain.scripthash.listunspent',
          params: [e.scripthash],
        }));

        const results = await client.batchRequest<ElectrumUTXO[]>(requests);

        for (let i = 0; i < results.length; i++) {
          const electrumUtxos = results[i];
          const entry = batch[i];

          if (!Array.isArray(electrumUtxos)) continue;
          succeeded += 1;

          for (const eu of electrumUtxos) {
            const outpoint = `${eu.tx_hash}:${eu.tx_pos}`;
            if (seenOutpoints.has(outpoint)) continue;
            seenOutpoints.add(outpoint);

            const lkgUtxo: LkgUtxo = {
              txid: eu.tx_hash,
              vout: eu.tx_pos,
              valueSat: eu.value,
              height: eu.height,
              address: entry.address,
              scriptPubKey: '', // Will be populated in stage 3 if needed
              scriptType: entry.addressType,
              scripthash: entry.scripthash,
              confirmations: 0, // Recalculated after tipHeight is known
            };
            allUtxos.push(lkgUtxo);
          }
        }
      } catch (error) {
        // Batch failed — continue with next batch
        // Partial failures tracked via succeeded count
      }

      // Small delay between batches to avoid overwhelming server
      if (batches.length > 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return { utxos: allUtxos, succeeded };
  }

  // ─── Stage 2: Fetch Histories ─────────────────────────────────────

  /**
   * Fetch transaction histories for all scripthashes via batch get_history.
   */
  private async stage2FetchHistories(
    client: ElectrumClient,
    entries: ScripthashEntry[]
  ): Promise<{
    historyMap: Record<string, StagingHistoryEntry[]>;
    succeeded: number;
  }> {
    const historyMap: Record<string, StagingHistoryEntry[]> = {};
    let succeeded = 0;

    const batches = chunk(entries, SYNC_BATCH_SIZE);

    for (const batch of batches) {
      try {
        const requests = batch.map(e => ({
          method: 'blockchain.scripthash.get_history',
          params: [e.scripthash],
        }));

        const results = await client.batchRequest<ElectrumHistoryItem[]>(requests);

        for (let i = 0; i < results.length; i++) {
          const history = results[i];
          const entry = batch[i];

          if (!Array.isArray(history)) continue;
          succeeded += 1;

          const dedupedEntries: StagingHistoryEntry[] = [];
          const seenTxids = new Set<string>();

          for (const item of history) {
            if (seenTxids.has(item.tx_hash)) continue;
            seenTxids.add(item.tx_hash);
            dedupedEntries.push({
              txHash: item.tx_hash,
              height: item.height,
            });
          }

          historyMap[entry.scripthash] = dedupedEntries;
        }
      } catch {
        // Batch failed — continue with next batch
      }

      if (batches.length > 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return { historyMap, succeeded };
  }

  // ─── Stage 3: Fetch Tx Details ────────────────────────────────────

  /**
   * Fetch raw transaction hex for each txid, then decode into TxDetailEntry.
   * Only fetches txids NOT already in the LKG txDetails cache (incremental).
   */
  private async stage3FetchTxDetails(
    client: ElectrumClient,
    txids: string[],
    entries: ScripthashEntry[],
    walletFile: WalletFileV2Schema
  ): Promise<{
    details: Record<string, TxDetailEntry>;
    fetched: number;
    missing: string[];
  }> {
    const details: Record<string, TxDetailEntry> = {};
    const missing: string[] = [];
    let fetched = 0;

    // Build a set of all wallet addresses for ownership detection
    const walletAddresses = new Set(entries.map(e => e.address));

    const batches = chunk(txids, TX_FETCH_BATCH_SIZE);

    for (const batch of batches) {
      try {
        // Fetch raw hex (verbose=false returns raw hex string)
        const requests = batch.map(txid => ({
          method: 'blockchain.transaction.get',
          params: [txid, true], // verbose=true for decoded tx
        }));

        const results = await client.batchRequest<any>(requests);

        for (let i = 0; i < results.length; i++) {
          const txid = batch[i];
          const result = results[i];

          if (!result || typeof result !== 'object') {
            missing.push(txid);
            continue;
          }

          try {
            const detail = this.decodeTxResult(result, txid, walletAddresses);
            details[txid] = detail;
            fetched += 1;
          } catch {
            missing.push(txid);
          }
        }
      } catch {
        // Batch failed — mark all as missing
        for (const txid of batch) {
          missing.push(txid);
        }
      }

      if (batches.length > 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ── Resolve missing prevout data ──
    // Many Electrum servers (fulcrum, older electrs) don't include `prevout` in verbose response.
    // When prevout is missing, input address/value are unknown → wrong direction, zero fees, empty inputs.
    // Fix: fetch the referenced previous transactions to resolve input address + value.
    const needsPrevout: { txid: string; prevTxid: string; prevVout: number; inputIdx: number }[] = [];

    // Scan decoded details for inputs missing prevout data (address='' and valueSat=0)
    for (const [txid, detail] of Object.entries(details)) {
      for (let i = 0; i < detail.inputs.length; i++) {
        const inp = detail.inputs[i];
        if (inp.address === '' && inp.valueSat === 0 && inp.prevTxid !== '') {
          needsPrevout.push({ txid, prevTxid: inp.prevTxid, prevVout: inp.prevVout, inputIdx: i });
        }
      }
    }

    if (needsPrevout.length > 0) {
      SyncLogger.log('SyncPipeline', `Resolving ${needsPrevout.length} inputs missing prevout data`);

      // Collect unique previous txids to fetch (skip any already in our details cache)
      const prevTxids = [...new Set(needsPrevout.map(n => n.prevTxid))].filter(id => !details[id]);
      const prevTxCache = new Map<string, any>();

      // Batch-fetch previous transactions (verbose=true to get vout details)
      const prevBatches = chunk(prevTxids, TX_FETCH_BATCH_SIZE);
      for (const prevBatch of prevBatches) {
        try {
          const prevRequests = prevBatch.map(ptxid => ({
            method: 'blockchain.transaction.get',
            params: [ptxid, true],
          }));
          const prevResults = await client.batchRequest<any>(prevRequests);
          for (let i = 0; i < prevResults.length; i++) {
            if (prevResults[i] && typeof prevResults[i] === 'object') {
              prevTxCache.set(prevBatch[i], prevResults[i]);
            }
          }
        } catch {
          // Failed to fetch previous TXs — leave inputs unresolved
        }
        if (prevBatches.length > 1) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      // Resolve input address/value from previous TX outputs
      let resolved = 0;
      for (const item of needsPrevout) {
        let address = '';
        let valueSat = 0;

        // First check: is the prev TX already in our decoded details?
        const localDetail = details[item.prevTxid];
        if (localDetail) {
          const localOut = localDetail.outputs.find(o => o.index === item.prevVout);
          if (localOut) {
            address = localOut.address ?? '';
            valueSat = localOut.valueSat;
          }
        }

        // Second check: use fetched prev TX
        if (!address && valueSat === 0) {
          const prevTx = prevTxCache.get(item.prevTxid);
          if (prevTx?.vout) {
            const prevOutput = prevTx.vout[item.prevVout];
            if (prevOutput) {
              address = this.extractAddress(prevOutput.scriptPubKey);
              valueSat = typeof prevOutput.value === 'number'
                ? Math.round(prevOutput.value * 1e8)
                : prevOutput.value ?? 0;
            }
          }
        }

        if (address || valueSat > 0) {
          const detail = details[item.txid];
          if (detail && detail.inputs[item.inputIdx]) {
            detail.inputs[item.inputIdx].address = address;
            detail.inputs[item.inputIdx].valueSat = valueSat;
            detail.inputs[item.inputIdx].isWalletOwned = walletAddresses.has(address);
            resolved++;
          }
        }
      }
      SyncLogger.log('SyncPipeline', `Resolved ${resolved}/${needsPrevout.length} input prevouts`);
    }

    return { details, fetched, missing };
  }

  /**
   * Check if a TxDetailEntry has inputs that still need prevout resolution.
   * Returns true if any non-coinbase input has address='' and valueSat=0.
   */
  private hasUnresolvedInputs(detail: TxDetailEntry): boolean {
    for (const inp of detail.inputs) {
      if (inp.address === '' && inp.valueSat === 0 && inp.prevTxid !== '') {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract address from a scriptPubKey object in verbose tx response.
   * Handles both formats:
   *  - electrs/fulcrum: { address: "bc1q..." }
   *  - Bitcoin Core:    { addresses: ["bc1q..."] }
   *  - electrs prevout: { scriptpubkey_address: "bc1q..." }
   */
  private extractAddress(scriptPubKey: any): string {
    if (!scriptPubKey) return '';
    // Standard single address (most Electrum servers)
    if (scriptPubKey.address) return scriptPubKey.address;
    // Bitcoin Core style: addresses array
    if (Array.isArray(scriptPubKey.addresses) && scriptPubKey.addresses.length > 0) {
      return scriptPubKey.addresses[0];
    }
    return '';
  }

  /**
   * Decode a verbose transaction result into TxDetailEntry.
   */
  private decodeTxResult(
    tx: any,
    txid: string,
    walletAddresses: Set<string>
  ): TxDetailEntry {
    const inputs: TxDetailInput[] = (tx.vin || []).map((vin: any) => {
      // Use prevout if available (electrs 0.10+, some fulcrum versions)
      const address = vin.prevout?.scriptpubkey_address ?? '';
      const valueSat = vin.prevout?.value ?? 0;
      return {
        prevTxid: vin.txid ?? '',
        prevVout: vin.vout ?? 0,
        address,
        valueSat,
        isWalletOwned: address ? walletAddresses.has(address) : false,
      };
    });

    const outputs: TxDetailOutput[] = (tx.vout || []).map((vout: any, idx: number) => {
      const address = this.extractAddress(vout.scriptPubKey);
      return {
        index: vout.n ?? idx,
        address: address || null,
        valueSat: typeof vout.value === 'number'
          ? Math.round(vout.value * 1e8) // BTC to sat if decimal
          : vout.value ?? 0,
        scriptPubKey: vout.scriptPubKey?.hex ?? '',
        isWalletOwned: address ? walletAddresses.has(address) : false,
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

  // ─── Utilities ────────────────────────────────────────────────────

  /**
   * Build an empty staging snapshot (for wallets with no addresses).
   */
  private buildEmptyStaging(
    serverUsed: string,
    tipHeight: number
  ): StagingSnapshot {
    return {
      utxos: [],
      historyMap: {},
      txDetails: {},
      meta: {
        serverUsed,
        fetchedAt: Date.now(),
        tipHeight,
        scripthashesQueried: 0,
        scripthashesSucceeded: 0,
        txDetailsFetched: 0,
        txDetailsMissing: [],
        isComplete: true,
      },
    };
  }
}
