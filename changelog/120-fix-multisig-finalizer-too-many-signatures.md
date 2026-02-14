# 120 — Fix Multisig Finalizer: Too Many Signatures for M-of-N

## Date
2025-02-11

## Summary

Fixed "Dummy CHECKMULTISIG argument must be zero" broadcast error caused by the multisig PSBT finalizer including ALL partial signatures in the witness stack instead of exactly `M` (the required threshold). For a 1-of-2 multisig where both cosigners signed, the finalizer produced a witness with 2 signatures, but `OP_CHECKMULTISIG` for `m=1` expects exactly 1 signature. The extra signature shifted the stack, causing the OP_0 dummy element to be consumed as a signature instead of the dummy.

---

## Root Cause

### How OP_CHECKMULTISIG works

`OP_CHECKMULTISIG` pops items from the stack in this order:
1. `n` — number of public keys
2. `n` public keys
3. `m` — number of required signatures
4. `m` signatures
5. **One extra dummy element** (the "off-by-one bug" — must be OP_0/empty)

For a 1-of-2 multisig, the correct witness stack is:
```
[OP_0(dummy), sig1, witnessScript]
```

### What the bug produced

The `createMultisigFinalizer` iterated over ALL pubkeys in the witnessScript and added a signature for every matching partial sig. With 2 cosigners both signing (2 partial sigs), it produced:
```
[OP_0(dummy), sig1, sig2, witnessScript]
```

`OP_CHECKMULTISIG` with `m=1` then consumed:
- `sig2` as the one required signature
- `sig1` as the dummy element

But `sig1` is NOT zero, causing: **"Dummy CHECKMULTISIG argument must be zero"**

### Why the default finalizer also failed

bitcoinjs-lib's default `finalizeInput()` also checks `partialSig.length > m` and throws "Too many signatures" before even attempting finalization. So both Strategy 1 (default) and Strategy 2 (custom) failed.

### Log evidence

```
Input 0: sigs=2 [0294bfa6, 039855aa], ws=51210294bfa66b2dfeb7..., m=1
Input 0: default finalizer FAILED: Too many signatures
Input 0: ✓ CUSTOM P2WSH — witnessLen=219  ← includes BOTH sigs (wrong)
```

---

## Fix: Three-Part Solution

### Part 1: Trim partialSig before default finalizer (in `finalizeMultisig`)

Added a pre-processing step that parses `M` from the witnessScript/redeemScript and trims `input.partialSig` to exactly `M` entries before passing to ANY finalizer:

```typescript
const multisigScript = input.witnessScript || input.redeemScript;
if (multisigScript && input.partialSig?.length > 0) {
  const firstByte = multisigScript[0]; // OP_1=0x51 → m=1, OP_2=0x52 → m=2
  const m = firstByte - 0x50;
  if (input.partialSig.length > m) {
    // Keep only M signatures, ordered by pubkey position in script
    const orderedSigs = [];
    for (const scriptPubkey of pubkeysInScript) {
      const match = input.partialSig.find(ps => pubkeyMatches(ps, scriptPubkey));
      if (match) orderedSigs.push(match);
      if (orderedSigs.length >= m) break;
    }
    input.partialSig = orderedSigs;
  }
}
```

This ensures the default `psbt.finalizeInput()` no longer throws "Too many signatures".

### Part 2: Fix `createMultisigFinalizer` (P2WSH custom finalizer)

Added `M` parsing and `break` when `orderedSigs.length >= m`:

```typescript
const m = wsBuffer[0] - 0x50; // Parse M from OP_M
for (const scriptPubkey of pubkeysInScript) {
  const match = partialSigs.find(ps => pubkeyMatches(ps, scriptPubkey));
  if (match) orderedSigs.push(match.signature);
  if (orderedSigs.length >= m) break;  // ← NEW: stop at M
}
```

### Part 3: Fix `createP2shMultisigFinalizer` (P2SH legacy custom finalizer)

Same `M` parsing and `break` logic applied.

---

## How M is parsed from the script

A standard multisig script looks like:
```
OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG
```

- `OP_M` is the first byte: `0x51` = OP_1 (m=1), `0x52` = OP_2 (m=2), etc.
- `OP_N` is near the end: `0x52` = OP_2 (n=2), `0x53` = OP_3 (n=3), etc.

Formula: `m = firstByte - 0x50`

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/psbt/PSBTService.ts` | `finalizeMultisig()` — trim partialSig to M before default finalizer; `createMultisigFinalizer()` — limit orderedSigs to M; `createP2shMultisigFinalizer()` — limit orderedSigs to M |

## Verification

1. `npx tsc --noEmit` — zero errors
2. 1-of-2 multisig: both cosigners sign, finalizer uses 1 signature → broadcast succeeds
3. 2-of-3 multisig: 3 cosigners sign, finalizer uses 2 signatures → broadcast succeeds
4. 2-of-2 multisig: both cosigners sign, no trimming needed → broadcast succeeds
5. Default finalizer no longer throws "Too many signatures"
6. Logs show: `trimming partialSig from 2 to 1 (m-of-n requires exactly m=1)`
