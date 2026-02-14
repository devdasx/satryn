# 057 — Extended Public Keys Screen Redesign — Match Settings/Wallet Design Language

## Overview
Redesigned the Extended Public Keys (XPub) screen to match the Settings and Wallet tab design language: `borderRadius: 20` cards with no borders (`borderWidth: 0`), `36x36px` circular icon containers with `borderRadius: 18`, updated typography (`15px/600` labels, `13px/700` uppercase section headers with `30%` opacity), `14`/`12` segmented control radii, and `24px` horizontal padding. Removed all animations (`FadeIn`, `FadeInDown`, `Animated.View`) and all `BlurView` glass effects.

## Modified Files

### `app/(auth)/xpub.tsx` — Full extended public keys screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown` from `react-native-reanimated`

**Removed/Updated Derived Colors:**
- Removed `surfaceBorder` — no longer needed (no borders)
- Updated `surfaceBg` light value to `colors.surfacePrimary`
- Added `sectionTitleColor` computed as `30%` opacity

**renderCard Helper:**
- Removed `BlurView` component and all glass-related props
- Removed `borderColor: surfaceBorder` from card style
- Cards now use solid surface background only

**Descriptors Link Card:**
- Removed `BlurView` and `Platform` check
- Removed `borderColor` styling
- Icon size: `18px` → `16px` (matching design language)

**Animation Removal — 16 `Animated.View` instances → plain `View`:**
- Header section
- Segmented control
- QR card (single-sig)
- Format details card
- Action buttons row
- Descriptors link card
- All multisig view wrappers (QR card, cosigner cards, format details, actions, descriptors link)
- Warning card
- All entering animation props removed

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
- `warningCard.borderRadius`: `16` → `20`

## Key Design Decisions
- **No borders on cards** — `borderWidth` set to `0` across all cards including QR display, format details, and warning cards. Subtle background fill provides visual separation.
- **Circular icon containers** — Action icons (copy, share, QR) use `36×36` circles with `borderRadius: 18`.
- **Descriptors link styling** — The "View Output Descriptors" link card matches the same borderless, solid-background pattern. Icon reduced to `16px`.
- **Warning card consistency** — The multisig "never share" warning card updated to `borderRadius: 20` matching all other cards.
- **30% opacity section titles** — Dedicated `sectionTitleColor` variable for consistent section header styling.
- **No animations** — All 16 `Animated.View` wrappers and entering props removed. Screen renders instantly.
- **No BlurView** — All glass effects replaced with solid surface backgrounds.

## Unchanged
- All XPub data fetching and derivation logic
- PIN authentication flow
- QR code generation and display
- Multisig vs single-sig detection
- Copy-to-clipboard functionality
- Share functionality
- Cosigner XPub display
- Format toggling (xpub/ypub/zpub)
- All navigation and data flow

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle `4%` white cards on black
- Icon circles: 36px with `borderRadius: 18`
- Section headers: 13px/700 uppercase, 30% opacity
- Segmented control: 14px outer radius, 12px tab radius
- Warning card: 20px border radius
- Consistent 24px horizontal padding
- No animations on any element
- No BlurView anywhere
- PIN auth works
- QR code displays correctly
- Copy XPub works
- Share XPub works
- Format switching works
- Multisig cosigner view works
- Descriptors link navigation works
