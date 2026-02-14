# 012 — Nearby Payments (Tap-to-Send Bitcoin via BLE)

## Summary
Implemented a Bluetooth Low Energy (BLE) based nearby payments feature. Two devices can exchange a signed payment request over BLE — the receiver advertises a request, the sender reads it and proceeds to the send flow. QR code fallback is available when BLE is unavailable.

**Key discovery:** NFC peer-to-peer is not supported on modern iOS or Android (Android Beam removed in Android 14, iOS never supported P2P NFC). BLE is the correct cross-platform transport for device-to-device data exchange.

---

## Architecture

### Transport
- **Primary:** BLE via `react-native-ble-plx` (iOS 13+ / Android 6+)
- **Fallback:** QR code via `satryn://nearby?data=<base64url(JSON)>`
- Receiver acts as BLE peripheral (advertiser), sender as central (scanner)

### Payload (NearbyPayload v1)
- Versioned, signed JSON payload (~400 bytes)
- Fields: address, network, amountSats?, memo?, requestId, timestamp, expiresAt
- Signed with ephemeral secp256k1 keypair per session (prevents tampering)
- Validation: address format, network match, expiration (2 min), dust limit, signature

### State Machine
- Zustand store (`nearbySessionStore`) with deterministic transitions
- States: idle → initializing → advertising/scanning → exchanging → validating → completed
- Error/timeout/cancelled states with retry support

### Integration
- Nearby → Send flow via existing `SendPrefillStore`
- Smart step-skip: if prefill has address+amount → skip to fee step
- Transaction auto-labeling with memo via `transactionLabelStore`

---

## Files Created

| File | Purpose |
|------|---------|
| `app/(auth)/nearby.tsx` | Route screen (mode=send or mode=receive) |
| `src/services/nearby/types.ts` | Types, constants, error codes |
| `src/services/nearby/NearbyPayloadCodec.ts` | Encode/decode/validate/sign/verify |
| `src/services/nearby/NearbyTransport.ts` | Transport interface |
| `src/services/nearby/BLETransport.ts` | BLE implementation |
| `src/services/nearby/QRTransport.ts` | QR fallback encode/decode |
| `src/services/nearby/NearbyLogger.ts` | Structured session logging |
| `src/services/nearby/index.ts` | Barrel exports |
| `src/stores/nearbySessionStore.ts` | State machine (Zustand) |
| `src/components/nearby/NearbyProvider.tsx` | Context provider |
| `src/components/nearby/NearbyScreen.tsx` | Main screen + step router |
| `src/components/nearby/NearbyHeader.tsx` | Header (close, title, mode pill) |
| `src/components/nearby/NearbyReceiveSetup.tsx` | Amount/memo input |
| `src/components/nearby/NearbyAdvertising.tsx` | Animated pulse rings + QR fallback |
| `src/components/nearby/NearbyScanning.tsx` | Animated radar search |
| `src/components/nearby/NearbyPaymentReview.tsx` | Received payload preview |
| `src/components/nearby/NearbyError.tsx` | Error/timeout/permission states |
| `src/components/nearby/index.ts` | Barrel exports |

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `react-native-ble-plx` dependency |
| `app.json` | Added BLE plugin, Bluetooth permission strings, Android BLE permissions |
| `app/(auth)/_layout.tsx` | Registered `nearby` screen in Stack |
| `src/types/contacts.ts` | Added `'nearby'` to `SendPrefillData.source` union |
| `src/components/send/SendContext.tsx` | Smart step-skip when prefill has address+amount |
| `src/components/send-v2/steps/StepRecipient.tsx` | Added "Nearby" button alongside scan |
| `app/(auth)/send.tsx` | Pass `onOpenNearby` handler to StepRecipient |
| `app/(auth)/receive.tsx` | Added "Nearby" button in secondary actions row |

## Verification
- `npx tsc --noEmit` — zero errors ✅
