# 098 — Fix TrueSheet Resize Warning

## Overview
Fixed the warning: `TrueSheet: Cannot resize. Sheet is not presented.`

## Root Cause
`AppBottomSheet` uses a 4-tier resize cascade (50ms, afterInteractions, 300ms, 600ms) when `contentKey` changes. If the sheet's `visible` prop becomes `false` while the cascade is running, the delayed `resize()` calls fire against a dismissed sheet, producing the warning.

The `doResize` function checked `cancelled` (from the effect cleanup) but not `wasVisible.current`. If `contentKey` changed and then `visible` toggled off before the timeouts fired, the resize calls would still execute.

Same issue existed in `handleDidPresent` (post-present resize) and could theoretically occur there too.

## Fix
Added `wasVisible.current` guard to:
1. `doResize()` in the contentKey cascade — early return if sheet is no longer visible
2. `handleDidPresent` post-present resize — skip if sheet was dismissed during the 50ms delay

## Files Changed
| File | Changes |
|------|---------|
| `src/components/ui/AppBottomSheet.tsx` | Added `wasVisible.current` check in `doResize()` and `handleDidPresent` resize |
