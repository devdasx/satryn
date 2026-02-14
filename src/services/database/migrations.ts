/**
 * Database Migrations
 *
 * Each migration is a versioned DDL function that upgrades the schema.
 * Migrations run in order and are tracked in the migration_log table.
 *
 * IMPORTANT: Never modify existing migrations. Always add new ones.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import servers from '../electrum/servers.json';

export interface Migration {
  version: number;
  description: string;
  up: (db: SQLiteDatabase) => void;
}

/**
 * All schema migrations in order.
 * Version numbers must be sequential starting from 1.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema — wallets, addresses, transactions, utxos, tx_details, xpubs, descriptors, sync_state, scripthash_status',
    up: (db: SQLiteDatabase) => {
      // ── Wallet metadata ──────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS wallets (
          walletId              TEXT PRIMARY KEY,
          name                  TEXT NOT NULL,
          walletType            TEXT NOT NULL,
          importSource          TEXT NOT NULL,
          createdAt             INTEGER NOT NULL,
          lastModified          INTEGER NOT NULL,
          network               TEXT NOT NULL DEFAULT 'mainnet',
          secretId              TEXT,
          fingerprint           TEXT,
          descriptor            TEXT,
          scriptTypes           TEXT NOT NULL,
          preferredAddressType  TEXT NOT NULL DEFAULT 'native_segwit',
          gapLimit              INTEGER NOT NULL DEFAULT 20,
          isMultisig            INTEGER NOT NULL DEFAULT 0,
          multisigConfig        TEXT,
          confirmedBalanceSat   INTEGER NOT NULL DEFAULT 0,
          unconfirmedBalanceSat INTEGER NOT NULL DEFAULT 0,
          watchOnlyData         TEXT
        );
      `);

      // ── Addresses ────────────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS addresses (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          address        TEXT NOT NULL,
          path           TEXT NOT NULL,
          addressIndex   INTEGER NOT NULL,
          isChange       INTEGER NOT NULL DEFAULT 0,
          addressType    TEXT NOT NULL,
          scripthash     TEXT,
          isUsed         INTEGER NOT NULL DEFAULT 0,
          label          TEXT,
          note           TEXT,
          UNIQUE(walletId, address)
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_addr_wallet ON addresses(walletId);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_addr_scripthash ON addresses(scripthash);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_addr_wallet_type ON addresses(walletId, addressType);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_addr_wallet_change ON addresses(walletId, isChange, addressType);`);

      // ── Transactions ─────────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS transactions (
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          txid           TEXT NOT NULL,
          firstSeenAt    INTEGER NOT NULL,
          blockHeight    INTEGER,
          confirmations  INTEGER NOT NULL DEFAULT 0,
          direction      TEXT NOT NULL,
          valueDeltaSat  INTEGER NOT NULL,
          feeSat         INTEGER NOT NULL DEFAULT 0,
          feeRate        INTEGER NOT NULL DEFAULT 0,
          isRBF          INTEGER NOT NULL DEFAULT 0,
          status         TEXT NOT NULL DEFAULT 'pending',
          inputCount     INTEGER NOT NULL DEFAULT 0,
          outputCount    INTEGER NOT NULL DEFAULT 0,
          size           INTEGER NOT NULL DEFAULT 0,
          vsize          INTEGER NOT NULL DEFAULT 0,
          userNote       TEXT,
          userTags       TEXT,
          PRIMARY KEY (walletId, txid)
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(walletId);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(walletId, status);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_tx_height ON transactions(walletId, blockHeight);`);

      // ── UTXOs ────────────────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS utxos (
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          txid           TEXT NOT NULL,
          vout           INTEGER NOT NULL,
          valueSat       INTEGER NOT NULL,
          height         INTEGER NOT NULL DEFAULT 0,
          address        TEXT NOT NULL,
          scriptPubKey   TEXT NOT NULL DEFAULT '',
          scriptType     TEXT NOT NULL,
          scripthash     TEXT NOT NULL DEFAULT '',
          confirmations  INTEGER NOT NULL DEFAULT 0,
          isFrozen       INTEGER NOT NULL DEFAULT 0,
          isLocked       INTEGER NOT NULL DEFAULT 0,
          userNote       TEXT,
          userTags       TEXT,
          PRIMARY KEY (walletId, txid, vout)
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_utxo_wallet ON utxos(walletId);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_utxo_addr ON utxos(walletId, address);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_utxo_scripthash ON utxos(walletId, scripthash);`);

      // ── Transaction Details ──────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS tx_details (
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          txid           TEXT NOT NULL,
          rawHex         TEXT NOT NULL DEFAULT '',
          inputs         TEXT NOT NULL,
          outputs        TEXT NOT NULL,
          blockTime      INTEGER,
          size           INTEGER NOT NULL DEFAULT 0,
          vsize          INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (walletId, txid)
        );
      `);

      // ── Extended Public Keys ─────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS xpubs (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          xpub           TEXT NOT NULL,
          derivationPath TEXT NOT NULL,
          scriptType     TEXT NOT NULL,
          fingerprint    TEXT
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_xpub_wallet ON xpubs(walletId);`);

      // ── Output Descriptors ───────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS descriptors (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          descriptor     TEXT NOT NULL,
          isRange        INTEGER NOT NULL DEFAULT 0,
          checksum       TEXT,
          internal       INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_desc_wallet ON descriptors(walletId);`);

      // ── Sync State ───────────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS sync_state (
          walletId              TEXT PRIMARY KEY REFERENCES wallets(walletId) ON DELETE CASCADE,
          status                TEXT NOT NULL DEFAULT 'idle',
          lastSuccessfulSyncAt  INTEGER,
          lastAttemptAt         INTEGER,
          lastKnownTipHeight    INTEGER,
          lastServerUsed        TEXT,
          isStale               INTEGER NOT NULL DEFAULT 0,
          failureCount          INTEGER NOT NULL DEFAULT 0,
          nextRetryAt           INTEGER,
          lastError             TEXT,
          lastErrorAt           INTEGER
        );
      `);

      // ── Scripthash Subscription Status ───────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS scripthash_status (
          walletId       TEXT NOT NULL REFERENCES wallets(walletId) ON DELETE CASCADE,
          scripthash     TEXT NOT NULL,
          address        TEXT NOT NULL,
          lastStatus     TEXT,
          lastCheckedAt  INTEGER,
          PRIMARY KEY (walletId, scripthash)
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_sh_wallet ON scripthash_status(walletId);`);
    },
  },
  {
    version: 2,
    description: 'Add key material columns to wallets + WIF to addresses',
    up: (db: SQLiteDatabase) => {
      // ── Wallet key material columns ──
      // Store mnemonic, secret type, master fingerprint, xprv, etc. for full DB export/debug
      db.execSync(`ALTER TABLE wallets ADD COLUMN secretType TEXT;`);       // 'mnemonic' | 'xprv' | 'wif' | 'wif_set' | 'seed_hex' | 'watch_only'
      db.execSync(`ALTER TABLE wallets ADD COLUMN mnemonic TEXT;`);         // BIP39 mnemonic phrase (encrypted at rest by OS)
      db.execSync(`ALTER TABLE wallets ADD COLUMN passphrase TEXT;`);       // BIP39 passphrase (25th word)
      db.execSync(`ALTER TABLE wallets ADD COLUMN masterXprv TEXT;`);       // Master extended private key
      db.execSync(`ALTER TABLE wallets ADD COLUMN masterXpub TEXT;`);       // Master extended public key
      db.execSync(`ALTER TABLE wallets ADD COLUMN seedHex TEXT;`);          // Raw seed bytes as hex

      // ── Address WIF column ──
      db.execSync(`ALTER TABLE addresses ADD COLUMN wif TEXT;`);            // Wallet Import Format private key
    },
  },
  {
    version: 3,
    description: 'Add contacts, contact_addresses, recent_recipients, app_config tables',
    up: (db: SQLiteDatabase) => {
      // ── Contacts ──────────────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS contacts (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          tags       TEXT NOT NULL DEFAULT '[]',
          notes      TEXT,
          isFavorite INTEGER NOT NULL DEFAULT 0,
          createdAt  INTEGER NOT NULL,
          updatedAt  INTEGER NOT NULL
        );
      `);

      // ── Contact Addresses ─────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS contact_addresses (
          id         TEXT PRIMARY KEY,
          contactId  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          label      TEXT,
          address    TEXT NOT NULL,
          network    TEXT NOT NULL DEFAULT 'mainnet',
          isDefault  INTEGER NOT NULL DEFAULT 0,
          createdAt  INTEGER NOT NULL,
          updatedAt  INTEGER
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_caddr_contact ON contact_addresses(contactId);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_caddr_address ON contact_addresses(address);`);

      // ── Recent Recipients ─────────────────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS recent_recipients (
          address    TEXT PRIMARY KEY,
          contactId  TEXT,
          label      TEXT,
          firstUsed  INTEGER NOT NULL,
          lastUsed   INTEGER NOT NULL,
          useCount   INTEGER NOT NULL DEFAULT 1
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_recip_last ON recent_recipients(lastUsed);`);

      // ── App Config (key-value store) ──────────────────────────────
      db.execSync(`
        CREATE TABLE IF NOT EXISTS app_config (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updatedAt  INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    description: 'Add color column to contacts table',
    up: (db: SQLiteDatabase) => {
      db.execSync(`ALTER TABLE contacts ADD COLUMN color TEXT`);
      // Assign random colors to existing contacts
      const colors = [
        '#5B7FFF', '#30D158', '#FF6482', '#8E8CE6', '#FF9F0A',
        '#4ECDC4', '#FF453A', '#BF5AF2', '#5AC8FA', '#34D399',
        '#FF6B6B', '#A78BFA', '#F59E0B', '#06B6D4', '#EC4899',
        '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#8B5CF6',
      ];
      const rows = db.getAllSync<{ id: string }>('SELECT id FROM contacts');
      for (const row of rows) {
        const c = colors[Math.floor(Math.random() * colors.length)];
        db.runSync('UPDATE contacts SET color = ? WHERE id = ?', [c, row.id]);
      }
    },
  },
  {
    version: 5,
    description: 'Add saved_servers table for user-managed electrum servers',
    up: (db: SQLiteDatabase) => {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS saved_servers (
          id          TEXT PRIMARY KEY,
          host        TEXT NOT NULL,
          port        INTEGER NOT NULL DEFAULT 50002,
          ssl         INTEGER NOT NULL DEFAULT 1,
          isBuiltIn   INTEGER NOT NULL DEFAULT 0,
          isUserAdded INTEGER NOT NULL DEFAULT 0,
          isFavorite  INTEGER NOT NULL DEFAULT 0,
          notes       TEXT,
          label       TEXT,
          createdAt   INTEGER NOT NULL,
          updatedAt   INTEGER NOT NULL,
          UNIQUE(host, port)
        );
      `);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_saved_servers_favorite ON saved_servers(isFavorite);`);
      db.execSync(`CREATE INDEX IF NOT EXISTS idx_saved_servers_host ON saved_servers(host);`);

      // Seed built-in servers from servers.json
      const now = Date.now();
      for (const entry of (servers as string[])) {
        const lastColon = entry.lastIndexOf(':');
        const host = lastColon === -1 ? entry : entry.substring(0, lastColon);
        const port = lastColon === -1 ? 50002 : (parseInt(entry.substring(lastColon + 1), 10) || 50002);
        const ssl = (port === 50002 || port === 50006 || port === 443) ? 1 : 0;
        const id = `builtin_${host}_${port}`;
        db.runSync(
          `INSERT OR IGNORE INTO saved_servers (id, host, port, ssl, isBuiltIn, isUserAdded, isFavorite, notes, label, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 1, 0, 0, NULL, NULL, ?, ?)`,
          [id, host, port, ssl, now, now]
        );
      }
    },
  },
];

/**
 * Bootstrap migration infrastructure — creates the migration_log table
 * if it doesn't already exist.
 */
export function ensureMigrationTable(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS migration_log (
      version     INTEGER PRIMARY KEY,
      appliedAt   INTEGER NOT NULL,
      description TEXT
    );
  `);
}

/**
 * Get the current schema version from migration_log.
 */
export function getCurrentVersion(db: SQLiteDatabase): number {
  const row = db.getFirstSync<{ maxVersion: number | null }>(
    'SELECT MAX(version) as maxVersion FROM migration_log'
  );
  return row?.maxVersion ?? 0;
}

/**
 * Run all pending migrations.
 * Returns the number of migrations applied.
 *
 * NOTE: Uses per-version check instead of MAX(version) to avoid conflicts
 * with V2MigrationService's marker (version=100) which would cause
 * getCurrentVersion() to return 100 and skip all schema migrations ≤100.
 */
export function runMigrations(db: SQLiteDatabase): number {
  ensureMigrationTable(db);
  const currentVersion = getCurrentVersion(db);
  let applied = 0;

  // Log all existing migration records for debugging
  const allMigrations = db.getAllSync<{ version: number; description: string | null }>(
    'SELECT version, description FROM migration_log ORDER BY version'
  );

  for (const migration of migrations) {
    // Check if THIS specific version has been applied (not MAX-based)
    // This avoids the V2MigrationService marker (v100) blocking schema migrations
    const alreadyApplied = db.getFirstSync<{ version: number }>(
      'SELECT version FROM migration_log WHERE version = ?',
      [migration.version]
    );
    if (alreadyApplied) continue;


    try {
      // Each migration runs in its own transaction for atomicity
      db.withTransactionSync(() => {
        migration.up(db);
        db.runSync(
          'INSERT INTO migration_log (version, appliedAt, description) VALUES (?, ?, ?)',
          [migration.version, Date.now(), migration.description]
        );
      });

      applied++;
    } catch (migErr: any) {
      // If ALTER TABLE fails because column already exists, record it as applied anyway
      if (migErr?.message?.includes('duplicate column') || migErr?.message?.includes('already exists')) {
        try {
          db.runSync(
            'INSERT OR IGNORE INTO migration_log (version, appliedAt, description) VALUES (?, ?, ?)',
            [migration.version, Date.now(), migration.description + ' (columns existed)']
          );
          applied++;
        } catch {}
      }
    }
  }

  if (applied > 0) {
  } else {
  }

  return applied;
}
