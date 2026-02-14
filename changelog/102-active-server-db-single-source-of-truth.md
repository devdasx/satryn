# Changelog 102 — Active Server: DB as Single Source of Truth

## Problem

When the user selected a server in the Electrum Server screen or Server List sheet, the active server was not consistently reflected across the app. The SyncDetailsSheet (Connection bottom sheet) and other UI components would still show the previously connected server because active server state was fragmented across:

1. `settingsStore.customElectrumServer` (AsyncStorage-persisted)
2. `ElectrumClient.getCurrentServer()` (in-memory FSM, polled every 2s)
3. `serverStore` (SQLite `saved_servers` table — no concept of "active server")

The FSM would lag behind during reconnection, causing different screens to show different servers.

## Solution

Made the SQLite database the **single source of truth** for the active server by storing it in the `app_config` key-value table under the key `active_server`.

### Changes

#### `src/stores/serverStore.ts` — Active server tracking
- Added `ActiveServer` interface: `{ host, port, ssl }`
- Added `activeServer: ActiveServer | null` to store state
- Added `setActiveServer(server)` — persists to `app_config` via `db.setConfig()`
- Added `clearActiveServer()` — removes from `app_config` via `db.deleteConfig()`
- Added `getActiveServer()` — reads from in-memory state
- `loadServers()` now also loads the active server from `app_config` on init

#### `src/stores/index.ts` — Export
- Added `ActiveServer` type export

#### `src/hooks/useConnectionState.ts` — DB-backed server display
- Now subscribes to `useServerStore(s => s.activeServer)` for reactive updates
- Prefers DB-backed `activeServer` over polled FSM `getCurrentServer()` for `currentServer` display
- All downstream consumers (SyncDetailsSheet, SyncStatusCapsule, etc.) automatically show the correct server

#### `src/components/ElectrumServerListSheet.tsx` — Persist on server switch
- `handleServerTap()` now calls `setActiveServer()` after successful connection test
- `connectedServer` detection in `useMemo` now uses `activeServer` from DB as primary source
- Falls back to FSM state only when no DB-backed active server exists

#### `app/(auth)/electrum-server.tsx` — Persist + reconnect
- Imported `useServerStore` and `ElectrumAPI`
- `handleSaveElectrumServer()` now:
  - Calls `setActiveServer()` to persist to DB on successful connection
  - Calls `api.disconnect()` + `api.connect()` to immediately reconnect ElectrumAPI
- `handleReset()` now:
  - Calls `clearActiveServer()` to remove from DB
  - Reconnects to public servers via `api.disconnect()` + `api.connect()`
- Empty host (reset to default) also clears active server and reconnects

## Files Modified

| File | Change |
|------|--------|
| `src/stores/serverStore.ts` | Added `activeServer`, `setActiveServer`, `clearActiveServer`, `getActiveServer` |
| `src/stores/index.ts` | Added `ActiveServer` type export |
| `src/hooks/useConnectionState.ts` | Merged DB-backed activeServer as primary source for currentServer |
| `src/components/ElectrumServerListSheet.tsx` | Persists active server on switch, uses DB for connected detection |
| `app/(auth)/electrum-server.tsx` | Persists active server + reconnects ElectrumAPI on save/reset |

## Data Flow (After)

```
User selects server
    ↓
settingsStore.setCustomElectrumServer()  ← AsyncStorage (legacy compat)
serverStore.setActiveServer()            ← SQLite app_config (source of truth)
ElectrumAPI.disconnect() + connect()     ← Immediate reconnection
    ↓
useConnectionState hook
    ↓
activeServer from serverStore (reactive, instant)  ← PRIMARY
fsmServer from ElectrumClient (polled, 2s delay)   ← FALLBACK
    ↓
All UI: SyncDetailsSheet, SyncStatusCapsule, ElectrumServerListSheet
```

## Verification

1. `npx tsc --noEmit` — 0 new errors (1 pre-existing in KeySection.tsx)
2. Select server in Electrum Server screen → Connection sheet shows same server
3. Select server from Server List sheet → All screens show same server
4. Reset to default → Active server cleared, reconnects to public pool
5. App restart → Active server persisted, shows correct server on reopen
