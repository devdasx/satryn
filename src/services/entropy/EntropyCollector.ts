/**
 * Entropy Collector
 * Processes raw user input into entropy results for each collection method
 *
 * IMPORTANT: For deterministic mode, NO timestamps or random values are added.
 * Same input will always produce the same hash.
 */

import { Buffer } from 'buffer';
import { TouchPoint, EntropyResult, EntropyMethod } from './types';
import { EntropyService } from './EntropyService';

export class EntropyCollector {
  /**
   * Process touch points into entropy result
   * Only uses coordinates for deterministic output
   */
  static async processTouchEntropy(points: TouchPoint[]): Promise<EntropyResult> {
    // Build raw data string from touch points (coordinates only for determinism)
    const rawParts: string[] = [];

    for (const point of points) {
      // Include only coordinates (rounded to ensure consistency)
      rawParts.push(`${Math.round(point.x)},${Math.round(point.y)}`);
    }

    const rawData = `touch:${rawParts.join('|')}`;
    const userEntropy = await EntropyService.hashUserEntropy(rawData);

    return {
      userEntropy,
      rawDataHash: Buffer.from(userEntropy).toString('hex').slice(0, 16),
      method: 'touch',
      bitsCollected: EntropyService.calculateBitsCollected('touch', points.length),
    };
  }

  /**
   * Process coin flip sequence into entropy result
   * DETERMINISTIC: Same flips = same hash
   * @param flips Array of 'H' or 'T' characters
   */
  static async processCoinFlips(flips: string[]): Promise<EntropyResult> {
    // Convert to binary string (H=1, T=0)
    const binaryString = flips.map(f => f.toUpperCase() === 'H' ? '1' : '0').join('');

    // NO timestamp - deterministic output
    const rawData = `coinflips:${binaryString}`;
    const userEntropy = await EntropyService.hashUserEntropy(rawData);

    return {
      userEntropy,
      rawDataHash: Buffer.from(userEntropy).toString('hex').slice(0, 16),
      method: 'coinFlips',
      bitsCollected: flips.length, // 1 bit per flip (exact)
    };
  }

  /**
   * Process dice rolls into entropy result
   * DETERMINISTIC: Same rolls = same hash
   * @param rolls Array of numbers 1-6
   */
  static async processDiceRolls(rolls: number[]): Promise<EntropyResult> {
    // Validate rolls are 1-6
    const validRolls = rolls.filter(r => r >= 1 && r <= 6);

    // NO timestamp - deterministic output
    const rawData = `dice:${validRolls.join(',')}`;
    const userEntropy = await EntropyService.hashUserEntropy(rawData);

    return {
      userEntropy,
      rawDataHash: Buffer.from(userEntropy).toString('hex').slice(0, 16),
      method: 'diceRolls',
      bitsCollected: Math.floor(validRolls.length * 2.58), // log2(6) ≈ 2.58 bits
    };
  }

  /**
   * Process user-typed numbers/text into entropy result
   * DETERMINISTIC: Same text = same hash
   * @param text User-provided random text/numbers
   */
  static async processNumbers(text: string): Promise<EntropyResult> {
    // NO timestamp - deterministic output
    const rawData = `numbers:${text}`;
    const userEntropy = await EntropyService.hashUserEntropy(rawData);

    // Conservative estimate: 4 bits per character
    const charCount = text.replace(/\s/g, '').length;

    return {
      userEntropy,
      rawDataHash: Buffer.from(userEntropy).toString('hex').slice(0, 16),
      method: 'numbers',
      bitsCollected: Math.floor(charCount * 4),
    };
  }

  /**
   * Get entropy result for a given method and raw data
   */
  static async processEntropy(
    method: EntropyMethod,
    data: TouchPoint[] | string[] | number[] | string
  ): Promise<EntropyResult> {
    switch (method) {
      case 'touch':
        return this.processTouchEntropy(data as TouchPoint[]);
      case 'coinFlips':
        return this.processCoinFlips(data as string[]);
      case 'diceRolls':
        return this.processDiceRolls(data as number[]);
      case 'numbers':
        return this.processNumbers(data as string);
      default:
        throw new Error(`Unknown entropy method: ${method}`);
    }
  }
}
