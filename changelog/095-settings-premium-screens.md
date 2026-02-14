# 095 — Premium Settings Screens (5 Sheets → Full Pages)

## Overview
Replaced 5 bottom-sheet settings panels with full premium screens. Each screen follows the established design language from Privacy & Analytics: hero section with concentric icon rings, status badges, option cards with colored icons, explanation sections, and staggered FadeIn animations.

## Design Language
Every screen shares the same anatomy:
1. **Header** — Back chevron + large bold title (34px, -0.5 tracking)
2. **Hero section** — Concentric ring icon (88→60px), title, subtitle, status badge showing current value
3. **Option cards** — Rounded cards (20px radius) with icon circles, title, subtitle, description, checkmark for selected
4. **Info section** — Grouped rows with colored icons explaining concepts
5. **Footer** — Muted info icon + contextual note
6. **Animations** — Reanimated `FadeIn` with staggered delays (50ms increments)

## Screens Created

### `app/(auth)/appearance.tsx`
- Theme selection: Auto (System), Light, Dark
- Hero with blue accent (#007AFF), status badge shows current theme name
- Three theme preview cards with mini phone mockups (dark/light gradient previews)
- "About Each Option" section explaining adaptive contrast, battery efficiency
- "Design Features" section: Adaptive Contrast, Battery Friendly, Consistent Design

### `app/(auth)/display-unit.tsx`
- BTC vs Satoshis toggle
- Hero with orange accent (#FF9F0A), status badge shows "BTC Mode" or "Satoshis Mode"
- Two option cards with examples: "0.00100000 BTC" vs "100,000 sats"
- "Good To Know" section: Conversion Rate, Instant Conversion, Applied Everywhere

### `app/(auth)/local-currency.tsx`
- Searchable currency list (60+ currencies)
- Header with current selection badge + search bar
- FlatList rendering: flag emoji, currency code, symbol badge, full name
- Search filters by code and name (case-insensitive)
- Dual store update: settingsStore.setCurrency + priceStore.setCurrency

### `app/(auth)/default-fee.tsx`
- Fee presets: Fast (~10 min), Medium (~30 min), Economy (~1 hour), Custom
- Hero with blue accent, status badge shows current fee label
- Inline custom fee input card (appears when Custom selected) with TextInput + save button
- Validation: 1–1000 sat/vB range
- "How It Works" section: Block Space, Dynamic Estimation, Per-Transaction Override

### `app/(auth)/gap-limit.tsx`
- Gap limit options: 20, 50, 100, 200 (from DERIVATION.GAP_LIMIT_OPTIONS)
- Hero with blue accent, status badge shows current gap limit
- Option cards with color-coded risk: green (20), blue (50/100), red (200)
- "Understanding Gap Limits" section: What is a Gap Limit, Address Discovery, Sync Speed Trade-off, When to Increase

## Settings Screen Changes
- Removed 7 state variables: `showThemeSheet`, `showDenominationSheet`, `showCurrencyPicker`, `currencySearch`, `showFeeSheet`, `showCustomFeeSheet`, `showGapLimitSheet`
- Removed `customFeeInput` state and `filteredCurrencies` memo
- Removed CURRENCIES array (~75 entries, moved to local-currency.tsx)
- Changed 5 handlers to use `router.push()` instead of opening sheets
- Removed all 6 sheet JSX blocks (Theme, Display Unit, Currency, Fee, Custom Fee, Gap Limit)
- Removed unused imports: SheetSearchBar, SheetFormInput, SheetPrimaryButton, SheetSectionFooter, FeePreference
- Removed ~30 unused styles

## Auth Layout
- Registered 5 new Stack.Screen entries: appearance, display-unit, local-currency, default-fee, gap-limit

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/appearance.tsx` | New — theme selection screen |
| `app/(auth)/display-unit.tsx` | New — BTC/sats selection screen |
| `app/(auth)/local-currency.tsx` | New — searchable currency picker screen |
| `app/(auth)/default-fee.tsx` | New — fee preset selection screen |
| `app/(auth)/gap-limit.tsx` | New — gap limit selection screen |
| `app/(auth)/(tabs)/settings.tsx` | Removed 5 sheets, state, handlers, styles; added router navigation |
| `app/(auth)/_layout.tsx` | Registered 5 new Stack.Screen entries |
