# 002 - Phase 2: High Priority Bug Fixes
**Date**: 2026-02-06

## 2.1 DEBUG Flags Set to `__DEV__` (then `false` for Electrum)
**Files**:
- `src/components/payment/PaymentSheet.tsx` - `DEBUG = __DEV__`
- `src/components/ui/AppBottomSheet.tsx` - `DEBUG = __DEV__`
- `src/services/electrum/ElectrumClient.ts` - `DEBUG = false`
- `src/services/electrum/ElectrumAPI.ts` - `DEBUG = false`
- `src/services/electrum/ElectrumPool.ts` - `DEBUG = false`

**Problem**: All 5 files had `const DEBUG = true` hardcoded, causing excessive console logging in production builds that impacted performance and battery life.

**Fix**: Changed to `__DEV__` for UI components (PaymentSheet, AppBottomSheet) and `false` for Electrum services (to eliminate noisy connection/response logs even during development).

---

## 2.2 Silent Network Error Handling in Dashboard
**File**: `app/(auth)/(tabs)/index.tsx`

**Problem**: When transaction fetch failed, the error was only logged to console. Users saw stale or empty data with no indication of a problem.

**Fix**: Added toast notification (`toast.showError(...)`) when the transaction fetch fails and no cached data exists, telling the user to pull-to-refresh.

---

## 2.3 Empty Catch Blocks with Logging
**File**: `src/stores/walletStore.ts`

**Problem**: Two empty `catch {}` blocks silently swallowed errors during multisig config migration (line ~2686) and xpub/descriptor extraction during wallet switching (line ~2857).

**Fix**: Added `console.warn()` logging to both catch blocks so failures are visible during debugging without crashing the flow.
