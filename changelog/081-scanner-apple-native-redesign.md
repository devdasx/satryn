# 081 — Scanner: Apple Native Design + QR Detection Animation

## Overview
Redesigned both the full-screen scanner (`scan.tsx`) and the modal scanner (`QRScanner.tsx`) to match Apple's native iOS Code Scanner design with QR detection animation.

## Changes

### Apple-Style Scan Window
- Replaced old scan line animation with subtle corner bracket pulse animation
- Rounded rectangle scan area with `borderRadius: 16` (was square with sharp corners)
- Thicker corner brackets (4px) that breathe with opacity 0.7→1.0 cycle
- Subtle rounded border outline (1.5px) for the full scan area
- Lighter overlay opacity (0.55 vs 0.7) for better camera visibility

### QR Detection Animation
- When QR code is detected:
  1. Scan window springs inward (scale 0.88) with spring physics
  2. Corners turn green (#30D158)
  3. Green overlay with checkmark icon appears
  4. 500ms hold for user to see confirmation
  5. Screen animates closed and action executes
- Success haptic fires immediately on detection

### Visual Refinements
- Title font size reduced (22 vs 24) with tighter letter spacing
- Subtitle uses softer opacity (0.6 vs 0.7)
- Removed old scan line animation entirely
- Cleaner, more minimal overlay

### Both Scanners Updated
- `app/(auth)/scan.tsx` — full-screen scanner with detection animation
- `src/components/scanner/QRScanner.tsx` — modal scanner with detection animation
- Both share identical scan window design and animation behavior

## Files Changed
| File | Changes |
|------|---------|
| `app/(auth)/scan.tsx` | Apple-style corners, detection animation, removed scan line |
| `src/components/scanner/QRScanner.tsx` | Apple-style corners, detection animation, removed scan line |

## TypeScript
Compiles with 0 errors.
