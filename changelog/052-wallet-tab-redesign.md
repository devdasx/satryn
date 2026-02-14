# 052 — Wallet Tab Redesign — Match Settings Design Language

## Overview
Updated the Wallet tab's 5 sub-components and main screen to match the Settings tab's redesigned design language: `borderRadius: 20` cards with no borders, `36px` semantically-tinted circular icon containers, `15px/600` labels, absolute-positioned dividers at `left: 64`, and `13px/700` uppercase section headers. Removed all `BlurView` glass effects in favor of solid surface backgrounds.

## Modified Files

### `src/components/wallet/WalletCard.tsx` — Card container
- `borderRadius`: `16` → `20`
- Removed `BlurView` (expo-blur) and `Platform` imports
- Removed `borderWidth: 1` and `borderColor` styling
- Background: now `rgba(255,255,255,0.04)` (dark) / `colors.surfacePrimary` (light) — solid fills, no blur
- Removed `marginHorizontal: 16` (now handled by parent scroll's 24px padding)
- Kept `overflow: 'hidden'`, `noPadding` prop, and `padding: 4` behavior

### `src/components/wallet/ActionRow.tsx` — Interactive row component
- **ICON_COLORS map**: New semantic tinting for wallet action icons:
  - `layers-outline` (Addresses) → cyan (`#5AC8FA` / `#64D2FF`)
  - `cube-outline` (UTXOs) → purple (`#AF52DE` / `#BF5AF2`)
  - `key-outline` (XPub) → orange (`#FF9500` / `#FF9F0A`)
  - `code-slash-outline` (Descriptors) → gray (`#8E8E93`)
  - `document-text-outline` (Export) → orange (`#FF9500` / `#FF9F0A`)
  - `shield-checkmark-outline` (Recovery) → green (`#34C759` / `#30D158`)
- Icon container: `32×32px borderRadius: 8` → `36×36px borderRadius: 18` (full circle)
- Icon size: `18px` → `16px`
- Label: `fontSize: 16 fontWeight: 500` → `fontSize: 15 fontWeight: 600`
- Right text: `fontSize: 14 fontWeight: 400` → `fontSize: 13 fontWeight: 500`
- Divider: `left: 60` → `left: 64` (16px padding + 36px icon + 12px gap)
- Variant system preserved (default/protected/danger) — variant overrides take priority over ICON_COLORS

### `src/components/wallet/SectionHeader.tsx` — Section title
- `fontSize`: `11` → `13`
- `fontWeight`: `'600'` → `'700'`
- `letterSpacing`: added `0.8`
- `textTransform`: added `'uppercase'`
- `paddingHorizontal`: `20` → `4` (now inside 24px scroll padding)
- Default `marginTop` prop: `24` → `20`
- Color opacity: `35%` → `30%` (matching settings)

### `src/components/wallet/SecurityBanner.tsx` — Backup warning banner
- `borderRadius`: `14` → `20`
- Removed `borderWidth: 1` and `borderColor` from container style
- Removed `border` property from COLORS config object
- Icon container `borderRadius`: `10` → `18` (full circle)
- Removed `marginHorizontal: 16` (now inside padded scroll)

### `src/components/wallet/WalletHeader.tsx` — Wallet identity header
- Removed `paddingHorizontal: 16` from container (now handled by parent's 24px scroll padding)
- Avatar stays `44×44` with `borderRadius: 14` (distinct element, not an icon row)

### `app/(auth)/(tabs)/wallet.tsx` — Main wallet screen
- `scrollContent.paddingHorizontal`: `0` → `24` (uniform padding, cards are full-width inside)
- `dangerSection.marginHorizontal`: `16` → `0` (inherits from scroll padding)
- `removeButton.borderRadius`: `14` → `20`
- Removed `removeButton.borderWidth: 1` and inline `borderColor`
- `exportOptionIcon.borderRadius`: `10` → `18` (circular, matching design language)
- All `SectionHeader` `marginTop` values set to `20`
- Removed unused imports: `BlurView` (expo-blur), `Platform`, `Animated`/`FadeIn` (react-native-reanimated)

## Key Design Decisions
- **Margin strategy change** — Previously each card/component managed its own `marginHorizontal: 16`. Now the scroll container provides `paddingHorizontal: 24` and components have zero margin. Consistent with how the settings tab works.
- **Semantic icon tinting** — ActionRow has a `variant` prop (default/protected/danger). Variant overrides take priority over the ICON_COLORS map; the map is used for default variant only.
- **No blur anywhere** — All `BlurView` references removed from wallet components. Solid surface backgrounds only.

## Unchanged
- WalletHeader avatar (44×44, borderRadius 14 — distinct from icon rows)
- DetailsGrid (already matched: 10px/600 labels, 13px/500 values)
- All handler logic, state management, stores
- All bottom sheets (Rename, Avatar, Export, Wallet Info, Wallet Switcher)
- All navigation routes

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle glass cards on black, 20px border radius
- Icon circles: 36px with semantic tinting (cyan for addresses, purple for UTXOs, etc.)
- Labels: 15px/600 weight across all ActionRows
- Dividers: aligned at 64px from left
- Section headers: 13px/700 uppercase
- SecurityBanner: circular icon, no border, 20px radius
- Remove button: 20px radius, no border
- Consistent 24px horizontal padding throughout
- All navigation works (Addresses, UTXOs, XPub, Descriptors, Export, Recovery)
- All bottom sheets work
- Wallet switching works
- Remove wallet flow works
