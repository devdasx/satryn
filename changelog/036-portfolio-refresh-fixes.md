# Fixes #36–#37 — Portfolio Post-Send Auto-Refresh + Pull-to-Refresh Spinner

## Fix #36: Post-Send Auto-Refresh — Balance + Transactions Update Automatically

**Problem:**
1. After sending Bitcoin, the portfolio screen didn't show the new transaction or updated balance until manual pull-to-refresh
2. The 30s background interval only fetched transactions if `isCacheStale()` — but `refreshBalance()` marked the cache as fresh
3. `loadTransactions()` called `api.disconnect()` on the shared Electrum singleton, killing the connection for keepalive, health monitor, and background sync

**Root Causes:**
- `useSendFlowV3.ts` called `refreshBalance()` after broadcast but never triggered transaction reload
- `loadTransactions()` in the portfolio called `api.disconnect()` which destroyed the shared connection
- The background interval gated both balance AND transactions behind `isCacheStale()`, so after a fresh `refreshBalance()` nothing else would fetch

**Solution:**

- **`app/(auth)/(tabs)/index.tsx` (portfolio screen):**
  - **Removed `api.disconnect()`** from `loadTransactions()` — the shared singleton connection is managed by the health monitor and background sync, not by individual screens
  - **Added balance-change auto-refresh** — uses `useRef` to track `balance.total` changes. When the balance changes (e.g., after broadcast), automatically force-loads transactions from network so the new pending transaction appears immediately
  - **Fixed background interval** — `refreshBalance()` now always runs on the 30s interval (it's cheap), while `loadTransactions()` still only runs if cache is stale. This ensures balance is always current.
  - Changed `console.error` → `console.warn` for transaction loading errors

- **`components/send-v3/useSendFlowV3.ts`:**
  - `refreshBalance()` call after broadcast is unchanged but now properly triggers the portfolio's balance-change effect

---

## Fix #37: Pull-to-Refresh Spinner Visibility

**Problem:** Pull-to-refresh showed only haptic feedback but no visible loading spinner. Users couldn't see the refresh was happening.

**Root Cause:** `progressViewOffset={insets.top}` on `RefreshControl` pushed the spinner out of the visible area on iOS, making it invisible during pull-to-refresh.

**Solution:**
- **`app/(auth)/(tabs)/index.tsx`:**
  - Removed `progressViewOffset` — iOS handles spinner positioning naturally
  - Added `progressBackgroundColor` for Android (dark: `#1A1A1A`, light: `#F5F5F5`) to make the spinner background visible
  - Kept `tintColor` for the spinner itself (white in dark mode, black in light mode)
  - Note: `contentInsetAdjustmentBehavior="automatic"` was initially added but later removed — it caused double padding (iOS auto-adds safe area inset on top of the manual `insets.top + 8` paddingTop)

---

## Modified Files

| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/index.tsx` | Removed api.disconnect(); added balance-change auto-refresh effect; fixed background interval; removed progressViewOffset; added contentInsetAdjustmentBehavior |
| `components/send-v3/useSendFlowV3.ts` | refreshBalance() triggers portfolio's balance-change effect |

## Verification

- `npx tsc --noEmit` — zero errors
- Post-send: balance and transactions auto-refresh on portfolio
- Pull-to-refresh spinner visible in both dark and light mode
- Shared Electrum connection not destroyed by portfolio screen
