# 014 — Nearby Payments: Receiver Waiting + Payment Polling

## Summary
Added the receiver's post-exchange experience: after the payment request is delivered to the sender, the receiver sees a waiting screen that polls their address via Electrum every 5 seconds to detect incoming payments. Handles exact match, underpaid, and overpaid scenarios with bottom sheet prompts.

Also added the `NearbySendSetup` screen — senders must now enter a nickname before starting discovery, so the receiver knows who's connecting.

## Features

### NearbyReceiveWaiting
- **Waiting state**: Animated pulse icon (hourglass) + payment details card (peer name, amount, address)
- **Polling**: Checks address UTXOs via `ElectrumAPI.getUTXOs()` every 5 seconds, with 5-minute timeout
- **Exact match**: Animated success view with checkmark spring animation, txid display, haptic feedback
- **Underpaid**: Bottom sheet showing requested vs received vs remaining, with "Accept" or "Ask Sender for Remaining" options
- **Overpaid**: Bottom sheet showing the extra amount received, with "Accept Payment" option
- **Ask Sender flow**: After choosing "Ask Sender", shows a message card with the remaining sats needed, resumes polling

### NearbySendSetup
- Nickname input (persisted in `settingsStore.nearbyNickname`)
- Validated — cannot start scanning without a nickname
- Nickname is sent wirelessly to the receiver during connection
- Glass card input with focus border animation

## Files Created

| File | Purpose |
|------|---------|
| `src/components/nearby/NearbyReceiveWaiting.tsx` | Post-exchange receiver screen with payment polling |
| `src/components/nearby/NearbySendSetup.tsx` | Sender nickname setup before scanning |

## Files Modified

| File | Change |
|------|--------|
| `src/components/nearby/NearbyScreen.tsx` | Added routing for `pending_acceptance` and `completed` states → NearbyReceiveWaiting |
| `src/components/nearby/index.ts` | Added NearbyReceiveWaiting, NearbySendSetup exports |
| `src/stores/nearbySessionStore.ts` | Added `receivedAmountSats`, `receivedTxid`, `senderAccepted`, `setReceivedPayment`, `setSenderAccepted` |
| `src/stores/settingsStore.ts` | Added `nearbyNickname` field and `setNearbyNickname` action |

## Verification
- `npx tsc --noEmit` — zero errors
