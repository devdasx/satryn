# 023 — Send Flow UX Redesign (v5 Premium Minimal)

**Premium, minimalist send experience. Native inputs. No custom keypad. Unified Options sheets. Apple-quality polish.**

Design philosophy: "Black as brand. Native as possible. Every pixel intentional."

---

## Design Principles

1. **Native over custom** — Use iOS native keyboard instead of custom keypad. Native TextInput for amounts.
2. **Black as brand** — Dark mode primary buttons use solid black (not orange). Light mode also uses black.
3. **Options, not clutter** — Advanced controls live in per-step Options bottom sheets, not inline.
4. **Compact, dense** — Fewer vertical pixels per row. Information-dense review cards.
5. **No toasts** — Already implemented. All feedback is inline.
6. **Haptics everywhere** — Already implemented. Every tap has tactile response.

---

## Implementation Plan

### Phase 1: Design Tokens Update (`sendTokens.ts`)

**Changes:**
- `buttonPrimary`: Change dark mode from `THEME.brand.bitcoin` to `#1C1C1E` (near-black)
- Add new token: `buttonPrimaryBrand: THEME.brand.bitcoin` (for accent use only)
- Add `amountInput` typography style: fontSize 44, fontWeight '200', letterSpacing -1.5
- Remove keypad-specific tokens: `keyBg`, `keyBgPressed`, `keyText`
- Add `compactRowHeight: 44` token for dense list rows
- Add `optionsSheetBg` token for Options sheet background

### Phase 2: StepRecipient Redesign

**Remove:**
- Address type badge/pill (Taproot/SegWit/Legacy label)
- AddressTypeSheet bottom sheet trigger
- BIP21ImportPill component
- Sanitization indicator pill
- "BITCOIN ADDRESS" section label

**Keep:**
- PremiumInput for address entry (mono, multiline)
- Validation icon (checkmark/X)
- Action pills: Paste, Scan QR, Nearby
- Recent recipients list
- Safety panel
- Multi-recipient support (locked recipients)
- Floating continue button

**Modify:**
- Self-send detection: Show inline subtle note instead of SafetyPanel warning
- Contact match: Show contact name below input when matched
- Cleaner empty state: Larger "Who are you sending to?" placeholder
- Action pills: Slightly larger touch targets, centered layout

### Phase 3: StepAmount Redesign (Major)

**Remove:**
- Custom PIN-style circular keypad (entire `keys` array, `keypad` section, `KEY_SIZE` calc)
- `keyBtnText` styles
- Bottom capsule row ("Network Fee", "Choose UTXOs" pills)

**Replace keypad with:**
- Native `TextInput` with `keyboardType="decimal-pad"` for amount entry
- Large centered amount display that IS the input (editable hero text)
- Fiat conversion line below (read-only)
- Unit cycling: Tap the unit label to cycle through sats → BTC → fiat (instead of SegmentedControl)

**Add:**
- "Options" button (gear icon) at bottom → opens AmountOptionsSheet
- AmountOptionsSheet contains:
  - Network Fee selection (fee tiers: Priority/Standard/Economy/Custom)
  - Coin Control (Choose UTXOs)
  - Send Max toggle
- Keep SegmentedControl as secondary option (below input, smaller)

**Layout (top to bottom):**
1. Hero amount TextInput (large, centered, auto-focus)
2. Unit label (tappable to cycle)
3. Fiat conversion line (≈ $X.XX)
4. Send Max capsule
5. SegmentedControl unit switcher (compact, below)
6. Validation warnings (dust, over balance)
7. [spacer - flex grows]
8. "Options" ghost button (opens AmountOptionsSheet)
9. Continue button (primary, full width)

### Phase 4: StepReview Redesign

**Modify:**
- Remove inline Advanced section (RBF, Broadcast, Label toggles)
- Move all advanced controls to ReviewOptionsSheet
- Compact recipient card: single row per recipient (address + amount)
- Compact fee card: fee rate + total on fewer rows
- Transaction label: persistent PremiumInput always visible (not inside Advanced)

**Add:**
- "Options" button → ReviewOptionsSheet containing:
  - Replace-By-Fee toggle
  - Broadcast toggle
  - Unconfirmed policy
  - Privacy mode
  - Coin control summary
  - Fee selection (change fee tier)
- Copy summary icon in header (not inside card)

**Layout (top to bottom):**
1. Amount header (amountLarge + fiat conversion)
2. Safety Panel
3. Recipient(s) card (compact SummaryRows)
4. Fee card (compact: rate + fee + total)
5. Transaction label input (always visible, not collapsible)
6. Warning notice (cannot be reversed)
7. Security note (signed locally)
8. [spacer]
9. "Options" ghost button
10. Send button (primary, full width)

### Phase 5: StepSuccess Redesign

**Modify:**
- Remove concentric ring hero animation
- Replace with: Large checkmark icon in success-tinted circle (simpler)
- Status chip: "Sent", "PSBT Created", "Transaction Created" — pill badge
- Compact details card with fewer rows
- Amount prominently displayed

**Layout (top to bottom):**
1. Success icon (44px circle, checkmark)
2. Status title ("Sent" / "PSBT Created")
3. Status chip (Confirmed/Exported/Signed)
4. Amount display (amountMedium)
5. Fiat equivalent
6. Details card (Fee, TXID/PSBT, Total — compact)
7. Security footer
8. [spacer]
9. Copy button (tertiary)
10. Proof of Payment button (secondary, if broadcast)
11. Done button (primary)

### Phase 6: Options Bottom Sheets

**New components:**

#### `AmountOptionsSheet.tsx`
- Replaces bottom capsule buttons on Amount step
- Contains: Fee selection, Coin control, Send Max
- Uses AppBottomSheet with `sizing="auto"`

#### `ReviewOptionsSheet.tsx`
- Replaces inline Advanced section on Review step
- Contains: RBF, Broadcast, Unconfirmed policy, Privacy mode, Fee selection
- Transaction label stays on main screen (not in options)
- Uses AppBottomSheet with `sizing="auto"`

### Phase 7: SendScreen & SendHeader Updates

**SendScreen.tsx:**
- Add state for AmountOptionsSheet, ReviewOptionsSheet
- Remove showFeeSheet, showCoinControl as separate state (now inside Options sheets)
- Pass Options sheet triggers to StepAmount and StepReview

**SendHeader.tsx:**
- No changes needed (already clean)

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `sendTokens.ts` | Modify | Update button tokens, remove keypad tokens, add amount input style |
| `steps/StepRecipient.tsx` | Modify | Remove address type badge/pill, simplify |
| `steps/StepAmount.tsx` | **Rewrite** | Replace keypad with native TextInput, add Options button |
| `steps/StepReview.tsx` | Modify | Remove inline Advanced, add Options button, compact layout |
| `steps/StepSuccess.tsx` | Modify | Simplify hero, compact details |
| `sheets/AmountOptionsSheet.tsx` | **New** | Fee + Coin Control + Send Max options sheet |
| `sheets/ReviewOptionsSheet.tsx` | **New** | Advanced settings options sheet |
| `SendScreen.tsx` | Modify | Wire up new Options sheets |

## Files NOT Changed (Infrastructure)

- `sendStore.ts` — No state changes needed
- `useSendFlowV3.ts` — Signing logic unchanged
- `SafetyPanel.tsx` — Keep as-is
- `SendErrorSheet.tsx` — Keep as-is
- `primitives/*` — Keep all existing primitives
- All other bottom sheets — Keep as-is

---

## Interaction & Haptics Map

| Action | Haptic | Visual |
|--------|--------|--------|
| Tap amount input | light | Cursor appears, keyboard slides up |
| Cycle unit (tap label) | selection | Unit label animates, amount converts |
| Tap Send Max | selection | Amount fills to max, label changes |
| Open Options sheet | light | Sheet slides up |
| Close Options sheet | light | Sheet slides down |
| Select fee tier | light | Checkmark appears |
| Toggle switch (RBF, etc.) | selection | Switch animates |
| Tap Continue | medium | Button press feedback |
| Tap Send | success | Strong confirmation feedback |
| Copy address/txid | light | Icon changes to checkmark |

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero errors
- [ ] Dark mode fully functional
- [ ] Light mode fully functional
- [ ] Native keyboard for amount entry
- [ ] Options sheets open/close correctly
- [ ] Fee selection works in Options sheet
- [ ] Coin control works in Options sheet
- [ ] RBF/Broadcast toggles work in Options sheet
- [ ] Transaction label persists through flow
- [ ] Send Max works correctly
- [ ] Multi-recipient support preserved
- [ ] Watch-only PSBT export preserved
- [ ] Multisig redirect preserved
- [ ] All haptic feedback working
- [ ] No floating toasts
