# Fixes #33–#35 — Send Clipboard Removal, Require Cycle, URI Scheme

## Fix #33: Remove Automatic Clipboard Reading in Send Screen

**Problem:** The send screen automatically read the clipboard on mount and polled it every 3 seconds on the recipient step. This is invasive behavior — users should explicitly choose to paste.

**Solution:**
- `components/send-v3/SendScreen.tsx`:
  - Removed `import * as Clipboard from 'expo-clipboard'`
  - Removed on-mount clipboard capture (`Clipboard.getStringAsync()` → `setClipboardOnEntry`)
  - Removed 3-second polling interval that checked clipboard while on recipient step
- The manual "Paste" button in StepRecipient still works (user-initiated)
- The SafetyPanel and sendSafetyStore remain functional for when clipboard data is explicitly provided

---

## Fix #34: Require Cycle — stores/index.ts ↔ stores/sendStore.ts

**Problem:** `sendStore.ts` imported from the barrel `./index` which re-exports `sendStore.ts`, creating a circular dependency:
```
sendStore.ts → index.ts → sendStore.ts
```
This caused a "Require cycle" warning in Metro and could result in uninitialized values.

**Solution:**
- `stores/sendStore.ts` — Changed the barrel import to direct imports:
  - `import { useWalletStore } from './walletStore'`
  - `import { useSettingsStore } from './settingsStore'`
  - `import { usePriceStore } from './priceStore'`
  - `import { useUTXOStore, getUtxoId } from './utxoStore'`
  - `import { useMultiWalletStore } from './multiWalletStore'`
- The cycle is completely eliminated — no more "Require cycle" warning

---

## Fix #35: URI Scheme — Keep Only "satryn"

**Problem:** `app.json` defined multiple URI schemes (`satryn`, `bitcoin-wallet`), plus the bundle identifier `com.satryn.bitcoinapp` was detected as a third. This caused:
```
Linking found multiple possible URI schemes in your Expo config.
Using 'satryn'. Ignoring: bitcoin-wallet, com.satryn.bitcoinapp.
```

**Solution:**
- `app.json` — Changed `scheme` from array `["satryn", "bitcoin-wallet"]` to single string `"satryn"`
- Only the `satryn://` deep link scheme is now registered — no ambiguity

---

## Modified Files

| File | Changes |
|------|---------|
| `components/send-v3/SendScreen.tsx` | Removed expo-clipboard import, on-mount clipboard capture, 3s polling interval |
| `stores/sendStore.ts` | Changed barrel import to direct imports from individual store files |
| `app.json` | Changed `scheme` from array to single string `"satryn"` |

## Verification

- `npx tsc --noEmit` — zero errors
- No automatic clipboard reading — paste is user-initiated only
- No require cycle warnings
- Single URI scheme — no ambiguity warning
