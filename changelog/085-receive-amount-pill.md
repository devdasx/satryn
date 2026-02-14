# 085 — Receive Screen: Compact Amount Pill

## Overview
Redesigned the amount display under the QR code on the receive screen. Previously used a bulky 3-line stacked layout (label + amount + fiat). Now uses a compact inline pill that shows amount and fiat side by side.

## Changes
- Replaced stacked `amountInsideCard` layout with horizontal `amountPill`
- Single-line display: amount + fiat + clear button
- Pill has subtle background (`rgba(0,0,0,0.05)`) with rounded corners
- Removed "Requesting" label — the pill is self-explanatory
- Significantly less vertical space used

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/receive.tsx` | Replaced amount display JSX and styles with compact pill design |
