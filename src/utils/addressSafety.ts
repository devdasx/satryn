/**
 * Address Safety Utilities — 021 Enhancement Pack
 *
 * Deep sanitization, similarity detection, risk analysis, chunked display.
 * Used by SafetyPanel and StepRecipient to protect against:
 * - Clipboard hijacking (invisible characters, bidi overrides)
 * - Address poisoning (similar-looking addresses)
 * - Self-send errors
 */

// ============================================
// TYPES
// ============================================

export type RiskLevel = 'info' | 'caution' | 'danger';

export interface RiskHint {
  level: RiskLevel;
  code: string;
  message: string;
}

export interface SimilarityMatch {
  matchedAddress: string;
  source: string;
  prefixMatch: number;
  suffixMatch: number;
}

export interface SanitizeResult {
  cleaned: string;
  wasModified: boolean;
}

// ============================================
// INVISIBLE / DANGEROUS CHARACTERS
// ============================================

/**
 * Unicode ranges that should never appear in a Bitcoin address:
 * - Zero-width chars: \u200B–\u200F (ZWS, ZWNJ, ZWJ, LRM, RLM)
 * - Byte-order mark: \uFEFF
 * - Bidi overrides: \u202A–\u202E (LRE, RLE, PDF, LRO, RLO)
 * - Bidi isolates: \u2066–\u2069 (LRI, RLI, FSI, PDI)
 * - Whitespace: tabs, newlines, non-breaking spaces (\u00A0)
 */
const INVISIBLE_CHARS_RE =
  /[\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069\u00A0\t\n\r]/g;

// ============================================
// DEEP SANITIZE ADDRESS (Feature 3)
// ============================================

/**
 * Remove invisible/dangerous characters from an address string.
 * Normalizes bech32 prefixes to lowercase (bc1/tb1).
 * Preserves original case for legacy addresses.
 */
export function deepSanitizeAddress(input: string): SanitizeResult {
  if (!input) return { cleaned: '', wasModified: false };

  // Step 1: Strip invisible chars
  let cleaned = input.replace(INVISIBLE_CHARS_RE, '');

  // Step 2: Remove any remaining whitespace (spaces, etc.)
  cleaned = cleaned.replace(/\s/g, '');

  // Step 3: Normalize bech32 prefix to lowercase
  // Bech32 addresses (bc1... / tb1...) are case-insensitive per BIP173,
  // but the canonical form is lowercase.
  if (/^(BC1|TB1)/i.test(cleaned)) {
    // If it starts with bech32 prefix, lowercase the whole thing
    // (bech32 spec says mixed case is invalid anyway)
    cleaned = cleaned.toLowerCase();
  }

  return {
    cleaned,
    wasModified: cleaned !== input,
  };
}

// ============================================
// SIMILARITY DETECTION (Feature 2)
// ============================================

/**
 * Detect if an address looks suspiciously similar to any in a candidate list.
 * Compares first N and last N characters. If both match but the middle differs,
 * this is a classic address-poisoning attack pattern.
 *
 * @param address - The address to check
 * @param candidates - Known addresses to compare against (recent recipients, contacts)
 * @param prefixLen - How many prefix chars to compare (default 6)
 * @param suffixLen - How many suffix chars to compare (default 6)
 */
export function detectAddressSimilarity(
  address: string,
  candidates: string[],
  prefixLen = 6,
  suffixLen = 6,
): SimilarityMatch | null {
  if (!address || address.length < prefixLen + suffixLen) return null;

  const addrPrefix = address.slice(0, prefixLen).toLowerCase();
  const addrSuffix = address.slice(-suffixLen).toLowerCase();

  for (const candidate of candidates) {
    if (!candidate || candidate.length < prefixLen + suffixLen) continue;

    // Skip exact matches — that's the same address, not a poisoning attempt
    if (candidate === address) continue;

    const candPrefix = candidate.slice(0, prefixLen).toLowerCase();
    const candSuffix = candidate.slice(-suffixLen).toLowerCase();

    // Both prefix and suffix match, but the address is different → suspicious
    if (addrPrefix === candPrefix && addrSuffix === candSuffix) {
      return {
        matchedAddress: candidate,
        source: 'recent_or_contact',
        prefixMatch: prefixLen,
        suffixMatch: suffixLen,
      };
    }
  }

  return null;
}

// ============================================
// RISK ANALYSIS (Feature 1)
// ============================================

/**
 * Analyze recipient address and return risk hints for the SafetyPanel.
 *
 * Checks:
 * 1. Self-send (address belongs to own wallet)
 * 2. Address poisoning (similar to known address)
 * 3. New recipient (never sent to before)
 *
 * @returns Array of risk hints, sorted by severity (danger first)
 */
export function analyzeRecipientRisk(
  address: string,
  ownAddresses: Set<string>,
  recentRecipients: string[],
  contactAddresses: string[],
): RiskHint[] {
  const hints: RiskHint[] = [];

  if (!address) return hints;

  // 1. Self-send check
  if (ownAddresses.has(address)) {
    hints.push({
      level: 'caution',
      code: 'SELF_SEND',
      message: 'This is one of your own addresses. You will be sending to yourself.',
    });
  }

  // 2. Address poisoning / similarity check
  const allKnownAddresses = [...recentRecipients, ...contactAddresses];
  const similarity = detectAddressSimilarity(address, allKnownAddresses);
  if (similarity) {
    hints.push({
      level: 'danger',
      code: 'ADDRESS_SIMILARITY',
      message: `This address looks similar to a previously used address (first ${similarity.prefixMatch} and last ${similarity.suffixMatch} characters match). Verify carefully.`,
    });
  }

  // 3. New recipient check (only if not self-send and not similar)
  const isKnown =
    ownAddresses.has(address) ||
    recentRecipients.includes(address) ||
    contactAddresses.includes(address);

  if (!isKnown) {
    hints.push({
      level: 'info',
      code: 'NEW_RECIPIENT',
      message: 'You haven\'t sent to this address before.',
    });
  }

  // Sort: danger → caution → info
  const severityOrder: Record<RiskLevel, number> = { danger: 0, caution: 1, info: 2 };
  hints.sort((a, b) => severityOrder[a.level] - severityOrder[b.level]);

  return hints;
}

// ============================================
// CHUNKED ADDRESS DISPLAY (Feature 10)
// ============================================

/**
 * Split an address into groups for visual review.
 * Makes it easier to spot differences when comparing addresses.
 *
 * @param address - Full Bitcoin address
 * @param chunkSize - Characters per chunk (default 4)
 * @returns Array of chunks
 */
export function formatAddressChunked(address: string, chunkSize = 4): string[] {
  if (!address) return [];

  const chunks: string[] = [];
  for (let i = 0; i < address.length; i += chunkSize) {
    chunks.push(address.slice(i, i + chunkSize));
  }
  return chunks;
}
