# 061 — Remove All Screen-Level Toast Notifications

## Overview
Removed all toast notification systems from every screen in the app. Toast alerts (the floating "Copied to clipboard", "UTXO frozen", "Note saved" etc. messages) have been completely removed. Haptic feedback is preserved as the primary confirmation signal for user actions.

## Modified Files (6)

### `app/(auth)/utxo-detail.tsx`
- Removed `CopyToast` function component
- Removed `toastMessage` and `toastVisible` state variables
- Removed `showToast` callback function
- Removed `showToast(...)` calls from: `handleCopy`, `handleSaveNote`, `handleToggleFreeze`, `handleToggleLock`
- Removed `showToast` from all `useCallback` dependency arrays
- Removed toast JSX block and toast styles (`toastContainer`, `toast`, `toastText`)

### `app/(auth)/transaction-details.tsx`
- Removed `CopyToast` function component
- Removed `toastStyles` StyleSheet
- Removed `toastMessage`, `toastVisible` state and `toastTimer` ref
- Removed `showToast` function and all calls
- Removed `<CopyToast />` JSX rendering
- Removed `useRef` import (only used for `toastTimer`)

### `app/(auth)/multisig-review.tsx`
- Removed `showCopiedToast`, `toastMessage` state variables
- Removed `toastOpacity` ref
- Removed `showToast` callback and all calls
- Removed toast JSX block (`Animated.View` with fade animation)
- Removed toast styles (`toast`, `toastText`)
- Removed `Animated` import from `react-native` (only used for toast)
- Removed `useRef` import (only used for `toastOpacity`)

### `src/components/bitcoin/ExportableQR.tsx`
- Removed `showToast`, `toastMessage` state variables
- Removed `triggerToast` callback and all calls
- Removed toast JSX block (`Animated.View` with `FadeIn`/`FadeOut`)
- Removed toast styles (`toastContainer`, `toast`, `toastText`)
- Removed `Animated, FadeIn, FadeOut` import from `react-native-reanimated`
- Removed `useState` import (no longer needed)

### `app/(onboarding)/multisig-create.tsx`
- Removed `showCopiedToast`, `toastMessage` state variables
- Removed `toastOpacity` ref
- Removed `showToast` callback and all calls
- Removed toast JSX block
- Removed toast styles (`toast`, `toastText`)
- Kept `Animated` import (still used for `fadeAnim` step transitions)
- Kept `useRef` import (still used for `fadeAnim`)

### `app/(onboarding)/create.tsx`
- Removed `showCopiedToast` state variable
- Removed `toastOpacity` ref
- Removed toast animation sequence from `handleCopyPhrase`
- Removed toast JSX block
- Removed toast styles (`toast`, `toastText`)
- Kept `Animated` import (still used for `warningPulse` and `fadeAnim`)
- Kept `useRef` import (still used for `warningPulse` and `fadeAnim`)

## Key Design Decisions
- **Haptics-only feedback** — All clipboard, freeze, lock, save, and copy actions still trigger haptic feedback. The toast was redundant visual noise.
- **Clean unused imports** — Removed `Animated`, `useRef`, `FadeIn`, `FadeOut`, `useState` imports where they were only used for the toast system.
- **Preserved all functionality** — All `Clipboard.setStringAsync()`, `Haptics.*`, and action logic remains intact.

## Unchanged
- `src/providers/ToastProvider.tsx` — Infrastructure provider, not a screen-level toast

## Verification
- `npx tsc --noEmit` — zero errors
- No toast-related code remains in any screen file
- All clipboard copy actions still work with haptic feedback
- All freeze/unfreeze/lock/unlock actions still work with haptic feedback
- All share actions still work
- Note saving still works
