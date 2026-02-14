# 126 — Convert Synchronous toSeedSync to Async toSeed

## Date
2025-02-12

## Summary

Converted all remaining `SeedGenerator.toSeedSync()` calls to the async `SeedGenerator.toSeed()` to eliminate JS thread blocking during BIP39 mnemonic-to-seed derivation (PBKDF2 with 2048 rounds of HMAC-SHA512). Each sync call blocks the JS thread for 100-200ms. In `sendStore.ts`, up to 6 sync calls could stack up during multisig signing flows, causing 600ms-1.2s of continuous blocking.

**Note:** BIP39 PBKDF2 itself CANNOT be removed — it's mandated by the Bitcoin standard (BIP-0039). Every Bitcoin wallet uses it. What we can do is make it async so the JS thread isn't blocked.

---

## Root Cause

`SeedGenerator.toSeedSync()` calls `bip39.mnemonicToSeedSync()` which performs 2048 rounds of HMAC-SHA512 synchronously. This blocks the JS thread for 100-200ms per call, freezing animations and touch handling.

In `sendStore.ts` multisig flows:
- `exportPSBT()` — 2 sync calls (cosigner seed + global seed)
- `signWithLocalKeys()` — 2 sync calls (cosigner seed + global seed)
- `signWithSpecificCosigner()` — 2 sync calls (cosigner seed + global seed)

Total: up to 6 blocking calls per signing flow = 600ms-1.2s freeze.

## Fix

Converted all `toSeedSync()` to `await toSeed()` (async version that uses `bip39.mnemonicToSeed()` which returns a Promise). All call sites were already in async functions.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/stores/sendStore.ts` | Converted 6 `SeedGenerator.toSeedSync()` → `await SeedGenerator.toSeed()` in `exportPSBT`, `signWithLocalKeys`, `signWithSpecificCosigner` |
| `src/services/import/PathDiscovery.ts` | Converted 1 `SeedGenerator.toSeedSync()` → `await SeedGenerator.toSeed()` in `discoverHD` |

## PBKDF2 Status in the App

| Usage | Status | Can Remove? |
|-------|--------|-------------|
| BIP39 seed generation (`SeedGenerator`) | Active (standard) | **NO** — Bitcoin standard |
| iCloud backup encryption (`BackupService`) | Active (100k iterations) | Only if iCloud backup removed |
| Local storage (`SecureStorage`) | Legacy migration-only | After deprecation period |
| Preserved archives v1 (`PreservedArchiveService`) | Legacy read-only fallback | After deprecation period |

The app has already migrated local storage and preserved archives away from PBKDF2 to faster alternatives (SHA-256 for SecureStorage, gzip+Keychain for archives).

## Verification

1. `npx tsc --noEmit` — zero errors
2. Multisig PSBT export: signing no longer freezes UI during seed derivation
3. Path discovery: import flow stays responsive during mnemonic-to-seed
