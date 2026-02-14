# 058 — UTXO Management Screen Redesign — Match Settings/Wallet Design Language

## Overview
Redesigned the UTXO Management screen to match the Settings and Wallet tab design language: `borderRadius: 20` cards with no borders, `borderRadius: 14` search bar, `borderRadius: 18` sort/filter buttons, and `24px` horizontal padding. Removed all animations (`FadeIn`, `FadeInDown`, `Animated.View`) and all `BlurView` glass effects. Cleaned up unused imports (`useRef`, `ActivityIndicator`).

## Modified Files

### `app/(auth)/utxo-management.tsx` — Full UTXO management screen redesign

**Removed Imports:**
- `BlurView` from `expo-blur`
- `Platform` from `react-native`
- `Animated`, `FadeIn`, `FadeInDown` from `react-native-reanimated`
- `useRef` from `react` (unused after animation removal)
- `ActivityIndicator` from `react-native` (unused)

**Removed Derived Colors:**
- `surfaceBorder` — no longer needed (no borders)
- Removed from all inline styles and `renderUtxo` dependency array

**Animation Removal — All `Animated.View` → plain `View`:**
- Header section
- Summary card
- Search bar container
- Filter/sort row
- Empty state (no UTXOs)
- Empty state (no search results)
- All entering animation props removed

**BlurView Removal:**
- Removed from summary card container
- Removed from each UTXO card in `renderUtxo`
- All replaced with solid surface background

**StyleSheet Changes:**
- `header.paddingHorizontal`: `16` → `24`
- `listContent.paddingHorizontal`: `16` → `24`
- `summaryCard.borderRadius`: `16` → `20`, removed `borderWidth: 1`
- `utxoCard.borderRadius`: `16` → `20`, removed `borderWidth: 1`
- `searchBar.borderRadius`: `12` → `14`
- `sortButton.borderRadius`: `10` → `18` (circular)
- `sortOption.borderRadius`: `12` → `20`

**Inline Style Cleanup:**
- Removed `borderColor: surfaceBorder` from summary card inline style
- Removed `borderColor: surfaceBorder` from UTXO card inline styles
- Removed `surfaceBorder` from `renderUtxo` `useCallback` dependency array

## Key Design Decisions
- **No borders on cards** — Both summary card and individual UTXO cards have `borderWidth` removed. Visual separation comes from subtle background fill on contrasting page background.
- **Circular sort/filter buttons** — Sort button `borderRadius` increased to `18` for a pill/circular appearance matching the design language.
- **Search bar refinement** — `borderRadius: 14` matching the addresses screen search bar.
- **Sort option pills** — `borderRadius: 20` matching the card radius for consistency.
- **Unused import cleanup** — `useRef` and `ActivityIndicator` were only needed for animation patterns; removed after animation removal.
- **No animations** — All `FadeIn`, `FadeInDown`, and `Animated.View` wrappers removed. Screen renders instantly.
- **No BlurView** — All glass effects replaced with solid surface backgrounds.

## Unchanged
- All UTXO fetching and display logic
- Search functionality
- Filter system (status, size, age)
- Sort functionality (value, age, confirmations)
- UTXO selection for coin control
- FlatList rendering and pagination
- Pull-to-refresh
- Summary statistics calculation
- All navigation and data flow

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius
- Dark mode: subtle `4%` white cards on black
- Summary card: 20px radius, no border
- UTXO cards: 20px radius, no border
- Search bar: 14px radius
- Sort button: 18px radius (circular)
- Consistent 24px horizontal padding
- No animations on any element
- No BlurView anywhere
- Search works
- Filters work (status, size, age)
- Sorting works (value, age, confirmations)
- UTXO selection works
- Pull-to-refresh works
- Empty states display correctly
