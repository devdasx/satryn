# Changelog 103 — Preserve-on-Delete: Full Data Restore

## Problem

The "Preserve Data on Delete" feature had two issues:

1. **Backup screen showed "Could not load backup data"** after a preserve restore. Wallet secrets (mnemonic, xprv, WIF, seed hex) were written to the SQLite database during restoration, but the Backup screen reads from the iOS Keychain (`SecureStorage.retrieveWalletSeed()`). Since the user's PIN doesn't exist during the restoration step (it's created after), secrets couldn't be encrypted and stored in the Keychain at restore time.

2. **Missing data categories.** The archive only preserved secrets, addresses, UTXOs, transactions, contacts, settings, transaction labels, and UTXO metadata. Three high-priority data categories were not included:
   - Recent recipients
   - Saved Electrum servers (user-added, favorites, notes)
   - Address book entries

## Solution

### Fix 1: Re-store secrets to Keychain after PIN creation

In `app/(onboarding)/pin.tsx`, the `handleCreateSuccess` callback for `isPreserveRestore` mode now:
1. Stores the new PIN
2. Reads each wallet's secrets from the SQLite database
3. Re-encrypts and stores them in the iOS Keychain using the new PIN
4. Handles all secret types: mnemonic, xprv, WIF, seed hex
5. Also stores legacy single-wallet seed for fallback compatibility

### Fix 2: Archive additional data categories

Extended `PreservedSettingsPayload` (v2.2) to include:
- `recentRecipients` — from `recent_recipients` DB table
- `savedServers` — user-added, favorited, or servers with notes/labels from `saved_servers` DB table
- `activeServer` — current active server config from `app_config`
- `addressBook` — entries from `useAddressBookStore` (AsyncStorage-backed)

### Fix 3: Restore additional data on reinstall

Updated `RestorationProgressSheet.tsx` to restore the new data categories:
- Bulk-inserts recent recipients to `recent_recipients` table via `db.upsertRecipient()`
- Upserts saved servers to `saved_servers` table via `db.upsertSavedServer()` and reloads `serverStore`
- Restores active server config via `serverStore.setActiveServer()`
- Restores address book entries via `useAddressBookStore.addEntry()`

## Files Modified

| File | Change |
|------|--------|
| `app/(onboarding)/pin.tsx` | Re-store wallet secrets from DB to Keychain after PIN creation in preserve-restore mode |
| `src/services/storage/PreservedArchiveService.ts` | Extended `PreservedSettingsPayload` with recentRecipients, savedServers, activeServer, addressBook; updated `archiveFullState()` to gather them |
| `src/components/preserve/RestorationProgressSheet.tsx` | Added restoration logic for recent recipients, saved servers, active server, and address book |

## Data Flow

```
ARCHIVE (on app delete with preserve enabled):
  Wallet secrets (mnemonic, xprv, WIF, seedHex)  → Keychain (encrypted snapshots)
  Addresses, UTXOs, Transactions                  → Keychain (encrypted snapshots)
  Contacts, Tx Labels, UTXO Metadata              → Keychain (settings payload)
  Recent Recipients                               → Keychain (settings payload, v2.2)
  Saved Servers + Active Server                   → Keychain (settings payload, v2.2)
  Address Book                                    → Keychain (settings payload, v2.2)

RESTORE (on reinstall):
  1. Enter password → decrypt Keychain data
  2. Apply wallet snapshots to SQLite (secrets go to DB only)
  3. Restore settings, contacts, labels, UTXO metadata
  4. Restore recent recipients to DB
  5. Restore saved servers to DB + reload serverStore
  6. Restore active server config
  7. Restore address book entries
  8. Create PIN → re-encrypt secrets from DB to Keychain
  9. Enter app with full state restored
```

## Verification

1. `npx tsc --noEmit` — 0 new errors (1 pre-existing in KeySection.tsx)
2. Enable "Preserve Data on Delete" → delete app → reinstall → restore
3. Backup screen should show wallet seed phrase (no longer "Could not load backup data")
4. Recent recipients should persist across reinstall
5. Favorited/user-added Electrum servers should persist
6. Address book entries should persist
7. Active server config should be restored
