# 112 — Fix Multisig Finalize/Broadcast + Export Speed Optimization

## Date
2025-02-11

## Summary

Fixed two issues:
1. **CHECKMULTISIG broadcast error** — "mandatory-script-verify-flag-failed (Dummy CHECKMULTISIG argument must be zero)" caused by custom finalizer encoding the witness stack incorrectly. Fixed by using bitcoinjs-lib's default finalizer first (which correctly handles P2WSH multisig with OP_0 dummy element).
2. **Slow PSBT export screen** — PIN → export screen took very long because the post-processing step was deriving `MultisigAddressInfo` for ALL 190 wallet addresses. Optimized to only derive for PSBT input addresses (typically 1-3).

---

## Bug Fix 1: CHECKMULTISIG Dummy Element Error

### Root Cause
After changelog 111 added `witnessScript` and `bip32Derivation` to PSBT inputs, the signing worked correctly. However, `finalizeMultisig()` used a custom `createMultisigFinalizer()` which manually built the witness stack. The custom finalizer's witness encoding differed from what Bitcoin Core expects — specifically the OP_0 dummy element required by `OP_CHECKMULTISIG` was not being encoded correctly by the custom serialization.

### Fix
Rewrote `finalizeMultisig()` to use a two-strategy approach:

1. **Strategy 1 (Primary):** `psbt.finalizeInput(i)` — bitcoinjs-lib's built-in default finalizer. Now that `witnessScript` is present on PSBT inputs (from changelog 111 fix), the default finalizer correctly handles P2WSH multisig by using the `payments` module, which properly constructs the witness stack with `OP_0` as the first element.

2. **Strategy 2 (Fallback):** Custom finalizers (`createMultisigFinalizer`, `createP2shP2wshMultisigFinalizer`, `createP2shMultisigFinalizer`) only used if the default finalizer fails.

### File Changed
- `src/services/psbt/PSBTService.ts` — `finalizeMultisig()` method

---

## Fix 2: Slow PSBT Export Screen

### Root Cause
The post-processing block added in changelog 111 iterated ALL wallet addresses (~190) and called `msWallet.deriveAddress(index, isChange)` for each one. Each derivation involves BIP32 child key derivation for all cosigners + address generation, which is cryptographically expensive. With 190 addresses × 3 cosigners, this added significant delay between PIN entry and the PSBT screen appearing.

### Fix
Changed the post-processing to a two-step approach:
1. **Step 1:** Extract input addresses from the PSBT first (typically 1-3 inputs)
2. **Step 2:** Only derive `MultisigAddressInfo` for addresses that appear in PSBT inputs (skip all non-input addresses)

Before:
```
for (const addr of addresses) {  // 190 addresses → 190 derivations
  msWallet.deriveAddress(addrIndex, isChange);
}
```

After:
```
// Step 1: Collect input addresses from PSBT (1-3 typically)
const inputAddresses = new Set<string>();
for (let i = 0; i < psbt.inputCount; i++) { ... }

// Step 2: Only derive for input addresses
for (const addr of addresses) {
  if (!inputAddresses.has(addr.address)) continue;  // ← Skip non-inputs
  msWallet.deriveAddress(addrIndex, isChange);
}
```

This reduces derivation count from ~190 to ~1-3 (99%+ reduction).

### File Changed
- `src/stores/sendStore.ts` — post-processing block in `exportPSBT()`

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/psbt/PSBTService.ts` | `finalizeMultisig()` — try default finalizer first, custom fallback |
| `src/stores/sendStore.ts` | `exportPSBT()` — only derive multisig info for PSBT input addresses |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Create 2-of-3 multisig → Export PSBT → Screen loads quickly (no more long delay after PIN)
3. Logs show: `PSBT has 1 unique input address(es)` → `derived 1 of 1 input address infos`
4. Sign with cosigners → Finalize → Logs show: `✓ finalized with default finalizer`
5. Broadcast succeeds — no more "Dummy CHECKMULTISIG argument must be zero" error
6. Transaction appears on blockchain
