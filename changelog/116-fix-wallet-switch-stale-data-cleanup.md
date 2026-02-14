# 116 — Fix Wallet Switch: Clean Up Stale Data on Switch

## Date
2025-02-11

## Summary

Fixed wallet switching to properly clean up all stale data from the previous wallet. Previously, switching between wallet types (HD, WIF, multisig, watch-only) could leave stale state behind — Electrum subscriptions from the old wallet, a stuck `isRefreshing` flag blocking sync, stale PSBTs/signed transactions in the send store, and missing `network`/`preferredAddressType` fields in Zustand.

---

## Root Cause

`switchToWallet()` replaced most Zustand fields but missed several important cleanup steps:

1. **Electrum subscriptions** from the previous wallet were never cleaned up — they'd keep firing for old wallet addresses
2. **`isRefreshing` flag** was never reset — if the old wallet was mid-sync, the new wallet's sync would be blocked
3. **`sendStore`** was never reset — stale PSBTs, signed transactions, selected UTXOs, and signature status from the previous wallet would persist
4. **`network` field** was missing from the fast path `set()` — the wallet's actual network (mainnet/testnet) wasn't applied
5. **`preferredAddressType`** was missing from the slow path `set()` — the old wallet's address type preference leaked through
6. **`refreshStartedAt`** timing guard was never reset — could falsely prevent the new wallet's first sync

---

## Fix 1: Add Cleanup Block at Start of `switchToWallet()`

Added a cleanup section that runs **before** loading any new wallet data:

```typescript
// 1. Clean up old Electrum subscription listeners
for (const cleanup of subscriptionCleanups) { cleanup(); }
subscriptionCleanups = [];

// 2. Reset refresh guard so new wallet sync isn't blocked
refreshStartedAt = 0;

// 3. Reset sendStore — clear stale PSBTs, signed txs, UTXOs from previous wallet
try {
  const { useSendStore } = require('./sendStore');
  useSendStore.getState().reset();
} catch {}
```

Uses `require()` for sendStore to avoid circular import (walletStore ↔ sendStore).

---

## Fix 2: Fast Path — Add Missing `network` and `isRefreshing`

Added to the fast path `set()`:
- `network: v2State.network || 'mainnet'` — reads the wallet's actual network from DB
- `isRefreshing: false` — ensures sync isn't blocked

---

## Fix 3: Slow Path Initial Clear — Add Missing Fields

Added to the slow path initial clearing `set()`:
- `isRefreshing: false`
- `network: 'mainnet'`
- `addressIndices: { ...initialAddressIndices }` — reset address index counters
- `preferredAddressType: ADDRESS_TYPES.NATIVE_SEGWIT` — default until addresses are derived

---

## Fix 4: Slow Path Final — Add Missing Fields

Added to the slow path final `set()`:
- `isRefreshing: false`
- `error: null`
- `network` — read from DB wallet row if available
- `preferredAddressType` — derived from the first address's type (e.g., `wrapped_segwit` for P2SH multisig, `native_segwit` for P2WSH multisig)

---

## Impact by Wallet Type

| Switch From → To | Previous Issue | Now Fixed |
|---|---|---|
| HD → Multisig | Stale HD subscriptions fire, `network` missing, PSBTs from HD persist in sendStore | All cleaned ✅ |
| Multisig → WIF | Multisig PSBT + signature status leak into WIF send flow | sendStore reset ✅ |
| WIF → Watch-only | WIF's `preferredAddressType` leaks, old subscriptions still active | Both reset ✅ |
| Any → Any (during sync) | `isRefreshing=true` blocks new wallet's sync | `isRefreshing` reset ✅ |

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/walletStore.ts` | `switchToWallet()` — added cleanup block (subscriptions, refreshStartedAt, sendStore.reset), added `network`/`isRefreshing` to fast path, added `network`/`preferredAddressType`/`isRefreshing`/`addressIndices`/`error` to slow path |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Switch HD → Multisig → console shows no stale subscription warnings from old wallet
3. Switch Multisig → HD → send flow has no stale PSBT or signature status
4. Switch during active sync → new wallet starts sync immediately (not blocked by `isRefreshing`)
5. Switch to testnet wallet → `network` field updates correctly (not stuck on mainnet)
6. Fast-switch back and forth rapidly → `currentSwitchRequestId` guard prevents race conditions
