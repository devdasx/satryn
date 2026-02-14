# 055 — Transaction Details Screen Redesign — Match Settings/Wallet Design Language

## Overview
Redesigned the Transaction Details screen to match the Settings and Wallet tab design language: `borderRadius: 20` section cards with no borders, `36x36px` circular icon containers with `borderRadius: 18`, `hairlineWidth` dividers, `13px/700` uppercase section headers with `30%` opacity, and `24px` horizontal padding. Removed all animations (`FadeIn`, `FadeInDown`, `FadeOut`, `Animated.View`) and all `BlurView` glass effects.

## Modified Files

### `app/(auth)/transaction-details.tsx` — Full transaction details screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown`, `FadeOut` from `react-native-reanimated`

**CopyToast:**
- `Animated.View` → plain `View`
- Removed `entering={FadeIn}` and `exiting={FadeOut}` animation props

**Derived Colors:**
- Removed `surfaceBorder` variable (no longer needed — no borders)
- Updated `surfaceBg` light value to `colors.surfacePrimary` (matching settings/wallet)

**Section Labels:**
- Color updated to `30%` opacity: `isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)'`
- Added `textTransform: 'uppercase'` via StyleSheet

**Animation Removal — All `Animated.View` → plain `View`:**
- Hero section (direction icon + amount + status)
- Metrics card (confirmations, fee, size, vsize)
- Primary action buttons (View on Explorer, Copy TXID)
- Fee bump action buttons (RBF, CPFP)
- Details section (date, block, type, RBF)
- Notes & tags section
- Inputs section
- Outputs section
- TXID section

**BlurView Removal:**
- Removed from metrics card container
- Removed from details card container
- Removed from inputs/outputs card containers
- Removed from TXID card container
- All replaced with solid surface background

**Icon Sizes:**
- Direction icon: `18px` → `16px` (matching design language)
- Input/Output icons: `14px` → `16px` (matching design language)

**TxNoteEditor Integration:**
- `surfaceBorder` prop changed to `'transparent'` to maintain type contract while removing visible borders

**StyleSheet Changes:**
- `scrollContent.paddingHorizontal`: `16` → `24`
- `directionIcon`: `32×32` → `36×36`, `borderRadius: 16` → `18` (full circle)
- `metricsCard.borderRadius`: `18` → `20`, removed `borderWidth`
- `primaryButton.borderRadius`: `16` → `20`
- `secondaryButton.borderRadius`: `16` → `20`, removed `borderWidth`
- `card.borderRadius`: `18` → `20`, removed `borderWidth`
- `ioIcon`: `28×28` → `36×36`, `borderRadius: 8` → `18` (full circle)
- `txidCopyButton.borderRadius`: `10` → `18`
- `sectionLabel`: added `textTransform: 'uppercase'`

## Key Design Decisions
- **Solid backgrounds only** — All `BlurView` glass effects replaced with solid `surfaceBg` fills matching the settings/wallet design language.
- **Circular icon containers** — Both the direction icon (36×36) and I/O icons (36×36) use full `borderRadius: 18` circles, matching ActionRow from the wallet tab.
- **30% opacity section headers** — All section labels (Details, Notes & Tags, Inputs, Outputs, Transaction ID) use 30% opacity uppercase text.
- **No animations** — All `FadeIn`, `FadeInDown`, `FadeOut`, and `Animated.View` wrappers removed. Screen renders instantly.
- **TxNoteEditor compatibility** — The component's `surfaceBorder` color prop receives `'transparent'` to maintain the interface contract while eliminating visible borders.

## Unchanged
- All transaction logic (fee bumping, RBF, CPFP)
- PIN verification flow
- Copy-to-clipboard functionality
- Status detection and display
- Confirmations tracking
- Input/output rendering logic
- Notes and tags editing
- All navigation and data flow

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white section cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle `4%` white cards on black
- Icon circles: 36px with `borderRadius: 18`
- Section labels: uppercase, 30% opacity
- Consistent 24px horizontal padding throughout
- No animations on any element
- No BlurView anywhere
- Fee bumping (RBF/CPFP) works
- Copy TXID works
- View on Explorer works
- Notes editing works
- All status indicators display correctly
