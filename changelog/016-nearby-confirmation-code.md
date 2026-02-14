# 016 — Nearby Payments: 6-Digit Confirmation Code

## Summary
Added a 6-digit confirmation code to the nearby payment acceptance flow. The code is deterministically derived from the payment `requestId` using SHA-256, so both devices compute the same code independently. The receiver displays the code; the sender must enter it to confirm they're paying the right person.

This prevents man-in-the-middle scenarios where a malicious device could intercept and relay payment requests.

## How It Works

### Code Derivation
```typescript
function deriveConfirmationCode(requestId: string): string {
  const hash = sha256(encode(requestId));
  const num = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
  return (num % 1000000).toString().padStart(6, '0');
}
```

### Flow
1. Receiver shows the 6-digit code in individual animated digit boxes
2. Sender sees a number input field (auto-focused, number keyboard)
3. Sender enters the code the receiver shows them verbally
4. Code is validated locally — "Accept & Send" button only enables when code matches
5. Wrong code shows red border + error message
6. Confirmation code is included in the acceptance message sent to receiver
7. Receiver validates the code in the acceptance message as a second check

### UI Details
- **Receiver side**: Individual digit boxes (46x56px each) with blue tint, border, staggered FadeInDown animation, shield-checkmark header icon, "CONFIRMATION CODE" label
- **Sender side**: TextInput with `autoFocus`, `textContentType="oneTimeCode"`, numeric keyboard, auto-focus with 600ms delay backup

## Files Modified

| File | Change |
|------|--------|
| `src/services/nearby/NearbyPayloadCodec.ts` | Added `deriveConfirmationCode()` function |
| `src/components/nearby/NearbyPaymentReview.tsx` | Added confirmation code input, validation logic, code matching state, auto-focus |
| `src/components/nearby/NearbyReceiveWaiting.tsx` | Added confirmation code digit box display in `pending_acceptance` view |
| `src/components/nearby/NearbyProvider.tsx` | Added confirmation code to acceptance message, receiver-side code validation |

## Verification
- `npx tsc --noEmit` — zero errors
