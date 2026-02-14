# 013 — Nearby Payments: Wireless Transport Upgrade

## Summary
Replaced the BLE-based transport with `expo-nearby-connections`, which wraps MultipeerConnectivity (iOS) and Google Nearby Connections (Android). This provides true wireless device discovery with automatic peer-to-peer sessions, significantly more reliable than raw BLE characteristic read/write.

## Why
- BLE transport required manual GATT service setup, had chunking complexity, and was unreliable for bidirectional communication
- `expo-nearby-connections` handles session management, peer discovery, and data exchange natively
- Supports bidirectional text messaging (needed for acceptance/decline protocol)
- More reliable connection establishment with MultipeerConnectivity on iOS

## Architecture

### Transport Interface
```
Receiver: startAdvertise → onInvitationReceived → acceptConnection → onConnected → sendText(payload)
Sender:   startDiscovery → onPeerFound → requestConnection → onConnected → onTextReceived(payload)
```

### Service Name Convention
- Receivers advertise as `SATRYN_<nickname>` or `SATRYN_<requestId_prefix>`
- Senders filter discovered peers by `SATRYN` prefix
- Nickname is extracted from the advertised name for display

## Files Created

| File | Purpose |
|------|---------|
| `src/services/nearby/ExpoNearbyTransport.ts` | New transport implementation using expo-nearby-connections |

## Files Modified

| File | Change |
|------|--------|
| `src/services/nearby/NearbyTransport.ts` | Added `sendMessage()`, `onTextReceived`, `onPayloadRead` to interface |
| `src/services/nearby/BLETransport.ts` | Kept as fallback, added stub methods for new interface |
| `src/components/nearby/NearbyProvider.tsx` | Switched from BLETransport to ExpoNearbyTransport |
| `src/services/nearby/types.ts` | Added `NEARBY_SCAN_TIMEOUT_MS` constant |
| `package.json` | Added `expo-nearby-connections` dependency |

## Verification
- `npx tsc --noEmit` — zero errors
