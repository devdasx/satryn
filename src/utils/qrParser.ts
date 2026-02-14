/**
 * QR Code Parsing Utilities for Import Screens
 * Handles parsing of QR codes for xpub, descriptors, and addresses
 */

// Mainnet xpub prefixes
const XPUB_PREFIXES = ['xpub', 'ypub', 'zpub'];
const XPRV_PREFIXES = ['xprv', 'yprv', 'zprv'];

// Bitcoin address patterns
const ADDRESS_PATTERNS = {
  legacy: /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/,        // P2PKH
  p2sh: /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/,          // P2SH
  nativeSegwit: /^bc1q[a-z0-9]{38,58}$/i,          // P2WPKH
  taproot: /^bc1p[a-z0-9]{58}$/i,                  // P2TR
};

// Descriptor type patterns
const DESCRIPTOR_TYPES = ['wpkh(', 'sh(wpkh(', 'pkh(', 'tr(', 'wsh(', 'sh('];

export interface XpubParseResult {
  success: boolean;
  data?: string;
  error?: string;
  isPrivateKey?: boolean;
}

export interface DescriptorParseResult {
  success: boolean;
  data?: string;
  error?: string;
  missingChecksum?: boolean;
  invalidChecksum?: boolean;
}

export interface AddressParseResult {
  success: boolean;
  addresses?: string[];
  error?: string;
}

/**
 * Check if text looks like a seed phrase (12 or 24 words)
 */
const looksLikeSeedPhrase = (text: string): boolean => {
  const words = text.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  return words.length === 12 || words.length === 24;
};

/**
 * Check if text is a private key (xprv/yprv/zprv)
 */
const isPrivateKey = (text: string): boolean => {
  const lower = text.trim().toLowerCase();
  return XPRV_PREFIXES.some(prefix => lower.startsWith(prefix));
};

/**
 * Extract xpub from various QR formats
 * - Direct xpub/ypub/zpub
 * - Bitcoin URI with xpub
 * - Export payloads containing xpub
 */
export function parseXpubQR(data: string): XpubParseResult {
  const trimmed = data.trim();

  // Check for seed phrase
  if (looksLikeSeedPhrase(trimmed)) {
    return {
      success: false,
      error: 'This looks like a seed phrase. Paste an xpub/ypub/zpub instead.',
      isPrivateKey: true,
    };
  }

  // Check for private key
  if (isPrivateKey(trimmed)) {
    return {
      success: false,
      error: 'This is a private key. Paste an xpub/ypub/zpub instead.',
      isPrivateKey: true,
    };
  }

  // Direct xpub/ypub/zpub
  const prefix = trimmed.substring(0, 4).toLowerCase();
  if (XPUB_PREFIXES.includes(prefix)) {
    // Basic length check
    if (trimmed.length >= 100 && trimmed.length <= 120) {
      return { success: true, data: trimmed };
    }
    return {
      success: false,
      error: 'Invalid extended public key. Check the format and try again.',
    };
  }

  // Try to extract xpub from URI or payload
  // Common formats:
  // - bitcoin:?xpub=xpub...
  // - {"xpub": "xpub..."}
  // - xpub:xpub...

  // Check for bitcoin: URI with xpub param
  if (trimmed.toLowerCase().startsWith('bitcoin:')) {
    const xpubMatch = trimmed.match(/[?&]xpub=([xyzXYZ]pub[a-zA-Z0-9]+)/i);
    if (xpubMatch && xpubMatch[1]) {
      return { success: true, data: xpubMatch[1] };
    }
  }

  // Check for JSON format
  try {
    const json = JSON.parse(trimmed);
    if (json.xpub || json.ypub || json.zpub) {
      const xpub = json.xpub || json.ypub || json.zpub;
      if (typeof xpub === 'string' && xpub.length >= 100) {
        return { success: true, data: xpub };
      }
    }
    // Check for nested structures
    if (json.extendedPublicKey || json.extended_public_key) {
      const xpub = json.extendedPublicKey || json.extended_public_key;
      if (typeof xpub === 'string' && xpub.length >= 100) {
        return { success: true, data: xpub };
      }
    }
  } catch {
    // Not JSON, continue
  }

  // Look for xpub anywhere in the string
  const xpubRegex = /([xyzXYZ]pub[a-zA-Z0-9]{100,120})/;
  const match = trimmed.match(xpubRegex);
  if (match && match[1]) {
    return { success: true, data: match[1] };
  }

  return {
    success: false,
    error: 'No valid xpub/ypub/zpub found in QR code.',
  };
}

/**
 * Parse descriptor from QR code
 * Must include checksum (ends with #...)
 */
export function parseDescriptorQR(data: string): DescriptorParseResult {
  const trimmed = data.trim();

  // Check if it looks like a descriptor
  const lowerTrimmed = trimmed.toLowerCase();
  const isDescriptor = DESCRIPTOR_TYPES.some(type => lowerTrimmed.startsWith(type));

  if (!isDescriptor) {
    // Try to extract descriptor from JSON or URI
    try {
      const json = JSON.parse(trimmed);
      if (json.descriptor) {
        return parseDescriptorQR(json.descriptor);
      }
    } catch {
      // Not JSON
    }

    return {
      success: false,
      error: 'Descriptor not recognized. Check formatting.',
    };
  }

  // Check for checksum
  if (!trimmed.includes('#')) {
    return {
      success: false,
      error: 'Missing checksum. Paste a descriptor that ends with #…',
      missingChecksum: true,
    };
  }

  // Validate checksum format (should end with #8chars)
  const checksumMatch = trimmed.match(/#([a-z0-9]{8})$/i);
  if (!checksumMatch) {
    return {
      success: false,
      error: 'Checksum is invalid. Verify the descriptor source.',
      invalidChecksum: true,
    };
  }

  return { success: true, data: trimmed };
}

/**
 * Check if a string is a valid Bitcoin mainnet address
 */
export function isValidBitcoinAddress(address: string): boolean {
  const trimmed = address.trim();
  return (
    ADDRESS_PATTERNS.legacy.test(trimmed) ||
    ADDRESS_PATTERNS.p2sh.test(trimmed) ||
    ADDRESS_PATTERNS.nativeSegwit.test(trimmed) ||
    ADDRESS_PATTERNS.taproot.test(trimmed)
  );
}

/**
 * Extract address from bitcoin: URI
 */
function extractAddressFromUri(uri: string): string | null {
  // bitcoin:bc1q...?amount=0.001
  const match = uri.match(/^bitcoin:([13bc][a-zA-Z0-9]+)/i);
  if (match && match[1] && isValidBitcoinAddress(match[1])) {
    return match[1];
  }
  return null;
}

/**
 * Parse address(es) from QR code
 * Handles:
 * - Single address
 * - bitcoin: URI
 * - Multiple addresses (newline separated)
 */
export function parseAddressQR(data: string): AddressParseResult {
  const trimmed = data.trim();

  // Check for bitcoin: URI
  if (trimmed.toLowerCase().startsWith('bitcoin:')) {
    const address = extractAddressFromUri(trimmed);
    if (address) {
      return { success: true, addresses: [address] };
    }
    return {
      success: false,
      error: 'Could not extract address from Bitcoin URI.',
    };
  }

  // Check for single address
  if (isValidBitcoinAddress(trimmed)) {
    return { success: true, addresses: [trimmed] };
  }

  // Check for multiple addresses (newline separated)
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const validAddresses: string[] = [];

  for (const line of lines) {
    // Each line could be a bitcoin: URI or plain address
    if (line.toLowerCase().startsWith('bitcoin:')) {
      const addr = extractAddressFromUri(line);
      if (addr) validAddresses.push(addr);
    } else if (isValidBitcoinAddress(line)) {
      validAddresses.push(line);
    }
  }

  // Deduplicate
  const uniqueAddresses = [...new Set(validAddresses)];

  if (uniqueAddresses.length > 0) {
    return { success: true, addresses: uniqueAddresses };
  }

  return {
    success: false,
    error: 'No valid Bitcoin addresses found in QR code.',
  };
}
