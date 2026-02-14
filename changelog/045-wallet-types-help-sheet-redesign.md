# 045 — Wallet Types Help Sheet Redesign

## Overview
Complete redesign of the Wallet Types help sheet (HelpSheet) in the wallet hub. Replaced the old list layout with a premium card-based design using LinearGradient accent bars and `sizing="auto"`.

## Modified Files

### `src/components/wallet-hub/HelpSheet.tsx`
- Complete rewrite with premium card-based layout
- Each wallet type rendered as a glass card with colored gradient accent bar on the left
- Cards include: icon, title, description, and subtle border
- Uses LinearGradient from expo-linear-gradient for accent colors
- AppBottomSheet with `sizing="auto"` for native height
- Removed old list-style layout and bottom padding issues
- Color-coded by type: orange (HD), blue (Watch-only), purple (Multisig), green (Simple)

## Verification
- `npx tsc --noEmit` — zero errors
