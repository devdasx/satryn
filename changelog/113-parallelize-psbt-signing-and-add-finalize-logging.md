# 113 — Parallelize PSBT Signing + Add Finalize/Broadcast Debug Logging

## Date
2025-02-11

## Summary

Major performance improvement: parallelized all async I/O operations in the PSBT signing pipeline using `Promise.all`. Added detailed diagnostic logging throughout `finalizeAndBroadcast` and `finalizeMultisig` to debug the persistent CHECKMULTISIG broadcast error.

---

## Performance Fix 1: Parallel Seed Retrieval in `retrieveAllLocalCosignerSeeds`

### Root Cause
`SecureStorage.retrieveAllLocalCosignerSeeds()` tried 15 cosigner indices **sequentially** — each call does 2-3 `SecureStore.getItemAsync` reads + PIN verification. With 15 sequential iterations, this alone took ~1-2 seconds.

### Fix
Changed from sequential `for` loop to `Promise.all` with parallel retrieval:
```typescript
// Before: 15 sequential calls (~1-2s)
for (let i = 0; i < 15; i++) {
  const seed = await this.retrieveLocalCosignerSeed(i, pin);
}

// After: 15 parallel calls (~100ms)
const promises = Array.from({ length: 15 }, (_, i) =>
  this.retrieveLocalCosignerSeed(i, pin).then(seed => seed ? { index: i, seed } : null).catch(() => null)
);
const settled = await Promise.all(promises);
```

### File Changed
- `src/services/storage/SecureStorage.ts` — `retrieveAllLocalCosignerSeeds()`

---

## Performance Fix 2: Parallel Seed Prefetch in `exportPSBT`

### Root Cause
`exportPSBT` had 3 sequential async phases: enrichUTXOs → fetch seeds → sign. The seed fetching waited for UTXO enrichment to finish, even though they're independent.

### Fix
Start seed retrieval in parallel with UTXO enrichment:
```typescript
// Start seed fetching before awaiting UTXO enrichment
let seedsPromise = SecureStorage.retrieveAllLocalCosignerSeeds(pin);
let globalSeedPromise = SecureStorage.retrieveSeed(pin);

// These run concurrently
availableUtxos = await enrichLegacyUtxos(availableUtxos, network);

// Seeds are already fetched by the time we need them
const [localSeeds, globalSeed] = await Promise.all([seedsPromise, globalSeedPromise]);
```

Also replaced the duplicate-check via `getMultisigSignatureStatus` with a simple `signedFingerprints` Set for faster duplicate prevention.

Added timing logs throughout: `[exportPSBT] DONE — total Xms`.

### File Changed
- `src/stores/sendStore.ts` — `exportPSBT()`

---

## Performance Fix 3: Parallel Seed Fetch in `signWithSpecificCosigner`

### Root Cause
`signWithSpecificCosigner` fetched local cosigner seeds first, then if no match, fetched global seed. Two sequential async operations.

### Fix
Fetch both in parallel with `Promise.all`:
```typescript
const [localSeeds, globalSeed] = await Promise.all([
  SecureStorage.retrieveAllLocalCosignerSeeds(pin),
  SecureStorage.retrieveSeed(pin),
]);
```

Also cleaned up verbose debug logging, replaced with concise timing-aware logs, and extracted a `signAndUpdate` helper to reduce code duplication.

### File Changed
- `src/stores/sendStore.ts` — `signWithSpecificCosigner()`

---

## Performance Fix 4: Parallel Seed Fetch in `signWithLocalKeys`

### Root Cause
`signWithLocalKeys` had 3 sequential async operations: wallet DB key → local cosigner seeds → global seed. Each waited for the previous to complete.

### Fix
Fetch all 3 seed sources in parallel:
```typescript
const [walletKeyResult, localSeeds, globalSeed] = await Promise.all([
  keyDerivationFromSecureStorage(walletId, 'multisig', network, pin).then(kd => ({ kd, error: null })).catch(err => ({ kd: null, error: err.message })),
  SecureStorage.retrieveAllLocalCosignerSeeds(pin),
  SecureStorage.retrieveSeed(pin),
]);
```

Also replaced expensive `getMultisigSignatureStatus` calls between each signing round with a simple `signedFingerprints` Set to track which fingerprints have already been signed.

### File Changed
- `src/stores/sendStore.ts` — `signWithLocalKeys()`

---

## Debug Logging: `finalizeAndBroadcast`

Added comprehensive logging to diagnose the persistent CHECKMULTISIG error:

- **Before finalization**: Logs each input's `partialSig` count, pubkey prefixes, witnessScript presence/length
- **After finalization**: Logs `finalScriptWitness` length, first byte (should be witness item count), hex preview
- **After extractTransaction**: Logs txid, hex length, and first/last 100 chars of raw hex
- **On error**: Logs full error message and stack trace with timing
- All logs include elapsed time via `Date.now() - t0` for performance profiling

### File Changed
- `src/stores/sendStore.ts` — `finalizeAndBroadcast()`

---

## Debug Logging: `finalizeMultisig` (PSBTService)

Enhanced logging in the finalization method:

- **Pre-finalization**: Logs partial signature pubkey prefixes, witnessScript hex preview, bip32Derivation count
- **Default finalizer success**: Logs finalized witness length, first byte hex, and hex preview
- **Default finalizer failure**: Logs the exact error message
- **Custom finalizer success**: Logs witness hex preview to compare with default finalizer output
- **Error details**: Includes state info in error messages (sig count, ws/rs presence)

### File Changed
- `src/services/psbt/PSBTService.ts` — `finalizeMultisig()`

---

## Expected Performance Improvement

| Operation | Before | After | Speedup |
|-----------|--------|-------|---------|
| `retrieveAllLocalCosignerSeeds` | ~1-2s (15 sequential) | ~100ms (15 parallel) | **10-20×** |
| `exportPSBT` (multisig) | ~2-3s (sequential seed+sign) | ~500ms (parallel prefetch) | **4-6×** |
| `signWithSpecificCosigner` | ~1.5s (sequential fetch) | ~200ms (parallel fetch) | **5-7×** |
| `signWithLocalKeys` | ~3s (3 sequential strategies) | ~500ms (parallel fetch) | **5-6×** |

---

## All Files Modified

| File | Change |
|------|--------|
| `src/services/storage/SecureStorage.ts` | Parallel `retrieveAllLocalCosignerSeeds` |
| `src/stores/sendStore.ts` | Parallel seed fetch in `exportPSBT`, `signWithSpecificCosigner`, `signWithLocalKeys`; detailed `finalizeAndBroadcast` logging |
| `src/services/psbt/PSBTService.ts` | Detailed `finalizeMultisig` logging with witness hex inspection |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Export PSBT → console shows timing: `[exportPSBT] DONE — total Xms` (should be <1s vs 2-3s before)
3. Press "Sign" on cosigner → console shows timing: `[signWithSpecificCosigner] ✓ SIGNED via seed[0] — Xms` (should be <500ms)
4. Press "Finalize & Broadcast" → console shows:
   - Pre-finalization PSBT state (sigs, witnessScript, etc.)
   - Which finalizer strategy succeeded
   - Finalized witness hex data (for CHECKMULTISIG debugging)
   - Raw transaction hex preview
   - Broadcast result or detailed error with stack trace
5. All seed retrieval now uses `Promise.all` (verify via timing logs)
