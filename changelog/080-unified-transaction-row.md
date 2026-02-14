# 080 — Unified Transaction Row Component

## Overview
Created a shared `TransactionRow` component used by both the Portfolio dashboard and Activity screen. Removes address display from transaction rows — both screens now show the same compact design: label, timestamp, amount, and fiat value.

## Changes

### New Shared Component
- Created `src/components/bitcoin/TransactionRow.tsx`
- Memoized component with `React.memo` for performance
- Props: `tx`, `ownAddresses`, `onPress`, `onLongPress`, `showDivider`, `showChevron`, `note`, `tags`
- Self-contained: reads `denomination`, `currency`, `price` from stores internally
- Handles all formatting (BTC/sats/fiat) and self-transfer detection internally

### Dashboard Integration
- Removed 80-line inline `TransactionRow` component from `app/(auth)/(tabs)/index.tsx`
- Removed unused `formatTxAmount`, `formatTxSecondary` helpers
- Removed unused `formatRelativeTime` import
- Removed 13 unused transaction row styles
- Uses `UnifiedTransactionRow` with `onPress` callback for navigation

### Activity Screen Integration
- Replaced 120-line `renderTransaction` callback with a thin wrapper around `TransactionRow`
- Removed `getSmartLabel` and `getDisplayAddress` callbacks (now handled by component)
- Removed unused imports: `PriceAPI`, `formatAmount`, `formatRelativeTime`, `truncateAddress`
- Removed unused `denomination` from settings store destructure
- Removed 16 unused transaction row styles, replaced with single `txRowWrap` style
- Notes and tags are passed as props from `txLabels`/`txUserMetadata`

### No Addresses Shown
- Transaction rows no longer display addresses (matching user request)
- Both screens show: icon → label + time → amount + fiat value

## Files Changed
| File | Changes |
|------|---------|
| `src/components/bitcoin/TransactionRow.tsx` | NEW — shared transaction row component |
| `src/components/bitcoin/index.ts` | Added `TransactionRow` export |
| `app/(auth)/(tabs)/index.tsx` | Replaced inline component with shared one |
| `app/(auth)/transactions.tsx` | Replaced renderTransaction with shared component |

## TypeScript
Compiles with 0 errors.
