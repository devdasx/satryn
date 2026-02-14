# 051 — Settings Tab Redesign — Match Dashboard Design Language

## Overview
Complete visual redesign of the Settings tab to match the dashboard's premium design language. Replaces flat grouped sections with card-based layout using `borderRadius: 20`, adds 36px semantically-tinted icon circles, updates typography to `15px/600` labels and `13px/500` values, positions dividers at `left: 64`, and uses `13px/700` uppercase section headers.

## Modified Files

### `app/(auth)/(tabs)/settings.tsx` — Full settings redesign
- **Background**: Changed to `colors.background` (`#F2F2F7` light / `#000000` dark) matching the system settings aesthetic
- **SETTING_ICON_COLORS map**: New semantic tinting system mapping each settings icon to a unique background color with light/dark variants (e.g., `moon-outline` → blue, `logo-bitcoin` → orange, `git-branch-outline` → purple, `lock-closed-outline` → gray)
- **SettingRow redesign**:
  - Icon container: flat gray → `36×36px` circle (`borderRadius: 18`) with semantic tint background
  - Icon size: `18px` → `16px`
  - Label: `16px/500` → `15px/600`, `letterSpacing: -0.2`
  - Value text: `14px/400` → `13px/500`
  - Dividers: now absolute-positioned at `left: 64` (16px padding + 36px icon + 12px gap)
  - Spring animation on press (`scale: 0.98`)
  - Danger variant with red icon tint
- **SettingsSection helper**: New component wrapping section label + card container
  - Card: `borderRadius: 20`, no border, solid `surfacePrimary` bg (light) / `rgba(255,255,255,0.04)` (dark)
  - Section label: `13px/700` uppercase, `0.8` letter-spacing, `30%` opacity
  - Staggered `FadeIn` animation with configurable delay
- **Backup hero card**: Updated to match new card radius and remove border
- **Search functionality**: Updated search result rendering to match new SettingRow design
- **Scroll padding**: Updated to `24px` horizontal for consistent spacing
- **Removed**: Old flat section dividers, section background styles, outdated margin/padding values

## Key Design Decisions
- **Semantic icon tinting** — Each icon gets a unique color (not random) based on its category: blue for display, orange for Bitcoin, purple for wallet, gray for security, green for protected actions
- **No borders** — Cards have no border, just subtle background fill on a contrasting page background
- **Card-based sections** — Each settings group is wrapped in a rounded card, matching iOS Settings app patterns
- **Consistent 64px divider alignment** — All dividers start after the icon circle + gap, creating visual continuity

## Verification
- `npx tsc --noEmit` — zero errors
- Light mode: white cards on `#F2F2F7` background, 20px border radius, semantic icon colors
- Dark mode: subtle `4%` white cards on black, matching icon tints
- All setting rows functional: taps, toggles, navigation, bottom sheets
- Search: results render with new SettingRow design
- Backup hero card: updated styling matches new language
- All bottom sheets still work (theme, currency, fee, gap limit)
