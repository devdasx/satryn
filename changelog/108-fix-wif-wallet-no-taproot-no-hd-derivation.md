# 108 — Fix WIF Wallet: No Taproot, No HD Derivation

## Date
2025-02-11

## Summary

Fixed multiple issues with imported WIF (private key) wallets. WIF wallets were incorrectly generating Taproot (P2TR) addresses and being treated as HD wallets — attempting HD-style address derivation for change addresses, new receiving addresses, and gap extension. A single WIF key is NOT hierarchical and cannot derive new addresses.

---

## Problem 1: Taproot Addresses Generated for Compressed WIF Keys

### Symptom
When importing a compressed WIF key, the wallet generated 4 address types including Taproot (bc1p...). Taproot (BIP86) is designed for HD key derivation paths, not single WIF keys.

### Fix
Removed `ADDRESS_TYPES.TAPROOT` from the `supportedTypes` array for compressed WIF keys.

**Correct behavior:**
- **Compressed WIF:** 3 addresses — BIP84 (Native SegWit/P2WPKH), BIP49 (Wrapped SegWit/P2SH-P2WPKH), BIP44 (Legacy/P2PKH)
- **Uncompressed WIF:** 1 address — BIP44 (Legacy/P2PKH) only

### File Changed
- `src/stores/walletStore.ts` — `importPrivateKey()` method

---

## Problem 2: PathDiscovery Scanned Taproot for WIF Keys

### Symptom
During WIF import, the path discovery (blockchain scanner) would query Electrum for a Taproot address that the wallet shouldn't support.

### Fix
Removed `'bip86'` from the `pathsToScan` array for compressed WIF keys in `discoverWIF()`.

### File Changed
- `src/services/import/PathDiscovery.ts` — `discoverWIF()` method

---

## Problem 3: WIF Wallets Treated as HD Wallets

### Symptom
Four HD-only methods (`getChangeAddress`, `deriveNewAddress`, `extendAddressGap`, `needsGapExtension`) all attempted to use `keyDerivationFromSecureStorage()` + `deriveSingleAddress()` for WIF wallets. This would fail because WIF wallets have no seed/mnemonic/xprv — only a single private key. WIF wallets:
- Cannot generate change addresses — change goes back to the same receiving address
- Cannot derive new addresses — only ONE address per type exists
- Have no gap limit concept — fixed set of addresses forever

### Fix
Added early-return guards in all 4 methods for `imported_key` and `imported_keys` wallet types:

| Method | Guard Behavior |
|--------|---------------|
| `getChangeAddress()` | Returns the receiving address of the requested type |
| `deriveNewAddress()` | Returns the existing address via `getFirstUnusedAddress()` |
| `extendAddressGap()` | Returns 0 (no addresses derived) |
| `needsGapExtension()` | Returns false (never needs extension) |

### File Changed
- `src/stores/walletStore.ts` — 4 methods guarded

---

## Problem 4: Gap Limit Set to 20 in DB for WIF Wallets

### Symptom
`WalletCreationService.createWalletInDB()` defaults `gapLimit` to 20. WIF wallets have no gap limit concept.

### Fix
Set `gapLimit: 0` explicitly in the `syncNewWalletToDb()` call for WIF imports.

### File Changed
- `src/stores/walletStore.ts` — `importPrivateKey()` method

---

## Problem 5: Receive Screen Auto-Derived Addresses for WIF Wallets

### Symptom
When switching address types on the receive screen, a `useEffect` called `extendAddressGap()` to derive addresses for the selected type. For WIF wallets, this would attempt HD derivation and fail silently.

### Fix
Added early-return guard in the auto-derive `useEffect` to skip `imported_key` and `imported_keys` wallets.

### File Changed
- `app/(auth)/receive.tsx` — auto-derive `useEffect`

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/walletStore.ts` | Remove Taproot from WIF types; add 4 HD-method guards; set gapLimit=0 |
| `src/services/import/PathDiscovery.ts` | Remove 'bip86' from WIF compressed scan paths |
| `app/(auth)/receive.tsx` | Guard auto-derive useEffect to skip WIF wallets |

## Backward Compatibility

- Existing WIF wallets with Taproot addresses continue to work — `ImportedKeySigner` retains Taproot signing
- Receive screen reads available types from actual addresses array, so old wallets with Taproot still show them
- Only NEW WIF imports stop generating Taproot addresses
- Runtime guards prevent HD operations regardless of DB gapLimit value

## Verification

1. `npx tsc --noEmit` — zero errors
2. Import compressed WIF → verify 3 address types (no Taproot/bc1p)
3. Import uncompressed WIF → verify 1 address type (Legacy only)
4. Receive screen for WIF wallet → only correct types, no derivation errors
5. Send from WIF wallet → change address is the same receiving address
6. All HD-only methods return immediately for WIF wallets without errors
