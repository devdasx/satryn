# 077 — UI Polish: Portfolio Balance, Activity Screen, Onboarding

## Overview
Three UI refinements across the dashboard, activity screen, and onboarding flow.

## Changes

### Portfolio Balance Capsule
- Changed format from `BTC $70,866.50` to `BTC ≈ $70,866.50`
- Added approximate symbol (≈) to indicate the price is an estimate
- File: `app/(auth)/(tabs)/index.tsx`

### Activity Screen Transaction Layout
- Moved timestamp from right column to left column (under the address)
- Added fiat value display on the right side using `PriceAPI.formatPrice()`
- Self-transfer transactions now show: address + timestamp on left, amount + fiat on right
- Added null check for price (`price != null && price > 0`)
- File: `app/(auth)/transactions.tsx`

### Onboarding Skip Button
- Replaced plain "Skip" text with "Discover App" muted capsule button
- Improved touchability with `activeOpacity={0.6}` and proper padding (14h × 8v)
- Rounded capsule shape (borderRadius: 20)
- Adaptive colors for light/dark mode
- File: `app/(onboarding)/index.tsx`

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/index.tsx` | Added ≈ to BTC price capsule |
| `app/(auth)/transactions.tsx` | Timestamp under address, fiat on right, PriceAPI import |
| `app/(onboarding)/index.tsx` | "Discover App" capsule, improved touchability |
