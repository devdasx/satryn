# 073 — Scanner: Permission-First Flow

## Overview
Fixed both QR scanner implementations to ask for camera permission BEFORE showing the camera view. Previously, the camera view rendered immediately (showing a black screen) and then the permission dialog appeared.

## Changes

### QRScanner Modal (`src/components/scanner/QRScanner.tsx`)
- Added intermediate "Camera Permission" waiting state when `!permission.granted`
- Shows a friendly card with camera icon, title, and description while waiting for system permission dialog
- Camera view only renders after permission is explicitly granted

### Full-Screen Scanner (`app/(auth)/scan.tsx`)
- Changed guard from `if (!permission)` to `if (!permission || !permission.granted)`
- Shows "Camera Permission" UI while waiting for grant
- Camera only renders after permission is confirmed

## Files Changed
| File | Changes |
|------|---------|
| `src/components/scanner/QRScanner.tsx` | Added permission-first state |
| `app/(auth)/scan.tsx` | Added permission check before camera render |
