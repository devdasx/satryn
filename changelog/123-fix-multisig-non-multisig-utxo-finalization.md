# 123 — Fix Multisig Send Failing with Non-Multisig UTXOs

## Date
2025-02-12

## Summary

Fixed "Need at least 1 signatures to finalize" error when sending from a multisig wallet that contains non-multisig UTXOs. Root cause: the wallet's UTXO set included UTXOs at P2PKH legacy addresses (e.g., `1FxNZW82B7X2H1E...`) from HD gap discovery that are NOT multisig addresses. These UTXOs can't be signed by multisig cosigners, causing the PSBT finalizer to fail on inputs with 0 signatures.

---

## Root Cause

Multisig wallets can have non-multisig addresses in their `walletStore.addresses` list. When building a transaction, the UTXO selector picks from ALL available UTXOs — including ones at these non-multisig addresses. The resulting PSBT has mixed inputs:

- **Input 0**: P2PKH address `1FxNZW82B7X2H1E...` — NOT multisig, 0 signatures, no witnessScript
- **Input 1**: P2WSH address `bc1q5lvx28...` — multisig, correctly signed by both cosigners

The `canFinalizeMultisig()` check required ALL inputs to have ≥M signatures, so it failed on Input 0.

## Fix (3 Parts)

### Part 1: Filter Non-Multisig UTXOs at Source

**File:** `src/stores/sendStore.ts`

Added `filterMultisigUtxos()` helper that uses `MultisigWallet.findAddress()` to verify each UTXO's address belongs to the multisig derivation. Applied in both `prepareTx()` and `exportPSBT()` for multisig wallets.

```typescript
function filterMultisigUtxos(utxos, multisigConfig, network) {
  const msWallet = MultisigWallet.fromConfig(config, network);
  return utxos.filter(u => msWallet.findAddress(u.address) !== null);
}
```

**Impact:** Prevents non-multisig UTXOs from being included in the PSBT in the first place. This is the primary fix.

### Part 2: Handle Mixed Inputs in canFinalizeMultisig()

**File:** `src/services/psbt/PSBTService.ts`

Added `isMultisigInput()` private method that checks for OP_CHECKMULTISIG in witnessScript/redeemScript. Updated `canFinalizeMultisig()` to:
- **Multisig inputs**: require M partial signatures (unchanged)
- **Non-multisig inputs**: require at least 1 partial signature or tapKeySig

**Impact:** Defense-in-depth — if a non-multisig input somehow makes it into the PSBT, it won't cause a false "need at least M signatures" error.

### Part 3: Handle Mixed Inputs in finalizeMultisig()

**File:** `src/services/psbt/PSBTService.ts`

Updated `finalizeMultisig()` to detect non-multisig inputs using `isMultisigInput()` and finalize them with the standard single-sig finalizer instead of the multisig-specific logic.

**Impact:** Defense-in-depth — non-multisig inputs are properly finalized if they have a single signature.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/stores/sendStore.ts` | Added `filterMultisigUtxos()`, applied in `prepareTx()` and `exportPSBT()` |
| `src/services/psbt/PSBTService.ts` | Added `isMultisigInput()`, updated `canFinalizeMultisig()` and `finalizeMultisig()` |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Multisig send with mixed UTXOs: non-multisig UTXOs are excluded, transaction builds and signs correctly
3. Multisig send with only multisig UTXOs: behavior unchanged
4. 1-of-2 multisig finalization: still works correctly with signature trimming
