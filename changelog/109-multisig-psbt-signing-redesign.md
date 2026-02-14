# 109 — Multisig PSBT Signing Redesign

## Date
2025-02-11

## Summary

Completely redesigned the PSBT screen from a simple export-only view into a full-featured **Multisig Signature Manager**. The new screen shows real-time signature progress, can sign locally with all available keys, import signed PSBTs from external cosigners (QR scan, clipboard, file), and finalize + broadcast when enough signatures are collected.

---

## Problem: Export-Only PSBT Screen

### Symptom
The old `StepPSBT.tsx` was a simple export screen showing a QR code, "Copy PSBT" and "Share PSBT" buttons. It had no awareness of:
- How many signatures were present or required
- Which cosigners had signed
- Whether the wallet held local keys that could sign additional inputs
- Any way to import signatures from external cosigners
- Any way to finalize and broadcast when all signatures were collected

Even when the wallet held ALL required keys locally, the user was forced to export the PSBT externally to collect signatures.

---

## Change 1: New `sendStore` State & Actions

### New State Fields
- `psbtObject: bitcoin.Psbt | null` — Live PSBT object for manipulation (signing, merging)
- `signatureStatus: MultisigSignatureStatus | null` — Current signature analysis from PSBTService

### New Actions

| Action | Description |
|--------|------------|
| `updateSignatureStatus()` | Reads current PSBT + multisigConfig, calls `PSBTService.getMultisigSignatureStatus()`, updates store |
| `signWithLocalKeys(pin)` | Discovers and signs with ALL available local keys using 3 strategies: wallet DB key, cosigner seeds from SecureStorage, global seed fallback |
| `importSignedPSBT(base64)` | Validates incoming PSBT matches current tx, merges new partial signatures, updates status |
| `finalizeAndBroadcast()` | Verifies m signatures present, finalizes via PSBTService, extracts raw tx, broadcasts via Electrum |

### Updated Action
- `exportPSBT()` — Now also stores `psbtObject` and calls `updateSignatureStatus()` for multisig wallets

### File Changed
- `src/stores/sendStore.ts`

---

## Change 2: Local Key Discovery (3-Strategy Approach)

### Problem
The app needed to discover which keys it has access to at signing time, regardless of how the wallet was imported (multisig create, watch-only import, etc.).

### Solution — `signWithLocalKeys(pin)` tries 3 strategies:

1. **Strategy 1: Wallet DB key material** — `keyDerivationFromSecureStorage(walletId)` reads seedHex/masterXprv/mnemonic from the wallets table. Gets fingerprint, matches to cosigner, signs if match found.

2. **Strategy 2: Local cosigner seeds** — `SecureStorage.retrieveAllLocalCosignerSeeds(pin)` tries indices 0-14. Builds KeyDerivation from each seed, matches fingerprints to cosigners.

3. **Strategy 3: Global seed fallback** — `SecureStorage.retrieveSeed(pin)` retrieves the user's main mnemonic. If its fingerprint matches an unsigned cosigner, signs with it.

After each signing round, refreshes the signature status to avoid double-signing.

### File Changed
- `src/stores/sendStore.ts`

---

## Change 3: PSBT Import & Merge Logic

### Problem
No way to import signatures from external cosigners.

### Solution — `importSignedPSBT(base64)`:

1. Parses incoming PSBT via `PSBTService.fromBase64()`
2. Validates input count matches current transaction
3. Validates all input txids match (same transaction)
4. Merges new partial signatures: for each input, copies `partialSig` entries not already present
5. Also copies `bip32Derivation` if missing in target
6. Updates store with merged PSBT and refreshes signature status

### File Changed
- `src/stores/sendStore.ts`

---

## Change 4: Finalize & Broadcast

### Problem
No way to finalize a fully-signed multisig PSBT and broadcast from within the app.

### Solution — `finalizeAndBroadcast()`:

1. Checks `PSBTService.canFinalizeMultisig(psbt, m)` — verifies m signatures on all inputs
2. Calls `PSBTService.finalizeMultisig(psbt)` — creates final witness/script from partial signatures
3. Extracts raw transaction hex via `psbt.extractTransaction()`
4. Broadcasts via `ElectrumAPI.broadcastTransaction(hex)`
5. Sets `signedTx`, `broadcastTxid` in store
6. Triggers post-broadcast sync via `WalletSyncManager`

User sees a confirmation dialog before broadcast.

### File Changed
- `src/stores/sendStore.ts`

---

## Change 5: Redesigned `StepPSBT.tsx` Component

### Previous
Simple export view: QR code + Copy + Share + Done.

### New — Multisig Signature Manager
Single scrollable screen with sections:

1. **Signature Progress Hero** — Shows `{presentSigs} of {requiredSigs}` with progress circle and bar
2. **Cosigner Status List** — Each cosigner row shows name, fingerprint, signed/unsigned status, local badge
3. **Sign Locally Card** — Only visible if unsigned local keys exist. Button triggers PIN-based local signing
4. **Import Signatures Card** — Only visible if more signatures needed. Opens PSBTImportSheet
5. **Share/Export Card** — Collapsible section with QR code, Copy, Share buttons (always visible)
6. **Finalize & Broadcast Button** — Only visible when `canFinalize` is true, with confirmation dialog
7. **Done Button** — Always visible at bottom

For non-multisig (watch-only) wallets, falls back to the original simple export view.

### File Changed
- `src/components/send/StepPSBT.tsx` — Complete rewrite

---

## Change 6: New `CosignerSignatureRow.tsx` Component

Simple row component for the cosigner status list:
- Green checkmark icon with "Signed" text if `hasSigned`
- Gray empty circle with "Awaiting" text if not signed
- Shows cosigner name + truncated fingerprint (8 hex chars)
- "Local" badge if `isLocal`
- Subtle background color change for signed vs unsigned rows

### File Created
- `src/components/send/CosignerSignatureRow.tsx`

---

## Change 7: New `PSBTImportSheet.tsx` Component

Bottom sheet with three import options:
1. **Scan QR Code** — Opens QRScanner component. On scan, validates and calls `importSignedPSBT()`
2. **Paste from Clipboard** — Reads clipboard, validates, calls `importSignedPSBT()`
3. **Import File** — Uses `expo-document-picker` + `expo-file-system` File API to read `.psbt` files. Handles both binary PSBT files and text files containing base64 PSBT strings.

After successful import, shows a success indicator with count of new signatures merged, then auto-closes.

### File Created
- `src/components/send/PSBTImportSheet.tsx`

---

## Change 8: Route Updates

### `send-psbt.tsx`
- Added `handleBroadcastSuccess` callback that navigates to `send-success`
- Passes `onBroadcastSuccess` prop to `StepPSBT`
- Changed `useState(false)` to `useState(() => !!error)` for error sheet (consistent with send-review fix)

### File Changed
- `app/(auth)/send-psbt.tsx`

---

## All Files Modified/Created

| File | Change |
|------|--------|
| `src/stores/sendStore.ts` | New state fields (psbtObject, signatureStatus); 4 new actions; updated exportPSBT() |
| `src/components/send/StepPSBT.tsx` | Complete rewrite — Multisig Signature Manager |
| `src/components/send/CosignerSignatureRow.tsx` | **NEW** — Cosigner status row component |
| `src/components/send/PSBTImportSheet.tsx` | **NEW** — PSBT import bottom sheet |
| `app/(auth)/send-psbt.tsx` | Added onBroadcastSuccess callback; error sheet init fix |

## Backward Compatibility

- Watch-only wallets continue to see the simple PSBT export view (QR + Copy + Share)
- The multisig signature manager only appears for `walletCapability === 'multisig'`
- Existing `exportPSBT()` behavior is preserved — it still creates the PSBT and partial-signs with the first local key
- The new screen adds functionality on top of what was already there

## Verification

1. `npx tsc --noEmit` — zero errors
2. Create 2-of-3 multisig wallet with all keys local → PSBT screen shows all cosigners, "Sign Locally" button signs with all available keys, "Finalize & Broadcast" appears when 2 signatures collected
3. Create multisig wallet with 1 local + 2 external keys → PSBT screen shows 1 signed (local), import options for remaining signatures
4. Import signed PSBT via clipboard → signatures merge, status updates
5. Import signed PSBT via QR scan → signatures merge
6. Import signed PSBT via file → binary and base64 files both work
7. When m signatures collected → "Finalize & Broadcast" button appears, user confirms, transaction broadcasts
8. Share/export PSBT still works (QR, copy, share)
9. Watch-only wallet → shows simple export view (unchanged from before)
10. After broadcast → navigates to send-success screen
