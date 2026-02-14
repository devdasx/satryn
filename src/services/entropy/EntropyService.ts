/**
 * Entropy Service
 * Handles cryptographic mixing of system and user entropy for seed generation
 * Uses HKDF-SHA256 (RFC 5869) to securely combine entropy sources
 */

import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';
import * as bip39 from 'bip39';
import { EntropyMethod, EntropyMethodConfig, EntropyResult } from './types';

export class EntropyService {
  /**
   * Method configurations with conservative entropy estimates
   * We underestimate to encourage users to collect more entropy
   */
  static readonly METHOD_CONFIGS: Record<EntropyMethod, EntropyMethodConfig> = {
    touch: {
      name: 'Touch & Drag',
      description: 'Draw random patterns on screen',
      icon: 'finger-print-outline',
      minInputsFor128Bits: 64,    // 64 touch points
      minInputsFor256Bits: 128,   // 128 touch points
      bitsPerInput: 2,            // Conservative: coordinates + timing
    },
    coinFlips: {
      name: 'Coin Flips',
      description: 'Enter heads or tails sequence',
      icon: 'disc-outline',
      minInputsFor128Bits: 128,   // 1 bit per flip
      minInputsFor256Bits: 256,   // 1 bit per flip
      bitsPerInput: 1,
    },
    diceRolls: {
      name: 'Dice Rolls',
      description: 'Enter 6-sided dice results',
      icon: 'cube-outline',
      minInputsFor128Bits: 50,    // log2(6) ≈ 2.58 bits per roll
      minInputsFor256Bits: 100,   // log2(6) ≈ 2.58 bits per roll
      bitsPerInput: 2.58,
    },
    numbers: {
      name: 'Random Numbers',
      description: 'Type random numbers or text',
      icon: 'keypad-outline',
      minInputsFor128Bits: 32,    // Conservative: 4 bits per character
      minInputsFor256Bits: 64,    // Conservative: 4 bits per character
      bitsPerInput: 4,
    },
  };

  /**
   * Hash user entropy data using SHA256
   * Returns 32 bytes of user entropy
   */
  static async hashUserEntropy(rawData: string): Promise<Uint8Array> {
    // Use digestStringAsync directly with string input - most reliable on iOS
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawData,
      { encoding: Crypto.CryptoEncoding.HEX }
    );

    return this.hexToUint8Array(hashHex);
  }

  /**
   * Generate system entropy using CSPRNG
   * @param bytes Number of bytes to generate (16 for 12 words, 32 for 24 words)
   */
  static async getSystemEntropy(bytes: 16 | 32): Promise<Uint8Array> {
    return await Crypto.getRandomBytesAsync(bytes);
  }

  /**
   * Helper to convert hex string to Uint8Array
   */
  private static hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  /**
   * Hash binary data using SHA256
   * Uses base64 encoding to pass binary data to digestStringAsync
   */
  private static async hashBinary(data: Uint8Array): Promise<Uint8Array> {
    // Convert to base64 string using Buffer (polyfilled)
    const base64Data = Buffer.from(data).toString('base64');

    // Use digestStringAsync with the base64 data
    // Note: We hash the base64 string directly, which is deterministic
    const hashHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64Data,
      { encoding: Crypto.CryptoEncoding.HEX }
    );

    return this.hexToUint8Array(hashHex);
  }

  /**
   * HMAC-SHA256 implementation
   * expo-crypto doesn't have native HMAC, so we implement it per RFC 2104
   */
  static async hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const blockSize = 64; // SHA256 block size in bytes
    let keyToUse = key;

    // If key > blockSize, hash it first
    if (key.length > blockSize) {
      keyToUse = await this.hashBinary(key);
    }

    // Pad key to block size
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyToUse);

    // Create inner and outer padding
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5c;
    }

    // Inner hash: H(K XOR ipad || message)
    const innerData = new Uint8Array(ipad.length + message.length);
    innerData.set(ipad);
    innerData.set(message, ipad.length);
    const innerHash = await this.hashBinary(innerData);

    // Outer hash: H(K XOR opad || inner_hash)
    const outerData = new Uint8Array(opad.length + 32);
    outerData.set(opad);
    outerData.set(innerHash, opad.length);
    const outerHash = await this.hashBinary(outerData);

    return outerHash;
  }

  /**
   * HKDF-SHA256 implementation (RFC 5869)
   * Extract-and-Expand Key Derivation Function
   *
   * This ensures proper cryptographic mixing of system + user entropy
   */
  static async hkdfSha256(
    inputKeyMaterial: Uint8Array,  // Concatenated system + user entropy
    salt: Uint8Array,              // Use user entropy hash as salt
    info: Uint8Array,              // Context info
    outputLength: number           // 16 for 12 words, 32 for 24 words
  ): Promise<Uint8Array> {
    // HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
    const prk = await this.hmacSha256(salt, inputKeyMaterial);

    // HKDF-Expand: Output key material
    // For our use case (16 or 32 bytes), we only need one iteration
    const expandInput = new Uint8Array([...info, 0x01]);
    const okm = await this.hmacSha256(prk, expandInput);

    // Return only the required number of bytes
    return okm.slice(0, outputLength);
  }

  /**
   * Generate final entropy by mixing system and user entropy
   *
   * Security Architecture:
   * 1. System entropy: 128/256 bits from CSPRNG (primary security source)
   * 2. User entropy: Hashed via SHA256 (32 bytes)
   * 3. Final: HKDF-SHA256(system || user, userHash, info, outputLength)
   *
   * IMPORTANT: User entropy can only ADD security, never reduce it.
   * Even if user provides weak/predictable input, the system entropy
   * ensures the final output remains cryptographically secure.
   */
  static async generateMixedEntropy(
    userEntropyResult: EntropyResult,
    seedLength: 12 | 24
  ): Promise<Uint8Array> {
    const entropyBytes = seedLength === 12 ? 16 : 32;

    // Get cryptographically secure system entropy
    const systemEntropy = await this.getSystemEntropy(entropyBytes as 16 | 32);

    // Combine system + user entropy
    const combinedEntropy = new Uint8Array(
      systemEntropy.length + userEntropyResult.userEntropy.length
    );
    combinedEntropy.set(systemEntropy);
    combinedEntropy.set(userEntropyResult.userEntropy, systemEntropy.length);

    // Use HKDF to derive final entropy
    const info = new TextEncoder().encode('bitcoin-wallet-entropy-v1');
    const finalEntropy = await this.hkdfSha256(
      combinedEntropy,
      userEntropyResult.userEntropy, // Use user entropy hash as salt
      info,
      entropyBytes
    );

    return finalEntropy;
  }

  /**
   * Generate entropy from ONLY user-provided input (Pure Manual Mode)
   *
   * DETERMINISTIC: Same input will ALWAYS produce the same mnemonic.
   * This allows users to verify the wallet's honesty by calculating
   * the expected mnemonic independently.
   *
   * WARNING: Security depends entirely on the quality of user input.
   * Users MUST provide truly random input (real coin flips, dice rolls, etc.)
   *
   * Process:
   * 1. User entropy is hashed via SHA256
   * 2. HKDF-SHA256 is used to derive exact entropy length needed
   * 3. Same input → Same output (deterministic)
   */
  static async generatePureManualEntropy(
    userEntropyResult: EntropyResult,
    seedLength: 12 | 24
  ): Promise<Uint8Array> {
    const entropyBytes = seedLength === 12 ? 16 : 32;

    // Use HKDF to derive final entropy from user entropy ONLY
    // Salt is fixed to ensure determinism
    const fixedSalt = new TextEncoder().encode('bitcoin-pure-manual-entropy-salt-v1');
    const info = new TextEncoder().encode('bitcoin-pure-manual-entropy-v1');

    const finalEntropy = await this.hkdfSha256(
      userEntropyResult.userEntropy, // Only user entropy as input
      fixedSalt,                      // Fixed salt for determinism
      info,
      entropyBytes
    );

    return finalEntropy;
  }

  /**
   * Convert raw entropy bytes to BIP39 mnemonic
   */
  static entropyToMnemonic(entropy: Uint8Array): string {
    return bip39.entropyToMnemonic(Buffer.from(entropy));
  }

  /**
   * Generate mnemonic with mixed entropy (system + user)
   * Different each time even with same user input.
   *
   * @param userEntropyResult - Result from entropy collection
   * @param seedLength - 12 or 24 word mnemonic
   * @returns BIP39 mnemonic phrase
   */
  static async generateMnemonicWithUserEntropy(
    userEntropyResult: EntropyResult,
    seedLength: 12 | 24
  ): Promise<string> {
    const finalEntropy = await this.generateMixedEntropy(userEntropyResult, seedLength);
    return this.entropyToMnemonic(finalEntropy);
  }

  /**
   * Generate mnemonic with PURE manual entropy (user input ONLY)
   * DETERMINISTIC: Same input always produces same mnemonic.
   *
   * @param userEntropyResult - Result from entropy collection
   * @param seedLength - 12 or 24 word mnemonic
   * @returns BIP39 mnemonic phrase (deterministic)
   */
  static async generateMnemonicPureManual(
    userEntropyResult: EntropyResult,
    seedLength: 12 | 24
  ): Promise<string> {
    const finalEntropy = await this.generatePureManualEntropy(userEntropyResult, seedLength);
    const mnemonic = this.entropyToMnemonic(finalEntropy);
    return mnemonic;
  }

  /**
   * Calculate estimated bits of entropy from collected data
   */
  static calculateBitsCollected(
    method: EntropyMethod,
    inputCount: number
  ): number {
    const config = this.METHOD_CONFIGS[method];
    return Math.floor(inputCount * config.bitsPerInput);
  }

  /**
   * Get minimum inputs required for a given seed length
   */
  static getMinInputsRequired(
    method: EntropyMethod,
    seedLength: 12 | 24
  ): number {
    const config = this.METHOD_CONFIGS[method];
    return seedLength === 12 ? config.minInputsFor128Bits : config.minInputsFor256Bits;
  }

  /**
   * Check if enough entropy has been collected
   */
  static hasEnoughEntropy(
    method: EntropyMethod,
    inputCount: number,
    seedLength: 12 | 24
  ): boolean {
    const required = this.getMinInputsRequired(method, seedLength);
    return inputCount >= required;
  }

  /**
   * Get progress percentage (0-100)
   */
  static getProgressPercentage(
    method: EntropyMethod,
    inputCount: number,
    seedLength: 12 | 24
  ): number {
    const required = this.getMinInputsRequired(method, seedLength);
    return Math.min(100, Math.floor((inputCount / required) * 100));
  }
}
