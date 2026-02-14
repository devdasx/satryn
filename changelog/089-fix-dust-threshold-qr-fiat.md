# 089 — Fix Dust Threshold False Positive on QR Scan (Fiat Mode)

## Overview
When scanning a BIP21 QR code with a pre-set amount and the user's display preference is fiat, the amount sheet showed "Amount Too Small" even though the amount far exceeded the 547-sat dust threshold.

## Root Cause
The QR scanner sets the amount in sats via `updateRecipient(idx, 'amount', sats)` with `inputUnit: 'sats'`. But when `defaultCurrencyDisplay` is `'fiat'`, the `StepAmount` component mounts with `selectedUnit === 'fiat'` while `fiatInput` (local state) is empty. The `amountInSats` memo sees fiat mode with empty input and returns 0, triggering the dust check.

## Fix

### Fallback in `amountInSats`
When in fiat mode but `fiatInput` is empty, fall back to `getAmountInSats(activeRecipient)` (the store's pre-set sats value) instead of returning 0.

### Populate `fiatInput` on mount
When `defaultCurrencyDisplay` is fiat and a pre-set amount exists from the QR scan, convert sats to fiat and populate `fiatInput` on mount.

## Files Changed
| File | Changes |
|------|---------|
| `src/components/send-v3/steps/StepAmount.tsx` | Added fallback in `amountInSats` memo; added fiat pre-population in mount `useEffect` |
