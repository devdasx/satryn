# 060 — UTXO Management Floating Capsule — Replace Summary Card with Bottom Capsule

## Overview
Removed the hero summary card from the top of the UTXO Management screen and replaced it with a floating pill-shaped capsule at the bottom of the screen. The capsule shows the filtered UTXO count and total balance in a compact, modern design with shadow and blur-style background.

## Modified Files

### `app/(auth)/utxo-management.tsx` — Summary card → floating capsule

**Removed:**
- Entire summary card block (summaryCard with summaryRow, breakdownRow, multisigRow)
- 14 unused summary-related styles: `summaryCard`, `summaryRow`, `summaryLabel`, `summaryValue`, `summaryDivider`, `breakdownRow`, `breakdownItem`, `breakdownDot`, `breakdownLabel`, `breakdownValue`, `multisigRow`, `multisigLabel`, `multisigValue`, `multisigIndicator`

**Added — Floating Capsule:**
```jsx
<View style={[styles.floatingCapsule, {
  bottom: insets.bottom + 12,
  backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
}]}>
  <Text>{filteredUtxos.length}</Text>
  <Text>{filteredUtxos.length === 1 ? 'UTXO' : 'UTXOs'}</Text>
  <View style={styles.capsuleDot} />
  <Text>{formatAmount(totalValue, denomination)}</Text>
  {fiatTotal != null && <Text>{PriceAPI.formatPrice(fiatTotal, currency)}</Text>}
</View>
```

**New Styles (6):**
- `floatingCapsule`: `position: 'absolute'`, `borderRadius: 999`, `paddingHorizontal: 20`, `paddingVertical: 10`, shadow with `elevation: 8`
- `capsuleCount`: `fontSize: 16`, `fontWeight: '700'`
- `capsuleLabel`: `fontSize: 13`, `fontWeight: '500'`
- `capsuleDot`: `4×4` circle separator
- `capsuleValue`: `fontSize: 15`, `fontWeight: '600'`, `fontVariant: ['tabular-nums']`
- `capsuleFiat`: `fontSize: 12`, `fontWeight: '500'`, `marginLeft: 2`

**FlatList Adjustment:**
- `paddingBottom`: `insets.bottom + 32` → `insets.bottom + 80` (clearance for capsule)

## Key Design Decisions
- **Floating capsule** — Positioned absolutely at the bottom with `borderRadius: 999` for a pill shape. Shows count + value + optional fiat in a single compact row.
- **Semi-transparent background** — `rgba(30,30,30,0.95)` dark / `rgba(255,255,255,0.95)` light for a subtle glass effect.
- **Shadow** — `shadowOffset: { width: 0, height: -2 }`, `shadowOpacity: 0.15`, `shadowRadius: 12` for depth.
- **Only shows when UTXOs exist** — Capsule is conditionally rendered with `filteredUtxos.length > 0`.

## Verification
- `npx tsc --noEmit` — zero errors
- Floating capsule visible at bottom of screen
- Shows correct UTXO count (singular/plural)
- Shows formatted balance amount
- Shows fiat value when available
- FlatList scrolls with proper bottom padding
- Capsule hides when no UTXOs match filters
