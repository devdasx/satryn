# 006 - Privacy Screen Improvements (App Switcher)
**Date**: 2026-02-06
**Type**: EDIT
**Status**: COMPLETED

## Problem
1. The "satryn" logo on the app switcher privacy screen was too small (48x48 px)
2. The privacy screen overlay would flash during Face ID authentication because iOS fires `inactive` state when the biometric dialog appears — even when already inside the app
3. The overlay appeared/disappeared instantly with no animation, feeling cheap

## Changes

### 1. Bigger Logo
**File**: `app/_layout.tsx` (styles)
- `width: 48` → `width: 120`
- `height: 48` → `height: 120`
- `opacity: 0.6` → `opacity: 0.7`

### 2. Skip Privacy Blur During Face ID
**New file**: `src/utils/biometricState.ts`
- Simple module-level flag (`BiometricState.setActive` / `BiometricState.isActive`)
- Zero-overhead cross-component communication (no React state, no context)

**Modified**: `src/components/security/PinCodeScreen.tsx`
- Import `BiometricState`
- Set `BiometricState.setActive(true)` before `authenticateAsync()` call
- Set `BiometricState.setActive(false)` after (both success path and catch block)

**Modified**: `app/_layout.tsx`
- Import `BiometricState`
- Changed inactive/background handler: only show privacy blur if `!BiometricState.isActive()`

### 3. Premium Fade + Scale Dismiss Animation
**File**: `app/_layout.tsx`
- Added `react-native-reanimated` imports (`useSharedValue`, `useAnimatedStyle`, `withTiming`, `cancelAnimation`, `Easing`)
- Overlay is always mounted (opacity 0 when hidden) — avoids mount/unmount race conditions
- Animation on show: **instant** (opacity=1, scale=1) with `cancelAnimation` to abort any in-progress dismiss
- Animation on dismiss: **400ms fade-out** (opacity 1→0) + **subtle scale-up** (1→1.04) with ease-out cubic
- Replaced static `<View>` with `<Animated.View>` for the overlay container

## Files Modified
| File | Change |
|------|--------|
| `app/_layout.tsx` | Bigger logo, biometric check, animated dismiss |
| `src/components/security/PinCodeScreen.tsx` | BiometricState flag around authenticateAsync |
| `src/utils/biometricState.ts` | **NEW** - Module-level biometric active flag |

## Verification
- TypeScript: Zero errors (`npx tsc --noEmit`)
