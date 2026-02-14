# 020 — Complete Send Flow Redesign (send-v3)

## Summary
Complete redesign and rebuild of the entire Send flow from zero. New `send-v3/` directory alongside existing `send-v2/`. Replaced React Context state management with Zustand store. Removed all step transition animations for a calm, serious, premium financial UI. Added premium error bottom sheets for every error type. PIN-style circular keypad for amount entry. Supports all wallet types: single-sig HD, watch-only (PSBT), multisig, imported key, descriptor-based.

## Architecture Changes

### State Management: React Context → Zustand
- **Before**: `SendContext` (React Context + useState) in `src/components/send/SendContext.tsx`
- **After**: `useSendStore` (Zustand) in `src/stores/sendStore.ts`
- Benefits: accessible outside React tree, no re-render cascading, matches app pattern

### Error System: Inline text → Premium Bottom Sheets
- Error catalog with 16 error codes (`errors.ts`)
- Each error maps to: title, plain-language message, expandable technical details, recovery actions
- `SendErrorSheet` component reads from store, displays via `AppBottomSheet`
- Error classification: `classifyError()` maps raw error messages to typed codes

### Design: Animated transitions → Instant rendering
- No `SlideInRight/SlideOutLeft/FadeIn` on step transitions
- Content renders instantly when step changes
- Exceptions: `SlideToPayButton` (gesture-based), `KeyboardSafeBottomBar` (functional)

## Features

### 6 Step Screens
1. **StepRecipient** — Address input with paste/scan/nearby, contact lookup, address type detection, multi-recipient support
2. **StepAmount** — PIN-style circular keypad (matching PinCodeScreen sizing), hero amount display, real-time validation (dust, over-balance), unit toggle (sats/BTC/USD), send max
3. **StepFee** — 3 fee cards (Economy/Standard/Priority) + custom, transaction summary, advanced controls (RBF, broadcast, unconfirmed, coin control, transaction label)
4. **StepReview** — Hero amount, full transaction details card, warning card, SlideToPayButton (or AppButton for watch-only/multisig)
5. **StepSigning** — Simple ActivityIndicator + status text, no SVG ring animation
6. **StepSuccess** — Green checkmark, amount/fee display, copy txid/PSBT buttons, done button

### Amount Keypad
- PIN-style 3x4 circular buttons: `min(85, (screenWidth - 72) / 3)` sizing
- Decimal only in BTC/fiat mode, hidden in sats mode
- Long-press backspace clears all
- Light haptic on each key press

### Error Bottom Sheets
Every error shows a premium bottom sheet:
- Red-tinted icon container
- Title + plain-language message
- Expandable "Technical Details" section
- Action buttons: "Try Again", "Edit Amount", "Edit Fee", "Contact Support"

### Wallet Type Support
| Wallet Type | Flow | Output |
|-------------|------|--------|
| HD / HD Electrum | PIN → sign → broadcast | txid |
| HD xprv / HD seed | PIN → sign → broadcast | txid |
| Imported Key | PIN → sign → broadcast | txid |
| HD Descriptor | PIN → sign → broadcast | txid |
| Watch-only | Build unsigned PSBT → clipboard | PSBT base64 |
| Multisig | Navigate to multisig-send screen | Handled separately |

### Advanced Controls
- **RBF**: Replace-by-Fee toggle (default: ON)
- **Broadcast**: Toggle for non-broadcast mode (auto: OFF for watch-only)
- **Include Unconfirmed**: Use 0-conf inputs
- **Coin Control**: New `CoinControlSheetV3` reads from Zustand `useSendStore` (replaces v2 `CoinControlSheet` which depended on `SendProvider`)
- **Transaction Label**: Text input, saved after broadcast

### Offline-First
- UTXOs: uses cached values from wallet store
- Fees: tries Electrum, falls back with "Offline" badge
- Build + sign works entirely offline
- Only broadcast requires network

### Prefill Integration
- Consumes `sendPrefillStore` on mount (from contacts, deep links, nearby)
- Smart step-skip: address only → jump to amount; address + amount → jump to fee

## Files Created

| File | Purpose |
|------|---------|
| `src/stores/sendStore.ts` | Zustand store replacing SendContext |
| `src/components/send-v3/errors.ts` | Error catalog (16 codes) with bottom sheet configs |
| `src/components/send-v3/SendErrorSheet.tsx` | Premium error bottom sheet component |
| `src/components/send-v3/sendTokens.ts` | Design tokens (monochrome luxe, PIN keypad) |
| `src/components/send-v3/steps/StepRecipient.tsx` | Address entry with paste/scan/nearby |
| `src/components/send-v3/steps/StepAmount.tsx` | PIN-style amount keypad |
| `src/components/send-v3/steps/StepFee.tsx` | Fee selection + advanced controls |
| `src/components/send-v3/steps/StepReview.tsx` | Transaction review + SlideToPayButton |
| `src/components/send-v3/steps/StepSigning.tsx` | Signing/broadcast progress |
| `src/components/send-v3/steps/StepSuccess.tsx` | Success confirmation |
| `src/components/send-v3/useSendFlowV3.ts` | Signing hook (ported from useSendFlow) |
| `src/components/send-v3/SendScreen.tsx` | Main screen orchestrator |
| `src/components/send-v3/SendHeader.tsx` | Header with step indicator |
| `src/components/send-v3/CoinControlSheetV3.tsx` | UTXO selection sheet (v3, reads from Zustand store) |
| `src/components/send-v3/index.ts` | Barrel exports |

## Files Modified

| File | Change |
|------|--------|
| `app/(auth)/send.tsx` | Swapped from send-v2 (SendProvider + SendScreenContent) to send-v3 (SendScreenV3) |
| `src/stores/index.ts` | Added `useSendStore` export |

## Existing Components Reused (NOT rebuilt)
- `GlassCard`, `AppButton`, `AppBottomSheet`, `KeyboardSafeBottomBar`, `SlideToPayButton`, `GlassInput`, `PremiumText` (UI library)
- `QRScanner`, `PinCodeScreen` (from scanner/security)
- `TransactionBuilder`, `UTXOSelector`, `PSBTService` (core transaction)
- `ElectrumAPI` (network)
- `SecureStorage`, `KeyDerivation`, `SeedGenerator`, `ImportedKeySigner` (crypto/auth)

## Bug Fixes

### CoinControlSheet v2 → v3 (runtime crash)
- **Error**: `useSendContext must be used within SendProvider` — `CoinControlSheet` from send-v2 internally called `useSendContext()` and `useSendTokens()`, which require the v2 `SendProvider` React Context wrapper. Since send-v3 uses Zustand (`useSendStore`) with no `SendProvider`, the component crashed at render.
- **Fix**: Created `CoinControlSheetV3` in send-v3 that reads from `useSendStore` (Zustand) instead of `useSendContext()`, and uses `useSendV3Tokens()` instead of v2's `useSendTokens()`. Uses `AppButton` directly instead of `LuxeButton` (which also depended on v2 tokens). Same UI and behavior, zero v2 dependencies.
- **Files**: `CoinControlSheetV3.tsx` (new), `SendScreen.tsx` (updated import), `index.ts` (added export)

## Verification
- `npx tsc --noEmit` — zero errors
