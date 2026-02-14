# 110 — Fix Multisig Signing + Per-Cosigner Sign UI

## Date
2025-02-11

## Summary

Fixed critical multisig PSBT signing failures and redesigned the PSBT signing screen to show per-cosigner "Sign" / "Import" buttons instead of a single "Sign Locally" section. Each cosigner row is now interactive with modern premium styling.

---

## Bug Fix 1: `exportPSBT` Used Wrong Key Source for Multisig

### Root Cause
`exportPSBT()` called `keyDerivationFromSecureStorage(walletId, 'multisig', ...)` which internally falls through to `SecureStorage.retrieveSeed(pin)` — the global singleton seed. For multisig wallets, individual cosigner seeds are stored via `SecureStorage.storeLocalCosignerSeed()` during wallet creation, NOT in the wallets DB table. So the factory returned the wrong key with the wrong fingerprint, and no cosigner match was found.

### Fix
Replaced the entire multisig signing block in `exportPSBT()` with a two-strategy approach:
1. **Primary**: `SecureStorage.retrieveAllLocalCosignerSeeds(pin)` — iterates through all locally stored cosigner seeds (indices 0-14), signs with each matching fingerprint
2. **Fallback**: `SecureStorage.retrieveSeed(pin)` — tries the global seed in case it matches a cosigner (with duplicate-sign protection via PSBT status check)

Now `exportPSBT` auto-signs with ALL available local keys during initial PSBT creation.

### File Changed
- `src/stores/sendStore.ts` — lines 778-845 (exportPSBT multisig signing block)

---

## Bug Fix 2: Case-Sensitive Fingerprint Comparison

### Root Cause
`getMasterFingerprint()` returns **lowercase** hex (e.g., `341aae8d`), but stored cosigner fingerprints may be uppercase (e.g., `341AAE8D`). The old code used strict `===` comparison which silently failed.

### Fix
All fingerprint comparisons now use `.toUpperCase()` on both sides:
```typescript
c.fingerprint.toUpperCase() === fp.toUpperCase()
```
Applied consistently in: `exportPSBT`, `signWithLocalKeys`, `signWithSpecificCosigner`.

### Files Changed
- `src/stores/sendStore.ts`

---

## Change 3: New `signWithSpecificCosigner(pin, fingerprint)` Action

### Purpose
Signs the current PSBT with a single specific cosigner's key, identified by fingerprint. This powers the per-cosigner "Sign" buttons in the UI.

### Implementation
1. Finds the cosigner config by fingerprint (case-insensitive)
2. Iterates through `retrieveAllLocalCosignerSeeds(pin)` to find the matching seed
3. Signs with that specific key via `PSBTService.signMultisigPSBT()`
4. Falls back to global seed if no cosigner seed matches
5. Updates store (psbtBase64 + signatureStatus)
6. Throws descriptive error if no local key found for the fingerprint

### File Changed
- `src/stores/sendStore.ts` — new action added to interface and implementation

---

## Change 4: Redesigned Per-Cosigner Interactive UI

### Previous Design
- Cosigner rows were read-only (name + fingerprint + "Signed" / "Awaiting")
- Separate "SIGN LOCALLY" card section below cosigners with a single "Sign" button
- Separate "IMPORT SIGNATURES" section with a single "Import" button
- No way to know which specific cosigner you're signing with

### New Design
Each cosigner row is now interactive with three states:

| State | Display |
|-------|---------|
| **Signed** | Green check icon + "Signed" badge (read-only) |
| **Local & unsigned** | Key icon + orange "Sign" button (taps → `signWithSpecificCosigner`) |
| **External & unsigned** | Globe icon + gray "Import" button (taps → PSBTImportSheet) |

Additional UI improvements:
- Larger progress ring (96px) with cleaner number/label layout
- "Local" / "External" type badges on each cosigner row
- Monospace fingerprint display with dot separator
- Broadcast card with rocket icon when all signatures collected
- Share section collapsed by default (with share icon in header)
- Removed separate "SIGN LOCALLY" and "IMPORT SIGNATURES" sections entirely

### Files Changed
- `src/components/send/CosignerSignatureRow.tsx` — Added `onSign`, `onImport`, `isSigning` props; 3-state rendering (signed/local-sign/external-import); new icon system (key/globe/check); type badges
- `src/components/send/StepPSBT.tsx` — Removed `isSigningLocally` and `handleSignLocally`; added per-cosigner `handleSignCosigner`; removed "SIGN LOCALLY" and "IMPORT SIGNATURES" sections; added broadcast card; redesigned share section

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/sendStore.ts` | Fixed exportPSBT key source + fingerprint comparison; new `signWithSpecificCosigner` action |
| `src/components/send/StepPSBT.tsx` | Per-cosigner sign/import; removed "Sign Locally" section; premium broadcast card |
| `src/components/send/CosignerSignatureRow.tsx` | Interactive buttons; 3-state rendering; type badges; new icons |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Create 2-of-3 multisig with all keys local → exportPSBT auto-signs with all local keys → screen shows "2 of 2" or "3 of 2" immediately
3. Each unsigned local cosigner row shows orange "Sign" button → tapping signs with that specific cosigner
4. External cosigner rows show "Import" button → opens PSBTImportSheet
5. When m signatures collected → "Finalize & Broadcast" card appears
6. Broadcast works correctly
7. Share section collapsed by default, expandable for external signing
