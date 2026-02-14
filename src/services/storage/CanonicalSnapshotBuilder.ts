/**
 * CanonicalSnapshotBuilder — Extract/apply unified wallet snapshots
 *
 * Produces a CanonicalWalletSnapshot from a WalletFileV2Schema for:
 * 1. iCloud backup payload (encrypted)
 * 2. Preserve-on-delete archive (encrypted, Keychain)
 *
 * The snapshot contains all chain state + user metadata but NO secrets
 * (mnemonic, xprv, WIF) and NO staging data.
 *
 * Also provides gzip compression for backup payloads.
 */

import pako from 'pako';
import {
  createEmptySyncState,
  createEmptyBackupMeta,
} from '../sync/types';
import type {
  WalletFileV2Schema,
  CanonicalWalletSnapshot,
  TxDetailEntry,
  BackupMeta,
  LkgUtxo,
  LkgTransaction,
  SyncStateData,
  XpubEntry,
  DescriptorEntry,
  UtxoUserMetadata,
  TxUserMetadata,
  AddressUserMetadata,
} from '../sync/types';
import type { AddressInfo, AccountAddressIndices, AddressType } from '../../types';
import { WalletDatabase } from '../database/WalletDatabase';
import type { WalletRow, AddressRow, UtxoRow, TransactionRow, TxDetailRow, XpubRow, DescriptorRow, SyncStateRow } from '../database/types';

// ─── CanonicalSnapshotBuilder ─────────────────────────────────────

export class CanonicalSnapshotBuilder {
  /**
   * Extract a CanonicalWalletSnapshot from a V2 wallet file.
   *
   * Strips: secrets (handled separately by BackupPayload),
   *         staging data, integrity metadata, watchOnlyData.
   * Includes: LKG chain state, user metadata, address cache, sync state.
   */
  static extract(file: WalletFileV2Schema): CanonicalWalletSnapshot {
    return {
      schemaVersion: 2,
      walletId: file.walletId,
      name: file.name,
      walletType: file.walletType,
      importSource: file.importSource,
      createdAt: file.createdAt,
      lastModified: file.lastModified,
      network: file.network,

      keysAndDescriptors: {
        fingerprint: file.keyRef.fingerprint,
        xpubs: file.xpubs ?? [],
        descriptors: file.descriptors ?? [],
        scriptTypes: file.keyRef.scriptTypes,
      },

      addressCache: {
        addresses: file.scriptInventory.addresses,
        addressIndices: file.scriptInventory.addressIndices,
        preferredAddressType: file.scriptInventory.preferredAddressType,
        usedAddresses: file.scriptInventory.usedAddresses,
        gapLimit: file.scriptInventory.gapLimit,
        lastDiscoveryAt: file.scriptInventory.lastDiscoveryAt,
        addressLabels: file.addressLabels ?? {},
      },

      utxoCache: {
        utxos: file.lkg.utxos,
        utxoMetadata: file.utxoUserMetadata ?? {},
      },

      txCache: {
        transactions: file.lkg.transactions,
        txDetails: file.lkg.txDetails,
        txUserMetadata: file.txUserMetadata ?? {},
      },

      syncState: file.syncState,
      confirmedBalanceSat: file.lkg.confirmedBalanceSat,
      unconfirmedBalanceSat: file.lkg.unconfirmedBalanceSat,
      trackedTransactions: file.lkg.trackedTransactions,

      isMultisig: file.isMultisig,
      multisigConfig: file.multisigConfig,
      backupMeta: file.backupMeta ?? createEmptyBackupMeta(),
    };
  }

  /**
   * Extract a CanonicalWalletSnapshot directly from the SQLite database.
   * Used when V2 wallet files don't exist (fresh installs, post-migration).
   *
   * Reads all chain state from WalletDatabase: wallet metadata, addresses,
   * UTXOs, transactions, tx details, xpubs, descriptors, and sync state.
   *
   * Returns null if the wallet has no meaningful data to archive.
   */
  static extractFromDatabase(walletId: string): CanonicalWalletSnapshot | null {
    try {
      const db = WalletDatabase.shared();
      const wallet = db.getWallet(walletId);
      if (!wallet) {
        // wallet not found in DB
        return null;
      }

      // ── Addresses ──────────────────────────────────────
      const addressRows = db.getAddresses(walletId);
      const addresses: AddressInfo[] = addressRows.map((row: AddressRow) => ({
        address: row.address,
        path: row.path,
        index: row.addressIndex,
        isChange: row.isChange === 1,
        type: row.addressType as AddressType,
        label: row.label ?? undefined,
      }));

      const usedAddresses = addressRows
        .filter((r: AddressRow) => r.isUsed === 1)
        .map((r: AddressRow) => r.address);

      // Build address indices from max index per type/change
      const buildIndices = (): AccountAddressIndices => {
        const idx: AccountAddressIndices = {
          native_segwit: { receiving: 0, change: 0 },
          wrapped_segwit: { receiving: 0, change: 0 },
          legacy: { receiving: 0, change: 0 },
          taproot: { receiving: 0, change: 0 },
        };
        const typeMap: Record<string, keyof AccountAddressIndices> = {
          p2wpkh: 'native_segwit',
          'p2sh-p2wpkh': 'wrapped_segwit',
          p2pkh: 'legacy',
          p2tr: 'taproot',
        };
        for (const row of addressRows) {
          const key = typeMap[row.addressType];
          if (!key) continue;
          const slot = row.isChange === 1 ? 'change' : 'receiving';
          if (row.addressIndex + 1 > idx[key][slot]) {
            idx[key][slot] = row.addressIndex + 1;
          }
        }
        return idx;
      };

      // Build address labels from DB
      const addressLabels: Record<string, AddressUserMetadata> = {};
      for (const row of addressRows) {
        if (row.label || row.note) {
          addressLabels[row.address] = {
            label: row.label ?? undefined,
            note: row.note ?? undefined,
          };
        }
      }

      // ── UTXOs ──────────────────────────────────────────
      const utxoRows = db.getUtxos(walletId);
      const utxos: LkgUtxo[] = utxoRows.map((row: UtxoRow) => ({
        txid: row.txid,
        vout: row.vout,
        valueSat: row.valueSat,
        height: row.height,
        address: row.address,
        scriptPubKey: row.scriptPubKey,
        scriptType: row.scriptType as any,
        scripthash: row.scripthash,
        confirmations: row.confirmations,
      }));

      // UTXO user metadata (frozen, locked, notes, tags)
      const utxoMetadata: Record<string, UtxoUserMetadata> = {};
      for (const row of utxoRows) {
        const key = `${row.txid}:${row.vout}`;
        if (row.isFrozen || row.isLocked || row.userNote || row.userTags) {
          utxoMetadata[key] = {
            isFrozen: row.isFrozen === 1,
            isLocked: row.isLocked === 1,
            note: row.userNote ?? undefined,
            tags: row.userTags ? JSON.parse(row.userTags) : undefined,
          };
        }
      }

      // ── Transactions ───────────────────────────────────
      const txRows = db.getTransactions(walletId);
      const transactions: LkgTransaction[] = txRows.map((row: TransactionRow) => ({
        txid: row.txid,
        firstSeenAt: row.firstSeenAt,
        blockHeight: row.blockHeight,
        confirmations: row.confirmations,
        direction: row.direction as any,
        valueDeltaSat: row.valueDeltaSat,
        feeSat: row.feeSat,
        feeRate: row.feeRate,
        isRBF: row.isRBF === 1,
        status: row.status as any,
        inputCount: row.inputCount,
        outputCount: row.outputCount,
        size: row.size,
        vsize: row.vsize,
      }));

      // Tx user metadata (notes, tags)
      const txUserMetadata: Record<string, TxUserMetadata> = {};
      for (const row of txRows) {
        if (row.userNote || row.userTags) {
          txUserMetadata[row.txid] = {
            note: row.userNote ?? undefined,
            tags: row.userTags ? JSON.parse(row.userTags) : undefined,
            createdAt: row.firstSeenAt,
            editedAt: row.firstSeenAt,
          };
        }
      }

      // ── Tx Details ─────────────────────────────────────
      const detailMap = db.getAllTxDetails(walletId);
      const txDetails: Record<string, TxDetailEntry> = {};
      for (const [txid, row] of Object.entries(detailMap)) {
        txDetails[txid] = {
          txid: row.txid,
          rawHex: row.rawHex,
          inputs: typeof row.inputs === 'string' ? (() => { try { return JSON.parse(row.inputs as string); } catch { return []; } })() : row.inputs,
          outputs: typeof row.outputs === 'string' ? (() => { try { return JSON.parse(row.outputs as string); } catch { return []; } })() : row.outputs,
          blockTime: row.blockTime,
          size: row.size,
          vsize: row.vsize,
        };
      }

      // ── Xpubs & Descriptors ────────────────────────────
      const xpubRows = db.getXpubs(walletId);
      const xpubs: XpubEntry[] = xpubRows.map((row: XpubRow) => ({
        xpub: row.xpub,
        derivationPath: row.derivationPath,
        scriptType: row.scriptType as any,
        fingerprint: row.fingerprint ?? undefined,
      }));

      const descriptorRows = db.getDescriptors(walletId);
      const descriptors: DescriptorEntry[] = descriptorRows.map((row: DescriptorRow) => ({
        descriptor: row.descriptor,
        isRange: row.isRange === 1,
        checksum: row.checksum ?? undefined,
        internal: row.internal === 1,
      }));

      // ── Sync State ─────────────────────────────────────
      const syncRow = db.getSyncState(walletId);
      const syncState: SyncStateData = syncRow ? {
        status: syncRow.status as any,
        lastSuccessfulSyncAt: syncRow.lastSuccessfulSyncAt,
        lastAttemptAt: syncRow.lastAttemptAt,
        lastKnownTipHeight: syncRow.lastKnownTipHeight,
        lastServerUsed: syncRow.lastServerUsed,
        isStale: syncRow.isStale === 1,
        failureCount: syncRow.failureCount,
        nextRetryAt: syncRow.nextRetryAt,
        lastError: syncRow.lastError,
        lastErrorAt: syncRow.lastErrorAt,
      } : createEmptySyncState();

      // ── Balance ────────────────────────────────────────
      const balance = db.getBalance(walletId);

      // Parse scriptTypes from JSON string
      let scriptTypes: string[] = [];
      try {
        scriptTypes = wallet.scriptTypes ? JSON.parse(wallet.scriptTypes) : [];
      } catch {
        scriptTypes = [];
      }

      // Parse multisig config
      let multisigConfig = null;
      try {
        if (wallet.multisigConfig) {
          multisigConfig = JSON.parse(wallet.multisigConfig);
        }
      } catch {
        multisigConfig = null;
      }

      // ── Secrets (for Preserve-on-Delete only) ────────
      // Collect per-address WIF keys
      const addressWifs: Record<string, string> = {};
      for (const row of addressRows) {
        if (row.wif) {
          addressWifs[row.address] = row.wif;
        }
      }

      return {
        schemaVersion: 2,
        walletId: wallet.walletId,
        name: wallet.name,
        walletType: wallet.walletType as any,
        importSource: wallet.importSource as any,
        createdAt: wallet.createdAt,
        lastModified: wallet.lastModified,
        network: 'mainnet',

        keysAndDescriptors: {
          fingerprint: wallet.fingerprint,
          xpubs,
          descriptors,
          scriptTypes: scriptTypes as any[],
        },

        addressCache: {
          addresses,
          addressIndices: buildIndices(),
          preferredAddressType: wallet.preferredAddressType as AddressType,
          usedAddresses,
          gapLimit: wallet.gapLimit,
          lastDiscoveryAt: null,
          addressLabels,
        },

        utxoCache: {
          utxos,
          utxoMetadata,
        },

        txCache: {
          transactions,
          txDetails,
          txUserMetadata,
        },

        syncState,
        confirmedBalanceSat: balance.confirmed,
        unconfirmedBalanceSat: balance.unconfirmed,
        trackedTransactions: [],

        isMultisig: wallet.isMultisig === 1,
        multisigConfig,
        backupMeta: createEmptyBackupMeta(),

        // Include secrets for Preserve-on-Delete archives
        secrets: {
          secretId: wallet.secretId,
          secretType: wallet.secretType,
          mnemonic: wallet.mnemonic,
          passphrase: wallet.passphrase,
          masterXprv: wallet.masterXprv,
          masterXpub: wallet.masterXpub,
          seedHex: wallet.seedHex,
          descriptor: wallet.descriptor,
          watchOnlyData: wallet.watchOnlyData,
          addressWifs: Object.keys(addressWifs).length > 0 ? addressWifs : undefined,
        },
      };
    } catch (error: any) {
      console.error(`[CanonicalSnapshotBuilder] extractFromDatabase failed for ${walletId}:`, error?.message);
      return null;
    }
  }

  /**
   * Apply a CanonicalWalletSnapshot to a V2 wallet file.
   * Non-destructive merge: overwrites chain state and user metadata,
   * resets sync state to 'stale' (should re-sync after restore).
   *
   * Does NOT touch: integrity, staging, watchOnlyData, keyRef.secretId.
   */
  static apply(
    snapshot: CanonicalWalletSnapshot,
    target: WalletFileV2Schema
  ): WalletFileV2Schema {
    // Apply identity metadata
    target.name = snapshot.name;
    target.walletType = snapshot.walletType;
    target.importSource = snapshot.importSource;
    target.lastModified = Date.now();

    // Apply keys & descriptors (public parts only)
    target.keyRef = {
      ...target.keyRef,
      fingerprint: snapshot.keysAndDescriptors.fingerprint,
      scriptTypes: snapshot.keysAndDescriptors.scriptTypes,
    };
    target.xpubs = snapshot.keysAndDescriptors.xpubs;
    target.descriptors = snapshot.keysAndDescriptors.descriptors;

    // Apply address cache
    target.scriptInventory = {
      addresses: snapshot.addressCache.addresses,
      addressIndices: snapshot.addressCache.addressIndices,
      preferredAddressType: snapshot.addressCache.preferredAddressType,
      usedAddresses: snapshot.addressCache.usedAddresses,
      gapLimit: snapshot.addressCache.gapLimit,
      lastDiscoveryAt: snapshot.addressCache.lastDiscoveryAt,
    };
    target.addressLabels = snapshot.addressCache.addressLabels;

    // Apply LKG chain state
    target.lkg = {
      utxos: snapshot.utxoCache.utxos,
      transactions: snapshot.txCache.transactions,
      txDetails: snapshot.txCache.txDetails,
      confirmedBalanceSat: snapshot.confirmedBalanceSat,
      unconfirmedBalanceSat: snapshot.unconfirmedBalanceSat,
      trackedTransactions: snapshot.trackedTransactions,
      committedAt: snapshot.syncState.lastSuccessfulSyncAt ?? Date.now(),
      tipHeightAtCommit: snapshot.syncState.lastKnownTipHeight,
    };

    // Apply user metadata
    target.txUserMetadata = snapshot.txCache.txUserMetadata;
    target.utxoUserMetadata = snapshot.utxoCache.utxoMetadata;

    // Apply multisig config
    target.isMultisig = snapshot.isMultisig;
    target.multisigConfig = snapshot.multisigConfig;

    // Apply backup metadata
    target.backupMeta = snapshot.backupMeta;

    // Reset sync state to 'stale' — wallet should re-sync after restore
    target.syncState = {
      ...createEmptySyncState(),
      status: 'stale',
      isStale: true,
      lastSuccessfulSyncAt: snapshot.syncState.lastSuccessfulSyncAt,
      lastKnownTipHeight: snapshot.syncState.lastKnownTipHeight,
    };

    // Clear staging — no in-progress sync after restore
    target.staging = null;

    return target;
  }

  /**
   * Apply a CanonicalWalletSnapshot directly to the SQLite database.
   * Used during restoration when V2 files don't exist.
   *
   * Inserts/replaces: wallet row, addresses, UTXOs, transactions,
   * tx details, xpubs, descriptors, and sync state.
   */
  static applyToDatabase(snapshot: CanonicalWalletSnapshot): boolean {
    try {
      const db = WalletDatabase.shared();
      const walletId = snapshot.walletId;

      // applyToDatabase start

      // Parse scriptTypes back to JSON string for DB
      const scriptTypesJson = JSON.stringify(snapshot.keysAndDescriptors.scriptTypes || []);
      const multisigConfigJson = snapshot.multisigConfig ? JSON.stringify(snapshot.multisigConfig) : null;

      // ── 1. Insert/replace wallet row ───────────────────
      const secrets = snapshot.secrets;
      const existingWallet = db.getWallet(walletId);
      if (existingWallet) {
        db.updateWallet(walletId, {
          name: snapshot.name,
          walletType: snapshot.walletType,
          importSource: snapshot.importSource,
          fingerprint: snapshot.keysAndDescriptors.fingerprint,
          scriptTypes: scriptTypesJson,
          preferredAddressType: snapshot.addressCache.preferredAddressType,
          gapLimit: snapshot.addressCache.gapLimit,
          isMultisig: snapshot.isMultisig ? 1 : 0,
          multisigConfig: multisigConfigJson,
          confirmedBalanceSat: snapshot.confirmedBalanceSat,
          unconfirmedBalanceSat: snapshot.unconfirmedBalanceSat,
          // Restore secrets if present in snapshot
          ...(secrets ? {
            secretId: secrets.secretId,
            secretType: secrets.secretType,
            mnemonic: secrets.mnemonic,
            passphrase: secrets.passphrase,
            masterXprv: secrets.masterXprv,
            masterXpub: secrets.masterXpub,
            seedHex: secrets.seedHex,
            descriptor: secrets.descriptor,
            watchOnlyData: secrets.watchOnlyData,
          } : {}),
        });
      } else {
        const walletRow: WalletRow = {
          walletId,
          name: snapshot.name,
          walletType: snapshot.walletType,
          importSource: snapshot.importSource,
          createdAt: snapshot.createdAt,
          lastModified: Date.now(),
          network: snapshot.network,
          secretId: secrets?.secretId ?? null,
          fingerprint: snapshot.keysAndDescriptors.fingerprint,
          descriptor: secrets?.descriptor ?? null,
          scriptTypes: scriptTypesJson,
          preferredAddressType: snapshot.addressCache.preferredAddressType,
          gapLimit: snapshot.addressCache.gapLimit,
          isMultisig: snapshot.isMultisig ? 1 : 0,
          multisigConfig: multisigConfigJson,
          confirmedBalanceSat: snapshot.confirmedBalanceSat,
          unconfirmedBalanceSat: snapshot.unconfirmedBalanceSat,
          watchOnlyData: secrets?.watchOnlyData ?? null,
          secretType: secrets?.secretType ?? null,
          mnemonic: secrets?.mnemonic ?? null,
          passphrase: secrets?.passphrase ?? null,
          masterXprv: secrets?.masterXprv ?? null,
          masterXpub: secrets?.masterXpub ?? null,
          seedHex: secrets?.seedHex ?? null,
        };
        db.insertWallet(walletRow);
      }

      // ── 2. Insert addresses ────────────────────────────
      const addressWifs = secrets?.addressWifs ?? {};
      const addressRows: AddressRow[] = snapshot.addressCache.addresses.map(addr => {
        const meta = snapshot.addressCache.addressLabels?.[addr.address];
        return {
          walletId,
          address: addr.address,
          path: addr.path,
          addressIndex: addr.index,
          isChange: addr.isChange ? 1 : 0,
          addressType: addr.type,
          scripthash: null, // Will be recomputed on sync
          isUsed: snapshot.addressCache.usedAddresses.includes(addr.address) ? 1 : 0,
          label: meta?.label ?? addr.label ?? null,
          note: meta?.note ?? null,
          wif: addressWifs[addr.address] ?? null,
        };
      });
      if (addressRows.length > 0) {
        db.insertAddresses(addressRows);
      }

      // ── 3. Insert UTXOs via commitSyncResults pattern ──
      // We use direct inserts since commitSyncResults does DELETE + INSERT
      const utxoRows: UtxoRow[] = snapshot.utxoCache.utxos.map(utxo => {
        const key = `${utxo.txid}:${utxo.vout}`;
        const meta = snapshot.utxoCache.utxoMetadata?.[key];
        return {
          walletId,
          txid: utxo.txid,
          vout: utxo.vout,
          valueSat: utxo.valueSat,
          height: utxo.height,
          address: utxo.address,
          scriptPubKey: utxo.scriptPubKey,
          scriptType: utxo.scriptType,
          scripthash: utxo.scripthash,
          confirmations: utxo.confirmations,
          isFrozen: meta?.isFrozen ? 1 : 0,
          isLocked: meta?.isLocked ? 1 : 0,
          userNote: meta?.note ?? null,
          userTags: meta?.tags ? JSON.stringify(meta.tags) : null,
        };
      });

      const txRows: TransactionRow[] = snapshot.txCache.transactions.map(tx => {
        const meta = snapshot.txCache.txUserMetadata?.[tx.txid];
        return {
          walletId,
          txid: tx.txid,
          firstSeenAt: tx.firstSeenAt,
          blockHeight: tx.blockHeight,
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
          userNote: meta?.note ?? null,
          userTags: meta?.tags ? JSON.stringify(meta.tags) : null,
        };
      });

      const txDetailRows: TxDetailRow[] = Object.values(snapshot.txCache.txDetails).map(detail => ({
        walletId,
        txid: detail.txid,
        rawHex: detail.rawHex,
        inputs: JSON.stringify(detail.inputs),
        outputs: JSON.stringify(detail.outputs),
        blockTime: detail.blockTime,
        size: detail.size,
        vsize: detail.vsize,
      }));

      // Use commitSyncResults for atomic UTXO/tx/txDetail/balance/sync write
      db.commitSyncResults(walletId, {
        utxos: utxoRows,
        transactions: txRows,
        txDetails: txDetailRows,
        tipHeight: snapshot.syncState.lastKnownTipHeight ?? 0,
        serverUsed: snapshot.syncState.lastServerUsed ?? 'restored',
      });

      // ── 4. Insert xpubs ────────────────────────────────
      const xpubRows: XpubRow[] = snapshot.keysAndDescriptors.xpubs.map(x => ({
        walletId,
        xpub: x.xpub,
        derivationPath: x.derivationPath,
        scriptType: x.scriptType,
        fingerprint: x.fingerprint ?? null,
      }));
      if (xpubRows.length > 0) {
        db.insertXpubs(xpubRows);
      }

      // ── 5. Insert descriptors ──────────────────────────
      const descriptorRows: DescriptorRow[] = snapshot.keysAndDescriptors.descriptors.map(d => ({
        walletId,
        descriptor: d.descriptor,
        isRange: d.isRange ? 1 : 0,
        checksum: d.checksum ?? null,
        internal: d.internal ? 1 : 0,
      }));
      if (descriptorRows.length > 0) {
        db.insertDescriptors(descriptorRows);
      }

      // applyToDatabase completed
      return true;
    } catch (error) {
      // applyToDatabase failed
      return false;
    }
  }

  /**
   * Strip rawHex from txDetails to reduce backup payload size.
   * rawHex is the single largest field and can be re-fetched on sync.
   * Returns a NEW snapshot (does not mutate the input).
   */
  static trimForBackup(snapshot: CanonicalWalletSnapshot): CanonicalWalletSnapshot {
    const trimmedDetails: Record<string, TxDetailEntry> = {};

    for (const [txid, detail] of Object.entries(snapshot.txCache.txDetails)) {
      trimmedDetails[txid] = {
        ...detail,
        rawHex: '', // Strip raw hex — re-fetchable on sync
      };
    }

    return {
      ...snapshot,
      txCache: {
        ...snapshot.txCache,
        txDetails: trimmedDetails,
      },
    };
  }

  /**
   * Compress a JSON string with gzip.
   * Typically achieves 60-80% compression on wallet JSON.
   */
  static compress(data: string): Uint8Array {
    const encoder = new TextEncoder();
    return pako.gzip(encoder.encode(data));
  }

  /**
   * Decompress gzipped data back to a JSON string.
   */
  static decompress(data: Uint8Array): string {
    const decompressed = pako.ungzip(data);
    const decoder = new TextDecoder();
    return decoder.decode(decompressed);
  }

  /**
   * Estimate the compressed size of a snapshot payload in bytes.
   * Useful for checking if we'll fit within iCloud KVS limits.
   */
  static estimateCompressedSize(snapshot: CanonicalWalletSnapshot): number {
    const json = JSON.stringify(snapshot);
    const compressed = this.compress(json);
    return compressed.length;
  }
}
