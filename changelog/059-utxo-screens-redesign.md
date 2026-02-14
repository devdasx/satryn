# 059 — UTXO Management Fix + UTXO Details Redesign — Match Settings/Wallet Design Language

## Overview
Fixed the UTXO Management screen's light mode surface color (was `rgba(255,255,255,0.45)` making cards invisible on white background, now `colors.surfacePrimary`). Fully redesigned the UTXO Details screen to match the Settings and Wallet tab design language: `borderRadius: 20` cards with no borders, `13px/700` uppercase section headers with `30%` opacity, `24px` horizontal padding, no animations, no BlurView.

## Modified Files

### `app/(auth)/utxo-management.tsx` — Light mode surface color fix
- `surfaceBg` light value: `'rgba(255,255,255,0.45)'` → `colors.surfacePrimary` (opaque white `#FFFFFF`)
- This matches the pattern used in settings, wallet, and all other redesigned screens

### `app/(auth)/utxo-detail.tsx` — Full UTXO details screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown`, `FadeOut` from `react-native-reanimated`

**Removed Derived Colors:**
- `surfaceBorder` — no longer needed (no borders on any element)

**Updated Derived Colors:**
- `surfaceBg` light value: `'rgba(255,255,255,0.45)'` → `colors.surfacePrimary`
- Added `sectionTitleColor` for `30%` opacity section headers

**Animation Removal — All `Animated.View` → plain `View`:**
- Header
- Hero card
- Action buttons row
- Note card
- Tags card
- Details card
- CopyToast component (removed `FadeIn`/`FadeOut` entering/exiting props)

**BlurView Removal:**
- Removed from hero card
- Removed from note card
- Removed from tags card
- Removed from details card
- All replaced with solid surface background

**Section Headers (new):**
- Note, Tags, and Details sections now have standalone `13px/700` uppercase section titles with `30%` opacity above each card
- Previously these were inline `cardTitle` elements inside each card

**Layout Changes:**
- Note card: title "Note" removed from inside card → standalone section header above
- Tags card: title "Tags" removed from inside card → standalone section header above
- Details card: title "Details" removed from inside card → standalone section header above
- Note card in display mode: edit pencil icon now sits in a row alongside the note text

**StyleSheet Changes:**
- `header.paddingHorizontal`: `16` → `24`
- `scrollContent.paddingHorizontal`: `16` → `24`
- Added `sectionTitle` style: `fontSize: 13`, `fontWeight: '700'`, `letterSpacing: 0.8`, `textTransform: 'uppercase'`, `paddingTop: 20`, `paddingBottom: 8`
- `heroCard.borderRadius`: `16` → `20`, removed `borderWidth: 1`
- `actionButton.borderRadius`: `14` → `20`, removed `borderWidth: 1`
- `card.borderRadius`: `16` → `20`, removed `borderWidth: 1`
- `noteInput.borderRadius`: `12` → `14`
- `noteCancelButton.borderRadius`: `10` → `20`, removed `borderWidth: 1`, uses `chipBg` background instead
- `noteSaveButton.borderRadius`: `10` → `20`
- `tagInput.borderRadius`: `10` → `14`
- `toast.borderRadius`: `20` (was already correct)
- Removed unused styles: `infoFooter`, `infoText`, `cardTitle`
- `actionsRow.marginBottom`: `12` → `4` (section title provides top spacing)

## Key Design Decisions
- **Standalone section headers** — Note, Tags, and Details now use the same `13px/700` uppercase section header pattern as settings/wallet, placed above the card rather than inside it.
- **No borders anywhere** — Hero card, action buttons, note/tags/details cards, and cancel button all have `borderWidth` removed.
- **Solid backgrounds** — All `BlurView` glass effects replaced with solid `surfaceBg`.
- **Correct light mode surface** — Both UTXO Management and UTXO Details now use `colors.surfacePrimary` (`#FFFFFF`) in light mode, matching the opaque white cards seen in settings/wallet.
- **No animations** — All `FadeIn`, `FadeInDown`, `FadeOut`, and `Animated.View` removed. Both screens render instantly.

## Unchanged
- All UTXO data loading and management logic
- Freeze/unfreeze functionality
- Lock/unlock functionality
- Note editing and saving
- Tag adding, removing, and presets
- Copy-to-clipboard functionality
- Toast notifications (functional behavior preserved)
- All navigation and data flow

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle `4%` white cards on black
- Hero card: 20px radius, no border, centered status/amount/confirmations
- Action buttons: 20px radius, no border
- Section headers: 13px/700 uppercase, 30% opacity
- Note/Tags/Details cards: 20px radius, no border
- Consistent 24px horizontal padding
- No animations on any element
- No BlurView anywhere
- Freeze/Unfreeze works
- Lock/Unlock works
- Note editing works
- Tags work (add, remove, presets)
- Copy TXID/Address works
- UTXO Management cards now visible in light mode
