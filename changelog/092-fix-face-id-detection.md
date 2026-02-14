# 092 — Fix Face ID Detection

## Overview
Settings screen showed "Biometrics Unavailable" on devices with Face ID enabled. The `hasHardwareAsync()` API was returning `false` on some devices despite Face ID being available and enrolled.

## Fix
Replaced `hasHardwareAsync()` with `supportedAuthenticationTypesAsync()` which returns an array of supported biometric types (fingerprint, facial recognition, iris). Check `types.length === 0` instead of `!compatible` to determine hardware availability.

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/settings.tsx` | Replaced `hasHardwareAsync()` with `supportedAuthenticationTypesAsync()` for biometric detection |
