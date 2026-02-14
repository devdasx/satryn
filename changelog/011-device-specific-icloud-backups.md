# 011 — Device-Specific iCloud Backups

## Problem
iCloud KVS (NSUbiquitousKeyValueStore) automatically syncs across all devices signed into the same Apple ID. When the app was installed on a new phone, encrypted backups from the old phone appeared on the restore screen — a security concern since users expect backups to be device-specific.

## Fix
Every iCloud backup blob now includes a `deviceId` field (UUID stored in SecureStore/Keychain). When listing or counting backups, only backups created by the current device are shown.

## How It Works
- On first app launch, a UUID is generated and persisted in SecureStore (Keychain)
- The `deviceId` survives app updates and device migration (Keychain transfers)
- Every new backup is tagged with the current device's `deviceId`
- `listBackups()`, `listFullBackups()`, `getBackupCount()`, `getFullBackupCount()` all filter by `deviceId`
- Legacy backups (created before this change, without `deviceId`) still appear on all devices as a graceful fallback
- Full reset (`AppStateManager.deleteAllCloudBackups`) deletes ALL backups without device filtering

## Files Changed
| File | Change |
|------|--------|
| `src/services/DeviceIdentity.ts` | **NEW** — `getDeviceId()`, `getDeviceIdSync()` |
| `src/constants/index.ts` | Added `DEVICE_ID` to STORAGE_KEYS |
| `src/services/backup/BackupService.ts` | Added `deviceId?` to blob interfaces + encrypt method params |
| `src/services/backup/iCloudService.ts` | Added `deviceId` filtering to list/count methods |
| `app/_layout.tsx` | Pre-warm `getDeviceId()` on app startup |
| `app/(onboarding)/index.tsx` | Pass `deviceId` to backup count check |
| `app/(onboarding)/recover-icloud.tsx` | Pass `deviceId` to backup list |
| `app/(auth)/icloud-backup.tsx` | Pass `deviceId` to list + encrypt |
| `app/(auth)/backup-icloud.tsx` | Pass `deviceId` to encrypt |
| `app/(auth)/reset-app.tsx` | Pass `deviceId` to encrypt |
| `app/(auth)/(tabs)/settings.tsx` | Pass `deviceId` to count methods |
| `src/components/backup/WalletBackupSheet.tsx` | Pass `deviceId` to encrypt |
| `src/components/backup/WalletRestoreSheet.tsx` | Pass `deviceId` to list |

## Verification
- `npx tsc --noEmit` — zero errors ✅
