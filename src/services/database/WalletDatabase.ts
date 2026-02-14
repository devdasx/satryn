/**
 * WalletDatabase — Core SQLite Database Service
 *
 * Singleton service providing all database operations for wallet data.
 * Uses expo-sqlite's synchronous API for reads (instant) and
 * WAL mode for concurrent access.
 *
 * IMPORTANT: Secrets (mnemonics, private keys) are NOT stored here.
 * They stay in expo-secure-store (iOS Keychain).
 */

import { openDatabaseSync, deleteDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from './migrations';
import type {
  WalletRow,
  AddressRow,
  TransactionRow,
  UtxoRow,
  TxDetailRow,
  XpubRow,
  DescriptorRow,
  SyncStateRow,
  ScripthashStatusRow,
  BalanceResult,
  CommitSyncParams,
  ContactRow,
  ContactAddressRow,
  RecentRecipientRow,
  AppConfigRow,
  SavedServerRow,
} from './types';
import { logger } from '../../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────

const DB_NAME = 'wallet.db';
const INSERT_BATCH_SIZE = 100; // Max rows per INSERT statement

// ─── Singleton ────────────────────────────────────────────────────────

let _instance: WalletDatabase | null = null;

// ─── WalletDatabase ──────────────────────────────────────────────────

export class WalletDatabase {
  private db: SQLiteDatabase;

  private constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  /**
   * Get the shared singleton instance.
   * Throws if not yet initialized.
   */
  static shared(): WalletDatabase {
    if (!_instance) {
      return WalletDatabase.initialize();
    }
    return _instance;
  }

  /**
   * Initialize the database singleton.
   * Creates the database file, enables WAL + foreign keys, runs migrations.
   * Safe to call multiple times — returns existing instance after first call.
   */
  static initialize(): WalletDatabase {
    if (_instance) {
      return _instance;
    }

    try {
      const db = openDatabaseSync(DB_NAME);

      // Enable WAL mode for concurrent reads during writes
      db.execSync('PRAGMA journal_mode = WAL;');
      // Enable foreign key enforcement (OFF by default in SQLite)
      db.execSync('PRAGMA foreign_keys = ON;');

      // Run schema migrations
      const applied = runMigrations(db);

      _instance = new WalletDatabase(db);
      return _instance;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Close the database connection.
   * Only used in tests or app teardown.
   */
  close(): void {
    this.db.closeSync();
    _instance = null;
  }

  /**
   * Close the connection and delete the SQLite database file + WAL/SHM journals.
   * Used during full app reset to leave zero database artifacts on disk.
   *
   * NOTE: If the file delete fails (e.g. OS file lock), this is non-fatal —
   * resetAllData() has already cleared all rows, so the DB is empty.
   */
  static deleteDatabase(): void {
    // Checkpoint WAL and close existing connection first
    if (_instance) {
      try {
        // Force WAL checkpoint so journal files are flushed before close
        _instance.db.execSync('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {}
      try {
        _instance.db.closeSync();
      } catch (e) {
      }
      _instance = null;
    }

    // Small delay is not possible in sync API, so attempt delete immediately.
    // This may fail if the OS still holds a file lock — that's OK since
    // resetAllData() already cleared all rows.
    try {
      deleteDatabaseSync(DB_NAME);
    } catch (e) {
      // Non-fatal: data was already cleared by resetAllData()
    }
  }

  /**
   * Get the raw SQLite database handle (for advanced queries / testing).
   */
  getDb(): SQLiteDatabase {
    return this.db;
  }

  // ═══════════════════════════════════════════════════════════════════
  // WALLET CRUD
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get a single wallet by ID.
   */
  getWallet(walletId: string): WalletRow | null {
    return this.db.getFirstSync<WalletRow>(
      'SELECT * FROM wallets WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Get all wallets, ordered by creation date.
   */
  getAllWallets(): WalletRow[] {
    return this.db.getAllSync<WalletRow>(
      'SELECT * FROM wallets ORDER BY createdAt ASC'
    );
  }

  /**
   * Insert a new wallet.
   */
  insertWallet(wallet: WalletRow): void {
    try {
      // Try full 24-column insert (requires migration v2)
      this.db.runSync(
        `INSERT INTO wallets (
          walletId, name, walletType, importSource, createdAt, lastModified,
          network, secretId, fingerprint, descriptor, scriptTypes,
          preferredAddressType, gapLimit, isMultisig, multisigConfig,
          confirmedBalanceSat, unconfirmedBalanceSat, watchOnlyData,
          secretType, mnemonic, passphrase, masterXprv, masterXpub, seedHex
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.walletId, wallet.name, wallet.walletType, wallet.importSource,
          wallet.createdAt, wallet.lastModified, wallet.network,
          wallet.secretId, wallet.fingerprint, wallet.descriptor,
          wallet.scriptTypes, wallet.preferredAddressType, wallet.gapLimit,
          wallet.isMultisig, wallet.multisigConfig,
          wallet.confirmedBalanceSat, wallet.unconfirmedBalanceSat,
          wallet.watchOnlyData,
          wallet.secretType ?? null, wallet.mnemonic ?? null, wallet.passphrase ?? null,
          wallet.masterXprv ?? null, wallet.masterXpub ?? null, wallet.seedHex ?? null,
        ]
      );
    } catch (e: any) {
      // Fallback: migration v2 columns may not exist yet — use base 18 columns
      if (e?.message?.includes('no column') || e?.message?.includes('has no column')) {
        this.db.runSync(
          `INSERT INTO wallets (
            walletId, name, walletType, importSource, createdAt, lastModified,
            network, secretId, fingerprint, descriptor, scriptTypes,
            preferredAddressType, gapLimit, isMultisig, multisigConfig,
            confirmedBalanceSat, unconfirmedBalanceSat, watchOnlyData
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            wallet.walletId, wallet.name, wallet.walletType, wallet.importSource,
            wallet.createdAt, wallet.lastModified, wallet.network,
            wallet.secretId, wallet.fingerprint, wallet.descriptor,
            wallet.scriptTypes, wallet.preferredAddressType, wallet.gapLimit,
            wallet.isMultisig, wallet.multisigConfig,
            wallet.confirmedBalanceSat, wallet.unconfirmedBalanceSat,
            wallet.watchOnlyData,
          ]
        );
      } else {
        throw e; // Re-throw non-column errors
      }
    }
  }

  /**
   * Update wallet fields. Only updates the keys present in `updates`.
   */
  updateWallet(walletId: string, updates: Partial<WalletRow>): void {
    const entries = Object.entries(updates).filter(([k]) => k !== 'walletId');
    if (entries.length === 0) return;

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);

    this.db.runSync(
      `UPDATE wallets SET ${setClauses}, lastModified = ? WHERE walletId = ?`,
      [...values, Date.now(), walletId]
    );
  }

  /**
   * Delete a wallet and all its associated data (CASCADE).
   */
  deleteWallet(walletId: string): void {
    this.db.runSync('DELETE FROM wallets WHERE walletId = ?', [walletId]);
  }

  /**
   * Get the count of wallets.
   */
  getWalletCount(): number {
    const row = this.db.getFirstSync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM wallets'
    );
    return row?.cnt ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DUPLICATE DETECTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Find an existing wallet by master fingerprint.
   * Used for duplicate detection of HD wallets (mnemonic, xprv, seed).
   */
  findWalletByFingerprint(fingerprint: string): WalletRow | null {
    return this.db.getFirstSync<WalletRow>(
      'SELECT * FROM wallets WHERE fingerprint = ? LIMIT 1',
      [fingerprint]
    );
  }

  /**
   * Find an existing wallet by xpub string.
   * Searches the xpubs table for an exact match, returns the owning wallet.
   */
  findWalletByXpub(xpub: string): WalletRow | null {
    const row = this.db.getFirstSync<{ walletId: string }>(
      'SELECT walletId FROM xpubs WHERE xpub = ? LIMIT 1',
      [xpub]
    );
    if (!row) return null;
    return this.getWallet(row.walletId);
  }

  /**
   * Find an existing wallet by descriptor string.
   * Checks both wallet-level descriptor column and the descriptors table.
   */
  findWalletByDescriptor(descriptor: string): WalletRow | null {
    // Check wallets.descriptor column (multisig wallets store it there)
    const direct = this.db.getFirstSync<WalletRow>(
      'SELECT * FROM wallets WHERE descriptor = ? LIMIT 1',
      [descriptor]
    );
    if (direct) return direct;

    // Check descriptors table (single-sig HD wallets)
    const row = this.db.getFirstSync<{ walletId: string }>(
      'SELECT walletId FROM descriptors WHERE descriptor = ? LIMIT 1',
      [descriptor]
    );
    if (!row) return null;
    return this.getWallet(row.walletId);
  }

  /**
   * Find an existing wallet that owns a specific address.
   * Used for WIF import duplicate detection (same WIF = same addresses).
   */
  findWalletByAddress(address: string): WalletRow | null {
    const row = this.db.getFirstSync<{ walletId: string }>(
      'SELECT walletId FROM addresses WHERE address = ? LIMIT 1',
      [address]
    );
    if (!row) return null;
    return this.getWallet(row.walletId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADDRESSES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get all addresses for a wallet.
   */
  getAddresses(walletId: string): AddressRow[] {
    return this.db.getAllSync<AddressRow>(
      'SELECT * FROM addresses WHERE walletId = ? ORDER BY addressType, isChange, addressIndex',
      [walletId]
    );
  }

  /**
   * Get addresses filtered by type.
   */
  getAddressesByType(walletId: string, addressType: string): AddressRow[] {
    return this.db.getAllSync<AddressRow>(
      'SELECT * FROM addresses WHERE walletId = ? AND addressType = ? ORDER BY isChange, addressIndex',
      [walletId, addressType]
    );
  }

  /**
   * Get addresses filtered by change flag and type.
   */
  getAddressesByChangeAndType(walletId: string, isChange: boolean, addressType: string): AddressRow[] {
    return this.db.getAllSync<AddressRow>(
      'SELECT * FROM addresses WHERE walletId = ? AND isChange = ? AND addressType = ? ORDER BY addressIndex',
      [walletId, isChange ? 1 : 0, addressType]
    );
  }

  /**
   * Update the WIF for a specific address row.
   */
  updateAddressWif(walletId: string, address: string, wif: string): void {
    this.db.runSync(
      'UPDATE addresses SET wif = ? WHERE walletId = ? AND address = ?',
      [wif, walletId, address]
    );
  }

  /**
   * Get all scripthashes for a wallet (for Electrum subscription).
   */
  getScripthashes(walletId: string): string[] {
    const rows = this.db.getAllSync<{ scripthash: string }>(
      'SELECT scripthash FROM addresses WHERE walletId = ? AND scripthash IS NOT NULL',
      [walletId]
    );
    return rows.map(r => r.scripthash);
  }

  // Cached flag for WIF column existence (checked once, not per call)
  private _hasWifColumn: boolean | null = null;

  private hasWifColumn(): boolean {
    if (this._hasWifColumn !== null) return this._hasWifColumn;
    try {
      this.db.getFirstSync('SELECT wif FROM addresses LIMIT 0');
      this._hasWifColumn = true;
    } catch {
      this._hasWifColumn = false;
    }
    return this._hasWifColumn;
  }

  /**
   * Batch insert addresses. Uses chunked inserts for performance.
   */
  insertAddresses(addresses: AddressRow[]): void {
    if (addresses.length === 0) return;

    const hasWifColumn = this.hasWifColumn();

    this.db.withTransactionSync(() => {
      for (let i = 0; i < addresses.length; i += INSERT_BATCH_SIZE) {
        const batch = addresses.slice(i, i + INSERT_BATCH_SIZE);
        for (const addr of batch) {
          if (hasWifColumn) {
            this.db.runSync(
              `INSERT OR IGNORE INTO addresses (
                walletId, address, path, addressIndex, isChange,
                addressType, scripthash, isUsed, label, note, wif
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                addr.walletId, addr.address, addr.path, addr.addressIndex,
                addr.isChange, addr.addressType, addr.scripthash,
                addr.isUsed, addr.label, addr.note, addr.wif ?? null,
              ]
            );
          } else {
            this.db.runSync(
              `INSERT OR IGNORE INTO addresses (
                walletId, address, path, addressIndex, isChange,
                addressType, scripthash, isUsed, label, note
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                addr.walletId, addr.address, addr.path, addr.addressIndex,
                addr.isChange, addr.addressType, addr.scripthash,
                addr.isUsed, addr.label, addr.note,
              ]
            );
          }
        }
      }
    });
  }

  /**
   * Mark an address as used.
   */
  markAddressUsed(walletId: string, address: string): void {
    this.db.runSync(
      'UPDATE addresses SET isUsed = 1 WHERE walletId = ? AND address = ?',
      [walletId, address]
    );
  }

  /**
   * Mark multiple addresses as used. Uses batched WHERE...IN for performance.
   */
  markAddressesUsed(walletId: string, addresses: string[]): void {
    if (addresses.length === 0) return;
    this.db.withTransactionSync(() => {
      const chunkSize = 500;
      for (let i = 0; i < addresses.length; i += chunkSize) {
        const chunk = addresses.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        this.db.runSync(
          `UPDATE addresses SET isUsed = 1 WHERE walletId = ? AND address IN (${placeholders})`,
          [walletId, ...chunk]
        );
      }
    });
  }

  /**
   * Get the first unused address for a given type and change flag.
   */
  getUnusedAddress(walletId: string, addressType: string, isChange: boolean): AddressRow | null {
    return this.db.getFirstSync<AddressRow>(
      `SELECT * FROM addresses
       WHERE walletId = ? AND addressType = ? AND isChange = ? AND isUsed = 0
       ORDER BY addressIndex ASC LIMIT 1`,
      [walletId, addressType, isChange ? 1 : 0]
    );
  }

  /**
   * Get the max address index for a given wallet/type/change combination.
   */
  getMaxAddressIndex(walletId: string, addressType: string, isChange: boolean): number {
    const row = this.db.getFirstSync<{ maxIdx: number | null }>(
      `SELECT MAX(addressIndex) as maxIdx FROM addresses
       WHERE walletId = ? AND addressType = ? AND isChange = ?`,
      [walletId, addressType, isChange ? 1 : 0]
    );
    return row?.maxIdx ?? -1;
  }

  /**
   * Get the highest address index that is marked as used.
   * Returns -1 if no used addresses exist for the given type+chain.
   */
  getHighestUsedIndex(walletId: string, addressType: string, isChange: boolean): number {
    const row = this.db.getFirstSync<{ maxIdx: number | null }>(
      `SELECT MAX(addressIndex) as maxIdx FROM addresses
       WHERE walletId = ? AND addressType = ? AND isChange = ? AND isUsed = 1`,
      [walletId, addressType, isChange ? 1 : 0]
    );
    return row?.maxIdx ?? -1;
  }

  /**
   * Get the count of addresses for a wallet.
   */
  getAddressCount(walletId: string): number {
    const row = this.db.getFirstSync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM addresses WHERE walletId = ?',
      [walletId]
    );
    return row?.cnt ?? 0;
  }

  /**
   * Get all used addresses for a wallet.
   */
  getUsedAddresses(walletId: string): string[] {
    const rows = this.db.getAllSync<{ address: string }>(
      'SELECT address FROM addresses WHERE walletId = ? AND isUsed = 1',
      [walletId]
    );
    return rows.map(r => r.address);
  }

  /**
   * Get an address row by address string.
   */
  getAddressByAddress(walletId: string, address: string): AddressRow | null {
    return this.db.getFirstSync<AddressRow>(
      'SELECT * FROM addresses WHERE walletId = ? AND address = ?',
      [walletId, address]
    );
  }

  /**
   * Get address by scripthash (for Electrum callback routing).
   */
  getAddressByScripthash(walletId: string, scripthash: string): AddressRow | null {
    return this.db.getFirstSync<AddressRow>(
      'SELECT * FROM addresses WHERE walletId = ? AND scripthash = ?',
      [walletId, scripthash]
    );
  }

  /**
   * Find which wallet owns a scripthash (cross-wallet lookup).
   */
  findWalletByScripthash(scripthash: string): { walletId: string; address: string } | null {
    return this.db.getFirstSync<{ walletId: string; address: string }>(
      'SELECT walletId, address FROM addresses WHERE scripthash = ? LIMIT 1',
      [scripthash]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTXOs
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get all UTXOs for a wallet.
   */
  getUtxos(walletId: string): UtxoRow[] {
    return this.db.getAllSync<UtxoRow>(
      'SELECT * FROM utxos WHERE walletId = ? ORDER BY height DESC, txid',
      [walletId]
    );
  }

  /**
   * Get spendable UTXOs (not frozen, not locked).
   */
  getSpendableUtxos(walletId: string): UtxoRow[] {
    return this.db.getAllSync<UtxoRow>(
      'SELECT * FROM utxos WHERE walletId = ? AND isFrozen = 0 AND isLocked = 0 ORDER BY valueSat DESC',
      [walletId]
    );
  }

  /**
   * Get wallet balance from UTXOs (single query, no full load).
   */
  getBalance(walletId: string): BalanceResult {
    const row = this.db.getFirstSync<{
      confirmed: number | null;
      unconfirmed: number | null;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN height > 0 THEN valueSat ELSE 0 END), 0) as confirmed,
        COALESCE(SUM(CASE WHEN height = 0 THEN valueSat ELSE 0 END), 0) as unconfirmed
       FROM utxos WHERE walletId = ?`,
      [walletId]
    );
    const confirmed = row?.confirmed ?? 0;
    const unconfirmed = row?.unconfirmed ?? 0;
    return { confirmed, unconfirmed, total: confirmed + unconfirmed };
  }

  /**
   * Get total balance across ALL wallets.
   */
  getTotalBalance(): BalanceResult {
    const row = this.db.getFirstSync<{
      confirmed: number | null;
      unconfirmed: number | null;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN height > 0 THEN valueSat ELSE 0 END), 0) as confirmed,
        COALESCE(SUM(CASE WHEN height = 0 THEN valueSat ELSE 0 END), 0) as unconfirmed
       FROM utxos`
    );
    const confirmed = row?.confirmed ?? 0;
    const unconfirmed = row?.unconfirmed ?? 0;
    return { confirmed, unconfirmed, total: confirmed + unconfirmed };
  }

  /**
   * Get UTXO count for a wallet.
   */
  getUtxoCount(walletId: string): number {
    const row = this.db.getFirstSync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM utxos WHERE walletId = ?',
      [walletId]
    );
    return row?.cnt ?? 0;
  }

  /**
   * Freeze/unfreeze a UTXO.
   */
  setUtxoFrozen(walletId: string, txid: string, vout: number, frozen: boolean): void {
    this.db.runSync(
      'UPDATE utxos SET isFrozen = ? WHERE walletId = ? AND txid = ? AND vout = ?',
      [frozen ? 1 : 0, walletId, txid, vout]
    );
  }

  /**
   * Lock/unlock a UTXO.
   */
  setUtxoLocked(walletId: string, txid: string, vout: number, locked: boolean): void {
    this.db.runSync(
      'UPDATE utxos SET isLocked = ? WHERE walletId = ? AND txid = ? AND vout = ?',
      [locked ? 1 : 0, walletId, txid, vout]
    );
  }

  /**
   * Set UTXO user note.
   */
  setUtxoNote(walletId: string, txid: string, vout: number, note: string | null): void {
    this.db.runSync(
      'UPDATE utxos SET userNote = ? WHERE walletId = ? AND txid = ? AND vout = ?',
      [note, walletId, txid, vout]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get transactions for a wallet, newest first.
   */
  getTransactions(walletId: string, limit?: number, offset?: number): TransactionRow[] {
    let sql = 'SELECT * FROM transactions WHERE walletId = ? ORDER BY firstSeenAt DESC';
    const params: any[] = [walletId];
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    if (offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(offset);
    }
    return this.db.getAllSync<TransactionRow>(sql, params);
  }

  /**
   * Get a single transaction.
   */
  getTransaction(walletId: string, txid: string): TransactionRow | null {
    return this.db.getFirstSync<TransactionRow>(
      'SELECT * FROM transactions WHERE walletId = ? AND txid = ?',
      [walletId, txid]
    );
  }

  /**
   * Get the set of txids that already exist in the DB (for incremental fetch).
   * Much faster than loading all transaction objects.
   */
  getExistingTxids(walletId: string, txids: string[]): Set<string> {
    if (txids.length === 0) return new Set();

    const existing = new Set<string>();

    // Process in chunks to avoid SQLite parameter limit
    const chunkSize = 500;
    for (let i = 0; i < txids.length; i += chunkSize) {
      const chunk = txids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db.getAllSync<{ txid: string }>(
        `SELECT txid FROM tx_details WHERE walletId = ? AND txid IN (${placeholders})`,
        [walletId, ...chunk]
      );
      for (const row of rows) {
        existing.add(row.txid);
      }
    }

    return existing;
  }

  /**
   * Get transaction count for a wallet.
   */
  getTransactionCount(walletId: string): number {
    const row = this.db.getFirstSync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM transactions WHERE walletId = ?',
      [walletId]
    );
    return row?.cnt ?? 0;
  }

  /**
   * Set transaction user note.
   */
  setTransactionNote(walletId: string, txid: string, note: string | null): void {
    this.db.runSync(
      'UPDATE transactions SET userNote = ? WHERE walletId = ? AND txid = ?',
      [note, walletId, txid]
    );
  }

  /**
   * Set transaction user tags.
   */
  setTransactionTags(walletId: string, txid: string, tags: string[]): void {
    this.db.runSync(
      'UPDATE transactions SET userTags = ? WHERE walletId = ? AND txid = ?',
      [JSON.stringify(tags), walletId, txid]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // TX DETAILS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get a single tx detail.
   */
  getTxDetail(walletId: string, txid: string): TxDetailRow | null {
    return this.db.getFirstSync<TxDetailRow>(
      'SELECT * FROM tx_details WHERE walletId = ? AND txid = ?',
      [walletId, txid]
    );
  }

  /**
   * Get multiple tx details by txid list.
   */
  getTxDetails(walletId: string, txids: string[]): Record<string, TxDetailRow> {
    if (txids.length === 0) return {};

    const result: Record<string, TxDetailRow> = {};
    const chunkSize = 500;

    for (let i = 0; i < txids.length; i += chunkSize) {
      const chunk = txids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db.getAllSync<TxDetailRow>(
        `SELECT * FROM tx_details WHERE walletId = ? AND txid IN (${placeholders})`,
        [walletId, ...chunk]
      );
      for (const row of rows) {
        result[row.txid] = row;
      }
    }

    return result;
  }

  /**
   * Get all tx details for a wallet.
   */
  getAllTxDetails(walletId: string): Record<string, TxDetailRow> {
    const rows = this.db.getAllSync<TxDetailRow>(
      'SELECT * FROM tx_details WHERE walletId = ?',
      [walletId]
    );
    const result: Record<string, TxDetailRow> = {};
    for (const row of rows) {
      result[row.txid] = row;
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // XPUBS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get xpubs for a wallet.
   */
  getXpubs(walletId: string): XpubRow[] {
    return this.db.getAllSync<XpubRow>(
      'SELECT * FROM xpubs WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Insert xpubs for a wallet.
   */
  insertXpubs(xpubs: XpubRow[]): void {
    if (xpubs.length === 0) return;
    this.db.withTransactionSync(() => {
      for (const xpub of xpubs) {
        this.db.runSync(
          `INSERT INTO xpubs (walletId, xpub, derivationPath, scriptType, fingerprint)
           VALUES (?, ?, ?, ?, ?)`,
          [xpub.walletId, xpub.xpub, xpub.derivationPath, xpub.scriptType, xpub.fingerprint]
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DESCRIPTORS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get descriptors for a wallet.
   */
  getDescriptors(walletId: string): DescriptorRow[] {
    return this.db.getAllSync<DescriptorRow>(
      'SELECT * FROM descriptors WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Insert descriptors for a wallet.
   */
  insertDescriptors(descriptors: DescriptorRow[]): void {
    if (descriptors.length === 0) return;
    this.db.withTransactionSync(() => {
      for (const desc of descriptors) {
        this.db.runSync(
          `INSERT INTO descriptors (walletId, descriptor, isRange, checksum, internal)
           VALUES (?, ?, ?, ?, ?)`,
          [desc.walletId, desc.descriptor, desc.isRange, desc.checksum, desc.internal]
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // SYNC STATE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get sync state for a wallet.
   */
  getSyncState(walletId: string): SyncStateRow | null {
    return this.db.getFirstSync<SyncStateRow>(
      'SELECT * FROM sync_state WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Initialize sync state for a new wallet.
   */
  initSyncState(walletId: string): void {
    this.db.runSync(
      `INSERT OR IGNORE INTO sync_state (walletId, status, isStale, failureCount)
       VALUES (?, 'idle', 0, 0)`,
      [walletId]
    );
  }

  /**
   * Record a successful sync.
   */
  recordSyncSuccess(walletId: string, tipHeight: number, server: string): void {
    const now = Date.now();
    this.db.runSync(
      `UPDATE sync_state SET
        status = 'synced',
        lastSuccessfulSyncAt = ?,
        lastAttemptAt = ?,
        lastKnownTipHeight = ?,
        lastServerUsed = ?,
        isStale = 0,
        failureCount = 0,
        nextRetryAt = NULL,
        lastError = NULL,
        lastErrorAt = NULL
       WHERE walletId = ?`,
      [now, now, tipHeight, server, walletId]
    );
  }

  /**
   * Record a sync error.
   */
  recordSyncError(walletId: string, error: string): void {
    const now = Date.now();
    // Read current failure count to compute backoff
    const state = this.getSyncState(walletId);
    const failureCount = (state?.failureCount ?? 0) + 1;
    // Exponential backoff: 30s, 60s, 120s, 240s, max 5min
    const backoffMs = Math.min(30000 * Math.pow(2, failureCount - 1), 300000);

    this.db.runSync(
      `UPDATE sync_state SET
        status = 'error',
        lastAttemptAt = ?,
        isStale = 1,
        failureCount = ?,
        nextRetryAt = ?,
        lastError = ?,
        lastErrorAt = ?
       WHERE walletId = ?`,
      [now, failureCount, now + backoffMs, error, now, walletId]
    );
  }

  /**
   * Mark sync as in progress.
   */
  markSyncing(walletId: string): void {
    this.db.runSync(
      `UPDATE sync_state SET status = 'syncing', lastAttemptAt = ? WHERE walletId = ?`,
      [Date.now(), walletId]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCRIPTHASH STATUS (incremental subscription tracking)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get all scripthash statuses for a wallet.
   */
  getScripthashStatuses(walletId: string): ScripthashStatusRow[] {
    return this.db.getAllSync<ScripthashStatusRow>(
      'SELECT * FROM scripthash_status WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Get a single scripthash status.
   */
  getScripthashStatus(walletId: string, scripthash: string): ScripthashStatusRow | null {
    return this.db.getFirstSync<ScripthashStatusRow>(
      'SELECT * FROM scripthash_status WHERE walletId = ? AND scripthash = ?',
      [walletId, scripthash]
    );
  }

  /**
   * Upsert a scripthash status after Electrum subscription response.
   */
  updateScripthashStatus(walletId: string, scripthash: string, address: string, status: string | null): void {
    this.db.runSync(
      `INSERT INTO scripthash_status (walletId, scripthash, address, lastStatus, lastCheckedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(walletId, scripthash)
       DO UPDATE SET lastStatus = excluded.lastStatus, lastCheckedAt = excluded.lastCheckedAt`,
      [walletId, scripthash, address, status, Date.now()]
    );
  }

  /**
   * Batch upsert scripthash statuses.
   */
  updateScripthashStatuses(entries: { walletId: string; scripthash: string; address: string; status: string | null }[]): void {
    if (entries.length === 0) return;
    const now = Date.now();
    this.db.withTransactionSync(() => {
      for (const entry of entries) {
        this.db.runSync(
          `INSERT INTO scripthash_status (walletId, scripthash, address, lastStatus, lastCheckedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(walletId, scripthash)
           DO UPDATE SET lastStatus = excluded.lastStatus, lastCheckedAt = excluded.lastCheckedAt`,
          [entry.walletId, entry.scripthash, entry.address, entry.status, now]
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // ATOMIC SYNC COMMIT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Atomically commit sync results to the database.
   * Replaces WalletFileV2Service.commitLkg().
   *
   * Runs in a single transaction:
   * 1. DELETE + INSERT all utxos
   * 2. INSERT OR REPLACE transactions
   * 3. INSERT OR REPLACE tx_details
   * 4. UPDATE wallet balance from UTXOs
   * 5. UPDATE sync_state to synced
   */
  commitSyncResults(walletId: string, params: CommitSyncParams): void {
    logger.perfStart('db-commit-sync');
    const { utxos, transactions, txDetails, tipHeight, serverUsed } = params;
    const now = Date.now();

    // Pre-check: wallet must exist in DB (foreign key target)
    const walletExists = this.db.getFirstSync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM wallets WHERE walletId = ?', [walletId]
    );
    if (!walletExists || walletExists.cnt === 0) {
      return;
    }

    this.db.withTransactionSync(() => {
      // ── 1. Replace UTXOs (full set replacement) ───────────────
      // Preserve user metadata (freeze, lock, notes, tags) before deleting
      const userMeta = this.getUtxoUserMeta(walletId);
      const metaMap = new Map<string, { isFrozen: number; isLocked: number; userNote: string | null; userTags: string | null }>();
      for (const m of userMeta) {
        metaMap.set(`${m.txid}:${m.vout}`, m);
      }

      this.db.runSync('DELETE FROM utxos WHERE walletId = ?', [walletId]);

      for (const utxo of utxos) {
        // Restore preserved user metadata for UTXOs that existed before
        const preserved = metaMap.get(`${utxo.txid}:${utxo.vout}`);

        this.db.runSync(
          `INSERT INTO utxos (
            walletId, txid, vout, valueSat, height, address,
            scriptPubKey, scriptType, scripthash, confirmations,
            isFrozen, isLocked, userNote, userTags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            walletId, utxo.txid, utxo.vout, utxo.valueSat, utxo.height,
            utxo.address, utxo.scriptPubKey, utxo.scriptType, utxo.scripthash,
            utxo.confirmations,
            preserved?.isFrozen ?? utxo.isFrozen,
            preserved?.isLocked ?? utxo.isLocked,
            preserved?.userNote ?? utxo.userNote,
            preserved?.userTags ?? utxo.userTags,
          ]
        );
      }

      // ── 2. Upsert transactions ────────────────────────────────
      for (const tx of transactions) {
        this.db.runSync(
          `INSERT INTO transactions (
            walletId, txid, firstSeenAt, blockHeight, confirmations,
            direction, valueDeltaSat, feeSat, feeRate, isRBF,
            status, inputCount, outputCount, size, vsize,
            userNote, userTags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(walletId, txid) DO UPDATE SET
            blockHeight = excluded.blockHeight,
            confirmations = excluded.confirmations,
            direction = excluded.direction,
            valueDeltaSat = excluded.valueDeltaSat,
            status = excluded.status,
            inputCount = CASE WHEN excluded.inputCount > 0 THEN excluded.inputCount ELSE transactions.inputCount END,
            outputCount = CASE WHEN excluded.outputCount > 0 THEN excluded.outputCount ELSE transactions.outputCount END,
            feeSat = CASE WHEN excluded.feeSat > 0 THEN excluded.feeSat ELSE transactions.feeSat END,
            feeRate = CASE WHEN excluded.feeRate > 0 THEN excluded.feeRate ELSE transactions.feeRate END,
            size = CASE WHEN excluded.size > 0 THEN excluded.size ELSE transactions.size END,
            vsize = CASE WHEN excluded.vsize > 0 THEN excluded.vsize ELSE transactions.vsize END`,
          [
            walletId, tx.txid, tx.firstSeenAt, tx.blockHeight, tx.confirmations,
            tx.direction, tx.valueDeltaSat, tx.feeSat, tx.feeRate, tx.isRBF,
            tx.status, tx.inputCount, tx.outputCount, tx.size, tx.vsize,
            tx.userNote, tx.userTags,
          ]
        );
      }

      // ── 3. Upsert tx details ──────────────────────────────────
      for (const detail of txDetails) {
        this.db.runSync(
          `INSERT INTO tx_details (
            walletId, txid, rawHex, inputs, outputs, blockTime, size, vsize
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(walletId, txid) DO UPDATE SET
            rawHex = CASE WHEN length(excluded.rawHex) > 0 THEN excluded.rawHex ELSE tx_details.rawHex END,
            inputs = excluded.inputs,
            outputs = excluded.outputs,
            blockTime = COALESCE(excluded.blockTime, tx_details.blockTime),
            size = CASE WHEN excluded.size > 0 THEN excluded.size ELSE tx_details.size END,
            vsize = CASE WHEN excluded.vsize > 0 THEN excluded.vsize ELSE tx_details.vsize END`,
          [
            walletId, detail.txid, detail.rawHex, detail.inputs,
            detail.outputs, detail.blockTime, detail.size, detail.vsize,
          ]
        );
      }

      // ── 4. Update wallet balance from UTXO sum ────────────────
      let confirmed = 0;
      let unconfirmed = 0;
      for (const utxo of utxos) {
        if (utxo.height > 0) {
          confirmed += utxo.valueSat;
        } else {
          unconfirmed += utxo.valueSat;
        }
      }

      this.db.runSync(
        `UPDATE wallets SET
          confirmedBalanceSat = ?,
          unconfirmedBalanceSat = ?,
          lastModified = ?
         WHERE walletId = ?`,
        [confirmed, unconfirmed, now, walletId]
      );

      // ── 5. Update sync state ──────────────────────────────────
      this.db.runSync(
        `INSERT INTO sync_state (walletId, status, lastSuccessfulSyncAt, lastAttemptAt, lastKnownTipHeight, lastServerUsed, isStale, failureCount)
         VALUES (?, 'synced', ?, ?, ?, ?, 0, 0)
         ON CONFLICT(walletId) DO UPDATE SET
          status = 'synced',
          lastSuccessfulSyncAt = excluded.lastSuccessfulSyncAt,
          lastAttemptAt = excluded.lastAttemptAt,
          lastKnownTipHeight = excluded.lastKnownTipHeight,
          lastServerUsed = excluded.lastServerUsed,
          isStale = 0,
          failureCount = 0,
          nextRetryAt = NULL,
          lastError = NULL,
          lastErrorAt = NULL`,
        [walletId, now, now, tipHeight, serverUsed]
      );

      // ── 6. Mark used addresses based on tx history ────────────
      // Any address that appears in transactions is considered used
      const usedAddrs = new Set<string>();
      for (const utxo of utxos) {
        usedAddrs.add(utxo.address);
      }
      // Also mark addresses from transaction details
      for (const detail of txDetails) {
        try {
          const inputs = JSON.parse(detail.inputs);
          const outputs = JSON.parse(detail.outputs);
          for (const inp of inputs) {
            if (inp.address) usedAddrs.add(inp.address);
          }
          for (const out of outputs) {
            if (out.address) usedAddrs.add(out.address);
          }
        } catch {
          // Skip malformed JSON
        }
      }

      if (usedAddrs.size > 0) {
        // Batch update using chunked WHERE...IN instead of per-address UPDATE
        const addrs = Array.from(usedAddrs);
        const chunkSize = 500;
        for (let i = 0; i < addrs.length; i += chunkSize) {
          const chunk = addrs.slice(i, i + chunkSize);
          const placeholders = chunk.map(() => '?').join(',');
          this.db.runSync(
            `UPDATE addresses SET isUsed = 1 WHERE walletId = ? AND address IN (${placeholders})`,
            [walletId, ...chunk]
          );
        }
      }
    });
    logger.perfEnd('db-commit-sync');
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════

  getAllContacts(): ContactRow[] {
    return this.db.getAllSync<ContactRow>(
      'SELECT * FROM contacts ORDER BY isFavorite DESC, name ASC'
    );
  }

  getContact(id: string): ContactRow | null {
    return this.db.getFirstSync<ContactRow>(
      'SELECT * FROM contacts WHERE id = ?', [id]
    );
  }

  insertContact(contact: ContactRow): void {
    this.db.runSync(
      `INSERT INTO contacts (id, name, tags, notes, isFavorite, color, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [contact.id, contact.name, contact.tags, contact.notes,
       contact.isFavorite, contact.color, contact.createdAt, contact.updatedAt]
    );
  }

  updateContact(id: string, updates: Partial<Omit<ContactRow, 'id' | 'createdAt'>>): void {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    this.db.runSync(
      `UPDATE contacts SET ${setClauses}, updatedAt = ? WHERE id = ?`,
      [...values, Date.now(), id]
    );
  }

  deleteContact(id: string): void {
    this.db.runSync('DELETE FROM contacts WHERE id = ?', [id]);
  }

  getContactAddresses(contactId: string): ContactAddressRow[] {
    return this.db.getAllSync<ContactAddressRow>(
      'SELECT * FROM contact_addresses WHERE contactId = ? ORDER BY isDefault DESC, createdAt ASC',
      [contactId]
    );
  }

  insertContactAddress(addr: ContactAddressRow): void {
    this.db.runSync(
      `INSERT INTO contact_addresses (id, contactId, label, address, network, isDefault, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [addr.id, addr.contactId, addr.label, addr.address, addr.network,
       addr.isDefault, addr.createdAt, addr.updatedAt]
    );
  }

  updateContactAddress(id: string, updates: Partial<Omit<ContactAddressRow, 'id' | 'contactId' | 'createdAt'>>): void {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    this.db.runSync(
      `UPDATE contact_addresses SET ${setClauses}, updatedAt = ? WHERE id = ?`,
      [...values, Date.now(), id]
    );
  }

  deleteContactAddress(id: string): void {
    this.db.runSync('DELETE FROM contact_addresses WHERE id = ?', [id]);
  }

  getContactByAddress(address: string): (ContactRow & { addressId: string }) | null {
    return this.db.getFirstSync<ContactRow & { addressId: string }>(
      `SELECT c.*, ca.id as addressId FROM contacts c
       JOIN contact_addresses ca ON ca.contactId = c.id
       WHERE ca.address = ? LIMIT 1`,
      [address]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RECENT RECIPIENTS
  // ═══════════════════════════════════════════════════════════════════

  getRecentRecipients(limit?: number): RecentRecipientRow[] {
    let sql = 'SELECT * FROM recent_recipients ORDER BY lastUsed DESC';
    if (limit !== undefined) sql += ` LIMIT ${limit}`;
    return this.db.getAllSync<RecentRecipientRow>(sql);
  }

  upsertRecipient(recipient: RecentRecipientRow): void {
    this.db.runSync(
      `INSERT INTO recent_recipients (address, contactId, label, firstUsed, lastUsed, useCount)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         contactId = COALESCE(excluded.contactId, recent_recipients.contactId),
         label = COALESCE(excluded.label, recent_recipients.label),
         lastUsed = excluded.lastUsed,
         useCount = recent_recipients.useCount + 1`,
      [recipient.address, recipient.contactId, recipient.label,
       recipient.firstUsed, recipient.lastUsed, recipient.useCount]
    );
  }

  deleteRecipient(address: string): void {
    this.db.runSync('DELETE FROM recent_recipients WHERE address = ?', [address]);
  }

  clearRecipients(): void {
    this.db.execSync('DELETE FROM recent_recipients;');
  }

  // ═══════════════════════════════════════════════════════════════════
  // APP CONFIG (key-value store)
  // ═══════════════════════════════════════════════════════════════════

  getConfig(key: string): string | null {
    const row = this.db.getFirstSync<AppConfigRow>(
      'SELECT * FROM app_config WHERE key = ?', [key]
    );
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db.runSync(
      `INSERT INTO app_config (key, value, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      [key, value, Date.now()]
    );
  }

  deleteConfig(key: string): void {
    this.db.runSync('DELETE FROM app_config WHERE key = ?', [key]);
  }

  getAllConfig(): AppConfigRow[] {
    return this.db.getAllSync<AppConfigRow>(
      'SELECT * FROM app_config ORDER BY key ASC'
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTXO METADATA
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Update user metadata on a specific UTXO.
   */
  updateUtxoMeta(walletId: string, txid: string, vout: number, meta: { isFrozen?: number; isLocked?: number; userNote?: string | null; userTags?: string | null }): void {
    const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    this.db.runSync(
      `UPDATE utxos SET ${setClauses} WHERE walletId = ? AND txid = ? AND vout = ?`,
      [...values, walletId, txid, vout]
    );
  }

  /**
   * Get all UTXO user metadata (for preserving across sync).
   * Returns only UTXOs that have non-default metadata.
   */
  getUtxoUserMeta(walletId: string): Array<{ txid: string; vout: number; isFrozen: number; isLocked: number; userNote: string | null; userTags: string | null }> {
    return this.db.getAllSync<{ txid: string; vout: number; isFrozen: number; isLocked: number; userNote: string | null; userTags: string | null }>(
      `SELECT txid, vout, isFrozen, isLocked, userNote, userTags FROM utxos
       WHERE walletId = ? AND (isFrozen = 1 OR isLocked = 1 OR userNote IS NOT NULL OR userTags IS NOT NULL)`,
      [walletId]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SAVED SERVERS
  // ═══════════════════════════════════════════════════════════════════

  getAllSavedServers(): SavedServerRow[] {
    try {
      return this.db.getAllSync<SavedServerRow>(
        'SELECT * FROM saved_servers ORDER BY isFavorite DESC, isUserAdded DESC, host ASC'
      );
    } catch {
      return [];
    }
  }

  getSavedServer(host: string, port: number): SavedServerRow | null {
    try {
      return this.db.getFirstSync<SavedServerRow>(
        'SELECT * FROM saved_servers WHERE host = ? AND port = ?',
        [host, port]
      );
    } catch {
      return null;
    }
  }

  upsertSavedServer(server: SavedServerRow): void {
    this.db.runSync(
      `INSERT INTO saved_servers (id, host, port, ssl, isBuiltIn, isUserAdded, isFavorite, notes, label, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host, port) DO UPDATE SET
         ssl = excluded.ssl,
         isFavorite = excluded.isFavorite,
         notes = excluded.notes,
         label = excluded.label,
         updatedAt = excluded.updatedAt`,
      [server.id, server.host, server.port, server.ssl, server.isBuiltIn,
       server.isUserAdded, server.isFavorite, server.notes, server.label,
       server.createdAt, server.updatedAt]
    );
  }

  deleteSavedServer(id: string): void {
    this.db.runSync(
      'DELETE FROM saved_servers WHERE id = ? AND isBuiltIn = 0',
      [id]
    );
  }

  toggleServerFavorite(id: string): void {
    this.db.runSync(
      'UPDATE saved_servers SET isFavorite = CASE WHEN isFavorite = 1 THEN 0 ELSE 1 END, updatedAt = ? WHERE id = ?',
      [Date.now(), id]
    );
  }

  getFavoriteServers(): SavedServerRow[] {
    try {
      return this.db.getAllSync<SavedServerRow>(
        'SELECT * FROM saved_servers WHERE isFavorite = 1 ORDER BY host ASC'
      );
    } catch {
      return [];
    }
  }

  updateServerNotes(id: string, notes: string | null): void {
    this.db.runSync(
      'UPDATE saved_servers SET notes = ?, updatedAt = ? WHERE id = ?',
      [notes, Date.now(), id]
    );
  }

  updateServerLabel(id: string, label: string | null): void {
    this.db.runSync(
      'UPDATE saved_servers SET label = ?, updatedAt = ? WHERE id = ?',
      [label, Date.now(), id]
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY / DEBUG
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get database stats for debugging.
   */
  getStats(): {
    wallets: number;
    addresses: number;
    utxos: number;
    transactions: number;
    txDetails: number;
    contacts: number;
    contactAddresses: number;
    recentRecipients: number;
    appConfig: number;
    schemaVersion: number;
  } {
    const wallets = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM wallets')?.cnt ?? 0;
    const addresses = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM addresses')?.cnt ?? 0;
    const utxos = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM utxos')?.cnt ?? 0;
    const transactions = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM transactions')?.cnt ?? 0;
    const txDetails = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM tx_details')?.cnt ?? 0;
    const schemaVersion = this.db.getFirstSync<{ maxVersion: number | null }>('SELECT MAX(version) as maxVersion FROM migration_log')?.maxVersion ?? 0;

    // New v3 tables — gracefully handle if migration hasn't run yet
    let contacts = 0, contactAddresses = 0, recentRecipients = 0, appConfig = 0;
    try {
      contacts = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM contacts')?.cnt ?? 0;
      contactAddresses = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM contact_addresses')?.cnt ?? 0;
      recentRecipients = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM recent_recipients')?.cnt ?? 0;
      appConfig = this.db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM app_config')?.cnt ?? 0;
    } catch {
      // Tables don't exist yet — that's OK
    }

    return { wallets, addresses, utxos, transactions, txDetails, contacts, contactAddresses, recentRecipients, appConfig, schemaVersion };
  }

  /**
   * Nuke all data (for testing or wallet reset).
   * Preserves schema — only deletes rows.
   */
  resetAllData(): void {
    this.db.withTransactionSync(() => {
      this.db.execSync('DELETE FROM scripthash_status;');
      this.db.execSync('DELETE FROM tx_details;');
      this.db.execSync('DELETE FROM transactions;');
      this.db.execSync('DELETE FROM utxos;');
      this.db.execSync('DELETE FROM descriptors;');
      this.db.execSync('DELETE FROM xpubs;');
      this.db.execSync('DELETE FROM sync_state;');
      this.db.execSync('DELETE FROM addresses;');
      this.db.execSync('DELETE FROM wallets;');
      // v3 tables — safe to run even if tables don't exist yet
      try {
        this.db.execSync('DELETE FROM contact_addresses;');
        this.db.execSync('DELETE FROM contacts;');
        this.db.execSync('DELETE FROM recent_recipients;');
        this.db.execSync('DELETE FROM app_config;');
      } catch {
        // Tables may not exist if migration v3 hasn't run
      }
      // v5 tables
      try {
        this.db.execSync('DELETE FROM saved_servers;');
      } catch {
        // Table may not exist if migration v5 hasn't run
      }
    });
  }
}
