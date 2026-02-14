/**
 * WalletCreationService — Unified wallet creation & DB persistence
 *
 * Single source of truth for inserting a new wallet into the database.
 * Replaces the `syncNewWalletToDb()` function in walletStore.ts and
 * eliminates the 3x-duplicated xpub/descriptor generation pattern.
 *
 * Each import method in walletStore still handles:
 *   - Input validation (type-specific)
 *   - SecureStorage encryption (type-specific)
 *   - multiWalletStore registration
 *   - Zustand state updates
 *
 * This service handles the common 80%:
 *   - WalletRow construction + DB insert
 *   - AddressRow building (via AddressService.buildAddressRows)
 *   - Xpub + descriptor generation from KeyDerivation
 *   - Scripthash status initialization
 *   - Sync state initialization
 */

import { WalletDatabase } from '../database/WalletDatabase';
import { buildAddressRows } from './AddressService';
import { addressTypeToScript, addressTypesToScripts } from '../../utils/addressTypeMap';
import { SyncLogger } from '../SyncLogger';
import type { KeyDerivation } from '../../core/wallet/KeyDerivation';
import type { AddressInfo, AddressType } from '../../types';
import type { WalletRow, XpubRow, DescriptorRow } from '../database/types';
import { addressToScripthash } from '../electrum/scripthash';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Configuration for creating a new wallet in the database.
 * Contains all metadata and derived data needed for a full wallet record.
 */
export interface WalletCreationConfig {
  walletId: string;
  name: string;
  walletType: string;
  importSource: string;
  fingerprint?: string | null;
  descriptor?: string | null;
  scriptTypes?: string[];
  preferredAddressType?: string;
  gapLimit?: number;
  isMultisig?: boolean;
  multisigConfig?: any;
  watchOnlyData?: any;
  /** Pre-derived addresses to store */
  addresses?: AddressInfo[];
  /** Xpub entries (if not using auto-generation) */
  xpubs?: XpubInput[];
  /** Descriptor entries (if not using auto-generation) */
  descriptors?: DescriptorInput[];
}

export interface XpubInput {
  xpub: string;
  derivationPath: string;
  scriptType: string;
  fingerprint?: string | null;
}

export interface DescriptorInput {
  descriptor: string;
  isRange?: boolean;
  checksum?: string | null;
  internal?: boolean;
}

/**
 * Key material to persist alongside wallet metadata in the DB.
 * Passed from the creation flow while secrets are still in memory.
 */
export interface WalletKeyMaterial {
  secretType: string;
  mnemonic?: string;
  passphrase?: string;
  masterXprv?: string;
  masterXpub?: string;
  seedHex?: string;
  /** KeyDerivation instance for extracting WIFs per address */
  keyDerivation?: KeyDerivation;
}

/**
 * Result of wallet creation — returned to the caller for state updates.
 */
export interface WalletCreationResult {
  walletId: string;
  addressCount: number;
}

// ─── Xpub/Descriptor Generation ──────────────────────────────────────

/**
 * Generate standard xpub and descriptor entries from a KeyDerivation instance.
 * This pattern was duplicated 3x across createWallet, importFromXprv,
 * and importFromSeedBytes.
 *
 * @param kd - KeyDerivation instance (caller manages lifecycle)
 * @param accountIndex - BIP44 account index (default: 0)
 * @returns Object with xpubs, descriptors, and primary descriptor
 */
export function generateXpubsAndDescriptors(
  kd: KeyDerivation,
  accountIndex: number = 0
): {
  xpubs: XpubInput[];
  descriptors: DescriptorInput[];
  primaryDescriptor: string | null;
} {
  try {
    const fp = kd.getMasterFingerprint();
    const allXpubs = kd.getAllExtendedPublicKeys(accountIndex);
    const allDescriptors = kd.getAllOutputDescriptors(accountIndex);

    const xpubs: XpubInput[] = [
      { xpub: allXpubs.nativeSegwit.xpub, derivationPath: allXpubs.nativeSegwit.path, scriptType: 'p2wpkh', fingerprint: fp },
      { xpub: allXpubs.wrappedSegwit.xpub, derivationPath: allXpubs.wrappedSegwit.path, scriptType: 'p2sh-p2wpkh', fingerprint: fp },
      { xpub: allXpubs.legacy.xpub, derivationPath: allXpubs.legacy.path, scriptType: 'p2pkh', fingerprint: fp },
    ];

    const descriptors: DescriptorInput[] = [
      { descriptor: allDescriptors.nativeSegwit.receive, isRange: true, internal: false },
      { descriptor: allDescriptors.nativeSegwit.change, isRange: true, internal: true },
      { descriptor: allDescriptors.wrappedSegwit.receive, isRange: true, internal: false },
      { descriptor: allDescriptors.wrappedSegwit.change, isRange: true, internal: true },
      { descriptor: allDescriptors.legacy.receive, isRange: true, internal: false },
      { descriptor: allDescriptors.legacy.change, isRange: true, internal: true },
    ];

    return {
      xpubs,
      descriptors,
      primaryDescriptor: allDescriptors.nativeSegwit.receive,
    };
  } catch {
    return { xpubs: [], descriptors: [], primaryDescriptor: null };
  }
}

// ─── Core: Create Wallet in DB ───────────────────────────────────────

/**
 * Insert a new wallet and all associated data into the SQLite database.
 * This is the single entry point for wallet creation — no V2 files involved.
 *
 * Handles:
 *   1. WalletRow insertion with key material
 *   2. AddressRow building (with scripthashes + WIFs) via AddressService
 *   3. Xpub row insertion
 *   4. Descriptor row insertion
 *   5. Scripthash status initialization
 *   6. Sync state initialization
 *
 * @param config - Wallet metadata and derived data
 * @param keyMaterial - Optional key material to persist
 * @returns WalletCreationResult with walletId and address count
 */
export function createWalletInDB(
  config: WalletCreationConfig,
  keyMaterial?: WalletKeyMaterial
): WalletCreationResult {
  try {
    const db = WalletDatabase.shared();

    // Skip if already in DB
    if (db.getWallet(config.walletId)) {
      return { walletId: config.walletId, addressCount: 0 };
    }

    const now = Date.now();

    // 1. Insert wallet metadata
    const walletRow: WalletRow = {
      walletId: config.walletId,
      name: config.name,
      walletType: config.walletType,
      importSource: config.importSource,
      createdAt: now,
      lastModified: now,
      network: 'mainnet',
      secretId: null,
      fingerprint: config.fingerprint ?? null,
      descriptor: config.descriptor ?? null,
      scriptTypes: JSON.stringify(config.scriptTypes ?? ['p2wpkh']),
      preferredAddressType: config.preferredAddressType ?? 'native_segwit',
      gapLimit: config.gapLimit ?? 20,
      isMultisig: config.isMultisig ? 1 : 0,
      multisigConfig: config.multisigConfig ? JSON.stringify(config.multisigConfig) : null,
      confirmedBalanceSat: 0,
      unconfirmedBalanceSat: 0,
      watchOnlyData: config.watchOnlyData ? JSON.stringify(config.watchOnlyData) : null,
      // Key material (from creation flow)
      secretType: keyMaterial?.secretType ?? null,
      mnemonic: keyMaterial?.mnemonic ?? null,
      passphrase: keyMaterial?.passphrase ?? null,
      masterXprv: keyMaterial?.masterXprv ?? null,
      masterXpub: keyMaterial?.masterXpub ?? null,
      seedHex: keyMaterial?.seedHex ?? null,
    };
    db.insertWallet(walletRow);

    // 2. Insert addresses using shared AddressService.buildAddressRows
    const addresses = config.addresses ?? [];
    if (addresses.length > 0) {
      const addrRows = buildAddressRows(config.walletId, addresses, {
        kd: keyMaterial?.keyDerivation,
        networkType: 'mainnet',
      });
      db.insertAddresses(addrRows);
    }

    // 3. Insert xpubs
    const xpubs = config.xpubs ?? [];
    if (xpubs.length > 0) {
      const xpubRows: XpubRow[] = xpubs.map(x => ({
        walletId: config.walletId,
        xpub: x.xpub,
        derivationPath: x.derivationPath,
        scriptType: x.scriptType,
        fingerprint: x.fingerprint ?? null,
      }));
      db.insertXpubs(xpubRows);
    }

    // 4. Insert descriptors
    const descriptors = config.descriptors ?? [];
    if (descriptors.length > 0) {
      const descRows: DescriptorRow[] = descriptors.map(d => ({
        walletId: config.walletId,
        descriptor: d.descriptor,
        isRange: d.isRange ? 1 : 0,
        checksum: d.checksum ?? null,
        internal: d.internal ? 1 : 0,
      }));
      db.insertDescriptors(descRows);
    }

    // 5. Insert scripthash statuses (initialized with null — updated on first subscribe)
    const shEntries: { walletId: string; scripthash: string; address: string; status: string | null }[] = [];
    for (const addr of addresses) {
      try {
        const sh = addressToScripthash(addr.address, 'mainnet');
        shEntries.push({ walletId: config.walletId, scripthash: sh, address: addr.address, status: null });
      } catch {}
    }
    if (shEntries.length > 0) {
      db.updateScripthashStatuses(shEntries);
    }

    // 6. Init sync state
    db.initSyncState(config.walletId);

    SyncLogger.log('wallet-creation', `Wallet inserted to DB: ${config.walletId}, ${addresses.length} addrs, ${xpubs.length} xpubs, ${descriptors.length} descs`);

    return { walletId: config.walletId, addressCount: addresses.length };
  } catch (error: any) {
    SyncLogger.warn('wallet-creation', `Failed to create wallet in DB: ${error?.message}`);
    throw error;
  }
}

// ─── Convenience: Update wallet address WIFs ─────────────────────────

/**
 * Store WIF on address rows for imported private keys.
 * Used by WIF import flow where there's no derivation path for WIF extraction.
 *
 * @param walletId - Wallet ID
 * @param addresses - Addresses to update
 * @param wif - WIF to store on each address
 */
export function storeWifOnAddresses(walletId: string, addresses: AddressInfo[], wif: string): void {
  try {
    const db = WalletDatabase.shared();
    for (const addr of addresses) {
      db.updateAddressWif(walletId, addr.address, wif);
    }
  } catch (err: any) {
    SyncLogger.warn('wallet-creation', `Failed to store WIF on addresses: ${err?.message}`);
  }
}
