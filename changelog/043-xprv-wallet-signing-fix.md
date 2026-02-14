# 043 — xprv Wallet Signing Fix

## Overview
Fixed "Expected Private" error when signing transactions with xprv-imported wallets. Root cause was Buffer polyfill in React Native not passing `instanceof Uint8Array` checks required by the secp256k1 library.

## Modified Files

### `src/core/wallet/KeyDerivation.ts`
- Wrapped all private key material in `new Uint8Array()` to ensure compatibility with `@bitcoinerlab/secp256k1`
- Added version byte conversion for yprv/zprv keys in `fromXprv()` (converts to standard xprv before BIP32 derivation)
- Rewrote `getSigningKeyPair()` to use ECPair-based ECDSA signing instead of raw key export
- Fixed `getTaprootKeyPair()` to use pure Uint8Array for tweakedPubkey
- Fixed `addPrivateKeys()` and `negatePrivateKey()` to wrap results in Uint8Array

## Key Technical Details
- React Native's Buffer polyfill creates objects that fail `buf instanceof Uint8Array` checks in native crypto libraries
- ECPair wraps keys internally, avoiding the raw Uint8Array check during ECDSA signing
- For Taproot (Schnorr), direct Uint8Array wrapping is required since ECPair doesn't support tweaked keys

## Verification
- `npx tsc --noEmit` — zero errors
- xprv-imported wallets can now sign and broadcast transactions
