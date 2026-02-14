# 068 — Contact Address Verification Disclaimer

## Overview
Added a premium-styled address verification disclaimer to both the Contacts list screen and the Contact Details screen. The disclaimer warns users that a contact may change their Bitcoin address at any time, and reminds them that Bitcoin transactions are irreversible. This is a safety-critical UX addition to protect users from sending funds to outdated or incorrect addresses.

## Design
- **Style**: Orange-tinted card with subtle border, matching the app's warning/caution design language
- **Icon**: `shield-checkmark-outline` (Ionicons) in accent orange (`#FF9F0A`)
- **Background**: `rgba(255,159,10,0.06)` dark mode / `rgba(255,159,10,0.04)` light mode
- **Border**: `rgba(255,159,10,0.10)` dark mode / `rgba(255,159,10,0.07)` light mode
- **Text color**: Muted — `rgba(255,255,255,0.50)` dark / `rgba(0,0,0,0.45)` light
- **Layout**: Horizontal row with icon aligned to top-start, text fills remaining space
- **Padding**: 14px all sides, `borderRadius: 14`, `gap: 10`

## Changes

### `app/(auth)/contact-details.tsx` — Per-contact disclaimer

**Placement**: Inserted after the ADDRESSES section, before the NOTES section, inside the addresses `Animated.View` block.

**Markup added**:
```jsx
{/* Address Disclaimer */}
<View style={[styles.disclaimerCard, {
  backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
  borderColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.07)',
}]}>
  <Ionicons name="shield-checkmark-outline" size={16} color="#FF9F0A" style={{ marginTop: 1 }} />
  <Text style={[styles.disclaimerText, {
    color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)',
  }]}>
    Always verify the address before sending. Contacts may change their address or use a different one. Bitcoin transactions are irreversible.
  </Text>
</View>
```

**Styles added**:
```typescript
disclaimerCard: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 10,
  padding: 14,
  borderRadius: 14,
  borderWidth: 1,
  marginTop: 14,
},
disclaimerText: {
  flex: 1,
  fontSize: 12,
  fontWeight: '400',
  lineHeight: 17,
},
```

---

### `app/(auth)/contacts.tsx` — Global contacts list disclaimer

**Placement**: Added inside the `renderListFooter` function, after the "Add contact" capsule button, as the last element in the list footer. This ensures the disclaimer is visible at the bottom of the contacts list on every visit.

**Markup added**:
```jsx
<View style={[styles.disclaimerCard, {
  backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
  borderColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.07)',
}]}>
  <Ionicons name="shield-checkmark-outline" size={15} color="#FF9F0A" style={{ marginTop: 1 }} />
  <Text style={[styles.disclaimerText, {
    color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
  }]}>
    Always verify the recipient's address before sending. A contact may change their address at any time. Bitcoin transactions cannot be reversed.
  </Text>
</View>
```

**Styles added**:
```typescript
disclaimerCard: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 10,
  padding: 14,
  borderRadius: 14,
  borderWidth: 1,
  marginTop: 20,
},
disclaimerText: {
  flex: 1,
  fontSize: 12,
  fontWeight: '400',
  lineHeight: 17,
},
```

## Disclaimer Text

| Screen | Text |
|--------|------|
| Contact Details | "Always verify the address before sending. Contacts may change their address or use a different one. Bitcoin transactions are irreversible." |
| Contacts List | "Always verify the recipient's address before sending. A contact may change their address at any time. Bitcoin transactions cannot be reversed." |

The wording is intentionally slightly different to avoid feeling repetitive when navigating between the two screens, while conveying the same critical safety message.

## Visual Appearance
- Blends seamlessly with the existing card-based UI
- Orange tint signals "caution" without being alarming
- Shield icon reinforces the security/verification message
- Muted text ensures it doesn't compete with primary content
- Dark and light mode fully supported with tailored opacity values
