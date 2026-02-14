# 064 — Remove expo-notifications, Loading Screen, and Wallet Type Backup Gaps

## Overview
Removed the `expo-notifications` package that was causing a native module crash (`Cannot find native module 'ExpoPushTokenManager'`), replaced the Bitcoin logo loading screen with a blank view (native splash handles the transition), fixed preserve data cleanup on disable, and added backup support for 3 missing wallet types.

## Changes

### `app/_layout.tsx` — Remove expo-notifications
- Removed `import * as Notifications from 'expo-notifications'`
- Removed `Notifications.setBadgeCountAsync(0)` call
- The `expo-notifications` package has been uninstalled from `package.json`

### `app/index.tsx` — Remove Bitcoin loading screen
- Replaced the branded loading screen (Bitcoin logo with gradient glow and spinner) with a plain background-colored `View`
- The native splash screen already covers the initialization period
- Removed unused imports: `ActivityIndicator`, `Text`, `LinearGradient`, `THEME`

### `src/stores/settingsStore.ts` — Clear keychain on preserve data disable
- When `setPreserveDataOnDelete(false)` is called, now also calls `PreservedArchiveService.deleteAllPreservedData()` to wipe all preserved archives, manifest, settings, and dismiss flag from Keychain
- Uses lazy `require()` to avoid circular dependency
- This prevents the recovery sheet from appearing on reinstall after the user has disabled the feature

### `src/services/backup/BackupService.ts` — Full wallet type backup support
Added backup/restore handlers for 3 previously unsupported wallet types:

**`hd_electrum`** (Electrum-format seed):
- `assemblePayload()`: Retrieves seed via `SecureStorage.retrieveWalletSeed()` (same storage as `hd`)
- `restoreFromPayload()`: Stores via `SecureStorage.storeWalletSeed()`

**`hd_descriptor`** (Output descriptor with private key):
- `assemblePayload()`: Retrieves xprv + raw descriptor in parallel
- `restoreFromPayload()`: Stores xprv + descriptor in parallel

**`imported_keys`** (Multiple WIF keys / dumpwallet):
- `assemblePayload()`: Retrieves via `SecureVault.retrieve(walletId, 'wif_set', pin)`
- `restoreFromPayload()`: Stores via `SecureVault.store(walletId, wifs, 'wif_set', pin)`
- Added `importedKeysWIFs` field to `BackupPayload` interface

**`requiresPassword()`** — Updated to return `true` for all 8 wallet types with private key material (was only `hd` and `multisig`)

## Wallet Type Support Matrix (All 11 Types)

| Type | PreservedArchive | iCloud Backup | SecureStorage | Database |
|------|-----------------|---------------|---------------|----------|
| `hd` | Yes | Yes | Yes | Yes |
| `imported_key` | Yes | Yes | Yes | Yes |
| `imported_keys` | Yes | **Yes (NEW)** | Yes | Yes |
| `hd_xprv` | Yes | Yes | Yes | Yes |
| `hd_seed` | Yes | Yes | Yes | Yes |
| `hd_descriptor` | Yes | **Yes (NEW)** | Yes | Yes |
| `hd_electrum` | Yes | **Yes (NEW)** | Yes | Yes |
| `watch_xpub` | Yes | Yes | Yes | Yes |
| `watch_descriptor` | Yes | Yes | Yes | Yes |
| `watch_addresses` | Yes | Yes | Yes | Yes |
| `multisig` | Yes | Yes | Yes | Yes |
