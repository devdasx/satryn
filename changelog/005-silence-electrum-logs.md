# 005 - Silence Electrum Console Logs
**Date**: 2026-02-06

## Problem
Electrum connection and response logs were flooding the console with messages like:
```
[Electrum] handleResponse: id 1168 OK (2 chars)
[Electrum] _sendBatch: SUCCESS - 50 responses in 126ms
[ElectrumAPI] syncWalletLight: got 240 results
```
These made it impossible to see other relevant logs during development.

## Files Modified
- `src/services/electrum/ElectrumClient.ts` - `DEBUG = false`, `logError` gated behind DEBUG
- `src/services/electrum/ElectrumAPI.ts` - `DEBUG = false`, `logError` gated behind DEBUG, 2 direct `console.warn` calls gated behind DEBUG
- `src/services/electrum/ElectrumPool.ts` - `DEBUG = false`, `logError` gated behind DEBUG

## Fix
- Changed `DEBUG` from `__DEV__` to `false` in all 3 Electrum files
- Gated `logError` helper behind `DEBUG` flag (was always logging regardless)
- Gated 2 direct `console.warn` calls in ElectrumAPI behind DEBUG
- To re-enable for debugging connection issues, change `DEBUG = false` to `DEBUG = true` in the specific file

## Note
SyncLogger (in-memory ring buffer) still captures all Electrum events for the Debug Logs screen. Only console output is silenced.
