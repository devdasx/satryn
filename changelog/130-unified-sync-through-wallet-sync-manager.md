# 130 — Unified Sync Through WalletSyncManager

## Date
2025-02-12

## Summary

Routed all external sync triggers through `WalletSyncManager.triggerSync()` instead of calling `refreshBalance()` directly. This ensures all syncs go through one central place with debouncing (3s minimum between syncs), deduplication (no concurrent syncs), pull-to-refresh cancellation, and proper sync state tracking.

Added a `'manual'` trigger type for user-initiated syncs (reconnect button, manual refresh).

---

## Changes

### Files Updated to Use WalletSyncManager

| File | Old Call | New Call | Trigger |
|------|----------|---------|---------|
| `app/(auth)/receive.tsx` | `refreshBalance()` | `WalletSyncManager.shared().triggerSync(walletId, 'manual')` | After address generation |
| `app/_layout.tsx` | `refreshBalance()` | `WalletSyncManager.shared().triggerSync(walletId, 'foreground')` | App foreground |
| `app/(auth)/(tabs)/wallet.tsx` | `refreshBalance()` | `WalletSyncManager.shared().triggerSync(walletId, 'pull-to-refresh')` | Pull to refresh |
| `app/(auth)/(tabs)/index.tsx` | `refreshBalance()` | `WalletSyncManager.shared().triggerSync(walletId, 'foreground')` | Initial mount sync |
| `app/(auth)/(tabs)/index.tsx` | `refreshBalance()` fallback | `Promise.resolve()` | Pull-to-refresh fallback removed |
| `src/components/wallet/SyncDetailsSheet.tsx` | `refreshBalance()` | `WalletSyncManager.shared().triggerSync(walletId, 'manual')` | Reconnect + post-reconnect |

### WalletSyncManager Changes

**File:** `src/services/sync/WalletSyncManager.ts`

- Exported `SyncTrigger` type with new `'manual'` trigger
- Internal `refreshBalance()` call in `triggerSync()` unchanged (it's the canonical sync path)

### Cleanup

- Removed unused `refreshBalance` selector from `index.tsx` and `SyncDetailsSheet.tsx`
- Removed unused `startSyncing`/`completeSyncing` from `index.tsx` (sync state now managed by WalletSyncManager)

---

## Files Modified

| File | Changes |
|------|---------|
| `app/(auth)/receive.tsx` | Route sync through WalletSyncManager |
| `app/_layout.tsx` | Route foreground sync through WalletSyncManager |
| `app/(auth)/(tabs)/wallet.tsx` | Route pull-to-refresh through WalletSyncManager |
| `app/(auth)/(tabs)/index.tsx` | Route initial + refresh sync through WalletSyncManager |
| `src/components/wallet/SyncDetailsSheet.tsx` | Route reconnect sync through WalletSyncManager |
| `src/services/sync/WalletSyncManager.ts` | Export SyncTrigger type with 'manual' trigger |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Pull-to-refresh on dashboard → triggers full sync via WalletSyncManager
3. App foreground → triggers sync via WalletSyncManager
4. Reconnect from sync details sheet → triggers manual sync
5. Rapid sync triggers are debounced (no double-fires)
