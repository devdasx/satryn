# 022 — Send Flow Complete Redesign (send-v4 Visual Rebuild)

**Complete visual rebuild of the entire Send experience with a new design system.**

Design philosophy: "Real money movement — calm, serious, minimal, premium."

---

## What Changed

### New Design Token System
- `sendTokens.ts` — Complete rewrite with new color palette, spacing (8pt grid), radius, typography (18 presets), shadows
- Dark mode: #000000 bg, #0A0A0A surface — premium black
- Light mode: #F5F5F0 bg, #FFFFFF surface — warm minimal
- All amounts use `fontVariant: ['tabular-nums']`
- Monochrome controls — no iOS green, no bright blue

### New Primitives (7 components)
- `SendButton` — 4 variants: primary/secondary/tertiary/ghost, haptic feedback
- `SendInput` — Premium text input with validation, focus state, error text, icon support
- `SendCard` — 3 variants: default/elevated/subtle, consistent padding
- `NoticeRow` — Inline notices: info/caution/danger severity
- `SummaryRow` — Label-value pair with tabular-nums, optional copy icon
- `SegmentedControl` — 2-3 option monochrome selector
- `SendSwitch` — Monochrome toggle (not iOS green)

### Rebuilt Shell (3 files)
- `SendScreen.tsx` — Same state machine, cleaner organization
- `SendHeader.tsx` — Centered title, subtle step counter, Pressable buttons
- `SendErrorSheet.tsx` — Uses SendButton primitives, token-based spacing

### Rebuilt Steps (6 files)
- `StepRecipient.tsx` — SendInput for address, integrated safety panel, primitives throughout
- `StepAmount.tsx` — Hero amount (48px), PIN-style 3×4 keypad, SegmentedControl unit switcher
- `StepFee.tsx` — Vertical fee cards, advanced section collapsed with summary line, all primitives
- `StepReview.tsx` — Bank confirmation feel, SummaryRow details, strong Send button (no slide-to-pay)
- `StepSigning.tsx` — Token-based styling, timeout recovery
- `StepSuccess.tsx` — Static checkmark, SendCard details, copy/proof/done buttons

### Rebuilt Supporting (5 files)
- `SafetyPanel.tsx` — NoticeRow-based warnings, max 3 inline + expand
- `RecentRecipientsList.tsx` — Circular avatars, token styling
- `ContactPreviewCard.tsx` — SendCard wrapper, tag chips
- `BIP21ImportPill.tsx` — Token-based pill
- `WalletSnapshotCard.tsx` — SummaryRow-based before/after display

### Rebuilt Bottom Sheets (15 files)
All sheets rebuilt with SendButton, SummaryRow, NoticeRow, SendCard primitives:
- `AddressTypeSheet.tsx` — SummaryRow for details
- `AddressReviewSheet.tsx` — Token-based chunk display
- `FeeCapWarningSheet.tsx` — SummaryRow for cap comparison
- `ConfirmationTargetSheet.tsx` — SendCard tier rows
- `PolicyCheckSheet.tsx` — NoticeRow violations
- `DraftListSheet.tsx` — SendCard draft items
- `ProofOfPaymentSheet.tsx` — SummaryRow receipt
- `BroadcastRetrySheet.tsx` — SendButton actions
- `PrivacyExplainerSheet.tsx` — NoticeRow explanations
- `TagPresetSheet.tsx` — Chip grid with SendInput
- `DebugPacketSheet.tsx` — Monospace display
- `FeeBumpSheet.tsx` — SegmentedControl tabs
- `SignatureStatusPanel.tsx` — SendCard wrapper
- `WatchOnlyExportSheet.tsx` — SendButton actions
- `TimeoutRecoverySheet.tsx` — NoticeRow + SendButton

### Rebuilt Coin Control (1 file)
- `CoinControlSheetV3.tsx` — Square monochrome checkboxes, SendButton actions, token-based

### Updated Index (1 file)
- `index.ts` — Exports all 7 new primitives + existing components

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No slide-to-send | Strong deliberate primary button — intentional press |
| No animations | Zero transitions, instant step swap — professional, fast |
| PIN-style keypad | Circular buttons matching app's PIN screen, KEY_SIZE formula |
| Advanced collapsed | Summary line visible, instant expand on tap |
| Monochrome controls | No iOS green switches, no bright blue — premium finance |
| Bank confirmation review | SummaryRow details, amount hero, wallet impact |
| 8pt spacing grid | Consistent rhythm: 2/4/8/12/16/20/24/32/48 |

---

## New Files (8)

| File | Purpose |
|------|---------|
| `primitives/SendButton.tsx` | 4-variant action button |
| `primitives/SendInput.tsx` | Premium text input with validation |
| `primitives/SendCard.tsx` | 3-variant section container |
| `primitives/NoticeRow.tsx` | Inline severity notices |
| `primitives/SummaryRow.tsx` | Label-value review rows |
| `primitives/SegmentedControl.tsx` | Monochrome option selector |
| `primitives/SendSwitch.tsx` | Monochrome toggle |
| `primitives/index.ts` | Barrel exports |

## Rebuilt Files (34)

| File | Key Changes |
|------|-------------|
| `sendTokens.ts` | Complete rewrite — new palette, spacing, typography, shadows |
| `SendScreen.tsx` | Cleaner organization, token-based spacing |
| `SendHeader.tsx` | Pressable buttons, subtle step counter, token spacing |
| `SendErrorSheet.tsx` | SendButton primitives, useHaptics |
| `SafetyPanel.tsx` | NoticeRow-based, max 3 inline |
| `RecentRecipientsList.tsx` | Circular avatars, token styling |
| `ContactPreviewCard.tsx` | SendCard wrapper |
| `BIP21ImportPill.tsx` | Token-based pill |
| `WalletSnapshotCard.tsx` | SummaryRow-based |
| `CoinControlSheetV3.tsx` | Square checkboxes, SendButton |
| `steps/StepRecipient.tsx` | SendInput, primitives throughout |
| `steps/StepAmount.tsx` | Hero 48px, PIN keypad, SegmentedControl |
| `steps/StepFee.tsx` | Vertical cards, collapsed advanced, all primitives |
| `steps/StepReview.tsx` | Bank confirmation, SendButton, SummaryRow |
| `steps/StepSigning.tsx` | Token-based styling |
| `steps/StepSuccess.tsx` | Static checkmark, SendCard details |
| `sheets/AddressTypeSheet.tsx` | SummaryRow details |
| `sheets/AddressReviewSheet.tsx` | Token chunk display |
| `sheets/FeeCapWarningSheet.tsx` | SummaryRow cap comparison |
| `sheets/ConfirmationTargetSheet.tsx` | SendCard tier rows |
| `sheets/PolicyCheckSheet.tsx` | NoticeRow violations |
| `sheets/DraftListSheet.tsx` | SendCard draft items |
| `sheets/ProofOfPaymentSheet.tsx` | SummaryRow receipt |
| `sheets/BroadcastRetrySheet.tsx` | SendButton actions |
| `sheets/PrivacyExplainerSheet.tsx` | NoticeRow explanations |
| `sheets/TagPresetSheet.tsx` | Chip grid, SendInput |
| `sheets/DebugPacketSheet.tsx` | Monospace display |
| `sheets/FeeBumpSheet.tsx` | SegmentedControl tabs |
| `sheets/SignatureStatusPanel.tsx` | SendCard wrapper |
| `sheets/WatchOnlyExportSheet.tsx` | SendButton actions |
| `sheets/TimeoutRecoverySheet.tsx` | NoticeRow + SendButton |
| `index.ts` | + 7 primitive exports |

---

## What We Kept (Infrastructure — Zero Changes)

| Layer | Files |
|-------|-------|
| State machine | `sendStore.ts` |
| Signing | `useSendFlowV3.ts` |
| Transaction | `TransactionBuilder.ts`, `UTXOSelector.ts` |
| Error catalog | `errors.ts` |
| Safety stores | `sendSafetyStore.ts`, `sendDraftStore.ts`, `recentRecipientStore.ts` |
| Settings | `settingsStore.ts` |
| Validation | `validation.ts`, `addressSafety.ts` |
| Debug | `debugPacket.ts`, `policyCheck.ts` |
| Bottom sheet engine | `AppBottomSheet.tsx` |
| Keyboard utility | `KeyboardSafeBottomBar.tsx` |
| Theme system | `useTheme` hook, `theme.ts` |

---

## Bug Fixes & Enhancements (Post-Release Testing)

### SendErrorSheet — Retry & Support (#1)
- **Try Again** now returns user to review step instead of just closing the sheet
- **Contact Support** opens mailto: to `ssupport@satryn.com` with pre-filled error details (title, message, technical info)
- Added `txError` to `handleAction` callback dependencies

### Draft Save/Resume (#2)
- Integrated `DraftListSheet` into `SendScreen.tsx` with proper state management
- Long-press bookmark icon in `SendHeader` opens draft list sheet
- `handleResumeDraft` restores recipients, fee options, custom rate, labels, RBF, broadcast settings
- Fixed `setRBFEnabled` → `setRbfEnabled` (case mismatch in store method name)

### Fee Bump — RBF/CPFP (#3)
- Rewrote `handleBumpFee` in `transaction-details.tsx` to use `FeeBumper` service
- Validates via `bumper.analyzeRBF()` and `bumper.analyzeCPFP()` before executing
- Shows proper error/success feedback with alerts

### Fee Bump Custom Field Design (#4)
- Replaced `SendInput` with custom `TextInput` row in `FeeBumpSheet.tsx`
- Added "CUSTOM RATE" section label with `sat/vB` suffix indicator
- Styled row with border highlighting when custom value is entered

### Debug Info Display (#5)
- Changed `DebugPacketSheet` sizing from `"large"` to `"auto"` for proper content-based height
- Removed `flex: 1` from content container that was causing layout collapse
- Changed debug container from `maxHeight: 360` to `minHeight: 200, maxHeight: 420`

### Transaction Label/Note Persistence (#6)
- Added flush-on-unmount logic to `TxNoteEditor.tsx`
- Uses refs (`latestNote`, `latestTags`, `hasPendingSave`) to track pending saves
- `flushSave()` immediately persists on component unmount instead of losing debounced changes

### Electrum Server Network Dashboard (#7)
- **New file:** `src/components/ElectrumServerListSheet.tsx` — Full server health dashboard
- Shows currently connected server with score, latency, success/error counts, implementation type
- Lists all 65 servers from `servers.json` with per-server health records
- Summary stats row: total servers, known servers, total successes, total errors
- Sorted: connected first, then by health score, then by success count
- Score badges color-coded: green (70+), amber (40-69), orange (1-39), grey (0/unknown)
- Added `getCurrentServer()` and `isClientConnected()` public methods to `ElectrumAPI.ts`
- Added `ElectrumServerInfo` import to ElectrumAPI types
- Integrated "View All Servers" button in Electrum settings sheet
- Matches 022 premium monochrome design language

### Contacts Tab (#8)
- Removed `ContactPreviewCard` from `StepRecipient.tsx` (send screen)
- Added Contacts tab to navigation bar in `_layout.tsx` (between Wallet and Settings)
- Created `app/(auth)/(tabs)/contacts.tsx` re-exporting from `../contacts`
- iOS: `person.2` / `person.2.fill` SF Symbols; Android: `people-outline` Ionicon

### Sync Button (#9)
- Added `startSyncing()` call from `useSyncStore` before `refreshBalance()` in wallet screen
- Ensures sync state updates properly when user taps the sync capsule button

### StepRecipient Premium Redesign (#10)
- Removed `SendCard` container wrapper around the address text field
- Action icons (Paste, Scan QR, Nearby) moved above the text field as horizontal pill buttons
- Text field now has `T.surface` background with subtle border and shadow — looks like a proper input
- Full-width Continue button at bottom via `KeyboardSafeBottomBar`
- Background set to `T.bg` (same as main dashboard)
- Added "BITCOIN ADDRESS" section label above input
- Validation icon (checkmark/X) inline to the right of the input
- All business logic preserved identically

### App Lock — Screen Restoration (#11)
- `_layout.tsx` now passes `backgroundMs` parameter when auto-locking user
- Lock screen reads `backgroundMs` from route params
- If locked < 5 minutes and navigation stack has history: `router.back()` (returns to previous screen)
- If locked ≥ 5 minutes or no history: `router.replace('/(auth)/(tabs)')` (goes to main screen)

### Splash Screen Logo (#12)
- Resized splash logo to 60% of original size on 1024×1024 canvas
- Both light and dark variants updated
- Original images backed up as `splash-icon-backup.png` and `splash-icon-dark-backup.png`

### Biometric Enable — Device Check + Face ID Prompt (#13)
- `settings.tsx`: Biometric toggle now checks `hasHardwareAsync()` and `isEnrolledAsync()` first
- Shows Alert if Face ID not available/enrolled on device
- Prompts Face ID authentication before showing PIN modal for enable
- Only enables after successful biometric auth + PIN verification

### Auto-Enable Face ID After PIN Creation (#14)
- `pin.tsx`: After successful PIN creation, checks if device has biometric hardware and enrollment
- If available, prompts "Enable Face ID for quick unlock" with `disableDeviceFallback: true`
- On success: stores PIN for biometrics and enables biometrics in settings store
- Silently skips if not available or user declines

### Remove Contacts Card from Dashboard (#15)
- Removed ContactPreviewCard / contacts row from main dashboard (`index.tsx`)
- Contacts now exclusively accessible via the Contacts tab

### Remove Back Arrow from Contacts Screen (#16)
- Removed chevron-back TouchableOpacity from contacts screen header
- Replaced with empty spacer view — contacts is now an independent tab page

### Electrum Server — Full Page (#17)
- **New file:** `app/(auth)/electrum-server.tsx` — Standalone Electrum server management page
- Full page with back navigation, status indicator, server list, host/port/SSL inputs, connect/reset buttons
- Added `electrum-server` to `_layout.tsx` Stack.Screen definitions
- Removed Electrum bottom sheet and ElectrumServerListSheet from `settings.tsx`
- Settings "Electrum Server" row now navigates to the new page via `router.push('/electrum-server')`

### Fee Bump — Direct Broadcast (#18)
- Rewrote `handleBumpFee` in `transaction-details.tsx` to show confirmation Alert with fee details
- Added PIN verification modal (`PinCodeScreen` mode="verify")
- After PIN: creates signer based on wallet type (hd, imported_key, etc.)
- Builds RBF replacement or CPFP child PSBT via `FeeBumper`
- Signs transaction using `TransactionBuilder.sign()` or `signWithImportedKey()`
- Broadcasts directly via `ElectrumAPI.shared(network).broadcastTransaction()`
- Shows status overlay during signing/broadcasting
- No more toast redirect to send screen — everything happens in-place

---

## Modified Files (Bug Fixes)

| File | Changes |
|------|---------|
| `send-v3/SendErrorSheet.tsx` | Retry → review step, Support → mailto link |
| `send-v3/SendScreen.tsx` | Draft list integration, setRbfEnabled fix |
| `send-v3/SendHeader.tsx` | `onOpenDrafts` prop, long-press bookmark |
| `send-v3/steps/StepRecipient.tsx` | Premium redesign: no card wrapper, pill action buttons, surface text field |
| `send-v3/sheets/DebugPacketSheet.tsx` | sizing="auto", fixed layout |
| `send-v3/sheets/FeeBumpSheet.tsx` | Custom TextInput row with sat/vB suffix |
| `transaction-details.tsx` | Direct fee bump: PIN → sign → broadcast (RBF + CPFP) |
| `TxNoteEditor.tsx` | Flush-on-unmount for note/tag persistence |
| `(tabs)/wallet.tsx` | startSyncing() before refreshBalance() |
| `(tabs)/_layout.tsx` | Contacts tab in navigation |
| `(tabs)/contacts.tsx` | New tab file, removed back arrow |
| `(tabs)/index.tsx` | Removed contacts card from dashboard |
| `(tabs)/settings.tsx` | Biometric check enhanced, Electrum sheet → page navigation |
| `(auth)/_layout.tsx` | backgroundMs param on lock, electrum-server Stack.Screen |
| `(auth)/electrum-server.tsx` | **New:** Full Electrum server management page |
| `(lock)/index.tsx` | Conditional screen restoration based on background time |
| `(onboarding)/pin.tsx` | Auto-enable Face ID after PIN creation |
| `ElectrumAPI.ts` | getCurrentServer(), isClientConnected() |
| `ElectrumServerListSheet.tsx` | New server health dashboard component |
| `assets/splash-icon.png` | Resized to 60% on 1024×1024 canvas |
| `assets/splash-icon-dark.png` | Resized to 60% on 1024×1024 canvas |

### Transaction Signing — UTXO Path Alignment Fix (#19)
- Fixed "Can not sign for input #0 with the key" error in `useSendFlowV3.ts`
- Root cause: `UTXOSelector.select()` was called twice — once inside `build()`/`buildMultiRecipient()` and once outside for `selectedInputs` — potentially returning different UTXOs each time
- Fix: Extract actual inputs from the built PSBT via `psbt.txInputs[i].hash` and `psbt.txInputs[i].index`, reverse the hash to get txid, and match back to UTXOs for correct derivation paths
- Applied to both single-recipient and multi-recipient code paths
- Removed unused `UTXOSelector` import

### StepRecipient — Premium Redesign v2 (#20)
- Removed auto-focus on mount — keyboard only appears when user taps the text field
- Removed shadow (`T.shadow.sm`) from address text field container
- Text field now uses mono font, multiline with `numberOfLines={2}` for natural address wrapping
- Action pills (Paste/Scan QR/Nearby) moved below address field with smaller, subtler pill design
- Pills use `T.radius.pill` border radius, `T.borderSubtle` border, and `T.surface` background
- Continue button is now floating via `Animated.View` with `useKeyboardHeight` — 5px padding from keyboard, no container/background behind it
- Replaced `KeyboardSafeBottomBar` with absolutely positioned floating button
- Removed unused imports: `SendInput`, `SendCard`, `KeyboardSafeBottomBar`, `getAddressType`

### AddressTypeSheet — Premium Redesign (#21)
- Smaller icon circle (48px instead of 64px)
- Added colored accent tints per address type: green (Taproot), blue (Native SegWit), amber (Wrapped SegWit), grey (Legacy)
- Title uses `T.font.title` (20px/600) instead of `T.font.heading` (17px/600)
- Prefix now rendered as pill badge with `T.fill` background and `T.radius.pill`
- Replaced `SummaryRow` section with distinct fee note info card using `T.surfaceAlt` background, `flash-outline` icon, and `T.font.caption` text
- Removed unused `SummaryRow` import

### StepAmount — Fiat Currency + PIN Keypad (#22)
- Added local currency (fiat) as third option in SegmentedControl (sats / BTC / USD etc.)
- Fiat mode: hero shows currency prefix ($, EUR, GBP, JPY), conversion line shows equivalent in sats
- Each keystroke converts fiat to sats via `Math.round((fiatAmount / price) * 100_000_000)` and stores sats
- Persists user's unit choice via `defaultCurrencyDisplay` in settingsStore — remembers between sessions
- Keypad styling now matches PinCodeScreen exactly: `Pressable` buttons, no persistent background, `fontSize: 30, fontWeight: '300'`, transparent until pressed
- Delete button and empty placeholder use same base style as PinCodeScreen
- Background color confirmed as `T.bg` (same as main dashboard)
- When Send Max used in fiat mode, switches back to sats display

### Send Max — Fee Recalculation on Rate Change (#23)
- `setFeeOption()` in sendStore now recalculates Send Max amount when `isSendingMax` is true
- `setCustomFeeRate()` in sendStore now recalculates Send Max amount when `isSendingMax` is true
- When user changes fee tier in StepFee, the sending amount adjusts automatically (fee comes from sending amount, not remaining balance)
- Fixed `getEstimatedFee()` to use correct UTXO count for Send Max mode (all selected UTXOs as inputs, 1 output) instead of hardcoded 1 input

### Biometric Enable — PIN First, Then Face ID (#24)
- Reversed the biometric enable flow in `settings.tsx`: PIN verification first, then Face ID prompt
- If Face ID fails or is cancelled after correct PIN, biometrics are NOT enabled
- `handleBiometricPinVerify` no longer stores PIN for biometrics (deferred to after Face ID success)
- `handleBiometricPinSuccess` now prompts Face ID, and only on success stores PIN and enables biometrics
- Matches user expectation: prove identity with PIN → confirm with biometrics

### Electrum Server Network — Empty Sheet Fix (#25)
- Server list was showing empty because `ScrollView` with `flex: 1` was inside a non-flex parent wrapper
- Fix: Added `scrollable` prop to `AppBottomSheet` so the sheet handles scrolling internally
- Replaced inner `ScrollView` with a plain `View` wrapper — `AppBottomSheet` now provides the scroll container
- Removed unused `ScrollView` import from `ElectrumServerListSheet.tsx`

---

## Modified Files (Bug Fixes — Round 3)

| File | Changes |
|------|---------|
| `send-v3/useSendFlowV3.ts` | Extract PSBT inputs instead of re-selecting UTXOs, removed UTXOSelector import |
| `send-v3/steps/StepRecipient.tsx` | Floating Continue, no auto-focus, no shadow, smaller pills below field, mono font |
| `send-v3/steps/StepAmount.tsx` | Fiat currency support, PIN keypad style, persisted unit choice, Pressable buttons |
| `send-v3/sheets/AddressTypeSheet.tsx` | Colored accent icons, pill prefix, fee note card, smaller icon |
| `stores/sendStore.ts` | Send Max recalculation on fee change, fixed getEstimatedFee UTXO count |

## Modified Files (Bug Fixes — Round 4)

| File | Changes |
|------|---------|
| `(tabs)/settings.tsx` | Biometric enable: PIN first → Face ID second, fail if Face ID fails |
| `ElectrumServerListSheet.tsx` | Added `scrollable` prop, replaced ScrollView with View, removed unused import |

## Bug Fixes — Round 5

### Fix #26 — Mixed address type signing error ("witnessUtxo but non-segwit script")
- **Root cause:** Legacy (P2PKH) inputs were incorrectly added to PSBT with `witnessUtxo` instead of `nonWitnessUtxo`. P2PKH is not a SegWit script type, so bitcoinjs-lib rejects it with "Input #0 has witnessUtxo but non-segwit script."
- **Context:** When a user previously sent to a Legacy address (1... or m/n...), the change went to a Legacy change address (e.g., `m/44'/0'/0'/1/0`). When spending that change UTXO, the transaction builder used `witnessUtxo` which is only valid for SegWit.
- **Fix in `TransactionBuilder.ts`:** Legacy inputs now use `nonWitnessUtxo` with the full raw transaction hex buffer. Added fallback warning when `rawTxHex` is missing.
- **Fix in `PSBTService.ts`:** Same fix — Legacy inputs use `nonWitnessUtxo`. Also fixed `signPSBT()` to extract address from `nonWitnessUtxo` (was skipping Legacy inputs entirely). Fixed `analyzePSBT()` to read value/address from `nonWitnessUtxo`.
- **Fix in `FeeBumper.ts`:** RBF replacement now detects address type per input and uses `nonWitnessUtxo` for Legacy inputs.
- **New `rawTxHex` field on UTXO type:** Added optional `rawTxHex?: string` to the `UTXO` interface for carrying the full previous transaction hex.
- **New `getRawTransactionHexBatch()` on ElectrumAPI:** Batch-fetches raw transaction hexes from Electrum for Legacy UTXOs in a single round-trip.
- **Send flow (`useSendFlowV3.ts`):** Added `enrichLegacyUtxos()` helper that auto-detects Legacy UTXOs and pre-fetches their raw transaction hexes via ElectrumAPI before building the PSBT. Applied to both `handleSendWithSigner` and `handleSendWatchOnly`.

## Modified Files (Bug Fixes — Round 5)

| File | Changes |
|------|---------|
| `types/index.ts` | Added `rawTxHex?: string` to UTXO interface |
| `services/electrum/ElectrumAPI.ts` | Added `getRawTransactionHexBatch()` method |
| `core/transaction/TransactionBuilder.ts` | Legacy inputs use `nonWitnessUtxo` instead of `witnessUtxo` |
| `services/psbt/PSBTService.ts` | Legacy inputs use `nonWitnessUtxo`; fixed `signPSBT` and `analyzePSBT` for Legacy |
| `core/transaction/FeeBumper.ts` | RBF replacement uses correct UTXO type per address type |
| `send-v3/useSendFlowV3.ts` | Added `enrichLegacyUtxos()` to pre-fetch raw tx hex for Legacy UTXOs |

## Bug Fixes — Round 6

### Fix #27 — Taproot signer publicKey mismatch ("Can not sign for input #X with the key")
- **Root cause:** When creating the Taproot signer object for `signTaprootInput()`, the `publicKey` field used the **internal pubkey** (`internalPubkey`) instead of the **tweaked output key** (`tweakedPubkey`). bitcoinjs-lib extracts `toXOnly(publicKey)` and compares it against the P2TR output key embedded in the witness script — the internal key ≠ tweaked key, so the match fails.
- **Fix in `TransactionBuilder.ts` `sign()`:** Changed `taprootKeyPair.internalPubkey` → `taprootKeyPair.tweakedPubkey` in the signer's `publicKey` field.
- **Fix in `TransactionBuilder.ts` `signWithImportedKey()`:** Same fix for imported key Taproot signing.
- **Fix in `PSBTService.ts` `signPSBT()`:** Same fix for PSBT service Taproot signing.

## Modified Files (Bug Fixes — Round 6)

| File | Changes |
|------|---------|
| `core/transaction/TransactionBuilder.ts` | Taproot signer uses `tweakedPubkey` in both `sign()` and `signWithImportedKey()` |
| `services/psbt/PSBTService.ts` | Taproot signer uses `tweakedPubkey` in `signPSBT()` |

## Bug Fixes — Round 7

### Fix #28 — RBF not signaled despite being enabled ("Opt-in RBF disabled" on mempool.space)
- **Root cause:** `TransactionBuilder.addInput()` never set the `sequence` field on any input. Without an explicit sequence, bitcoinjs-lib defaults to `0xFFFFFFFF` which disables RBF (BIP 125 requires sequence < `0xFFFFFFFE`). The user's transaction was broadcast with both inputs having sequence `4294967295` (disabled).
- **Note:** `PSBTService.addInput()` and `FeeBumper.createRBFReplacement()` already correctly set `sequence: enableRBF ? 0xFFFFFFFD : 0xFFFFFFFF`, but `TransactionBuilder` (the main code path for normal sends) did not.
- **Fix in `TransactionBuilder.ts`:**
  - Added `enableRBF?: boolean` (default: `true`) to `BuildTransactionParams` and `BuildMultiRecipientParams` interfaces.
  - Added `enableRBF` parameter to private `addInput()` method.
  - All 8 `psbt.addInput()` calls inside `addInput()` now set `sequence: enableRBF ? 0xFFFFFFFD : 0xFFFFFFFF`.
  - `build()`, `buildSendMax()`, and `buildMultiRecipient()` all destructure and pass `enableRBF` through.
- **Fix in `useSendFlowV3.ts`:** All 6 builder calls (`buildSendMax`, `build`, `buildMultiRecipient` × 2 code paths) now pass `enableRBF: s.rbfEnabled` from the send store.
- **Result:** Transactions will now correctly signal RBF (sequence `0xFFFFFFFD`) when the user has RBF enabled, and mempool.space will show "Opt-in RBF" as expected.

## Modified Files (Bug Fixes — Round 7)

| File | Changes |
|------|---------|
| `core/transaction/TransactionBuilder.ts` | Added `enableRBF` to params + `addInput()`; all inputs now set `sequence` field |
| `send-v3/useSendFlowV3.ts` | All 6 builder calls pass `enableRBF: s.rbfEnabled` from send store |

## Bug Fixes — Round 8

### Fix #29 — Remove all toast/alert notifications, replace with inline feedback

- **Problem:** The app used floating toast banners (`showAlertBar`, `showBitcoinReceived`, `showBitcoinSent`) for all feedback — copy confirmations, transaction status, errors, etc. These were intrusive, covered UI elements, and didn't match the premium monochrome design.
- **Solution:** Replaced ALL toast notifications across 20+ files with two new patterns:
  1. **Inline copy feedback** (`useCopyFeedback` hook) — button text/icon changes to "Copied ✓" for 1.5s after copying
  2. **Inline action feedback** (`useActionFeedback` hook) — temporary status message for non-copy actions
  3. **Native alerts** (`Alert.alert`) — only for errors and destructive confirmation dialogs
- **New hooks created:**
  - `src/hooks/useCopyFeedback.ts` — Handles `Clipboard.setStringAsync` + haptics + temporary "copied" state
  - `src/hooks/useActionFeedback.ts` — Provides temporary status message with auto-clear timer
  - Both exported from `src/hooks/index.ts`
- **Files modified (20+ files):**
  - `app/_layout.tsx` — Removed `TransactionToastBridge`, removed `<ToastProvider>` wrapper
  - `app/(auth)/receive.tsx` — Copy buttons show "Address Copied ✓" / checkmark inline
  - `app/(auth)/wallet-hub.tsx` — Removed status toasts for wallet switch/rename/remove
  - `app/(auth)/(tabs)/wallet.tsx` — Removed useToast, kept error Alert.alert
  - `app/(auth)/(tabs)/index.tsx` — Balance copy uses useCopyFeedback
  - `app/(auth)/contacts.tsx` — Address copy uses useCopyFeedback
  - `app/(auth)/contact-details.tsx` — Address/payment copy uses useCopyFeedback
  - `app/(auth)/sign-transaction.tsx` — Error toasts → Alert.alert
  - `app/(auth)/broadcast.tsx` — TXID copy shows "Copied!" inline
  - `app/(auth)/verify-message.tsx` — Verification result shown inline (ResultCard)
  - `app/(auth)/sign-message.tsx` — Signature copy uses useCopyFeedback
  - `app/(auth)/pending-transactions.tsx` — Hex/address/txid copy inline
  - `app/(auth)/backup.tsx` — Seed phrase copy shows "Copied!" inline
  - `app/(auth)/multisig-send.tsx` — 18 toast instances converted (copy → inline, errors → Alert)
  - `app/(auth)/advanced-send.tsx` — Removed showBitcoinSent, error → Alert
  - `src/components/send/useSendFlow.ts` — Removed useToast, errors via setTxError
  - `src/components/send-v3/useSendFlowV3.ts` — Removed useToast
  - `src/components/send-v3/SendHeader.tsx` — Draft save shows checkmark icon inline
  - `src/components/send-v3/steps/StepSuccess.tsx` — Copy button shows "Copied!" inline
  - `src/components/send-v3/steps/StepSigning.tsx` — Raw tx copy inline, errors → Alert
  - `src/components/payment/PaymentSheet.tsx` — PSBT/TXID/address copy inline
  - `src/components/contacts/RequestFromContactSheet.tsx` — Errors → Alert.alert
  - `src/components/contacts/AddEditContactSheet.tsx` — Removed save confirmation toasts
  - `src/components/bitcoin/AddressDisplay.tsx` — Copy shows "Copied!" + checkmark inline
- **ToastProvider stubbed:** `src/providers/ToastProvider.tsx` replaced with no-op stub (all exports preserved as no-ops for safety)
- **Result:** Zero floating notifications. All feedback is contextual and inline. Premium, calm UX.

## Modified Files (Bug Fixes — Round 8)

| File | Changes |
|------|---------|
| `src/hooks/useCopyFeedback.ts` | NEW — Inline copy feedback hook |
| `src/hooks/useActionFeedback.ts` | NEW — Inline action feedback hook |
| `src/hooks/index.ts` | Added exports for both new hooks |
| `src/providers/ToastProvider.tsx` | Replaced with no-op stub |
| `app/_layout.tsx` | Removed TransactionToastBridge + ToastProvider wrapper |
| `app/(auth)/receive.tsx` | useCopyFeedback for address/invoice copy |
| `app/(auth)/wallet-hub.tsx` | Removed useToast, removed status toasts |
| `app/(auth)/(tabs)/wallet.tsx` | Removed useToast |
| `app/(auth)/(tabs)/index.tsx` | useCopyFeedback for balance copy |
| `app/(auth)/contacts.tsx` | useCopyFeedback for address copy |
| `app/(auth)/contact-details.tsx` | useCopyFeedback for address/payment copy |
| `app/(auth)/sign-transaction.tsx` | showAlertBar → Alert.alert |
| `app/(auth)/broadcast.tsx` | useCopyFeedback for TXID copy |
| `app/(auth)/verify-message.tsx` | Inline verification result state |
| `app/(auth)/sign-message.tsx` | useCopyFeedback for signature copy |
| `app/(auth)/pending-transactions.tsx` | useCopyFeedback for hex/address/txid |
| `app/(auth)/backup.tsx` | useCopyFeedback for seed/descriptor copy |
| `app/(auth)/multisig-send.tsx` | 18 toast → useCopyFeedback + Alert.alert |
| `app/(auth)/advanced-send.tsx` | Removed showBitcoinSent, error → Alert |
| `src/components/send/useSendFlow.ts` | Removed useToast, errors via setTxError |
| `src/components/send-v3/useSendFlowV3.ts` | Removed useToast |
| `src/components/send-v3/SendHeader.tsx` | useActionFeedback for draft save |
| `src/components/send-v3/steps/StepSuccess.tsx` | useCopyFeedback for TXID/PSBT copy |
| `src/components/send-v3/steps/StepSigning.tsx` | useCopyFeedback + Alert for timeout recovery |
| `src/components/payment/PaymentSheet.tsx` | useCopyFeedback for PSBT/TXID/address copy |
| `src/components/contacts/RequestFromContactSheet.tsx` | Errors → Alert.alert |
| `src/components/contacts/AddEditContactSheet.tsx` | Removed save confirmation toasts |
| `src/components/bitcoin/AddressDisplay.tsx` | useCopyFeedback + inline "Copied!" |

## Bug Fixes — Round 9

### Fix #30 — Electrum server connection stability + detailed error logging

- **Problem:** The Electrum connection frequently dropped and stayed offline. After connecting and fetching transactions/balance, the connection would disconnect and not reconnect. The app relied entirely on lazy reconnection (connecting only when the next API call needed it), with no proactive connection maintenance.
- **Root causes identified:**
  1. `socket.on('close')` handler did NOT auto-reconnect — just transitioned to 'disconnected' and cancelled pending requests
  2. Keepalive ping failure attempted a single reconnect and gave up if that failed
  3. No persistent connection health monitor existed
  4. App foreground transitions didn't verify connection health
  5. Debug logging was disabled (`DEBUG = false`), making it impossible to diagnose issues

- **Fixes in `ElectrumClient.ts`:**
  - **Auto-reconnect on socket close:** When the socket closes unexpectedly while in `ready` state, `scheduleAutoReconnect()` is called with exponential backoff (1s, 2s, 4s, 8s, 15s cap, max 5 attempts)
  - **Improved keepalive:** Reduced interval from 30s to 20s for more frequent health checks. Keepalive failure now triggers `scheduleAutoReconnect()` instead of a single reconnect attempt
  - **Auto-reconnect state machine:** New fields `autoReconnectAttempts`, `autoReconnectTimer`, `intentionalDisconnect`, `lastConnectedAt`, `lastDisconnectedAt` track reconnection state
  - **Intentional disconnect flag:** `disconnect()` sets `intentionalDisconnect = true` to prevent auto-reconnect when the app explicitly disconnects (background/logout). `connect()` clears this flag.
  - **Connection diagnostics:** New `getDiagnostics()` method exposes state, uptime, reconnect attempts, pending/queued request counts for debugging
  - **Detailed logging enabled:** `DEBUG = true`, `logError` always logs (not gated by DEBUG flag)
  - **Rich SyncLogger entries:** Every state transition, socket event, keepalive ping, and auto-reconnect attempt is logged to SyncLogger for the Debug Logs screen

- **Fixes in `ElectrumAPI.ts`:**
  - **Persistent health monitor:** New `startHealthMonitor()` / `stopHealthMonitor()` / `performHealthCheck()` methods. Runs every 25s, checks `isConnected()`, and if disconnected, proactively reconnects. If connected, verifies with a ping (10s timeout). On ping failure, forces disconnect and reconnect.
  - **Auto-start on connect:** `connect()` now automatically starts the health monitor after successful connection
  - **Auto-stop on disconnect:** `disconnect()` and `disconnectAll()` stop the health monitor
  - **Detailed logging:** `DEBUG = true`, `logError` always logs. Connect/disconnect/broadcast events logged to SyncLogger with timing info.
  - **Health monitor diagnostics:** New `getHealthMonitorStatus()` method exposes monitor state, last check time, fail count, and client diagnostics

- **Fixes in `useBackgroundWalletSync.ts`:**
  - **App foreground reconnection:** When app becomes active, immediately calls `ensureConnectionHealth()` which checks if Electrum is connected and reconnects if not, then starts the health monitor
  - **App background optimization:** When app goes to background, stops the health monitor to save battery
  - **Works for all users:** Foreground/background handling runs for both single-wallet and multi-wallet users (previously only ran for multi-wallet)
  - **Pre-sync connection check:** Before each sync cycle, `ensureConnectionHealth()` verifies the connection is alive
  - **SyncLogger integration:** All connection health events logged for debugging

- **Result:** The Electrum connection now stays alive with 3 layers of protection:
  1. **Keepalive pings** every 20s keep the TCP connection alive
  2. **Auto-reconnect on socket close** with exponential backoff handles unexpected disconnects
  3. **Health monitor** every 25s proactively detects and fixes dead connections
  4. **App foreground check** immediately verifies and restores connection when user returns to the app

## Modified Files (Bug Fixes — Round 9)

| File | Changes |
|------|---------|
| `services/electrum/ElectrumClient.ts` | Auto-reconnect with exponential backoff, improved keepalive, detailed logging, `getDiagnostics()`, intentional disconnect flag |
| `services/electrum/ElectrumAPI.ts` | Persistent health monitor (25s interval), auto-start on connect, detailed logging, `getHealthMonitorStatus()`, SyncLogger integration |
| `hooks/useBackgroundWalletSync.ts` | App foreground reconnection, background health monitor stop, pre-sync connection check, works for single-wallet users |

---

---

### Fix #31: Electrum Log Cleanup — Remove Error Overlay + Spam Logs

**Problem:**
1. `logError` used `console.error()` which triggers React Native's red error overlay in development — making Electrum timeouts look like app crashes
2. Per-response/per-request verbose logs (`handleResponse: id XXXX OK`, `request() #id`, `socket.data`, `drainQueue`, `_sendBatch`) flooded the console with hundreds of lines per sync cycle

**Solution:**

- **`ElectrumClient.ts`:**
  - Changed `logError` from `console.error` → `console.warn` (no more red overlay)
  - Removed ~15 verbose per-request/per-response log lines (handleResponse OK, socket.data chunks, request send/receive, drainQueue, batch write details)
  - Kept all error-level logs (timeouts, failures, disconnects) and SyncLogger entries
  - Added SyncLogger entry for batch timeout events

- **`ElectrumAPI.ts`:**
  - Changed `logError` from `console.error` → `console.warn` (no more red overlay)
  - Removed ~42 verbose per-request log lines across 10+ methods (getAddressBalance, getWalletBalance, getWalletUTXOs, getTransactions, syncWalletLight, syncWallet, syncWalletParallel, getMultiWalletBalancesParallel, getTransactionsParallel, broadcastRace, getFeeEstimates, getBlockTimestamps, dedup)
  - Kept all error logs, SyncLogger entries, health monitor logs, circuit breaker logs, and connect/disconnect logs

**Result:** Clean console with only meaningful connection/error events. No more red error overlay for Electrum timeouts.

---

## Verification

- `npx tsc --noEmit` — zero errors
- No secrets in debug packets
- Premium monochrome design maintained
- Dark/Light mode fully symmetric
- No animations anywhere
- Stable layout — tabular-nums on all numbers
- Zero floating toast notifications — all feedback is inline and contextual
- Electrum connection stays alive with keepalive + auto-reconnect + health monitor
- No red error overlay from Electrum logs
- Console output clean — only connection-level and error logs remain
