# Changelog 104 — Store All Wallet Secrets in Database

## Problem

Not all wallet types stored their secrets in the SQLite database. The database has columns for `mnemonic`, `masterXprv`, `masterXpub`, `seedHex` on the `wallets` table, plus `wif` on the `addresses` table, but several wallet types only stored secrets in the iOS Keychain, leaving DB columns as NULL.

This broke preserve-on-delete backup/restore because `CanonicalSnapshotBuilder.extractFromDatabase()` reads secrets from the DB — if they're NULL, the snapshot contains no secrets, and the restore has nothing to restore.

### Status Before Fix

| Wallet Type | Secrets in DB | Secrets in Keychain |
|---|---|---|
| HD (BIP39 mnemonic) | mnemonic, passphrase, masterXprv, masterXpub, seedHex | mnemonic, passphrase |
| Imported xprv | masterXprv, masterXpub | xprv |
| Imported seed bytes | seedHex, masterXprv, masterXpub | seedHex |
| **Imported WIF** | **NULL** | wif |
| **Multisig** | **NULL (no descriptor, no cosigner seeds)** | descriptor, local cosigner seeds |

## Solution

### 1. Imported WIF Wallets — Store WIF in Address Rows

**File:** `src/stores/walletStore.ts`

After `syncNewWalletToDb()` in `importPrivateKey()`, added a loop to store the WIF on each address row via `db.updateAddressWif()`. WIF-imported keys generate multiple addresses (native segwit, taproot, wrapped segwit, legacy) — all share the same private key.

**File:** `src/services/database/WalletDatabase.ts`

Added `updateAddressWif(walletId, address, wif)` method to update the WIF column on an existing address row.

### 2. Multisig Wallets — Store Descriptor + Local Cosigner Seeds

**File:** `src/stores/walletStore.ts`

In `createMultisigWallet()`, added `descriptor: config.descriptor` to the `syncNewWalletToDb()` params so the wallet descriptor is stored in the DB `descriptor` column.

**File:** `app/(onboarding)/setup.tsx`

After storing local cosigner seeds to Keychain, also stores them as JSON in the wallet row's `mnemonic` column via `db.updateWallet()`. Format: `[{ localIndex, mnemonic, name }, ...]`.

### 3. Preserve-Restore PIN Handler — Handle Multisig Wallets

**File:** `app/(onboarding)/pin.tsx`

Updated the `isPreserveRestore` handler to distinguish multisig wallets from standard wallets:
- For multisig (`isMultisig === 1`): Restores descriptor to Keychain via `storeMultisigDescriptor()`, parses local cosigner seeds from the JSON mnemonic column and restores each via `storeLocalCosignerSeed()`
- For standard wallets: Existing logic unchanged (mnemonic, xprv, wif, seed_hex)
- Legacy compatibility: If a multisig mnemonic isn't valid JSON, falls back to storing it as a regular mnemonic

### Status After Fix

| Wallet Type | Secrets in DB | Secrets in Keychain |
|---|---|---|
| HD (BIP39 mnemonic) | mnemonic, passphrase, masterXprv, masterXpub, seedHex | mnemonic, passphrase |
| Imported xprv | masterXprv, masterXpub | xprv |
| Imported seed bytes | seedHex, masterXprv, masterXpub | seedHex |
| **Imported WIF** | **WIF on address rows** | wif |
| **Multisig** | **descriptor, local cosigner seeds (JSON in mnemonic)** | descriptor, local cosigner seeds |

## Files Modified

| File | Change |
|------|--------|
| `src/stores/walletStore.ts` | Store WIF on address rows after WIF import; pass descriptor to DB for multisig |
| `src/services/database/WalletDatabase.ts` | Added `updateAddressWif()` method |
| `app/(onboarding)/setup.tsx` | Store local cosigner seeds in DB mnemonic column as JSON |
| `app/(onboarding)/pin.tsx` | Handle multisig wallet restore (descriptor + cosigner seeds from DB to Keychain) |

## Verification

1. `npx tsc --noEmit` — 0 new errors (1 pre-existing in KeySection.tsx)
2. Import a WIF key → check Database Viewer → address rows should show WIF
3. Create a multisig wallet → check Database Viewer → descriptor column populated, mnemonic has cosigner seeds JSON
4. Enable preserve-on-delete → delete app → reinstall → restore → all wallet types should have working backup screen
5. All secrets should survive the preserve-on-delete → reinstall → PIN creation cycle
