# 111 — Fix Multisig PSBT Missing bip32Derivation + witnessScript

## Date
2025-02-11

## Summary

Fixed the root cause of multisig signing failure: PSBT inputs were missing `bip32Derivation` metadata and `witnessScript`, causing `signMultisigPSBT()` to silently skip every input. Added a post-processing step in `exportPSBT()` that reconstructs `MultisigWallet` and injects the required metadata into each PSBT input.

---

## Root Cause Analysis

### The Logs Revealed
```
[PSBTService.signMultisig] Input 0: NO bip32Derivation metadata
[PSBTService.signMultisig] Input 0: SKIP — no matching bip32Derivation for our fingerprint
[PSBTService.signMultisig] DONE — signed 0 of 1 inputs
```

### Why bip32Derivation Was Missing
`TransactionBuilder` (used by `exportPSBT()` to construct the PSBT) is a general-purpose builder that creates standard PSBTs. It does NOT add multisig-specific metadata:
- No `bip32Derivation` (maps public keys to master fingerprints)
- No `witnessScript` (the P2WSH witness script for multisig)
- No `redeemScript` (for P2SH-P2WSH)

The project DOES have `MultisigWallet.createPSBT()` which adds all this metadata correctly, but `sendStore.exportPSBT()` uses `TransactionBuilder` instead (to support the shared build logic for all wallet types).

### Why witnessScript Was Missing
The database (`AddressRow` schema) does not store `witnessScript` or `redeemScript` for addresses. When addresses are loaded from DB, these fields are `undefined`. The code tried `(addr as any).witnessScript` which was always `undefined`.

### Why signMultisigPSBT Silently Skipped
The signing code checked `if (input.bip32Derivation) { ... } else { continue; }` — when bip32Derivation was absent, it skipped the input without error. The function returned `true` to the caller (no exception thrown), so the UI showed "success" but no actual signature was added.

---

## Fix 1: Post-Process PSBT with Multisig Metadata (sendStore.ts)

After `TransactionBuilder` builds the PSBT, added a new block that:

1. Reconstructs a `MultisigWallet` instance from `walletStore.multisigConfig` (which has all xpubs, fingerprints, and derivation paths)
2. For each address in the wallet, calls `msWallet.deriveAddress(index, isChange)` to get:
   - `witnessScript` (for P2WSH)
   - `redeemScript` (for P2SH-P2WSH)
   - `publicKeys` (sorted order)
   - `pubkeyToFingerprint` (maps each pubkey hex → cosigner fingerprint)
3. For each PSBT input, matches the input address to the derived info and adds:
   - `witnessScript` via `psbt.updateInput(i, { witnessScript })`
   - `redeemScript` via `psbt.updateInput(i, { redeemScript })`
   - `bip32Derivation` array with `{ masterFingerprint, pubkey, path }` for each cosigner

### File Changed
- `src/stores/sendStore.ts` — new post-processing block in `exportPSBT()`, between PSBT build and signing

---

## Fix 2: Signing Fallback When bip32Derivation Missing (PSBTService.ts)

Added a fallback in `signMultisigPSBT()`: when `bip32Derivation` is absent on an input but the address IS in the `addressToPathMap`, sign using the path from pathInfo directly.

Before:
```typescript
if (input.bip32Derivation) {
  // ... match fingerprint
} else {
  continue; // ← SILENTLY SKIPPED
}
```

After:
```typescript
if (input.bip32Derivation) {
  // ... match fingerprint
} else {
  // FALLBACK: sign based on address/path match alone
  shouldSign = true;
}
```

This ensures signing works even if metadata injection fails for any reason.

### File Changed
- `src/services/psbt/PSBTService.ts` — fallback in `signMultisigPSBT()`

---

## Fix 3: Added MultisigWallet Import

- `src/stores/sendStore.ts` — added `MultisigWallet` to imports from `'../core/wallet'`
- `src/stores/sendStore.ts` — added `MultisigScriptType`, `CosignerInfo` to type imports from `'../types'`

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/sendStore.ts` | Post-process PSBT with bip32Derivation + witnessScript; new imports |
| `src/services/psbt/PSBTService.ts` | Fallback signing when bip32Derivation is missing |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Create 2-of-3 multisig → Export PSBT → Logs show:
   - `[exportPSBT] Input X: added witnessScript`
   - `[exportPSBT] Input X: added bip32Derivation with 3 entries`
3. Press "Sign" on any cosigner → Logs show:
   - `[PSBTService.signMultisig] Input X: bip32Deriv fp=..., matchesOurs=true`
   - `[PSBTService.signMultisig] Input X: ✓ SIGNED successfully`
4. Signature count increments on screen after each sign
5. After m signatures → "Finalize & Broadcast" appears
