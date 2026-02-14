import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import bs58check from 'bs58check';
import { DERIVATION, BITCOIN_NETWORKS, ADDRESS_TYPES, BIP_PURPOSES } from '../../constants';
import type { AddressInfo, AddressType } from '../../types';

// Initialize BIP32 with secp256k1
const bip32 = BIP32Factory(ecc);

// Initialize ECPair with secp256k1
const ECPair = ECPairFactory(ecc);

// Initialize bitcoinjs-lib with the ECC library
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

/**
 * Utility to securely wipe a Buffer or Uint8Array by filling with zeros.
 * Call this after you're done using a private key to minimize exposure window.
 */
export function wipeKeyMaterial(...buffers: (Buffer | Uint8Array | undefined)[]): void {
  for (const buf of buffers) {
    if (buf) buf.fill(0);
  }
}

/**
 * HD Key Derivation supporting multiple address types:
 * - BIP86: Taproot (P2TR) - bc1p... addresses
 * - BIP84: Native SegWit (P2WPKH) - bc1q... addresses
 * - BIP49: Wrapped SegWit (P2SH-P2WPKH) - 3... addresses
 * - BIP44: Legacy (P2PKH) - 1... addresses
 *
 * Derivation paths:
 * - BIP86: m/86'/coin'/account'/change/index (Taproot)
 * - BIP84: m/84'/coin'/account'/change/index
 * - BIP49: m/49'/coin'/account'/change/index
 * - BIP44: m/44'/coin'/account'/change/index
 */
export class KeyDerivation {
  private masterNode: BIP32Interface;
  private network: bitcoin.Network;
  private networkType: NetworkType;
  // Cache account-level nodes to avoid re-deriving from root for each address
  // Key: "purpose'/coinType'/account'" e.g. "84'/0'/0'"
  private accountNodeCache: Map<string, BIP32Interface> = new Map();

  constructor(seed: Buffer, networkType: NetworkType = 'testnet') {
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
    this.masterNode = bip32.fromSeed(seed, this.network);
  }

  /**
   * Create a KeyDerivation instance from an extended private key (xprv/tprv/zprv/etc.)
   * This allows signing transactions for wallets imported via xprv.
   *
   * @param xprv - Base58-encoded extended private key
   * @param networkType - Network type ('mainnet' | 'testnet')
   * @returns KeyDerivation instance
   */
  static fromXprv(xprv: string, networkType: NetworkType = 'mainnet'): KeyDerivation {
    const network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    let node: BIP32Interface;

    try {
      // Try parsing directly first (handles standard xprv/tprv)
      node = bip32.fromBase58(xprv, network);
    } catch {
      // If direct parsing fails, try converting non-standard version bytes
      // (yprv/zprv/Yprv/Zprv) to standard xprv/tprv format
      try {
        const decoded = bs58check.decode(xprv);
        if (decoded.length === 78) {
          // Replace version bytes with standard xprv (0x0488ADE4) or tprv (0x04358394)
          const modifiedData = Buffer.from(decoded);
          if (networkType === 'mainnet') {
            modifiedData[0] = 0x04;
            modifiedData[1] = 0x88;
            modifiedData[2] = 0xAD;
            modifiedData[3] = 0xE4;
          } else {
            modifiedData[0] = 0x04;
            modifiedData[1] = 0x35;
            modifiedData[2] = 0x83;
            modifiedData[3] = 0x94;
          }
          const standardXprv = bs58check.encode(modifiedData);
          node = bip32.fromBase58(standardXprv, network);
        } else {
          throw new Error('Invalid xprv format');
        }
      } catch (innerError) {
        throw new Error(`Invalid xprv format: ${innerError instanceof Error ? innerError.message : 'parse failed'}`);
      }
    }

    if (!node.privateKey) {
      throw new Error('Invalid xprv: no private key present. This may be an xpub.');
    }

    // Create an instance using a dummy seed (we'll replace the masterNode)
    const instance = Object.create(KeyDerivation.prototype) as KeyDerivation;
    instance.networkType = networkType;
    instance.network = network;
    instance.masterNode = node;
    instance.accountNodeCache = new Map();
    instance.chainNodeCache = new Map();

    return instance;
  }

  /**
   * Create a KeyDerivation instance from raw seed bytes (hex string).
   * This allows signing transactions for wallets imported via seed hex.
   *
   * @param seedHex - Hex-encoded seed bytes (typically 64 bytes / 128 hex chars)
   * @param networkType - Network type ('mainnet' | 'testnet')
   * @returns KeyDerivation instance
   */
  static fromSeedHex(seedHex: string, networkType: NetworkType = 'mainnet'): KeyDerivation {
    const seed = Buffer.from(seedHex, 'hex');
    return new KeyDerivation(seed, networkType);
  }

  /**
   * Get the BIP purpose number for an address type
   */
  private getPurpose(type: AddressType): number {
    switch (type) {
      case ADDRESS_TYPES.TAPROOT:
        return BIP_PURPOSES.BIP86;
      case ADDRESS_TYPES.NATIVE_SEGWIT:
        return BIP_PURPOSES.BIP84;
      case ADDRESS_TYPES.WRAPPED_SEGWIT:
        return BIP_PURPOSES.BIP49;
      case ADDRESS_TYPES.LEGACY:
        return BIP_PURPOSES.BIP44;
      default:
        return BIP_PURPOSES.BIP84; // Default to native segwit
    }
  }

  /**
   * Convert a 33-byte compressed public key to a 32-byte x-only public key
   * Required for Taproot (BIP340 Schnorr signatures use x-only keys)
   * @param pubkey - 33-byte compressed public key
   * @returns 32-byte x-only public key
   */
  private toXOnlyPublicKey(pubkey: Uint8Array): Buffer {
    // X-only pubkey is just the X coordinate (first 32 bytes after the prefix byte)
    return Buffer.from(pubkey.slice(1, 33));
  }

  /**
   * Tweak the internal key with the tap tweak for P2TR
   * This creates the output key that goes on-chain
   * @param internalPubkey - The x-only internal public key
   * @returns The tweaked output key
   */
  private tweakInternalKey(internalPubkey: Buffer): Buffer {
    // For key-path only spend (no scripts), the tweak is:
    // t = TaggedHash("TapTweak", internal_pubkey)
    // Output key = internal_pubkey + t*G
    const tweak = bitcoin.crypto.taggedHash('TapTweak', internalPubkey);
    const tweakedKey = ecc.xOnlyPointAddTweak(internalPubkey, tweak);
    if (!tweakedKey) {
      throw new Error('Failed to tweak internal key');
    }
    return Buffer.from(tweakedKey.xOnlyPubkey);
  }

  /**
   * Get the derivation path for an address
   * @param type - Address type (native_segwit, wrapped_segwit, legacy)
   * @param accountIndex - Account index (default 0)
   * @param isChange - Whether this is a change address
   * @param addressIndex - Address index
   * @returns The derivation path
   */
  private getPath(
    type: AddressType,
    accountIndex: number,
    isChange: boolean,
    addressIndex: number
  ): string {
    const purpose = this.getPurpose(type);
    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const chain = isChange ? DERIVATION.INTERNAL_CHAIN : DERIVATION.EXTERNAL_CHAIN;
    return `m/${purpose}'/${coinType}'/${accountIndex}'/${chain}/${addressIndex}`;
  }

  /**
   * Get or create a cached account-level node for the given path prefix.
   * Caches m/purpose'/coinType'/account' so child derivation is just chain/index (2 levels instead of 5).
   */
  private getAccountNode(purpose: number, accountIndex: number): BIP32Interface {
    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const cacheKey = `${purpose}'/${coinType}'/${accountIndex}'`;
    let node = this.accountNodeCache.get(cacheKey);
    if (!node) {
      node = this.masterNode.derivePath(`m/${cacheKey}`);
      this.accountNodeCache.set(cacheKey, node);
    }
    return node;
  }

  // Cache chain-level nodes (account + chain) to avoid re-deriving chain for each address
  // Key: "purpose'/coinType'/account'/chain"
  private chainNodeCache: Map<string, BIP32Interface> = new Map();

  /**
   * Get or create a cached chain-level node (account + chain).
   * This means each address derivation is just one .derive(index) call.
   */
  private getChainNode(purpose: number, accountIndex: number, chain: number): BIP32Interface {
    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const cacheKey = `${purpose}'/${coinType}'/${accountIndex}'/${chain}`;
    let node = this.chainNodeCache.get(cacheKey);
    if (!node) {
      const accountNode = this.getAccountNode(purpose, accountIndex);
      node = accountNode.derive(chain);
      this.chainNodeCache.set(cacheKey, node);
    }
    return node;
  }

  /**
   * Derive a key pair at a specific path, using chain-level cache when possible.
   * @param path - Derivation path (can be absolute like "m/84'/0'/0'/0/0" or relative like "0/0")
   * @returns The derived BIP32 node
   */
  private deriveAtPath(path: string): BIP32Interface {
    // Handle special cases for xprv-imported wallets
    // These may have paths like "xprv/0/0" or "0/0" instead of full BIP paths
    if (path.startsWith('xprv/')) {
      // Strip "xprv/" prefix and derive relative path
      const relativePath = path.replace('xprv/', '');
      return this.deriveRelativePath(relativePath);
    }

    // Parse path to use chain cache: m/purpose'/coinType'/account'/chain/index
    const parts = path.replace('m/', '').split('/');

    // Check if it's a standard BIP32/44/49/84/86 path with 5 parts
    if (parts.length === 5) {
      const purpose = parseInt(parts[0]);
      // Only use cache optimization for valid BIP purpose numbers
      if ([44, 49, 84, 86].includes(purpose)) {
        const accountIndex = parseInt(parts[2]);
        const chain = parseInt(parts[3]);
        const index = parseInt(parts[4]);
        const chainNode = this.getChainNode(purpose, accountIndex, chain);
        return chainNode.derive(index);
      }
    }

    // Check if it looks like a relative path (starts with a number)
    if (/^\d/.test(path)) {
      return this.deriveRelativePath(path);
    }

    // Fallback for standard BIP32 paths
    return this.masterNode.derivePath(path);
  }

  /**
   * Derive using a relative path from the current master node.
   * Handles paths like "0/0", "0'/0'/0", etc.
   * @param relativePath - Relative path without "m/" prefix
   * @returns The derived BIP32 node
   */
  private deriveRelativePath(relativePath: string): BIP32Interface {
    const parts = relativePath.split('/').filter(p => p.length > 0);
    let node = this.masterNode;

    for (const part of parts) {
      const isHardened = part.endsWith("'") || part.endsWith('h');
      const index = parseInt(part.replace(/['h]/g, ''), 10);

      if (isNaN(index)) {
        throw new Error(`Invalid path component: ${part}`);
      }

      if (isHardened) {
        node = node.deriveHardened(index);
      } else {
        node = node.derive(index);
      }
    }

    return node;
  }

  /**
   * Generate an address from a public key based on address type
   * @param pubkey - Public key (Buffer or Uint8Array)
   * @param type - Address type
   * @returns The Bitcoin address
   */
  private generateAddress(pubkey: Uint8Array, type: AddressType): string {
    // Ensure we have a Buffer for bitcoinjs-lib
    const pubkeyBuffer = Buffer.from(pubkey);
    switch (type) {
      case ADDRESS_TYPES.TAPROOT: {
        // BIP86 - Taproot P2TR (bc1p... / tb1p...)
        // For P2TR, we need the x-only (32-byte) internal public key
        const internalPubkey = this.toXOnlyPublicKey(pubkeyBuffer);
        const { address } = bitcoin.payments.p2tr({
          internalPubkey,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2TR address');
        return address;
      }

      case ADDRESS_TYPES.NATIVE_SEGWIT: {
        // BIP84 - Native SegWit P2WPKH (bc1q... / tb1q...)
        const { address } = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
          network: this.network,
        });
        if (!address) throw new Error('Failed to generate P2WPKH address');
        return address;
      }

      case ADDRESS_TYPES.WRAPPED_SEGWIT: {
        // BIP49 - Wrapped SegWit P2SH-P2WPKH (3... / 2...)
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
        // BIP44 - Legacy P2PKH (1... / m.../n...)
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
   * Derive an address of any type
   * @param type - Address type
   * @param isChange - Whether this is a change address
   * @param addressIndex - Address index
   * @param accountIndex - Account index (default 0)
   * @returns Address information
   */
  deriveAddress(
    type: AddressType,
    isChange: boolean,
    addressIndex: number,
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT
  ): AddressInfo {
    const path = this.getPath(type, accountIndex, isChange, addressIndex);
    const child = this.deriveAtPath(path);
    const address = this.generateAddress(child.publicKey, type);

    return {
      address,
      path,
      index: addressIndex,
      isChange,
      type,
    };
  }

  /**
   * Derive a receiving (external) address
   * @param type - Address type
   * @param addressIndex - Address index
   * @param accountIndex - Account index
   * @returns Address information
   */
  deriveReceivingAddress(
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT,
    addressIndex: number,
    type: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT
  ): AddressInfo {
    return this.deriveAddress(type, false, addressIndex, accountIndex);
  }

  /**
   * Derive a change (internal) address
   * @param type - Address type
   * @param addressIndex - Address index
   * @param accountIndex - Account index
   * @returns Address information
   */
  deriveChangeAddress(
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT,
    addressIndex: number,
    type: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT
  ): AddressInfo {
    return this.deriveAddress(type, true, addressIndex, accountIndex);
  }

  /**
   * Derive multiple receiving addresses of a specific type
   * @param type - Address type
   * @param count - Number of addresses to derive
   * @param startIndex - Starting index
   * @param accountIndex - Account index
   * @returns Array of address information
   */
  deriveReceivingAddresses(
    count: number,
    startIndex: number = 0,
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT,
    type: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT
  ): AddressInfo[] {
    const addresses: AddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveReceivingAddress(accountIndex, startIndex + i, type));
    }
    return addresses;
  }

  /**
   * Derive multiple change addresses of a specific type
   * @param type - Address type
   * @param count - Number of addresses to derive
   * @param startIndex - Starting index
   * @param accountIndex - Account index
   * @returns Array of address information
   */
  deriveChangeAddresses(
    count: number,
    startIndex: number = 0,
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT,
    type: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT
  ): AddressInfo[] {
    const addresses: AddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveChangeAddress(accountIndex, startIndex + i, type));
    }
    return addresses;
  }

  /**
   * Derive addresses for all address types
   * @param count - Number of addresses per type
   * @param isChange - Whether these are change addresses
   * @param accountIndex - Account index
   * @returns Object containing arrays of addresses by type
   */
  deriveAllTypes(
    count: number,
    isChange: boolean = false,
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT
  ): Record<AddressType, AddressInfo[]> {
    return {
      [ADDRESS_TYPES.TAPROOT]: Array.from({ length: count }, (_, i) =>
        this.deriveAddress(ADDRESS_TYPES.TAPROOT, isChange, i, accountIndex)
      ),
      [ADDRESS_TYPES.NATIVE_SEGWIT]: Array.from({ length: count }, (_, i) =>
        this.deriveAddress(ADDRESS_TYPES.NATIVE_SEGWIT, isChange, i, accountIndex)
      ),
      [ADDRESS_TYPES.WRAPPED_SEGWIT]: Array.from({ length: count }, (_, i) =>
        this.deriveAddress(ADDRESS_TYPES.WRAPPED_SEGWIT, isChange, i, accountIndex)
      ),
      [ADDRESS_TYPES.LEGACY]: Array.from({ length: count }, (_, i) =>
        this.deriveAddress(ADDRESS_TYPES.LEGACY, isChange, i, accountIndex)
      ),
    };
  }

  /**
   * Get the key pair for signing a transaction
   * WARNING: This exposes the private key - use carefully and clear from memory after use
   * @param path - The derivation path
   * @returns The key pair with private key
   */
  getSigningKeyPair(path: string): {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    sign: (hash: Uint8Array) => Uint8Array;
  } {
    const child = this.deriveAtPath(path);

    if (!child.privateKey) {
      throw new Error('Private key not available');
    }

    // Ensure private key is a pure Uint8Array (not Buffer subclass) for
    // secp256k1 compatibility in React Native where Buffer may not pass
    // instanceof Uint8Array checks in some polyfill environments.
    const privateKey = new Uint8Array(child.privateKey);
    const publicKey = new Uint8Array(child.publicKey);

    return {
      publicKey,
      privateKey,
      sign: (hash: Uint8Array) => {
        // Create ECPair from the raw private key to ensure proper signing
        const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey), {
          network: this.network,
          compressed: true,
        });
        return keyPair.sign(Buffer.from(hash));
      },
    };
  }

  /**
   * Get Taproot-specific key data for a path
   * Includes the internal key (x-only), tweaked key, and Schnorr signing capability
   * WARNING: This exposes the private key - call wipeKeyMaterial(privateKey, tweakedPrivateKey)
   * after signing to zero out key buffers.
   * @param path - The derivation path (should be BIP86 path)
   * @returns Taproot key data
   */
  getTaprootKeyPair(path: string): {
    internalPubkey: Buffer;          // 32-byte x-only internal pubkey
    tweakedPubkey: Buffer;           // 32-byte x-only tweaked pubkey (output key)
    privateKey: Buffer;              // 32-byte private key
    tweakedPrivateKey: Buffer;       // Tweaked private key for signing
    signSchnorr: (hash: Buffer) => Buffer;
  } {
    const child = this.deriveAtPath(path);

    if (!child.privateKey) {
      throw new Error('Private key not available');
    }

    // Ensure pure Uint8Array for secp256k1 compatibility in React Native
    const rawPrivateKey = new Uint8Array(child.privateKey);
    const rawPublicKey = new Uint8Array(child.publicKey);

    const privateKey = Buffer.from(rawPrivateKey);
    const internalPubkey = this.toXOnlyPublicKey(rawPublicKey);

    // Tweak the private key for signing
    // We need to check if the full pubkey has odd Y coordinate and negate if so
    const isOdd = rawPublicKey[0] === 0x03;

    // For key-path spend with no scripts, the tweak is TaggedHash("TapTweak", internalPubkey)
    const tweak = bitcoin.crypto.taggedHash('TapTweak', internalPubkey);
    const tweakBytes = new Uint8Array(tweak);
    const tweakedResult = ecc.xOnlyPointAddTweak(new Uint8Array(internalPubkey), tweakBytes);
    if (!tweakedResult) {
      throw new Error('Failed to tweak Taproot key');
    }

    const tweakedPubkey = Buffer.from(tweakedResult.xOnlyPubkey);

    // Compute tweaked private key
    // If pubkey has odd Y, negate private key first
    let adjustedPrivateKey: Uint8Array = rawPrivateKey;
    if (isOdd) {
      // Negate by subtracting from curve order
      adjustedPrivateKey = new Uint8Array(this.negatePrivateKey(rawPrivateKey)!);
    }

    // Add the tweak to the private key
    const tweakedPrivateKey = Buffer.from(this.addPrivateKeys(adjustedPrivateKey, tweakBytes)!);

    return {
      internalPubkey,
      tweakedPubkey,
      privateKey,
      tweakedPrivateKey,
      signSchnorr: (hash: Buffer): Buffer => {
        // Use the ECC library's Schnorr signing with pure Uint8Array
        const sig = ecc.signSchnorr(new Uint8Array(hash), new Uint8Array(tweakedPrivateKey));
        return Buffer.from(sig);
      },
    };
  }

  /**
   * Helper to add two private keys mod curve order
   * Ensures pure Uint8Array inputs for secp256k1 compatibility
   */
  private addPrivateKeys(key1: Uint8Array, key2: Uint8Array): Uint8Array {
    // Ensure pure Uint8Array (not Buffer subclass) for React Native compatibility
    const k1 = key1 instanceof Uint8Array && !(key1 as any).__proto__.constructor?.isBuffer
      ? key1 : new Uint8Array(key1);
    const k2 = key2 instanceof Uint8Array && !(key2 as any).__proto__.constructor?.isBuffer
      ? key2 : new Uint8Array(key2);
    const result = ecc.privateAdd(k1, k2);
    if (!result) {
      throw new Error('Private key addition failed');
    }
    return result;
  }

  /**
   * Helper to negate a private key (subtract from curve order)
   * Ensures pure Uint8Array inputs for secp256k1 compatibility
   */
  private negatePrivateKey(key: Uint8Array): Uint8Array {
    // Ensure pure Uint8Array (not Buffer subclass) for React Native compatibility
    const k = key instanceof Uint8Array && !(key as any).__proto__.constructor?.isBuffer
      ? key : new Uint8Array(key);
    const negated = ecc.privateNegate(k);
    if (!negated) {
      throw new Error('Private key negation failed');
    }
    return negated;
  }

  /**
   * Get the Taproot internal public key (x-only) for an address
   * Used for building Taproot transactions
   * @param path - The derivation path
   * @returns The 32-byte x-only internal public key
   */
  getTaprootInternalPubkey(path: string): Buffer {
    const child = this.deriveAtPath(path);
    return this.toXOnlyPublicKey(child.publicKey);
  }

  /**
   * Get the redeem script for a P2SH-P2WPKH (wrapped segwit) address
   * Required for signing wrapped segwit inputs
   * @param path - The derivation path
   * @returns The redeem script
   */
  getRedeemScript(path: string): Buffer {
    const child = this.deriveAtPath(path);
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network: this.network,
    });

    if (!p2wpkh.output) {
      throw new Error('Failed to generate redeem script');
    }

    return Buffer.from(p2wpkh.output);
  }

  /**
   * Get the public key for an address (for building unsigned transactions)
   * @param path - The derivation path
   * @returns The public key buffer
   */
  getPublicKey(path: string): Uint8Array {
    return this.deriveAtPath(path).publicKey;
  }

  /**
   * Get the private key in WIF (Wallet Import Format) for an address
   * WARNING: This exposes the private key - handle with extreme care!
   * @param path - The derivation path
   * @returns The WIF-encoded private key
   */
  getWIF(path: string): string {
    const child = this.deriveAtPath(path);

    if (!child.privateKey) {
      throw new Error('Private key not available');
    }

    // Use ecpair to convert private key to WIF
    const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), {
      network: this.network,
      compressed: true,
    });

    return keyPair.toWIF();
  }

  /**
   * Get address info with WIF private key
   * WARNING: This exposes the private key - handle with extreme care!
   * @param type - Address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Whether this is a change address
   * @returns Address information with WIF
   */
  getAddressWithWIF(
    type: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT,
    accountIndex: number = 0,
    addressIndex: number,
    isChange: boolean = false
  ): AddressInfo & { wif: string } {
    const addressInfo = this.deriveAddress(type, isChange, addressIndex, accountIndex);
    const wif = this.getWIF(addressInfo.path);

    return {
      ...addressInfo,
      wif,
    };
  }

  /**
   * Detect the address type from an address string
   * @param address - The Bitcoin address
   * @returns The address type or null if unknown
   */
  static detectAddressType(address: string): AddressType | null {
    // Taproot addresses: bc1p... (mainnet) or tb1p... (testnet)
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return ADDRESS_TYPES.TAPROOT;
    }
    // Native SegWit: bc1q... (mainnet) or tb1q... (testnet)
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return ADDRESS_TYPES.NATIVE_SEGWIT;
    }
    // Wrapped SegWit: 3... (mainnet) or 2... (testnet)
    if (address.startsWith('3') || address.startsWith('2')) {
      return ADDRESS_TYPES.WRAPPED_SEGWIT;
    }
    // Legacy: 1... (mainnet) or m.../n... (testnet)
    if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
      return ADDRESS_TYPES.LEGACY;
    }
    return null;
  }

  /**
   * Validate that an address belongs to this wallet
   * @param address - The address to check
   * @param maxIndex - Maximum index to search
   * @returns The address info if found, null otherwise
   */
  findAddress(address: string, maxIndex: number = 100): AddressInfo | null {
    // Detect likely address type from prefix to search that type first
    const detectedType = KeyDerivation.detectAddressType(address);
    const types = [
      ADDRESS_TYPES.TAPROOT,
      ADDRESS_TYPES.NATIVE_SEGWIT,
      ADDRESS_TYPES.WRAPPED_SEGWIT,
      ADDRESS_TYPES.LEGACY,
    ];
    // Prioritize the detected type to avoid unnecessary derivations
    if (detectedType) {
      const idx = types.indexOf(detectedType);
      if (idx > 0) {
        types.splice(idx, 1);
        types.unshift(detectedType);
      }
    }

    // Build a lookup map: derive all addresses once, then search O(1)
    const addressMap = new Map<string, AddressInfo>();
    for (const type of types) {
      for (let i = 0; i < maxIndex; i++) {
        const receiving = this.deriveAddress(type, false, i);
        addressMap.set(receiving.address, receiving);
        const change = this.deriveAddress(type, true, i);
        addressMap.set(change.address, change);
      }
      // Check after each type to early-exit if found
      const found = addressMap.get(address);
      if (found) return found;
    }

    return null;
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
   * Get the master extended private key (xprv) in Base58 format.
   * WARNING: This exposes the root private key — handle with extreme care!
   */
  getMasterXprv(): string {
    if (!this.masterNode.privateKey) {
      throw new Error('No private key available (watch-only wallet?)');
    }
    return this.masterNode.toBase58();
  }

  /**
   * Get the master extended public key (xpub) in Base58 format.
   */
  getMasterXpub(): string {
    return this.masterNode.neutered().toBase58();
  }

  /**
   * Get extended public key (xpub/ypub/zpub) for a specific address type and account
   * @param type - Address type (determines xpub/ypub/zpub format)
   * @param accountIndex - Account index (default 0)
   * @returns Object containing the extended public key and metadata
   */
  getExtendedPublicKey(
    type: AddressType,
    accountIndex: number = DERIVATION.DEFAULT_ACCOUNT
  ): {
    xpub: string;
    type: AddressType;
    path: string;
    format: 'xpub' | 'ypub' | 'zpub' | 'tpub' | 'upub' | 'vpub';
  } {
    const purpose = this.getPurpose(type);
    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const accountPath = `m/${purpose}'/${coinType}'/${accountIndex}'`;

    const accountNode = this.deriveAtPath(accountPath);

    // Get the neutered (public-only) version
    const neuteredNode = accountNode.neutered();

    // Determine the correct version bytes based on network and type
    let format: 'xpub' | 'ypub' | 'zpub' | 'tpub' | 'upub' | 'vpub';
    let xpub: string;

    if (this.networkType === 'mainnet') {
      switch (type) {
        case ADDRESS_TYPES.TAPROOT:
          // xpub for BIP86 mainnet (no special format defined yet, use xpub)
          // Note: Some wallets use "xpub" with P2TR, others may use custom formats
          format = 'xpub';
          xpub = neuteredNode.toBase58();
          break;
        case ADDRESS_TYPES.NATIVE_SEGWIT:
          // zpub for BIP84 mainnet
          format = 'zpub';
          xpub = this.convertToSpecialFormat(neuteredNode.toBase58(), 'zpub');
          break;
        case ADDRESS_TYPES.WRAPPED_SEGWIT:
          // ypub for BIP49 mainnet
          format = 'ypub';
          xpub = this.convertToSpecialFormat(neuteredNode.toBase58(), 'ypub');
          break;
        case ADDRESS_TYPES.LEGACY:
        default:
          // xpub for BIP44 mainnet
          format = 'xpub';
          xpub = neuteredNode.toBase58();
          break;
      }
    } else {
      switch (type) {
        case ADDRESS_TYPES.TAPROOT:
          // tpub for BIP86 testnet (no special format defined yet)
          format = 'tpub';
          xpub = neuteredNode.toBase58();
          break;
        case ADDRESS_TYPES.NATIVE_SEGWIT:
          // vpub for BIP84 testnet
          format = 'vpub';
          xpub = this.convertToSpecialFormat(neuteredNode.toBase58(), 'vpub');
          break;
        case ADDRESS_TYPES.WRAPPED_SEGWIT:
          // upub for BIP49 testnet
          format = 'upub';
          xpub = this.convertToSpecialFormat(neuteredNode.toBase58(), 'upub');
          break;
        case ADDRESS_TYPES.LEGACY:
        default:
          // tpub for BIP44 testnet
          format = 'tpub';
          xpub = neuteredNode.toBase58();
          break;
      }
    }

    return {
      xpub,
      type,
      path: accountPath,
      format,
    };
  }

  /**
   * Convert standard xpub/tpub to special format (ypub/zpub/upub/vpub)
   * Uses version byte conversion
   */
  private convertToSpecialFormat(
    xpub: string,
    format: 'ypub' | 'zpub' | 'upub' | 'vpub'
  ): string {
    // Version prefixes (Base58Check)
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

    // Decode the xpub using bs58check
    const data = bs58check.decode(xpub);

    // Replace the version bytes
    const newVersionBytes = VERSION_BYTES[format];
    if (!newVersionBytes) {
      throw new Error(`Unknown format: ${format}`);
    }

    const newData = Buffer.concat([newVersionBytes, data.slice(4)]);
    return bs58check.encode(newData);
  }

  /**
   * Get all extended public keys for account 0
   * @returns Object with xpub for each address type
   */
  getAllExtendedPublicKeys(accountIndex: number = 0): {
    taproot: { xpub: string; format: string; path: string };
    nativeSegwit: { xpub: string; format: string; path: string };
    wrappedSegwit: { xpub: string; format: string; path: string };
    legacy: { xpub: string; format: string; path: string };
  } {
    const taproot = this.getExtendedPublicKey(ADDRESS_TYPES.TAPROOT, accountIndex);
    const native = this.getExtendedPublicKey(ADDRESS_TYPES.NATIVE_SEGWIT, accountIndex);
    const wrapped = this.getExtendedPublicKey(ADDRESS_TYPES.WRAPPED_SEGWIT, accountIndex);
    const legacy = this.getExtendedPublicKey(ADDRESS_TYPES.LEGACY, accountIndex);

    return {
      taproot: { xpub: taproot.xpub, format: taproot.format, path: taproot.path },
      nativeSegwit: { xpub: native.xpub, format: native.format, path: native.path },
      wrappedSegwit: { xpub: wrapped.xpub, format: wrapped.format, path: wrapped.path },
      legacy: { xpub: legacy.xpub, format: legacy.format, path: legacy.path },
    };
  }

  /**
   * Get the master fingerprint (first 4 bytes of master public key hash)
   * Used in output descriptors
   */
  getMasterFingerprint(): string {
    const masterPubkey = this.masterNode.publicKey;
    const hash = bitcoin.crypto.hash160(Buffer.from(masterPubkey));
    return Buffer.from(hash.slice(0, 4)).toString('hex');
  }

  /**
   * Generate output descriptor for a specific address type
   * @param type - Address type
   * @param accountIndex - Account index
   * @param isChange - Whether for change addresses
   * @returns Output descriptor string
   */
  getOutputDescriptor(
    type: AddressType,
    accountIndex: number = 0,
    isChange: boolean = false
  ): string {
    const fingerprint = this.getMasterFingerprint();
    const purpose = this.getPurpose(type);
    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const chain = isChange ? 1 : 0;

    const { xpub } = this.getExtendedPublicKey(type, accountIndex);

    // Build the key origin info
    const origin = `[${fingerprint}/${purpose}h/${coinType}h/${accountIndex}h]`;

    // Different descriptor formats based on address type
    switch (type) {
      case ADDRESS_TYPES.TAPROOT:
        // BIP86 Taproot descriptor: tr(internal_key)
        return `tr(${origin}${xpub}/${chain}/*)`;
      case ADDRESS_TYPES.NATIVE_SEGWIT:
        return `wpkh(${origin}${xpub}/${chain}/*)`;
      case ADDRESS_TYPES.WRAPPED_SEGWIT:
        return `sh(wpkh(${origin}${xpub}/${chain}/*))`;
      case ADDRESS_TYPES.LEGACY:
        return `pkh(${origin}${xpub}/${chain}/*)`;
      default:
        throw new Error(`Unknown address type: ${type}`);
    }
  }

  /**
   * Get all output descriptors for account 0
   */
  getAllOutputDescriptors(accountIndex: number = 0): {
    taproot: { receive: string; change: string };
    nativeSegwit: { receive: string; change: string };
    wrappedSegwit: { receive: string; change: string };
    legacy: { receive: string; change: string };
  } {
    return {
      taproot: {
        receive: this.getOutputDescriptor(ADDRESS_TYPES.TAPROOT, accountIndex, false),
        change: this.getOutputDescriptor(ADDRESS_TYPES.TAPROOT, accountIndex, true),
      },
      nativeSegwit: {
        receive: this.getOutputDescriptor(ADDRESS_TYPES.NATIVE_SEGWIT, accountIndex, false),
        change: this.getOutputDescriptor(ADDRESS_TYPES.NATIVE_SEGWIT, accountIndex, true),
      },
      wrappedSegwit: {
        receive: this.getOutputDescriptor(ADDRESS_TYPES.WRAPPED_SEGWIT, accountIndex, false),
        change: this.getOutputDescriptor(ADDRESS_TYPES.WRAPPED_SEGWIT, accountIndex, true),
      },
      legacy: {
        receive: this.getOutputDescriptor(ADDRESS_TYPES.LEGACY, accountIndex, false),
        change: this.getOutputDescriptor(ADDRESS_TYPES.LEGACY, accountIndex, true),
      },
    };
  }

  /**
   * Get extended public key for BIP48 multisig
   * BIP48 uses m/48'/coin'/account'/script_type' where script_type is:
   *   0' = P2SH (legacy multisig)
   *   1' = P2SH-P2WSH (wrapped segwit multisig)
   *   2' = P2WSH (native segwit multisig)
   *
   * @param scriptType - 'p2sh' | 'p2sh-p2wsh' | 'p2wsh'
   * @param accountIndex - Account index (default 0)
   * @returns Object containing the xpub and derivation path
   */
  getMultisigXpub(
    scriptType: 'p2sh' | 'p2sh-p2wsh' | 'p2wsh' = 'p2wsh',
    accountIndex: number = 0
  ): {
    xpub: string;
    path: string;
    fingerprint: string;
    format: 'xpub' | 'Ypub' | 'Zpub' | 'tpub' | 'Upub' | 'Vpub';
  } {
    // Determine script type index for BIP48
    let scriptTypeIndex: number;
    switch (scriptType) {
      case 'p2sh':
        scriptTypeIndex = 0;
        break;
      case 'p2sh-p2wsh':
        scriptTypeIndex = 1;
        break;
      case 'p2wsh':
      default:
        scriptTypeIndex = 2;
        break;
    }

    const coinType = BITCOIN_NETWORKS[this.networkType].coinType;
    const accountPath = `m/48'/${coinType}'/${accountIndex}'/${scriptTypeIndex}'`;

    const accountNode = this.deriveAtPath(accountPath);

    // Get the neutered (public-only) version
    const neuteredNode = accountNode.neutered();

    // Get base xpub
    const baseXpub = neuteredNode.toBase58();
    const fingerprint = this.getMasterFingerprint();

    // Convert to appropriate format based on script type and network
    // Multisig uses different version bytes than single-sig:
    // - Zpub/Vpub for P2WSH (capital Z/V)
    // - Ypub/Upub for P2SH-P2WSH (capital Y/U)
    // - xpub/tpub for P2SH (standard)
    let xpub: string;
    let format: 'xpub' | 'Ypub' | 'Zpub' | 'tpub' | 'Upub' | 'Vpub';

    if (this.networkType === 'mainnet') {
      switch (scriptType) {
        case 'p2wsh':
          format = 'Zpub';
          xpub = this.convertToMultisigFormat(baseXpub, 'Zpub');
          break;
        case 'p2sh-p2wsh':
          format = 'Ypub';
          xpub = this.convertToMultisigFormat(baseXpub, 'Ypub');
          break;
        case 'p2sh':
        default:
          format = 'xpub';
          xpub = baseXpub;
          break;
      }
    } else {
      switch (scriptType) {
        case 'p2wsh':
          format = 'Vpub';
          xpub = this.convertToMultisigFormat(baseXpub, 'Vpub');
          break;
        case 'p2sh-p2wsh':
          format = 'Upub';
          xpub = this.convertToMultisigFormat(baseXpub, 'Upub');
          break;
        case 'p2sh':
        default:
          format = 'tpub';
          xpub = baseXpub;
          break;
      }
    }

    return {
      xpub,
      path: accountPath,
      fingerprint,
      format,
    };
  }

  /**
   * Convert standard xpub/tpub to multisig format (Ypub/Zpub/Upub/Vpub)
   * Note: These use DIFFERENT version bytes than single-sig ypub/zpub
   */
  private convertToMultisigFormat(
    xpub: string,
    format: 'Ypub' | 'Zpub' | 'Upub' | 'Vpub'
  ): string {
    // Multisig version prefixes (different from single-sig!)
    // Reference: SLIP-0132
    const MULTISIG_VERSION_BYTES: Record<string, Buffer> = {
      // Mainnet multisig
      Ypub: Buffer.from('0295b43f', 'hex'), // P2SH-P2WSH
      Zpub: Buffer.from('02aa7ed3', 'hex'), // P2WSH
      // Testnet multisig
      Upub: Buffer.from('024289ef', 'hex'), // P2SH-P2WSH
      Vpub: Buffer.from('02575483', 'hex'), // P2WSH
    };

    // Decode the xpub using bs58check
    const data = bs58check.decode(xpub);

    // Replace the version bytes (first 4 bytes)
    const newVersionBytes = MULTISIG_VERSION_BYTES[format];
    if (!newVersionBytes) {
      throw new Error(`Unknown multisig format: ${format}`);
    }

    const newData = Buffer.concat([newVersionBytes, data.slice(4)]);
    return bs58check.encode(newData);
  }

  /**
   * Clear sensitive data from memory
   * Call this when done with the key derivation instance
   */
  destroy(): void {
    // Clear the master node and all cached nodes
    // Unfortunately we can't fully clear Buffer memory in JS
    // but we can dereference it for garbage collection
    this.accountNodeCache.clear();
    this.chainNodeCache.clear();
    (this as any).masterNode = null;
  }
}
