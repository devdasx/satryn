# 094 — Activity Screen Fixes

## Overview
Three fixes to the activity (transactions) screen: reduced excessive header padding, included self-transfers in the "Sent" filter, and added contextual empty states per filter.

## Changes

### Reduced Header Padding
- `header.paddingBottom`: 12 → 4
- `appBar.marginBottom`: 4 → 0
- `listContent.paddingTop`: 4 → 0
- Tightens the gap between search bar and first transaction

### Sent Filter Includes Self-Transfers
- When direction filter is "outgoing", now matches both `tx.type === 'outgoing'` and `tx.type === 'self-transfer'`
- Previously self-transfers were excluded from the Sent view

### Contextual Empty States
Replaced the two-state empty component (filters vs no-filters) with a unified contextual empty state that adapts to the active filter:
- **No filters**: "No transactions yet" with receipt icon and "Receive Bitcoin" button
- **Received filter**: "No received transactions" with arrow-down icon
- **Sent filter**: "No sent transactions" with arrow-up icon
- **Other filters/search**: "No matches" with search/funnel icon and "Clear All Filters" button
- All variants use the concentric rings style matching the portfolio screen

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/transactions.tsx` | Reduced padding, fixed sent filter, contextual empty states |
