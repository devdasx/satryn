/**
 * BIP38 Encrypted Key Parser
 *
 * BIP38 keys start with "6P" and are 58 base58 characters.
 * They require a password to decrypt using scrypt KDF.
 *
 * This parser validates the format and provides a decryption
 * function that uses scryptsy for key derivation.
 *
 * Note: scrypt is CPU-intensive (~10-30s on mobile). The UI should
 * show a progress indicator during decryption.
 *
 * MAINNET ONLY — validates address version bytes.
 */

import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import bs58check from 'bs58check';
import { sha256 } from '@noble/hashes/sha256';
import { createCipheriv, createDecipheriv } from 'browserify-cipher';
import type { ImportResult, SuggestedScriptType } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

/**
 * Validate that a string looks like a BIP38 encrypted key.
 * Does NOT decrypt — just validates format.
 *
 * @param key - Potential BIP38 key
 * @returns true if valid BIP38 format
 */
export function isBIP38(key: string): boolean {
  const trimmed = key.trim();
  if (!/^6P[1-9A-HJ-NP-Za-km-z]{56}$/.test(trimmed)) {
    return false;
  }

  try {
    const decoded = bs58check.decode(trimmed);
    // BIP38 keys decode to 39 bytes
    // First byte: 0x01, second byte: 0x42 (no EC multiply) or 0x43 (EC multiply)
    return decoded.length === 39 && decoded[0] === 0x01 && (decoded[1] === 0x42 || decoded[1] === 0x43);
  } catch {
    return false;
  }
}

/**
 * Decrypt a BIP38 encrypted key.
 *
 * WARNING: This is CPU-intensive due to scrypt (~10-30s on mobile).
 * Run in a background thread or show progress indicator.
 *
 * @param encryptedKey - BIP38 encrypted key (starts with 6P)
 * @param passphrase - Password to decrypt
 * @returns ImportResult with decrypted WIF
 * @throws ImportError if decryption fails
 */
export async function decryptBIP38(
  encryptedKey: string,
  passphrase: string,
  scriptType: SuggestedScriptType = 'native_segwit',
): Promise<ImportResult> {
  const trimmed = encryptedKey.trim();

  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(trimmed);
  } catch {
    throw new ImportError('INVALID_CHECKSUM', 'Invalid BIP38 key checksum');
  }

  if (decoded.length !== 39 || decoded[0] !== 0x01) {
    throw new ImportError('INVALID_FORMAT', 'Invalid BIP38 key format');
  }

  const flagByte = decoded[1];
  const isCompressed = (decoded[2] & 0x20) !== 0;

  if (flagByte === 0x42) {
    // No EC multiplication
    return decryptBIP38NoEC(decoded, passphrase, isCompressed, scriptType);
  } else if (flagByte === 0x43) {
    // EC multiplication — more complex, less common
    throw new ImportError('ENCRYPTED_UNSUPPORTED', 'BIP38 EC-multiply keys are not yet supported. Use a desktop wallet to decrypt first.');
  }

  throw new ImportError('INVALID_FORMAT', 'Unrecognized BIP38 flag byte');
}

/**
 * BIP38 decryption without EC multiplication.
 * This is the standard case (flag byte 0x42).
 */
async function decryptBIP38NoEC(
  decoded: Uint8Array,
  passphrase: string,
  compressed: boolean,
  scriptType: SuggestedScriptType,
): Promise<ImportResult> {
  const addressHash = decoded.slice(3, 7);
  const encrypted1 = decoded.slice(7, 23);  // 16 bytes
  const encrypted2 = decoded.slice(23, 39); // 16 bytes

  // Derive key using scrypt
  let scryptSync: any;
  try {
    scryptSync = require('scryptsy');
  } catch {
    throw new ImportError('ENCRYPTED_UNSUPPORTED', 'BIP38 decryption requires the scryptsy package. Please install it first.');
  }

  safeLog('decryptBIP38: running scrypt KDF (this may take a while)...');

  const passphraseBuffer = Buffer.from(passphrase, 'utf8');
  const derivedKey = scryptSync(passphraseBuffer, Buffer.from(addressHash), 16384, 8, 8, 64);

  const derivedHalf1 = derivedKey.slice(0, 32);
  const derivedHalf2 = derivedKey.slice(32, 64);

  // Decrypt with AES-256-ECB
  const decipher1 = createDecipheriv('aes-256-ecb', derivedHalf2, Buffer.alloc(0));
  decipher1.setAutoPadding(false);
  const decrypted1 = Buffer.concat([decipher1.update(Buffer.from(encrypted1)), decipher1.final()]);

  const decipher2 = createDecipheriv('aes-256-ecb', derivedHalf2, Buffer.alloc(0));
  decipher2.setAutoPadding(false);
  const decrypted2 = Buffer.concat([decipher2.update(Buffer.from(encrypted2)), decipher2.final()]);

  // XOR with derived key
  const privateKey = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) {
    privateKey[i] = decrypted1[i] ^ derivedHalf1[i];
    privateKey[i + 16] = decrypted2[i] ^ derivedHalf1[i + 16];
  }

  // Verify by deriving address and checking against addressHash
  const keyPair = ECPair.fromPrivateKey(privateKey, {
    compressed,
    network: bitcoin.networks.bitcoin,
  });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network: bitcoin.networks.bitcoin,
  });

  if (!address) {
    throw new ImportError('WRONG_PASSWORD', 'Decryption produced invalid key');
  }

  // Double SHA256 of address, take first 4 bytes
  const addressBytes = Buffer.from(address, 'utf8');
  const hash1 = sha256(addressBytes);
  const hash2 = sha256(hash1);

  // Compare with addressHash
  if (hash2[0] !== addressHash[0] || hash2[1] !== addressHash[1] ||
      hash2[2] !== addressHash[2] || hash2[3] !== addressHash[3]) {
    throw new ImportError('WRONG_PASSWORD', 'Wrong password');
  }

  safeLog('decryptBIP38: decryption successful');

  const wif = keyPair.toWIF();

  // Derive preview address for the selected script type
  let previewAddress: string | undefined;
  try {
    const pubkey = keyPair.publicKey;
    const network = bitcoin.networks.bitcoin;
    switch (scriptType) {
      case 'native_segwit':
        previewAddress = bitcoin.payments.p2wpkh({ pubkey, network }).address;
        break;
      case 'wrapped_segwit': {
        const p = bitcoin.payments.p2wpkh({ pubkey, network });
        previewAddress = bitcoin.payments.p2sh({ redeem: p, network }).address;
        break;
      }
      case 'legacy':
        previewAddress = address;
        break;
      case 'taproot': {
        const xOnly = pubkey.subarray(1, 33);
        previewAddress = bitcoin.payments.p2tr({ internalPubkey: xOnly, network }).address;
        break;
      }
    }
  } catch {
    previewAddress = address;
  }

  return {
    type: 'single_key',
    sourceFormat: 'bip38_encrypted',
    privateKeyWIF: wif,
    compressed,
    suggestedScriptType: scriptType,
    suggestedName: 'BIP38 Key',
    previewAddress,
  };
}
