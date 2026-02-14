# Fix #32 — Tab Bar: iOS Version Detection for Liquid Glass

## Problem

The tab bar used `NativeTabs` (Liquid Glass) on ALL iOS versions. On iOS versions below 26 that don't support Liquid Glass, this results in a broken/ugly navigation bar layout.

## Solution

- `app/(auth)/(tabs)/_layout.tsx` — Added runtime iOS version detection
- `NativeTabs` is only used when `Platform.Version >= 26` (iOS 26+ with Liquid Glass support)
- On iOS < 26, falls back to standard `<Tabs>` with proper styling (surface background, subtle border, Ionicons)
- Wrapped the `NativeTabs` import in a try/catch so it gracefully falls back if unavailable
- Android continues to use standard `<Tabs>` with Ionicons

## Modified Files

| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/_layout.tsx` | Runtime iOS version check; NativeTabs only on iOS 26+; fallback to standard Tabs with Ionicons |

## Verification

- `npx tsc --noEmit` — zero errors
- Tab bar renders correctly on iOS < 26 (standard tabs) and iOS 26+ (Liquid Glass)
- Android uses standard Tabs with Ionicons
