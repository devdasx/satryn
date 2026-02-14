# 082 — Fix Transaction Timestamps

## Overview
Fixed transactions showing "a moment ago" for old confirmed transactions. The root cause was a unit mismatch: `firstSeenAt` is stored in milliseconds (`Date.now()`) but `blockTime` from Electrum is in Unix seconds. When `blockTime` was null, the millisecond fallback caused `formatRelativeTime` to produce incorrect output.

## Root Cause
- `firstSeenAt` uses `Date.now()` → milliseconds (e.g., 1708000000000)
- `blockTime` from Electrum → Unix seconds (e.g., 1708000000)
- `formatRelativeTime()` expects seconds → `Math.floor(Date.now() / 1000) - timestamp`
- With millisecond timestamp: diff is a huge negative → falls to "a moment ago"

## Fix
In `loadWalletFromDB()`, the blockTime fallback now converts `firstSeenAt` from milliseconds to seconds:
```
blockTime: detail?.blockTime ?? (tx.firstSeenAt ? Math.floor(tx.firstSeenAt / 1000) : 0)
```

## Files Changed
| File | Changes |
|------|---------|
| `src/stores/walletStore.ts` | Fixed blockTime fallback: ms → seconds conversion |
