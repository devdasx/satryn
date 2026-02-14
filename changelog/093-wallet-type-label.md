# 093 — Dynamic Wallet Type Label

## Overview
The wallet tab showed "Recovery Phrase" for all wallet types, including WIF imported keys. Now shows the correct label per wallet type.

## Changes
Added `getSecurityLabel()` function that returns the appropriate label based on `walletType`:
- `imported_key` → "Private Key (WIF)"
- `imported_keys` → "Private Keys"
- `hd_xprv` → "Extended Private Key"
- `hd_seed` → "Seed Bytes (Hex)"
- Multisig → "Manage Keys"
- Default (HD wallets) → "Recovery Phrase"

Updated the ActionRow label and the recovery phrase alert dialog to use the dynamic label.

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/wallet.tsx` | Added `getSecurityLabel()`, updated ActionRow and alert to use dynamic label |
