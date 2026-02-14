# 072 — Database-First Architecture: All Wallet Data From SQLite

## Overview
Enforced strict invariant: SQLite is the single source of truth for all wallet data. All data (transactions, UTXOs, balances, addresses) is written to DB first, then read from DB into Zustand. If DB write fails, Zustand is not updated.

## Changes

### New `reloadFromDB()` Store Action
- Added `reloadFromDB(): boolean` method to walletStore
- Reads current wallet's complete state from SQLite via existing `loadWalletFromDB()`
- Updates Zustand with: balance, utxos, transactions, usedAddresses, lastSync
- Returns false if wallet not found in DB

### Fix 1: `refreshBalance()` — DB-First Read
- **Before**: Read from `engine.getCachedSnapshot()` (in-memory cache)
- **After**: Call `get().reloadFromDB()` to read from SQLite
- Removed ~80 lines of manual LKG-to-legacy conversion code

### Fix 2: `onTransaction` Handler — DB-First Write
- **Before**: Write to Zustand first, then DB (non-fatal)
- **After**: Write to DB first via `commitSyncResults()`, then `reloadFromDB()`
- If DB write fails, Zustand is NOT updated — prevents phantom data in UI

### Fix 3: `getUTXOs` Fallback — Read from DB
- **Before**: Fetched fresh UTXOs from Electrum directly into Zustand
- **After**: Reads from `db.getUtxos(walletId)` and converts to legacy format

## Wallet Switch Stale Data Fix
- `createWallet()` was not clearing old wallet data (balance, transactions, utxos, usedAddresses, trackedTransactions, lastSync) when creating new wallet
- Same bug in `createMultisigWallet()` — both fixed

## Files Changed
| File | Changes |
|------|---------|
| `src/stores/walletStore.ts` | Added `reloadFromDB()`, fixed `refreshBalance()`, `onTransaction`, `getUTXOs`, `createWallet`, `createMultisigWallet` |

## TypeScript
Compiles with 0 errors.
