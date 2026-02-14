# Fix #38 — Remove Draft Transaction + Pending Transaction Systems

## Problem

The draft transaction system (save/resume/delete drafts) and pending transaction system (unsigned/unbroadcast tracking) added unnecessary complexity. Neither feature was needed — the send flow is fast enough that drafts are unnecessary, and pending transactions are redundant with on-chain unconfirmed tx tracking.

## What Was Removed

### Draft Transaction System
- **`src/stores/sendDraftStore.ts`** — Deleted (Zustand store with save/resume/delete/clearAll)
- **`src/components/send-v3/sheets/DraftListSheet.tsx`** — Deleted (bottom sheet for draft management)
- **`src/__tests__/stores/sendDraftStore.test.ts`** — Deleted (test file)
- **`src/components/send-v3/SendScreen.tsx`** — Removed `useSendDraftStore` import, `showDraftList` state, `handleResumeDraft` callback, `onOpenDrafts` prop, `<DraftListSheet>` JSX
- **`src/components/send-v3/SendHeader.tsx`** — Removed `useSendDraftStore` import, `useActionFeedback` (only used for drafts), `handleSaveDraft` callback, bookmark button (replaced with spacer for layout)
- **`src/components/send-v3/index.ts`** — Removed `DraftListSheet` export
- **`src/stores/index.ts`** — Removed `useSendDraftStore`, `SendDraft`, `UnconfirmedPolicy` exports

### Pending Transaction System
- **`src/stores/pendingTxStore.ts`** — Deleted (Zustand store with add/remove/clear)
- **`app/(auth)/pending-transactions.tsx`** — Deleted (entire screen)
- **`app/(auth)/_layout.tsx`** — Removed `pending-transactions` Stack.Screen route
- **`app/(auth)/(tabs)/index.tsx`** — Removed `usePendingTxStore` import, `pendingCount`, `totalPendingCount`, "AWAITING BROADCAST" pill badge
- **`src/components/send-v3/useSendFlowV3.ts`** — Removed `usePendingTxStore` import and `addPendingTransaction` usage
- **`src/components/send/useSendFlow.ts`** — Removed `usePendingTxStore` import and `addPendingTransaction` usage
- **`src/components/send/SendContext.tsx`** — Removed `usePendingTxStore` import
- **`app/(auth)/advanced-send.tsx`** — Removed `usePendingTxStore` import and `addPendingTransaction` usage
- **`src/services/AppStateManager.ts`** — Removed `usePendingTxStore` import, removed `pendingTransactions` from `ExpandedFullBackupPayload`, removed pending tx gathering/clearing from backup/restore, removed `pending-transactions-storage` from `ALL_ASYNC_KEYS`
- **`src/stores/walletStore.ts`** — Removed unused `usePendingTxStore` import
- **`src/stores/index.ts`** — Removed `usePendingTxStore` export

### UnconfirmedPolicy Type Migration
- `UnconfirmedPolicy` type was defined in `sendDraftStore.ts` but used by `settingsStore.ts`, `sendStore.ts`, and `StepFee.tsx`
- Inlined the type definition (`type UnconfirmedPolicy = 'confirmed_only' | 'allow_if_needed' | 'allow_always'`) into each file that needs it

## Files Deleted (5)

| File | What It Was |
|------|-------------|
| `src/stores/sendDraftStore.ts` | Draft transaction Zustand store |
| `src/stores/pendingTxStore.ts` | Pending transaction Zustand store |
| `src/components/send-v3/sheets/DraftListSheet.tsx` | Draft list bottom sheet |
| `src/__tests__/stores/sendDraftStore.test.ts` | Draft store unit tests |
| `app/(auth)/pending-transactions.tsx` | Pending transactions screen |

## Files Modified (13)

| File | Changes |
|------|---------|
| `src/components/send-v3/SendScreen.tsx` | Removed draft imports, state, callbacks, JSX |
| `src/components/send-v3/SendHeader.tsx` | Removed draft save button, imports |
| `src/components/send-v3/index.ts` | Removed DraftListSheet export |
| `src/components/send-v3/steps/StepFee.tsx` | Inlined UnconfirmedPolicy type |
| `src/components/send-v3/useSendFlowV3.ts` | Removed pending tx imports and usage |
| `src/components/send/useSendFlow.ts` | Removed pending tx imports and usage |
| `src/components/send/SendContext.tsx` | Removed pending tx import |
| `app/(auth)/(tabs)/index.tsx` | Removed pending tx badge and imports |
| `app/(auth)/advanced-send.tsx` | Removed pending tx imports and usage |
| `app/(auth)/_layout.tsx` | Removed pending-transactions route |
| `src/stores/settingsStore.ts` | Inlined UnconfirmedPolicy type, removed sendDraftStore import |
| `src/stores/sendStore.ts` | Inlined UnconfirmedPolicy type, removed sendDraftStore import |
| `src/stores/index.ts` | Removed draft + pending store exports |
| `src/stores/walletStore.ts` | Removed unused pendingTxStore import |
| `src/services/AppStateManager.ts` | Removed pending tx from backup/restore + storage keys |

## Verification

- `npx tsc --noEmit` — zero errors
- No remaining references to `sendDraftStore`, `pendingTxStore`, or `DraftListSheet`
- No remaining references to `pending-transactions` route
- UnconfirmedPolicy type inlined in all 3 files that use it
