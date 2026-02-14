# 066 — Unified Import Screen, Import Info Sheet, Premium Empty States

## Overview
Replaced the 5-tab segmented import screen with a single unified text input that auto-detects the import format. Added a premium tabbed info sheet explaining all supported import types. Redesigned empty states across Portfolio, Wallet, and Contacts tabs with layered icons, animated entries, and modern styling.

## Changes

### `app/(onboarding)/import.tsx` — Complete rewrite
- **Removed**: 5-tab `SegmentedControl` (Phrase, Key, xprv, Seed, File)
- **Added**: Single unified `TextInput` with auto-detection via `detectInputType()`
- `processInput()` detects format in real-time and maps to category (mnemonic, key, extended, seed, file, watch)
- Detected format badge appears below input showing recognized type with icon
- Three action buttons: Paste from clipboard, Scan QR code, Pick file
- Passphrase toggle shown for mnemonic/extended/seed categories
- BIP38 encrypted key modal auto-opens when encrypted key detected
- Path discovery runs automatically for supported types
- Watch-only badge for xpub-based imports
- Derivation path selector and wallet settings for applicable categories
- Info icon in header opens `ImportInfoSheet`
- Removed imports: `SegmentedControl`, `PhraseSection`, `KeySection`, `ExtendedKeySection`, `SeedBytesSection`, `FileSection`

### New File: `src/components/import/ImportInfoSheet.tsx`
Premium tabbed bottom sheet explaining all supported import formats:
- 6 tabs: Phrase, Keys, Extended, Seed, File, Watch
- Each tab shows category header with icon and format cards
- Format cards include: name, icon, description, example (monospace), optional notes
- Scrollable horizontal tab bar with active state styling
- Animated category headers and staggered card entry (FadeInDown)
- Uses `AppBottomSheet` with `sizing="large"` and `scrollable`

### `src/components/import/index.ts`
- Added `ImportInfoSheet` export

### `app/(auth)/(tabs)/index.tsx` — Premium empty states
**No-wallet empty state (full-screen):**
- Replaced flat icon with layered concentric rings (3 rings + center circle)
- Added animated entry with staggered `FadeInDown` delays
- Added feature pills row: "Self-custody", "Private", "Open source"
- Updated copy: "Your self-custody Bitcoin wallet. Create or import to get started."
- CTA: "Get Started" with forward arrow

**No-transactions empty state (in-page):**
- Replaced flat icon with double-layered circle (outer + inner)
- Changed icon to `swap-vertical-outline`
- Secondary-style CTA button (muted background instead of solid)
- Animated entry with `FadeInDown`

### `app/(auth)/(tabs)/wallet.tsx` — Premium empty state
- Replaced flat icon with layered icon stack (outer ring + center circle)
- Changed icon to filled `wallet` (was `wallet-outline`)
- Split single CTA into two buttons: "Create Wallet" (primary) + "Import" (secondary)
- Updated copy with line break for better readability
- Larger typography (22pt title, 15pt subtitle)
- Pill-shaped buttons (borderRadius 24)

### `src/components/contacts/EmptyContactsState.tsx` — Premium empty state
- Added `react-native-reanimated` animated entries (`FadeInDown`)
- Replaced flat circle with layered icon stack (outer ring + center circle)
- Changed icon to filled `people` (was `people-outline`)
- Added `person-add-outline` icon to CTA button
- Updated copy: "Save addresses to quickly send Bitcoin to people you trust."
- Pill-shaped CTA (borderRadius 24)
- Larger typography (22pt title, 15pt subtitle)

## Wallet Type Verification
All 11 wallet types confirmed fully supported across:
- **Preserve Data**: Generic snapshot extraction — no type-specific filtering
- **iCloud Backups**: Complete switch statements in both archival and restoration paths
- **Database Viewer**: No type filtering — displays all tables generically

| Type | Preserve | iCloud | Database |
|------|----------|--------|----------|
| hd | Yes | Yes | Yes |
| imported_key | Yes | Yes | Yes |
| imported_keys | Yes | Yes | Yes |
| hd_xprv | Yes | Yes | Yes |
| hd_seed | Yes | Yes | Yes |
| hd_descriptor | Yes | Yes | Yes |
| hd_electrum | Yes | Yes | Yes |
| watch_xpub | Yes | Yes | Yes |
| watch_descriptor | Yes | Yes | Yes |
| watch_addresses | Yes | Yes | Yes |
| multisig | Yes | Yes | Yes |

## TypeScript
`npx tsc --noEmit` passes with 0 errors.
