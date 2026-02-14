# 000b - Bug Fix Plan (Approved & Executed)
**Date**: 2026-02-06
**Type**: PLAN
**Status**: COMPLETED

## Build Status at Time of Planning
- TypeScript: **Zero errors** - compiles clean
- Expo Doctor: **16/17 passed** (1 warning: `react-native-tcp-socket` + `expo-icloud-storage` untested on New Architecture)

## Bugs Found & Fix Plan

### Phase 1: Critical Fixes (Crash Prevention)

#### 1.1 Add Error Boundary Component
- **Problem**: No error boundaries anywhere - any JS error crashes entire app
- **Create**: `src/components/ui/ErrorBoundary.tsx` - class component wrapping screens
- **Modify**: `app/_layout.tsx` - wrap root layout with ErrorBoundary
- **Modify**: `app/(auth)/_layout.tsx` - wrap auth layout with ErrorBoundary

#### 1.2 Fix Background Derivation Failure Leaving App Stuck
- **File**: `src/stores/walletStore.ts` (~line 1448)
- **Problem**: If `InteractionManager.runAfterInteractions` callback fails, `isLoading` never resets
- **Fix**: Add proper error recovery that resets `isLoading` state on failure

#### 1.3 Fix Race Condition in Wallet Switching
- **File**: `src/stores/walletStore.ts` (~lines 1667-2000, 2427-2900)
- **Problem**: Rapid wallet switching can corrupt state when async ops from previous switch complete
- **Fix**: Strengthen the `currentSwitchRequestId` guard to cover all async state updates
- **Outcome**: Already sufficiently guarded - no changes needed

### Phase 2: High Priority Fixes

#### 2.1 Disable DEBUG Flags for Production
- **Files modified** (set `DEBUG = __DEV__` for UI, `DEBUG = false` for Electrum):
  - `src/components/payment/PaymentSheet.tsx` - `DEBUG = __DEV__`
  - `src/components/ui/AppBottomSheet.tsx` - `DEBUG = __DEV__`
  - `src/services/electrum/ElectrumClient.ts` - `DEBUG = false`
  - `src/services/electrum/ElectrumAPI.ts` - `DEBUG = false`
  - `src/services/electrum/ElectrumPool.ts` - `DEBUG = false`

#### 2.2 Fix Silent Network Error Handling
- **File**: `app/(auth)/(tabs)/index.tsx`
- **Fix**: Show toast/banner when transaction fetch fails instead of silently keeping stale data

#### 2.3 Fix Critical Empty Catch Blocks
- **File**: `src/stores/walletStore.ts`
- **Fix**: Added `console.warn()` to multisig config migration and xpub extraction catch blocks

### Phase 3: UI Fixes

#### 3.1 Keyboard Avoidance on Input Screens
- **Outcome**: Already implemented - all key screens use `KeyboardSafeBottomBar`

#### 3.2 Make PIN Buttons Responsive
- **File**: `src/components/security/PinCodeScreen.tsx`
- **Fix**: Replace hardcoded `width: 85, height: 85` with `Math.min(85, (Dimensions.get('window').width - 72) / 3)`

### Phase 4: Electrum Client Resilience

#### 4.1 Add Connection Loop Safeguard
- **File**: `src/services/electrum/ElectrumClient.ts`
- **Fix**: Added `MAX_CONSECUTIVE_RECONNECTS = 3` to prevent infinite reconnection loops

#### 4.2 User-Visible Connection Status
- **Outcome**: Already implemented - `failSyncing()` + sync status chip already surface errors

## Files Modified Summary
| File | Changes |
|------|---------|
| `src/components/ui/ErrorBoundary.tsx` | **NEW** - Error boundary component |
| `app/_layout.tsx` | Wrap with ErrorBoundary |
| `app/(auth)/_layout.tsx` | Wrap with ErrorBoundary |
| `src/stores/walletStore.ts` | Error surfacing in derivation, logging in empty catches |
| `src/services/electrum/ElectrumClient.ts` | DEBUG=false, logError gated, reconnect loop guard |
| `src/services/electrum/ElectrumAPI.ts` | DEBUG=false, logError gated, console.warn gated |
| `src/services/electrum/ElectrumPool.ts` | DEBUG=false, logError gated |
| `src/components/payment/PaymentSheet.tsx` | DEBUG=__DEV__ |
| `src/components/ui/AppBottomSheet.tsx` | DEBUG=__DEV__ |
| `app/(auth)/(tabs)/index.tsx` | Toast on network error |
| `src/components/security/PinCodeScreen.tsx` | Responsive PIN buttons |

## Verification
- TypeScript: Zero errors after all changes (`npx tsc --noEmit`)
- Expo Doctor: Same 16/17 result, no new issues
