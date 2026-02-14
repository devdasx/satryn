# 127 — Database Viewer: Default to Active Wallet

## Date
2025-02-12

## Summary

Fixed the database viewer to default to the currently active wallet instead of showing all wallets combined. Previously, opening the database viewer showed data from all wallets merged together, which was confusing when debugging per-wallet data.

---

## Changes

**File:** `app/(auth)/database-viewer.tsx`

Changed the initial `selectedWalletId` state from `null` (all wallets) to the active wallet's ID using `useMultiWalletStore(s => s.activeWalletId)`. Users can still manually select "All Wallets" from the picker if needed.

---

## Files Modified

| File | Changes |
|------|---------|
| `app/(auth)/database-viewer.tsx` | Default `selectedWalletId` to active wallet ID |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Open database viewer → shows only the active wallet's data by default
3. Wallet picker still allows selecting other wallets or "All Wallets"
