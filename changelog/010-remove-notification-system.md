# 010 — Remove Notification System

## Summary
Completely removed the OS push notification system (expo-notifications, APNs, server, push tokens, permissions). In-app toast notifications are preserved — the existing `showBitcoinReceived` toast now fires when a new transaction is detected while the user is inside the app.

---

## What Was Removed

### Files Deleted
- `src/services/notifications/` — entire directory (NotificationService.ts, index.ts)
- `server/` — entire push notification server (Express + APNs + Electrum polling)
- `credentials.json` — APNs key configuration
- `AuthKey_Q9A4V46FYC.p8` — Apple Push Notification key
- `changelog/009-notification-bug-fixes.md` — superseded by this changelog

### Dependencies Removed
- `expo-notifications` from package.json
- `expo-notifications` plugin from app.json
- `NSUserNotificationUsageDescription` from app.json infoPlist
- `pushServerUrl` from app.json extra

### Code Removed
- `NotificationService` singleton and all its methods
- `notificationsEnabled` / `setNotificationsEnabled` from settingsStore
- Push Notifications toggle from settings screen
- `notifiedReceived` / `notifiedConfirmed` fields from TrackedTransaction (walletStore, sync/types, WalletFileService)
- Notification init, listeners, and bridge in `_layout.tsx`
- Notification references in AppStateManager (backup/restore)

## What Was Added

### Transaction Toast Bridge
- `onTransactionReceived` event emitter exported from walletStore
- `TransactionToastBridge` component in `_layout.tsx` — subscribes to the emitter and calls `showBitcoinReceived(amount)` for in-app toast display
- When a new incoming transaction is detected during wallet sync (not on initial load), the existing bitcoin received toast appears inside the app

## Files Modified
| File | Changes |
|------|---------|
| `app.json` | Removed expo-notifications plugin, plist entry, pushServerUrl |
| `package.json` | Removed expo-notifications dependency |
| `app/_layout.tsx` | Replaced InAppNotificationBridge with TransactionToastBridge, removed notification init/listeners |
| `src/stores/walletStore.ts` | Removed NotificationService import/calls, added onTransactionReceived emitter, cleaned TrackedTransaction |
| `src/stores/settingsStore.ts` | Removed notificationsEnabled state/action/migration |
| `app/(auth)/(tabs)/settings.tsx` | Removed notification toggle and NotificationService import |
| `src/services/AppStateManager.ts` | Removed notification import, backup/restore references |
| `src/services/sync/types.ts` | Removed notifiedReceived/notifiedConfirmed from TrackedTransaction |
| `src/services/storage/WalletFileService.ts` | Removed notifiedReceived/notifiedConfirmed from TrackedTransaction |
| `src/services/sync/WalletEngine.ts` | Updated comments (removed "notification state" references) |
| `src/__tests__/sync/CanonicalSnapshotBuilder.test.ts` | Removed notifiedReceived/notifiedConfirmed from test data |

## Verification
- `npx tsc --noEmit` — zero errors ✅
- Zero leftover references to NotificationService, expo-notifications, notificationsEnabled, notifiedReceived, notifiedConfirmed ✅
- server/ directory deleted ✅
- credentials and key files deleted ✅
