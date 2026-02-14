/**
 * Universal Import Format Detector
 *
 * Auto-detects the format of user input for wallet import.
 * Supports BIP39 mnemonics, WIF, hex, base64, decimal, mini keys,
 * extended keys, descriptors, and more.
 *
 * MAINNET ONLY — testnet formats are detected and flagged for rejection.
 * SECURITY: Detection labels never contain raw key material.
 */

import type { DetectionResult, ImportFormat } from './types';
import { looksLikeMnemonic, validateMnemonic, VALID_WORD_COUNTS } from './parsers/mnemonic';
import { safeLog } from './security';

/**
 * Detect the import format of a text input.
 * Returns null if the format is unrecognized.
 *
 * Detection order is designed to minimize false positives:
 * 1. Multi-word → mnemonic
 * 2. Known prefixes → WIF, BIP38, xprv, etc.
 * 3. Pattern matching → hex, base64, decimal
 * 4. Testnet rejection → clear error
 */
export function detectInputType(input: string): DetectionResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // ============================================
  // 1. BIP39 Mnemonic (space-separated words)
  // ============================================
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length >= 12 && looksLikeMnemonic(trimmed)) {
    const validation = validateMnemonic(trimmed);
    const wordCount = validation.wordCount;
    const isValidCount = (VALID_WORD_COUNTS as readonly number[]).includes(wordCount);

    return {
      format: 'bip39_mnemonic',
      confidence: validation.checksumValid ? 'definite' : isValidCount ? 'likely' : 'possible',
      label: validation.checksumValid
        ? `BIP39 Mnemonic (${wordCount} words)`
        : `Recovery Phrase (${wordCount} words)`,
      isMainnet: true, // BIP39 is network-agnostic; network determined at derivation
      wordCount,
    };
  }

  // ============================================
  // 2. Extended Private Keys (xprv, yprv, zprv, Yprv, Zprv)
  // ============================================
  // Mainnet xprv
  if (/^xprv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'xprv',
      confidence: 'definite',
      label: 'Extended Private Key (xprv)',
      isMainnet: true,
    };
  }
  // Mainnet yprv (BIP49 wrapped segwit)
  if (/^yprv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'yprv',
      confidence: 'definite',
      label: 'Extended Private Key (yprv) \u2022 Wrapped SegWit',
      isMainnet: true,
    };
  }
  // Mainnet zprv (BIP84 native segwit)
  if (/^zprv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'zprv',
      confidence: 'definite',
      label: 'Extended Private Key (zprv) \u2022 Native SegWit',
      isMainnet: true,
    };
  }
  // Mainnet Yprv (BIP49 multisig)
  if (/^Yprv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'Yprv',
      confidence: 'definite',
      label: 'Extended Private Key (Yprv) \u2022 Multisig Wrapped SegWit',
      isMainnet: true,
    };
  }
  // Mainnet Zprv (BIP84 multisig)
  if (/^Zprv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'Zprv',
      confidence: 'definite',
      label: 'Extended Private Key (Zprv) \u2022 Multisig Native SegWit',
      isMainnet: true,
    };
  }
  // Testnet extended private keys
  if (/^[tuv]prv[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'xprv',
      confidence: 'definite',
      label: 'Testnet Extended Key (not supported)',
      isMainnet: false,
    };
  }

  // ============================================
  // 2b. Extended Public Keys (xpub, ypub, zpub, Ypub, Zpub) — Watch-Only
  // ============================================
  // Mainnet xpub
  if (/^xpub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'xpub',
      confidence: 'definite',
      label: 'Extended Public Key (xpub) \u2022 Watch-Only',
      isMainnet: true,
      isWatchOnly: true,
    };
  }
  // Mainnet ypub (BIP49 wrapped segwit)
  if (/^ypub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'ypub',
      confidence: 'definite',
      label: 'Extended Public Key (ypub) \u2022 Watch-Only Wrapped SegWit',
      isMainnet: true,
      isWatchOnly: true,
    };
  }
  // Mainnet zpub (BIP84 native segwit)
  if (/^zpub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'zpub',
      confidence: 'definite',
      label: 'Extended Public Key (zpub) \u2022 Watch-Only Native SegWit',
      isMainnet: true,
      isWatchOnly: true,
    };
  }
  // Mainnet Ypub (BIP49 multisig)
  if (/^Ypub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'Ypub',
      confidence: 'definite',
      label: 'Extended Public Key (Ypub) \u2022 Multisig Watch-Only Wrapped SegWit',
      isMainnet: true,
      isWatchOnly: true,
    };
  }
  // Mainnet Zpub (BIP84 multisig)
  if (/^Zpub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'Zpub',
      confidence: 'definite',
      label: 'Extended Public Key (Zpub) \u2022 Multisig Watch-Only Native SegWit',
      isMainnet: true,
      isWatchOnly: true,
    };
  }
  // Testnet extended public keys
  if (/^[tuv]pub[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(trimmed)) {
    return {
      format: 'xpub',
      confidence: 'definite',
      label: 'Testnet Extended Public Key (not supported)',
      isMainnet: false,
      isWatchOnly: true,
    };
  }

  // ============================================
  // 3. WIF Mainnet Compressed (K or L prefix, 52 chars)
  // ============================================
  if (/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(trimmed)) {
    return {
      format: 'wif_compressed',
      confidence: 'definite',
      label: 'WIF Private Key (compressed)',
      isMainnet: true,
    };
  }

  // ============================================
  // 4. WIF Mainnet Uncompressed (5 prefix, 51 chars)
  // ============================================
  if (/^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(trimmed)) {
    return {
      format: 'wif_uncompressed',
      confidence: 'definite',
      label: 'WIF Private Key (uncompressed)',
      isMainnet: true,
    };
  }

  // ============================================
  // 5. Testnet WIF (c/9 prefix)
  // ============================================
  if (/^[c9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) {
    return {
      format: 'wif_compressed',
      confidence: 'likely',
      label: 'Testnet WIF Key (not supported)',
      isMainnet: false,
    };
  }

  // ============================================
  // 6. BIP38 Encrypted (6P prefix, 58 chars)
  // ============================================
  if (/^6P[1-9A-HJ-NP-Za-km-z]{56}$/.test(trimmed)) {
    return {
      format: 'bip38_encrypted',
      confidence: 'definite',
      label: 'BIP38 Encrypted Key',
      isMainnet: true,
      needsPassword: true,
    };
  }

  // ============================================
  // 7. Mini Private Key (S prefix, 22 or 30 chars)
  // ============================================
  if (/^S[1-9A-HJ-NP-Za-km-z]{21}$/.test(trimmed) || /^S[1-9A-HJ-NP-Za-km-z]{29}$/.test(trimmed)) {
    return {
      format: 'mini_privkey',
      confidence: 'likely',
      label: 'Mini Private Key',
      isMainnet: true,
    };
  }

  // ============================================
  // 8. Hex (64 hex chars — could be private key or 32-byte seed)
  // ============================================
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return {
      format: 'hex_privkey',
      confidence: 'likely',
      label: 'Hex Private Key (32 bytes)',
      isMainnet: true,
      alternatives: ['seed_bytes_hex'],
    };
  }

  // ============================================
  // 9. Hex seed (128 hex chars = 64 bytes, typical BIP39 seed)
  // ============================================
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    return {
      format: 'seed_bytes_hex',
      confidence: 'likely',
      label: 'Seed Bytes (64 bytes hex)',
      isMainnet: true,
    };
  }

  // ============================================
  // 10. Base64 (44 chars with padding → 32 bytes)
  // ============================================
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    return {
      format: 'base64_privkey',
      confidence: 'possible',
      label: 'Base64 Private Key (32 bytes)',
      isMainnet: true,
    };
  }

  // ============================================
  // 11. Decimal integer (large number, 10-78 digits)
  // ============================================
  if (/^\d{10,78}$/.test(trimmed)) {
    return {
      format: 'decimal_privkey',
      confidence: 'possible',
      label: 'Decimal Private Key',
      isMainnet: true,
    };
  }

  // ============================================
  // 12. PEM format (SEC1 or PKCS#8)
  // ============================================
  if (trimmed.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return {
      format: 'sec1_pem',
      confidence: 'definite',
      label: 'SEC1 EC Private Key (PEM)',
      isMainnet: true,
    };
  }
  if (trimmed.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    return {
      format: 'pkcs8_encrypted',
      confidence: 'definite',
      label: 'PKCS#8 Encrypted Private Key (PEM)',
      isMainnet: true,
      needsPassword: true,
    };
  }
  if (trimmed.includes('-----BEGIN PRIVATE KEY-----')) {
    return {
      format: 'pkcs8_pem',
      confidence: 'definite',
      label: 'PKCS#8 Private Key (PEM)',
      isMainnet: true,
    };
  }

  // ============================================
  // 13. Descriptor set (contains descriptor keywords)
  // ============================================
  if (
    trimmed.includes('wpkh(') ||
    trimmed.includes('pkh(') ||
    trimmed.includes('sh(wpkh(') ||
    trimmed.includes('tr(') ||
    trimmed.includes('wsh(')
  ) {
    const hasPrivKey = trimmed.includes('xprv') || trimmed.includes('tprv') ||
      /[5KL][1-9A-HJ-NP-Za-km-z]{50,51}/.test(trimmed);
    return {
      format: 'descriptor_set',
      confidence: 'likely',
      label: hasPrivKey ? 'Output Descriptor (with private key)' : 'Output Descriptor',
      isMainnet: !trimmed.includes('tprv'),
    };
  }

  // ============================================
  // 14. UR format
  // ============================================
  const upperTrimmed = trimmed.toUpperCase();
  if (upperTrimmed.startsWith('UR:CRYPTO-HDKEY/')) {
    return { format: 'ur_crypto_hdkey', confidence: 'definite', label: 'UR: HD Key', isMainnet: true };
  }
  if (upperTrimmed.startsWith('UR:CRYPTO-ECKEY/')) {
    return { format: 'ur_crypto_eckey', confidence: 'definite', label: 'UR: EC Key', isMainnet: true };
  }
  if (upperTrimmed.startsWith('UR:CRYPTO-SEED/')) {
    return { format: 'ur_crypto_seed', confidence: 'definite', label: 'UR: Seed', isMainnet: true };
  }

  safeLog('detectInputType: no format detected for input of length', trimmed.length);
  return null;
}

/**
 * Detect the format of file content.
 * Used for file imports (dumpwallet, wallet.dat, Electrum JSON, binary seed).
 *
 * @param content - File content as string or Uint8Array
 * @param fileName - Original file name for format hints
 */
export function detectFileType(
  content: string | Uint8Array,
  fileName?: string
): DetectionResult | null {
  // Binary content
  if (content instanceof Uint8Array) {
    // wallet.dat detection (Berkeley DB magic bytes)
    if (content.length > 16 && content[0] === 0x00 && content[1] === 0x00) {
      return {
        format: 'wallet_dat',
        confidence: 'possible',
        label: 'Bitcoin Core Wallet File',
        isMainnet: true,
      };
    }

    // Raw 32-byte private key
    if (content.length === 32) {
      return {
        format: 'raw_binary_32',
        confidence: 'possible',
        label: 'Raw Private Key (32 bytes)',
        isMainnet: true,
      };
    }

    // Raw seed bytes
    if (content.length === 64) {
      return {
        format: 'seed_bytes_binary',
        confidence: 'possible',
        label: 'Seed Bytes (64 bytes)',
        isMainnet: true,
      };
    }

    return null;
  }

  // String content
  const text = content.trim();

  // Electrum JSON wallet
  try {
    const json = JSON.parse(text);
    if (json.keystore || json.seed || json.wallet_type) {
      return {
        format: 'electrum_json',
        confidence: 'definite',
        label: 'Electrum Wallet File',
        isMainnet: true,
      };
    }
    // Bitcoin Core listdescriptors JSON
    if (json.descriptors && Array.isArray(json.descriptors)) {
      return {
        format: 'descriptor_set',
        confidence: 'definite',
        label: 'Bitcoin Core Descriptors',
        isMainnet: true,
      };
    }
  } catch {
    // Not JSON, continue checking
  }

  // dumpwallet format (lines starting with WIF keys)
  const lines = text.split('\n');
  const wifLines = lines.filter((l) => /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\s/.test(l.trim()));
  if (wifLines.length > 0 && lines.some((l) => l.startsWith('# Wallet dump'))) {
    return {
      format: 'dumpwallet',
      confidence: 'definite',
      label: `Bitcoin Core Wallet Dump (${wifLines.length} keys)`,
      isMainnet: true,
    };
  }

  // Fall back to text detection
  return detectInputType(text);
}
