import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import { DERIVATION, BITCOIN_NETWORKS, ADDRESS_TYPES, BIP_PURPOSES } from '../../constants';
import type { AddressInfo, AddressType, BalanceInfo } from '../../types';

// Initialize BIP32 with secp256k1
const bip32 = BIP32Factory(ecc);

// Initialize bitcoinjs-lib with the ECC library
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

/**
 * Extended public key format detection
 */
interface XpubInfo {
  xpub: string;
  format: 'xpub' | 'ypub' | 'zpub' | 'tpub' | 'upub' | 'vpub';
  network: NetworkType;
  addressType: AddressType;
  purpose: number;
}

/**
 * Watch-Only Wallet
 * Supports creating watch-only wallets from:
 * - Extended public keys (xpub/ypub/zpub)
 * - Output descriptors
 * - Individual addresses
 *
 * Watch-only wallets can:
 * - Derive addresses
 * - Check balances
 * - Create unsigned transactions (PSBTs)
 *
 * Watch-only wallets cannot:
 * - Sign transactions
 * - Export private keys
 */
export class WatchOnlyWallet {
  private network: bitcoin.Network;
  private networkType: NetworkType;
  private accountNode: BIP32Interface | null = null;
  private xpub: string | null = null;
  private addressType: AddressType;
  private watchAddresses: string[] = [];
  private descriptor: string | null = null;

  private constructor(networkType: NetworkType, addressType: AddressType) {
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
    this.addressType = addressType;
  }

  /**
   * Create a watch-only wallet from an extended public key
   * Supports xpub, ypub, zpub (mainnet) and tpub, upub, vpub (testnet)
   */
  static fromExtendedPublicKey(xpub: string, networkType?: NetworkType): WatchOnlyWallet {
    const xpubInfo = WatchOnlyWallet.parseXpub(xpub);
    const network = networkType || xpubInfo.network;

    const wallet = new WatchOnlyWallet(network, xpubInfo.addressType);

    // Convert to standard xpub/tpub format for BIP32 parsing
    const standardXpub = WatchOnlyWallet.convertToStandardFormat(xpub, network);

    const bitcoinNetwork = network === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    wallet.accountNode = bip32.fromBase58(standardXpub, bitcoinNetwork);
    wallet.xpub = xpub;

    return wallet;
  }

  /**
   * Create a watch-only wallet from an output descriptor
   * Supported formats: wpkh(), sh(wpkh()), pkh(), tr()
   */
  static fromDescriptor(descriptor: string, networkType: NetworkType = 'mainnet'): WatchOnlyWallet {
    const parsed = WatchOnlyWallet.parseDescriptor(descriptor);

    const wallet = new WatchOnlyWallet(networkType, parsed.addressType);
    wallet.descriptor = descriptor;

    if (parsed.xpub) {
      const standardXpub = WatchOnlyWallet.convertToStandardFormat(parsed.xpub, networkType);
      const bitcoinNetwork = networkType === 'mainnet'
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;
      wallet.accountNode = bip32.fromBase58(standardXpub, bitcoinNetwork);
      wallet.xpub = parsed.xpub;
    }

    return wallet;
  }

  /**
   * Create a watch-only wallet from individual addresses
   * This type cannot derive new addresses
   */
  static fromAddresses(addresses: string[], networkType: NetworkType = 'mainnet'): WatchOnlyWallet {
    if (addresses.length === 0) {
      throw new Error('At least one address is required');
    }

    // Detect address type from first address
    const addressType = WatchOnlyWallet.detectAddressType(addresses[0]) || ADDRESS_TYPES.NATIVE_SEGWIT;

    const wallet = new WatchOnlyWallet(networkType, addressType);
    wallet.watchAddresses = [...addresses];

    return wallet;
  }

  /**
   * Parse extended public key and detect format
   */
  static parseXpub(xpub: string): XpubInfo {
    // Version byte prefixes
    const FORMATS: Record<string, { network: NetworkType; addressType: AddressType; purpose: number }> = {
      'xpub': { network: 'mainnet', addressType: ADDRESS_TYPES.LEGACY, purpose: BIP_PURPOSES.BIP44 },
      'ypub': { network: 'mainnet', addressType: ADDRESS_TYPES.WRAPPED_SEGWIT, purpose: BIP_PURPOSES.BIP49 },
      'zpub': { network: 'mainnet', addressType: ADDRESS_TYPES.NATIVE_SEGWIT, purpose: BIP_PURPOSES.BIP84 },
      'tpub': { network: 'testnet', addressType: ADDRESS_TYPES.LEGACY, purpose: BIP_PURPOSES.BIP44 },
      'upub': { network: 'testnet', addressType: ADDRESS_TYPES.WRAPPED_SEGWIT, purpose: BIP_PURPOSES.BIP49 },
      'vpub': { network: 'testnet', addressType: ADDRESS_TYPES.NATIVE_SEGWIT, purpose: BIP_PURPOSES.BIP84 },
    };

    const prefix = xpub.slice(0, 4);
    const formatInfo = FORMATS[prefix];

    if (!formatInfo) {
      throw new Error(`Unknown extended public key format: ${prefix}`);
    }

    return {
      xpub,
      format: prefix as XpubInfo['format'],
      ...formatInfo,
    };
  }

  /**
   * Convert special format xpub (ypub/zpub/etc) to standard xpub/tpub
   */
  static convertToStandardFormat(xpub: string, network: NetworkType): string {
    const VERSION_BYTES: Record<string, Buffer> = {
      // Mainnet
      xpub: Buffer.from('0488b21e', 'hex'),
      ypub: Buffer.from('049d7cb2', 'hex'),
      zpub: Buffer.from('04b24746', 'hex'),
      // Testnet
      tpub: Buffer.from('043587cf', 'hex'),
      upub: Buffer.from('044a5262', 'hex'),
      vpub: Buffer.from('045f1cf6', 'hex'),
    };

    const STANDARD_VERSION = network === 'mainnet'
      ? VERSION_BYTES.xpub
      : VERSION_BYTES.tpub;

    const prefix = xpub.slice(0, 4);

    // Already standard format
    if (prefix === 'xpub' || prefix === 'tpub') {
      return xpub;
    }

    // Decode and replace version bytes
    const data = bs58check.decode(xpub);
    const newData = Buffer.concat([STANDARD_VERSION, data.slice(4)]);
    return bs58check.encode(newData);
  }

  /**
   * Parse an output descriptor
   * Supports: wpkh(), sh(wpkh()), pkh(), tr()
   */
  static parseDescriptor(descriptor: string): {
    addressType: AddressType;
    xpub: string | null;
    fingerprint: string | null;
    derivationPath: string | null;
    isRange: boolean;
  } {
    // Remove checksum if present
    const descriptorBody = descriptor.includes('#')
      ? descriptor.split('#')[0]
      : descriptor;

    let addressType: AddressType;
    let match: RegExpMatchArray | null;

    // Taproot: tr([fingerprint/path]xpub/chain/*)
    if (descriptorBody.startsWith('tr(')) {
      addressType = ADDRESS_TYPES.TAPROOT;
      match = descriptorBody.match(/tr\(\[([a-f0-9]+)\/([^\]]+)\]([xyztuvp][a-zA-Z0-9]+)(?:\/(\d+)\/\*)?/i);
    }
    // Native SegWit: wpkh([fingerprint/path]xpub/chain/*)
    else if (descriptorBody.startsWith('wpkh(')) {
      addressType = ADDRESS_TYPES.NATIVE_SEGWIT;
      match = descriptorBody.match(/wpkh\(\[([a-f0-9]+)\/([^\]]+)\]([xyztuvp][a-zA-Z0-9]+)(?:\/(\d+)\/\*)?/i);
    }
    // Wrapped SegWit: sh(wpkh([fingerprint/path]xpub/chain/*))
    else if (descriptorBody.startsWith('sh(wpkh(')) {
      addressType = ADDRESS_TYPES.WRAPPED_SEGWIT;
      match = descriptorBody.match(/sh\(wpkh\(\[([a-f0-9]+)\/([^\]]+)\]([xyztuvp][a-zA-Z0-9]+)(?:\/(\d+)\/\*)?\)\)/i);
    }
    // Legacy: pkh([fingerprint/path]xpub/chain/*)
    else if (descriptorBody.startsWith('pkh(')) {
      addressType = ADDRESS_TYPES.LEGACY;
      match = descriptorBody.match(/pkh\(\[([a-f0-9]+)\/([^\]]+)\]([xyztuvp][a-zA-Z0-9]+)(?:\/(\d+)\/\*)?/i);
    }
    else {
      throw new Error(`Unsupported descriptor format: ${descriptorBody}`);
    }

    if (!match) {
      throw new Error(`Failed to parse descriptor: ${descriptorBody}`);
    }

    const [, fingerprint, derivationPath, xpub] = match;
    const isRange = descriptorBody.includes('/*');

    return {
      addressType,
      xpub: xpub || null,
      fingerprint: fingerprint || null,
      derivationPath: derivationPath || null,
      isRange,
    };
  }

  /**
   * Detect address type from address string
   */
  static detectAddressType(address: string): AddressType | null {
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return ADDRESS_TYPES.TAPROOT;
    }
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return ADDRESS_TYPES.NATIVE_SEGWIT;
    }
    if (address.startsWith('3') || address.startsWith('2')) {
      return ADDRESS_TYPES.WRAPPED_SEGWIT;
    }
    if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
      return ADDRESS_TYPES.LEGACY;
    }
    return null;
  }

  /**
   * Convert public key to x-only (32 bytes) for Taproot
   */
  private toXOnlyPublicKey(pubkey: Uint8Array): Buffer {
    return Buffer.from(pubkey.slice(1, 33));
  }

  /**
   * Generate address from public key
   */
  private generateAddress(pubkey: Uint8Array, type: AddressType): string {
    const pubkeyBuffer = Buffer.from(pubkey);

    switch (type) {
      case ADDRESS_TYPES.TAPROOT: {
        const internalPubkey = this.toXOnlyPublicKey(pubkeyBuffer);
        const { address } = bitcoin.payments.p2tr({
          internalPubkey,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2TR address');
        return address;
      }

      case ADDRESS_TYPES.NATIVE_SEGWIT: {
        const { address } = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2WPKH address');
        return address;
      }

      case ADDRESS_TYPES.WRAPPED_SEGWIT: {
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
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
          pubkey: pubkeyBuffer,
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
   * Derive an address at a specific index
   * @param index - Address index
   * @param isChange - Whether this is a change address (chain 1)
   * @returns Address information
   */
  deriveAddress(index: number, isChange: boolean = false): AddressInfo {
    if (!this.accountNode) {
      // For address-only wallets, return from the list
      if (this.watchAddresses.length > 0) {
        if (index >= this.watchAddresses.length) {
          throw new Error('Cannot derive new addresses from address-only watch wallet');
        }
        return {
          address: this.watchAddresses[index],
          path: `external/${index}`,
          index,
          isChange: false,
          type: this.addressType,
        };
      }
      throw new Error('No account node or addresses available');
    }

    const chain = isChange ? DERIVATION.INTERNAL_CHAIN : DERIVATION.EXTERNAL_CHAIN;
    const child = this.accountNode.derive(chain).derive(index);
    const address = this.generateAddress(child.publicKey, this.addressType);

    // Build path (we don't know the full path from just xpub)
    const path = `.../${chain}/${index}`;

    return {
      address,
      path,
      index,
      isChange,
      type: this.addressType,
    };
  }

  /**
   * Derive multiple receiving addresses
   */
  deriveReceivingAddresses(count: number, startIndex: number = 0): AddressInfo[] {
    const addresses: AddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveAddress(startIndex + i, false));
    }
    return addresses;
  }

  /**
   * Derive multiple change addresses
   */
  deriveChangeAddresses(count: number, startIndex: number = 0): AddressInfo[] {
    const addresses: AddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveAddress(startIndex + i, true));
    }
    return addresses;
  }

  /**
   * Get all watch addresses (for address-only wallets)
   */
  getWatchAddresses(): string[] {
    return [...this.watchAddresses];
  }

  /**
   * Get the extended public key
   */
  getXpub(): string | null {
    return this.xpub;
  }

  /**
   * Get the descriptor
   */
  getDescriptor(): string | null {
    return this.descriptor;
  }

  /**
   * Get the address type
   */
  getAddressType(): AddressType {
    return this.addressType;
  }

  /**
   * Get the network type
   */
  getNetworkType(): NetworkType {
    return this.networkType;
  }

  /**
   * Check if this wallet can derive new addresses
   */
  canDeriveAddresses(): boolean {
    return this.accountNode !== null;
  }

  /**
   * Check if an address belongs to this watch wallet
   */
  findAddress(address: string, maxIndex: number = 100): AddressInfo | null {
    // For address-only wallets
    if (this.watchAddresses.length > 0) {
      const index = this.watchAddresses.indexOf(address);
      if (index !== -1) {
        return {
          address,
          path: `external/${index}`,
          index,
          isChange: false,
          type: this.addressType,
        };
      }
      return null;
    }

    // For xpub-based wallets
    if (!this.accountNode) {
      return null;
    }

    // Check receiving addresses
    for (let i = 0; i < maxIndex; i++) {
      const addrInfo = this.deriveAddress(i, false);
      if (addrInfo.address === address) {
        return addrInfo;
      }
    }

    // Check change addresses
    for (let i = 0; i < maxIndex; i++) {
      const addrInfo = this.deriveAddress(i, true);
      if (addrInfo.address === address) {
        return addrInfo;
      }
    }

    return null;
  }

  /**
   * Get output descriptor for this watch wallet
   */
  getOutputDescriptor(isChange: boolean = false): string {
    if (this.descriptor) {
      // Update chain in existing descriptor
      const chain = isChange ? 1 : 0;
      return this.descriptor.replace(/\/[01]\/\*/, `/${chain}/*`);
    }

    if (!this.xpub) {
      throw new Error('Cannot generate descriptor without xpub');
    }

    const chain = isChange ? 1 : 0;

    switch (this.addressType) {
      case ADDRESS_TYPES.TAPROOT:
        return `tr(${this.xpub}/${chain}/*)`;
      case ADDRESS_TYPES.NATIVE_SEGWIT:
        return `wpkh(${this.xpub}/${chain}/*)`;
      case ADDRESS_TYPES.WRAPPED_SEGWIT:
        return `sh(wpkh(${this.xpub}/${chain}/*))`;
      case ADDRESS_TYPES.LEGACY:
        return `pkh(${this.xpub}/${chain}/*)`;
      default:
        throw new Error(`Unknown address type: ${this.addressType}`);
    }
  }

  /**
   * Validate a Bitcoin address for this network
   */
  validateAddress(address: string): boolean {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch {
      return false;
    }
  }
}
