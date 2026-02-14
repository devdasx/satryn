# 008 - Splash Screen & App Icon Update

## Overview
Updated the splash screen and app icon from generic placeholders to proper Satryn branding. Splash screen supports light/dark mode.

## Changes

### 1. Splash Screen (Light + Dark Mode)
- **Light mode**: `assets/splash-icon.png` — black "satryn" wordmark (`appLogo.png`) on `#FFFFFF` white background
- **Dark mode**: `assets/splash-icon-dark.png` — white "satryn" wordmark (`darkLogo.png`) on `#000000` black background
- Configured via `splash.dark` in `app.json` for automatic theme switching
- Expo's `resizeMode: "contain"` centers and scales proportionally

### 2. App Icon
**Replaced**: `assets/icon.png` and `assets/adaptive-icon.png`
- **Before**: Generic concentric circles placeholder (1024×1024)
- **After**: `appIcon.png` — Satryn "S" mark (1024×1024, black on white)

## Files Modified
| File | Change |
|------|--------|
| `assets/splash-icon.png` | Replaced with black Satryn wordmark (`appLogo.png`) — light mode |
| `assets/splash-icon-dark.png` | **NEW** — white Satryn wordmark (`darkLogo.png`) — dark mode |
| `assets/icon.png` | Replaced with Satryn "S" mark (`appIcon.png`) |
| `assets/adaptive-icon.png` | Replaced with Satryn "S" mark (`appIcon.png`) |
| `app.json` | Added `splash.dark` config, light bg `#FFFFFF`, dark bg `#000000` |
