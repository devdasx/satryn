# 019 — Nearby Payments: Error/Timeout Redesign + Timestamp Tolerance Fix

## Problems

### 1. Timeout shown as error
When no nearby devices were found within the scan window, the app showed a scary "No Devices Found" screen with "An unexpected error occurred" — this was confusing because nothing actually went wrong, there just weren't any devices nearby.

### 2. Timestamp validation too strict
The "Timestamp out of range" error (`PAYLOAD_INVALID`) was triggered when the sender received the receiver's payload, because the two devices' clocks differed by more than 5 minutes. The payload expiry was also only 2 minutes — too tight for the manual peer selection flow.

## Fixes

### Error vs Timeout Separation
- **NearbyTimeout** (new component): Friendly, calm "No Devices Nearby" screen with:
  - Subtle gray icon (not red/alarming)
  - Helpful tips card (both devices need Nearby open, keep close, ensure Wi-Fi/Bluetooth on)
  - "Search Again" button
- **NearbyError** (redesigned): Error-only screen with:
  - Per-error-code titles: "Connection Failed", "Invalid Payment Data", "Network Mismatch", etc.
  - Per-error-code hints in a glass card explaining what went wrong and how to fix it
  - Red-tinted icon for actual errors
  - "Open Settings" button for Bluetooth permission errors
- **NearbyScreen**: Routes `timeout` → `NearbyTimeout` and `error` → `NearbyError` (previously both went to NearbyError)

### Timestamp Tolerance
- `MAX_CLOCK_SKEW_MS`: Increased from **5 minutes** → **15 minutes** — generous for in-person payments where device clocks may drift
- `PAYLOAD_EXPIRY_MS`: Increased from **2 minutes** → **10 minutes** — allows time for manual peer selection, connection establishment, and review

## Files Created

| File | Purpose |
|------|---------|
| `src/components/nearby/NearbyTimeout.tsx` | Friendly "no devices nearby" screen (not an error) |

## Files Modified

| File | Change |
|------|--------|
| `src/components/nearby/NearbyError.tsx` | Redesigned for real errors only — per-code titles, hint cards, better layout |
| `src/components/nearby/NearbyScreen.tsx` | Separated `timeout` and `error` routing to different components |
| `src/components/nearby/index.ts` | Added NearbyTimeout export |
| `src/services/nearby/types.ts` | `MAX_CLOCK_SKEW_MS` 300s → 900s, `PAYLOAD_EXPIRY_MS` 120s → 600s |

## Verification
- `npx tsc --noEmit` — zero errors
