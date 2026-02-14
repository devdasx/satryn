# 046 — Recipient Step Redesign

## Overview
Premium redesign of the send flow recipient step. Moved address review to a dots menu in the header, redesigned recent recipients as a vertical card list with long-press for address review, and modernized the safety panel notices.

## Modified Files

### `src/components/send-v3/SendHeader.tsx`
- Added dots menu (ellipsis-vertical) on right side when recipient step has a valid address
- Dots menu opens bottom sheet with "Review Address" option
- Tapping "Review Address" opens AddressReviewSheet for visual character-by-character review
- Menu row styled with icon circle, title, subtitle, and chevron

### `src/components/send-v3/RecentRecipientsList.tsx`
- Complete rewrite as vertical card list (was horizontal scroll)
- Each row: colored avatar (hash-based), name/address, timestamp, chevron
- Contact name lookup integrated (shows contact name above truncated address)
- Long-press any recipient to open AddressReviewSheet
- "Long press to review address" hint with fingerprint icon at bottom
- Section header with dot + "RECENT" label

### `src/components/send-v3/steps/StepRecipient.tsx`
- Removed inline "Review address visually" button (moved to SendHeader dots menu)
- Removed AddressReviewSheet import and state
- Moved RecentRecipientsList directly under action pills (Paste / Scan QR / Nearby)
- Removed old bottom-placed recent recipients section

### `src/components/send-v3/SafetyPanel.tsx`
- "New Recipient" notice → "First Transaction" with friendlier message
- Self-send warning: changed from `caution` to `info` severity
- Self-send title: "Self-Transfer", message: "Sending to your own wallet. A network fee applies."
- Added "Got it" dismissal action on self-send notice

## Verification
- `npx tsc --noEmit` — zero errors
