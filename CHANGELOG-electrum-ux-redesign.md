# Electrum Server / Connection Experience Redesign

## Changes

### New Files
- **`src/hooks/useConnectionState.ts`** — Reactive hook that bridges ElectrumClient's 6-state FSM into React. Polls client state every 2s, merges with syncStore data, provides server implementation and latency from ServerCacheManager.
- **`src/components/ConnectionProgressSheet.tsx`** — Step-based connection progress bottom sheet. Maps ElectrumClient FSM states (disconnected → connecting → handshaking → ready) to 4 visual steps with Reanimated animations (pulse, checkmark scale-in, shake on error). Auto-dismisses on success after 1.2s.

### Modified Files
- **`src/components/wallet/SyncDetailsSheet.tsx`** — Redesigned connection bottom sheet:
  - Reconnect button now only appears when NOT connected (hidden when synced/syncing)
  - Added latency pill display
  - Added server implementation display
  - Added sync error card for disconnected states
  - Integrated ConnectionProgressSheet for reconnection flow
  - Uses new `useConnectionState` hook instead of raw store access
  - Added `contentKey` prop for proper TrueSheet re-measuring on state changes

- **`app/(auth)/electrum-server.tsx`** — Redesigned Electrum server settings:
  - Removed ALL `Alert.alert()` calls — replaced with inline error/success cards
  - Port validation shows inline red error text below the PORT input with red border
  - Connection failure shows red error card with icon below the Connect button
  - Connection success shows green success card with checkmark
  - Connect button now shows "Connecting..." text alongside spinner
  - Status indicator dot pulses during connection via Reanimated
  - Added `onServerSwitch` callback wiring to ElectrumServerListSheet
  - Status row shows "Connecting..." with target server info during connection test

- **`src/components/ElectrumServerListSheet.tsx`** — Server list with switching:
  - Server rows are now tappable (Pressable) to connect/switch servers
  - Added "Tap a server to connect" hint text
  - Tapping a server: tests connection with 10s timeout, saves to settingsStore, reconnects main API
  - Connected server shows green "Connected" badge pill instead of score
  - Non-connected servers show chevron indicating tappability
  - Connecting server shows ActivityIndicator in place of score
  - Other rows disabled during connection attempt
  - Error banner with auto-dismiss (5s) for failed switch attempts
  - New `onServerSwitch` callback prop for parent coordination
  - Haptic feedback on tap (light), success, and failure

- **`src/hooks/index.ts`** — Added exports for `useConnectionState` hook and `ConnectionInfo` type

### Design Principles
- No toasts or system alerts — all feedback is inline or via bottom sheets
- Haptic feedback on all user actions (light tap, success, error)
- Black-first brand identity with premium grayscale palette
- Light + Dark mode support via `useTheme()` hook
- Reanimated animations for state transitions
- `fontVariant: ['tabular-nums']` for all numeric displays
