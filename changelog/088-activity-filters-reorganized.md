# 088 — Activity Filters Reorganized

## Overview
Moved the inline quick filter chips (All/Received/Sent) from the activity screen into the existing filter bottom sheet. Added a filter icon to the app bar for quick access.

## Changes

### Inline Filters Removed
- Removed the `quickFilter` state and `QuickFilter` type
- Removed the `FilterChip` component
- Removed the segmented control row from the header

### Filter Sheet Enhanced
- Added `direction` field to `FilterState` (all/incoming/outgoing)
- New "Direction" section at the top of the filter sheet with All/Received/Sent options
- Direction is now part of `activeFilterCount` for the badge

### App Bar
- Back button on the left, filter icon on the right
- Filter icon shows badge when active filters exist
- Cleaner header layout

### Styles Cleanup
- Removed `filterRow`, `segmentedControl`, `filterChip`, `filterChipText`, `filterButton` styles
- Added `appBar`, `appBarSpacer`, `appBarFilterButton` styles

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/transactions.tsx` | Removed quick filters, added direction to filter sheet, filter icon in app bar |
