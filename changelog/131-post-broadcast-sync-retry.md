# 131 — Post-Broadcast Sync Retry with Delay

## Date
2025-02-12

## Summary

Improved post-broadcast sync reliability by adding a second retry attempt. After broadcasting a transaction, the app now syncs twice: once after 1 second, and again after 8 seconds. This catches cases where the transaction hasn't fully propagated to the Electrum server's mempool by the first sync attempt.

---

## Changes

**File:** `src/services/sync/WalletSyncManager.ts`

- Changed initial post-broadcast sync delay from 500ms to 1000ms
- Added a second sync attempt 8 seconds after the first completes
- Added `postBroadcastRetryTimer` field for cleanup
- Updated `cancelActiveSyncs()` and `reset()` to clear retry timer

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/sync/WalletSyncManager.ts` | Post-broadcast retry (1s + 8s), cleanup for retry timer |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Send a transaction → balance and transaction list update within ~2 seconds
3. If first sync misses the tx (slow mempool propagation), second sync at ~9s catches it
4. Pull-to-refresh during post-broadcast window cancels both timers cleanly
