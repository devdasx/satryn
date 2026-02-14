import * as bip39 from 'bip39';
import { EntropyService, EntropyResult, EntropyMode } from '../../services/entropy';

/**
 * BIP39 Seed Phrase Generator
 * Handles mnemonic generation and validation
 */
export class SeedGenerator {
  /**
   * Generate a new BIP39 mnemonic phrase
   * @param wordCount - 12 or 24 words (128 or 256 bits of entropy)
   * @returns The generated mnemonic phrase
   */
  static generate(wordCount: 12 | 24 = 12): string {
    // 12 words = 128 bits, 24 words = 256 bits
    const strength = wordCount === 12 ? 128 : 256;
    return bip39.generateMnemonic(strength);
  }

  /**
   * Generate a BIP39 mnemonic with user-provided entropy
   *
   * @param wordCount - 12 or 24 words (128 or 256 bits of entropy)
   * @param userEntropy - Result from entropy collection
   * @param mode - 'mixed' (default, safer) or 'pureManual' (deterministic)
   * @returns The generated mnemonic phrase
   *
   * Modes:
   * - 'mixed': Combines system CSPRNG with user entropy. Different each time.
   *            Safer because even weak user input is protected by system randomness.
   *
   * - 'pureManual': Uses ONLY user entropy. Same input = same mnemonic.
   *                 Deterministic and verifiable, but security depends entirely
   *                 on the quality of user-provided randomness.
   */
  static async generateWithEntropy(
    wordCount: 12 | 24,
    userEntropy: EntropyResult,
    mode: EntropyMode = 'mixed'
  ): Promise<string> {
    if (mode === 'pureManual') {
      return EntropyService.generateMnemonicPureManual(userEntropy, wordCount);
    }
    return EntropyService.generateMnemonicWithUserEntropy(userEntropy, wordCount);
  }

  /**
   * Validate a mnemonic phrase
   * @param mnemonic - The mnemonic to validate
   * @returns Whether the mnemonic is valid
   */
  static validate(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic.toLowerCase().trim());
  }

  /**
   * Convert mnemonic to seed buffer for HD wallet derivation
   * @param mnemonic - The mnemonic phrase
   * @param passphrase - Optional BIP39 passphrase (not PIN)
   * @returns The seed buffer
   */
  static async toSeed(mnemonic: string, passphrase: string = ''): Promise<Buffer> {
    return bip39.mnemonicToSeed(mnemonic.toLowerCase().trim(), passphrase);
  }

  /**
   * Convert mnemonic to seed synchronously
   * @param mnemonic - The mnemonic phrase
   * @param passphrase - Optional BIP39 passphrase
   * @returns The seed buffer
   */
  static toSeedSync(mnemonic: string, passphrase: string = ''): Buffer {
    return bip39.mnemonicToSeedSync(mnemonic.toLowerCase().trim(), passphrase);
  }

  /**
   * Get the word list for BIP39
   * Useful for seed phrase verification UI
   * @returns Array of BIP39 words
   */
  static getWordList(): string[] {
    return bip39.wordlists.english;
  }

  /**
   * Check if a word is in the BIP39 word list
   * @param word - The word to check
   * @returns Whether the word is valid
   */
  static isValidWord(word: string): boolean {
    return bip39.wordlists.english.includes(word.toLowerCase());
  }

  /**
   * Get word suggestions for autocomplete
   * @param prefix - The prefix to search for
   * @param limit - Maximum number of suggestions
   * @returns Array of matching words
   */
  static getSuggestions(prefix: string, limit: number = 5): string[] {
    const normalizedPrefix = prefix.toLowerCase();
    return bip39.wordlists.english
      .filter(word => word.startsWith(normalizedPrefix))
      .slice(0, limit);
  }

  /**
   * Parse a mnemonic string into an array of words
   * @param mnemonic - The mnemonic string
   * @returns Array of words
   */
  static parseWords(mnemonic: string): string[] {
    return mnemonic
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Get random indices for seed verification
   * @param wordCount - Total number of words
   * @param verifyCount - Number of words to verify
   * @returns Array of random indices
   */
  static getVerificationIndices(wordCount: number, verifyCount: number = 3): number[] {
    const indices: number[] = [];
    while (indices.length < verifyCount) {
      const randomIndex = Math.floor(Math.random() * wordCount);
      if (!indices.includes(randomIndex)) {
        indices.push(randomIndex);
      }
    }
    return indices.sort((a, b) => a - b);
  }
}
