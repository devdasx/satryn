/**
 * Universal Import Module
 *
 * Re-exports all import-related utilities for convenient access.
 */

// Types
export type {
  ImportFormat,
  DetectionResult,
  ImportResult,
  ImportResultType,
  SuggestedScriptType,
  ImportedKey,
  ParsedDescriptor,
  ImportErrorCode,
  ImportSection,
  WalletImportConfig,
} from './types';

export { ImportError } from './types';

// Detector
export { detectInputType, detectFileType } from './detector';

// Parsers
export {
  parseMnemonic,
  validateMnemonic,
  looksLikeMnemonic,
  isValidWord,
  getWordSuggestions,
  VALID_WORD_COUNTS,
} from './parsers/mnemonic';

export {
  parsePrivateKey,
  parseWIF,
  parseHexPrivateKey,
  parseDecimalPrivateKey,
  parseBase64PrivateKey,
  parseMiniPrivateKey,
} from './parsers/privateKey';

export {
  parseExtendedKey,
  parseExtendedPrivateKey,
  deriveAddressesFromXprv,
} from './parsers/extendedKey';

export {
  parseSeedBytes,
  parseSeedBytesHex,
  deriveAddressesFromSeed,
} from './parsers/seedBytes';

// Phase 3: Descriptors, dumpwallet, Electrum
export { parseDescriptorExport } from './parsers/descriptor';

export {
  parseDumpwallet,
  parseDumpwalletText,
} from './parsers/dumpwallet';

export {
  parseElectrumFile,
  parseElectrumWalletJson,
} from './parsers/electrumFile';

// Phase 4: BIP38, Brainwallet
export { isBIP38, decryptBIP38 } from './parsers/bip38';
export { parseBrainwallet } from './parsers/brainwallet';

// Security
export {
  getSecureInputProps,
  clearClipboard,
  zeroizeBuffer,
  zeroizeString,
  safeLog,
  safeLogError,
  maskSecret,
  mightBeSecret,
} from './security';
