# 056 — Output Descriptors Screen Redesign — Match Settings/Wallet Design Language

## Overview
Redesigned the Output Descriptors screen to match the Settings and Wallet tab design language: `borderRadius: 20` cards with no borders (`borderWidth: 0`), `36x36px` circular icon containers with `borderRadius: 18`, updated typography (`15px/600` labels, `13px/700` uppercase section headers with `30%` opacity), `14`/`12` segmented control radii, and `24px` horizontal padding. Removed all animations (`FadeIn`, `FadeInDown`, `Animated.View`) and all `BlurView` glass effects.

## Modified Files

### `app/(auth)/descriptors.tsx` — Full descriptors screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown` from `react-native-reanimated`

**Removed Derived Colors:**
- `surfaceBorder` — no longer needed (no borders)

**renderCard Helper:**
- Removed `BlurView` component and all glass-related props
- Removed `borderColor: surfaceBorder` from card style
- Cards now use solid surface background only

**renderSectionTitle:**
- Color updated to `30%` opacity: `isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)'`

**Segmented Control:**
- `Animated.View` → plain `View` (removed animation wrapper)

**Animation Removal — All `Animated.View` → plain `View`:**
- Segmented control container
- All card wrappers in multisig view (external descriptor, internal descriptor, cosigners)
- All card wrappers in single-sig view (external descriptor, internal descriptor)
- All entering animation props removed

**Cosigner Dividers:**
- `borderBottomColor` changed from `surfaceBorder` to explicit `isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'`

**StyleSheet Changes:**
- `header.paddingHorizontal`: `16` → `24`
- `scrollContent.paddingHorizontal`: `16` → `24`
- `card.borderRadius`: `16` → `20`, `borderWidth`: `1` → `0`
- `sectionTitle.fontWeight`: `'500'` → `'700'`
- `sectionTitle.letterSpacing`: `0.5` → `0.8`
- `sectionTitle.paddingTop`: `4` → `20`
- `sectionTitle`: added `textTransform: 'uppercase'`
- `segmented.borderRadius`: `12` → `14`, `padding`: `3` → `4`
- `segmentTab.borderRadius`: `10` → `12`
- `actionBtn.borderRadius`: `10` → `18` (full circle)
- `iconContainer`: `32×32` → `36×36`, `borderRadius: 8` → `18` (full circle)
- `primaryLabel.fontWeight`: `'500'` → `'600'`
- `secondaryLabel.fontWeight`: `'400'` → `'600'`

## Key Design Decisions
- **No borders on cards** — `borderWidth` set to `0`, removing all visible card borders. Cards rely on subtle background fill against the page background for visual separation.
- **Circular icon containers** — Action button icons now use `36×36` circles with `borderRadius: 18`, matching the wallet tab's ActionRow.
- **Updated segmented control** — Outer container `borderRadius: 14` with `padding: 4`, inner tabs `borderRadius: 12`, matching the refined proportions from the design language.
- **Uppercase section headers** — All section titles use `13px/700` uppercase text with `0.8` letter-spacing and `30%` opacity.
- **No animations** — All `FadeIn`, `FadeInDown`, and `Animated.View` wrappers removed. Screen renders instantly.
- **No BlurView** — All glass effects replaced with solid surface backgrounds.

## Unchanged
- All descriptor logic and data fetching
- PIN authentication flow
- Multisig vs single-sig detection
- Copy-to-clipboard functionality
- QR code display
- Cosigner information display
- All navigation and data flow

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle `4%` white cards on black
- Icon circles: 36px with `borderRadius: 18`
- Section headers: 13px/700 uppercase, 30% opacity
- Segmented control: 14px outer radius, 12px tab radius
- Consistent 24px horizontal padding
- No animations on any element
- No BlurView anywhere
- PIN auth works
- Copy descriptor works
- QR display works
- Multisig cosigner view works
- Single-sig view works
