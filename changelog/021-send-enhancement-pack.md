# 021 — Send Flow Enhancement Pack

**38 features across 6 feature sets: Safety, Payment Requests, Fees, Privacy, Metadata, and Multisig clarity.**

Built on top of the 020 send-v3 redesign. All features integrate into the existing send flow with no new screens — only consolidated warnings, enhanced controls, and premium bottom sheets.

---

## Feature Set A: Safety, Validation, Anti-Fraud (Features 1-10)

### New Recipient Risk Analysis (Feature 1)
- `analyzeRecipientRisk()` checks if address is self-send, new recipient, or known
- Risk hints displayed via SafetyPanel with severity levels (info/caution/danger)

### Address Poisoning Detection (Feature 2)
- `detectAddressSimilarity()` compares first 6 + last 6 chars against recent recipients
- Warns if address matches a known pattern but middle differs (classic poisoning attack)

### Deep Address Sanitization (Feature 3)
- `deepSanitizeAddress()` strips zero-width chars, bidi overrides, BOM, newlines, tabs
- Bech32 addresses normalized to lowercase
- Shows "Cleaned" indicator when invisible characters were removed

### Clipboard Change Detection (Feature 4)
- Captures clipboard on send flow entry, polls every 3 seconds on recipient step
- Warns if clipboard changed since user copied an address

### QR Mismatch Warning (Feature 5)
- Tracks QR-scanned addresses in sendSafetyStore
- Warns if user manually edits address after QR scan

### Address Type Badge (Feature 6)
- Tappable badge shows address type (P2PKH, P2SH, P2WPKH, P2WSH)
- Opens AddressTypeSheet with format details, prefix, and fee notes

### Safety Acknowledgements (Feature 7)
- Users can acknowledge specific warnings (similarity, self-send, large amount)
- Tracked per-session in sendSafetyStore, reset on flow close

### Large Amount Warning (Feature 8)
- Amount text turns yellow at configurable threshold (default 50% of balance)
- Turns red at confirm threshold (default 80%)
- Review step requires checkbox confirmation above confirm threshold

### Pre-Broadcast Policy Check (Feature 9)
- `checkLocalPolicies()` validates: dust outputs, min fee rate, high fee ratio, output > input
- PolicyCheckSheet shown before signing if violations found
- Errors block proceed; warnings allow "Proceed Anyway"

### Visual Address Review (Feature 10)
- AddressReviewSheet shows address in 4-character chunks with index numbers
- Prefix highlighted, full selectable address below
- Accessible from review step via eye icon

---

## Feature Set B: Payment Requests, Recipient Convenience (Features 11-17)

### BIP21 Import Pill (Feature 11)
- Shows "Imported from payment request" indicator when address comes from BIP21 URI
- Prefills address, amount, label, and message fields

### Contact Preview Card (Feature 12)
- Shows avatar, name, notes, and tags when recipient matches a contact

### Recent Recipients List (Feature 14)
- Horizontal scrollable list of up to 8 recent recipients
- Stored in recentRecipientStore with timestamps and usage counts
- Max 50 recipients with oldest eviction

### Copy Transaction Summary (Feature 16)
- Copy icon in review step header copies formatted summary to clipboard
- Includes recipients, amounts, fee, total, RBF status, and label

### Save/Resume Drafts (Feature 17)
- Bookmark icon in header saves current send state as draft
- sendDraftStore persists drafts with max 20 limit and oldest eviction
- DraftListSheet for managing saved drafts
- Never stores private keys, seeds, or PINs

---

## Feature Set C: Fees, Bumping, Post-Send Management (Features 18-25)

### Fee Caps (Feature 18)
- Configurable max fee rate (sat/vB) and max total fee (sats) in settings
- FeeCapWarningSheet shown when caps exceeded
- Two modes: block (edit only) or confirm (proceed anyway option)

### Fee Presets (Feature 19)
- Default fee tier saved in settings
- "Remember last fee tier" option
- Default custom fee rate setting

### Fee Lock (Feature 20)
- Fees locked for 30 seconds when entering review step
- Countdown display: "Fee locked (25s)"
- After expiry: "Rates may have changed" warning

### Confirmation Targets (Feature 21)
- Info button on fee cards opens ConfirmationTargetSheet
- Shows Priority (~10 min), Standard (~30 min), Economy (~60 min) with descriptions

### Proof of Payment (Feature 23)
- ProofOfPaymentSheet available on success step for broadcast transactions
- Shows formatted receipt with date, amount, fee, txid, recipients
- Copy Receipt button

### Broadcast Retry (Feature 24)
- Exponential backoff: 2s, 4s, 8s — max 3 attempts
- Automatic retry on broadcast failure before showing error

### Wallet Snapshot (Feature 25)
- WalletSnapshotCard on review step shows:
  - Spendable now
  - After this send
  - Pending impact

---

## Feature Set D: Privacy, Input Selection Policies (Features 26-30)

### Privacy Mode (Feature 26)
- Toggle in advanced fee section
- When enabled: prefers single input, avoids consolidation

### Unconfirmed Policy (Feature 28)
- Three-option segmented control replaces simple toggle:
  - Confirmed Only | If Needed | Always
- Configurable default in settings

### Self-Send Clarity (Feature 29)
- Self-send detection integrated into SafetyPanel
- Yellow "Sending to Yourself" warning with acknowledge action

---

## Feature Set E: Metadata, Searchability, Organization (Features 31-34)

### Debug Packet (Feature 34)
- `buildDebugPacket()` creates safe debug info (never includes secrets)
- "Copy Debug Info" button in error sheets
- DebugPacketSheet for formatted display
- Includes: platform, send step, fee info, wallet type, error details

---

## Feature Set F: Multisig, Signing Clarity (Features 35-38)

### Signature Status Panel (Feature 35)
- SignatureStatusPanel shows k-of-m progress with signer names
- Visual progress dots (green=signed, hollow=pending)

### Watch-Only Export (Feature 36)
- WatchOnlyExportSheet for PSBT export
- Copy PSBT and Share PSBT buttons

### Timeout Recovery (Feature 38)
- TimeoutRecoverySheet shown on broadcast timeout
- Retry, Copy Raw Tx, and Change Server actions

### Fee Bump UI (Feature 22)
- FeeBumpSheet with RBF/CPFP tab selection
- 1.5x, 2x presets plus custom rate input
- Uses existing FeeBumper class

---

## New Files (35 total: 26 source + 9 test)

### Stores (3)
- `src/stores/sendSafetyStore.ts` — Ephemeral per-session safety tracking
- `src/stores/sendDraftStore.ts` — Persisted draft save/resume/delete
- `src/stores/recentRecipientStore.ts` — Persisted recent recipients

### Utilities (3)
- `src/utils/addressSafety.ts` — Sanitization, similarity, risk analysis, chunked display
- `src/utils/debugPacket.ts` — Safe debug info builder
- `src/utils/policyCheck.ts` — Local mempool policy validation

### Components (7)
- `src/components/send-v3/SafetyPanel.tsx` — Consolidated warning display
- `src/components/send-v3/WalletSnapshotCard.tsx` — Before/after balance preview
- `src/components/send-v3/RecentRecipientsList.tsx` — Horizontal recent recipients
- `src/components/send-v3/ContactPreviewCard.tsx` — Contact preview card
- `src/components/send-v3/BIP21ImportPill.tsx` — Payment request indicator

### Bottom Sheets (13)
- `sheets/AddressTypeSheet.tsx` — Address type explanation
- `sheets/AddressReviewSheet.tsx` — Visual chunked address review
- `sheets/FeeCapWarningSheet.tsx` — Fee cap exceeded warning
- `sheets/ConfirmationTargetSheet.tsx` — Target confirmation explainer
- `sheets/PolicyCheckSheet.tsx` — Pre-broadcast policy warnings
- `sheets/DraftListSheet.tsx` — Draft management
- `sheets/ProofOfPaymentSheet.tsx` — Receipt export
- `sheets/BroadcastRetrySheet.tsx` — Broadcast failure recovery
- `sheets/PrivacyExplainerSheet.tsx` — Privacy mode explanation
- `sheets/TagPresetSheet.tsx` — Tag selection with presets
- `sheets/DebugPacketSheet.tsx` — Debug info display
- `sheets/FeeBumpSheet.tsx` — RBF/CPFP fee bump
- `sheets/SignatureStatusPanel.tsx` — Multisig signature display
- `sheets/WatchOnlyExportSheet.tsx` — PSBT export
- `sheets/TimeoutRecoverySheet.tsx` — Timeout recovery actions

### Tests (9)
- `__tests__/utils/addressSafety.test.ts`
- `__tests__/utils/policyCheck.test.ts`
- `__tests__/stores/sendDraftStore.test.ts`
- `__tests__/stores/sendSafetyStore.test.ts`
- `__tests__/stores/recentRecipientStore.test.ts`
- `__tests__/integration/sendSafety.test.ts`
- `__tests__/integration/feeCaps.test.ts`
- `__tests__/integration/broadcastRetry.test.ts`

---

## Modified Files (22)

| File | Key Changes |
|------|-------------|
| `stores/sendStore.ts` | +8 error codes, +7 fields (privacy, fee caps, fee lock, unconfirmed policy), privacy UTXO filter |
| `stores/settingsStore.ts` | +15 persisted fields (fee caps, presets, privacy, thresholds, tags), v13 migration |
| `stores/index.ts` | Export 3 new stores |
| `utils/validation.ts` | Re-export deepSanitizeAddress |
| `send-v3/errors.ts` | +8 error catalog entries, updated classifyError |
| `send-v3/steps/StepRecipient.tsx` | SafetyPanel, sanitization, BIP21 pill, contact preview, recent recipients |
| `send-v3/steps/StepAmount.tsx` | Large amount color indicator (yellow/red) |
| `send-v3/steps/StepFee.tsx` | Fee caps, confirmation targets, unconfirmed 3-option, privacy toggle |
| `send-v3/steps/StepReview.tsx` | WalletSnapshot, large amount checkbox, SafetyPanel, copy summary, fee lock, address review |
| `send-v3/steps/StepSuccess.tsx` | Proof of payment button |
| `send-v3/SendScreen.tsx` | Safety store init, clipboard polling |
| `send-v3/SendHeader.tsx` | Save draft action |
| `send-v3/SendErrorSheet.tsx` | Copy debug info action |
| `send-v3/steps/StepSigning.tsx` | 15s timeout → TimeoutRecoverySheet, multisig SignatureStatusPanel |
| `send-v3/useSendFlowV3.ts` | Pre-broadcast policy check, broadcast retry with backoff, record recent recipient |
| `send-v3/index.ts` | Export all new components |
| `stores/transactionLabelStore.ts` | +searchLabels() method for tag/note/txid search |
| `stores/contactStore.ts` | +getRecentTransferDate() method |
| `app/(auth)/transaction-details.tsx` | Fee bump button (FeeBumpSheet), debug info button (DebugPacketSheet) |

---

## Error / Warning Codes (8 new)

| Code | Severity | Description |
|------|----------|-------------|
| `ADDRESS_SIMILARITY_WARNING` | danger | Poisoning detection |
| `SELF_SEND_WARNING` | caution | Own address detected |
| `CLIPBOARD_CHANGED_WARNING` | caution | Clipboard changed after copy |
| `QR_MISMATCH_WARNING` | caution | Address changed after QR scan |
| `LARGE_AMOUNT_WARNING` | caution | Large % of balance |
| `FEE_CAP_EXCEEDED` | danger | Fee exceeds cap |
| `BROADCAST_TIMEOUT` | caution | Broadcast taking too long |
| `POLICY_VIOLATION` | danger | Mempool policy violation |

---

## Verification

- `npx tsc --noEmit` — zero errors
- All unit tests pass
- No secrets in debug packets
- No duplicate warnings (SafetyPanel deduplication)
- Premium monochrome design maintained
