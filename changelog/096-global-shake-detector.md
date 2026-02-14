# 096 — Global Shake-to-Report (All Pages)

## Overview
Moved the shake-to-report feature from the auth layout to the root layout so the feedback sheet triggers on ANY page — including the lock screen and onboarding flow, not just authenticated screens.

## Problem
`useShakeDetector` was called in `app/(auth)/_layout.tsx`, which only wraps authenticated screens. If the user shook their device on the lock screen or during onboarding, nothing happened.

## Fix
Moved `useShakeDetector` + `FeedbackSheet` + `showFeedback` state to `app/_layout.tsx` (root layout), which wraps every screen in the app. Removed the shake detector code and FeedbackSheet from the auth layout.

## Files Changed
| File | Changes |
|------|---------|
| `app/_layout.tsx` | Added `useShakeDetector`, `FeedbackSheet`, `showFeedback` state, `handleShake` callback |
| `app/(auth)/_layout.tsx` | Removed `useShakeDetector`, `FeedbackSheet`, `showFeedback` state, related imports |
