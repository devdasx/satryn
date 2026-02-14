# 129 — Fix Wallet Switch Stale State Leaks

## Date
2025-02-12

## Summary

Fixed stale data leaking between wallets during wallet switching. Previously, when switching wallets, the old wallet's addresses, UTXOs, transactions, and balance could briefly appear in the UI before the new wallet's data loaded. Added a full Zustand state reset in `switchToWallet()` before loading the new wallet.

---

## Changes

**File:** `src/stores/walletStore.ts` — `switchToWallet()`

Added a comprehensive state reset after tearing down subscriptions and before loading the new wallet:

```typescript
// 4. Clear wallet-specific Zustand state to prevent stale data leaks between wallets
set({
  addresses: [],
  utxos: [],
  transactions: [],
  balance: { confirmed: 0, unconfirmed: 0, total: 0 },
  usedAddresses: new Set<string>(),
  trackedTransactions: new Map<string, TrackedTransaction>(),
  addressIndices: { ...initialAddressIndices },
  isMultisig: false,
  multisigConfig: null,
  lastSync: null,
  isLoading: true,
  error: null,
});
```

This ensures no data from the previous wallet leaks into the UI while the new wallet loads.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/stores/walletStore.ts` | Added full state reset in `switchToWallet()` cleanup |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Switch between wallets — no flash of previous wallet's balance or transactions
3. UI shows loading state while new wallet data loads from database
4. Switch back to original wallet — data loads correctly from DB
