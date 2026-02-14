# 053 — Wallet Mode Page — Bottom Sheet to Full Page

## Overview
Converted the Wallet Mode bottom sheet into a dedicated full-screen settings detail page with mode selection cards and a side-by-side comparison table. The new page matches the settings design language (`borderRadius: 20` cards, semantic icons, `13px/700` uppercase section headers) and provides a comprehensive visual comparison of HD Wallet vs Simple Wallet across 6 dimensions.

## New Files

### `app/(auth)/wallet-mode.tsx` — Wallet Mode detail page
Full standalone page replacing the previous bottom sheet. Features:

- **Header**: Back button + "Wallet Mode" centered title (matching electrum-server.tsx / about.tsx pattern)
- **Current Mode section**: Two mode options inside a `borderRadius: 20` card
  - HD Wallet: purple icon (`git-branch-outline`), "New address for each transaction (recommended)"
  - Simple Wallet: orange icon (`key-outline`), "Reuse same address"
  - Selected mode shows a green checkmark circle
  - Spring animation on press (`scale: 0.98`)
  - Divider at `left: 64` between options
- **Comparison section**: Side-by-side table inside a `borderRadius: 20` card
  - Column headers: "HD Wallet" (purple tint) and "Simple" (orange tint)
  - 6 comparison rows: Privacy, Addresses, Change, Gap Limit, Complexity, Best For
  - Active/selected column gets a subtle background highlight tint
  - Green checkmark icons on favorable values (e.g., "High" privacy for HD)
  - Row labels in `13px/400` muted color, values in `13px/600`
  - `hairlineWidth` dividers between rows
- **Footer**: Explanatory paragraph about BIP44 HD wallets vs simple mode use cases
- **Design tokens**: `colors.background`, `surfacePrimary`, 24px horizontal padding, 13px/700 uppercase section headers

### Components used:
- `ModeOption` — Inline component for each selectable mode row with animated press, icon circle, label, description, checkmark
- Comparison table rendered as flat `View` rows with 3-column layout

## Modified Files

### `app/(auth)/(tabs)/settings.tsx` — Settings screen
- Wallet Mode row `onPress`: changed from `() => setShowWalletModeSheet(true)` to `router.push('/(auth)/wallet-mode')`
- Removed `showWalletModeSheet` state variable
- Removed `handleSelectWalletMode` handler function
- Removed the entire `<AppBottomSheet visible={showWalletModeSheet}>` block (was ~24 lines)
- Removed unused `WalletMode` type import

### `app/(auth)/_layout.tsx` — Route definitions
- Added `<Stack.Screen name="wallet-mode" />` in the settings section

## Comparison Table Data

| Dimension | HD Wallet | Simple |
|---|---|---|
| Privacy | High (checkmark) | Low |
| Addresses | New each time (checkmark) | Single reused |
| Change | Separate output (checkmark) | Same address |
| Gap Limit | Configurable (checkmark) | N/A |
| Complexity | Standard | Minimal (checkmark) |
| Best For | Daily use | Donations, tips |

## Verification
- `npx tsc --noEmit` — zero errors
- Settings → Wallet Mode row navigates to new page (slide from right)
- Swipe-back gesture returns to settings
- Page shows current mode with green checkmark
- Tapping other mode switches selection + haptic feedback
- Comparison table renders correctly with column highlighting for selected mode
- Green checkmark icons on favorable values
- Light mode: white cards on #F2F2F7, correct typography
- Dark mode: subtle cards on black, correct tinting
- Mode selection persists (stored in settingsStore)
