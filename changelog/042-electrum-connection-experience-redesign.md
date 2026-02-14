# 042 — Electrum Server / Connection Experience Redesign

## Overview
Premium redesign of the entire Electrum Server / Connection UX across 4 screens. Replaces all `Alert.alert()` calls with inline error/success states, adds reactive connection state hook, step-based connection progress sheet, server switching from the server list, and conditional Reconnect button logic.

## New Files

### `src/hooks/useConnectionState.ts` — Reactive connection hook
Bridges the imperative ElectrumClient 6-state FSM into React's declarative model. All screens consume this single hook instead of independently querying services.

- Polls `ElectrumClient.getState()` every 2s via `useRef` + `setInterval`
- Merges with Zustand syncStore for reactive `syncState`, `serverHost`, `blockHeight`, `lastSyncTime`
- Reads `ServerCacheManager` for per-server latency and implementation info
- Exports `ConnectionInfo` type with: `clientState`, `isConnected`, `syncState`, `lastSyncTime`, `serverHost`, `blockHeight`, `syncError`, `currentServer`, `serverImpl`, `latencyMs`, `displayHost`
- Smart `displayHost` truncation (max 28 chars)
- Registered in `src/hooks/index.ts`

### `src/components/ConnectionProgressSheet.tsx` — Step-based connection progress
Visualizes ElectrumClient FSM transitions during connection attempts.

- 4 progress steps: Resolving → Establishing connection → Handshaking → Connected
- Maps FSM states (`disconnected` → `connecting` → `handshaking` → `ready`) to step progression
- Polls FSM at 300ms intervals with minimum 400ms step display time
- Animated step indicators using Reanimated: active pulse, completed checkmark scale-in, failed shake
- Auto-dismisses 1.2s after reaching `ready` state
- Error state: shows error message + "Try Again" primary button
- Uses `AppBottomSheet` with `sizing="auto"`

## Modified Files

### `src/components/wallet/SyncDetailsSheet.tsx` — Connection bottom sheet
- Uses `useConnectionState()` hook instead of raw syncStore queries
- **Connected state**: Green dot, "Connected" label, server host + implementation, latency pill, block height, last sync — NO Reconnect button
- **Syncing state**: Amber pulsing dot, "Syncing..." label — NO Reconnect button
- **Not connected / Offline**: Gray/red dot, error card, Primary "Reconnect" button + "Server Settings" secondary
- Reconnect tap opens ConnectionProgressSheet, triggers `refreshBalance()` on completion
- Added `fontVariant: ['tabular-nums']` for numeric values
- Passes `contentKey={syncState}` to AppBottomSheet for auto re-measuring

### `app/(auth)/electrum-server.tsx` — Electrum server settings
- **Replaced ALL `Alert.alert()` with inline states**: `portError`, `connectionError`, `connectionSuccess`
- Invalid port: red text below PORT input + red border on input
- Connection failure: red-tinted error card below Connect button with alert-circle icon + message
- Connection success: green-tinted success card with checkmark-circle icon
- Connect button shows "Connecting..." text + spinner (not bare ActivityIndicator)
- Passes `onServerSwitch` callback to ElectrumServerListSheet to sync host/port/ssl fields on server switch

### `src/components/ElectrumServerListSheet.tsx` — Server list with switching
- New `onServerSwitch` prop for notifying parent of server changes
- Server rows are tappable (`Pressable`) — tap to switch to that server
- Connected server: green "Connected" badge pill, not tappable
- Currently connecting server: ActivityIndicator on row
- Server switching logic (`handleServerTap`): disconnect current → test connection → save as custom server → reconnect main API
- Error banner: red-tinted card auto-dismisses after 5s on connection failure
- Server health dashboard with per-server stats, success rate, latency

### `src/hooks/index.ts` — Hook exports
- Added `export { useConnectionState } from './useConnectionState'`
- Added `export type { ConnectionInfo } from './useConnectionState'`

## Key Design Decisions
- **Single reactive hook** — All screens share `useConnectionState()` for consistent connection state
- **No alerts anywhere** — Every error/success is shown inline with themed cards
- **Conditional Reconnect** — Button only appears when actually disconnected, preventing unnecessary reconnection when already connected
- **Step-based progress** — Connection attempts show real FSM progress instead of bare spinner
- **Server switching from list** — Users can tap any server row to switch, with connection testing before committing

## Verification
- `npx tsc --noEmit` — zero errors
- Connection sheet: conditional Reconnect button, latency pill, block height display
- Electrum settings: inline errors (no Alert), inline success cards, "Connecting..." text
- Server list: tappable rows, green "Connected" badge, connection testing, error banners
- Light + Dark mode: all screens themed correctly
