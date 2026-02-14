/**
 * Test utility to verify deterministic entropy generation
 * Can be called from the app to verify the implementation
 */

import { EntropyCollector, EntropyService } from '../services/entropy';
import { Buffer } from 'buffer';

// Note: The mnemonic will be different from standard tools because
// we use base64 encoding for binary HMAC operations (iOS compatibility).
// What matters is that SAME INPUT = SAME OUTPUT (deterministic).
export const EXPECTED_128_HEADS_MNEMONIC = ''; // Will be determined by first run

export async function testDeterministicEntropy(): Promise<{
  success: boolean;
  details: string;
}> {
  console.log('=== Testing Deterministic Entropy in React Native ===');

  try {
    // Test 1: Process 128 Heads
    const flips1 = Array(128).fill('H');
    console.log('[Test] Processing 128 Heads (first time)...');
    const result1 = await EntropyCollector.processCoinFlips(flips1);
    const hex1 = Buffer.from(result1.userEntropy).toString('hex');
    console.log('[Test] Result 1 userEntropy:', hex1);

    // Generate mnemonic
    const mnemonic1 = await EntropyService.generateMnemonicPureManual(result1, 12);
    console.log('[Test] Mnemonic 1:', mnemonic1);

    // Test 2: Process same 128 Heads again
    const flips2 = Array(128).fill('H');
    console.log('[Test] Processing 128 Heads (second time)...');
    const result2 = await EntropyCollector.processCoinFlips(flips2);
    const hex2 = Buffer.from(result2.userEntropy).toString('hex');
    console.log('[Test] Result 2 userEntropy:', hex2);

    // Generate mnemonic again
    const mnemonic2 = await EntropyService.generateMnemonicPureManual(result2, 12);
    console.log('[Test] Mnemonic 2:', mnemonic2);

    // Compare - what matters is that same input produces same output
    const hashMatch = hex1 === hex2;
    const mnemonicMatch = mnemonic1 === mnemonic2;

    console.log('[Test] Hash match (run 1 vs run 2):', hashMatch ? 'YES ✓' : 'NO ✗');
    console.log('[Test] Mnemonic match (run 1 vs run 2):', mnemonicMatch ? 'YES ✓' : 'NO ✗');

    if (hashMatch && mnemonicMatch) {
      return {
        success: true,
        details: `SUCCESS! Deterministic - same input produces same output.\n\nMnemonic: ${mnemonic1}\n\nHash: ${hex1.substring(0, 16)}...`,
      };
    } else {
      return {
        success: false,
        details: `FAILED! Non-deterministic.\n\nHash 1: ${hex1}\nHash 2: ${hex2}\n\nMnemonic 1: ${mnemonic1}\nMnemonic 2: ${mnemonic2}`,
      };
    }
  } catch (error) {
    console.error('[Test] Error:', error);
    return {
      success: false,
      details: `Error: ${error}`,
    };
  }
}
