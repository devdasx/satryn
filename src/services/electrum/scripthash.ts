/**
 * Electrum Scripthash Utilities
 *
 * Electrum servers identify addresses by their "scripthash" which is:
 * - The SHA256 hash of the scriptPubKey (locking script)
 * - Reversed (little-endian format)
 * - Encoded as hexadecimal
 */

import * as bitcoin from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Convert a Bitcoin address to Electrum scripthash format
 *
 * @param address - Bitcoin address (bc1..., tb1..., etc.)
 * @param network - Bitcoin network ('mainnet' | 'testnet')
 * @returns Hex-encoded scripthash (64 characters)
 *
 * @example
 * // Mainnet address
 * addressToScripthash('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet')
 * // Returns: '0014751e76e8199196d454941c45d1b3a323f1433bd6' reversed SHA256
 */
export function addressToScripthash(
  address: string,
  network: 'mainnet' | 'testnet' = 'mainnet'
): string {
  const bitcoinNetwork = network === 'mainnet'
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;

  // Get the output script (scriptPubKey) for the address
  const outputScript = bitcoin.address.toOutputScript(address, bitcoinNetwork);

  // SHA256 hash of the script
  const hash = sha256(outputScript);

  // Reverse the hash (Electrum convention - little-endian)
  const reversed = Buffer.from(hash).reverse();

  return reversed.toString('hex');
}

/**
 * Validate a scripthash format
 * Must be exactly 64 hex characters (32 bytes)
 *
 * @param scripthash - String to validate
 * @returns true if valid scripthash format
 */
export function isValidScripthash(scripthash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(scripthash);
}

/**
 * Convert multiple addresses to scripthashes
 *
 * @param addresses - Array of Bitcoin addresses
 * @param network - Bitcoin network
 * @returns Map of address -> scripthash
 */
export function addressesToScripthashes(
  addresses: string[],
  network: 'mainnet' | 'testnet' = 'mainnet'
): Map<string, string> {
  const map = new Map<string, string>();
  for (const address of addresses) {
    try {
      map.set(address, addressToScripthash(address, network));
    } catch (error) {
      // Failed to convert address to scripthash
    }
  }
  return map;
}

/**
 * Create a reverse lookup map from scripthash to address
 *
 * @param addresses - Array of Bitcoin addresses
 * @param network - Bitcoin network
 * @returns Map of scripthash -> address
 */
export function createScripthashToAddressMap(
  addresses: string[],
  network: 'mainnet' | 'testnet' = 'mainnet'
): Map<string, string> {
  const map = new Map<string, string>();
  for (const address of addresses) {
    try {
      const scripthash = addressToScripthash(address, network);
      map.set(scripthash, address);
    } catch (error) {
      // Failed to convert address to scripthash
    }
  }
  return map;
}

/**
 * Convert addresses to scripthashes in parallel using Promise.all
 * Useful for large address sets where you want non-blocking conversion.
 *
 * @param addresses - Array of Bitcoin addresses
 * @param network - Bitcoin network
 * @returns Promise resolving to array of scripthashes (same order as input)
 */
export async function addressesToScripthashesParallel(
  addresses: string[],
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<string[]> {
  // Wrap synchronous calls in Promise.resolve for parallel execution
  const promises = addresses.map(address =>
    Promise.resolve().then(() => {
      try {
        return addressToScripthash(address, network);
      } catch (error) {
        // Failed to convert address
        return '';
      }
    })
  );

  return Promise.all(promises);
}

/**
 * Convert addresses to scripthashes in batched parallel execution.
 * Processes addresses in chunks to avoid blocking the event loop
 * for very large address sets (1000+).
 *
 * @param addresses - Array of Bitcoin addresses
 * @param network - Bitcoin network
 * @param batchSize - Number of addresses per batch (default 100)
 * @returns Promise resolving to array of scripthashes
 */
export async function addressesToScripthashesChunked(
  addresses: string[],
  network: 'mainnet' | 'testnet' = 'mainnet',
  batchSize: number = 100
): Promise<string[]> {
  const results: string[] = [];

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    // Process batch
    const batchResults = batch.map(address => {
      try {
        return addressToScripthash(address, network);
      } catch (error) {
        // Failed to convert address
        return '';
      }
    });

    results.push(...batchResults);

    // Yield to event loop between batches
    if (i + batchSize < addresses.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return results;
}
