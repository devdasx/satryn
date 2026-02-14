/**
 * ImportedKeySigner - Signing support for single imported private keys (WIF)
 *
 * Unlike HD wallets which derive keys from a seed/xprv, imported key wallets
 * have a single private key that controls one address. This class provides
 * signing capabilities for such wallets.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory, { ECPairInterface } from 'ecpair';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';

// Initialize libraries
const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

export class ImportedKeySigner {
  private keyPair: ECPairInterface;
  private network: bitcoin.Network;
  private networkType: NetworkType;
  private address: string;
  private addressType: AddressType;

  /**
   * Create a signer from a WIF-encoded private key
   * @param wif - Wallet Import Format private key
   * @param addressType - Type of address this key controls
   * @param networkType - Network type
   */
  constructor(
    wif: string,
    addressType: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT,
    networkType: NetworkType = 'mainnet'
  ) {
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    // Parse WIF to get key pair
    this.keyPair = ECPair.fromWIF(wif, this.network);
    this.addressType = addressType;
    this.address = this.generateAddress(addressType);
  }

  /**
   * Generate the address for this key based on address type
   */
  private generateAddress(type: AddressType): string {
    const pubkey = Buffer.from(this.keyPair.publicKey);

    switch (type) {
      case ADDRESS_TYPES.TAPROOT: {
        // X-only pubkey for Taproot
        const xOnlyPubkey = pubkey.slice(1, 33);
        const { address } = bitcoin.payments.p2tr({
          internalPubkey: xOnlyPubkey,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2TR address');
        return address;
      }

      case ADDRESS_TYPES.NATIVE_SEGWIT: {
        const { address } = bitcoin.payments.p2wpkh({
          pubkey,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2WPKH address');
        return address;
      }

      case ADDRESS_TYPES.WRAPPED_SEGWIT: {
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey,
          network: this.network,
        });
        const { address } = bitcoin.payments.p2sh({
          redeem: p2wpkh,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2SH-P2WPKH address');
        return address;
      }

      case ADDRESS_TYPES.LEGACY: {
        const { address } = bitcoin.payments.p2pkh({
          pubkey,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2PKH address');
        return address;
      }

      default:
        throw new Error(`Unknown address type: ${type}`);
    }
  }

  /**
   * Get the address controlled by this key
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Get the address type
   */
  getAddressType(): AddressType {
    return this.addressType;
  }

  /**
   * Get the public key
   */
  getPublicKey(): Buffer {
    return Buffer.from(this.keyPair.publicKey);
  }

  /**
   * Get the network type
   */
  getNetworkType(): NetworkType {
    return this.networkType;
  }

  /**
   * Get the bitcoinjs network object
   */
  getNetwork(): bitcoin.Network {
    return this.network;
  }

  /**
   * Check if an address matches this key's address
   */
  ownsAddress(address: string): boolean {
    return this.address === address;
  }

  /**
   * Get the signing key pair for transaction signing
   * WARNING: This exposes the private key - use carefully
   */
  getSigningKeyPair(): {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    sign: (hash: Uint8Array) => Uint8Array;
  } {
    if (!this.keyPair.privateKey) {
      throw new Error('Private key not available');
    }

    return {
      publicKey: this.keyPair.publicKey,
      privateKey: this.keyPair.privateKey,
      sign: (hash: Uint8Array) => this.keyPair.sign(Buffer.from(hash)),
    };
  }

  /**
   * Get Taproot-specific key data for signing
   * Only valid for TAPROOT address type
   */
  getTaprootKeyPair(): {
    internalPubkey: Buffer;
    tweakedPubkey: Buffer;
    privateKey: Buffer;
    tweakedPrivateKey: Buffer;
    signSchnorr: (hash: Buffer) => Buffer;
  } {
    if (this.addressType !== ADDRESS_TYPES.TAPROOT) {
      throw new Error('getTaprootKeyPair() is only valid for Taproot addresses');
    }

    return this.getTaprootKeyPairFromRawKey();
  }

  /**
   * Get Taproot-specific key data for signing from the raw private key.
   * Unlike getTaprootKeyPair(), this works regardless of addressType —
   * used when the signer needs to sign a Taproot input even if the wallet's
   * preferred address type is different (e.g., native segwit).
   * All returned Buffers are copies, safe to zero without affecting the original key.
   */
  getTaprootKeyPairFromRawKey(): {
    internalPubkey: Buffer;
    tweakedPubkey: Buffer;
    privateKey: Buffer;
    tweakedPrivateKey: Buffer;
    signSchnorr: (hash: Buffer) => Buffer;
  } {
    if (!this.keyPair.privateKey) {
      throw new Error('Private key not available');
    }

    const privateKey = Buffer.from(this.keyPair.privateKey);
    const pubkey = Buffer.from(this.keyPair.publicKey);
    const internalPubkey = pubkey.slice(1, 33); // X-only

    // Check if pubkey has odd Y coordinate
    const isOdd = pubkey[0] === 0x03;

    // Compute tweak
    const tweak = bitcoin.crypto.taggedHash('TapTweak', internalPubkey);
    const tweakedResult = ecc.xOnlyPointAddTweak(internalPubkey, tweak);
    if (!tweakedResult) {
      throw new Error('Failed to tweak Taproot key');
    }

    const tweakedPubkey = Buffer.from(tweakedResult.xOnlyPubkey);

    // Compute tweaked private key
    let adjustedPrivateKey: Buffer = privateKey;
    if (isOdd) {
      const negated = ecc.privateNegate(privateKey);
      if (!negated) throw new Error('Private key negation failed');
      adjustedPrivateKey = Buffer.from(negated);
    }

    const added = ecc.privateAdd(adjustedPrivateKey, tweak);
    if (!added) throw new Error('Private key addition failed');
    const tweakedPrivateKey = Buffer.from(added);

    return {
      internalPubkey,
      tweakedPubkey,
      privateKey,
      tweakedPrivateKey,
      signSchnorr: (hash: Buffer): Buffer => {
        const sig = ecc.signSchnorr(hash, tweakedPrivateKey);
        return Buffer.from(sig);
      },
    };
  }

  /**
   * Get the redeem script for P2SH-P2WPKH (wrapped segwit)
   * Only valid for WRAPPED_SEGWIT address type
   */
  getRedeemScript(): Buffer {
    if (this.addressType !== ADDRESS_TYPES.WRAPPED_SEGWIT) {
      throw new Error('getRedeemScript() is only valid for Wrapped SegWit addresses');
    }

    return this.getRedeemScriptForKey();
  }

  /**
   * Get the redeem script for P2SH-P2WPKH from the raw public key.
   * Unlike getRedeemScript(), this works regardless of addressType —
   * used when signing a wrapped segwit input even if the wallet's
   * preferred address type is different.
   */
  getRedeemScriptForKey(): Buffer {
    const pubkey = Buffer.from(this.keyPair.publicKey);
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey,
      network: this.network,
    });

    if (!p2wpkh.output) {
      throw new Error('Failed to generate redeem script');
    }

    return Buffer.from(p2wpkh.output);
  }

  /**
   * Clear sensitive data from memory
   */
  destroy(): void {
    // Unfortunately we can't fully clear private keys in JS
    // but we can dereference for garbage collection
    (this as any).keyPair = null;
  }
}

export default ImportedKeySigner;
