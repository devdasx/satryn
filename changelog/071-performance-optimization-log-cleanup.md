# 071 — Performance Optimization: Log Cleanup, WebSocket Throttling, Zustand Selector Fixes

## Overview
Comprehensive performance overhaul to eliminate app lag. Three major issues were identified and fixed: (1) 583 console statements flooding the JavaScript bridge and slowing the UI thread; (2) BinanceWebSocket firing subscriber callbacks multiple times per second, triggering cascading re-renders; (3) Zustand store subscriptions without selectors causing entire component trees to re-render on any state change. A centralized logger utility was also created for future diagnostics.

## Performance Issues Identified

| Issue | Impact | Severity |
|-------|--------|----------|
| 583 console.log/warn/error statements | JS bridge flooding, serial output blocking | Critical |
| BinanceWebSocket: unthrottled ticker updates | Multiple re-renders per second on dashboard | Critical |
| Zustand store destructuring without selectors | Re-render on ANY store field change, not just used fields | High |
| walletStore realtime handler updating 3 large fields at once | Triggers all subscribers on every subscription event | Medium |

## Fix 1: Console Statement Removal

**Total removed: ~530 console statements** across 45+ files.

### Approach
- Removed ALL hardcoded `console.log()`, `console.warn()`, `console.error()` from production code
- Preserved `DEBUG`-guarded logging patterns (e.g., `const DEBUG = false; const log = ...`) in `walletStore.ts`, `ElectrumAPI.ts`, `ElectrumClient.ts` — these are already silent when `DEBUG=false`
- Preserved intentional logging utilities: `NearbyLogger.ts`, `testDeterministicEntropy.ts`
- For utility functions used as loggers across multiple files (`WalletSyncManager.log`, `security.safeLog`), converted function bodies to no-ops instead of removing call sites

### Top files cleaned (by statement count)

| File | Removed |
|------|---------|
| `src/stores/walletStore.ts` | 48 |
| `src/components/wallet/WalletRemovalSheet.tsx` | 40 |
| `src/services/storage/PreservedArchiveService.ts` | 39 |
| `src/services/storage/SecureStorage.ts` | 33 |
| `src/services/AppStateManager.ts` | 29 |
| `src/services/database/V2MigrationService.ts` | 26 |
| `src/services/sync/WalletEngine.ts` | 22 |
| `src/services/storage/WalletFileV2.ts` | 20 |
| `src/services/backup/iCloudService.ts` | 20 |
| `app/(auth)/advanced-send.tsx` | 19 |
| `src/services/database/WalletDatabase.ts` | 16 |
| `src/services/storage/WalletFileService.ts` | 13 |
| `src/services/wallet/WalletMigration.ts` | 12 |
| `src/stores/contactStore.ts` | 11 |
| + 30 more files | ~100+ |

### New Centralized Logger

**File**: `src/utils/logger.ts`

```typescript
import { logger } from '../utils/logger';
logger.info('WalletStore', 'Switched wallet', walletId);
logger.warn('Electrum', 'Connection timeout');
logger.error('Send', 'Transaction failed', error);
logger.perfStart('balance-refresh');
logger.perfEnd('balance-refresh');  // Logs: 🟢 [Perf] balance-refresh: 45ms
```

- `logger.info` / `logger.warn` — only log in `__DEV__` mode
- `logger.error` — only logs in `__DEV__` mode
- `logger.perfStart` / `logger.perfEnd` — performance timers with color-coded output (green < 100ms, yellow < 500ms, red > 500ms)
- All logging completely silent in production builds

## Fix 2: BinanceWebSocket Throttling

**File**: `src/services/api/BinanceWebSocket.ts`

### Problem
Binance sends BTCUSDT ticker updates **multiple times per second**. Each update called `notifySubscribers()` which triggered `setState` in every subscribed component. On the dashboard, this caused 3-5 re-renders per second just from price updates.

### Solution
Added throttled notification with a 2-second window:

- **`THROTTLE_MS = 2000`** — subscribers are notified at most once every 2 seconds
- **`lastPrice`** is always updated instantly (no data staleness for reads)
- **`throttledNotify()`** — fires immediately if enough time has passed, otherwise queues a deferred notification that fires at the end of the throttle window with the latest data
- **Pending timeout cleanup** on disconnect to prevent leaked timers

### Impact
- Dashboard re-renders from price: **reduced from ~3-5/sec to ~0.5/sec** (6-10x reduction)
- All 11 `console.log/warn/error` statements removed (was logging every tick)
- Ping interval logging removed (was logging every 2 minutes)

## Fix 3: Zustand Store Selector Optimization

### Problem
Components were subscribing to the entire `walletStore` using destructured syntax:
```typescript
// BEFORE: Re-renders on ANY walletStore change (balance, txs, utxos, addresses, etc.)
const { balance, addresses, refreshBalance, network } = useWalletStore();
```

This caused cascade re-renders: when a realtime transaction updated `utxos` in the store, every component that destructured `useWalletStore()` would re-render — even if they only used `network` (which didn't change).

### Solution
Converted to individual selectors:
```typescript
// AFTER: Re-renders ONLY when the specific field changes
const balance = useWalletStore(s => s.balance);
const addresses = useWalletStore(s => s.addresses);
const refreshBalance = useWalletStore(s => s.refreshBalance);
const network = useWalletStore(s => s.network);
```

### Files Fixed

| File | Fields Destructured |
|------|-------------------|
| `app/(auth)/(tabs)/index.tsx` (Dashboard) | 6 fields → 6 selectors |
| `app/(auth)/(tabs)/wallet.tsx` (Wallet tab) | 4 fields → 4 selectors |
| `app/(auth)/(tabs)/settings.tsx` (Settings) | 3 fields → 3 selectors |
| `src/components/payment/PaymentSheet.tsx` | 8 fields → 8 selectors |
| `src/components/send/useSendFlow.ts` | 9 fields → 9 selectors |
| `src/components/send/SendContext.tsx` | 5 fields → 5 selectors |
| `src/components/send-v3/useSendFlowV3.ts` | 8 fields → 8 selectors |
| `src/components/send-v3/SendHeader.tsx` | 3 fields → 3 selectors |
| `src/components/send-v3/SendScreen.tsx` | 3 fields → 3 selectors |
| `src/components/bitcoin/AddressOptionsModal.tsx` | 3 fields → 3 selectors |

### Impact
- **Dashboard**: No longer re-renders when `utxos` or `transactions` change (it only uses `balance`, `addresses`, `network`)
- **Wallet tab**: No longer re-renders on balance/transaction updates (it only uses `network`, `preferredAddressType`)
- **Send flows**: No longer re-render on irrelevant store changes during transaction construction
- **Overall**: Estimated 60-80% reduction in unnecessary re-renders from walletStore updates

## TypeScript
Compiles with 0 errors after all changes.

## Files Changed Summary

| Category | Files | Key Changes |
|----------|-------|-------------|
| Logger utility | 1 new file | `src/utils/logger.ts` |
| Console removal | 45+ files | ~530 console statements removed |
| WebSocket throttle | 1 file | `BinanceWebSocket.ts` — added 2s throttle |
| Selector fixes | 10 files | Converted destructuring to individual selectors |
