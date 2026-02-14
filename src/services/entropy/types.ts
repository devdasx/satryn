/**
 * Entropy Collection Types
 * Type definitions for user-provided entropy collection
 */

// Entropy collection method types
export type EntropyMethod = 'touch' | 'coinFlips' | 'diceRolls' | 'numbers';

// Entropy generation mode
export type EntropyMode = 'mixed' | 'pureManual';
// 'mixed' = System CSPRNG + User entropy (different each time, more secure)
// 'pureManual' = User entropy ONLY (deterministic, same input = same output)

// Touch event data point
export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
}

// Entropy collection result
export interface EntropyResult {
  userEntropy: Uint8Array;      // Hashed user entropy (32 bytes)
  rawDataHash: string;          // SHA256 hash of raw data (first 16 chars for display)
  method: EntropyMethod;
  bitsCollected: number;
}

// Method requirements configuration
export interface EntropyMethodConfig {
  name: string;
  description: string;
  icon: string;                  // Ionicons name
  minInputsFor128Bits: number;   // Minimum inputs for 12-word seed
  minInputsFor256Bits: number;   // Minimum inputs for 24-word seed
  bitsPerInput: number;          // Estimated entropy bits per input
}

// State for tracking entropy collection progress
export interface EntropyCollectionState {
  method: EntropyMethod;
  inputCount: number;            // Number of inputs collected
  bitsCollected: number;         // Estimated bits of entropy collected
  targetBits: number;            // Target bits needed (128 for 12 words, 256 for 24)
  isComplete: boolean;
  rawData: string;               // Raw collected data (coordinates, flips, etc.)
}

// Props for entropy collector components
export interface EntropyCollectorProps {
  seedLength: 12 | 24;
  onComplete: (result: EntropyResult) => void;
  onProgress: (bitsCollected: number, targetBits: number) => void;
  onCancel: () => void;
}

// Props for entropy modal
export interface EntropyCollectionModalProps {
  visible: boolean;
  method: EntropyMethod;
  seedLength: 12 | 24;
  onComplete: (result: EntropyResult) => void;
  onCancel: () => void;
}
