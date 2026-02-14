# 063 — Preserve Data: Password-Based Encryption Migration

## Overview
Migrated the Preserve Data feature from PIN-based to password-based encryption. Users now create a standalone encryption password when enabling Preserve Data, and enter that same password to restore after reinstall. This decouples the archive encryption from the app's PIN system, which was causing errors on fresh installs where no PIN hash existed yet.

## Changes

### New File: `src/components/preserve/PasswordInputSheet.tsx`
- Premium password input bottom sheet with two modes: `create` and `verify`
- Password strength indicator (Too short / Weak / Good / Strong)
- Show/hide toggle, confirm field in create mode
- Shake animation on error, animated shield icon
- Minimum password length: 6 characters

### `src/components/preserve/index.ts`
- Added `PasswordInputSheet` export

### `app/(auth)/data-backup.tsx`
- Replaced PIN verification with `PasswordInputSheet` for preserve data encryption
- State: `archivalPin` renamed to `archivalPassword`, added `showPasswordSheet`
- `handlePreserveWarningConfirm` opens password sheet instead of PIN modal
- Added `handlePasswordSubmit` callback
- Removed 'preserve' branch from `handlePinSuccess` (preserve now uses password flow)
- Updated button text: "Enable & Verify PIN" -> "Enable & Create Password"
- Updated info text: "PIN Required" -> "Password Protected"
- PIN modal retained only for iCloud backup and restore actions

### `app/(onboarding)/index.tsx`
- Replaced `PinCodeScreen` with `PasswordInputSheet` in `verify` mode for restore flow
- State: `showPinModal/verifiedPin` -> `showPasswordSheet/verifiedPassword`

### `src/components/preserve/RestorationProgressSheet.tsx`
- Removed `SecureStorage.verifyPin(pin)` step (was Step 1)
- Replaced with brief "Preparing restore" animated step
- Password verified implicitly when decryption succeeds/fails in Step 2
- Updated error message: "Wrong PIN" -> "Wrong password"
- Removed `SecureStorage` and `SensitiveSession` imports
- Added restoration of 18 new settings fields (iCloudBackupEnabled, autoBackupEnabled, analyticsEnabled, inAppAlertsEnabled, nearbyNickname, fee caps, fee defaults, privacy send prefs, thresholds, tagPresets)

### `src/components/preserve/ArchivalProgressSheet.tsx`
- Full premium redesign with animated progress bar, color-coded steps, connector lines, completion summary stats
- Updated settings gathering to capture all 30+ settings fields

### `src/services/AppStateManager.ts`
- Expanded `BackupSettings` interface with 18 new fields
- Updated `assembleFullState()` and `restoreFullState()` to handle all new fields

### `src/services/storage/PreservedArchiveService.ts`
- Updated settings gathering in `archiveFullState()` to include all 30+ fields

## Bug Fixes
- Fixed `[SecureStorage] verifyPin failed: missing keychain data` on fresh install restore
- Fixed `[DIAG][db] shared() called BEFORE initialize()!` — `WalletDatabase.shared()` now auto-initializes
