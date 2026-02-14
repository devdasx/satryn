# 124 — Fix Multisig: Only Derive and Store Chosen Address Type

## Date
2025-02-12

## Summary

Fixed multisig wallets deriving and storing non-multisig single-sig address types (legacy P2PKH, wrapped segwit P2SH-P2WPKH, taproot P2TR) in the database. Root cause: `GapLimitDiscovery` iterated `ALL_ADDRESS_TYPES` (4 single-sig types) for ALL wallets including multisig, using `KeyDerivation` which produces single-sig addresses (p2wpkh/p2pkh/p2tr) instead of multisig P2WSH addresses. Additionally, `deriveNewAddress()`, `getChangeAddress()`, and `extendAddressGap()` in walletStore had no guards preventing single-sig derivation for multisig wallets.

---

## Root Cause

### GapLimitDiscovery (Primary Bug)

`GapLimitDiscovery.discover()` ran for ALL wallet types during every sync cycle. It:
1. Iterated `ALL_ADDRESS_TYPES` (native_segwit, wrapped_segwit, legacy, taproot)
2. Used `KeyDerivation` (single-sig BIP44/49/84/86 derivation)
3. Derived single-sig addresses (p2wpkh, p2sh-p2wpkh, p2pkh, p2tr) instead of multisig P2WSH
4. Inserted these wrong addresses directly into the DB via `db.insertAddresses()`

For multisig wallets, this meant the DB accumulated single-sig addresses that don't belong to the multisig derivation path. These addresses could never be signed by the multisig cosigners.

### walletStore Address Functions (Secondary Bug)

`extendAddressGap()`, `deriveNewAddress()`, and `getChangeAddress()` all used single-sig `KeyDerivation` without checking if the active wallet is multisig. If called for a multisig wallet, they would derive and persist wrong address types.

## Fix

### Part 1: Skip GapLimitDiscovery for Multisig Wallets

**File:** `src/services/sync/GapLimitDiscovery.ts`

Added early return at the top of `discover()` when `walletRow.isMultisig === 1`. Multisig wallets use `MultisigWallet` class for derivation which is fundamentally different from single-sig `KeyDerivation` — the gap limit discovery with single-sig derivation would produce completely wrong addresses.

### Part 2: Guard extendAddressGap()

**File:** `src/stores/walletStore.ts`

Added `if (activeWallet.type === 'multisig') return 0` guard after the WIF wallet check. Multisig wallets cannot use single-sig `KeyDerivation` for gap extension.

### Part 3: Guard deriveNewAddress()

**File:** `src/stores/walletStore.ts`

Added `if (activeWallet.type === 'multisig')` guard that returns the first unused address instead of attempting single-sig derivation.

### Part 4: Guard getChangeAddress()

**File:** `src/stores/walletStore.ts`

Added `if (activeWallet.type === 'multisig')` guard that returns an existing change address instead of attempting single-sig derivation.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/sync/GapLimitDiscovery.ts` | Early return for multisig wallets (`isMultisig === 1`) before `ALL_ADDRESS_TYPES` loop |
| `src/stores/walletStore.ts` | Added multisig guards to `extendAddressGap()`, `deriveNewAddress()`, `getChangeAddress()` |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Multisig wallet sync: GapLimitDiscovery skips multisig wallets entirely
3. Multisig wallet: extendAddressGap, deriveNewAddress, getChangeAddress all return early without single-sig derivation
4. HD single-sig wallets: behavior unchanged — gap limit discovery still works for all 4 address types
