# 049 — Settings Cleanup & Debug Removal

## Overview
Removed Manage Wallets and Contacts rows from the Settings WALLET section, removed all debug UI from the app (settings rows, screens, bottom sheets), and updated the About screen with app logos, expanded tech stack, and expanded features.

## Modified Files

### `app/(auth)/(tabs)/settings.tsx`
- Removed "Manage Wallets" and "Contacts" rows from WALLET section (screens remain accessible via wallet hub and contacts tab)
- Removed "Debug Logs" and "Database Viewer" rows from ADVANCED section
- Removed corresponding search entries from `allSettings` array
- Fixed `isLast` prop on "Broadcast Transaction" row (now last in ADVANCED)
- WALLET section now only contains: Wallet Mode, Address Gap Limit
- ADVANCED section now only contains: Electrum Server, Broadcast Transaction

### `app/(auth)/transaction-details.tsx`
- Removed "Debug Info" button from action buttons area
- Removed `DebugPacketSheet` import, state, and render
- Removed `debugText` computation block

### `src/components/send-v3/index.ts`
- Removed `DebugPacketSheet` export

### `app/(auth)/about.tsx`
- Hero: replaced Ionicons bitcoin icon with actual app logos (`appLogo.png` in light, `darkLogo.png` in dark mode)
- Tech Stack: expanded from 8 to 15 items (added React Native Reanimated, expo-sqlite, react-native-true-sheet, Nearby Connections, expo-camera, expo-blur, @bitcoinerlab/secp256k1)
- Features: expanded from 11 to 24 items with color-coded categories (wallet, send, security, network, data, ux)
- Added feature category legend with colored dots below the features list
- Added section item counts (e.g., "TECH STACK — 15")
- Added footer divider line for premium finish
- Feature dots color-coded: blue (wallet), green (send), orange (security), purple (network), cyan (data), pink (ux)

## Deleted Files

### `app/(auth)/debug-logs.tsx`
- Debug logs screen — removed entirely

### `app/(auth)/database-viewer.tsx`
- Database viewer screen — removed entirely

### `src/components/send-v3/sheets/DebugPacketSheet.tsx`
- Debug packet bottom sheet component — removed entirely

## Verification
- `npx tsc --noEmit` — zero errors
- Settings screen: WALLET section shows only Wallet Mode and Gap Limit
- Settings screen: ADVANCED section shows only Electrum Server and Broadcast
- Transaction details: no Debug Info button
- About screen: shows app logos, 15 tech stack items, 24 color-coded features
