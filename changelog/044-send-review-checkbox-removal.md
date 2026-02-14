# 044 — Send Review Checkbox Removal

## Overview
Removed the balance confirmation checkbox from the send review step. The checkbox was redundant friction — the warning message remains visible but no longer blocks the "Send" button.

## Modified Files

### `src/components/send-v3/steps/StepReview.tsx`
- Removed `balanceConfirmed` state and `setBalanceConfirmed` handler
- Removed checkbox UI (was: "I understand the balance shown may differ...")
- `confirmDisabled` is now always `false` — Send button enabled immediately
- Warning text retained as informational notice without interaction requirement

## Verification
- `npx tsc --noEmit` — zero errors
- Send button is immediately tappable on the review step
