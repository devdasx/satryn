/**
 * PathDiscovery - Auto-discovery of wallet balances and transaction history
 *
 * Scans all 4 BIP derivation paths (BIP44/49/84/86) for existing balances
 * and used addresses. Returns progressive results via callback for real-time UI updates.
 *
 * Used during import to show users which paths have activity before they confirm.
 */

import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import bs58check from 'bs58check';
import { KeyDerivation } from '../../core/wallet/KeyDerivation';
import { SeedGenerator } from '../../core/wallet/SeedGenerator';
import { ElectrumAPI } from '../electrum/ElectrumAPI';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import type { PathDiscoveryResult, PathDiscoveryAggregateResult, PathScanStatus } from './types';
import { safeLog } from './security';
import { bipPresetToAddressType } from '../../utils/addressTypeMap';
import { deriveAddressBatch } from '../wallet/AddressService';

// Initialize BIP32 with secp256k1
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

/** Default gap limit for scanning addresses */
const DEFAULT_GAP_LIMIT = 20;

/** Path metadata for display (addressType derived from shared bipPresetToAddressType) */
const PATH_INFO: Record<'bip44' | 'bip49' | 'bip84' | 'bip86', {
  label: string;
  addressPrefix: string;
}> = {
  bip44: { label: 'Legacy (BIP44)', addressPrefix: '1...' },
  bip49: { label: 'Wrapped SegWit (BIP49)', addressPrefix: '3...' },
  bip84: { label: 'Native SegWit (BIP84)', addressPrefix: 'bc1q...' },
  bip86: { label: 'Taproot (BIP86)', addressPrefix: 'bc1p...' },
};

/** Order to scan paths (most common first) */
const SCAN_ORDER: Array<'bip44' | 'bip49' | 'bip84' | 'bip86'> = ['bip84', 'bip49', 'bip44', 'bip86'];

/** Input types for HD discovery */
export type HDDiscoveryInput =
  | { type: 'seed'; seed: Buffer }
  | { type: 'mnemonic'; mnemonic: string; passphrase?: string }
  | { type: 'xprv'; xprv: string };

/** Options for path discovery */
export interface PathDiscoveryOptions {
  /** Number of addresses to scan per path (default 20) */
  gapLimit?: number;
  /** Callback for progressive results */
  onPathResult: (result: PathDiscoveryResult) => void;
  /** Reference to check for cancellation */
  cancelRef?: { current: boolean };
}

/**
 * Create initial pending results for all paths
 */
function createPendingResults(): PathDiscoveryResult[] {
  return SCAN_ORDER.map(path => ({
    path,
    label: PATH_INFO[path].label,
    addressPrefix: PATH_INFO[path].addressPrefix,
    status: 'pending' as PathScanStatus,
    balanceSats: 0,
    usedAddressCount: 0,
    firstAddress: '',
  }));
}

/**
 * PathDiscovery service for auto-scanning wallet balances
 */
export class PathDiscovery {
  /**
   * Discover balances and activity across all BIP paths for HD material
   * (mnemonic, seed bytes, or xprv)
   */
  static async discoverHD(
    input: HDDiscoveryInput,
    options: PathDiscoveryOptions
  ): Promise<PathDiscoveryAggregateResult> {
    const { gapLimit = DEFAULT_GAP_LIMIT, onPathResult, cancelRef } = options;

    safeLog(`PathDiscovery.discoverHD: starting discovery, gapLimit=${gapLimit}`);

    // Convert input to seed
    let seed: Buffer | null = null;
    let xprvNode: BIP32Interface | null = null;

    if (input.type === 'mnemonic') {
      seed = await SeedGenerator.toSeed(input.mnemonic, input.passphrase || '');
    } else if (input.type === 'seed') {
      seed = input.seed;
    } else if (input.type === 'xprv') {
      // Parse xprv and use it directly
      try {
        xprvNode = bip32.fromBase58(input.xprv, bitcoin.networks.bitcoin);
      } catch {
        // Try testnet format
        try {
          xprvNode = bip32.fromBase58(input.xprv, bitcoin.networks.testnet);
        } catch (e) {
          throw new Error('Invalid xprv format');
        }
      }
      // For xprv, we don't need the seed - we derive directly from the node
    }

    const results = createPendingResults();
    let totalBalanceSats = 0;
    let hasActivity = false;

    // Create KeyDerivation instance (only for seed-based inputs)
    let keyDerivation: KeyDerivation | null = null;
    if (seed) {
      keyDerivation = new KeyDerivation(seed, 'mainnet');
    }

    try {
      for (const pathKey of SCAN_ORDER) {
        // Check for cancellation
        if (cancelRef?.current) {
          safeLog('PathDiscovery.discoverHD: cancelled');
          break;
        }

        const pathInfo = PATH_INFO[pathKey];
        const resultIndex = results.findIndex(r => r.path === pathKey);

        // Update status to scanning
        results[resultIndex] = {
          ...results[resultIndex],
          status: 'scanning',
        };
        onPathResult(results[resultIndex]);

        try {
          const addressType = bipPresetToAddressType(pathKey);
          let addresses: string[];
          let firstAddress: string;

          if (xprvNode) {
            // Derive from xprv node based on its depth (handles non-master xprvs)
            const derivedAddresses = deriveAddressesFromXprv(
              xprvNode,
              addressType,
              gapLimit
            );
            addresses = derivedAddresses.map(a => a.address);
            firstAddress = addresses[0] || '';
          } else if (keyDerivation) {
            // Use shared AddressService for batch derivation (receiving only, no change needed for scan)
            const derivedAddresses = deriveAddressBatch(keyDerivation, {
              addressTypes: [addressType],
              receivingCount: gapLimit,
              changeCount: 0,
            });
            addresses = derivedAddresses.map(a => a.address);
            firstAddress = addresses[0] || '';
          } else {
            throw new Error('No valid key derivation method');
          }

          // Query Electrum for balances and history
          const electrum = ElectrumAPI.shared('mainnet');
          const syncResult = await electrum.syncWalletLight(addresses);

          if (!syncResult.ok) {
            throw new Error(syncResult.error);
          }

          const { balance, historyMap } = syncResult;

          // Count used addresses
          let usedAddressCount = 0;
          let firstUsedAddress: string | undefined;

          for (const [addr, history] of historyMap) {
            if (history && history.length > 0) {
              usedAddressCount++;
              if (!firstUsedAddress) {
                firstUsedAddress = addr;
              }
            }
          }

          // Update result
          results[resultIndex] = {
            path: pathKey,
            label: pathInfo.label,
            addressPrefix: pathInfo.addressPrefix,
            status: 'complete',
            balanceSats: balance.total,
            usedAddressCount,
            firstUsedAddress,
            firstAddress,
          };

          totalBalanceSats += balance.total;
          if (usedAddressCount > 0 || balance.total > 0) {
            hasActivity = true;
          }

          safeLog(`PathDiscovery: ${pathKey} complete, balance=${balance.total}, used=${usedAddressCount}`);
        } catch (error) {
          // Mark as error
          results[resultIndex] = {
            ...results[resultIndex],
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          safeLog(`PathDiscovery: ${pathKey} error: ${error}`);
        }

        onPathResult(results[resultIndex]);
      }
    } finally {
      // Cleanup
      if (keyDerivation) {
        keyDerivation.destroy();
      }
    }

    const isComplete = results.every(r => r.status === 'complete' || r.status === 'error');

    return {
      paths: results,
      hasActivity,
      totalBalanceSats,
      isComplete,
    };
  }

  /**
   * Discover balances for a WIF private key
   * WIF keys can generate multiple address types depending on compression
   */
  static async discoverWIF(
    wif: string,
    compressed: boolean,
    options: PathDiscoveryOptions
  ): Promise<PathDiscoveryAggregateResult> {
    const { onPathResult, cancelRef } = options;

    safeLog(`PathDiscovery.discoverWIF: starting discovery, compressed=${compressed}`);

    // Parse WIF to get key pair
    let keyPair;
    try {
      keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
    } catch {
      try {
        keyPair = ECPair.fromWIF(wif, bitcoin.networks.testnet);
      } catch {
        throw new Error('Invalid WIF format');
      }
    }

    const network = bitcoin.networks.bitcoin;
    const publicKey = keyPair.publicKey;

    // Determine which paths to scan based on compression
    // Compressed WIF: BIP84, BIP49, BIP44 (no BIP86/Taproot — single keys don't support Taproot)
    // Uncompressed WIF: BIP44 (legacy) only
    const pathsToScan: string[] = compressed
      ? ['bip84', 'bip49', 'bip44']
      : ['bip44'];

    const results = createPendingResults();
    let totalBalanceSats = 0;
    let hasActivity = false;

    for (const pathKey of SCAN_ORDER) {
      // Check for cancellation
      if (cancelRef?.current) {
        safeLog('PathDiscovery.discoverWIF: cancelled');
        break;
      }

      const resultIndex = results.findIndex(r => r.path === pathKey);
      const pathInfo = PATH_INFO[pathKey];

      // Skip paths not applicable to this key type
      if (!pathsToScan.includes(pathKey)) {
        results[resultIndex] = {
          ...results[resultIndex],
          status: 'complete',
          balanceSats: 0,
          usedAddressCount: 0,
          firstAddress: '',
          error: 'Not applicable for uncompressed keys',
        };
        onPathResult(results[resultIndex]);
        continue;
      }

      // Update status to scanning
      results[resultIndex] = {
        ...results[resultIndex],
        status: 'scanning',
      };
      onPathResult(results[resultIndex]);

      try {
        // Generate address for this type
        let address: string;

        switch (pathKey) {
          case 'bip84': {
            const { address: addr } = bitcoin.payments.p2wpkh({
              pubkey: publicKey,
              network,
            });
            address = addr!;
            break;
          }
          case 'bip49': {
            const p2wpkh = bitcoin.payments.p2wpkh({
              pubkey: publicKey,
              network,
            });
            const { address: addr } = bitcoin.payments.p2sh({
              redeem: p2wpkh,
              network,
            });
            address = addr!;
            break;
          }
          case 'bip44': {
            const { address: addr } = bitcoin.payments.p2pkh({
              pubkey: publicKey,
              network,
            });
            address = addr!;
            break;
          }
          case 'bip86': {
            // For Taproot, need x-only pubkey
            const xOnlyPubkey = publicKey.slice(1, 33);
            const { address: addr } = bitcoin.payments.p2tr({
              internalPubkey: xOnlyPubkey,
              network,
            });
            address = addr!;
            break;
          }
          default:
            throw new Error(`Unknown path: ${pathKey}`);
        }

        // Query Electrum
        const electrum = ElectrumAPI.shared('mainnet');
        const singleResult = await electrum.syncWalletLight([address]);

        if (!singleResult.ok) {
          throw new Error(singleResult.error);
        }

        const { balance, historyMap } = singleResult;

        // Count activity
        let usedAddressCount = 0;
        for (const [, history] of historyMap) {
          if (history && history.length > 0) {
            usedAddressCount = 1;
            break;
          }
        }

        results[resultIndex] = {
          path: pathKey,
          label: pathInfo.label,
          addressPrefix: pathInfo.addressPrefix,
          status: 'complete',
          balanceSats: balance.total,
          usedAddressCount,
          firstUsedAddress: usedAddressCount > 0 ? address : undefined,
          firstAddress: address,
        };

        totalBalanceSats += balance.total;
        if (usedAddressCount > 0 || balance.total > 0) {
          hasActivity = true;
        }

        safeLog(`PathDiscovery WIF: ${pathKey} complete, balance=${balance.total}`);
      } catch (error) {
        results[resultIndex] = {
          ...results[resultIndex],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        safeLog(`PathDiscovery WIF: ${pathKey} error: ${error}`);
      }

      onPathResult(results[resultIndex]);
    }

    const isComplete = results.every(r => r.status === 'complete' || r.status === 'error');

    return {
      paths: results,
      hasActivity,
      totalBalanceSats,
      isComplete,
    };
  }
}

/**
 * Helper to derive addresses from an xprv node based on its depth
 */
function deriveAddressesFromXprv(
  node: BIP32Interface,
  addressType: AddressType,
  count: number
): Array<{ address: string; index: number }> {
  const network = bitcoin.networks.bitcoin;
  const addresses: Array<{ address: string; index: number }> = [];

  // Determine purpose based on address type
  let purpose: number;
  switch (addressType) {
    case ADDRESS_TYPES.LEGACY:
      purpose = 44;
      break;
    case ADDRESS_TYPES.WRAPPED_SEGWIT:
      purpose = 49;
      break;
    case ADDRESS_TYPES.NATIVE_SEGWIT:
      purpose = 84;
      break;
    case ADDRESS_TYPES.TAPROOT:
      purpose = 86;
      break;
    default:
      purpose = 84;
  }

  // Derive based on depth
  // depth 0 = master key (m)
  // depth 1 = purpose level (m/purpose')
  // depth 2 = coin type level (m/purpose'/coin')
  // depth 3 = account level (m/purpose'/coin'/account')
  // depth 4 = chain level (m/purpose'/coin'/account'/chain)

  let chainNode: BIP32Interface;

  try {
    switch (node.depth) {
      case 0:
        // Master key - derive full path
        chainNode = node
          .deriveHardened(purpose)
          .deriveHardened(0) // coin type
          .deriveHardened(0) // account
          .derive(0); // external chain
        break;
      case 1:
        // Purpose level - derive coin/account/chain
        chainNode = node
          .deriveHardened(0)
          .deriveHardened(0)
          .derive(0);
        break;
      case 2:
        // Coin level - derive account/chain
        chainNode = node
          .deriveHardened(0)
          .derive(0);
        break;
      case 3:
        // Account level - derive chain only
        chainNode = node.derive(0);
        break;
      case 4:
        // Chain level - use directly
        chainNode = node;
        break;
      default:
        // Deeper - use directly
        chainNode = node;
    }
  } catch (e) {
    // If hardened derivation fails (e.g., from neutered node), fall back
    safeLog(`deriveAddressesFromXprv: hardened derivation failed, depth=${node.depth}`);
    try {
      chainNode = node.derive(0);
    } catch {
      chainNode = node;
    }
  }

  // Derive addresses
  for (let i = 0; i < count; i++) {
    const childNode = chainNode.derive(i);
    const pubkey = childNode.publicKey;

    let address: string;

    switch (addressType) {
      case ADDRESS_TYPES.NATIVE_SEGWIT: {
        const { address: addr } = bitcoin.payments.p2wpkh({
          pubkey: Buffer.from(pubkey),
          network,
        });
        address = addr!;
        break;
      }
      case ADDRESS_TYPES.WRAPPED_SEGWIT: {
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: Buffer.from(pubkey),
          network,
        });
        const { address: addr } = bitcoin.payments.p2sh({
          redeem: p2wpkh,
          network,
        });
        address = addr!;
        break;
      }
      case ADDRESS_TYPES.LEGACY: {
        const { address: addr } = bitcoin.payments.p2pkh({
          pubkey: Buffer.from(pubkey),
          network,
        });
        address = addr!;
        break;
      }
      case ADDRESS_TYPES.TAPROOT: {
        const xOnlyPubkey = Buffer.from(pubkey.slice(1, 33));
        const { address: addr } = bitcoin.payments.p2tr({
          internalPubkey: xOnlyPubkey,
          network,
        });
        address = addr!;
        break;
      }
      default:
        throw new Error(`Unknown address type: ${addressType}`);
    }

    addresses.push({ address, index: i });
  }

  return addresses;
}
