# 004 - Phase 4: Electrum Client Resilience
**Date**: 2026-02-06

## 4.1 Connection Loop Safeguard
**File**: `src/services/electrum/ElectrumClient.ts`

**Problem**: If all Electrum servers were down, `reconnectToNextServer()` could be called repeatedly by in-flight requests, each triggering a full 12-second `doConnect()` budget.

**Fix**: Added `MAX_CONSECUTIVE_RECONNECTS = 3` guard at the top of `reconnectToNextServer()`. If `consecutiveTimeouts` reaches 3, the method throws an error instead of attempting another full connection cycle. The counter resets to 0 on any successful request.

---

## 4.2 User-Visible Connection Failures
**Status**: Already implemented. Verified that:
- `refreshBalance()` catch block updates `multiWalletStore` with 'error' status
- Dashboard's `onRefresh` calls `failSyncing()` on error
- Sync status chip at top of dashboard shows red "Offline" or gray "Not synced" state
- No additional changes needed
