# 117 — Fix Multisig Signing Using Wrong Derivation Path (BIP44 vs BIP48)

## Date
2025-02-11

## Summary

Fixed multisig signing failing with "Can not sign for this input with the key" because `signMultisigPSBT()` was deriving the signing key from the wrong BIP derivation path. It used `pathInfo.path` from the `addressToPathMap` (which could be a BIP44 legacy path like `m/44'/0'/0'/1/0`) instead of the correct BIP48 multisig path (`m/48'/0'/0'/2'/1/0`) available in the PSBT's `bip32Derivation` metadata.

---

## Root Cause

### Why the wrong path was used

`signMultisigPSBT()` found the correct input address in the `addressToPathMap` and checked `bip32Derivation` to confirm the fingerprint matched. However, when deriving the actual signing key, it used `pathInfo.path` (from the addressToPathMap) rather than `ourDerivation.path` (from bip32Derivation).

The `addressToPathMap` is built from `walletStore.addresses` — which for this wallet contained 210 addresses across multiple BIP standards (BIP44 legacy `1...`, BIP49 wrapped `3...`, BIP84 native segwit `bc1q...`, BIP86 taproot `bc1p...`). The multisig address `1EFQFChGxfCcjd8JRjPqD1N1CRnMeMWaYz` appeared in this map with a BIP44 path (`m/44'/0'/0'/1/0`), but the correct signing path for multisig is BIP48 (`m/48'/0'/0'/2'/1/0`).

### What happened

```
Input 0: address=1EFQFChGxfCcjd8JRjPqD1N1CRnMeMWaYz
Input 0: bip32Deriv fp=8798482d, path=m/48'/0'/0'/2'/1/0, matchesOurs=true
Input 0: WILL SIGN — signing with pathInfo.path=m/44'/0'/0'/1/0  ← WRONG PATH
Input 0: ✗ Failed to sign: Can not sign for this input with the key 026124e...
```

The key derived at `m/44'` is completely different from the key at `m/48'`, so bitcoinjs-lib rejected it because the public key didn't match any key in the PSBT's `bip32Derivation`.

### Why `path=undefined` in the first auto-sign attempt

During `exportPSBT()`, the auto-signing used `inputPaths` (a simple address→path map) which had the address but with `undefined` path because the address didn't have a path set in the `AddressInfo` object. This caused `Cannot read property 'startsWith' of undefined` when `getSigningKeyPair()` tried to parse the path.

---

## Fix: Prioritize bip32Derivation Path Over addressToPathMap Path

Changed `signMultisigPSBT()` to use the derivation path from bip32Derivation (PSBT metadata) when available, falling back to `pathInfo.path` only when there's no bip32Derivation:

```typescript
// Before: always used pathInfo.path (could be BIP44)
const keyPair = keyDerivation.getSigningKeyPair(pathInfo.path);

// After: prioritize bip32Derivation path (correct BIP48)
const signingPath = ourDerivation?.path || pathInfo.path;

if (!signingPath) {
  console.log(`Input ${i}: SKIP — no derivation path available`);
  continue;
}

const keyPair = keyDerivation.getSigningKeyPair(signingPath);
```

Also added a `continue` guard for `undefined` paths, preventing the `startsWith` crash.

### File Changed
- `src/services/psbt/PSBTService.ts` — `signMultisigPSBT()` method

---

## Why the addressToPathMap Had Mixed BIP Paths

The `addressToPathMap` is built from `walletStore.addresses`, which contained 210 addresses across BIP44/49/84/86 standards. For HD wallets, the sync pipeline discovers addresses across all 4 BIP standards for gap limit scanning. When switching to a multisig wallet, if the DB had pre-existing HD addresses stored under the same wallet ID, or if the address map was contaminated from a previous wallet's data, the multisig signing would pick up the wrong BIP path.

The bip32Derivation in the PSBT is the authoritative source of truth — it's set during PSBT construction and always contains the correct multisig derivation path.

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/psbt/PSBTService.ts` | `signMultisigPSBT()` — prioritize bip32Derivation path over addressToPathMap path for key derivation; skip inputs with no path |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Multisig sign → logs show: `WILL SIGN — bip32Path=m/48'/0'/0'/2'/1/0, using signingPath=m/48'/0'/0'/2'/1/0`
3. Signs successfully — no more "Can not sign for this input with the key" error
4. Signature count increments after each cosigner signs
5. Auto-sign during exportPSBT — no more `startsWith of undefined` crash
