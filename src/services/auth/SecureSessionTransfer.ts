/**
 * SecureSessionTransfer — In-memory secret transfer between navigation routes.
 *
 * Instead of passing mnemonics, PINs, xprvs, WIF keys, and other secrets
 * through Expo Router params (which end up in app state history, memory dumps,
 * and device backups), callers store secrets here and pass only a short-lived
 * random token through the route.
 *
 * Usage:
 *   // Sender
 *   const token = SecureSessionTransfer.store({ mnemonic, pin });
 *   router.push({ pathname: '/setup', params: { _sst: token } });
 *
 *   // Receiver
 *   const data = SecureSessionTransfer.consume(params._sst);
 *   // if (!data) → expired or invalid token – go back
 */

export interface TransferPayload {
  /** BIP-39 mnemonic (12/24 words) */
  mnemonic?: string;
  /** User PIN */
  pin?: string;
  /** BIP-39 passphrase (optional 25th word) */
  passphrase?: string;
  /** Whether this is an import flow */
  isImport?: string;
  /** Whether this is a multisig flow */
  isMultisig?: string;
  /** Wallet name */
  walletName?: string;
  /** Multisig output descriptor */
  descriptor?: string;
  /** JSON-encoded multisig config */
  multisigConfig?: string;
  /** JSON-encoded local cosigner seeds */
  localCosignerSeeds?: string;
  /** Verify-only mode */
  verifyOnly?: string;
  /** Source of import (e.g., 'icloud_restore') */
  source?: string;
  /** Restore payload (JSON) */
  restorePayload?: string;
  /** Derivation config (JSON) */
  derivationConfig?: string;
  /** Skip mode flag */
  skipMode?: string;
  /** Preserve-restore flag */
  preserveRestore?: string;
  // Import-specific secrets
  /** Extended private key */
  importXprv?: string;
  /** WIF private key */
  importKeyWIF?: string;
  /** Whether imported key is compressed */
  importKeyCompressed?: string;
  /** Name for imported key */
  importKeyName?: string;
  /** Script type for imported key */
  importKeyScriptType?: string;
  /** Raw seed bytes as hex */
  importSeedHex?: string;
}

interface StoredEntry {
  payload: TransferPayload;
  createdAt: number;
}

/** Maximum time a token is valid (60 seconds — plenty for navigation) */
const TTL_MS = 60_000;

/** Maximum entries to prevent memory buildup */
const MAX_ENTRIES = 10;

// In-memory store — never persisted to disk
const _store = new Map<string, StoredEntry>();

function generateToken(): string {
  // Use crypto-safe random bytes for token
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function evictExpired(): void {
  const now = Date.now();
  for (const [token, entry] of _store.entries()) {
    if (now - entry.createdAt > TTL_MS) {
      _store.delete(token);
    }
  }
}

export class SecureSessionTransfer {
  /**
   * Store secrets and get a short-lived token for route params.
   * The token is the ONLY thing that should appear in navigation params.
   */
  static store(payload: TransferPayload): string {
    evictExpired();

    // Enforce max entries to prevent memory leak
    if (_store.size >= MAX_ENTRIES) {
      const oldest = _store.keys().next().value;
      if (oldest) _store.delete(oldest);
    }

    const token = generateToken();
    _store.set(token, { payload, createdAt: Date.now() });
    return token;
  }

  /**
   * Consume (retrieve + delete) the payload for a token.
   * Returns null if the token is invalid, expired, or already consumed.
   * This is a one-time read — the token is destroyed after consumption.
   */
  static consume(token: string | undefined | null): TransferPayload | null {
    if (!token) return null;

    evictExpired();

    const entry = _store.get(token);
    if (!entry) return null;

    // One-time read: delete immediately
    _store.delete(token);

    // Check TTL
    if (Date.now() - entry.createdAt > TTL_MS) {
      return null;
    }

    return entry.payload;
  }

  /**
   * Peek at the payload without consuming it.
   * Useful for components that need to read params on re-render.
   * Still respects TTL.
   */
  static peek(token: string | undefined | null): TransferPayload | null {
    if (!token) return null;

    const entry = _store.get(token);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > TTL_MS) {
      _store.delete(token);
      return null;
    }

    return entry.payload;
  }

  /**
   * Clear all stored entries (e.g., on app lock or reset).
   */
  static clearAll(): void {
    _store.clear();
  }
}
