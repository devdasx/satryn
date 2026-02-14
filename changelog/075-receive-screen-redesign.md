# 075 — Receive Screen: Amount Display Redesign + Input Improvements

## Overview
Redesigned the receive screen's amount request flow. Amount display is now inside the QR card container (not floating below), the input sheet has improved design, and the hidden "0" placeholder issue is fixed.

## Changes

### Amount Display Inside QR Card
- **Before**: Amount badge floated below the QR code as a separate pill
- **After**: Amount display is inside the same white QR card container
- Shows "Requesting" label, formatted amount, and fiat equivalent
- Divider line separates QR from amount section
- Clear button (X) on the right to remove amount

### Amount Input Sheet Improvements
- Changed placeholder from "0" to "Enter amount" — fixes the hidden "0" UI bug
- Added subtle border to the input field container
- Input font adjusted: 32px weight 700 with -0.5 letter spacing
- Improved placeholder color for better visibility
- Fixed "SATS SATS" duplicate in preview (formatAmount already includes unit suffix)

### Currency Display Fix
- Amount badge fiat display now uses `PriceAPI.formatPrice()` instead of hardcoded `$`
- Preview line uses `PriceAPI.formatPrice()` for correct currency symbol
- `formatFiat` helper function uses `PriceAPI.formatPrice()` for all fiat formatting

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/receive.tsx` | Amount inside QR card, input redesign, currency fix, PriceAPI import |
