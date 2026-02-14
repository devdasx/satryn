# 090 — Shake-to-Report Disable Toggle

## Overview
Added a toggle in Settings to disable the shake-to-report feedback feature. Enabled by default, persisted via settingsStore (AsyncStorage).

## Changes

### Settings Store
- Added `shakeToReportEnabled: boolean` to `SettingsState` (default: `true`)
- Added `setShakeToReportEnabled` action
- Bumped store version to 15 with migration

### Settings Screen
- Added "Shake to Report" toggle row in the Preferences section (after In-App Alerts)
- Uses `hand-left-outline` icon with orange accent
- Added to search index for discoverability

### Auth Layout
- Conditionally passes `handleShake` or `undefined` to `useShakeDetector` based on setting
- When disabled, the accelerometer listener is not subscribed at all

### Shake Detector Hook
- Changed parameter type to `(() => void) | undefined`
- Early return when callback is `undefined` (feature disabled)

## Files Changed
| File | Changes |
|------|---------|
| `src/stores/settingsStore.ts` | Added `shakeToReportEnabled` state, setter, migration v15 |
| `app/(auth)/(tabs)/settings.tsx` | Added toggle row, icon color, search config |
| `app/(auth)/_layout.tsx` | Conditional shake callback based on setting |
| `src/hooks/useShakeDetector.ts` | Accept `undefined` callback, early return |
