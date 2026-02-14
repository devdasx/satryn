# 132 — Electrum Server Cold-Start Priority

## Date
2025-02-12

## Summary

Improved Electrum server selection on app cold start by preferring the last known good server. Previously, the first connection after app launch used weighted random selection, which could pick a slow or unreliable server. Now, if the server cache has a server with a score above 70, it is used for the first connection — skipping random exploration.

Also ensured the server cache is fully loaded from AsyncStorage before the first connection attempt, preventing a race condition where `doConnect()` could start before cache data was available.

---

## Changes

### ServerCacheManager Cold-Start Boost

**File:** `src/services/electrum/ServerCacheManager.ts`

Added a cold-start check in `selectServer()`: when `connectionCount === 1` (first connection after launch), the top-scored server from cache is returned directly if its score exceeds 70.

### ElectrumClient Cache Load

**File:** `src/services/electrum/ElectrumClient.ts`

Changed `doConnect()` to `await ServerCacheManager.initialize()` instead of `ServerCacheManager.shared()`, ensuring the cache is loaded from AsyncStorage before server selection begins.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/electrum/ServerCacheManager.ts` | Cold-start priority for top server (score > 70) |
| `src/services/electrum/ElectrumClient.ts` | Await cache initialization before first connection |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Launch app after using it (server cache populated) → connects to same good server from previous session
3. First launch (empty cache) → falls through to normal weighted random selection
4. After multiple connections, exploration still samples random servers every 10th connection
