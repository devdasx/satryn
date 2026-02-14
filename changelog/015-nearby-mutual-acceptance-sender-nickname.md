# 015 — Nearby Payments: Mutual Acceptance + Sender Nickname

## Summary
Added a mutual acceptance protocol to the nearby payments flow. After the receiver's payload is delivered to the sender, the sender must explicitly accept or decline the payment request. The acceptance/decline message is sent back to the receiver over the wireless transport, creating a two-way handshake before any Bitcoin transaction is initiated.

The sender's nickname is transmitted with the acceptance message, so the receiver can see who accepted their request.

## How It Works

### Protocol Flow
```
1. Receiver creates payload → advertises wirelessly
2. Sender connects → receives payload → reviews payment details
3. Sender taps "Accept & Send" → sends acceptance JSON to receiver
   OR Sender taps "Decline" → sends decline JSON to receiver → session cancelled
4. Receiver gets acceptance → transitions to "waiting for payment" → starts polling
5. Sender is redirected to the Send flow with prefilled address/amount
```

### Acceptance Message Format
```json
{
  "type": "acceptance",
  "requestId": "<UUID>",
  "accepted": true,
  "senderNickname": "Alex"
}
```

### State Machine Changes
- New state: `pending_acceptance` — receiver waits for sender's decision after exchanging payload
- Transition: `exchanging → pending_acceptance` (when receiver's payload is read by sender)
- Transition: `pending_acceptance → completed` (when sender accepts)
- Transition: `pending_acceptance → error` (when sender declines)

## Files Modified

| File | Change |
|------|--------|
| `src/services/nearby/types.ts` | Added `pending_acceptance` state, updated `VALID_TRANSITIONS` |
| `src/services/nearby/NearbyTransport.ts` | Added `onTextReceived` callback for bidirectional messaging |
| `src/services/nearby/ExpoNearbyTransport.ts` | Wired `onTextReceived` listener for incoming text messages |
| `src/components/nearby/NearbyProvider.tsx` | Added `sendAcceptance()` and `sendDecline()` methods, receiver-side acceptance handling |
| `src/components/nearby/NearbyPaymentReview.tsx` | Added Accept/Decline buttons, sends acceptance message before navigating to send flow |
| `src/components/nearby/NearbyReceiveWaiting.tsx` | Added `pending_acceptance` internal state, transitions to waiting when sender accepts |
| `src/components/nearby/NearbyScreen.tsx` | Routes `pending_acceptance` state to NearbyReceiveWaiting |
| `src/stores/nearbySessionStore.ts` | Added `senderAccepted` field and `setSenderAccepted` action |

## Verification
- `npx tsc --noEmit` — zero errors
