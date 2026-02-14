/**
 * SensitiveSession — Module-level auth session for authenticated flows.
 *
 * Keeps the user's PIN in memory for a short window (10 min) so that
 * wallet creation, switching, and backup flows do not prompt for
 * FaceID / PIN every time.
 *
 * The session is automatically invalidated when:
 *  - The timeout expires
 *  - invalidate() is called explicitly (e.g. on manual lock)
 */

import { SecureStorage } from '../storage/SecureStorage';

const SESSION_DURATION = 600_000; // 10 minutes

let sessionPin: string | null = null;
let sessionExpiry = 0;

// ─── Public API ──────────────────────────────────────────────────

export const SensitiveSession = {
  /**
   * Start (or refresh) the session with a verified PIN.
   */
  start(pin: string) {
    sessionPin = pin;
    sessionExpiry = Date.now() + SESSION_DURATION;
  },

  /**
   * Whether the session is still valid.
   */
  isActive(): boolean {
    return sessionPin !== null && Date.now() < sessionExpiry;
  },

  /**
   * Return the stored PIN if the session is active, otherwise null.
   */
  getPin(): string | null {
    if (this.isActive()) return sessionPin;
    this.invalidate();
    return null;
  },

  /**
   * Clear session data immediately.
   */
  invalidate() {
    sessionPin = null;
    sessionExpiry = 0;
  },

  /**
   * Try to authenticate silently via biometrics.
   * Returns the PIN on success, or null if biometrics are unavailable /
   * the user has no biometric PIN stored — in that case the caller
   * should fall back to showing a PinVerificationScreen.
   */
  async ensureAuth(): Promise<string | null> {
    // Already authenticated — reuse
    if (this.isActive()) return sessionPin;

    // Try biometric shortcut
    try {
      const pin = await SecureStorage.getPinForBiometrics();
      if (pin) {
        this.start(pin);
        return pin;
      }
    } catch {
      // Biometrics unavailable — fall through
    }

    return null;
  },
};
