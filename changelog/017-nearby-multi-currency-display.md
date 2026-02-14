# 017 — Nearby Payments: Multi-Currency Amount Display

## Summary
The receiver can now choose to display the payment amount in BTC, sats, or fiat (any currency). The sender sees the amount in the same format the receiver chose. Previously, amounts were always displayed in sats.

## How It Works

### Payload Fields Added
```typescript
interface NearbyPayload {
  // ... existing fields ...
  displayDenomination?: 'btc' | 'sats' | 'fiat';
  displayAmount?: number;        // Pre-computed value in chosen denomination
  displayCurrency?: string;      // Currency code for fiat (e.g. "USD", "EUR")
}
```

### Format Logic
- **sats**: `"50,000 sats"` (default if no denomination specified)
- **btc**: `"0.0005 BTC"` (converts sats to BTC)
- **fiat**: `"$15.95 USD"` (uses `displayAmount` + `displayCurrency` from payload)
- Backward compatible — payloads without display fields fall back to sats

### Canonical Signing
Display fields are included in the canonical hash only when present, so older payloads without display fields produce the same signature hash (backward compatibility).

## Files Created

| File | Purpose |
|------|---------|
| `src/services/nearby/formatNearbyAmount.ts` | Shared display helper: formats NearbyPayload amount respecting receiver's denomination |

## Files Modified

| File | Change |
|------|--------|
| `src/services/nearby/types.ts` | Added `displayDenomination`, `displayAmount`, `displayCurrency` to `NearbyPayload` |
| `src/services/nearby/NearbyPayloadCodec.ts` | Updated canonical form to conditionally include display fields, updated `CreatePayloadParams` |
| `src/components/nearby/NearbyReceiveSetup.tsx` | Passes display denomination/amount/currency when creating payload |
| `src/components/nearby/NearbyProvider.tsx` | Passes display fields through `startReceive()` to `createSignedPayload()` |
| `src/components/nearby/NearbyPaymentReview.tsx` | Uses `formatNearbyAmount()` for sender-side display |
| `src/components/nearby/NearbyReceiveWaiting.tsx` | Uses `formatNearbyAmount()` for receiver-side display |
| `src/components/nearby/NearbyAdvertising.tsx` | Uses `formatNearbyAmount()` for amount summary card |

## Verification
- `npx tsc --noEmit` — zero errors
