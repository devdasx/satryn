/**
 * AddressService — Unified address derivation and DB persistence
 *
 * Single source of truth for:
 *   1. Deriving batches of addresses (receiving + change) for HD wallets
 *   2. Converting AddressInfo[] → AddressRow[] for DB insertion
 *   3. Combined derive-and-persist operations
 *
 * Replaces 5+ identical AddressRow building patterns and 3+ identical
 * derivation loops across walletStore.ts, GapLimitDiscovery.ts, etc.
 */

import type { KeyDerivation } from '../../core/wallet/KeyDerivation';
import { DERIVATION } from '../../constants';
import type { AddressInfo, AddressType } from '../../types';
import type { AddressRow } from '../database/types';
import { addressToScripthash } from '../electrum/scripthash';
import { WalletDatabase } from '../database/WalletDatabase';
import { addressTypeToScript } from '../../utils/addressTypeMap';
import { SyncLogger } from '../SyncLogger';

// ─── Types ───────────────────────────────────────────────────────────

export interface DeriveBatchConfig {
  /** Which address types to derive (e.g., [native_segwit, taproot]) */
  addressTypes: AddressType[];
  /** Number of receiving addresses per type */
  receivingCount: number;
  /** Number of change addresses per type */
  changeCount: number;
  /** Account index (default: 0) */
  accountIndex?: number;
  /** Starting receiving index (default: 0) — for extending existing addresses */
  startReceivingIndex?: number;
  /** Starting change index (default: 0) — for extending existing addresses */
  startChangeIndex?: number;
}

export interface BuildRowsOptions {
  /** KeyDerivation for WIF extraction (optional) */
  kd?: KeyDerivation;
  /** Network type for scripthash computation (default: 'mainnet') */
  networkType?: 'mainnet' | 'testnet';
}

// ─── Pure Derivation (no DB writes) ─────────────────────────────────

/**
 * Derive a batch of addresses (receiving + change) for given types.
 * Returns AddressInfo[] — pure derivation, no side effects.
 *
 * @param kd - KeyDerivation instance (caller manages lifecycle)
 * @param config - Derivation configuration
 * @returns Array of derived AddressInfo objects
 */
export function deriveAddressBatch(
  kd: KeyDerivation,
  config: DeriveBatchConfig
): AddressInfo[] {
  const {
    addressTypes,
    receivingCount,
    changeCount,
    accountIndex = DERIVATION.DEFAULT_ACCOUNT,
    startReceivingIndex = 0,
    startChangeIndex = 0,
  } = config;

  const addresses: AddressInfo[] = [];

  for (const type of addressTypes) {
    // Receiving addresses
    for (let i = 0; i < receivingCount; i++) {
      const addr = kd.deriveReceivingAddress(accountIndex, startReceivingIndex + i, type);
      addresses.push(addr);
    }
    // Change addresses
    for (let i = 0; i < changeCount; i++) {
      const addr = kd.deriveChangeAddress(accountIndex, startChangeIndex + i, type);
      addresses.push(addr);
    }
  }

  return addresses;
}

/**
 * Async version of deriveAddressBatch that yields to the event loop every `chunkSize` derivations.
 * Prevents the JS thread from blocking for 240-600ms during wallet creation/import.
 * Returns the same result as deriveAddressBatch, just non-blocking.
 */
export async function deriveAddressBatchAsync(
  kd: KeyDerivation,
  config: DeriveBatchConfig,
  chunkSize: number = 10
): Promise<AddressInfo[]> {
  const {
    addressTypes,
    receivingCount,
    changeCount,
    accountIndex = DERIVATION.DEFAULT_ACCOUNT,
    startReceivingIndex = 0,
    startChangeIndex = 0,
  } = config;

  const addresses: AddressInfo[] = [];
  let derived = 0;

  for (const type of addressTypes) {
    // Receiving addresses
    for (let i = 0; i < receivingCount; i++) {
      const addr = kd.deriveReceivingAddress(accountIndex, startReceivingIndex + i, type);
      addresses.push(addr);
      derived++;
      if (derived % chunkSize === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    // Change addresses
    for (let i = 0; i < changeCount; i++) {
      const addr = kd.deriveChangeAddress(accountIndex, startChangeIndex + i, type);
      addresses.push(addr);
      derived++;
      if (derived % chunkSize === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
  }

  return addresses;
}

// ─── AddressRow Building ─────────────────────────────────────────────

/**
 * Convert AddressInfo[] to AddressRow[] for DB insertion.
 * Computes scripthashes, maps address types to DB format, optionally extracts WIFs.
 *
 * @param walletId - Wallet ID for the rows
 * @param addresses - AddressInfo[] to convert
 * @param options - Optional KD for WIF extraction, network for scripthash
 * @returns AddressRow[] ready for db.insertAddresses()
 */
export function buildAddressRows(
  walletId: string,
  addresses: AddressInfo[],
  options: BuildRowsOptions = {}
): AddressRow[] {
  const { kd, networkType = 'mainnet' } = options;

  return addresses.map(addr => {
    let scripthash: string | null = null;
    try {
      scripthash = addressToScripthash(addr.address, networkType);
    } catch { /* address conversion failed */ }

    let wif: string | null = null;
    if (kd && addr.path && addr.path !== 'imported') {
      try {
        wif = kd.getWIF(addr.path);
      } catch { /* WIF extraction optional */ }
    }

    return {
      walletId,
      address: addr.address,
      path: addr.path,
      addressIndex: addr.index,
      isChange: addr.isChange ? 1 : 0,
      addressType: addressTypeToScript(addr.type),
      scripthash,
      isUsed: 0,
      label: (addr as any).label ?? null,
      note: null,
      wif,
    };
  });
}

// ─── Combined Derive + Persist ───────────────────────────────────────

/**
 * Derive addresses AND persist to DB in one call.
 * Combines deriveAddressBatch + buildAddressRows + db.insertAddresses.
 *
 * @param walletId - Wallet ID
 * @param kd - KeyDerivation instance
 * @param config - Derivation configuration
 * @returns The derived AddressInfo[] (also persisted to DB)
 */
export function deriveAndPersistAddresses(
  walletId: string,
  kd: KeyDerivation,
  config: DeriveBatchConfig
): AddressInfo[] {
  const addresses = deriveAddressBatch(kd, config);

  if (addresses.length > 0) {
    try {
      const db = WalletDatabase.shared();
      const rows = buildAddressRows(walletId, addresses, { kd });
      db.insertAddresses(rows);
    } catch (err: any) {
      SyncLogger.warn('address-service', `DB write error (non-fatal): ${err?.message}`);
    }
  }

  return addresses;
}

/**
 * Derive a single address (receiving or change), persist to DB, return it.
 *
 * @param walletId - Wallet ID
 * @param kd - KeyDerivation instance
 * @param addressType - Address type to derive
 * @param isChange - true for change, false for receiving
 * @param index - Address index
 * @param accountIndex - Account index (default: 0)
 * @returns The derived AddressInfo (also persisted to DB)
 */
export function deriveSingleAddress(
  walletId: string,
  kd: KeyDerivation,
  addressType: AddressType,
  isChange: boolean,
  index: number,
  accountIndex: number = DERIVATION.DEFAULT_ACCOUNT,
): AddressInfo {
  const addr = isChange
    ? kd.deriveChangeAddress(accountIndex, index, addressType)
    : kd.deriveReceivingAddress(accountIndex, index, addressType);

  try {
    const db = WalletDatabase.shared();
    const rows = buildAddressRows(walletId, [addr], { kd });
    db.insertAddresses(rows);
  } catch (err: any) {
    SyncLogger.warn('address-service', `DB write error (non-fatal): ${err?.message}`);
  }

  return addr;
}
