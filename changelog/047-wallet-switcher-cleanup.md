# 047 — Wallet Switcher & Import Cleanup

## Overview
Removed "Manage Wallets" button from wallet switching sheet, removed clipboard clear prompt from wallet import flow, and fixed wallet switching for Electrum file-imported wallets.

## Modified Files

### `src/components/wallet/WalletSwitcherSheet.tsx`
- Removed "Manage Wallets" secondary button and `handleManageWallets` handler
- "Add Wallet" button remains as the only action below the wallet list

### `src/components/import/PhraseSection.tsx`
- Removed `promptClipboardClear()` call after successful paste

### `src/components/import/ExtendedKeySection.tsx`
- Removed `promptClipboardClear()` call after successful paste

### `src/components/import/KeySection.tsx`
- Removed `promptClipboardClear()` call after successful paste

### `src/components/import/SeedBytesSection.tsx`
- Removed `promptClipboardClear()` call after successful paste

### `src/components/import/FileSection.tsx`
- Removed `promptClipboardClear()` call after successful file import

### `src/services/import/index.ts`
- Removed `promptClipboardClear` from public exports

### `src/stores/walletStore.ts` (switchToWallet)
- Fixed wallet switching for non-mnemonic wallet types in the slow path
- Added wallet-type-aware secret retrieval branching:
  - `hd_xprv` / `hd_descriptor`: uses `SecureStorage.retrieveWalletXprv()` → `KeyDerivation.fromXprv()`
  - `hd_seed`: uses `SecureVault.retrieve()` for seed_hex → `new KeyDerivation(seedBuffer)`
  - `hd_mnemonic`: unchanged (existing mnemonic path)
- Previously, all non-mnemonic types fell through to the mnemonic path and failed

## Verification
- `npx tsc --noEmit` — zero errors
- Wallet switching now works for xprv, seed, and descriptor-imported wallets
