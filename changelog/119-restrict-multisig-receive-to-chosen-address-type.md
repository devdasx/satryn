# 119 — Restrict Multisig Receive Screen to Chosen Address Type

## Date
2025-02-11

## Summary

Fixed the receive screen showing all 4 address types (native segwit, taproot, wrapped segwit, legacy) for multisig wallets. Multisig wallets are created with a single `scriptType` (P2WSH, P2SH-P2WSH, or P2SH) chosen on the creation screen, so the receive screen should only show that one address type — no address type picker/tabs.

---

## Root Cause

### Why all 4 address types were shown

The `availableAddressTypes` computation in `receive.tsx` had explicit cases for:
- `imported_key` → show only imported types
- `hd` → show all 4 types
- `hd_xprv` / `hd_seed` → show all 4 types
- `hd_descriptor` → show only imported types
- `watch_xpub` / `watch_descriptor` / `watch_addresses` → show only imported types

But there was **no case for `walletType === 'multisig'`**, so it fell through to the fallback:
```typescript
// Fallback: show all types for any other HD-capable wallet
return [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.TAPROOT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.LEGACY];
```

### Why auto-derive was triggered

The auto-derive `useEffect` tried to call `extendAddressGap()` when a selected address type had no addresses. It had guards for WIF wallets (`imported_key`/`imported_keys`) but no guard for multisig wallets. When the user switched to an address type that didn't exist in the multisig wallet (e.g., taproot), it would attempt HD derivation — which doesn't apply to multisig.

---

## Fix 1: Add Multisig Case to `availableAddressTypes`

Added a `multisig` case that returns only the address types that actually exist in the wallet's addresses:

```typescript
// For multisig wallets: only show the single address type from scriptType
// Multisig wallets derive addresses for ONE script type only (P2WSH, P2SH-P2WSH, or P2SH)
if (walletType === 'multisig') {
  const uniqueTypes = [...new Set(addresses.filter(a => !a.isChange).map(a => a.type))];
  return uniqueTypes.length > 0 ? uniqueTypes : [preferredAddressType];
}
```

Since `availableAddressTypes.length === 1`, the UI sets `canSwitchAddressType = false` and hides the address type picker/tabs.

---

## Fix 2: Skip Auto-Derive for Multisig Wallets

Added a guard in the auto-derive `useEffect`:

```typescript
// Multisig wallets only support their chosen script type — skip auto-derivation for other types
if (activeWallet?.type === 'multisig') return;
```

---

## Address Type Mapping (for reference)

| Multisig Script Type | Address Format | Receive Shows |
|---|---|---|
| P2WSH (Native SegWit) | `bc1q...` | Native SegWit only |
| P2SH-P2WSH (Wrapped SegWit) | `3...` | Wrapped SegWit only |
| P2SH (Legacy) | `3...` | Legacy only |

---

## All Files Modified

| File | Change |
|------|--------|
| `app/(auth)/receive.tsx` | Added `multisig` case to `availableAddressTypes` memo; added multisig guard to auto-derive `useEffect` |

## Verification

1. `npx tsc --noEmit` — zero errors
2. P2WSH multisig wallet → receive screen shows only native segwit address, no type picker
3. P2SH multisig wallet → receive screen shows only legacy address, no type picker
4. P2SH-P2WSH multisig wallet → receive screen shows only wrapped segwit address, no type picker
5. HD wallet → receive screen still shows all 4 types with picker (unchanged)
6. No auto-derive triggered when multisig wallet is active
