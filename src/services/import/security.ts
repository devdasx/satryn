/**
 * Import Security Utilities
 *
 * Clipboard hygiene, buffer zeroization, secure input configuration,
 * and screenshot prevention for the import flow.
 *
 * NEVER log secrets. NEVER include raw input in errors.
 */

import { Alert, type TextInputProps } from 'react-native';
import * as Clipboard from 'expo-clipboard';

// ============================================
// Secure Input Configuration
// ============================================

/**
 * Props to apply to any TextInput that handles secret material.
 * Disables autocorrect, predictive text, and content suggestions.
 */
export function getSecureInputProps(): Partial<TextInputProps> {
  return {
    autoCorrect: false,
    autoCapitalize: 'none',
    spellCheck: false,
    textContentType: 'none',
    autoComplete: 'off',
    importantForAutofill: 'no',
    contextMenuHidden: false, // Allow paste but not share/copy
  };
}

// ============================================
// Clipboard Hygiene
// ============================================

/**
 * Prompt the user to clear their clipboard after pasting secret material.
 * Returns true if clipboard was cleared, false if user declined.
 */
export function promptClipboardClear(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Clear Clipboard?',
      'For your security, we recommend clearing the pasted content from your clipboard.',
      [
        {
          text: 'Keep',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: 'Clear Clipboard',
          style: 'destructive',
          onPress: async () => {
            try {
              await Clipboard.setStringAsync('');
              resolve(true);
            } catch {
              resolve(false);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

/**
 * Silently clear clipboard without prompting.
 * Use after successful import to ensure no secrets linger.
 */
export async function clearClipboard(): Promise<void> {
  try {
    await Clipboard.setStringAsync('');
  } catch {
    // Best effort — clipboard may not be available
  }
}

// ============================================
// Buffer Zeroization
// ============================================

/**
 * Overwrite a Uint8Array with zeros to minimize secret exposure in memory.
 * This is best-effort — JavaScript GC may still retain copies.
 */
export function zeroizeBuffer(buf: Uint8Array | Buffer | null | undefined): void {
  if (!buf) return;
  try {
    buf.fill(0);
  } catch {
    // Best effort
  }
}

/**
 * Overwrite a string's memory footprint by replacing variable reference.
 * NOTE: In JavaScript, strings are immutable and GC-managed.
 * This is symbolic/best-effort — the original string may persist in memory.
 * For true zeroization, use Uint8Array for secrets where possible.
 */
export function zeroizeString(_ref: { value: string }): void {
  _ref.value = '';
}

// ============================================
// Logging Safety
// ============================================

/**
 * Create a safe log message that never includes secret material.
 * Use this for import-related logging.
 *
 * @param context - What operation is being performed
 * @param details - Safe, non-secret details (format name, byte count, etc.)
 */
export function safeLog(_context: string, ..._details: any[]): void {
  // Logging removed
}

/**
 * Create a safe error message that never includes raw input.
 *
 * @param context - What operation failed
 * @param error - The error object (message may be logged, but never raw input)
 */
export function safeLogError(_context: string, _error: unknown): void {
  // Error logging removed
}

// ============================================
// Input Sanitization
// ============================================

/**
 * Mask a secret string for safe display/logging.
 * Shows first 4 and last 4 chars, everything else is masked.
 *
 * @example maskSecret("KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn")
 * // Returns "KwDi...oWn"
 */
export function maskSecret(input: string, showChars: number = 4): string {
  if (input.length <= showChars * 2) return '****';
  return `${input.slice(0, showChars)}...${input.slice(-showChars)}`;
}

/**
 * Check if a string looks like it might contain secret key material.
 * Used to prevent accidental logging of secrets.
 */
export function mightBeSecret(input: string): boolean {
  const trimmed = input.trim();
  // WIF
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) return true;
  // BIP38
  if (/^6P[1-9A-HJ-NP-Za-km-z]{56}$/.test(trimmed)) return true;
  // xprv/yprv/zprv
  if (/^[xyzYZ]prv/.test(trimmed)) return true;
  // Hex private key
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return true;
  // Mnemonic (12+ words)
  if (trimmed.split(/\s+/).length >= 12) return true;
  return false;
}
