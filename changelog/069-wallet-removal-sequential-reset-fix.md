# 069 — Fix Wallet Removal Sheet Not Resetting for Sequential Removals

## Overview
Fixed a bug where removing one wallet and then attempting to remove a second wallet would show the old "Wallet Removed" success screen instead of starting a fresh removal process. The root cause was an overly broad state guard in the reset `useEffect` that prevented the sheet from resetting when a different wallet was passed in.

## Bug Description

### Steps to Reproduce
1. Have 2+ wallets in the app
2. Open Wallet Hub → Remove Wallet on the first wallet
3. Complete the removal process (verify identity → confirm → removing → complete)
4. Press "Done" to close the success sheet
5. Open Wallet Hub → Remove Wallet on the second (now active) wallet
6. **Bug**: The sheet shows the old "Wallet Removed" success screen with all 4 steps completed, instead of the initial "Remove Wallet" confirmation screen

### Expected Behavior
The removal sheet should reset to its initial `'waiting'` state and begin a fresh removal process for the new wallet.

## Root Cause Analysis

### The Problem — `WalletRemovalSheet.tsx` lines 351–355 (before fix)

The reset `useEffect` had a guard that was too broad:

```typescript
// BEFORE (buggy):
if (step === 'removing' || step === 'complete' || step === 'last_wallet_choice') {
  return; // ← Skips reset unconditionally
}
```

This guard was designed to protect against an important edge case: when `removeWallet()` is called, the Zustand store auto-switches to the next wallet, which causes `wallet.id` to change mid-removal. The `useEffect` depends on `wallet?.id`, so it would re-fire and incorrectly reset the sheet during an active removal.

However, the guard was **too broad** — it also prevented resetting when the user closed the sheet after a completed removal and then opened it for a **completely different wallet**. Since `step` was still `'complete'` from the previous removal, the guard blocked the reset.

### The Sequence
1. First removal completes → `step = 'complete'`
2. User presses "Done" → `onClose()` fires, `visible` becomes `false`
3. Parent re-renders with new active wallet (auto-switched after removal)
4. User taps "Remove Wallet" on second wallet → `visible` becomes `true`, `wallet` is new wallet
5. `useEffect` fires with `visible=true`, new `wallet.id`
6. **Guard check**: `step === 'complete'` → `return` (reset skipped!)
7. Sheet renders with stale `'complete'` state showing old success screen

## Fix

### Added Wallet ID Tracking — `removingWalletId` ref

Added a `useRef` to track which wallet ID is currently being processed:

```typescript
// Track which wallet ID is currently being removed so we can distinguish
// "same wallet in progress" from "new wallet removal requested".
const removingWalletId = useRef<string | null>(null);
```

### Updated Guard Logic

The guard now checks whether the incoming wallet is the **same** wallet being removed:

```typescript
// AFTER (fixed):
const isSameWallet = removingWalletId.current === wallet.id;
if (isSameWallet && (step === 'removing' || step === 'complete' || step === 'last_wallet_choice')) {
  return;
}
```

- **Same wallet + in-progress/complete**: Skip reset (protects against mid-removal re-renders) ✓
- **Different wallet + any state**: Always reset to `'waiting'` (starts fresh removal) ✓

### Set Tracking ID on Reset

When the sheet resets for a new wallet, the ref is updated:

```typescript
removingWalletId.current = wallet.id;
setStep('waiting');
setStepStatuses(['pending', 'pending', 'pending', 'pending']);
// ... rest of reset
```

## Files Changed

### `src/components/wallet/WalletRemovalSheet.tsx`
- **Added** `removingWalletId` ref (line 321) — tracks which wallet is being removed
- **Modified** reset guard (lines 354–360) — now checks `isSameWallet` before skipping reset
- **Added** `removingWalletId.current = wallet.id` in reset block (line 362) — updates tracking on new removal

## Impact
- Fixes sequential wallet removal (removing wallet A then wallet B)
- No change to single wallet removal behavior
- No change to mid-removal protection (still skips reset when same wallet's ID changes due to store auto-switch)
- No change to PIN verification flow
- TypeScript compiles with 0 errors
