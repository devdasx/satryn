# 003 - Phase 3: UI Fixes
**Date**: 2026-02-06

## 3.1 Keyboard Avoidance on Input Screens
**Status**: Already implemented. Verified that all key input screens (import, send-v2, sign-message, verify-message, broadcast) already use `KeyboardSafeBottomBar`. No changes needed.

---

## 3.2 Responsive PIN Buttons
**File**: `src/components/security/PinCodeScreen.tsx`

**Problem**: PIN keypad buttons were hardcoded at `width: 85, height: 85` pixels, which didn't scale properly on smaller iPhone models (iPhone SE has 375pt width vs. Pro Max at 430pt).

**Fix**:
- Added `Dimensions` import from react-native
- Changed `keyBtn` style from hardcoded `85` to `Math.min(85, (Dimensions.get('window').width - 72) / 3)`
- This caps at 85pt on large screens but scales down proportionally on smaller devices
- Border radius also scales to maintain the circular shape
