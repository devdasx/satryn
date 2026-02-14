# 115 — Fix Multisig Signing for nonWitnessUtxo Inputs

## Date
2025-02-11

## Summary

Fixed multisig signing failing with "SKIP — no witnessUtxo" for every input. The PSBT inputs were built with `nonWitnessUtxo` (full raw transaction) instead of `witnessUtxo`, but both `signMultisigPSBT()` and the `exportPSBT()` metadata post-processing only handled `witnessUtxo` inputs — silently skipping `nonWitnessUtxo` inputs entirely.

---

## Root Cause

### Why inputs had `nonWitnessUtxo` instead of `witnessUtxo`

`TransactionBuilder.addInput()` uses `detectAddressType(utxo.address)` to decide between `witnessUtxo` (segwit) and `nonWitnessUtxo` (legacy). If the UTXO address starts with `1` (P2PKH legacy), the input gets `nonWitnessUtxo` — the full raw transaction hex.

The multisig wallet's UTXOs came from addresses classified as legacy, causing all inputs to use `nonWitnessUtxo`.

### Why signing failed

`signMultisigPSBT()` had this early check:
```typescript
if (!input.witnessUtxo) {
  console.log(`Input ${i}: SKIP — no witnessUtxo`);
  continue;  // ← Skipped ALL inputs
}
```

It only knew how to extract addresses from `witnessUtxo.script`, completely ignoring `nonWitnessUtxo` inputs.

### Why metadata injection failed

The `exportPSBT()` post-processing that adds `witnessScript` and `bip32Derivation` also only checked `witnessUtxo`:
```typescript
if (!input.witnessUtxo) continue;  // ← Skipped ALL inputs
```

This meant 0 addresses were collected, 0 metadata entries were added, and signing had no bip32Derivation to match against.

---

## Fix 1: `signMultisigPSBT()` — Handle nonWitnessUtxo (PSBTService.ts)

Changed the address extraction to support both UTXO types:

```typescript
// Before: only witnessUtxo
if (!input.witnessUtxo) { continue; }
address = bitcoin.address.fromOutputScript(input.witnessUtxo.script, network);

// After: witnessUtxo OR nonWitnessUtxo
if (input.witnessUtxo) {
  address = bitcoin.address.fromOutputScript(input.witnessUtxo.script, network);
} else if (input.nonWitnessUtxo) {
  const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
  const output = prevTx.outs[txInput.index];
  address = bitcoin.address.fromOutputScript(output.script, network);
}
```

### File Changed
- `src/services/psbt/PSBTService.ts` — `signMultisigPSBT()` method

---

## Fix 2: `exportPSBT()` Metadata Post-Processing — Handle nonWitnessUtxo (sendStore.ts)

Fixed both loops in the metadata injection block:

**Step 1 (input address collection):** Now extracts addresses from both `witnessUtxo` and `nonWitnessUtxo` inputs using `bitcoin.Transaction.fromBuffer()` to parse the full raw transaction.

**Step 2 (metadata injection per input):** Same fix — decodes addresses from either UTXO type before looking up multisig metadata.

### File Changed
- `src/stores/sendStore.ts` — `exportPSBT()` multisig metadata block

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/psbt/PSBTService.ts` | `signMultisigPSBT()` — handle nonWitnessUtxo inputs for address extraction |
| `src/stores/sendStore.ts` | `exportPSBT()` — handle nonWitnessUtxo in both address collection and metadata injection loops |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Create multisig wallet → Send → PSBT screen shows correct signature count
3. Logs show: `PSBT has 1 unique input address(es)` (not 0)
4. Logs show: `derived 1 of 1 input address infos` (not 0 of 0)
5. Press "Sign" → Logs show actual signing (not "SKIP — no witnessUtxo")
6. Signature count increments after each sign
