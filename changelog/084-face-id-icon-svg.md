# 084 — Face ID Icon: Custom SVG

## Overview
Replaced the incorrect `scan-outline` Ionicons icon on the PIN screen with a proper Apple-style Face ID SVG icon. The `scan-outline` icon looked like a barcode scanner, not Face ID.

## Changes

### New FaceIdIcon Component
- Created `src/components/ui/FaceIdIcon.tsx`
- Uses `react-native-svg` with Path elements
- Renders Apple-style Face ID: corner brackets + eyes + nose + smile
- Accepts `size` and `color` props

### PIN Screen Update
- Imports `FaceIdIcon` component
- Conditionally renders `FaceIdIcon` for Face ID or `Ionicons finger-print` for Touch ID

## Files Changed
| File | Changes |
|------|---------|
| `src/components/ui/FaceIdIcon.tsx` | New component — Apple-style Face ID SVG icon |
| `src/components/security/PinCodeScreen.tsx` | Use FaceIdIcon instead of scan-outline |
