/**
 * formatNearbyAmount — Shared display helper for Nearby Payments
 *
 * Formats a NearbyPayload's amount using the receiver's chosen denomination.
 * Falls back to sats if display fields are absent (backward compat).
 */

import type { NearbyPayload } from './types';
import type { BitcoinUnit } from '../../types';
import { formatSats, satsToBtc, formatFiat, formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Format a NearbyPayload's amount for display, respecting the receiver's
 * chosen denomination. Falls back to the user's denomination setting
 * if display fields are absent.
 *
 * @param payload - The nearby payment payload
 * @param denomination - Optional override; defaults to the user's setting from settingsStore
 */
export function formatNearbyAmount(
  payload: NearbyPayload,
  denomination?: BitcoinUnit,
): string {
  if (payload.amountSats == null) return '';

  const userDenom = denomination ?? useSettingsStore.getState().denomination;
  const denom = payload.displayDenomination || userDenom;

  if (denom === 'fiat') {
    if (payload.displayAmount !== undefined && payload.displayCurrency) {
      return formatFiat(payload.displayAmount, payload.displayCurrency);
    }
    return formatUnitAmount(payload.amountSats, userDenom);
  }

  // For any Bitcoin unit denomination
  if (payload.displayAmount !== undefined) {
    return `${payload.displayAmount} ${getUnitSymbol(denom)}`;
  }
  return formatUnitAmount(payload.amountSats, denom);
}
