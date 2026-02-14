# 065 — Wallet Removal Sheet, Database Auth Gate, Skip-to-App Flow

## Overview
Replaced the basic Alert dialog wallet removal with a premium step-based removal sheet (PIN/FaceID verification, balance confirmation for funded wallets, stay-vs-reset for last wallet). Added Face ID / PIN authentication gate to the Database Viewer screen. Changed the Skip button on onboarding to navigate to PIN creation and then directly into the app with empty states.

## Changes

### New File: `src/components/wallet/WalletRemovalSheet.tsx`
Premium step-based wallet removal bottom sheet with 4 steps:
1. **Verify identity** — Face ID / Touch ID authentication
2. **Confirm balance** — If wallet has funds, user must type the exact balance in sats to confirm
3. **Removing wallet data** — Deletes keys, cache, avatar, wallet file, and multi-wallet entry
4. **Complete** — Success state

- Animated trash icon with glow/pulse during removal
- For last wallet: shows "Stay in App" vs "Reset All Data" choice instead of auto-navigating to onboarding
- Step rows with animated indicators (pending → active → completed → failed)
- Error handling with retry/cancel buttons
- Follows ArchivalProgressSheet design patterns

### `src/components/wallet/index.ts`
- Added `WalletRemovalSheet` export

### `app/(auth)/(tabs)/wallet.tsx` — Use new removal sheet
- Replaced `handleRemoveWallet` / `confirmRemoveWallet` / `executeRemoveWallet` (3 functions with nested Alert dialogs) with single handler that opens `WalletRemovalSheet`
- Added `showRemovalSheet` state and `handleRemovalComplete` callback
- `handleRemovalComplete('stay')` keeps user in app with empty states
- `handleRemovalComplete('reset')` clears all data via `SecureStorage.deleteWallet()` and navigates to onboarding
- Removed unused imports: `SecureStorage`, `WalletFileService`, `removeWallet` from store

### `app/(auth)/database-viewer.tsx` — Face ID / PIN gate
- Added authentication check on mount using `expo-local-authentication`
- Shows lock icon + "Authenticating..." while verifying identity
- If auth fails: shows "Authentication Failed" with "Try Again" button
- If user cancels biometric prompt: navigates back
- If no biometric hardware: falls through (app already requires PIN to enter auth group)
- Added `SecureStorage` and `LocalAuthentication` imports

### `app/(onboarding)/index.tsx` — Skip button → PIN creation
- Changed Skip button from navigating to `/(onboarding)/create` to navigating to `/(onboarding)/pin` with `skipMode: 'true'` param

### `app/(onboarding)/pin.tsx` — Skip mode support
- Added `skipMode` param to search params
- When `isSkipMode`: after PIN creation, stores PIN hash via `SecureStorage.storePin()`, sets `hasPinSet: true` in walletStore, and navigates directly to `/(auth)` — no wallet setup needed
- Added `useWalletStore` import

### `src/services/storage/SecureStorage.ts` — New `storePin()` method
- Added `storePin(pin)`: creates salt + PIN hash in Keychain without storing any seed
- Used by skip mode flow where user creates a PIN but skips wallet creation

### `src/stores/walletStore.ts` — New `hasPinSet` state
- Added `hasPinSet: boolean` to `WalletState` interface
- Initial value: `false`
- Set to `true` during `initialize()` based on `SecureStorage.hasPinSet()`
- Not persisted (derived from Keychain at init time)

### `app/index.tsx` — Route based on PIN state
- When `!walletId && hasPinSet`: redirect to `/(auth)` with empty states instead of onboarding
- This handles both skip-mode users and users who removed their last wallet with "stay in app"

## Wallet Type Support Matrix (unchanged — all 11 types supported)

| Type | Removal Sheet |
|------|--------------|
| All 11 wallet types | Yes — type-agnostic removal via `SecureStorage.deleteWalletData()` |
