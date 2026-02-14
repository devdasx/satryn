# 099 — Data & Backup Premium Redesign

## Overview
Redesigned the Data & Backup hub screen, iCloud Backup management screen, and backup flow chooser to match the established premium design language from `privacy.tsx`.

## Design Changes

### `data-backup.tsx` — Full Redesign
**Before:** Centered header (18px), square-rounded hero rings (borderRadius 24), 3 separate bordered/blurred feature cards, native `Switch`, no animations, bordered orange warning card, hardcoded background colors.

**After:**
- **Header**: Left-aligned back chevron + large bold title (34px, -0.5 tracking) — matches privacy.tsx
- **Hero**: Concentric circular rings (88px outer / 60px inner, borderRadius 44/30), green shield icon, "Protect Your Data" title + subtitle
- **Status badge**: Dynamic pill showing protection state:
  - Both features enabled → green "Fully Protected"
  - One enabled → orange "Partially Protected"
  - Neither → gray "Not Protected"
- **Features section**: Single unified card (borderRadius 20, no border, no BlurView) with 3 rows + hairline dividers:
  - Preserve Data on Delete — 38px orange icon circle + `FastSwitch`
  - iCloud Backup — 38px blue icon circle + inline badge + chevron
  - Restore from iCloud — 38px green icon circle + chevron
- **How It Works section**: Single card with 3 info rows (commitment-style from privacy.tsx)
- **Footer**: Muted centered icon + warning text (replaces bordered orange card)
- **Animations**: FadeIn stagger (50ms hero → 100ms features → 200ms info → 250ms footer)
- **Colors**: `colors.background` instead of hardcoded, proper surfaceBg tokens
- All bottom sheets preserved unchanged (PasswordInputSheet, ArchivalProgressSheet, WalletRestoreSheet, PIN modal)

### `icloud-backup.tsx` — Moderate Redesign
- **Header**: Left-aligned large title (34px) replacing centered header
- **Added hero section**: Blue concentric rings with cloud icon, title, subtitle, backup count badge
- **Cards**: Removed all `BlurView` and `borderWidth: 1` from backup cards, settings card, sheet content
- **Switches**: Replaced native `Switch` with `FastSwitch`
- **Colors**: Updated to standard design tokens (`colors.background`, `surfacePrimary`)
- **Animations**: Added `FadeIn` for hero section and title
- All swipeable actions and 7 bottom sheets preserved unchanged

### `backup-flow.tsx` — Minor Update
- **Icon containers**: Changed from square-rounded (borderRadius 16) to circular (borderRadius 28)
- **Card radius**: Updated from 16 to 20
- **Icon colors**: Changed from neutral gray to colored tints:
  - Manual backup → green (#30D158) shield icon
  - Export → orange (#FF9F0A) document icon
  - iCloud backup → blue (#007AFF) cloud icon

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/data-backup.tsx` | Full visual redesign — header, hero, unified card, FastSwitch, FadeIn animations, footer |
| `app/(auth)/icloud-backup.tsx` | Header + hero + remove BlurView/borders + FastSwitch + design tokens |
| `app/(auth)/backup-flow.tsx` | Circular icon containers + colored tints + updated card radius |

## What Was NOT Changed
- All handler logic, state management, store interactions
- All bottom sheets (AppBottomSheet, PasswordInputSheet, ArchivalProgressSheet, WalletRestoreSheet)
- PIN verification modal
- Other backup screens (backup-manual, backup-icloud, backup-export, backup.tsx) — already well-designed
- Reusable components (WalletBackupSheet, WalletRestoreSheet) — already premium
