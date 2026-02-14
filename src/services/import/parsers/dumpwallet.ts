/**
 * dumpwallet Parser
 *
 * Parses Bitcoin Core `dumpwallet` text output.
 * Extracts WIF private keys, labels, timestamps, and HD key paths.
 *
 * Format per line:
 *   WIF timestamp reserved_field addr=ADDRESS hdkeypath=PATH # label
 *
 * Comment lines start with # and may contain metadata:
 *   # * Created on YYYY-MM-DDT...
 *   # * Best block at time of backup was ...
 *   # extended private masterkey: xprv...
 *   # hdseed=1 ...
 *
 * MAINNET ONLY — validates WIF version byte 0x80.
 */

import type { ImportResult, ImportedKey } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

export interface DumpwalletResult {
  /** All extracted WIF keys */
  keys: ImportedKey[];
  /** HD master seed WIF if present */
  hdSeed?: string;
  /** Extended private master key if present in comments */
  extendedMasterKey?: string;
  /** Best block hash at time of dump */
  bestBlock?: string;
  /** Total number of keys found */
  totalKeys: number;
  /** Creation timestamp */
  createdAt?: string;
}

/**
 * Parse Bitcoin Core dumpwallet text output.
 *
 * @param text - Full dumpwallet output text
 * @returns Parsed keys and metadata
 * @throws ImportError if no valid keys found
 */
export function parseDumpwalletText(text: string): DumpwalletResult {
  const lines = text.split('\n');
  const keys: ImportedKey[] = [];
  let hdSeed: string | undefined;
  let extendedMasterKey: string | undefined;
  let bestBlock: string | undefined;
  let createdAt: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Comment / metadata lines
    if (trimmed.startsWith('#')) {
      // Check for extended master key
      const xprvMatch = trimmed.match(/extended private masterkey:\s*(xprv[A-Za-z0-9]+)/);
      if (xprvMatch) {
        extendedMasterKey = xprvMatch[1];
      }

      // Check for best block
      const blockMatch = trimmed.match(/Best block.*was\s+(\d+)\s+\(([0-9a-fA-F]+)\)/);
      if (blockMatch) {
        bestBlock = blockMatch[2];
      }

      // Check for creation time
      const timeMatch = trimmed.match(/Created on\s+(\S+)/);
      if (timeMatch) {
        createdAt = timeMatch[1];
      }

      continue;
    }

    // Key lines: WIF timestamp ...
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const wif = parts[0];

    // Validate WIF format (mainnet: starts with K, L, or 5)
    if (!/^[KL5][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(wif)) {
      // Check for testnet WIF
      if (/^[c9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(wif)) {
        // Skip testnet keys silently
        continue;
      }
      // Not a key line
      continue;
    }

    // Parse timestamp
    const timestamp = parseInt(parts[1], 10) || undefined;

    // Parse optional fields
    let address: string | undefined;
    let hdKeypath: string | undefined;
    let label: string | undefined;
    let isHdSeed = false;
    let isChange = false;

    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('addr=')) {
        address = part.substring(5);
      } else if (part.startsWith('hdkeypath=')) {
        hdKeypath = part.substring(10);
        // Check if it's a change address
        if (hdKeypath.includes('/1/')) {
          isChange = true;
        }
      } else if (part === 'hdseed=1') {
        isHdSeed = true;
      } else if (part === '#') {
        // Everything after # is label
        label = parts.slice(i + 1).join(' ');
        break;
      }
    }

    // Determine compression from WIF prefix
    const compressed = wif.startsWith('K') || wif.startsWith('L');

    const key: ImportedKey = {
      wif,
      compressed,
      timestamp,
      address,
      hdKeypath,
      label,
      isChange,
    };

    keys.push(key);

    if (isHdSeed) {
      hdSeed = wif;
    }
  }

  if (keys.length === 0) {
    throw new ImportError('NO_PRIVATE_KEYS', 'No valid mainnet keys found in dumpwallet output');
  }

  safeLog(`parseDumpwalletText: found ${keys.length} keys, hdSeed=${!!hdSeed}, xprv=${!!extendedMasterKey}`);

  return {
    keys,
    hdSeed,
    extendedMasterKey,
    bestBlock,
    totalKeys: keys.length,
    createdAt,
  };
}

/**
 * Parse dumpwallet text and return an ImportResult.
 *
 * @param text - Full dumpwallet output text
 */
export function parseDumpwallet(text: string): ImportResult {
  const result = parseDumpwalletText(text);

  // If we have an extended master key, prefer that
  if (result.extendedMasterKey) {
    return {
      type: 'hd',
      sourceFormat: 'dumpwallet',
      xprv: result.extendedMasterKey,
      keys: result.keys,
      suggestedScriptType: 'native_segwit',
      suggestedName: `Core Dump (${result.totalKeys} keys)`,
    };
  }

  // Otherwise, import as key set
  return {
    type: 'key_set',
    sourceFormat: 'dumpwallet',
    keys: result.keys,
    suggestedScriptType: 'native_segwit',
    suggestedName: `Core Dump (${result.totalKeys} keys)`,
    previewAddress: result.keys[0]?.address,
  };
}
