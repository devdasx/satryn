# 074 — Contacts Screen: Multi-Select, Favorites Circle Row, QR Scan Fix, Duplicate Prevention

## Overview
Comprehensive contacts screen upgrade with 7 improvements: bulk delete with select all, favorites as horizontal scrollable circles, inline QR scanning for addresses, star badge for favorites, long press hint, duplicate name prevention, and premium select mode design.

## Changes

### 1. Multi-Select Mode with Bulk Delete
- "Select" button appears in header when 2+ contacts exist
- Select mode shows circular checkboxes (black/white theme, no orange)
- Select bar with "All" pill, count display, and "Delete" pill
- "Select All" / "Deselect" toggle
- Confirmation alert before bulk deletion

### 2. Favorites Horizontal Circle Layout
- Favorites section replaced card layout with horizontal ScrollView
- Each favorite shown as large circular avatar with first name below
- Swipeable left/right to see all favorites
- Tappable for navigation, long-pressable for quick actions
- Hidden during select mode

### 3. Contact QR Scan Address Fix
- **Before**: Scan button closed the sheet and navigated to scanner route; scanned address was lost
- **After**: QRScanner modal opens inline inside the sheet
- Scanned address properly populates the address field
- Handles `bitcoin:` URI stripping

### 4. Favorite Star Badge
- Replaced yellow circle with star badge on contact avatars
- Uses Ionicons star icon inside a gold badge
- Proper sizing for sm/md/lg avatar sizes

### 5. Long Press Hint
- Centered hint: fingerprint icon + "Long press a contact for quick actions"
- Only visible when contacts exist and not in select mode
- Muted styling

### 6. Duplicate Name Prevention
- `addContact` in contactStore throws error for duplicate names (case-insensitive)
- AddEditContactSheet catches error and shows Alert

### 7. Contact Avatar Color Palette
- Expanded from 10 muted colors to 20 vibrant, distinct colors
- Added rose pink, amber, coral red, vivid purple, salmon, gold, cyan, hot pink, mint, indigo, red, teal green, violet
- Each contact now gets a visually distinct color

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/contacts.tsx` | Multi-select, favorites circles, long press hint, premium select UI |
| `src/components/contacts/ContactAvatar.tsx` | Star badge, expanded color palette (10 → 20) |
| `src/components/contacts/AddEditContactSheet.tsx` | Inline QRScanner modal, duplicate name Alert |
| `src/stores/contactStore.ts` | Duplicate name check in `addContact` |
