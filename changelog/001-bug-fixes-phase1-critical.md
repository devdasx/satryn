# 001 - Phase 1: Critical Bug Fixes (Crash Prevention)
**Date**: 2026-02-06

## 1.1 Error Boundary Component
**Files**:
- `src/components/ui/ErrorBoundary.tsx` (NEW)
- `app/_layout.tsx` (MODIFIED)
- `app/(auth)/_layout.tsx` (MODIFIED)

**Problem**: No error boundaries existed in the app. Any unhandled JavaScript error would crash the entire app.

**Fix**: Created a React class-based `ErrorBoundary` component with a fallback UI showing "Something went wrong" with a "Try Again" button. Wrapped both the root layout and auth layout with this component.

---

## 1.2 Background Derivation Failure Recovery
**File**: `src/stores/walletStore.ts`

**Problem**: If background address derivation failed inside `InteractionManager.runAfterInteractions`, the error was only logged to console. The UI would show an empty wallet with no error feedback.

**Fix**: Added `set({ error: ... })` in the catch block so the error state is surfaced to the UI, allowing the user to see what went wrong instead of staring at an empty screen.

---

## 1.3 Race Condition in Wallet Switching
**File**: `src/stores/walletStore.ts`

**Status**: Verified existing guards are sufficient. The `currentSwitchRequestId` pattern already protects all critical async state updates in `switchToWallet()`, and `refreshBalance()` checks `walletId` match after async operations.
