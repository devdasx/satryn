# 079 — PIN Screen: Face ID Icon + Remove Blue Background

## Overview
Fixed the PIN code screen biometric button to show the correct icon (Face ID vs Touch ID) and removed the blue background container that appeared on failed biometric attempts.

## Changes

### Biometric Type Detection
- Added `isFaceId` state that checks `LocalAuthentication.supportedAuthenticationTypesAsync()`
- Detects `FACIAL_RECOGNITION` to determine Face ID vs Touch ID at runtime

### Icon Update
- Changed from always showing `finger-print` to conditional: `scan-outline` for Face ID, `finger-print` for Touch ID
- Matches iOS system behavior

### Blue Background Removal
- Removed the `biometricFailed` conditional blue background styling
- Biometric button now uses the same style as other keypad buttons (transparent with pressed state)

## Files Changed
| File | Changes |
|------|---------|
| `src/components/security/PinCodeScreen.tsx` | Face ID detection, icon conditional, removed blue background |
