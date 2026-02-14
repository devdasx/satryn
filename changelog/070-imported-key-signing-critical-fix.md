# 070 — Fix "Expected Private" Error When Sending from Imported WIF Key Wallets

## Overview
Fixed three critical bugs in the transaction signing flow for imported WIF private key wallets that caused an "Expected Private" error when attempting to send Bitcoin. The root causes were: (1) the private key being destroyed after signing the first UTXO input, making subsequent inputs fail; (2) a single global address type flag applied to all inputs instead of per-input detection; and (3) incorrect address type detection using `addresses[0]` instead of the wallet's stored `preferredAddressType`.

## Bug Description

### Symptoms
- User imports a WIF private key (e.g., `KydUMD5w...`)
- User attempts to send Bitcoin
- Transaction fails with error: **"Expected Private"**
- The `PaymentErrorSheet` shows "Transaction Error — An unexpected error occurred while processing your transaction" with technical detail "Expected Private"

### Error Origin
The "Expected Private" error comes from `@bitcoinerlab/secp256k1`'s `isPrivate()` validation check, which verifies that a private key is:
- A valid `Uint8Array` or `Buffer`
- Exactly 32 bytes
- Within valid secp256k1 scalar range (> 0 and < curve order)

A zero-filled buffer (all 0x00 bytes) fails this check because zero is not a valid private key.

## Root Causes

### Bug 1: Private Key Destroyed After First Input (Critical)

**File**: `src/core/transaction/TransactionBuilder.ts` — `signWithImportedKey()`

**Problem**: Inside the signing loop, after signing each input, the code called `keyPair.privateKey.fill(0)` to "clear sensitive data". However, `ImportedKeySigner.getSigningKeyPair()` returned a **reference** to the internal `this.keyPair.privateKey` buffer — not a copy. This meant `.fill(0)` **mutated the original private key in memory**, destroying it for all subsequent inputs.

**Sequence**:
1. Input 0: `getSigningKeyPair()` → returns reference to internal key → signs successfully → `keyPair.privateKey.fill(0)` → **destroys the original key**
2. Input 1: `getSigningKeyPair()` → returns reference to now-zeroed key → `ecc.sign()` calls `isPrivate(zeroed_key)` → **"Expected Private"** error

**Why it wasn't always hit**: Wallets with a single UTXO would succeed (only 1 input). The bug only manifests with **2+ UTXOs** (multiple inputs from the same key).

**Contrast with HD flow**: `KeyDerivation.getSigningKeyPair()` returns a copy via `new Uint8Array(child.privateKey)`, so `.fill(0)` in the HD path is safe.

### Bug 2: Global Address Type Instead of Per-Input Detection

**File**: `src/core/transaction/TransactionBuilder.ts` — `signWithImportedKey()`

**Problem**: The method used a single `isTaproot` boolean (line 517) derived from `importedKeySigner.getAddressType()`. This applied the same signing algorithm (Schnorr vs ECDSA) to **all** inputs. However, an imported key wallet stores addresses for **all 4 address types** (native segwit, taproot, wrapped segwit, legacy), and UTXOs could exist on any of them.

**Scenario**: If the signer was configured as `native_segwit` but a UTXO existed on the Taproot address, the code would attempt ECDSA signing on a Taproot input, which would fail. Conversely, if configured as `taproot`, it would attempt Schnorr signing on a non-Taproot input.

### Bug 3: Wrong Address Type Detection in Send Flow

**Files**: `src/components/send/useSendFlow.ts`, `src/components/send-v3/useSendFlowV3.ts`

**Problem**: Both send flows detected the address type for the `ImportedKeySigner` by inspecting `addresses[0]?.address`. But the wallet stores ALL address types in a fixed order: `[native_segwit, taproot, wrapped_segwit, legacy]`. So `addresses[0]` was **always** the native_segwit address, regardless of the user's chosen import type.

**Impact**: If a user imported with Taproot as preferred type, the signer would still be created with `native_segwit`, causing signing mismatches.

## Fixes

### Fix 1: Move Key Cleanup Outside the Loop

**File**: `src/core/transaction/TransactionBuilder.ts`

- **Removed**: `keyPair.privateKey.fill(0)` from inside the for-loop (was at old line 571)
- **Added**: `importedKeySigner.destroy()` after the loop completes (line 592)
- The private key now survives across all input iterations and is only cleaned up once all inputs are signed
- Added explicit comments explaining why the key must not be zeroed inside the loop

### Fix 2: Per-Input Address Type Detection

**File**: `src/core/transaction/TransactionBuilder.ts`

- **Removed**: Global `isTaproot` flag based on `importedKeySigner.getAddressType()`
- **Added**: Per-input Taproot detection by inspecting PSBT input fields:
  ```typescript
  const isTaprootInput = !!input.tapInternalKey || (
    input.witnessUtxo?.script &&
    input.witnessUtxo.script.length === 34 &&
    input.witnessUtxo.script[0] === 0x51  // OP_1 = P2TR
  );
  ```
- **Added**: Per-input wrapped segwit detection for redeemScript injection:
  ```typescript
  const isWrappedSegwit = !input.redeemScript &&
    input.witnessUtxo?.script &&
    input.witnessUtxo.script.length === 23 &&
    input.witnessUtxo.script[0] === 0xa9;  // OP_HASH160 = P2SH
  ```
- Each input is now signed with the correct algorithm based on its actual script type

### Fix 3: Use `preferredAddressType` from Wallet Store

**Files**: `src/components/send/useSendFlow.ts`, `src/components/send-v3/useSendFlowV3.ts`

- **Removed**: Address type guessing from `addresses[0]?.address` prefix
- **Added**: Direct read from `useWalletStore.getState().preferredAddressType`
- This uses the exact address type the user chose during import

### New Methods in ImportedKeySigner

**File**: `src/core/wallet/ImportedKeySigner.ts`

- **Added `getTaprootKeyPairFromRawKey()`**: Same logic as `getTaprootKeyPair()` but without the `addressType !== TAPROOT` guard. Used by `signWithImportedKey()` when it detects a Taproot input regardless of the signer's configured address type. Creates Buffer copies so `.fill(0)` is safe per-input.

- **Added `getRedeemScriptForKey()`**: Same logic as `getRedeemScript()` but without the `addressType !== WRAPPED_SEGWIT` guard. Used when a wrapped segwit input is detected regardless of the signer's configured type.

- **Refactored `getTaprootKeyPair()`**: Now delegates to `getTaprootKeyPairFromRawKey()` after the address type guard check.

- **Refactored `getRedeemScript()`**: Now delegates to `getRedeemScriptForKey()` after the address type guard check.

## Audit Summary — All Wallet Types

| Wallet Type | Send Flow | Signing Method | Status |
|-------------|-----------|---------------|--------|
| `hd` (mnemonic) | `useSendFlow` | `KeyDerivation` → `sign()` | Safe (returns copies) |
| `hd_xprv` | `useSendFlow` | `KeyDerivation.fromXprv()` → `sign()` | Safe |
| `hd_electrum` | `useSendFlow` | `KeyDerivation` → `sign()` | Safe |
| `hd_seed` | `useSendFlow` | `KeyDerivation.fromSeedHex()` → `sign()` | Safe |
| `hd_descriptor` | `useSendFlow` | `KeyDerivation` → `sign()` | Safe |
| `imported_key` | `useSendFlow` | `ImportedKeySigner` → `signWithImportedKey()` | **Fixed** |
| `watch_xpub` | `useSendFlow` | Unsigned PSBT only | Safe (no signing) |
| `watch_descriptor` | `useSendFlow` | Unsigned PSBT only | Safe |
| `watch_addresses` | `useSendFlow` | Unsigned PSBT only | Safe |
| `multisig` | Separate screen | Not in this flow | N/A |

## Files Changed

| File | Changes |
|------|---------|
| `src/core/transaction/TransactionBuilder.ts` | Rewrote `signWithImportedKey()`: per-input type detection, moved key cleanup outside loop, uses new signer methods |
| `src/core/wallet/ImportedKeySigner.ts` | Added `getTaprootKeyPairFromRawKey()` and `getRedeemScriptForKey()` methods; refactored existing methods to delegate |
| `src/components/send/useSendFlow.ts` | `imported_key` case: use `preferredAddressType` from store instead of `addresses[0]` |
| `src/components/send-v3/useSendFlowV3.ts` | Same fix as useSendFlow.ts |

## TypeScript
Compiles with 0 errors after all changes.
