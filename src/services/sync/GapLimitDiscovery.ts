/**
 * GapLimitDiscovery — BIP44 Gap Limit Address Discovery
 *
 * After the sync pipeline fetches UTXOs + history for known addresses,
 * this module checks whether any used addresses sit near the frontier
 * (the highest-index address we've derived). If the gap between the
 * highest used index and the frontier is less than the gap limit,
 * we derive more addresses, query Electrum, and repeat until we find
 * a full gap of consecutive unused addresses.
 *
 * Runs per address-type × per chain (receive/change) independently.
 *
 * Integrates between SyncPipeline completion and two-phase commit
 * in WalletEngine.syncWallet().
 */

import type { ElectrumClient } from '../electrum/ElectrumClient';
import { addressToScripthash } from '../electrum/scripthash';
import { WalletDatabase } from '../database/WalletDatabase';
import type { AddressRow } from '../database/types';
import { DERIVATION } from '../../constants';
import type { AddressType } from '../../types';
import type {
  StagingSnapshot,
  StagingHistoryEntry,
  LkgUtxo,
  TxDetailEntry,
  TxDetailInput,
  TxDetailOutput,
  CanonicalScriptType,
} from './types';
import { SyncLogger } from '../SyncLogger';
import { keyDerivationFromDB } from '../wallet/KeyDerivationFactory';
import type { KeyDerivation } from '../../core/wallet/KeyDerivation';
import { addressTypeToScript, guessScriptType, ALL_ADDRESS_TYPES } from '../../utils/addressTypeMap';

// ─── Constants ────────────────────────────────────────────────────────

/** Max discovery rounds per type+chain (safety cap to prevent infinite loops) */
const MAX_DISCOVERY_ROUNDS = 10;

/** Batch size for Electrum history queries */
const DISCOVERY_BATCH_SIZE = 50;

/** Batch size for Electrum UTXO queries */
const UTXO_BATCH_SIZE = 50;

/** Batch size for Electrum transaction detail queries */
const TX_BATCH_SIZE = 40;

// Type mappings and guessScriptType are now imported from shared utilities:
// addressTypeToScript() from utils/addressTypeMap
// guessScriptType() from utils/addressTypeMap
// ALL_ADDRESS_TYPES from utils/addressTypeMap

// ─── Result Types ────────────────────────────────────────────────────

interface ChainResult {
  type: string;
  chain: 'receive' | 'change';
  previousMax: number;
  newMax: number;
  usedFound: number;
}

export interface DiscoveryResult {
  /** Total new addresses derived across all types and chains */
  newAddressCount: number;
  /** How many of those new addresses turned out to be used */
  newUsedAddressCount: number;
  /** Updated staging snapshot with merged data from discovered addresses */
  updatedStaging: StagingSnapshot;
  /** Per type+chain breakdown */
  addressTypeResults: ChainResult[];
}

// ─── Main Discovery Class ────────────────────────────────────────────

export class GapLimitDiscovery {
  /**
   * Run BIP44 gap limit discovery for a wallet.
   *
   * Checks each address type × chain (receive/change) independently.
   * If used addresses are found near the frontier, derives more addresses,
   * queries Electrum, and loops until a full gap is satisfied.
   *
   * @param walletId - Wallet ID to discover addresses for
   * @param client - Connected ElectrumClient for Electrum queries
   * @param staging - Current staging snapshot from the sync pipeline
   * @param networkType - Network type ('mainnet' | 'testnet')
   * @returns DiscoveryResult with merged staging and stats
   */
  static async discover(
    walletId: string,
    client: ElectrumClient,
    staging: StagingSnapshot,
    networkType: 'mainnet' | 'testnet' = 'mainnet'
  ): Promise<DiscoveryResult> {
    const db = WalletDatabase.shared();
    const walletRow = db.getWallet(walletId);

    // Can't derive new addresses without key material
    if (!walletRow) {
      SyncLogger.warn('discovery', `Wallet ${walletId} not found in DB, skipping discovery`);
      return { newAddressCount: 0, newUsedAddressCount: 0, updatedStaging: staging, addressTypeResults: [] };
    }

    // Multisig wallets use MultisigWallet class for address derivation — single-sig
    // KeyDerivation would produce wrong address types (p2wpkh instead of p2wsh).
    // Gap limit discovery is not applicable to multisig wallets.
    if (walletRow.isMultisig === 1) {
      SyncLogger.log('discovery', `Wallet ${walletId} is multisig, skipping single-sig gap limit discovery`);
      return { newAddressCount: 0, newUsedAddressCount: 0, updatedStaging: staging, addressTypeResults: [] };
    }

    // Watch-only wallets have no private key material — can't derive new addresses
    const canDerive = !!(walletRow.seedHex || walletRow.masterXprv || walletRow.mnemonic);
    if (!canDerive) {
      SyncLogger.log('discovery', `Wallet ${walletId} is watch-only, skipping discovery`);
      return { newAddressCount: 0, newUsedAddressCount: 0, updatedStaging: staging, addressTypeResults: [] };
    }

    // Reconstruct KeyDerivation from stored key material using shared factory
    const kd = keyDerivationFromDB(walletId, networkType);
    if (!kd) {
      SyncLogger.warn('discovery', `Could not construct KeyDerivation for ${walletId}, skipping discovery`);
      return { newAddressCount: 0, newUsedAddressCount: 0, updatedStaging: staging, addressTypeResults: [] };
    }

    const gapLimit = walletRow.gapLimit || DERIVATION.GAP_LIMIT;

    // Build a set of scripthashes that have history in the staging snapshot
    const scripthashesWithHistory = new Set<string>();
    for (const [sh, entries] of Object.entries(staging.historyMap)) {
      if (entries && entries.length > 0) {
        scripthashesWithHistory.add(sh);
      }
    }

    // Clone staging for mutation
    const updatedStaging: StagingSnapshot = {
      utxos: [...staging.utxos],
      historyMap: { ...staging.historyMap },
      txDetails: { ...staging.txDetails },
      meta: { ...staging.meta },
    };

    let totalNewAddresses = 0;
    let totalNewUsed = 0;
    const chainResults: ChainResult[] = [];

    try {
      // Process each address type × chain
      for (const addrType of ALL_ADDRESS_TYPES) {
        const dbScriptType = addressTypeToScript(addrType);
        if (!dbScriptType) continue;

        for (const isChange of [false, true]) {
          const chainLabel = isChange ? 'change' : 'receive';
          const previousMax = db.getMaxAddressIndex(walletId, dbScriptType, isChange);

          const result = await GapLimitDiscovery.discoverChain(
            walletId, client, db, kd, updatedStaging,
            addrType, dbScriptType, isChange, gapLimit,
            scripthashesWithHistory, networkType
          );

          if (result.newAddresses > 0) {
            SyncLogger.log('discovery',
              `${dbScriptType}/${chainLabel}: extended ${previousMax}→${result.newMaxIndex}, found ${result.usedFound} used`
            );
          }

          totalNewAddresses += result.newAddresses;
          totalNewUsed += result.usedFound;

          chainResults.push({
            type: dbScriptType,
            chain: chainLabel,
            previousMax,
            newMax: result.newMaxIndex,
            usedFound: result.usedFound,
          });
        }
      }
    } finally {
      // Always clean up key material
      kd.destroy();
    }

    if (totalNewAddresses > 0) {
      SyncLogger.log('discovery',
        `Discovery complete: ${totalNewAddresses} new addresses, ${totalNewUsed} used`
      );
    }

    return {
      newAddressCount: totalNewAddresses,
      newUsedAddressCount: totalNewUsed,
      updatedStaging,
      addressTypeResults: chainResults,
    };
  }

  /**
   * Discover addresses for a single address-type × chain combination.
   *
   * Loops: check gap → derive batch → query Electrum → mark used → repeat
   */
  private static async discoverChain(
    walletId: string,
    client: ElectrumClient,
    db: WalletDatabase,
    kd: KeyDerivation,
    staging: StagingSnapshot,
    addrType: AddressType,
    dbScriptType: string,
    isChange: boolean,
    gapLimit: number,
    scripthashesWithHistory: Set<string>,
    networkType: 'mainnet' | 'testnet'
  ): Promise<{ newAddresses: number; usedFound: number; newMaxIndex: number }> {
    let totalNewAddresses = 0;
    let totalUsedFound = 0;
    let round = 0;

    while (round < MAX_DISCOVERY_ROUNDS) {
      // Step 1: Read current state from DB
      const maxIndex = db.getMaxAddressIndex(walletId, dbScriptType, isChange);
      const highestUsedInDb = db.getHighestUsedIndex(walletId, dbScriptType, isChange);

      // Step 2: Also check staging historyMap for addresses that may be newly used
      // (the pipeline found history but hasn't committed markAddressUsed yet)
      let highestUsed = highestUsedInDb;
      const existingAddresses = db.getAddressesByChangeAndType(walletId, isChange, dbScriptType);
      for (const addr of existingAddresses) {
        if (addr.scripthash && scripthashesWithHistory.has(addr.scripthash)) {
          if (addr.addressIndex > highestUsed) {
            highestUsed = addr.addressIndex;
          }
          // Also mark as used in DB for future reference
          if (!addr.isUsed) {
            db.markAddressUsed(walletId, addr.address);
          }
        }
      }

      // Step 3: Calculate consecutive unused gap
      // Gap = (maxIndex) - (highestUsed) when highestUsed >= 0
      // If no used addresses, gap = maxIndex + 1 (all addresses are unused)
      const consecutiveUnused = highestUsed >= 0
        ? maxIndex - highestUsed
        : maxIndex + 1;

      // Step 4: If gap is sufficient, we're done
      if (consecutiveUnused >= gapLimit) {
        return { newAddresses: totalNewAddresses, usedFound: totalUsedFound, newMaxIndex: maxIndex };
      }

      // Step 5: Need more addresses — derive a batch starting from maxIndex + 1
      const startIndex = maxIndex + 1;
      const count = gapLimit; // Derive one full gap's worth
      const newAddresses: AddressRow[] = [];

      for (let i = 0; i < count; i++) {
        const idx = startIndex + i;
        try {
          const addrInfo = isChange
            ? kd.deriveChangeAddress(DERIVATION.DEFAULT_ACCOUNT, idx, addrType)
            : kd.deriveReceivingAddress(DERIVATION.DEFAULT_ACCOUNT, idx, addrType);

          const scripthash = addressToScripthash(addrInfo.address, networkType);

          newAddresses.push({
            walletId,
            address: addrInfo.address,
            path: addrInfo.path,
            addressIndex: idx,
            isChange: isChange ? 1 : 0,
            addressType: dbScriptType,
            scripthash,
            isUsed: 0,
            label: null,
            note: null,
            wif: null,
          });
        } catch (err: any) {
          SyncLogger.warn('discovery', `Failed to derive ${dbScriptType}/${isChange ? 'change' : 'receive'} index ${idx}: ${err?.message}`);
          break;
        }
      }

      if (newAddresses.length === 0) {
        break; // Can't derive more, stop
      }

      // Step 6: Insert new addresses into DB
      db.insertAddresses(newAddresses);
      totalNewAddresses += newAddresses.length;

      // Step 7: Query Electrum for history of new addresses
      const scripthashes = newAddresses.map(a => a.scripthash!);
      const addresses = newAddresses.map(a => a.address);

      let usedInThisBatch = 0;

      // Batch query: blockchain.scripthash.get_history
      try {
        const historyRequests = scripthashes.map(sh => ({
          method: 'blockchain.scripthash.get_history',
          params: [sh],
        }));

        const historyResults = await client.batchRequest<Array<{ tx_hash: string; height: number }>>(historyRequests);

        for (let i = 0; i < historyResults.length; i++) {
          const history = historyResults[i];
          const sh = scripthashes[i];
          const addr = addresses[i];

          if (history && Array.isArray(history) && history.length > 0) {
            // This address has been used!
            usedInThisBatch++;
            db.markAddressUsed(walletId, addr);
            scripthashesWithHistory.add(sh);

            // Add history to staging
            const entries: StagingHistoryEntry[] = history.map(h => ({
              txHash: h.tx_hash,
              height: h.height,
            }));
            staging.historyMap[sh] = entries;
          }
        }
      } catch (err: any) {
        SyncLogger.error('discovery', `Electrum history query failed: ${err?.message}`);
        // Still continue — we've inserted the addresses, they'll be picked up next sync
        break;
      }

      totalUsedFound += usedInThisBatch;

      // Step 8: If we found used addresses, fetch their UTXOs and tx details
      if (usedInThisBatch > 0) {
        await GapLimitDiscovery.fetchDataForNewAddresses(
          client, staging, newAddresses, scripthashes, addresses,
          scripthashesWithHistory, networkType
        );
      }

      // Step 9: If no used addresses in this batch, the gap is now satisfied
      if (usedInThisBatch === 0) {
        const newMaxIndex = db.getMaxAddressIndex(walletId, dbScriptType, isChange);
        return { newAddresses: totalNewAddresses, usedFound: totalUsedFound, newMaxIndex };
      }

      // Loop again — there were used addresses, so we need to check gap again
      round++;
    }

    const finalMax = db.getMaxAddressIndex(walletId, dbScriptType, isChange);
    return { newAddresses: totalNewAddresses, usedFound: totalUsedFound, newMaxIndex: finalMax };
  }

  /**
   * Fetch UTXOs and transaction details for newly discovered used addresses.
   * Merges results into the staging snapshot.
   */
  private static async fetchDataForNewAddresses(
    client: ElectrumClient,
    staging: StagingSnapshot,
    newAddresses: AddressRow[],
    scripthashes: string[],
    addresses: string[],
    scripthashesWithHistory: Set<string>,
    networkType: 'mainnet' | 'testnet'
  ): Promise<void> {
    // Only process addresses that have history
    const usedIndices: number[] = [];
    for (let i = 0; i < scripthashes.length; i++) {
      if (scripthashesWithHistory.has(scripthashes[i])) {
        usedIndices.push(i);
      }
    }

    if (usedIndices.length === 0) return;

    // Fetch UTXOs for used addresses
    try {
      const utxoRequests = usedIndices.map(i => ({
        method: 'blockchain.scripthash.listunspent',
        params: [scripthashes[i]],
      }));

      const utxoResults = await client.batchRequest<Array<{
        tx_hash: string;
        tx_pos: number;
        value: number;
        height: number;
      }>>(utxoRequests);

      const tipHeight = staging.meta.tipHeight;

      for (let r = 0; r < utxoResults.length; r++) {
        const utxos = utxoResults[r];
        const addrIdx = usedIndices[r];
        const addr = addresses[addrIdx];
        const sh = scripthashes[addrIdx];
        const scriptType = guessScriptType(addr);

        if (utxos && Array.isArray(utxos)) {
          for (const u of utxos) {
            const lkgUtxo: LkgUtxo = {
              txid: u.tx_hash,
              vout: u.tx_pos,
              valueSat: u.value,
              height: u.height || 0,
              address: addr,
              scriptPubKey: '', // Will be filled from tx details if available
              scriptType,
              scripthash: sh,
              confirmations: u.height > 0 ? Math.max(1, tipHeight - u.height + 1) : 0,
            };
            staging.utxos.push(lkgUtxo);
          }
        }
      }
    } catch (err: any) {
      SyncLogger.warn('discovery', `UTXO fetch for new addresses failed: ${err?.message}`);
    }

    // Collect all unique txids from histories of used addresses that we don't have details for yet
    const txidsNeeded = new Set<string>();
    for (const i of usedIndices) {
      const sh = scripthashes[i];
      const history = staging.historyMap[sh];
      if (history) {
        for (const entry of history) {
          if (!staging.txDetails[entry.txHash]) {
            txidsNeeded.add(entry.txHash);
          }
        }
      }
    }

    // Fetch missing transaction details
    if (txidsNeeded.size > 0) {
      try {
        const txids = Array.from(txidsNeeded);
        // Process in chunks
        for (let i = 0; i < txids.length; i += TX_BATCH_SIZE) {
          const chunk = txids.slice(i, i + TX_BATCH_SIZE);
          const txRequests = chunk.map(txid => ({
            method: 'blockchain.transaction.get',
            params: [txid, true], // verbose = true for decoded tx
          }));

          const txResults = await client.batchRequest<any>(txRequests);

          // Build wallet address set ONCE before the loop (not per-tx)
          const walletAddressSet = new Set<string>(addresses);
          for (const utxo of staging.utxos) {
            walletAddressSet.add(utxo.address);
          }

          for (let r = 0; r < txResults.length; r++) {
            const rawTx = txResults[r];
            const txid = chunk[r];

            if (rawTx && typeof rawTx === 'object') {
              const detail = GapLimitDiscovery.decodeTxResult(rawTx, txid, walletAddressSet);
              if (detail) {
                staging.txDetails[txid] = detail;
              }
            }
          }
        }
      } catch (err: any) {
        SyncLogger.warn('discovery', `Tx detail fetch for new addresses failed: ${err?.message}`);
      }
    }
  }

  /**
   * Decode a verbose transaction result from Electrum into TxDetailEntry.
   * Mirrors SyncPipeline.decodeTxResult() logic.
   */
  private static decodeTxResult(
    tx: any,
    txid: string,
    walletAddresses: Set<string>
  ): TxDetailEntry | null {
    try {
      const inputs: TxDetailInput[] = (tx.vin || []).map((vin: any) => {
        const prevAddress = GapLimitDiscovery.extractAddress(vin?.prevout?.scriptPubKey || vin?.scriptPubKey);
        return {
          prevTxid: vin.txid || '',
          prevVout: vin.vout ?? 0,
          address: prevAddress,
          valueSat: Math.round((vin?.prevout?.value ?? vin?.value ?? 0) * 1e8),
          isWalletOwned: walletAddresses.has(prevAddress),
        };
      });

      const outputs: TxDetailOutput[] = (tx.vout || []).map((vout: any, index: number) => {
        const address = GapLimitDiscovery.extractAddress(vout.scriptPubKey);
        return {
          index,
          address: address || null,
          valueSat: Math.round((vout.value || 0) * 1e8),
          scriptPubKey: vout.scriptPubKey?.hex || '',
          isWalletOwned: address ? walletAddresses.has(address) : false,
        };
      });

      return {
        txid,
        rawHex: tx.hex || '',
        inputs,
        outputs,
        blockTime: tx.blocktime || tx.time || null,
        size: tx.size || 0,
        vsize: tx.vsize || tx.size || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract address from a scriptPubKey object.
   * Handles different Electrum server response formats.
   */
  private static extractAddress(scriptPubKey: any): string {
    if (!scriptPubKey) return '';
    if (scriptPubKey.address) return scriptPubKey.address;
    if (scriptPubKey.addresses?.[0]) return scriptPubKey.addresses[0];
    if (scriptPubKey.scriptpubkey_address) return scriptPubKey.scriptpubkey_address;
    return '';
  }
}
