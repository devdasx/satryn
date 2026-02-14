import { FORMATTING, BITCOIN_UNITS } from '../constants';
import type { BitcoinUnit } from '../types';

/**
 * Format satoshis to BTC string
 * @param satoshis - Amount in satoshis
 * @param decimals - Number of decimal places (default: 8)
 */
export function satsToBtc(satoshis: number, decimals: number = 8): string {
  const btc = satoshis / FORMATTING.SATS_PER_BTC;
  return btc.toFixed(decimals);
}

/**
 * Format BTC amount for display
 * @param btc - Amount in BTC
 */
export function formatBtc(btc: number): string {
  return btc.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

/**
 * Format satoshis with comma separators
 * @param satoshis - Amount in satoshis
 */
export function formatSats(satoshis: number): string {
  return satoshis.toLocaleString('en-US');
}

/**
 * Convert satoshis to any Bitcoin unit value
 * @param satoshis - Amount in satoshis
 * @param unit - Bitcoin unit to convert to
 */
export function satsToUnit(satoshis: number, unit: BitcoinUnit): number {
  const { satsPerUnit } = BITCOIN_UNITS[unit];
  return satoshis / satsPerUnit;
}

/**
 * Convert a unit value back to satoshis
 * @param value - Amount in the given unit
 * @param unit - Bitcoin unit the value is in
 */
export function unitToSats(value: number, unit: BitcoinUnit): number {
  const { satsPerUnit } = BITCOIN_UNITS[unit];
  return Math.round(value * satsPerUnit);
}

/**
 * Format satoshis in a given Bitcoin unit for display
 * @param satoshis - Amount in satoshis
 * @param unit - Bitcoin unit
 * @param showUnit - Whether to append the unit symbol
 */
export function formatUnitAmount(
  satoshis: number,
  unit: BitcoinUnit,
  showUnit: boolean = true
): string {
  const info = BITCOIN_UNITS[unit];
  const value = satoshis / info.satsPerUnit;
  let formatted: string;

  if (info.decimals === 0) {
    // Satoshis — integer, use locale separators
    formatted = Math.round(value).toLocaleString('en-US');
  } else {
    // Fixed decimal places for the unit
    formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: info.decimals,
    });
  }

  return showUnit ? `${formatted} ${info.symbol}` : formatted;
}

/**
 * Get the unit symbol for a Bitcoin unit
 */
export function getUnitSymbol(unit: BitcoinUnit): string {
  return BITCOIN_UNITS[unit].symbol;
}

/**
 * Format amount based on denomination preference (backward-compatible wrapper)
 * @param satoshis - Amount in satoshis
 * @param denomination - Bitcoin unit (legacy 'sats' maps to 'sat', 'fiat' falls back to 'sat')
 * @param showUnit - Whether to append the unit
 */
export function formatAmount(
  satoshis: number,
  denomination: BitcoinUnit | 'sats' | 'fiat' = 'sat',
  showUnit: boolean = true
): string {
  // Map legacy values
  const unit: BitcoinUnit = denomination === 'sats' ? 'sat' : denomination === 'fiat' ? 'sat' : denomination;
  return formatUnitAmount(satoshis, unit, showUnit);
}

/**
 * Format fiat currency
 * @param amount - Amount in fiat
 * @param currency - Currency code (default: USD)
 */
export function formatFiat(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Convert satoshis to fiat
 * @param satoshis - Amount in satoshis
 * @param btcPrice - Current BTC price in fiat
 */
export function satsToFiat(satoshis: number, btcPrice: number): number {
  const btc = satoshis / FORMATTING.SATS_PER_BTC;
  return btc * btcPrice;
}

/**
 * Convert fiat to satoshis
 * @param fiatAmount - Amount in fiat
 * @param btcPrice - Current BTC price in fiat
 */
export function fiatToSats(fiatAmount: number, btcPrice: number): number {
  if (btcPrice <= 0) return 0;
  const btc = fiatAmount / btcPrice;
  return Math.round(btc * FORMATTING.SATS_PER_BTC);
}

/**
 * Truncate a Bitcoin address for display
 * @param address - Full Bitcoin address
 * @param startChars - Characters to show at start
 * @param endChars - Characters to show at end
 */
export function truncateAddress(
  address: string,
  startChars: number = 8,
  endChars: number = 6
): string {
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format a timestamp to relative time (premium format)
 * @param timestamp - Unix timestamp in seconds
 *
 * Returns:
 * - < 60 sec: "a moment ago"
 * - 1-59 min: "X min ago"
 * - 1-23 hr: "X hr ago"
 * - 1-6 days: "X days ago"
 * - Older: "Feb 3" (short date)
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  // Less than 60 seconds
  if (diff < 60) return 'a moment ago';

  // Less than 60 minutes
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins} min ago`;
  }

  // Less than 24 hours
  if (diff < 86400) {
    const hrs = Math.floor(diff / 3600);
    return `${hrs} hr ago`;
  }

  // Less than 7 days
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  // Fall back to short date format (e.g., "Feb 3")
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a timestamp to full date/time
 * @param timestamp - Unix timestamp in seconds
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Parse a string amount to satoshis
 * @param input - User input string
 * @param denomination - Input denomination (any Bitcoin unit)
 */
export function parseAmount(
  input: string,
  denomination: BitcoinUnit | 'btc' | 'sats'
): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);

  if (isNaN(parsed) || parsed < 0) {
    return null;
  }

  // Map legacy values
  const unit: BitcoinUnit = denomination === 'sats' ? 'sat' : denomination;
  return Math.round(parsed * BITCOIN_UNITS[unit].satsPerUnit);
}

/**
 * Format fee rate
 * @param satPerVByte - Fee rate in sat/vB
 */
export function formatFeeRate(satPerVByte: number): string {
  return `${satPerVByte} sat/vB`;
}

/**
 * Format confirmations
 * @param confirmations - Number of confirmations
 */
export function formatConfirmations(confirmations: number): string {
  if (confirmations === 0) return 'Unconfirmed';
  if (confirmations === 1) return '1 confirmation';
  if (confirmations >= 6) return '6+ confirmations';
  return `${confirmations} confirmations`;
}
