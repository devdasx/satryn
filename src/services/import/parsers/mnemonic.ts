/**
 * BIP39 Mnemonic Parser
 *
 * Enhanced mnemonic validation and parsing supporting:
 * - 12, 15, 18, 21, 24 word mnemonics
 * - BIP39 checksum validation
 * - Optional BIP39 passphrase
 * - Word-level validation and suggestions
 *
 * SECURITY: Never logs the mnemonic itself.
 */

import * as bip39 from 'bip39';
import type { ImportResult } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

/** Valid BIP39 word counts */
export const VALID_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
export type ValidWordCount = (typeof VALID_WORD_COUNTS)[number];

/** Result of mnemonic validation */
export interface MnemonicValidation {
  isValid: boolean;
  wordCount: number;
  isValidWordCount: boolean;
  invalidWords: Array<{ index: number; word: string }>;
  checksumValid: boolean;
}

/**
 * Check if a string looks like a BIP39 mnemonic.
 * This is a quick heuristic check, not full validation.
 */
export function looksLikeMnemonic(input: string): boolean {
  const words = input.trim().toLowerCase().split(/\s+/);
  if (words.length < 12) return false;
  // Check if most words are in the BIP39 wordlist
  const wordlist = bip39.wordlists.english;
  const validCount = words.filter((w) => wordlist.includes(w)).length;
  return validCount >= words.length * 0.8; // 80% threshold for detection
}

/**
 * Validate a BIP39 mnemonic thoroughly.
 * Returns detailed validation result without logging the mnemonic.
 */
export function validateMnemonic(mnemonic: string): MnemonicValidation {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  const wordlist = bip39.wordlists.english;
  const wordCount = words.length;
  const isValidWordCount = (VALID_WORD_COUNTS as readonly number[]).includes(wordCount);

  // Check each word against the wordlist
  const invalidWords: Array<{ index: number; word: string }> = [];
  for (let i = 0; i < words.length; i++) {
    if (!wordlist.includes(words[i])) {
      invalidWords.push({ index: i, word: words[i] });
    }
  }

  // Full BIP39 validation (includes checksum)
  const checksumValid = invalidWords.length === 0 && isValidWordCount
    ? bip39.validateMnemonic(words.join(' '))
    : false;

  return {
    isValid: checksumValid,
    wordCount,
    isValidWordCount,
    invalidWords,
    checksumValid,
  };
}

/**
 * Check if a single word is in the BIP39 English wordlist.
 */
export function isValidWord(word: string): boolean {
  return bip39.wordlists.english.includes(word.toLowerCase());
}

/**
 * Get word suggestions for a prefix from the BIP39 wordlist.
 */
export function getWordSuggestions(prefix: string, limit: number = 5): string[] {
  if (!prefix || prefix.length < 1) return [];
  const lower = prefix.toLowerCase();
  return bip39.wordlists.english
    .filter((w) => w.startsWith(lower))
    .slice(0, limit);
}

/**
 * Parse and validate a BIP39 mnemonic, producing an ImportResult.
 *
 * @param mnemonic - Space-separated mnemonic words
 * @param passphrase - Optional BIP39 passphrase
 * @returns ImportResult with seed and mnemonic data
 * @throws ImportError if validation fails
 */
export function parseMnemonic(
  mnemonic: string,
  passphrase: string = ''
): ImportResult {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  const validation = validateMnemonic(normalized);

  if (!validation.isValidWordCount) {
    throw new ImportError(
      'INVALID_WORD_COUNT',
      `Expected 12, 15, 18, 21, or 24 words, got ${validation.wordCount}`
    );
  }

  if (validation.invalidWords.length > 0) {
    const positions = validation.invalidWords.map((w) => `#${w.index + 1}`).join(', ');
    throw new ImportError(
      'INVALID_WORD',
      `Invalid word(s) at position(s): ${positions}`
    );
  }

  if (!validation.checksumValid) {
    throw new ImportError(
      'INVALID_CHECKSUM',
      'Mnemonic checksum is invalid. Please check the words and try again.'
    );
  }

  safeLog('parseMnemonic: valid', validation.wordCount, 'word mnemonic');

  // Convert to seed
  const seed = bip39.mnemonicToSeedSync(normalized, passphrase);

  return {
    type: 'hd',
    sourceFormat: 'bip39_mnemonic',
    mnemonic: normalized,
    passphrase: passphrase || undefined,
    seed: new Uint8Array(seed),
    suggestedScriptType: 'native_segwit',
    suggestedName: 'Imported Wallet',
  };
}
