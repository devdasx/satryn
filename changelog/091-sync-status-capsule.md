# 091 — Sync Status Capsule + Larger Eye Icon

## Overview
Replaced the small sync status dot in the dashboard header with a capsule that shows both a colored dot and a text label ("Synced", "Syncing", "Not connected"). Also increased the discreet mode eye icon size.

## Changes

### Eye Icon
- Increased from size 18 to 22 for better tap target and visibility

### Sync Status Capsule
- Replaced plain `syncDot` with a `syncCapsule` containing dot + text label
- Capsule has a tinted background matching the status color at 18% opacity
- Dot reduced from 8px to 6px to fit inside capsule
- Text labels: "Synced" (green), "Syncing" (orange), "Not connected" (red/grey)

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/(tabs)/index.tsx` | Eye icon size 18→22, sync dot→capsule with label, added `syncCapsule`/`syncCapsuleText` styles |
