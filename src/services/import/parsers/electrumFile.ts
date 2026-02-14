/**
 * Electrum JSON Wallet Parser
 *
 * Parses Electrum wallet JSON files exported from Electrum desktop.
 * Supports:
 *   - Seed-based wallets (standard and segwit seed types)
 *   - xprv-based keystores
 *   - Imported private key wallets
 *   - Watch-only detection (rejected with clear error)
 *
 * MAINNET ONLY — validates xprv prefixes.
 */

import type { ImportResult, ImportedKey } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

export interface ElectrumWalletInfo {
  /** Type of wallet detected */
  type: 'seed' | 'xprv' | 'imported_keys' | 'watch_only';
  /** Electrum seed phrase */
  seed?: string;
  /** Seed type (standard = BIP39-compatible, segwit = Electrum segwit) */
  seedType?: 'standard' | 'segwit';
  /** Extended private key */
  xprv?: string;
  /** Extended public key (watch-only wallets) */
  xpub?: string;
  /** Imported WIF keys */
  importedKeys?: string[];
  /** Wallet type string from Electrum */
  walletType?: string;
  /** Whether the wallet uses BIP39 */
  isBip39?: boolean;
}

/**
 * Parse an Electrum wallet JSON file.
 *
 * @param json - JSON string from Electrum wallet file
 * @returns Parsed wallet information
 * @throws ImportError for invalid/unsupported files
 */
export function parseElectrumWalletJson(json: string): ElectrumWalletInfo {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ImportError('FILE_PARSE_ERROR', 'Invalid JSON format');
  }

  // Detect Electrum wallet structure
  const walletType = data.wallet_type;

  // Check for seed in keystore
  const keystore = data.keystore || data.x1?.keystore || {};
  const seed = keystore.seed;
  const seedType = keystore.seed_type;
  const xprv = keystore.xprv;
  const isBip39 = keystore.passphrase === '' || keystore.bip39;

  // Check for imported keys
  const importedKeys: string[] = [];
  if (data.imported) {
    // Electrum imported format: { "address": "privkey:type", ... }
    for (const [, value] of Object.entries(data.imported)) {
      if (typeof value === 'string') {
        // Value can be "privkey:compressed" or just "privkey"
        const keyPart = (value as string).split(':')[0];
        if (/^[KL5][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(keyPart)) {
          importedKeys.push(keyPart);
        }
      }
    }
  }

  // Also check for keypairs in addresses
  if (data.addresses && typeof data.addresses === 'object') {
    for (const [, value] of Object.entries(data.addresses)) {
      if (typeof value === 'string' && /^[KL5][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value as string)) {
        importedKeys.push(value as string);
      }
    }
  }

  // Determine wallet type
  if (seed) {
    // Validate mainnet - check xprv prefix if available
    if (xprv && (xprv.startsWith('tprv') || xprv.startsWith('uprv') || xprv.startsWith('vprv'))) {
      throw new ImportError('TESTNET_REJECTED', 'Testnet Electrum wallets are not supported');
    }

    safeLog(`parseElectrumWalletJson: seed wallet, seedType=${seedType}, bip39=${isBip39}`);

    return {
      type: 'seed',
      seed,
      seedType: seedType === 'segwit' ? 'segwit' : 'standard',
      xprv,
      walletType,
      isBip39,
    };
  }

  if (xprv) {
    if (xprv.startsWith('tprv') || xprv.startsWith('uprv') || xprv.startsWith('vprv')) {
      throw new ImportError('TESTNET_REJECTED', 'Testnet Electrum wallets are not supported');
    }

    safeLog(`parseElectrumWalletJson: xprv wallet`);

    return {
      type: 'xprv',
      xprv,
      walletType,
    };
  }

  if (importedKeys.length > 0) {
    safeLog(`parseElectrumWalletJson: imported keys wallet, ${importedKeys.length} keys`);

    return {
      type: 'imported_keys',
      importedKeys,
      walletType,
    };
  }

  // Check if it's watch-only (xpub present, no private keys)
  const xpub = keystore.xpub || data.keystore?.xpub;
  if (xpub) {
    safeLog(`parseElectrumWalletJson: watch-only wallet (xpub detected)`);

    return {
      type: 'watch_only',
      walletType,
      xpub,
    };
  }

  throw new ImportError('INVALID_FORMAT', 'Could not identify wallet type in Electrum file');
}

/**
 * Parse Electrum wallet JSON and return an ImportResult.
 *
 * @param json - JSON string from Electrum wallet file
 */
export function parseElectrumFile(json: string): ImportResult {
  const info = parseElectrumWalletJson(json);

  switch (info.type) {
    case 'seed': {
      // If BIP39 seed, treat as mnemonic
      if (info.isBip39 || info.seedType === 'standard') {
        return {
          type: 'hd',
          sourceFormat: 'electrum_json',
          mnemonic: info.seed,
          xprv: info.xprv,
          suggestedScriptType: info.seedType === 'segwit' ? 'native_segwit' : 'native_segwit',
          suggestedName: 'Electrum Wallet',
        };
      }

      // Electrum-specific seed (not BIP39-compatible)
      return {
        type: 'hd',
        sourceFormat: 'electrum_json',
        mnemonic: info.seed,
        xprv: info.xprv,
        suggestedScriptType: 'native_segwit',
        suggestedName: 'Electrum Wallet',
      };
    }

    case 'xprv': {
      return {
        type: 'hd',
        sourceFormat: 'electrum_json',
        xprv: info.xprv,
        suggestedScriptType: 'native_segwit',
        suggestedName: 'Electrum xprv',
      };
    }

    case 'imported_keys': {
      const keys: ImportedKey[] = (info.importedKeys || []).map(wif => ({
        wif,
        compressed: wif.startsWith('K') || wif.startsWith('L'),
      }));

      if (keys.length === 1) {
        return {
          type: 'single_key',
          sourceFormat: 'electrum_json',
          privateKeyWIF: keys[0].wif,
          compressed: keys[0].compressed,
          suggestedScriptType: 'native_segwit',
          suggestedName: 'Electrum Key',
        };
      }

      return {
        type: 'key_set',
        sourceFormat: 'electrum_json',
        keys,
        suggestedScriptType: 'native_segwit',
        suggestedName: `Electrum (${keys.length} keys)`,
      };
    }

    case 'watch_only': {
      return {
        type: 'watch_only',
        sourceFormat: 'electrum_json',
        xpub: info.xpub,
        suggestedScriptType: 'native_segwit',
        suggestedName: 'Electrum Watch-Only',
      };
    }

    default:
      throw new ImportError('INVALID_FORMAT', 'Unsupported Electrum wallet type');
  }
}
