/**
 * Brainwallet Parser
 *
 * Derives a private key from a passphrase using SHA-256.
 * This is the original "brainwallet" scheme: privateKey = SHA256(passphrase).
 *
 * WARNING: Brainwallets are fundamentally insecure.
 * Simple passphrases are easily cracked. This is provided only for
 * recovering funds from existing brainwallets, NOT for creating new ones.
 *
 * MAINNET ONLY.
 */

import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import { sha256 } from '@noble/hashes/sha256';
import type { ImportResult, SuggestedScriptType } from '../types';
import { ImportError } from '../types';
import { safeLog } from '../security';

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

// secp256k1 curve order
const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

/**
 * Derive a private key from a brainwallet passphrase.
 * Uses SHA-256(passphrase) as the private key.
 *
 * @param passphrase - The brainwallet passphrase
 * @param scriptType - Desired address type
 * @returns ImportResult with derived key
 * @throws ImportError if key is invalid
 */
export function parseBrainwallet(
  passphrase: string,
  scriptType: SuggestedScriptType = 'native_segwit',
): ImportResult {
  if (!passphrase || passphrase.length === 0) {
    throw new ImportError('INVALID_FORMAT', 'Passphrase cannot be empty');
  }

  // SHA-256 hash of the passphrase
  const privateKey = sha256(Buffer.from(passphrase, 'utf8'));

  // Validate on curve
  const value = BigInt('0x' + Buffer.from(privateKey).toString('hex'));
  if (value === 0n || value >= SECP256K1_ORDER) {
    throw new ImportError('INVALID_KEY_ON_CURVE', 'Derived key is outside the valid range');
  }

  // Create key pair (compressed)
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey), {
    compressed: true,
    network: bitcoin.networks.bitcoin,
  });

  const wif = keyPair.toWIF();
  const pubkey = keyPair.publicKey;
  const network = bitcoin.networks.bitcoin;

  // Derive preview address
  let previewAddress: string | undefined;
  try {
    switch (scriptType) {
      case 'native_segwit':
        previewAddress = bitcoin.payments.p2wpkh({ pubkey, network }).address;
        break;
      case 'wrapped_segwit': {
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
        previewAddress = bitcoin.payments.p2sh({ redeem: p2wpkh, network }).address;
        break;
      }
      case 'legacy':
        previewAddress = bitcoin.payments.p2pkh({ pubkey, network }).address;
        break;
      case 'taproot': {
        const xOnly = pubkey.subarray(1, 33);
        previewAddress = bitcoin.payments.p2tr({ internalPubkey: xOnly, network }).address;
        break;
      }
    }
  } catch {
    // Fallback
    previewAddress = bitcoin.payments.p2wpkh({ pubkey, network }).address;
  }

  safeLog('parseBrainwallet: key derived successfully');

  return {
    type: 'single_key',
    sourceFormat: 'brainwallet',
    privateKeyWIF: wif,
    privateKeyBuffer: new Uint8Array(privateKey),
    compressed: true,
    suggestedScriptType: scriptType,
    suggestedName: 'Brainwallet',
    previewAddress,
  };
}
