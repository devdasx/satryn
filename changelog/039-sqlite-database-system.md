# 039 — Full SQLite Database System + Diagnostic Logging + Legacy Path Fix

**Complete SQLite persistence layer for wallet data, replacing in-memory/JSON-only storage. Includes V2 migration service, dual-write sync, diagnostic logging, and legacy refresh path fix.**

---

## Phase 1: SQLite Database System (5 New Files, ~1,925 Lines)

### New File: `src/services/database/types.ts` (~200 lines)
- Row type interfaces for all 10 SQL tables:
  - `WalletRow` — wallet metadata (id, name, type, importSource, network, secretId, fingerprint, descriptor, scriptTypes, gapLimit, balance, etc.)
  - `AddressRow` — derived addresses (path, index, isChange, addressType, scripthash, isUsed, label, note)
  - `TransactionRow` — transaction history (txid, firstSeenAt, blockHeight, confirmations, direction, valueDeltaSat, fees, status, RBF, sizes)
  - `UtxoRow` — unspent outputs (txid, vout, valueSat, height, address, scriptPubKey, isFrozen, isLocked)
  - `TxDetailRow` — full tx details (rawHex, inputs JSON, outputs JSON, blockTime, sizes)
  - `XpubRow` — extended public keys (xpub, derivationPath, scriptType, fingerprint)
  - `DescriptorRow` — output descriptors (descriptor, isRange, checksum, internal)
  - `SyncStateRow` — per-wallet sync state (status, lastSuccessfulSyncAt, failureCount, backoff)
  - `ScripthashStatusRow` — Electrum subscription tracking (scripthash, lastStatus)
  - `MigrationLogRow`, `BalanceResult`, `CommitSyncParams`

### New File: `src/services/database/migrations.ts` (~256 lines)
- Schema v1 DDL: 10 `CREATE TABLE` statements with proper foreign keys (`ON DELETE CASCADE`)
- Indexes: 13 `CREATE INDEX` statements for query performance
- `runMigrations()` — versioned migration runner with per-migration transactions
- `ensureMigrationTable()` — bootstrap migration_log table
- `getCurrentVersion()` — read max applied version

### New File: `src/services/database/WalletDatabase.ts` (~991 lines)
- Core singleton database service using `expo-sqlite` synchronous API
- `initialize()` — opens DB, sets WAL mode + foreign keys, runs migrations
- `shared()` — returns singleton instance (throws if not initialized)
- **Wallet CRUD**: `getWallet()`, `getAllWallets()`, `insertWallet()`, `updateWallet()`, `deleteWallet()`, `getWalletCount()`
- **Address operations**: `getAddresses()`, `getAddressesByType()`, `getAddressesByChangeAndType()`, `getScripthashes()`, `insertAddresses()`, `markAddressUsed()`, `markAddressesUsed()`, `getUnusedAddress()`, `getMaxAddressIndex()`, `getAddressCount()`, `getUsedAddresses()`, `getAddressByAddress()`, `getAddressByScripthash()`, `findWalletByScripthash()`
- **UTXO operations**: `getUtxos()`, `getSpendableUtxos()`, `getBalance()` (single SQL query), `getTotalBalance()`, `getUtxoCount()`, `setUtxoFrozen()`, `setUtxoLocked()`, `setUtxoNote()`
- **Transaction operations**: `getTransactions()`, `getTransaction()`, `getExistingTxids()` (chunked for SQLite param limit), `getTransactionCount()`, `setTransactionNote()`, `setTransactionTags()`
- **Tx Details**: `getTxDetail()`, `getTxDetails()` (batch), `getAllTxDetails()`
- **Xpubs/Descriptors**: `getXpubs()`, `insertXpubs()`, `getDescriptors()`, `insertDescriptors()`
- **Sync State**: `getSyncState()`, `initSyncState()`, `recordSyncSuccess()`, `recordSyncError()` (with exponential backoff), `markSyncing()`
- **Scripthash Status**: `getScripthashStatuses()`, `getScripthashStatus()`, `updateScripthashStatus()`, `updateScripthashStatuses()` (batch)
- **Atomic Sync Commit**: `commitSyncResults()` — single transaction that replaces UTXOs, upserts transactions + tx_details, updates wallet balance from UTXOs, updates sync_state, marks used addresses
- **Utility**: `getStats()`, `resetAllData()`, `close()`, `getDb()`

### New File: `src/services/database/V2MigrationService.ts` (~457 lines)
- One-time migration from V2 JSON wallet files to SQLite
- `migrateIfNeeded()` — checks migration_log for version 100, discovers wallet files, migrates each
- `discoverWalletFiles()` — lists `.json` files in `wallets/` directory
- `migrateWallet()` — reads V2 JSON, inserts all data in single transaction (wallet, addresses, UTXOs, transactions, tx_details, xpubs, descriptors, sync_state, scripthash_status)
- `verifyMigration()` — compares DB row counts against V2 data
- Per-wallet scripthash computation via `addressToScripthash()`
- User metadata preservation (frozen UTXOs, transaction notes/tags, address labels)

### New File: `src/services/database/index.ts` (~21 lines)
- Barrel export for `WalletDatabase`, all types, `runMigrations`, `migrations`, `V2MigrationService`

---

## Phase 2: Integration Into Read Paths

### Modified: `src/stores/walletStore.ts`
- **Added `loadWalletFromDB()` function** — reads wallet state from SQLite, converts to Zustand store shape (addresses, balance, UTXOs, transactions, used addresses, sync state)
- Falls back to `loadWalletFromV2()` if wallet not in DB or has 0 addresses
- Helper functions: `mapDbAddressType()`, `mapAddressTypeToDb()`
- Replaced `loadWalletFromV2()` calls with `loadWalletFromDB()` in `unlock()` and `switchToWallet()`

### Modified: `src/services/sync/SyncPipeline.ts`
- Incremental tx detection now uses `db.getExistingTxids()` (fast indexed query) first, falls back to LKG
- Also loads DB-only tx details that aren't in LKG

---

## Phase 3: Integration Into Write Paths

### Modified: `src/services/sync/WalletEngine.ts`
- `syncWallet()` now dual-writes: SQLite DB (primary, via `commitSyncResults()`) + V2 JSON (backup, via `commitLkg()`)
- `handleSyncError()` records errors in both DB and V2 JSON
- DB write is non-fatal — if it fails, V2 JSON still works

### Modified: `src/stores/walletStore.ts`
- **Added `syncNewWalletToDb()` helper** — syncs newly created wallets to SQLite after V2 file creation
- Called after all 5 wallet creation paths (HD, imported key, xprv, seed bytes, multisig)
- Real-time subscription updates (`onTransaction` callback) now also commit to DB
- `initialize()` now calls `WalletDatabase.initialize()` + `V2MigrationService.migrateIfNeeded()`

### Modified: `src/services/AppStateManager.ts`
- `resetWalletToFreshInstall()` now calls `WalletDatabase.shared().resetAllData()` before deleting wallet files

---

## Phase 4: Diagnostic Logging (`[DIAG]` Prefix)

Added comprehensive diagnostic logs across 5 files to trace the wallet refresh flow. All logs use `[DIAG]` prefix for easy grep removal after diagnosis.

### `src/services/database/WalletDatabase.ts`
- `initialize()`: logs before/after `openDatabaseSync()`, PRAGMAs, migrations; catches and re-throws errors
- `shared()`: logs if called before initialization

### `src/services/database/V2MigrationService.ts`
- `migrateIfNeeded()`: logs entry, migration status, wallet file count, post-migration DB stats

### `src/stores/walletStore.ts`
- `initialize()`: wraps DB init + migration in individual try-catches (migration non-fatal), logs `walletExists` and `resolvedWalletId`
- `loadWalletFromDB()`: logs wallet found/not found, address count, final success shape, fallback triggers
- `loadWalletFromV2()`: logs entry, V2 data stats, success or error
- `unlock()`: logs DB fast path attempt/result, stale check decision
- `refreshBalance()`: logs entry, address count, V2 file check, sync outcome, post-set store state, errors

### `src/services/sync/WalletEngine.ts`
- `loadWallet()`: logs cache HIT vs disk read with stats
- `syncWallet()`: logs before/after DB commit, errors, post-commit re-read

### `app/(auth)/(tabs)/index.tsx`
- Mount `useEffect`: logs `addresses.length`, refresh trigger or skip, post-refresh state

---

## Phase 5: Legacy Refresh Path Fix

### Problem (Confirmed by Diagnostic Logs)
```
[DIAG][loadDB] bal=0, utxos=0, txs=0, lastSync=null
[DIAG][refresh] V2 file check: v2Exists=false
```

When no V2 JSON file exists, `refreshBalance()` falls into the **legacy Electrum path** (`syncWalletLight()`) which:
- Fetches UTXOs + history from Electrum
- Saves to V2 JSON via `saveFromV1Snapshot()`
- **Never writes to SQLite DB**
- `syncWalletLight()` returns only `historyMap` (tx_hash + height), not detailed transactions with inputs/outputs/rawHex
- Dashboard shows empty transaction list

### Fix: V2 Engine Re-Sync After Legacy Save

**Modified: `src/stores/walletStore.ts`** (legacy refresh path, ~line 2467)

After `saveFromV1Snapshot()` creates the V2 JSON file:
1. Trigger a full V2 Engine sync: `engine.loadWallet()` + `engine.syncWallet(walletId, { force: true })`
2. This runs the complete SyncPipeline (UTXOs + history + transaction details with inputs/outputs/rawHex)
3. `WalletEngine.syncWallet()` writes to SQLite via `db.commitSyncResults()` (already implemented in Phase 3)
4. Updates store state with proper `DetailedTransactionInfo[]` from the engine snapshot
5. Non-fatal: if re-sync fails, the legacy data is already saved to V2 JSON

**Why this works:**
- No duplicating DB commit logic — piggybacks on existing `WalletEngine.syncWallet()` which already does dual-write
- Self-healing: after first sync, `v2Exists=true` so future refreshes go straight to V2 Engine path
- Legacy path is only hit once per wallet on fresh installs or after DB rebuild

---

## Modified Files Summary

| File | Changes |
|------|---------|
| `src/services/database/types.ts` | **NEW** — Row type interfaces for 10 tables |
| `src/services/database/migrations.ts` | **NEW** — Schema v1 DDL, migration runner |
| `src/services/database/WalletDatabase.ts` | **NEW** — Core singleton DB service (991 lines) |
| `src/services/database/V2MigrationService.ts` | **NEW** — One-time V2 JSON → SQLite migration |
| `src/services/database/index.ts` | **NEW** — Barrel exports |
| `src/stores/walletStore.ts` | Added DB init, `loadWalletFromDB()`, `syncNewWalletToDb()`, DB writes in subscription handler, diagnostic logs, legacy path V2 Engine re-sync fix |
| `src/services/sync/WalletEngine.ts` | Added dual-write (SQLite + V2 JSON), DB error recording, diagnostic logs |
| `src/services/sync/SyncPipeline.ts` | Added DB-backed incremental tx detection |
| `src/services/AppStateManager.ts` | Added DB reset on wallet delete |
| `app/(auth)/(tabs)/index.tsx` | Added diagnostic logs to mount effect |

## Dependency Added
- `expo-sqlite` — native SQLite module (requires native rebuild: `npx expo prebuild --clean && npx expo run:ios`)

## Verification
- `npx tsc --noEmit` — zero errors at every step
- All 9 integration points verified (read paths, write paths, cleanup)
- Diagnostic logs confirm full flow: DB init → migration → unlock → DB fast path → refresh → sync → DB commit
