# 062 — UTXO Detail Premium Freeze/Lock Animations

## Overview
Added subtle, premium animations to the UTXO Detail screen for freeze/lock state changes. When a user freezes, unfreezes, locks, or unlocks a UTXO, the hero card and action buttons animate with a gentle scale pulse and opacity flash using `react-native-reanimated` shared values.

## Modified Files

### `app/(auth)/utxo-detail.tsx` — Premium state transition animations

**Added Import:**
- `Animated, useAnimatedStyle, useSharedValue, withSpring, withTiming, withSequence` from `react-native-reanimated`

**Added Shared Values (3):**
- `heroScale` — Controls hero card scale (resting: `1`)
- `heroOpacity` — Controls hero card opacity (resting: `1`)
- `buttonScale` — Controls action buttons scale (resting: `1`)

**Added Animated Styles (2):**
- `heroAnimatedStyle` — Applies `transform: [{ scale: heroScale }]` and `opacity: heroOpacity` to hero card
- `buttonsAnimatedStyle` — Applies `transform: [{ scale: buttonScale }]` to action buttons row

**Added `triggerStateAnimation` Callback:**
```typescript
const triggerStateAnimation = useCallback(() => {
  heroScale.value = withSequence(
    withTiming(0.97, { duration: 120 }),
    withSpring(1, { damping: 12, stiffness: 200 }),
  );
  heroOpacity.value = withSequence(
    withTiming(0.7, { duration: 100 }),
    withTiming(1, { duration: 250 }),
  );
  buttonScale.value = withSequence(
    withTiming(0.95, { duration: 100 }),
    withSpring(1, { damping: 14, stiffness: 180 }),
  );
}, [heroScale, heroOpacity, buttonScale]);
```

**Handler Updates:**
- `handleToggleFreeze`: calls `triggerStateAnimation()` on unfreeze and freeze confirm
- `handleToggleLock`: calls `triggerStateAnimation()` on unlock and lock confirm
- `triggerStateAnimation` added to both handler dependency arrays

**JSX Changes:**
- Hero card: `<View>` → `<Animated.View style={[..., heroAnimatedStyle]}>`
- Actions row: `<View>` → `<Animated.View style={[..., buttonsAnimatedStyle]}>`

## Key Design Decisions
- **Subtle scale pulse** — Hero card scales down to `0.97` (3% shrink) over 120ms then springs back. Just enough to feel tactile without being distracting.
- **Opacity flash** — Hero card flashes to `0.7` opacity over 100ms then fades back to 1 over 250ms. Creates a brief "acknowledgment" effect.
- **Button bounce** — Action buttons scale down to `0.95` over 100ms then spring back with slightly different spring params (damping 14, stiffness 180) for variety.
- **Spring physics** — `withSpring` for the return creates a natural, premium feel with slight overshoot.
- **No layout animations** — Only transform and opacity are animated, avoiding layout thrashing.

## Verification
- `npx tsc --noEmit` — zero errors
- Freeze action: hero card pulses + buttons bounce
- Unfreeze action: hero card pulses + buttons bounce
- Lock action: hero card pulses + buttons bounce
- Unlock action: hero card pulses + buttons bounce
- Animation is subtle and completes in ~300ms
- No animation on initial render
- All freeze/lock functionality preserved
