/**
 * KeyDerivationFactory — Unified KeyDerivation Construction
 *
 * Single source of truth for creating KeyDerivation instances.
 * Two modes:
 *   1. keyDerivationFromDB()  — reads key material from wallets table (no PIN)
 *   2. keyDerivationFromSecureStorage() — reads from DB first, falls back to encrypted storage (PIN required)
 *
 * Replaces 8+ copy-pasted construction patterns across the codebase.
 */

import { KeyDerivation, SeedGenerator } from '../../core/wallet';
import { SecureStorage } from '../storage/SecureStorage';
import { WalletDatabase } from '../database/WalletDatabase';
import { SyncLogger } from '../SyncLogger';

// ─── From DB (no PIN) ────────────────────────────────────────────────

/**
 * Construct a KeyDerivation from key material stored in the wallets DB table.
 * Used by sync-time operations (GapLimitDiscovery, address extension) that
 * don't have access to the user's PIN.
 *
 * Priority: seedHex → masterXprv → mnemonic (synchronous seed derivation)
 *
 * Returns null if no usable key material is found (watch-only wallets).
 * Caller is responsible for calling kd.destroy() when done.
 */
export function keyDerivationFromDB(
  walletId: string,
  networkType: 'mainnet' | 'testnet' = 'mainnet'
): KeyDerivation | null {
  try {
    const db = WalletDatabase.shared();
    const walletRow = db.getWallet(walletId);
    if (!walletRow) return null;

    if (walletRow.seedHex) {
      return KeyDerivation.fromSeedHex(walletRow.seedHex, networkType);
    }

    if (walletRow.masterXprv) {
      return KeyDerivation.fromXprv(walletRow.masterXprv, networkType);
    }

    if (walletRow.mnemonic) {
      const seed = SeedGenerator.toSeedSync(walletRow.mnemonic, walletRow.passphrase || '');
      return new KeyDerivation(seed, networkType);
    }

    // Watch-only — no private key material
    return null;
  } catch {
    return null;
  }
}

// ─── From Secure Storage (PIN required) ──────────────────────────────

/**
 * Construct a KeyDerivation from key material.
 * Used by user-initiated operations (derive new address, sign tx, get change address).
 *
 * Strategy: DB-first, SecureStorage fallback.
 *   1. Try wallets DB table (seedHex, masterXprv, mnemonic+passphrase) — always correct per-wallet
 *   2. Fall back to type-specific SecureStorage/SecureVault retrieval for legacy wallets
 *
 * This ensures the correct key material is used for EACH wallet, including passphrase.
 * The DB always has the correct mnemonic+passphrase for each wallet (stored during creation).
 * SecureStorage.retrieveSeed() is a global singleton — only correct for the last-created wallet.
 *
 * Throws if key material cannot be retrieved.
 * Caller is responsible for calling kd.destroy() when done.
 */
export async function keyDerivationFromSecureStorage(
  walletId: string,
  walletType: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  pin: string
): Promise<KeyDerivation> {
  // ── Step 1: Try DB key material first (always correct per-wallet) ──
  // The wallets table stores mnemonic, passphrase, seedHex, masterXprv
  // directly. This is the most reliable source since it's per-wallet.
  const dbResult = keyDerivationFromDB(walletId, network);
  if (dbResult) {
    SyncLogger.log('kd-factory', `keyDerivationFromSecureStorage: using DB key material for ${walletId}`);
    return dbResult;
  }

  // ── Step 2: Fall back to type-specific SecureStorage/SecureVault ──
  // Legacy wallets may not have key material in DB (pre-migration).
  SyncLogger.log('kd-factory', `keyDerivationFromSecureStorage: DB has no key material for ${walletId}, falling back to SecureStorage (walletType=${walletType})`);

  // xprv-based wallets
  if (walletType === 'hd_xprv' || walletType === 'hd_descriptor') {
    const xprv = await SecureStorage.retrieveWalletXprv(walletId, pin);
    if (!xprv) throw new Error('Failed to retrieve extended private key');
    return KeyDerivation.fromXprv(xprv, network);
  }

  // Seed-hex based wallets
  if (walletType === 'hd_seed') {
    const { SecureVault } = await import('../vault/SecureVault');
    const seedHex = await SecureVault.retrieve(walletId, 'seed_hex', pin);
    if (!seedHex || typeof seedHex !== 'string') throw new Error('Failed to retrieve seed');
    return KeyDerivation.fromSeedHex(seedHex, network);
  }

  // Electrum mnemonic wallets
  if (walletType === 'hd_electrum') {
    const { SecureVault } = await import('../vault/SecureVault');
    const mnemonic = await SecureVault.retrieve(walletId, 'mnemonic', pin);
    if (!mnemonic || typeof mnemonic !== 'string') throw new Error('Failed to retrieve Electrum mnemonic');
    const seed = await SeedGenerator.toSeed(mnemonic);
    return new KeyDerivation(seed, network);
  }

  // Default: standard BIP39 mnemonic (hd, hd_mnemonic, etc.)
  // Retrieve both mnemonic AND passphrase from SecureStorage
  const mnemonic = await SecureStorage.retrieveSeed(pin);
  if (!mnemonic) throw new Error('Failed to retrieve mnemonic');
  const passphrase = await SecureStorage.retrievePassphrase(pin);
  const seed = await SeedGenerator.toSeed(mnemonic, passphrase || '');
  return new KeyDerivation(seed, network);
}
