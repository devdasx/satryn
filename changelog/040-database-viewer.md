# 040 — Database Viewer + Transaction Data Fixes

**New settings screen to browse all SQLite database tables with expand/collapse rows and CSV export. Plus critical fixes for transaction direction, fees, inputs, sort order, and self-transfer detection.**

---

## Part 1: Database Viewer Screen

### New File: `app/(auth)/database-viewer.tsx` (~530 lines)

#### Screen Layout
- **Header**: Back button + "Database Viewer" title + CSV export button
- **Stats Summary**: Compact horizontal scroll of stat badges (Wallets, Addrs, UTXOs, Txns, Details, Schema version)
- **Table Selector**: Compact horizontal pill tabs for all 9 tables
- **Row Cards**: Expandable cards — tap to show all fields, long-press to copy values

#### Data Loading
- Uses **raw SQL queries** (`SELECT * FROM table ORDER BY rowid DESC LIMIT 500`) to show ALL rows across all wallets
- No wallet-scoped filtering — shows everything in the database for debugging/verification
- Stats from `db.getStats()` refresh when switching tables

#### Expandable Row Cards
- **Collapsed**: First 4 fields + "tap to expand" hint with chevron
- **Expanded**: All fields from the database row
- Smart value formatting: timestamps → readable dates, sats → locale-formatted, booleans → Yes/No, hex → truncated monospace
- Long-press any value to copy full content to clipboard

#### CSV Export
- Exports currently selected table as CSV
- Uses `expo-file-system` `File` + `Paths.cache` + `expo-sharing` share sheet
- Includes all columns in export

### Modified Files for Database Viewer
| File | Changes |
|------|---------|
| `app/(auth)/database-viewer.tsx` | **NEW** — Database viewer screen |
| `app/(auth)/(tabs)/settings.tsx` | Added "Database Viewer" row in ADVANCED section; added search keywords |
| `app/(auth)/_layout.tsx` | Added `<Stack.Screen name="database-viewer" />` |

---

## Part 2: Transaction Data Fixes

### Fix 1: Stale Data Re-fetch + Prevout Resolution
**File: `src/services/sync/SyncPipeline.ts`**

**Root Cause**: Many Electrum servers (fulcrum, older electrs) don't include `prevout` in the verbose `blockchain.transaction.get` response. The original code had two problems:
1. **Invalid fallbacks**: Used `vin.address` and `vin.value` which don't exist in Electrum protocol
2. **Stale data never re-fetched**: Once a txid existed in the DB with empty inputs, the incremental sync skipped it forever

**Fixes**:
- **Stale detection**: Before fetching, scans existing tx_details (LKG + DB) for inputs with `address='' && valueSat=0`. These "stale" txids are added to the fetch list alongside truly new txids.
- **Prevout resolution**: After decoding all transactions, batch-fetches referenced previous TXs to resolve input address/value from their outputs.
- **`extractAddress()` helper**: Handles both `scriptPubKey.address` (Electrum servers) and `scriptPubKey.addresses[]` (Bitcoin Core verbose format).
- **Cleaned up `decodeTxResult()`**: Removed invalid fallbacks (`vin.address`, `vin.value`).

### Fix 2: Transaction Sort Order (Oldest First → Newest First)
**File: `src/stores/walletStore.ts`**

**Fix**: Added explicit sort to both `loadWalletFromDB()` and `loadWalletFromV2()`:
- Pending transactions first (newest `firstSeen` first)
- Then confirmed transactions (highest `blockHeight` first)

### Fix 3: Self-Transfer Detection
**Files: `src/services/sync/WalletEngine.ts`, `src/services/electrum/SubscriptionManager.ts`**

**Root Cause**: Direction logic only had `incoming` | `outgoing`. When all inputs AND all outputs belong to the wallet (consolidation, self-send), the transaction should show as "Self Transfer" with `valueDeltaSat = -feeSat`.

**Fix**: Added self-transfer detection in both `buildLkgFromStaging()` and `buildLkgTransaction()`:
- If all inputs are wallet-owned AND all outputs are wallet-owned → `direction = 'self-transfer'`
- `valueDeltaSat` set to `-feeSat` (wallet only lost the fee)
- Updated `LkgTransaction.direction` type to include `'self-transfer'`

### Fix 4: DB ON CONFLICT Always Updates Direction/Fees
**File: `src/services/database/WalletDatabase.ts`**

**Root Cause**: The `ON CONFLICT` clause for the `transactions` table only updated `blockHeight`, `confirmations`, `status`, and conditionally `feeSat`. It never updated `direction` or `valueDeltaSat`, so stale data was preserved even after re-sync.

**Fix**: `ON CONFLICT` now always updates `direction` and `valueDeltaSat`, plus conditionally updates `inputCount` and `outputCount`.

### Fix 5: SubscriptionManager (Real-time Updates)
**File: `src/services/electrum/SubscriptionManager.ts`**

- Removed invalid fallbacks (`vin.address`, `vin.value`) from `decodeTxResult()`
- Added `extractAddress()` helper for `scriptPubKey.address` / `scriptPubKey.addresses[]`
- Added self-transfer detection in `buildLkgTransaction()`

### Modified Files for Transaction Fixes
| File | Changes |
|------|---------|
| `src/services/sync/SyncPipeline.ts` | Stale tx re-fetch; prevout resolution; `extractAddress()` helper; cleaned up `decodeTxResult()` |
| `src/services/sync/WalletEngine.ts` | Self-transfer detection in `buildLkgFromStaging()` |
| `src/services/sync/types.ts` | `LkgTransaction.direction` now includes `'self-transfer'` |
| `src/services/electrum/SubscriptionManager.ts` | Cleaned up `decodeTxResult()`; `extractAddress()`; self-transfer detection |
| `src/services/database/WalletDatabase.ts` | `ON CONFLICT` updates `direction`, `valueDeltaSat`, `inputCount`, `outputCount` |
| `src/stores/walletStore.ts` | Updated direction type cast; sort in `loadWalletFromDB()` and `loadWalletFromV2()` |
| `src/types/index.ts` | `TransactionInfo.type` and `DetailedTransactionInfo.type` include `'self-transfer'` |
| `app/(auth)/transactions.tsx` | Updated `getSmartLabel()` for `type === 'self-transfer'`; search filter for self-transfer |
| `app/(auth)/transaction-details.tsx` | Updated self-transfer detection to check `type === 'self-transfer'` |
| `app/(auth)/(tabs)/index.tsx` | Updated dashboard self-transfer detection |

---

## Part 3: Complete DB Persistence

### Fix 6: syncNewWalletToDb — Save ALL Wallet Data
**File: `src/stores/walletStore.ts`**

**Root Cause**: `syncNewWalletToDb()` only saved 3 things: wallet row, addresses, sync_state. It was **missing**: xpubs, descriptors, scripthash_status, and any existing LKG data (UTXOs, transactions, tx_details, balance).

**Fix**: Rewrote `syncNewWalletToDb()` to save everything:
1. Wallet metadata (with actual LKG balance, not 0)
2. Addresses (with used status + labels from V2)
3. Xpubs from V2 file
4. Descriptors from V2 file
5. Scripthash statuses (initialized with null)
6. LKG data: UTXOs, transactions, tx_details (with user metadata)
7. Sync state

### Fix 7: ensureDbComplete — Backfill for Existing Wallets
**File: `src/stores/walletStore.ts`**

**Problem**: Wallets created before the fix would still have empty xpubs/descriptors/tx_details tables in the DB.

**Fix**: New `ensureDbComplete()` function runs on every app startup (after V2 migration). For each wallet in the DB:
- Checks if xpubs, descriptors, scripthash_status, tx_details, UTXOs, or balance are missing
- Reads from the V2 JSON file and backfills any missing data
- Uses `INSERT OR IGNORE` to avoid duplicating existing rows
- Logs all backfills via SyncLogger

### Modified Files for DB Persistence
| File | Changes |
|------|---------|
| `src/stores/walletStore.ts` | Rewrote `syncNewWalletToDb()` to save all data; added `ensureDbComplete()` startup backfill; added imports for `XpubRow`, `DescriptorRow`, `UtxoRow`, `TransactionRow`, `TxDetailRow` |

---

## Part 4: Key Material & WIF in Database

### Migration v2: Key Material + WIF Columns
**File: `src/services/database/migrations.ts`**

Adds new columns via `ALTER TABLE`:
- **wallets table**: `secretType`, `mnemonic`, `passphrase`, `masterXprv`, `masterXpub`, `seedHex`
- **addresses table**: `wif` (Wallet Import Format private key)

### Fix 8: Store Key Material in Wallets Table
**Files: `src/stores/walletStore.ts`, `src/services/database/types.ts`, `src/services/database/WalletDatabase.ts`**

- `WalletRow` type extended with 6 new fields for key material
- `insertWallet()` updated to include all 24 columns
- `syncNewWalletToDb()` now accepts optional `WalletKeyMaterial` parameter
- All wallet creation call sites (createWallet, importFromWIF, importFromXprv, importFromSeedBytes, multisig) pass key material
- `KeyDerivation` class gets `getMasterXprv()` and `getMasterXpub()` methods

### Fix 9: Store WIF per Address
**Files: `src/stores/walletStore.ts`, `src/services/database/types.ts`, `src/services/database/WalletDatabase.ts`**

- `AddressRow` type extended with `wif: string | null`
- `insertAddresses()` updated to include `wif` column
- During wallet creation, WIFs are derived from `KeyDerivation.getWIF(path)` for each address before `keyDerivation.destroy()`
- V2MigrationService sets `wif: null` (requires PIN to derive)

### Fix 10: Backfill secretType for Existing Wallets
**File: `src/stores/walletStore.ts`**

`ensureDbComplete()` now backfills `secretType` from `walletType`:
- `hd_mnemonic` → `'mnemonic'`
- `hd_xprv` → `'xprv'`
- `imported_key` → `'wif'`
- `hd_seed` → `'seed_hex'`
- `watch_only` → `'watch_only'`

### Modified Files for Key Material
| File | Changes |
|------|---------|
| `src/services/database/migrations.ts` | Migration v2: ALTER TABLE wallets + addresses for key columns |
| `src/services/database/types.ts` | `WalletRow` + 6 key fields; `AddressRow` + `wif` |
| `src/services/database/WalletDatabase.ts` | `insertWallet()` 24 cols; `insertAddresses()` includes `wif` |
| `src/services/database/V2MigrationService.ts` | Added `secretType` + `wif: null` to migration rows |
| `src/stores/walletStore.ts` | `WalletKeyMaterial` interface; pass keys at all creation call sites; backfill `secretType` |
| `src/core/wallet/KeyDerivation.ts` | Added `getMasterXprv()` and `getMasterXpub()` methods |
| `app/(auth)/database-viewer.tsx` | Added new fields to `HEX_FIELDS` for truncation display |

---

## Part 5: Dashboard Transaction Display + Resilient DB Inserts

### Fix 11: Persist Transactions in Zustand Store
**File: `src/stores/walletStore.ts`**

**Root Cause**: `transactions` was NOT included in zustand's `partialize` config, so it was never persisted to AsyncStorage. On every app restart, `transactions: []` was the initial state until the DB/V2 load completed (deferred via `InteractionManager.runAfterInteractions`), causing "No activity yet" to flash.

**Fix**: Added `transactions: state.transactions` to the `partialize` function so transactions survive in AsyncStorage across app restarts and are available immediately when the dashboard renders.

### Fix 12: Resilient `insertWallet` — Column Fallback
**File: `src/services/database/WalletDatabase.ts`**

**Root Cause**: `insertWallet()` uses 24 columns (including migration v2 columns: `secretType`, `mnemonic`, `passphrase`, `masterXprv`, `masterXpub`, `seedHex`). If migration v2 hasn't run (blocked by v100), these columns don't exist in the schema, causing `insertWallet` to throw. This silently prevented `syncNewWalletToDb()` from inserting the wallet, which then caused:
- `loadWalletFromDB` fallback to V2 path
- FOREIGN KEY constraint failures during sync commit
- Empty xpubs/descriptors tables

**Fix**: Try the full 24-column insert first. If it fails with a "no column" error, fall back to the base 18-column insert.

### Fix 13: Resilient `insertAddresses` — WIF Column Check
**File: `src/services/database/WalletDatabase.ts`**

**Root Cause**: `insertAddresses()` includes the `wif` column (added in migration v2). If the column doesn't exist, all address inserts fail.

**Fix**: Check if the `wif` column exists before inserting. If not, use the 10-column insert without `wif`.

### Fix 14: `ensureDbComplete` — Backfill Missing Wallet Rows
**File: `src/stores/walletStore.ts`**

**Root Cause**: `ensureDbComplete()` only iterated wallets already in the DB. If `syncNewWalletToDb` failed (Fix 12), the wallet was never in the DB, and `ensureDbComplete` couldn't backfill xpubs/descriptors/UTXOs/transactions.

**Fix**: Before the existing backfill loop, iterate all known wallets from `multiWalletStore`. For any wallet missing from the DB, call `syncNewWalletToDb()` (which now has the column fallback) to insert it.

### Modified Files for Part 5
| File | Changes |
|------|---------|
| `src/stores/walletStore.ts` | Added `transactions` to `partialize`; `ensureDbComplete` backfills missing wallet rows; improved DIAG logging |
| `src/services/database/WalletDatabase.ts` | `insertWallet()` 18-column fallback; `insertAddresses()` wif column check |

---

## Part 6: Remove V2 JSON File Dependency — Database-Only Sync

**The sync/load pipeline no longer depends on V2 JSON files. The SQLite database is now the sole source of truth for wallet data.**

### Why This Matters
Previously, the sync engine (`WalletEngine`) loaded wallet data from V2 JSON files on disk, ran the Electrum sync pipeline, then dual-wrote results to both SQLite DB and V2 JSON. The `refreshBalance()` function checked `WalletFileV2Service.exists(walletId)` — if the V2 file was missing, the entire sync engine was skipped, falling through to a legacy sync path that lacked full transaction details. Wallets imported via 12-word mnemonic sometimes had no V2 file at all, causing 0 balance and "No activity yet" even with a working Electrum connection.

### Fix 15: WalletEngine Loads from Database
**File: `src/services/sync/WalletEngine.ts`**

- **Removed** `WalletFileV2Service` import entirely from WalletEngine
- **New `buildSchemaFromDB()`** method constructs a `WalletFileV2Schema` from SQLite data:
  - Reads wallet metadata, addresses, UTXOs, transactions, tx details, sync state from DB
  - Builds the same schema shape that `SyncPipeline` and `SyncValidator` expect
  - No V2 JSON file needed
- **`loadWallet()`** now calls `buildSchemaFromDB()` instead of `WalletFileV2Service.read()`
- **Post-sync commit**: Updates in-memory cache directly from the new LKG instead of re-reading V2 file
- **`handleSyncError()`**: Updates DB + in-memory cache instead of V2 file
- **Removed** all `WalletFileV2Service.write()` calls from metadata migration and UTXO reconciliation

### Fix 16: refreshBalance Uses DB Engine Path Always
**File: `src/stores/walletStore.ts`**

- **Removed** `v2Exists` check — no longer gates on `WalletFileV2Service.exists()`
- **Removed** entire legacy sync path (`syncWalletLight` + V2 file save + V2 Engine re-sync)
- `refreshBalance()` now always uses the DB-backed Engine path: `WalletEngine.loadWallet()` → `syncWallet()` → results to store
- On sync failure, gracefully preserves existing DB data in the store (no crash, no fallback)

### Fix 17: loadWalletFromDB — No V2 Fallback
**File: `src/stores/walletStore.ts`**

- **Removed** `loadWalletFromV2()` function entirely (~120 lines)
- `loadWalletFromDB()` returns `null` if wallet not in DB (instead of falling back to V2 file)
- All wallet data reads go through SQLite database exclusively

### Modified Files for Part 6
| File | Changes |
|------|---------|
| `src/services/sync/WalletEngine.ts` | Removed `WalletFileV2Service` import; new `buildSchemaFromDB()` method; `loadWallet()` reads from DB; post-sync cache updates from LKG; `handleSyncError()` uses DB; removed V2 writes |
| `src/stores/walletStore.ts` | Removed `loadWalletFromV2()` function; removed `v2Exists` gate; removed legacy sync path; removed V2 Engine re-sync; `loadWalletFromDB()` returns null instead of V2 fallback |

---

## Verification
- `npx tsc --noEmit` — zero errors
- After next sync, transactions will show correct direction (incoming/outgoing/self-transfer), correct fees, and populated inputs with raw hex
- Stale transactions with empty inputs will be automatically re-fetched on next sync
- Dashboard shows newest transactions first
- Dashboard shows transactions immediately on app restart (persisted in AsyncStorage)
- Database Viewer shows all data across all wallets: transactions with inputs/outputs/rawHex/fee, UTXOs, xpubs, descriptors, balance
- On app restart, `ensureDbComplete()` backfills any missing data
- Wallets missing from DB (due to column errors) are re-inserted on startup
- `insertWallet` and `insertAddresses` work even before migration v2 runs
- Wallets table now stores `secretType`, `mnemonic`, `masterXprv`, `masterXpub`, `seedHex`
- Addresses table now stores `wif` (WIF private key) for each address
- SH Status table populated with scripthash entries on wallet creation and startup backfill
- **Sync works without V2 JSON files** — wallet imported via 12-word mnemonic syncs correctly using DB-only path
- **No more "No activity yet" after import** — Engine loads addresses from DB, runs full pipeline, commits to DB
