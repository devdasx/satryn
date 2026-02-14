# 050 — Preserve Data on Delete — Full Redesign

## Overview
Complete redesign of the "Preserve Data on Delete" feature. Now archives full app state (all wallets, settings, contacts, tx labels, UTXO metadata) to the iOS Keychain continuously. Detects preserved data on reinstall and shows a premium recovery flow on the onboarding screen. Redesigned the Preserve Data warning sheet with animated icon and feature cards.

## New Files

### `src/services/storage/ContinuousArchivalManager.ts`
- Lightweight static service managing event-driven archival triggers
- Guards: preserveDataOnDelete enabled, SensitiveSession active, 60s debounce, not resetting, not already archiving
- `triggerIfNeeded()` — safe to call from anywhere, silently skips if conditions not met
- `performFullArchive(pin)` — immediate archive (used when enabling the feature)

### `src/components/preserve/PreservedDataRecoverySheet.tsx`
- Post-reinstall recovery bottom sheet shown on onboarding screen
- Animated shield icon with green glow pulse (Reanimated)
- Wallet summary card: wallet count, names, last saved timestamp
- Actions: "Recover My Data", "Start Fresh" (with confirmation alert), "Don't show again"
- Premium glass card design with AppBottomSheet sizing="auto"

### `src/components/preserve/RestorationProgressSheet.tsx`
- Step-based restoration progress (modeled after ConnectionProgressSheet)
- 5 animated steps: Verify identity, Decrypt data, Restore wallets, Restore settings, Complete
- Animated indicators: pulse for active, spring checkmark for complete, shake for failed
- Error card with "Try Again" button on failure
- Auto-dismiss 1.2s after success, navigates to /(auth)/(tabs)

### `src/components/preserve/index.ts`
- Barrel exports for PreservedDataRecoverySheet and RestorationProgressSheet

## Modified Files

### `src/services/storage/PreservedArchiveService.ts`
- Added `PreservedManifest` type — unencrypted manifest for fast post-reinstall detection
- Added `PreservedSettingsPayload` type — encrypted settings + contacts + labels + UTXO metadata
- Added `PreservedFullState` type — full restored state structure
- Added `MANIFEST_KEY`, `SETTINGS_KEY`, `DISMISS_KEY`, `PRESERVE_FLAG_KEY` constants
- Added `KEYCHAIN_OPTS` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility
- New methods: `writeManifest()`, `readManifest()`, `archiveSettings()`, `restoreSettings()`
- New methods: `archiveFullState(pin)` — orchestrates wallet + settings + manifest archival
- New methods: `restoreFullState(pin)` — decrypts and returns all preserved data
- New methods: `hasPreservedData()` — fast manifest-only check (no decryption)
- New methods: `deleteAllPreservedData()` — deletes manifest + settings + archives + dismiss flag
- Added private `encrypt()` / `decrypt()` helpers for generic JSON encryption
- All SecureStore calls now use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keychain accessibility

### `src/stores/walletStore.ts`
- Fixed reinstall detection: when `preserveFlag === 'true'` and AsyncStorage is empty, now correctly sets `walletId: null` and returns (routes to onboarding)
- Previously fell through to main init path which failed

### `app/(onboarding)/index.tsx`
- Added preserved data detection on mount (checks manifest + dismiss flag)
- Added `PreservedDataRecoverySheet` — shown when preserved data detected
- Added PIN verification `Modal` with `PinCodeScreen mode="verify"`
- Added `RestorationProgressSheet` — shown after PIN verified
- Flow: Recovery sheet → PIN modal → Restore progress → Navigate to /(auth)/(tabs)
- "Start Fresh" → deletes all preserved data + orphaned keychain data
- "Don't show again" → sets dismiss flag in Keychain

### `app/(auth)/data-backup.tsx`
- Redesigned Preserve Data warning sheet with premium design:
  - Animated shield icon with green glow pulse (Reanimated)
  - 3 feature rows: "Survives App Deletion", "Continuous Backup", "Instant Recovery"
  - Each row with colored icon circle, title, and subtitle
- Added `ContinuousArchivalManager.performFullArchive(pin)` trigger after enabling preserve
- Added `SensitiveSession.start(pin)` on preserve enable

### `src/services/AppStateManager.ts`
- Updated preserve-on-delete step in `resetWalletToFreshInstall()`:
  - Now calls `PreservedArchiveService.archiveFullState(pin)` for complete state archive
  - Falls back to per-wallet archival if full state archive fails

### `src/hooks/useBackgroundWalletSync.ts`
- Added `ContinuousArchivalManager.triggerIfNeeded()` call after background sync completes

### `app/_layout.tsx`
- Added `ContinuousArchivalManager.triggerIfNeeded()` call on app backgrounding

### `src/stores/multiWalletStore.ts`
- Added `ContinuousArchivalManager.triggerIfNeeded()` after `addWallet` and `removeWallet`

## Architecture

### Storage Keys (Sharded Keychain)
| Key | Content | Encrypted |
|-----|---------|-----------|
| `preserved_manifest` | Wallet count, names, timestamp | NO (detection only) |
| `preserved_settings` | Settings, contacts, tx labels, UTXO metadata | YES (AES-256-GCM) |
| `preserved_archive_{walletId}` | CanonicalWalletSnapshot per wallet | YES (existing) |
| `preserved_archive_index` | JSON array of ArchiveEntry metadata | NO |
| `preserve_data_on_delete` | Flag "true" | NO (existing) |
| `preserved_recovery_dismissed` | "true" if user tapped "Don't show again" | NO |

### Archival Triggers (Event-Driven)
1. Immediate full archive when preserve is enabled (data-backup.tsx)
2. After background sync completes (useBackgroundWalletSync.ts)
3. On app backgrounding (_layout.tsx)
4. On wallet add/remove (multiWalletStore)
5. During wallet reset (AppStateManager)

### Recovery Flow
```
App Start → walletStore.initialize()
  → Keychain has PIN but AsyncStorage empty?
    → preserve_data_on_delete === 'true'?
      → YES: Set walletId=null → routes to onboarding
      → NO: Clean orphaned keychain → normal onboarding

Onboarding Welcome Screen
  → Check preserved_manifest exists + not dismissed
    → Show "Welcome Back" recovery sheet
      → "Recover My Data" → PIN modal → RestoreProgressSheet → /(auth)
      → "Start Fresh" → Confirm alert → Delete all preserved data → Normal onboarding
      → "Don't show again" → Set dismiss flag → Close
```

## Verification
- `npx tsc --noEmit` — zero errors
- Enable preserve → verify manifest + settings + wallet archives written to Keychain
- Background app → continuous archival triggers
- Simulate reinstall: delete AsyncStorage → app routes to onboarding → recovery sheet appears
- Recovery sheet: shows wallet count, names, timestamp from manifest
- "Recover My Data" → PIN modal → correct PIN → progress sheet animates all 5 steps
- After restore: wallets registered, settings applied, contacts restored
- Wrong PIN → error feedback, retry works
- "Start Fresh" → confirmation alert → preserved data deleted → normal onboarding
- "Don't show again" → sheet dismissed → won't appear again
- Premium warning sheet: animated shield icon, 3 feature rows, light/dark themed
