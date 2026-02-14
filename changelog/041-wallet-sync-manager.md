# 041 — WalletSyncManager

## Overview
Central orchestrator for wallet sync lifecycle. Ensures wallet state is always consistent, responsive, and resilient after every transaction broadcast and on pull-to-refresh.

## New File
- `src/services/sync/WalletSyncManager.ts` — Singleton service owning:
  - **Post-broadcast sync pipeline**: Every broadcast → optimistic update → delayed Electrum sync
  - **Optimistic local wallet updates**: Instant UI feedback (balance deduction, UTXO removal, pending tx insertion) before Electrum confirms
  - **Refresh cancel + restart**: Pull-to-refresh cancels in-flight syncs, disconnects, reconnects fresh, runs full sync
  - **Sync deduplication**: Debounce rapid syncs, prevent concurrent operations

## Architecture

### Post-Broadcast Flow
```
broadcastTransaction() → WalletSyncManager.onTransactionBroadcasted()
  → applyOptimisticUpdate()    // instant: balance, UTXOs, pending tx
  → wait 2s (mempool propagation)
  → triggerSync()              // Electrum reconciliation via WalletEngine
```

### Pull-to-Refresh Flow
```
onRefresh() → WalletSyncManager.refreshWallet()
  → cancelActiveSyncs()        // abort in-flight sync tokens
  → api.clearCache()           // clear Electrum cache
  → api.disconnect()           // clean TCP state
  → api.connect()              // fresh connection
  → triggerSync()              // full WalletEngine pipeline
```

### Optimistic Update Details
- Subtracts amount + fee from balance
- Removes spent UTXOs from set
- Adds change UTXOs as unconfirmed (0 confirmations)
- Prepends pending transaction to history
- Updates multi-wallet store balance
- All reconciled when Electrum sync completes (2s later)

## Modified Files

### Broadcast Paths (7 files)
All broadcast paths now call `WalletSyncManager.onTransactionBroadcasted()` or `onTransactionBroadcastedSimple()` instead of direct `refreshBalance()`:

1. **`src/components/send/useSendFlow.ts`** — Full optimistic update with spent UTXO tracking
2. **`src/components/send-v3/useSendFlowV3.ts`** — Simple broadcast notification (keeps retry logic)
3. **`src/components/payment/PaymentSheet.tsx`** — Full optimistic update for payment sheet
4. **`app/(auth)/broadcast.tsx`** — Simple notification, removed `api.disconnect()`
5. **`app/(auth)/transaction-details.tsx`** — Simple notification for fee bumps
6. **`app/(auth)/advanced-send.tsx`** — Simple notification, removed `api.disconnect()`
7. **`app/(auth)/multisig-send.tsx`** — Simple notification for multisig broadcasts

### Dashboard
- **`app/(auth)/(tabs)/index.tsx`** — Pull-to-refresh now uses `WalletSyncManager.refreshWallet()` which cancels in-flight syncs, reconnects clean, then syncs fresh

## Key Design Decisions
- **Does NOT replace ElectrumAPI/ElectrumClient** — they handle TCP/TLS, keepalive, auto-reconnect
- **Does NOT replace WalletEngine** — it handles sync pipeline, validation, two-phase commit
- **Orchestrates on top of both** — coordinates broadcast → optimistic → sync flow
- **Removed `api.disconnect()` after broadcasts** — persistent connections managed by health monitor
- **Two entry points**: `onTransactionBroadcasted` (full optimistic update) and `onTransactionBroadcastedSimple` (sync only, for callers without UTXO details)

## Verification
- `npx tsc --noEmit` — zero errors
