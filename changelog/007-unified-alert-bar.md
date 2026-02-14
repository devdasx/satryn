# 007 - Unified Alert Bar (Toast Pill)

## Overview
Replaced all in-app notification patterns (showMinimal, showSuccess, showError) with a unified alert bar — a dark rounded pill that appears at the bottom of the screen with an icon and text. The icon color changes based on the alert level (success = green, error = red, info = blue, neutral = white). Added a settings toggle to disable it.

## Design
- Bottom-centered dark pill (`rgba(30, 30, 30, 0.95)`)
- Rounded corners (24px border radius)
- Left icon (Ionicons) colored by alert level + white text
- Fade + scale animation (0.85 → 1.0 on appear, reverse on dismiss)
- Auto-dismiss after 1.5s
- Non-blocking (pointerEvents="none")

## Alert Levels
| Level | Icon | Color |
|-------|------|-------|
| success (default) | checkmark-circle | #4CAF50 (green) |
| error | close-circle | #F44336 (red) |
| info | information-circle | #2196F3 (blue) |
| neutral | checkmark-circle | #FFFFFF (white) |

## API
```typescript
showAlertBar(title: string, level?: 'success' | 'error' | 'info' | 'neutral')
```

## New Files
| File | Description |
|------|-------------|
| `src/components/ui/AlertBar.tsx` | Bottom pill toast component with icon + color levels |

## Modified Files
| File | Change |
|------|--------|
| `src/components/ui/Toast.tsx` | Added `AlertLevel` type, `alertLevel` field to `ToastData`, `'alert_bar'` toast type |
| `src/providers/ToastProvider.tsx` | Added `showAlertBar(title, level?)`, renders AlertBar in overlay, checks `inAppAlertsEnabled` setting |
| `src/stores/settingsStore.ts` | Added `inAppAlertsEnabled` (default: true), version bump to 11 |
| `app/(auth)/(tabs)/settings.tsx` | Added "In-App Alerts" toggle in Preferences section |
| `src/components/bitcoin/AddressDisplay.tsx` | Added `showAlertBar('Address copied')` after clipboard copy |

## Replaced Calls (24 files)
All `showMinimal(...)`, `showSuccess(...)`, and `showError(...)` calls replaced with `showAlertBar(...)`:

- `app/(auth)/contacts.tsx` — copy, delete, favorites
- `app/(auth)/contact-details.tsx` — copy, delete, add/remove address
- `app/(auth)/backup.tsx` — copy actions
- `app/(auth)/receive.tsx` — copy address/txid
- `app/(auth)/wallet-hub.tsx` — switch, rename, remove wallet
- `app/(auth)/pending-transactions.tsx` — copy hex/txid, remove tx
- `app/(auth)/multisig-send.tsx` — sign, import, copy, broadcast (success + error)
- `app/(auth)/sign-transaction.tsx` — import PSBT errors
- `app/(auth)/sign-message.tsx` — sign, copy signature
- `app/(auth)/verify-message.tsx` — valid/invalid signature
- `app/(auth)/broadcast.tsx` — broadcast success/fail, copy txid
- `app/(auth)/advanced-send.tsx` — transaction failed
- `app/(auth)/(tabs)/index.tsx` — balance copied, connection error
- `app/(auth)/(tabs)/wallet.tsx` — rename, avatar, export
- `src/components/payment/PaymentSheet.tsx` — PSBT copy, txid copy
- `src/components/contacts/AddEditContactSheet.tsx` — contact saved/updated
- `src/components/contacts/RequestFromContactSheet.tsx` — errors
- `src/components/send/useSendFlow.ts` — transaction errors

## Kept Unchanged
- `Alert.alert` — confirmation dialogs requiring user input (Cancel/OK)
- `showBitcoinSent` / `showBitcoinReceived` — rich transaction toasts with amounts

## Verification
- `npx tsc --noEmit` — zero errors
