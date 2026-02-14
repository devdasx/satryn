# 054 — Addresses Screen Redesign — Match Settings/Wallet Design Language

## Overview
Redesigned the Addresses screen to match the Settings and Wallet tab design language: `borderRadius: 20` section cards with no borders, `36x36px` semantically-tinted circular icon containers, `15px/600` address labels, `hairlineWidth` dividers, `13px/700` uppercase section headers with `30%` opacity, and `24px` horizontal padding. Removed all animations (`FadeIn`, `FadeInDown`) and all `BlurView` glass effects.

## Modified Files

### `app/(auth)/addresses.tsx` — Full addresses screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown` from `react-native-reanimated`

**New: ROLE_ICON_COLORS map** — Semantic tinting for address role icons:
- Receive addresses: green (`#34C759` / `#30D158`) with `10%`/`18%` opacity background
- Change addresses: orange (`#FF9500` / `#FF9F0A`) with `10%`/`18%` opacity background
- Matches the semantic icon tinting pattern from settings (`SETTING_ICON_COLORS`) and wallet (`ICON_COLORS`)

**Address Card → Address Row (complete layout change):**
- Replaced card-based layout (bordered cards with left accent bar, role pill, large address, path, stats row) with compact row-based layout matching ActionRow from the wallet tab
- Each address is now a single row: `36x36` icon circle → address label → balance + chevron
- Icon circle: `36x36px`, `borderRadius: 18` (full circle) with semantic tint
  - Receive: `arrow-down` icon in green circle
  - Change: `swap-horizontal` icon in orange circle
- Icon size: `16px` (matching settings/wallet)
- Address label: `fontSize: 15`, `fontWeight: '600'` (matching ActionRow label style)
- Balance value: `fontSize: 13`, `fontWeight: '500'` (matching ActionRow right-text style), green when non-zero
- Metadata subtitle row: Role · #index · Used · path · tx count — all in `12px/400` muted color
- Role text uses semantic icon color (green for receive, orange for change)
- Chevron: `16px`, `20%` opacity (matching wallet/settings)

**Section Cards:**
- Each section's items wrapped in `borderRadius: 20` card via SectionList `renderItem` wrapper
- First item gets top-left/top-right `borderRadius: 20`
- Last item gets bottom-left/bottom-right `borderRadius: 20`
- Single-item sections get full `borderRadius: 20`
- No `borderWidth` — solid surface background only
- Background: `rgba(255,255,255,0.04)` (dark) / `colors.surfacePrimary` (light)

**Dividers:**
- Replaced `borderTopWidth: 1` stats divider with `hairlineWidth` absolute-positioned divider
- Divider starts at content edge (after 16px padding + 36px icon + 12px gap = 64px from card left) since it's inside the content area with `marginLeft: 12`
- Hidden on last item in each section

**Section Headers:**
- `fontSize`: `12` → `13`
- `fontWeight`: `'600'` → `'700'`
- `letterSpacing`: kept `0.8`
- Added `textTransform: 'uppercase'`
- `paddingTop`: `16` → `20`
- Color: `30%` opacity (matching settings/wallet)

**Header:**
- `paddingHorizontal`: `20` → `24` (matching settings/wallet)
- Header is now a plain `View` — removed `Animated.View` wrapper with `FadeIn`

**Search Bar:**
- Now a plain `View` — removed `Animated.View` wrapper with `FadeInDown`
- `borderRadius`: `12` → `14`

**Empty States:**
- Replaced `Animated.View` with plain `View` — removed `FadeIn` animation

**Filter Bottom Sheet:**
- `filterGroupLabel.fontSize`: `12` → `13`
- `filterGroupLabel.fontWeight`: `'600'` → `'700'`
- `filterApplyButton.borderRadius`: `14` → `20`
- Filter group label color: `30%` opacity (matching section headers)

**Load More Button:**
- `borderRadius`: `12` → `20`
- Background: uses `surfaceBg` (matching card surface)

**Removed Derived Colors:**
- `surfaceBorder` — no longer needed (no borders)
- `orangeColor`, `orangeBg`, `greenBg` — replaced by `ROLE_ICON_COLORS` map

## Key Design Decisions
- **Row-based instead of card-based** — Each address was previously a full card with role pill, large monospace address, path, and a stats row. Now it's a compact row (icon circle + label + value + chevron) matching how the wallet tab's ActionRow works. This dramatically improves information density and scroll performance.
- **Semantic icon tinting** — Green for receive, orange for change. Same pattern as settings (blue/orange/purple per category) and wallet (cyan/purple/orange per action).
- **Section-level cards** — Instead of per-item cards, the entire section is wrapped in a single `borderRadius: 20` card. Items share the card background, separated by `hairlineWidth` dividers.
- **No animations** — All `FadeIn`, `FadeInDown`, and `Animated.View` wrappers removed as requested. Screen renders instantly.
- **No BlurView** — Removed `BlurView` and `Platform` imports. Solid surface backgrounds only.

## Unchanged
- All handler logic, state management, stores
- Stats caching system (AsyncStorage-based)
- Filter bottom sheet functionality
- Address options modal
- Pull-to-refresh and pagination
- Search functionality
- All navigation and data flow

## Verification
- Light mode: white section cards on `#F2F2F7` background, 20px border radius, semantic green/orange icon circles
- Dark mode: subtle `4%` white cards on black, matching icon tints
- Icon circles: 36px with semantic tinting (green for receive, orange for change)
- Labels: 15px/600 across all address rows
- Values: 13px/500 balance on right side, green when non-zero
- Dividers: hairlineWidth between rows within each section card
- Section headers: 13px/700 uppercase, 30% opacity
- Consistent 24px horizontal padding throughout
- No animations on any element
- No BlurView anywhere
- All filters work (role, format, sort)
- Search works
- Pagination works
- Address options modal works
- Pull-to-refresh works
