/**
 * Descriptor Parser
 *
 * Parses Bitcoin Core `listdescriptors true` JSON output and
 * individual descriptor strings containing private keys.
 *
 * Supports:
 *   - wpkh() — Native SegWit
 *   - sh(wpkh()) — Wrapped SegWit
 *   - pkh() — Legacy
 *   - tr() — Taproot
 *
 * Extracts xprv from key expressions and identifies internal/external chains.
 *
 * MAINNET ONLY — rejects tprv-based descriptors.
 */

import type { ImportResult, ParsedDescriptor, SuggestedScriptType } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

/**
 * Parse a Bitcoin Core `listdescriptors true` JSON export.
 *
 * @param text - JSON text from `bitcoin-cli listdescriptors true`
 * @returns ImportResult with extracted descriptors and xprv
 */
export function parseDescriptorExport(text: string): ImportResult {
  const trimmed = text.trim();

  // Try JSON parse first (Bitcoin Core listdescriptors output)
  let descriptorStrings: string[] = [];
  let isJson = false;

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed.descriptors && Array.isArray(parsed.descriptors)) {
      // Bitcoin Core format: { "wallet_name": "...", "descriptors": [...] }
      descriptorStrings = parsed.descriptors.map((d: any) => {
        if (typeof d === 'string') return d;
        if (d.desc) return d.desc;
        return '';
      }).filter((s: string) => s.length > 0);
      isJson = true;
    } else if (Array.isArray(parsed)) {
      // Simple array of descriptor strings
      descriptorStrings = parsed.filter((s: any) => typeof s === 'string');
      isJson = true;
    }
  } catch {
    // Not JSON — try line-by-line
  }

  if (!isJson) {
    // Parse as line-separated descriptors
    descriptorStrings = trimmed
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
  }

  if (descriptorStrings.length === 0) {
    throw new ImportError('INVALID_FORMAT', 'No descriptors found');
  }

  // Parse each descriptor
  const parsedDescriptors: ParsedDescriptor[] = [];
  let primaryXprv: string | undefined;
  let primaryScriptType: SuggestedScriptType = 'native_segwit';
  let fingerprint: string | undefined;

  for (const desc of descriptorStrings) {
    try {
      const parsed = parseSingleDescriptor(desc);
      parsedDescriptors.push(parsed);

      // Track the first external descriptor with private key as primary
      if (!primaryXprv && parsed.hasPrivateKey && parsed.xprv && !parsed.isInternal) {
        primaryXprv = parsed.xprv;
        primaryScriptType = mapDescriptorScriptType(parsed.scriptType);
        fingerprint = parsed.fingerprint;
      }
    } catch {
      // Skip unparseable descriptors
      safeLog('descriptor: skipping unparseable descriptor');
    }
  }

  if (parsedDescriptors.length === 0) {
    throw new ImportError('INVALID_FORMAT', 'No valid descriptors found');
  }

  const hasPrivateKeys = parsedDescriptors.some(d => d.hasPrivateKey);
  if (!hasPrivateKeys) {
    throw new ImportError('NO_PRIVATE_KEYS', 'No private keys found in descriptors. This appears to be a watch-only export.');
  }

  safeLog(`parseDescriptorExport: ${parsedDescriptors.length} descriptors, ${hasPrivateKeys ? 'has' : 'no'} private keys`);

  return {
    type: 'hd',
    sourceFormat: 'descriptor_set',
    xprv: primaryXprv,
    descriptors: parsedDescriptors,
    suggestedScriptType: primaryScriptType,
    suggestedName: 'Imported Descriptors',
    fingerprint,
  };
}

/**
 * Parse a single descriptor string.
 * Extracts script type, key material, and derivation path.
 */
function parseSingleDescriptor(desc: string): ParsedDescriptor {
  // Strip checksum if present (everything after #)
  const withoutChecksum = desc.replace(/#[a-z0-9]+$/, '').trim();

  // Detect script type
  let scriptType: ParsedDescriptor['scriptType'];
  if (withoutChecksum.startsWith('wpkh(')) {
    scriptType = 'wpkh';
  } else if (withoutChecksum.startsWith('sh(wpkh(')) {
    scriptType = 'sh(wpkh)';
  } else if (withoutChecksum.startsWith('pkh(')) {
    scriptType = 'pkh';
  } else if (withoutChecksum.startsWith('tr(')) {
    scriptType = 'tr';
  } else {
    throw new Error('Unknown descriptor type');
  }

  // Detect internal (change) descriptor
  const isInternal = withoutChecksum.includes('/1/*') || withoutChecksum.includes('/1/*)');

  // Extract xprv if present
  const xprvMatch = withoutChecksum.match(/xprv[A-Za-z0-9]+/);
  const hasPrivateKey = !!xprvMatch;
  const xprv = xprvMatch ? xprvMatch[0] : undefined;

  // Reject testnet
  if (withoutChecksum.includes('tprv') || withoutChecksum.includes('uprv') || withoutChecksum.includes('vprv')) {
    throw new ImportError('TESTNET_REJECTED', 'Testnet descriptors are not supported');
  }

  // Extract fingerprint
  const fpMatch = withoutChecksum.match(/\[([0-9a-fA-F]{8})/);
  const fp = fpMatch ? fpMatch[1] : undefined;

  // Extract derivation path
  const pathMatch = withoutChecksum.match(/\[[0-9a-fA-F]{8}(\/[^\]]+)\]/);
  const derivationPath = pathMatch ? `m${pathMatch[1]}` : undefined;

  return {
    raw: desc,
    scriptType,
    hasPrivateKey,
    xprv,
    fingerprint: fp,
    derivationPath,
    isInternal,
  };
}

function mapDescriptorScriptType(type: ParsedDescriptor['scriptType']): SuggestedScriptType {
  switch (type) {
    case 'wpkh': return 'native_segwit';
    case 'sh(wpkh)': return 'wrapped_segwit';
    case 'pkh': return 'legacy';
    case 'tr': return 'taproot';
    default: return 'native_segwit';
  }
}
