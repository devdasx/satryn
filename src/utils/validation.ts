import * as bitcoin from 'bitcoinjs-lib';

/**
 * Validate a Bitcoin address
 * @param address - Address to validate
 * @param network - Network type
 */
export function isValidBitcoinAddress(
  address: string,
  network: 'mainnet' | 'testnet' = 'testnet'
): boolean {
  if (!address || address.length === 0) {
    return false;
  }

  const networkConfig = network === 'mainnet'
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;

  try {
    bitcoin.address.toOutputScript(address, networkConfig);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the address type
 * @param address - Bitcoin address
 */
export function getAddressType(
  address: string
): 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'unknown' {
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return 'p2pkh'; // Legacy
  }
  if (address.startsWith('3') || address.startsWith('2')) {
    return 'p2sh'; // Script hash (could be wrapped SegWit)
  }
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
    return 'p2wpkh'; // Native SegWit (v0)
  }
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return 'p2wsh'; // Taproot (v1)
  }
  return 'unknown';
}

/**
 * Validate PIN format
 * @param pin - PIN to validate
 */
export function isValidPin(pin: string): boolean {
  // Must be exactly 6 digits
  return /^\d{6}$/.test(pin);
}

/**
 * Validate amount is positive and within range
 * @param satoshis - Amount in satoshis
 * @param maxAmount - Maximum allowed (optional)
 */
export function isValidAmount(satoshis: number, maxAmount?: number): boolean {
  if (!Number.isInteger(satoshis) || satoshis <= 0) {
    return false;
  }

  if (maxAmount !== undefined && satoshis > maxAmount) {
    return false;
  }

  return true;
}

/**
 * Validate fee rate is reasonable
 * @param satPerVByte - Fee rate
 */
export function isValidFeeRate(satPerVByte: number): boolean {
  return satPerVByte >= 1 && satPerVByte <= 1000;
}

/**
 * Check if a transaction ID is valid format
 * @param txid - Transaction ID
 */
export function isValidTxid(txid: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

/**
 * Validate seed phrase word count
 * @param words - Array of words
 */
export function isValidWordCount(words: string[]): boolean {
  return words.length === 12 || words.length === 24;
}

/**
 * Sanitize user input for address
 * @param input - Raw input
 */
export function sanitizeAddressInput(input: string): string {
  return input.trim().replace(/\s+/g, '');
}

/**
 * Sanitize PIN input
 * @param input - Raw input
 */
export function sanitizePinInput(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}

/**
 * Check if input might be a BIP21 URI
 * @param input - Input string
 */
export function isBitcoinUri(input: string): boolean {
  return input.toLowerCase().startsWith('bitcoin:');
}

/**
 * Deep sanitize a Bitcoin address — remove invisible characters,
 * bidi overrides, zero-width chars, and normalize bech32 case.
 * Re-exported from addressSafety for convenience.
 * @param input - Raw address input
 */
export { deepSanitizeAddress } from './addressSafety';
