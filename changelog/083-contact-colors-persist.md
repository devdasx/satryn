# 083 — Contact Colors: Random & Persisted

## Overview
Fixed all contacts showing the same avatar color. Previously colors were computed from a deterministic name hash, causing similar names to get identical colors. Now each contact gets a random color assigned at creation time, stored in the database.

## Changes

### Database Migration (v4)
- Added `color TEXT` column to `contacts` table
- Existing contacts get random colors assigned during migration

### Contact Model
- Added `color?: string` to `Contact` interface
- Added `color: string | null` to `ContactRow` type
- `contactToRow()` and `rowToContact()` now include color

### Color Assignment
- `addContact()` generates a random color from the 20-color palette
- Color is persisted in SQLite and loaded on app startup

### ContactAvatar Update
- Accepts optional `color` prop
- Uses stored color when available, falls back to name-hash for legacy contacts
- All 6 usages pass `color={contact.color}` or `color={item.color}`

## Files Changed
| File | Changes |
|------|---------|
| `src/services/database/migrations.ts` | Migration v4: add color column + assign random colors to existing |
| `src/services/database/types.ts` | Added `color` to ContactRow |
| `src/services/database/WalletDatabase.ts` | Updated insertContact to include color |
| `src/types/contacts.ts` | Added `color` to Contact interface |
| `src/stores/contactStore.ts` | randomAvatarColor(), contactToRow/rowToContact include color |
| `src/components/contacts/ContactAvatar.tsx` | Accepts `color` prop, uses it over hash |
| `app/(auth)/contacts.tsx` | Pass color to ContactAvatar (2 usages) |
| `app/(auth)/contact-details.tsx` | Pass color to ContactAvatar |
| `src/components/contacts/ContactCard.tsx` | Pass color to ContactAvatar |
| `src/components/contacts/RecentContactsRow.tsx` | Pass color to ContactAvatar |
| `src/components/contacts/SendToContactSheet.tsx` | Pass color to ContactAvatar |
