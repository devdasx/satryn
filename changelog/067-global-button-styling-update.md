# 067 — Global Button Styling Update

## Overview
Unified all button dimensions across the entire application to enforce a consistent design system. Every button in every screen, sheet, and modal now uses `borderRadius: 24` for a fully rounded pill shape. Primary/danger buttons use `height: 50` and secondary/cancel buttons use `height: 45`. This applies to 40+ files spanning core UI components, bottom sheets, modals, and all app screens.

## Design Tokens

| Property | Primary / Danger | Secondary / Cancel |
|----------|-----------------|-------------------|
| `height` | 50 | 45 |
| `borderRadius` | 24 | 24 |

Small inline action buttons (e.g., copy/share capsules using `paddingVertical`) retain their padding-based sizing but were updated to `borderRadius: 24`.

## Changes

### Core UI Components

#### `src/components/ui/AppButton.tsx` — Single source of truth
- Updated docstring to document `Height: 50 (primary) / 45 (secondary), BorderRadius: 24`
- **Container base style**: `borderRadius: 30` → `borderRadius: 24`
- **Secondary variant**: Added explicit `height: 45` override (was inheriting primary height of 50)

#### `src/components/ui/SheetComponents.tsx` — Shared bottom sheet button
- **`primaryButton`**: `height: 48` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`

#### `src/components/ui/SettingsPageComponents.tsx` — Settings CTA tokens
- **`TOKENS.ctaRadius`**: `16` → `24`

#### `src/components/ui/ErrorBoundary.tsx` — Crash recovery button
- **`button`**: Removed `paddingVertical`, added explicit `height: 50`, `borderRadius: 12` → `borderRadius: 24`, added `justifyContent: 'center'` and `alignItems: 'center'`

### Wallet Components

#### `src/components/wallet/WalletRemovalSheet.tsx`
- **`primaryButton` / `dangerButton`**: `height: 52` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 16` → `borderRadius: 24`

#### `src/components/wallet/WalletSwitcherSheet.tsx`
- **`primaryButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

### Wallet Hub Components

#### `src/components/wallet-hub/WalletHubEmptyState.tsx`
- **`primaryButton`**: `height: 48` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`
- **`secondaryButton`**: `height: 46` → `height: 45`, `borderRadius: 13` → `borderRadius: 24`

### Preserve / Archival Components

#### `src/components/preserve/ArchivalProgressSheet.tsx`
- **`primaryButton`**: `height: 52` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 16` → `borderRadius: 24`

#### `src/components/preserve/RestorationProgressSheet.tsx`
- **`retryButton`**: `height: 48` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`
- **`cancelButton`**: `height: 40` → `height: 45`, `borderRadius: 14` → `borderRadius: 24`

#### `src/components/preserve/PasswordInputSheet.tsx`
- **`primaryButton`**: `height: 52` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `src/components/preserve/PreservedDataRecoverySheet.tsx`
- **`primaryButton`**: `height: 52` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`

### Bitcoin Components

#### `src/components/bitcoin/AddressOptionsModal.tsx`
- **`primaryButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`
- **`secondaryButton`**: `height: 54` → `height: 45`, `borderRadius: 16` → `borderRadius: 24`

### Contact Components

#### `src/components/contacts/AddEditContactSheet.tsx`
- **`primaryButton`**: `borderRadius: 14` → `borderRadius: 24`

#### `src/components/contacts/SendToContactSheet.tsx`
- **`sendButton`**: `borderRadius: 14` → `borderRadius: 24`

### Payment Components

#### `src/components/payment/PaymentErrorSheet.tsx`
- **`primaryButton`**: `height: 52` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 14` → `borderRadius: 24`

#### `src/components/payment/PaymentSheet.tsx`
- **`doneButton`**: `height: 52` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`

### Entropy Component

#### `src/components/entropy/EntropyCollectionModal.tsx`
- **`doneButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`cancelButton`**: `height: 44` → `height: 45`, `borderRadius: 11` → `borderRadius: 24`

### Connection Component

#### `src/components/ConnectionProgressSheet.tsx`
- **`retryButton`**: `height: 52` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

### Backup Components

#### `src/components/backup/WalletRestoreSheet.tsx`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 11` → `borderRadius: 24`

#### `src/components/backup/WalletBackupSheet.tsx`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 11` → `borderRadius: 24`

---

### App Screens — `app/(auth)/`

#### `app/(auth)/electrum-server.tsx`
- **`connectBtn`**: `borderRadius: 14` → `borderRadius: 24`

#### `app/(auth)/backup-icloud.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(auth)/backup-manual.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(auth)/icloud-backup.tsx`
- **`ctaButton`**: `height: 52` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/receive.tsx`
- **`primaryButton`**: `borderRadius: 14` → `borderRadius: 24`
- **`secondaryButton`**: `height: 46` → `height: 45`, `borderRadius: 14` → `borderRadius: 24`

#### `app/(auth)/(tabs)/wallet.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(auth)/import-addresses.tsx`
- **`actionBtn`**: `height: 42` → `height: 45`, `borderRadius: 12` → `borderRadius: 24`
- **`ctaButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/import-xpub.tsx`
- **`actionBtn`**: `height: 42` → `height: 45`, `borderRadius: 12` → `borderRadius: 24`
- **`ctaButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/import-descriptor.tsx`
- **`actionBtn`**: `height: 42` → `height: 45`, `borderRadius: 12` → `borderRadius: 24`
- **`ctaButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/wallet-hub.tsx`
- **`renameSaveButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/multisig-review.tsx`
- **`createButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(auth)/multisig-add-cosigner.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`actionButton`**: `borderRadius: 10` → `borderRadius: 24`

#### `app/(auth)/bug-bounty.tsx`
- **`ctaButton`**: `borderRadius: 14` → `borderRadius: 24`

#### `app/(auth)/multisig-setup.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(auth)/account-create.tsx`
- **`createButton`**: Replaced `paddingVertical: 18` with explicit `height: 50`, `borderRadius: 16` → `borderRadius: 24`

#### `app/(auth)/reset-app.tsx`
- **`continueButton`**: `height: 56` → `height: 50`, `borderRadius: 14` → `borderRadius: 24`

#### `app/(auth)/backup.tsx`
- **`secondaryButton`**: `height: 46` → `height: 45`, `borderRadius: 12` → `borderRadius: 24`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`importButton`**: `height: 44` → `height: 45`, `borderRadius: 11` → `borderRadius: 24`

#### `app/(auth)/backup-export.tsx`
- **`actionButton`**: `borderRadius: 10` → `borderRadius: 24`

#### `app/(auth)/contact-details.tsx`
- **`sheetPrimaryBtn`**: `borderRadius: 14` → `borderRadius: 24`

---

### App Screens — `app/(onboarding)/`

#### `app/(onboarding)/index.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`secondaryButton`**: `height: 44` → `height: 45`, `borderRadius: 11` → `borderRadius: 24`

#### `app/(onboarding)/setup.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`secondaryButton`**: `height: 44` → `height: 45`

#### `app/(onboarding)/create.tsx`
- **`primaryButton`**: `borderRadius: 14` → `borderRadius: 24`

#### `app/(onboarding)/recover-icloud.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`

#### `app/(onboarding)/multisig-create.tsx`
- **`primaryButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`actionButton`**: `borderRadius: 10` → `borderRadius: 24`

#### `app/(onboarding)/multisig-import.tsx`
- **`importButton`**: `height: 46` → `height: 50`, `borderRadius: 12` → `borderRadius: 24`
- **`actionButton`**: `borderRadius: 10` → `borderRadius: 24`

#### `app/(onboarding)/import.tsx`
- **`importButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`
- **`warningButton`**: `height: 54` → `height: 50`, `borderRadius: 16` → `borderRadius: 24`

## Summary
- **40+ files** updated across `src/components/` and `app/` directories
- **All `borderRadius` values** normalized to `24` (from varying values of 10–30)
- **All primary button heights** normalized to `50` (from varying values of 46–56)
- **All secondary button heights** normalized to `45` (from varying values of 40–54)
- TypeScript compiles with 0 errors after all changes
