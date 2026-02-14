# 100 — Unified Sync Capsule, Send Advanced Settings, Activity Day Grouping & System Font Enforcement

## Overview
Unified the sync status display across the app using a single connection-aware component, added the Advanced Settings card to the send review step, enforced system font everywhere (removing Courier/monospace), fixed Metro bundler `@noble/hashes` export warnings, and changed the activity screen to show transactions grouped by individual days instead of week/month buckets.

---

## 1. Unified SyncStatusCapsule Component

### Problem
Portfolio tab showed "Synced" correctly (uses `useConnectionState()` which merges ElectrumClient FSM + syncStore), but Wallet tab showed "Tap to sync" (only used raw `useSyncStore()` without Electrum FSM awareness). The two tabs displayed conflicting sync status.

### Solution
Created a single `SyncStatusCapsule` component that uses `useConnectionState()` as the sole source of truth, matching the Portfolio tab's accurate logic.

### New File: `src/components/wallet/SyncStatusCapsule.tsx`
- Uses `useConnectionState()` hook (ElectrumClient 6-state FSM + Zustand syncStore merged)
- If `connection.isConnected` is true and not offline, shows "Synced" (green) or "Syncing" (amber) — even if raw syncStore says "not_synced"
- Falls back to raw syncStore state when not connected
- Renders a compact capsule with colored dot + label text
- Optional `onPress` prop wraps in a `Pressable` with haptic feedback
- Theme-aware colors via `THEME.syncStatus.*` constants

### Modified: `src/components/wallet/WalletHeader.tsx`
- Replaced `StatusBadge` import with `SyncStatusCapsule`
- Removed `syncStatus` from `WalletHeaderProps` interface (component is now self-managing)
- Changed render from `<StatusBadge status={syncStatus} onPress={...} />` to `<SyncStatusCapsule onPress={onSyncTap} />`

### Modified: `src/components/wallet/index.ts`
- Added export: `export { SyncStatusCapsule } from './SyncStatusCapsule';`

### Modified: `app/(auth)/(tabs)/wallet.tsx`
- Removed `syncStatusMapped` useMemo computation that was mapping raw syncStore states
- Removed `syncStatus={syncStatusMapped}` prop from `<WalletHeader>`
- Removed unused `import type { SyncStatus }` from wallet components
- Changed wallet info sheet status display from `syncStatusMapped` to raw `syncState`

---

## 2. Send Screen — Advanced Settings Card

### Problem
The send store (`sendStore`) already had advanced settings state (`rbfEnabled`, `broadcastEnabled`, `transactionLabel`, `showAdvanced`, `toggleAdvanced`) but these were not surfaced in the UI.

### Solution
Added a collapsible Advanced Settings card to `StepReview` with RBF toggle, Broadcast toggle, and Transaction label input.

### Modified: `src/components/send-v3/steps/StepReview.tsx`
- Added imports: `Switch` from react-native, `useTheme` hook, `PremiumInput`/`PremiumInputCard` components
- Added store selectors: `setRbfEnabled`, `setBroadcastEnabled`, `setTransactionLabel`, `showAdvanced`, `toggleAdvanced`
- Replaced old text-only `advancedSummary` line with full interactive card:
  - **Header**: Pressable row with purple options icon (in tinted circle) + "ADVANCED" uppercase label + rotating chevron
  - **Collapsed state**: Shows one-line summary (e.g. "RBF On · No broadcast")
  - **Expanded state**:
    - RBF toggle row with flash icon + description + native `Switch`
    - Hairline divider
    - Broadcast toggle row with radio icon + description + native `Switch`
    - Hairline divider
    - Transaction label `PremiumInput` with tag icon
- Added styles: `advancedHeader`, `advancedHeaderLeft`, `advancedHeaderRight`, `advancedIconBg`, `advancedOptionRow`, `advancedOptionInfo`, `advancedOptionIcon`, `advancedOptionText`, `advancedDivider`

---

## 3. System Font Enforcement

### Problem
Two files used non-system fonts (`fontFamily: 'Courier'` and `fontFamily: 'monospace'`), breaking the app's system-font-only policy.

### Solution
Replaced all non-system font declarations with system font + `fontVariant: ['tabular-nums']` for numeric alignment.

### Modified: `src/components/ui/PremiumInput.tsx`
- `monospace` style: Removed `fontFamily: 'Courier'`, kept `fontSize: 14`, changed to `letterSpacing: 0.5, fontVariant: ['tabular-nums']`

### Modified: `src/components/send-v3/sendTokens.ts`
- `mono` style: Removed `fontFamily: 'monospace'`, added `letterSpacing: 0.5, fontVariant: ['tabular-nums']`
- `txid` style: Removed `fontFamily: 'monospace'`, added `letterSpacing: 0.5, fontVariant: ['tabular-nums']`

---

## 4. Metro Config — @noble/hashes Export Warning Fix

### Problem
Metro bundler logged warnings: `Attempted to import the module '/node_modules/@noble/hashes/crypto.js' which is not listed in the 'exports' of '@noble/hashes'`. The package declares `./crypto` in its exports map but not `./crypto.js`. Metro internally appends `.js` when resolving, causing a mismatch.

### Solution
Added a custom `resolveRequest` interceptor in Metro config that catches `@noble/hashes/crypto` and resolves it directly to the file, bypassing the exports map lookup.

### Modified: `metro.config.js`
- Added `const path = require('path');`
- Added `config.resolver.unstable_conditionNames = ['require', 'import', 'default'];` for proper export map condition resolution
- Added custom `resolveRequest` function:
  - Intercepts `moduleName === '@noble/hashes/crypto'`
  - Returns `{ filePath: path.resolve(__dirname, 'node_modules/@noble/hashes/crypto.js'), type: 'sourceFile' }`
  - Falls through to original resolver for all other modules

---

## 5. Activity Screen — Day-by-Day Transaction Grouping

### Problem
The activity screen grouped transactions into "Today", "Yesterday", "This Week", and "This Month" buckets. Users wanted to see each day individually with the day name and date.

### Solution
Replaced week/month buckets with individual day sections showing the weekday name and date.

### Modified: `app/(auth)/transactions.tsx`

**`getDateGroup()` function — rewritten:**
- "Today" and "Yesterday" preserved as-is
- Removed "This Week" bucket (previously: transactions within 7 days)
- Removed "This Month" bucket (previously: transactions within current calendar month)
- Each day now returns format: `"Monday, Feb 3"` (or `"Monday, Feb 3, 2025"` if different year)
- Uses `toLocaleDateString('en-US', ...)` for consistent formatting

**`groupByDate()` function — updated ordering:**
- Fixed priority order: `['Pending', 'Today', 'Yesterday']` (removed 'This Week', 'This Month')
- Remaining day sections sorted in reverse chronological order by parsing the date strings
- Uses `new Date(key)` parsing with fallback to `localeCompare` for robustness

---

## Files Changed Summary

| File | Change Type |
|------|-------------|
| `src/components/wallet/SyncStatusCapsule.tsx` | **NEW** — Unified connection-aware sync capsule |
| `src/components/wallet/WalletHeader.tsx` | Modified — Uses SyncStatusCapsule, removed syncStatus prop |
| `src/components/wallet/index.ts` | Modified — Added SyncStatusCapsule export |
| `app/(auth)/(tabs)/wallet.tsx` | Modified — Removed manual sync status mapping |
| `src/components/send-v3/steps/StepReview.tsx` | Modified — Added Advanced Settings collapsible card |
| `src/components/ui/PremiumInput.tsx` | Modified — System font for monospace style |
| `src/components/send-v3/sendTokens.ts` | Modified — System font for mono/txid styles |
| `metro.config.js` | Modified — Custom resolveRequest for @noble/hashes |
| `app/(auth)/transactions.tsx` | Modified — Day-by-day transaction grouping |
