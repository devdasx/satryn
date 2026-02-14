# 114 — Switch Transaction Broadcasting from Electrum to Mempool.space

## Date
2025-02-11

## Summary

Switched all transaction broadcasting from Electrum RPC (`blockchain.transaction.broadcast`) to Mempool.space HTTP API (`POST /api/tx`). Fee estimation was already using Mempool.space — this completes the migration so the send flow uses only Mempool for both fees and broadcasting.

---

## Why

- Mempool.space is a simpler, more reliable HTTP API (no TCP/TLS socket management)
- Eliminates dependency on Electrum server connectivity for broadcasting
- Fee estimation already uses Mempool.space — consistent to use same source for broadcast
- `MempoolFeeService.broadcastTransaction()` was already fully implemented but unused

---

## Changes

### `src/stores/sendStore.ts`

**Location 1: `signAndBroadcast()` — Regular send flow**

Before:
```typescript
const electrum = new ElectrumAPI();
const txid = await electrum.broadcastTransaction(signedTx.hex);
```

After:
```typescript
const txid = await MempoolFeeService.broadcastTransaction(signedTx.hex, network);
```

**Location 2: `finalizeAndBroadcast()` — Multisig finalize & broadcast**

Before:
```typescript
const electrum = new ElectrumAPI();
const broadcastTxid = await electrum.broadcastTransaction(hex);
```

After:
```typescript
const broadcastTxid = await MempoolFeeService.broadcastTransaction(hex, network);
```

### Note

`ElectrumAPI` import remains — it's still used by `enrichLegacyUtxos()` for `getRawTransactionHexBatch()` (fetching raw tx hex for legacy P2PKH signing).

---

## Broadcast API Details

**Endpoint:** `POST https://mempool.space/api/tx` (mainnet) / `POST https://mempool.space/testnet/api/tx` (testnet)

**Request:** Raw transaction hex as plain text body (`Content-Type: text/plain`)

**Response:** Transaction ID (txid) as plain text

**Timeout:** 15 seconds

**Implementation:** `src/services/api/MempoolFeeService.ts` lines 122-158

---

## All Files Modified

| File | Change |
|------|--------|
| `src/stores/sendStore.ts` | Replaced 2 `ElectrumAPI.broadcastTransaction()` calls with `MempoolFeeService.broadcastTransaction()` |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Regular send (single-sig) → broadcasts via mempool.space → logs show `[mempool-broadcast] Broadcast success: <txid>`
3. Multisig finalize & broadcast → broadcasts via mempool.space → logs show `[mempool-broadcast] Broadcast success: <txid>`
4. Testnet sends use testnet mempool API automatically (via `network` parameter)
