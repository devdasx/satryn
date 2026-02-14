# 107 — Fix Transaction Signing Key Mismatch & Error Sheet Not Showing

## Date
2025-02-11

## Summary

Fixed two critical issues in the send flow:
1. **PSBT signing failure** — "Can not sign for this input with the key..." error caused by `keyDerivationFromSecureStorage()` using global SecureStorage instead of per-wallet DB key material.
2. **Error sheet not displaying** — The `SendErrorSheet` bottom sheet was not appearing after a failed broadcast when navigating back to the review screen.

Additionally added comprehensive diagnostic logging throughout the send flow and a new error classification for signing key mismatches.

---

## Problem 1: PSBT Signing Key Mismatch

### Symptom
```
[send-pin] signAndBroadcast failed: Can not sign for this input with the key 027fa304f201d4c06c514a4e2dbe3ca6b759502d2acdd75cb1e61db871511eb28e
```

The transaction builder's `sign()` method throws because the public key derived from the `KeyDerivation` instance doesn't match the public key embedded in the UTXO's scriptPubKey.

### Root Cause

`keyDerivationFromSecureStorage()` in `KeyDerivationFactory.ts` was using `SecureStorage.retrieveSeed(pin)` as its default path for BIP39 wallets. This function retrieves a **globally stored** mnemonic — it's a singleton that only holds the **last-created** wallet's mnemonic.

For multi-wallet setups, or when the SecureStorage mnemonic gets out of sync with the wallet's actual key material, this returns the **wrong** mnemonic, producing incorrect signing keys.

Additionally, the default BIP39 path never retrieved the wallet's **passphrase** from SecureStorage, so any wallet created with a BIP39 passphrase would always derive wrong keys during signing.

### Fix

Changed `keyDerivationFromSecureStorage()` to a **DB-first strategy**:

1. **First:** Try `keyDerivationFromDB(walletId, network)` — reads per-wallet key material (seedHex, masterXprv, mnemonic+passphrase) from the `wallets` DB table. This is always correct because `WalletCreationService.createWalletInDB()` stores the key material per-wallet during wallet creation.
2. **Fallback:** Only use SecureStorage for legacy wallets that were created before migration v2 stored key material in the DB. Also added passphrase retrieval in the fallback path.

### File Changed
- `src/services/wallet/KeyDerivationFactory.ts`

---

## Problem 2: Error Sheet Not Showing After Failed Broadcast

### Symptom
After a broadcast failure, the user is navigated back to the review screen (`send-review.tsx`), but the `SendErrorSheet` bottom sheet does not appear — even though the `error` state is set in `sendStore`.

### Root Cause

In `send-review.tsx`, the `showErrorSheet` state was initialized with `useState(false)`. When `router.replace('/(auth)/send-review')` is called from `send-pin.tsx` after a failed broadcast:

1. The `sendStore.error` is already set (by `signAndBroadcast`'s catch block)
2. The `SendReviewRoute` component mounts fresh (due to `router.replace`)
3. `useState(false)` initializes `showErrorSheet` to `false`
4. The `useEffect([error])` should fire on mount, but there's a timing issue with Expo Router's navigation — the `useSendStore((s) => s.error)` selector may not have the latest value at the exact moment of mount

### Fix

Changed initialization to `useState(() => !!error)` — this uses a lazy initializer that reads the current `error` value from the store at mount time. Combined with the existing `useEffect`, this ensures the error sheet always shows when an error exists, both on initial mount and on subsequent error changes.

### File Changed
- `app/(auth)/send-review.tsx`

---

## Problem 3: Missing Error Classification for Signing Key Mismatch

### Symptom
If the signing key mismatch error were to show in the error sheet, it would fall through to the generic "Transaction Error" fallback — not helpful for debugging.

### Fix

Added a new error classification in `SendErrorSheet.tsx` for signing key mismatches:

- **Pattern:** `lower.includes('can not sign') || lower.includes('cannot sign') || lower.includes('wrong key')`
- **Title:** "Signing Key Mismatch"
- **Description:** Explains the wallet's signing key doesn't match the input's expected key
- **Suggestions:** Sync wallet, restart app, check correct wallet is selected, contact support

### File Changed
- `src/components/send/SendErrorSheet.tsx`

---

## Problem 4: Silent Error Swallowing in Send Flow

### Symptom
When errors occurred during `signAndBroadcast`, there was no diagnostic logging. The `send-pin.tsx` catch block and `walletStore.getChangeAddress()` silently swallowed errors with no logging.

### Fix

Added comprehensive `SyncLogger` diagnostic logging throughout the send flow:

- **`sendStore.ts` — `signAndBroadcast()`:** Step-by-step logging at every stage (wallet info, UTXO count, change address, PSBT build, signing paths, broadcast result). Error catch block logs message + stack trace.
- **`sendStore.ts` — address safeguard:** If `addresses` array is empty on `signAndBroadcast` entry, triggers `reloadFromDB()` to ensure derivation paths are available.
- **`send-pin.tsx`:** Added `console.error` in catch block for visible debugging.
- **`walletStore.ts` — `getChangeAddress()`:** Added `SyncLogger.error` in catch block so change address failures are logged.

### Files Changed
- `src/stores/sendStore.ts`
- `app/(auth)/send-pin.tsx`
- `src/stores/walletStore.ts`

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/wallet/KeyDerivationFactory.ts` | DB-first key derivation strategy; passphrase retrieval in fallback |
| `app/(auth)/send-review.tsx` | `useState(() => !!error)` initialization for error sheet |
| `src/components/send/SendErrorSheet.tsx` | New "Signing Key Mismatch" error classification |
| `src/stores/sendStore.ts` | Comprehensive send flow logging; address reload safeguard |
| `app/(auth)/send-pin.tsx` | Error logging in catch block |
| `src/stores/walletStore.ts` | Error logging in `getChangeAddress()` catch block |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Send a transaction — should sign and broadcast successfully (DB key material is used)
3. If signing fails, the error sheet should appear immediately on the review screen
4. The error sheet should show "Signing Key Mismatch" with relevant suggestions
5. Console/SyncLogger should show step-by-step diagnostics for the entire send flow
6. Multi-wallet scenarios: switching wallets and sending should use the correct per-wallet key material
