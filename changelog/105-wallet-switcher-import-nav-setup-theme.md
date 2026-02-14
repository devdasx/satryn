# Changelog 105 — Wallet Switcher Redesign, Import Navigation Fix, Setup Theme

## Changes

### 1. Wallet Switcher Sheet Redesign

**File:** `src/components/wallet/WalletSwitcherSheet.tsx`

Completely redesigned the wallet switcher bottom sheet with a premium design language:

- **Type-colored icons**: Green for HD wallets, orange for imported keys, purple for multisig, blue for watch-only
- **Active wallet indicator**: Small green dot on the current wallet's icon circle
- **List card**: Rounded card container (`borderRadius: 20`) with hairline dividers between rows
- **Staggered animations**: FadeIn animations per row with staggered delay
- **Scrollable**: ScrollView enabled when more than 5 wallets, auto-height when fewer
- **Bottom-pinned button**: "Add Wallet" button with plus icon always visible at the bottom
- **Custom grabber bar**: 36px grabber at the top of the sheet
- **Wallet names shown as-is**: No forced uppercase transformation
- **Chevron indicators**: Non-active wallets show a chevron arrow

### 2. Import WIF/xprv Navigation Fix

**File:** `app/(onboarding)/import.tsx`

**Problem:** When importing a WIF private key, xprv, or seed bytes with a cached PIN, the app navigated directly to the portfolio screen (`/(tabs)`) — skipping the wallet setup animation screen entirely.

**Fix:** The `importWithPin()` helper now routes through `/(onboarding)/setup` when a cached PIN exists, passing all import params. The setup screen already handles WIF, xprv, and seed byte imports with their own status sequences and wallet creation logic.

**Before:** `importWithPin()` → `doImport(cachedPin)` → `router.replace('/(tabs)')`
**After:** `importWithPin()` → `router.replace('/(onboarding)/setup', { pin, ...importParams })`

### 3. Setup Screen Theme Support

**File:** `app/(onboarding)/setup.tsx`

**Problem:** The setup screen had hardcoded dark theme colors (`#000000` background, `#FFFFFF` text, white buttons with black text), making it always dark regardless of the app's theme setting.

**Fix:** Added `useTheme()` hook and replaced all hardcoded colors with theme tokens:

- Container background: `colors.background`
- Main text: `colors.text`
- Subtitle text: `colors.textTertiary`
- Error text: `colors.error`
- Reassurance text: `colors.textDisabled`
- Icon colors: `colors.success`, `colors.error`, `colors.textSecondary`
- Icon background: `colors.glass` + `colors.border`
- Ring segment: `colors.textTertiary`
- Primary button: `colors.text` background, `colors.background` text (auto-inverts)
- Secondary button text: `colors.textTertiary`
- StatusBar: `isDark ? 'light' : 'dark'`

## Files Modified

| File | Change |
|------|--------|
| `src/components/wallet/WalletSwitcherSheet.tsx` | Full redesign with premium design language |
| `app/(onboarding)/import.tsx` | Route WIF/xprv/seed imports through setup screen when cached PIN exists |
| `app/(onboarding)/setup.tsx` | Added `useTheme()` hook, replaced all hardcoded colors with theme tokens |

## Verification

1. `npx tsc --noEmit` — 0 new errors (1 pre-existing in KeySection.tsx)
2. Wallet switcher shows type-colored icons, active indicator, staggered animations
3. Import WIF/xprv → shows setup animation screen before entering portfolio
4. Setup screen respects dark/light mode setting
5. Buttons auto-invert colors based on theme (white-on-black in dark, black-on-white in light)
