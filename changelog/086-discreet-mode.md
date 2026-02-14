# 086 — Discreet Mode (Hide Balance)

## Overview
Added a "Discreet Mode" toggle to the wallet dashboard header. When enabled, all balances and transaction amounts are replaced with `••••••` for privacy.

## Changes

### Settings Store
- Added `discreetMode: boolean` to settings state (persisted, version 14)
- Added `setDiscreetMode()` action

### Dashboard (Portfolio)
- Added eye icon toggle in the header (next to sync dot)
- When active: balance shows `••••••`, secondary shows "Discreet Mode"
- Navbar compact balance also shows `••••••`
- Icon toggles between `eye-outline` and `eye-off-outline`

### TransactionRow
- Reads `discreetMode` from settings store
- When active: amounts show `••••` instead of actual values

## Files Changed
| File | Changes |
|------|---------|
| `src/stores/settingsStore.ts` | Added discreetMode state, setter, migration v14 |
| `app/(auth)/(tabs)/index.tsx` | Eye toggle in header, balance masking, navbar masking |
| `src/components/bitcoin/TransactionRow.tsx` | Amount masking in discreet mode |
