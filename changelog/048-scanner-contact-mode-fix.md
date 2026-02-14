# 048 — Scanner Contact Mode & Error UI

## Overview
Fixed the QR scanner opening a payment sheet when called from the contact editor, and added inline error messages for invalid QR codes instead of just haptic feedback.

## Modified Files

### `src/components/contacts/AddEditContactSheet.tsx`
- Changed scan navigation to pass `source=contact` parameter
- `router.push({ pathname: '/(auth)/scan', params: { source: 'contact' } })`

### `app/(auth)/scan.tsx`
- Added `useLocalSearchParams` to read `source` parameter
- Added `scanError` state for inline error banner
- Contact source mode (`source === 'contact'`): validates address, copies to clipboard, navigates back (no payment sheet)
- Invalid QR code: shows inline error banner "Not a valid Bitcoin address or QR code" for 3 seconds
- Error banner: red-tinted background, alert-circle icon, rounded 12px, auto-dismisses

## Verification
- `npx tsc --noEmit` — zero errors
- Scanning from contacts correctly sets the address field
- Invalid QR codes show a visible error message
