# 018 — Nearby Payments: Manual Peer Selection (Remove Auto-Connect)

## Problem
When multiple people were in a room with the Nearby screen open, the system auto-connected to the first peer found. This was unsafe — a sender could accidentally connect to the wrong receiver, and vice versa.

## Solution
Both sender and receiver now see a list of discovered nearby peers and must manually tap to select who to connect with. No auto-connect.

## How It Works

### Before (Auto-Connect)
```
Sender:   onPeerFound → auto requestConnection(first SATRYN peer)
Receiver: onInvitationReceived → auto acceptConnection(peerId)
```

### After (Manual Selection)
```
Sender:   onPeerFound → add to peer list → user taps → connectToPeer(peerId)
Receiver: onInvitationReceived → add to peer list → user taps → acceptPeer(peerId)
```

### UI
- **NearbyPeerList** component: Reusable list embedded in both scanning and advertising views
- Each peer row shows: person icon + display name + role label ("Receiver"/"Sender") + chevron or spinner
- Empty state: ActivityIndicator + "Looking for nearby devices..."
- Items animate in with staggered `FadeInDown`
- Tapping a peer while connecting shows a spinner on the selected row, disables others
- Radar/pulse animations compacted to 160px height to make room for the peer list

### Transport Changes
- **Sender**: `onPeerFound` no longer auto-calls `requestConnection`. Instead adds to `discoveredPeers` list. New `connectToPeer(peerId)` method for manual connection.
- **Receiver**: `onInvitationReceived` no longer auto-calls `acceptConnection`. Instead stores in `pendingInvitations` Map and adds to `discoveredPeers`. New `acceptPeer(peerId)` method.
- Timeout increased from 30s to 60s to allow time for manual selection.

## Files Created

| File | Purpose |
|------|---------|
| `src/components/nearby/NearbyPeerList.tsx` | Reusable peer list component for manual peer selection |

## Files Modified

| File | Change |
|------|--------|
| `src/services/nearby/types.ts` | Added `DiscoveredPeer` interface, increased `NEARBY_SCAN_TIMEOUT_MS` to 60s |
| `src/services/nearby/NearbyTransport.ts` | Added `onPeerDiscovered`/`onPeerLost` callbacks, `connectToPeer`/`acceptPeer` methods |
| `src/services/nearby/ExpoNearbyTransport.ts` | Removed auto-connect, added `pendingInvitations` Map, implemented `connectToPeer`/`acceptPeer` |
| `src/services/nearby/BLETransport.ts` | Added stub `connectToPeer`/`acceptPeer` methods to satisfy interface |
| `src/stores/nearbySessionStore.ts` | Added `discoveredPeers` Map, `selectedPeerId`, CRUD actions (`addDiscoveredPeer`, `removeDiscoveredPeer`, `selectPeer`) |
| `src/components/nearby/NearbyProvider.tsx` | Wired `onPeerDiscovered`/`onPeerLost` callbacks, added `selectAndConnect`/`selectAndAccept` to context |
| `src/components/nearby/NearbyScanning.tsx` | Compacted radar to 160px, embedded NearbyPeerList, updated subtitle |
| `src/components/nearby/NearbyAdvertising.tsx` | Compacted pulse to 160px, embedded NearbyPeerList, updated subtitle |
| `src/components/nearby/index.ts` | Added NearbyPeerList export |

## Edge Cases Handled
- **Peer disappears before selection**: `onPeerLost` removes from list, clears `selectedPeerId` if it was the removed peer
- **Multiple senders to same receiver**: All invitations tracked in `pendingInvitations`, receiver picks one
- **QR fallback**: Unchanged, works independently of peer list

## Verification
- `npx tsc --noEmit` — zero errors
