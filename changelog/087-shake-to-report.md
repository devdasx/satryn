# 087 — Shake to Report (Feedback Sheet)

## Overview
Added a shake-to-report feature. When the user shakes their phone, a premium feedback bottom sheet appears with options to report bugs, suggest features, or ask questions. Sends feedback via email to support@satryn.com.

## Changes

### Shake Detector Hook
- Created `src/hooks/useShakeDetector.ts`
- Uses `expo-sensors` Accelerometer
- Threshold: 1.8G, cooldown: 2 seconds

### Feedback Sheet
- Created `src/components/feedback/FeedbackSheet.tsx`
- Three category cards: Bug Report, Feature Suggestion, Question
- Text input with 1000 character limit
- Opens native email client with pre-filled subject and body

### Integration
- Added to `app/(auth)/_layout.tsx` as a global overlay
- Shake detection active across all authenticated screens

## Dependencies Added
- `expo-sensors` — for accelerometer access

## Files Changed
| File | Changes |
|------|---------|
| `src/hooks/useShakeDetector.ts` | New hook — shake detection via accelerometer |
| `src/components/feedback/FeedbackSheet.tsx` | New component — feedback bottom sheet |
| `app/(auth)/_layout.tsx` | Integrated shake detector + feedback sheet |
| `package.json` | Added expo-sensors dependency |
