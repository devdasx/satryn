/**
 * DuplicateDetector — checks if key material has already been imported.
 *
 * Called from import UI screens at detection time (as user enters data).
 * Uses synchronous SQLite queries via WalletDatabase, so lookups are instant.
 *
 * Each function guards for null/undefined and catches DB errors silently
 * (the DB may not be initialized yet on first install).
 */

import { WalletDatabase } from '../database/WalletDatabase';
import type { WalletRow } from '../database/types';

// ─── Types ───────────────────────────────────────────────────────────

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingWallet: WalletRow | null;
}

const NO_DUPLICATE: DuplicateCheckResult = { isDuplicate: false, existingWallet: null };

// ─── Individual Checks ──────────────────────────────────────────────

/**
 * Check if an HD wallet (mnemonic, xprv, seed) with this fingerprint already exists.
 */
export function checkFingerprintDuplicate(fingerprint: string | undefined | null): DuplicateCheckResult {
  if (!fingerprint) return NO_DUPLICATE;
  try {
    const db = WalletDatabase.shared();
    const existing = db.findWalletByFingerprint(fingerprint);
    if (existing) return { isDuplicate: true, existingWallet: existing };
  } catch { /* DB not ready yet */ }
  return NO_DUPLICATE;
}

/**
 * Check if a watch-only xpub wallet with this xpub already exists.
 */
export function checkXpubDuplicate(xpub: string | undefined | null): DuplicateCheckResult {
  if (!xpub) return NO_DUPLICATE;
  try {
    const db = WalletDatabase.shared();
    const existing = db.findWalletByXpub(xpub);
    if (existing) return { isDuplicate: true, existingWallet: existing };
  } catch { /* DB not ready yet */ }
  return NO_DUPLICATE;
}

/**
 * Check if a wallet with this descriptor already exists.
 */
export function checkDescriptorDuplicate(descriptor: string | undefined | null): DuplicateCheckResult {
  if (!descriptor) return NO_DUPLICATE;
  try {
    const db = WalletDatabase.shared();
    const existing = db.findWalletByDescriptor(descriptor);
    if (existing) return { isDuplicate: true, existingWallet: existing };
  } catch { /* DB not ready yet */ }
  return NO_DUPLICATE;
}

/**
 * Check if a wallet that owns this address already exists.
 * Used for WIF import: same WIF produces same addresses.
 */
export function checkAddressDuplicate(address: string | undefined | null): DuplicateCheckResult {
  if (!address) return NO_DUPLICATE;
  try {
    const db = WalletDatabase.shared();
    const existing = db.findWalletByAddress(address);
    if (existing) return { isDuplicate: true, existingWallet: existing };
  } catch { /* DB not ready yet */ }
  return NO_DUPLICATE;
}

// ─── Master Check ───────────────────────────────────────────────────

/**
 * Given an import category and parse result, check the appropriate identifier.
 * This is the single entry point used by the import screen.
 *
 * For mnemonics, the fingerprint must be computed separately and passed via
 * `mnemonicFingerprint` because the parseResult doesn't include it.
 */
export function checkImportDuplicate(
  category: string | null,
  parseResult: {
    fingerprint?: string;
    xpub?: string;
    previewAddress?: string;
  } | null,
  mnemonicFingerprint?: string,
): DuplicateCheckResult {
  if (!category) return NO_DUPLICATE;

  // Mnemonic: use separately-computed fingerprint
  if (category === 'mnemonic' && mnemonicFingerprint) {
    return checkFingerprintDuplicate(mnemonicFingerprint);
  }

  if (!parseResult) return NO_DUPLICATE;

  // HD imports (xprv, seed): use fingerprint from parse result
  if ((category === 'extended' || category === 'seed') && parseResult.fingerprint) {
    return checkFingerprintDuplicate(parseResult.fingerprint);
  }

  // Watch-only xpub: use the xpub string
  if (category === 'watch' && parseResult.xpub) {
    return checkXpubDuplicate(parseResult.xpub);
  }

  // Private key (WIF): use the preview address
  if (category === 'key' && parseResult.previewAddress) {
    return checkAddressDuplicate(parseResult.previewAddress);
  }

  return NO_DUPLICATE;
}
