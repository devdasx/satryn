# 118 — Fix Multisig PSBT Metadata Injection for Non-Multisig Addresses

## Date
2025-02-11

## Summary

Fixed "Dummy CHECKMULTISIG argument must be zero" broadcast error caused by `exportPSBT()` injecting wrong `witnessScript`/`redeemScript` metadata onto PSBT inputs whose addresses were NOT actual multisig addresses. The metadata injection loop iterated over `walletStore.addresses` (which contained 190+ mixed BIP44/49/84/86 HD addresses under the same walletId), parsed the BIP44 path's chain/index, then derived a multisig address at that same index — producing a **different** address with mismatched scripts. Changed to use `MultisigWallet.findAddress()` which verifies the input address actually IS a multisig address before adding any metadata.

---

## Root Cause

### Why wrong metadata was injected

The `exportPSBT()` multisig metadata post-processing worked like this:

1. Collected input addresses from the PSBT
2. Iterated over ALL `walletStore.addresses` (190+ addresses across BIP44/49/84/86)
3. For each address that matched an input address, parsed its `path` (e.g., `m/44'/0'/0'/1/0`)
4. Extracted chain (`1`) and index (`0`) from the path
5. Called `msWallet.deriveAddress(0, true)` — deriving the multisig address at change index 0
6. Stored the result keyed by the **wallet address** (`1EFQFChGxfCcjd8JRjPqD1N1CRnMeMWaYz`)

The problem: the wallet address `1EFQ...` is a P2PKH (legacy) address from BIP44 HD discovery. The multisig address at the same index would be something completely different (e.g., `3xyz...` for P2SH or `bc1q...` for P2WSH). The `witnessScript`/`redeemScript` from the derived multisig address was attached to a non-multisig input.

### What happened during finalization

```
Input 0: address=1EFQFChGxfCcjd8JRjPqD1N1CRnMeMWaYz (P2PKH legacy)
  → witnessScript injected from multisig derivation at same index
  → redeemScript injected from multisig derivation at same index
  → Finalizer tried to create multisig witness with these scripts
  → OP_CHECKMULTISIG produced invalid scriptSig (no OP_0 dummy, or wrong script)
  → Node rejected: "Dummy CHECKMULTISIG argument must be zero"
```

### Why walletStore had 190+ mixed addresses

The multisig wallet's `walletStore.addresses` contained addresses from multiple BIP standards (BIP44 `1...`, BIP49 `3...`, BIP84 `bc1q...`, BIP86 `bc1p...`). These came from HD gap limit discovery being run on the multisig wallet's xpub across all 4 BIP standards. The actual multisig addresses (derived from `MultisigWallet.deriveAddress()`) may not have been in this list at all.

---

## Fix: Use `MultisigWallet.findAddress()` for Address Verification

Changed the metadata injection to use `MultisigWallet.findAddress(inputAddr)` which searches the actual multisig derivation tree (100 receiving + 100 change addresses) for a match. Only addresses that truly ARE multisig addresses get metadata injected.

```typescript
// Before: derived multisig info at same chain/index as walletStore path (could mismatch)
for (const addr of addresses) {
  if (!addr.path) continue;
  if (!inputAddresses.has(addr.address)) continue;
  const pathParts = addr.path.split('/');
  const addrIndex = parseInt(pathParts[pathParts.length - 1], 10);
  const isChange = pathParts[pathParts.length - 2] === '1';
  const msAddrInfo = msWallet.deriveAddress(addrIndex, isChange);
  addressToMultisigInfo.set(addr.address, msAddrInfo);  // ← Wrong: address ≠ msAddrInfo.address
}

// After: use findAddress() to verify actual multisig match
for (const inputAddr of inputAddresses) {
  try {
    const msAddrInfo = msWallet.findAddress(inputAddr);
    if (msAddrInfo) {
      addressToMultisigInfo.set(inputAddr, msAddrInfo);
      console.log(`... → multisig match at ${msAddrInfo.path}`);
    } else {
      console.log(`... → NOT a multisig address (skipping metadata)`);
    }
  } catch {}
}
```

### Why `findAddress()` is correct

`MultisigWallet.findAddress(address)` derives actual multisig addresses at each index (0–99 receiving, 0–99 change) and compares them against the input address. It returns `MultisigAddressInfo` only if the address was actually derived from the multisig setup — guaranteeing the `witnessScript`/`redeemScript` match the address.

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/sendStore.ts` | `exportPSBT()` — replaced path-based multisig derivation with `MultisigWallet.findAddress()` for address verification before injecting witnessScript/redeemScript/bip32Derivation metadata |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Multisig send → logs show `NOT a multisig address (skipping metadata)` for non-multisig inputs
3. Multisig send → logs show `multisig match at m/48'/0'/0'/2'/...` only for actual multisig addresses
4. No more "Dummy CHECKMULTISIG argument must be zero" broadcast error for properly matched multisig inputs
5. `addressToMultisigInfo` map only contains addresses with correct witnessScript/redeemScript
