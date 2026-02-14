# 128 — Fix Self-Transfer False Positive

## Date
2025-02-12

## Summary

Fixed a false positive in self-transfer detection when sending from a multisig wallet to an imported wallet within the same app. The `TransactionRow` component had a secondary client-side check that incorrectly flagged outgoing transactions as "Self Transfer" if all output addresses happened to match the wallet's own address set.

---

## Changes

**File:** `src/components/bitcoin/TransactionRow.tsx`

Removed the secondary self-transfer detection check:

Before:
```typescript
const isSelf = tx.type === 'self-transfer' ||
    (!isReceive && tx.outputs.every(o => !o.address || ownAddresses.has(o.address)));
```

After:
```typescript
const isSelf = tx.type === 'self-transfer';
```

The `tx.type` is already correctly determined by the sync pipeline (`WalletEngine.buildLkgFromStaging`) which has the full context of the wallet's addresses. The redundant client-side check could produce false positives when outputs matched wallet addresses by coincidence (e.g., sending to another wallet in the same app).

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/bitcoin/TransactionRow.tsx` | Removed secondary self-transfer check |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Send from multisig wallet to imported wallet → shows "Sent" not "Self Transfer"
3. Actual self-transfer transactions (same wallet, all outputs to own addresses) still correctly show "Self Transfer" via `tx.type`
