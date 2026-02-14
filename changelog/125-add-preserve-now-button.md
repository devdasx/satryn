# 125 — Add Manual "Preserve Now" Button to Data & Backup

## Date
2025-02-12

## Summary

Added a "Preserve Now" button to the Data & Backup page so users can manually trigger a fresh preservation of their wallet data to the iOS Keychain. The button appears when Preserve Data on Delete is enabled, and launches the archival progress sheet showing real-time status. The archival creates new preserved data and merges it with any existing preserved data (existing wallet archives are updated, new wallets are added).

Also cleaned up stale PBKDF2 references in `ContinuousArchivalManager.ts` comments — the v2 archive format uses gzip + Keychain hardware encryption, not PBKDF2.

---

## Changes

### Manual Preserve Now Button

**File:** `app/(auth)/data-backup.tsx`

Added a new "Preserve Now" row inside the Preserve Data on Delete card (visible only when the feature is enabled). Tapping it:
1. Gets the preserve password from `PreserveDataSession`
2. Opens the `ArchivalProgressSheet` (reused existing component)
3. Runs `PreservedArchiveService.archiveFullState()` which creates new snapshots and merges with existing archives

### Stale Comment Cleanup

**File:** `src/services/storage/ContinuousArchivalManager.ts`

Updated 3 comments that referenced PBKDF2 encryption — the v2 archive format no longer uses PBKDF2 for new writes (uses gzip + iOS Keychain hardware encryption instead).

---

## Archival Behavior Note

The automatic continuous archival (on app background, wallet sync, wallet add/remove) already correctly checks `preserveDataOnDelete` before running. All 5 trigger points are properly guarded:
1. App background → `ContinuousArchivalManager.triggerIfNeeded()` checks setting
2. Background sync → same
3. Wallet add → same
4. Wallet remove → same
5. App reset → `AppStateManager` checks setting

---

## Files Modified

| File | Changes |
|------|---------|
| `app/(auth)/data-backup.tsx` | Added "Preserve Now" button, `ArchivalProgressSheet` integration, state management |
| `src/services/storage/ContinuousArchivalManager.ts` | Updated 3 stale PBKDF2 comment references |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Data & Backup page: Preserve toggle ON → "Preserve Now" button visible with green refresh icon
3. Tap "Preserve Now" → archival progress sheet opens, archives all wallets, shows completion
4. Existing preserved data is merged (updated wallets replaced, new wallets added)
5. Preserve toggle OFF → "Preserve Now" button not visible
