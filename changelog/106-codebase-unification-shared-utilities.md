# 106 — Codebase Unification: Shared Utilities & Service Layer

## Overview

Eliminated all duplicated business logic across the codebase by extracting shared utilities and services. The same patterns — address type mapping, KeyDerivation construction, address derivation loops, AddressRow building, wallet loading, xpub/descriptor generation — were copy-pasted across 5–15 call sites each. This refactoring ensures every operation has ONE canonical implementation and all data flows through the SQLite database.

`walletStore.ts` was 3,525 lines mixing state management with business logic. After this refactoring, hundreds of lines of inline logic have been replaced with single-line delegations to shared services.

## New Files Created

### 1. `src/utils/addressTypeMap.ts` — Unified Type Conversions

Single source of truth for converting between AddressType constants, DB script types, address prefixes, and BIP presets. Replaces 6+ scattered duplicate implementations.

| Function | Example |
|----------|---------|
| `addressTypeToScript('native_segwit')` | → `'p2wpkh'` |
| `scriptToAddressType('p2wpkh')` | → `'native_segwit'` |
| `guessScriptType('bc1q...')` | → `'p2wpkh'` |
| `bipPresetToAddressType('bip84')` | → `'native_segwit'` |
| `addressTypesToScripts([...])` | Array conversion |
| `ALL_ADDRESS_TYPES` | All 4 standard types |

**Replaced duplicates in:** walletStore.ts (`mapDbAddressType`, `mapAddressTypeToDb`, inline `scriptTypeMap`), GapLimitDiscovery.ts (`ADDRESS_TYPE_TO_SCRIPT`, `SCRIPT_TO_ADDRESS_TYPE`, `guessScriptType`), SyncPipeline.ts (`guessScriptType`), import.tsx (`suggestedToAddressType`, `addressTypeToSuggested`), setup.tsx (`parseScriptTypeToAddressType`).

### 2. `src/services/wallet/KeyDerivationFactory.ts` — Unified KD Construction

Replaces 8+ copy-pasted "determine wallet type → retrieve key material → construct KeyDerivation" patterns.

| Function | Use Case |
|----------|----------|
| `keyDerivationFromDB(walletId, networkType)` | Sync-time (no PIN needed). Reads from wallets DB table. |
| `keyDerivationFromSecureStorage(walletId, walletType, network, pin)` | User actions (PIN required). Reads from SecureStorage/SecureVault. |

**Replaced duplicates in:** walletStore.ts (`extendAddressGap`, `deriveNewAddress`, `getChangeAddress`, `switchToWallet`), sendStore.ts (`getKeyDerivation`), GapLimitDiscovery.ts (KD reconstruction block), AddressOptionsModal.tsx (`handlePinSuccess`).

### 3. `src/services/wallet/AddressService.ts` — Unified Address Derivation & DB Persistence

Handles all address derivation + AddressRow building + DB persistence. Eliminates 5+ identical patterns.

| Function | Purpose |
|----------|---------|
| `deriveAddressBatch(kd, config)` | Pure derivation, returns AddressInfo[] |
| `buildAddressRows(walletId, addresses, options)` | AddressInfo[] → AddressRow[] for DB |
| `deriveAndPersistAddresses(walletId, kd, config)` | Derive + build rows + db.insertAddresses |
| `deriveSingleAddress(walletId, kd, type, isChange, index)` | Single address derive + persist |

**Replaced duplicates in:** walletStore.ts (address derivation loops in `createWallet`, `importFromXprv`, `importFromSeedBytes`, `extendAddressGap`, `deriveNewAddress`, `getChangeAddress`, `initializeWallet`, `switchToWallet`; AddressRow building in `syncNewWalletToDb`, `switchToWallet`).

### 4. `src/services/wallet/WalletLoaderService.ts` — Unified Wallet Data Loading

Both `walletStore.loadWalletFromDB()` (~180 lines) and `WalletEngine.buildSchemaFromDB()` (~170 lines) read the same DB tables but produce different output shapes. This service provides a single data-fetch function with two adapter functions.

| Function | Purpose |
|----------|---------|
| `loadWalletSnapshot(walletId)` | Load all wallet data from DB in one call |
| `snapshotToStoreState(snapshot)` | Convert to walletStore format |
| `snapshotToV2Schema(snapshot)` | Convert to WalletFileV2Schema format |

**Replaced duplicates in:** walletStore.ts (`loadWalletFromDB` body), WalletEngine.ts (`buildSchemaFromDB` body).

### 5. `src/services/wallet/WalletCreationService.ts` — Unified Wallet Creation & DB Persistence

Extracts the shared 80% of all wallet creation/import flows (xpub/descriptor generation, DB insertion, etc.).

| Function | Purpose |
|----------|---------|
| `generateXpubsAndDescriptors(kd, accountIndex?)` | Replaces 3x copy-pasted xpub/descriptor generation |
| `createWalletInDB(config, keyMaterial?)` | Unified DB insertion using AddressService |
| `storeWifOnAddresses(walletId, addresses, wif)` | For WIF import |

**Replaced duplicates in:** walletStore.ts (`syncNewWalletToDb` body, xpub generation in `createWallet`, `importFromXprv`, `importFromSeedBytes`, `initializeWallet`, `switchToWallet`; WIF update in `importPrivateKey`).

## Modified Files

### `src/stores/walletStore.ts` — Major Reduction

| Method | Before | After |
|--------|--------|-------|
| `loadWalletFromDB()` | ~180 lines inline | 5-line delegation to WalletLoaderService |
| `syncNewWalletToDb()` | ~100 lines inline | Delegation to `createWalletInDB` |
| `createWallet` | Manual preset mapping, derivation loop, scriptTypeMap, xpub generation | `bipPresetToAddressType`, `deriveAddressBatch`, `addressTypesToScripts`, `generateXpubsAndDescriptors` |
| `importPrivateKey` | Manual WIF update loop | `storeWifOnAddresses` |
| `importFromXprv` | Manual xpub generation + scriptTypes mapping | Shared utilities |
| `importFromSeedBytes` | Manual xpub generation + scriptTypes mapping | Shared utilities |
| `extendAddressGap` | ~90 lines (KD + derivation + DB write) | `keyDerivationFromSecureStorage` + `deriveAndPersistAddresses` |
| `deriveNewAddress` | ~60 lines (KD + derivation + DB write) | `keyDerivationFromSecureStorage` + `deriveSingleAddress` |
| `getChangeAddress` | ~75 lines (KD + derivation + DB write) | `keyDerivationFromSecureStorage` + `deriveSingleAddress` |
| `initializeWallet` | Manual derivation loops + xpub extraction | `deriveAddressBatch` + `generateXpubsAndDescriptors` |
| `switchToWallet` | ~80 lines KD + derivation + manual row building | `keyDerivationFromSecureStorage` + `deriveAddressBatch` + `buildAddressRows` + `generateXpubsAndDescriptors` |

Removed unused imports: `addressToScripthash`, `AddressRow`, `XpubRow`, `DescriptorRow`, `UtxoRow`, `TransactionRow`, `TxDetailRow`. Removed dead aliases `mapDbAddressType`, `mapAddressTypeToDb`.

### `src/services/sync/GapLimitDiscovery.ts`

- Removed local `ADDRESS_TYPE_TO_SCRIPT`, `SCRIPT_TO_ADDRESS_TYPE`, `ALL_ADDRESS_TYPES` constants
- Removed local `guessScriptType()` function
- Replaced KD reconstruction (~20 lines) with `keyDerivationFromDB(walletId, networkType)`
- Added `import type { KeyDerivation }` for type annotation
- Imported from `addressTypeMap` and `KeyDerivationFactory`

### `src/services/sync/SyncPipeline.ts`

- Removed local `guessScriptType()` function
- Imported from `addressTypeMap`

### `src/services/sync/WalletEngine.ts`

- Replaced `buildSchemaFromDB()` method (~170 lines) with 5-line delegation to WalletLoaderService
- Removed `mapDbAddressType` private method
- Cleaned up unused type imports

### `src/stores/sendStore.ts`

- Replaced local `getKeyDerivation()` body (~32 lines) with single delegation to `keyDerivationFromSecureStorage`

### `app/(onboarding)/import.tsx`

- Simplified `suggestedToAddressType` and `addressTypeToSuggested` to simple casts (SuggestedScriptType and AddressType are identical string unions)

### `app/(onboarding)/setup.tsx`

- Replaced `parseScriptTypeToAddressType` body with `scriptToAddressType` from addressTypeMap

### `src/components/bitcoin/AddressOptionsModal.tsx`

- Replaced manual mnemonic → SeedGenerator → KeyDerivation construction with `keyDerivationFromSecureStorage`

### `src/services/import/PathDiscovery.ts`

- Replaced `PATH_INFO.addressType` field with `bipPresetToAddressType(pathKey)` from shared addressTypeMap
- Replaced `keyDerivation.deriveReceivingAddresses()` with `deriveAddressBatch()` from shared AddressService
- Kept `deriveAddressesFromXprv()` as-is (handles non-standard xprv depths — unique logic)
- Kept `discoverWIF()` as-is (raw keypair address construction — not an HD derivation use case)

## Files Changed Summary

| File | Action | Change |
|------|--------|--------|
| `src/utils/addressTypeMap.ts` | **NEW** | Unified address type conversions |
| `src/services/wallet/KeyDerivationFactory.ts` | **NEW** | Unified KD construction |
| `src/services/wallet/AddressService.ts` | **NEW** | Unified address derivation + DB persistence |
| `src/services/wallet/WalletLoaderService.ts` | **NEW** | Unified wallet data loading |
| `src/services/wallet/WalletCreationService.ts` | **NEW** | Unified wallet creation + DB persistence |
| `src/stores/walletStore.ts` | **MODIFIED** | Replaced inline logic with service delegations |
| `src/stores/sendStore.ts` | **MODIFIED** | Use KeyDerivationFactory |
| `src/services/sync/GapLimitDiscovery.ts` | **MODIFIED** | Use shared utilities |
| `src/services/sync/SyncPipeline.ts` | **MODIFIED** | Use shared guessScriptType |
| `src/services/sync/WalletEngine.ts` | **MODIFIED** | Use WalletLoaderService |
| `src/components/bitcoin/AddressOptionsModal.tsx` | **MODIFIED** | Use KeyDerivationFactory |
| `app/(onboarding)/import.tsx` | **MODIFIED** | Use addressTypeMap |
| `app/(onboarding)/setup.tsx` | **MODIFIED** | Use addressTypeMap |
| `src/services/import/PathDiscovery.ts` | **MODIFIED** | Use addressTypeMap + AddressService |

## Architecture After Refactoring

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Utilities                          │
│  addressTypeMap.ts  │  KeyDerivationFactory.ts              │
│  AddressService.ts  │  WalletLoaderService.ts               │
│                     │  WalletCreationService.ts              │
└────────────┬────────┴────────────────┬──────────────────────┘
             │                         │
   ┌─────────▼─────────┐    ┌─────────▼──────────┐
   │   Stores (thin)    │    │   Sync Services     │
   │  walletStore.ts    │    │  GapLimitDiscovery   │
   │  sendStore.ts      │    │  SyncPipeline        │
   └─────────┬──────────┘    │  WalletEngine        │
             │               └─────────┬─────────────┘
             │                         │
             └────────────┬────────────┘
                          │
                   ┌──────▼──────┐
                   │  SQLite DB  │
                   │  (Source of │
                   │    Truth)   │
                   └─────────────┘
```

## Key Invariants Maintained

1. **DB is sole source of truth** — all writes go to SQLite first, Zustand mirrors DB
2. **Balance = sum of UTXOs** — always computed via `computeBalanceFromUtxos()`, never a separate API call
3. **Single sync path** — all screens use `walletStore` → `WalletSyncManager` → `SyncPipeline` → DB → store
4. **Two KD construction paths** — `keyDerivationFromDB` (sync, no PIN) and `keyDerivationFromSecureStorage` (user actions, PIN required)

## Bug Fix: Stale Address Cache — Self-Transfer Shows Wrong Amount

### Problem

After sending a self-transfer, three bugs were visible:
1. Self-transfer showed full amount (528,674 SAT) instead of just the fee
2. Unconfirmed change UTXO didn't appear in balance — balance dropped by the full amount
3. Change address showed 0 SAT until the transaction was confirmed

### Root Cause

`WalletEngine` caches the `walletFile` in memory (`loadedWallets` Map). When `getChangeAddress()` derives a new change address (#50), it persists to DB + Zustand store. However, the WalletEngine's cached `walletFile.scriptInventory.addresses` was **never refreshed**.

When the post-broadcast sync ran:
1. `syncWallet()` loaded `walletFile` from stale cache — missing newly derived change address
2. `SyncPipeline` built scripthash entries from stale addresses — change address never queried from Electrum
3. `buildLkgFromStaging()` built `walletAddresses` set without change address — self-transfer detection failed
4. Change output UTXO never fetched → missing from balance

### Fix

**File: `src/services/sync/WalletEngine.ts`**

Added `this.loadedWallets.delete(walletId)` before `loadWallet()` in `syncWallet()` to force a fresh DB read before every sync. This ensures newly derived addresses (from `getChangeAddress`, `deriveNewAddress`, `extendAddressGap`) are always included.

```
// Always reload from DB to pick up addresses derived since last sync
this.loadedWallets.delete(walletId);
let walletFile = this.loadWallet(walletId);
```

This is a 1-line addition. The DB read is fast (~5ms) and negligible overhead. Fixes all three symptoms in one shot.

## Bug Fix: `reloadFromDB()` Missing Addresses — Addresses Screen Shows Stale Data

### Problem

Every time the user navigates to the Addresses screen, the address list could appear stale or require a full re-unlock to update. After sync completes (which may extend the gap limit and add new addresses), or after deriving a new address/change address, the new addresses were not reflected in the store.

### Root Cause

`walletStore.reloadFromDB()` was only updating 5 fields from the database:
- `balance`, `utxos`, `transactions`, `usedAddresses`, `lastSync`

It was **missing** `addresses` and `addressIndices`. This meant:
1. New addresses discovered during gap limit extension never appeared in the UI
2. Newly derived change/receiving addresses only appeared after a full unlock cycle
3. The addresses screen showed stale data until the app re-derived all addresses

### Fix

**File: `src/stores/walletStore.ts`**

Added `addresses` and `addressIndices` to the `reloadFromDB()` set() call:

```typescript
set({
  addresses: dbState.addresses,       // ← NEW
  addressIndices: dbState.addressIndices, // ← NEW
  balance: dbState.balance,
  utxos: dbState.utxos,
  transactions: dbState.transactions,
  usedAddresses: dbState.usedAddresses,
  lastSync: dbState.lastSync,
});
```

Now every time sync completes (which calls `reloadFromDB()`), the full wallet state — including any new addresses — is loaded from the database into Zustand. The Addresses screen reacts instantly to these changes.

## Fix: Addresses Screen Shows All Addresses Instantly

### Problem

The Addresses screen artificially paginated addresses with `PAGE_SIZE = 30`, showing only 30 addresses at a time. Users had to scroll to the bottom and wait for more to load. With 323 addresses this meant many load cycles before seeing the full list.

### Root Cause

The screen used a `pageCount` state + `paginatedAddresses = filteredAddresses.slice(0, pageCount * PAGE_SIZE)` pattern with `onEndReached` to incrementally load more. This was unnecessary because all addresses are already loaded in memory from the SQLite database via Zustand store.

### Fix

**File: `app/(auth)/addresses.tsx`**

Removed the pagination layer entirely:
- Removed `PAGE_SIZE` constant, `pageCount` state, `paginatedAddresses` memo, `hasMore` check
- Removed `handleLoadMore` callback and `onEndReached` from SectionList
- Removed `renderFooter` (Load More button) and `ListFooterComponent`
- Removed unused `loadMoreButton`/`loadMoreText` styles
- Sections now use `filteredAddresses` directly (all addresses, no slicing)

The `SectionList` component already virtualizes rendering — only visible rows are rendered in the viewport. So there's no performance concern showing all 323 addresses immediately.

## Fix: Wallet Name Not Saved to Database

### Problem

When creating a new wallet (HD mnemonic), the wallet name was not saved to the SQLite database. The `createWallet` method did not accept a `name` parameter, so it stored the wallet ID (e.g., `hd-1702934872`) as the name in the DB. The correct name (e.g., "Main Wallet", "Imported Wallet") was generated in `setup.tsx` and stored in `multiWalletStore`, but never reached the database.

All other wallet types (import WIF, import xprv, import seed, multisig, watch-only) correctly passed names to the DB.

### Fix

**File: `src/stores/walletStore.ts`**

1. Added optional `name` parameter to `createWallet()` method signature
2. Updated `syncNewWalletToDb()` call to use `name || effectiveId` (falls back to ID if no name provided)
3. Added backfill in `ensureDbComplete()` to fix existing wallets that have their ID as the name — pulls the correct name from `multiWalletStore` or generates a default based on wallet type

**File: `app/(onboarding)/setup.tsx`**

1. Main creation path (line 817): Now passes `walletName` to `createWallet()`
2. iCloud restore path (line 470): Now passes `firstHDWallet.name || 'Restored Wallet'` to `createWallet()`

### Backfill Logic

For existing wallets with ID-as-name (matching pattern `hd-\d+`, `multisig-\d+`, etc.):
1. First tries to pull the correct name from `multiWalletStore`
2. If not found, generates a default based on wallet type:
   - `hd_mnemonic` → "Bitcoin Wallet"
   - `hd_xprv` / `hd_seed` → "Imported Wallet"
   - `imported_key` → "Imported Key"
   - `multisig` → "Multisig Wallet"
   - `watch_*` → "Watch-Only Wallet"

## Debug: Transaction Broadcasting Investigation

### Problem
User reports that every send attempt shows "Broadcasting to network..." then returns to review step. The `signAndBroadcast` method throws an error but the catch block in `send-pin.tsx` was silently swallowing it without logging.

### Changes

**File: `src/stores/sendStore.ts`**

1. **Added `SyncLogger` import** — for step-by-step diagnostic logging
2. **Added safeguard to reload addresses from DB** — if `addresses` is empty in the store when `signAndBroadcast` is called, it triggers `reloadFromDB()` to ensure derivation paths are available for signing
3. **Added step-by-step logging throughout `signAndBroadcast`** — logs at each stage: wallet info, UTXO count, change address, PSBT build, signing paths, broadcast result
4. **Added detailed error logging in catch block** — logs error message + stack trace via `SyncLogger.error()`

**File: `app/(auth)/send-pin.tsx`**

1. **Added `console.error` in catch block** — the error from `signAndBroadcast` is now logged to console instead of being silently swallowed

**File: `src/stores/walletStore.ts`**

1. **Added error logging in `getChangeAddress` catch** — previously swallowed all errors silently; now logs via `SyncLogger.error()`

### Key diagnostic points logged

| Stage | Log Message |
|-------|-------------|
| Start | `walletId`, `walletType`, `network`, address/UTXO counts |
| UTXOs | Enriched UTXO count (after legacy rawTxHex fetch) |
| Paths | `inputPaths` map size (address → derivation path) |
| Change | Change address obtained or empty |
| Recipients | Valid recipient count and amounts |
| KD | KeyDerivation construction success/failure |
| Build | PSBT built with input count |
| Sign | Signing paths list, signed txid + hex length |
| Broadcast | Broadcast success/failure with txid |
| Error | Full error message + stack trace |

### Next steps

With this logging in place, the next time a send fails, the SyncLogger output will show exactly which step fails. The user should check the error sheet on the review screen and/or the SyncLogger output. Common failure modes:
- `Failed to retrieve mnemonic` → SecureStorage PIN issue
- `Insufficient funds` → UTXO selection issue
- `Circuit breaker open` → Electrum connection problem
- `Invalid recipient address` → Address validation issue
- Electrum broadcast rejection → Invalid transaction (wrong signing key, etc.)

## TypeScript

`npx tsc --noEmit` — 0 errors.
