/**
 * V2MigrationService — One-time migration from V2 JSON files to SQLite
 *
 * Called once on first app launch after the SQLite upgrade.
 * Reads all existing WalletFileV2 JSON files and inserts their data
 * into the SQLite database.
 *
 * V2 JSON files are kept as backup for one release cycle.
 */

import { File, Directory, Paths } from 'expo-file-system';
import { WalletDatabase } from './WalletDatabase';
import { WalletFileV2Service } from '../storage/WalletFileV2';
import type { WalletFileV2Schema } from '../storage/WalletFileV2';
import { addressToScripthash } from '../electrum/scripthash';
import type {
  WalletRow,
  AddressRow,
  TransactionRow,
  UtxoRow,
  TxDetailRow,
  XpubRow,
  DescriptorRow,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────

const WALLET_DIR_NAME = 'wallets';
const MIGRATION_VERSION = 100; // V2 JSON → SQLite migration marker

// ─── V2MigrationService ──────────────────────────────────────────────

export class V2MigrationService {

  /**
   * Run migration if not already done.
   * Safe to call on every startup — checks migration_log first.
   */
  static migrateIfNeeded(): { migrated: boolean; walletsCount: number } {
    const db = WalletDatabase.shared();
    const rawDb = db.getDb();

    // Check if already migrated
    const existing = rawDb.getFirstSync<{ version: number }>(
      'SELECT version FROM migration_log WHERE version = ?',
      [MIGRATION_VERSION]
    );
    if (existing) {
      return { migrated: false, walletsCount: 0 };
    }

    // Discover all V2 JSON wallet files
    const walletFiles = this.discoverWalletFiles();
    if (walletFiles.length === 0) {
      this.recordMigration(rawDb);
      return { migrated: true, walletsCount: 0 };
    }


    let migratedCount = 0;

    for (const walletId of walletFiles) {
      try {
        const success = this.migrateWallet(walletId, db);
        if (success) {
          migratedCount++;
        }
      } catch (error) {
        // Continue with other wallets — don't let one failure block all
      }
    }

    // Record migration as done
    this.recordMigration(rawDb);


    // Log DB stats after migration for verification
    try {
      const stats = db.getStats();
    } catch (e) {
    }

    return { migrated: true, walletsCount: migratedCount };
  }

  // ─── Discovery ───────────────────────────────────────────────────

  /**
   * Discover wallet IDs from JSON files in the wallets directory.
   * Returns an array of wallet IDs (filename without .json extension).
   */
  private static discoverWalletFiles(): string[] {
    try {
      const dir = new Directory(Paths.document, WALLET_DIR_NAME);
      if (!dir.exists) return [];

      const entries = dir.list();
      const walletIds: string[] = [];

      for (const entry of entries) {
        if (entry instanceof File && entry.name?.endsWith('.json') && !entry.name.endsWith('.bak')) {
          // Strip .json extension to get walletId
          const walletId = entry.name.replace(/\.json$/, '');
          walletIds.push(walletId);
        }
      }

      return walletIds;
    } catch (error) {
      return [];
    }
  }

  // ─── Per-Wallet Migration ────────────────────────────────────────

  /**
   * Migrate a single wallet from V2 JSON to SQLite.
   * Returns true on success.
   */
  static migrateWallet(walletId: string, db: WalletDatabase): boolean {
    // Skip if wallet already exists in DB
    if (db.getWallet(walletId)) {
      return true;
    }

    // Read V2 JSON file
    const v2Data = WalletFileV2Service.read(walletId);
    if (!v2Data) {
      return false;
    }

    // Insert everything in a single transaction
    const rawDb = db.getDb();
    rawDb.withTransactionSync(() => {
      // 1. Insert wallet metadata
      this.insertWalletRow(db, v2Data);

      // 2. Insert addresses (with pre-computed scripthashes)
      this.insertAddressRows(db, v2Data);

      // 3. Insert UTXOs from LKG
      this.insertUtxoRows(db, v2Data);

      // 4. Insert transactions from LKG
      this.insertTransactionRows(db, v2Data);

      // 5. Insert tx details from LKG
      this.insertTxDetailRows(db, v2Data);

      // 6. Insert sync state
      this.insertSyncState(db, v2Data);

      // 7. Insert xpubs
      this.insertXpubRows(db, v2Data);

      // 8. Insert descriptors
      this.insertDescriptorRows(db, v2Data);

      // 9. Insert scripthash statuses (initialized with null status)
      this.insertScripthashStatuses(db, v2Data);
    });

    // Verify migration
    return this.verifyMigration(db, v2Data);
  }

  // ─── Row Builders ────────────────────────────────────────────────

  private static insertWalletRow(db: WalletDatabase, v2: WalletFileV2Schema): void {
    // Map walletType → secretType for migration
    const walletTypeToSecretType: Record<string, string> = {
      hd_mnemonic: 'mnemonic', hd_xprv: 'xprv', hd_seed: 'seed_hex',
      imported_key: 'wif', imported_keys: 'wif_set',
      watch_only: 'watch_only', multisig: 'mnemonic',
    };

    const walletRow: WalletRow = {
      walletId: v2.walletId,
      name: v2.name,
      walletType: v2.walletType,
      importSource: v2.importSource,
      createdAt: v2.createdAt,
      lastModified: v2.lastModified,
      network: v2.network,
      secretId: v2.keyRef.secretId,
      fingerprint: v2.keyRef.fingerprint,
      descriptor: v2.keyRef.descriptor,
      scriptTypes: JSON.stringify(v2.keyRef.scriptTypes),
      preferredAddressType: v2.scriptInventory.preferredAddressType,
      gapLimit: v2.scriptInventory.gapLimit,
      isMultisig: v2.isMultisig ? 1 : 0,
      multisigConfig: v2.multisigConfig ? JSON.stringify(v2.multisigConfig) : null,
      confirmedBalanceSat: v2.lkg.confirmedBalanceSat,
      unconfirmedBalanceSat: v2.lkg.unconfirmedBalanceSat,
      watchOnlyData: v2.watchOnlyData ? JSON.stringify(v2.watchOnlyData) : null,
      // Key material — populated later when secrets are available (PIN required)
      secretType: walletTypeToSecretType[v2.walletType] || null,
      mnemonic: null,
      passphrase: null,
      masterXprv: null,
      masterXpub: null,
      seedHex: null,
    };
    db.insertWallet(walletRow);
  }

  private static insertAddressRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const addresses = v2.scriptInventory.addresses;
    if (!addresses || addresses.length === 0) return;

    const usedSet = new Set(v2.scriptInventory.usedAddresses || []);
    const labelMap = v2.addressLabels || {};

    const rows: AddressRow[] = addresses.map(addr => {
      let scripthash: string | null = null;
      try {
        scripthash = addressToScripthash(addr.address, 'mainnet');
      } catch {
        // Some addresses may not be valid for scripthash conversion
      }

      const labelData = labelMap[addr.address];

      return {
        walletId: v2.walletId,
        address: addr.address,
        path: addr.path,
        addressIndex: addr.index,
        isChange: addr.isChange ? 1 : 0,
        addressType: this.mapAddressType(addr.type),
        scripthash,
        isUsed: usedSet.has(addr.address) ? 1 : 0,
        label: labelData?.label ?? addr.label ?? null,
        note: labelData?.note ?? null,
        wif: null,  // WIF requires PIN — populated when secrets are available
      };
    });

    db.insertAddresses(rows);
  }

  private static insertUtxoRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const utxos = v2.lkg.utxos;
    if (!utxos || utxos.length === 0) return;

    const utxoMetadata = v2.utxoUserMetadata || {};
    const rawDb = db.getDb();

    for (const utxo of utxos) {
      const outpoint = `${utxo.txid}:${utxo.vout}`;
      const meta = utxoMetadata[outpoint];

      rawDb.runSync(
        `INSERT OR IGNORE INTO utxos (
          walletId, txid, vout, valueSat, height, address,
          scriptPubKey, scriptType, scripthash, confirmations,
          isFrozen, isLocked, userNote, userTags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v2.walletId, utxo.txid, utxo.vout, utxo.valueSat,
          utxo.height, utxo.address, utxo.scriptPubKey,
          utxo.scriptType, utxo.scripthash, utxo.confirmations,
          meta?.isFrozen ? 1 : 0,
          meta?.isLocked ? 1 : 0,
          meta?.note ?? null,
          meta?.tags ? JSON.stringify(meta.tags) : null,
        ]
      );
    }
  }

  private static insertTransactionRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const transactions = v2.lkg.transactions;
    if (!transactions || transactions.length === 0) return;

    const txMetadata = v2.txUserMetadata || {};
    const rawDb = db.getDb();

    for (const tx of transactions) {
      const meta = txMetadata[tx.txid];

      rawDb.runSync(
        `INSERT OR IGNORE INTO transactions (
          walletId, txid, firstSeenAt, blockHeight, confirmations,
          direction, valueDeltaSat, feeSat, feeRate, isRBF,
          status, inputCount, outputCount, size, vsize,
          userNote, userTags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v2.walletId, tx.txid, tx.firstSeenAt,
          tx.blockHeight ?? null, tx.confirmations,
          tx.direction, tx.valueDeltaSat, tx.feeSat, tx.feeRate,
          tx.isRBF ? 1 : 0, tx.status,
          tx.inputCount, tx.outputCount, tx.size, tx.vsize,
          meta?.note ?? null,
          meta?.tags ? JSON.stringify(meta.tags) : null,
        ]
      );
    }
  }

  private static insertTxDetailRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const txDetails = v2.lkg.txDetails;
    if (!txDetails) return;

    const rawDb = db.getDb();

    for (const [txid, detail] of Object.entries(txDetails)) {
      rawDb.runSync(
        `INSERT OR IGNORE INTO tx_details (
          walletId, txid, rawHex, inputs, outputs, blockTime, size, vsize
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v2.walletId, txid, detail.rawHex,
          JSON.stringify(detail.inputs),
          JSON.stringify(detail.outputs),
          detail.blockTime, detail.size, detail.vsize,
        ]
      );
    }
  }

  private static insertSyncState(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const ss = v2.syncState;
    const rawDb = db.getDb();

    rawDb.runSync(
      `INSERT OR IGNORE INTO sync_state (
        walletId, status, lastSuccessfulSyncAt, lastAttemptAt,
        lastKnownTipHeight, lastServerUsed, isStale, failureCount,
        nextRetryAt, lastError, lastErrorAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        v2.walletId, ss.status,
        ss.lastSuccessfulSyncAt, ss.lastAttemptAt,
        ss.lastKnownTipHeight, ss.lastServerUsed,
        ss.isStale ? 1 : 0, ss.failureCount,
        ss.nextRetryAt, ss.lastError, ss.lastErrorAt,
      ]
    );
  }

  private static insertXpubRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const xpubs = v2.xpubs;
    if (!xpubs || xpubs.length === 0) return;

    const rows: XpubRow[] = xpubs.map(x => ({
      walletId: v2.walletId,
      xpub: x.xpub,
      derivationPath: x.derivationPath,
      scriptType: x.scriptType,
      fingerprint: x.fingerprint ?? null,
    }));

    db.insertXpubs(rows);
  }

  private static insertDescriptorRows(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const descriptors = v2.descriptors;
    if (!descriptors || descriptors.length === 0) return;

    const rows: DescriptorRow[] = descriptors.map(d => ({
      walletId: v2.walletId,
      descriptor: d.descriptor,
      isRange: d.isRange ? 1 : 0,
      checksum: d.checksum ?? null,
      internal: d.internal ? 1 : 0,
    }));

    db.insertDescriptors(rows);
  }

  private static insertScripthashStatuses(db: WalletDatabase, v2: WalletFileV2Schema): void {
    const addresses = v2.scriptInventory.addresses;
    if (!addresses || addresses.length === 0) return;

    const entries: { walletId: string; scripthash: string; address: string; status: string | null }[] = [];

    for (const addr of addresses) {
      try {
        const scripthash = addressToScripthash(addr.address, 'mainnet');
        entries.push({
          walletId: v2.walletId,
          scripthash,
          address: addr.address,
          status: null, // Will be populated on first Electrum subscribe
        });
      } catch {
        // Skip invalid addresses
      }
    }

    db.updateScripthashStatuses(entries);
  }

  // ─── Verification ────────────────────────────────────────────────

  private static verifyMigration(db: WalletDatabase, v2: WalletFileV2Schema): boolean {
    const walletId = v2.walletId;

    // Verify wallet exists
    const wallet = db.getWallet(walletId);
    if (!wallet) {
      return false;
    }

    // Verify address count
    const addrCount = db.getAddressCount(walletId);
    const expectedAddrs = v2.scriptInventory.addresses?.length ?? 0;
    if (addrCount !== expectedAddrs) {
    }

    // Verify UTXO count
    const utxoCount = db.getUtxoCount(walletId);
    const expectedUtxos = v2.lkg.utxos?.length ?? 0;
    if (utxoCount !== expectedUtxos) {
    }

    // Verify balance matches
    const balance = db.getBalance(walletId);
    if (balance.confirmed !== v2.lkg.confirmedBalanceSat) {
    }

    // Verify transaction count
    const txCount = db.getTransactionCount(walletId);
    const expectedTxs = v2.lkg.transactions?.length ?? 0;
    if (txCount !== expectedTxs) {
    }


    return true;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Map AddressType enum value to canonical script type for DB storage.
   */
  private static mapAddressType(addressType: string): string {
    switch (addressType) {
      case 'native_segwit': return 'p2wpkh';
      case 'wrapped_segwit': return 'p2sh-p2wpkh';
      case 'legacy': return 'p2pkh';
      case 'taproot': return 'p2tr';
      default: return addressType; // Already canonical (p2wpkh, etc.)
    }
  }

  /**
   * Record migration as complete in migration_log.
   */
  private static recordMigration(rawDb: any): void {
    rawDb.runSync(
      'INSERT OR IGNORE INTO migration_log (version, appliedAt, description) VALUES (?, ?, ?)',
      [MIGRATION_VERSION, Date.now(), 'V2 JSON files migrated to SQLite']
    );
  }
}
