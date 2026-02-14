/**
 * Multisig Wallet
 * Supports creating and managing M-of-N multisig wallets
 *
 * Features:
 * - Create multisig configurations (2-of-3, 3-of-5, etc.)
 * - Manage cosigners
 * - Derive multisig addresses
 * - Generate and parse multisig descriptors
 * - Create PSBTs for multisig spending
 * - Track signature status
 *
 * Supported script types:
 * - P2SH (legacy multisig)
 * - P2WSH (native segwit multisig)
 * - P2SH-P2WSH (wrapped segwit multisig)
 */

import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import {
  DERIVATION,
  BITCOIN_NETWORKS,
  ADDRESS_TYPES,
  BIP_PURPOSES,
  MULTISIG_SCRIPT_TYPES,
} from '../../constants';
import type {
  AddressInfo,
  MultisigConfig,
  CosignerInfo,
  MultisigScriptType,
  UTXO,
} from '../../types';
import {
  addDescriptorChecksum,
  createMultisigDescriptor,
} from '../../utils/descriptor';

// Initialize BIP32 with secp256k1
const bip32 = BIP32Factory(ecc);

// Initialize bitcoinjs-lib with the ECC library
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

export interface MultisigAddressInfo extends AddressInfo {
  redeemScript?: Buffer;
  witnessScript?: Buffer;
  publicKeys: Buffer[];
  // Maps each pubkey (hex string) to its cosigner fingerprint
  // This is needed because sortedmulti reorders keys
  pubkeyToFingerprint?: Map<string, string>;
}

/**
 * Multisig Wallet class for managing M-of-N multisig wallets
 */
export class MultisigWallet {
  private network: bitcoin.Network;
  private networkType: NetworkType;
  private config: MultisigConfig;
  private cosignerNodes: Map<string, BIP32Interface> = new Map();
  /** Cache for findAddress: avoids re-deriving 200 addresses per lookup */
  private addressCache: Map<string, MultisigAddressInfo> = new Map();
  private addressCacheMaxIndex: number = 0;

  private constructor(config: MultisigConfig, networkType: NetworkType) {
    this.config = config;
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
  }

  /**
   * Create a new multisig configuration
   * @param m - Required signatures (threshold)
   * @param n - Total signers
   * @param scriptType - P2SH, P2WSH, or P2SH-P2WSH
   * @param sortedKeys - Whether to use sortedmulti (recommended)
   */
  static create(
    m: number,
    n: number,
    scriptType: MultisigScriptType = MULTISIG_SCRIPT_TYPES.P2WSH,
    networkType: NetworkType = 'mainnet',
    sortedKeys: boolean = true
  ): MultisigWallet {
    if (m < 1 || m > n) {
      throw new Error(`Invalid threshold: ${m} of ${n}`);
    }

    if (n < 2 || n > 15) {
      throw new Error('Multisig requires 2-15 signers');
    }

    const coinType = BITCOIN_NETWORKS[networkType].coinType;

    const config: MultisigConfig = {
      m,
      n,
      scriptType,
      cosigners: [],
      derivationPath: `m/${BIP_PURPOSES.BIP48}'/${coinType}'/0'/2'`, // BIP48 standard for multisig
      sortedKeys,
    };

    return new MultisigWallet(config, networkType);
  }

  /**
   * Create a multisig wallet from an existing configuration
   */
  static fromConfig(config: MultisigConfig, networkType: NetworkType = 'mainnet'): MultisigWallet {
    const wallet = new MultisigWallet(config, networkType);

    // Initialize cosigner nodes from xpubs
    for (const cosigner of config.cosigners) {
      const standardXpub = MultisigWallet.convertToStandardXpub(cosigner.xpub, networkType);
      const bitcoinNetwork = networkType === 'mainnet'
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

      try {
        const node = bip32.fromBase58(standardXpub, bitcoinNetwork);
        wallet.cosignerNodes.set(cosigner.id, node);
      } catch (error) {
        console.error(`Failed to parse xpub for cosigner ${cosigner.name}:`, error);
      }
    }

    return wallet;
  }

  /**
   * Add a cosigner to the multisig configuration
   */
  addCosigner(info: Omit<CosignerInfo, 'id'>): string {
    if (this.config.cosigners.length >= this.config.n) {
      throw new Error(`Maximum ${this.config.n} cosigners allowed`);
    }

    // Generate unique ID
    const id = `cosigner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const cosigner: CosignerInfo = {
      id,
      ...info,
    };

    this.config.cosigners.push(cosigner);

    // Initialize the BIP32 node for this cosigner
    const standardXpub = MultisigWallet.convertToStandardXpub(info.xpub, this.networkType);
    const node = bip32.fromBase58(standardXpub, this.network);
    this.cosignerNodes.set(id, node);

    return id;
  }

  /**
   * Remove a cosigner from the configuration
   */
  removeCosigner(cosignerId: string): boolean {
    const index = this.config.cosigners.findIndex(c => c.id === cosignerId);
    if (index === -1) {
      return false;
    }

    this.config.cosigners.splice(index, 1);
    this.cosignerNodes.delete(cosignerId);
    return true;
  }

  /**
   * Update cosigner information
   */
  updateCosigner(cosignerId: string, updates: Partial<Omit<CosignerInfo, 'id'>>): boolean {
    const cosigner = this.config.cosigners.find(c => c.id === cosignerId);
    if (!cosigner) {
      return false;
    }

    Object.assign(cosigner, updates);

    // Update node if xpub changed
    if (updates.xpub) {
      const standardXpub = MultisigWallet.convertToStandardXpub(updates.xpub, this.networkType);
      const node = bip32.fromBase58(standardXpub, this.network);
      this.cosignerNodes.set(cosignerId, node);
    }

    return true;
  }

  /**
   * Get all cosigners
   */
  getCosigners(): CosignerInfo[] {
    return [...this.config.cosigners];
  }

  /**
   * Get the multisig configuration
   */
  getConfig(): MultisigConfig {
    return { ...this.config };
  }

  /**
   * Check if the configuration is complete (has all required cosigners)
   */
  isComplete(): boolean {
    return this.config.cosigners.length === this.config.n;
  }

  /**
   * Check if we have any local signing capability
   */
  hasLocalSigner(): boolean {
    return this.config.cosigners.some(c => c.isLocal);
  }

  /**
   * Get local cosigners (ones we can sign with)
   */
  getLocalCosigners(): CosignerInfo[] {
    return this.config.cosigners.filter(c => c.isLocal);
  }

  /**
   * Derive a multisig address at a specific index
   */
  deriveAddress(index: number, isChange: boolean = false): MultisigAddressInfo {
    if (!this.isComplete()) {
      throw new Error('Multisig configuration is incomplete');
    }

    const chain = isChange ? DERIVATION.INTERNAL_CHAIN : DERIVATION.EXTERNAL_CHAIN;

    // Collect public keys from all cosigners WITH their fingerprints
    const pubkeyWithFingerprint: Array<{ pubkey: Buffer; fingerprint: string }> = [];

    for (const cosigner of this.config.cosigners) {
      const node = this.cosignerNodes.get(cosigner.id);
      if (!node) {
        throw new Error(`Missing node for cosigner ${cosigner.name}`);
      }

      const childNode = node.derive(chain).derive(index);
      pubkeyWithFingerprint.push({
        pubkey: Buffer.from(childNode.publicKey),
        fingerprint: cosigner.fingerprint,
      });
    }

    // Sort keys if using sortedmulti (keeping the fingerprint association)
    const orderedPubkeys = this.config.sortedKeys
      ? pubkeyWithFingerprint.sort((a, b) => Buffer.compare(a.pubkey, b.pubkey))
      : pubkeyWithFingerprint;

    // Build the pubkey-to-fingerprint mapping
    const pubkeyToFingerprint = new Map<string, string>();
    for (const { pubkey, fingerprint } of orderedPubkeys) {
      pubkeyToFingerprint.set(pubkey.toString('hex'), fingerprint);
    }

    // Extract just the pubkeys for the ordered array
    const orderedKeys = orderedPubkeys.map(p => p.pubkey);

    // Generate the multisig address based on script type
    const { address, redeemScript, witnessScript } = this.generateMultisigAddress(orderedKeys);

    const path = `${this.config.derivationPath}/${chain}/${index}`;

    return {
      address,
      path,
      index,
      isChange,
      type: this.getAddressType(),
      redeemScript,
      witnessScript,
      publicKeys: orderedKeys,
      pubkeyToFingerprint,
    };
  }

  /**
   * Generate multisig address from public keys
   */
  private generateMultisigAddress(publicKeys: Buffer[]): {
    address: string;
    redeemScript?: Buffer;
    witnessScript?: Buffer;
  } {
    const { m } = this.config;

    // Create the multisig payment
    const p2ms = bitcoin.payments.p2ms({
      m,
      pubkeys: publicKeys,
      network: this.network,
    });

    switch (this.config.scriptType) {
      case MULTISIG_SCRIPT_TYPES.P2SH: {
        // Legacy P2SH multisig
        const p2sh = bitcoin.payments.p2sh({
          redeem: p2ms,
          network: this.network,
        });
        return {
          address: p2sh.address!,
          redeemScript: p2sh.redeem?.output ? Buffer.from(p2sh.redeem.output) : undefined,
        };
      }

      case MULTISIG_SCRIPT_TYPES.P2WSH: {
        // Native SegWit P2WSH multisig
        const p2wsh = bitcoin.payments.p2wsh({
          redeem: p2ms,
          network: this.network,
        });
        return {
          address: p2wsh.address!,
          witnessScript: p2wsh.redeem?.output ? Buffer.from(p2wsh.redeem.output) : undefined,
        };
      }

      case MULTISIG_SCRIPT_TYPES.P2SH_P2WSH: {
        // Wrapped SegWit P2SH-P2WSH multisig
        const p2wsh = bitcoin.payments.p2wsh({
          redeem: p2ms,
          network: this.network,
        });
        const p2sh = bitcoin.payments.p2sh({
          redeem: p2wsh,
          network: this.network,
        });
        return {
          address: p2sh.address!,
          redeemScript: p2sh.redeem?.output ? Buffer.from(p2sh.redeem.output) : undefined,
          witnessScript: p2wsh.redeem?.output ? Buffer.from(p2wsh.redeem.output) : undefined,
        };
      }

      default:
        throw new Error(`Unknown script type: ${this.config.scriptType}`);
    }
  }

  /**
   * Get address type based on script type
   */
  private getAddressType(): 'native_segwit' | 'wrapped_segwit' | 'legacy' | 'taproot' {
    switch (this.config.scriptType) {
      case MULTISIG_SCRIPT_TYPES.P2WSH:
        return ADDRESS_TYPES.NATIVE_SEGWIT;
      case MULTISIG_SCRIPT_TYPES.P2SH_P2WSH:
        return ADDRESS_TYPES.WRAPPED_SEGWIT;
      case MULTISIG_SCRIPT_TYPES.P2SH:
        return ADDRESS_TYPES.LEGACY;
      default:
        return ADDRESS_TYPES.NATIVE_SEGWIT;
    }
  }

  /**
   * Derive multiple receiving addresses
   */
  deriveReceivingAddresses(count: number, startIndex: number = 0): MultisigAddressInfo[] {
    const addresses: MultisigAddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveAddress(startIndex + i, false));
    }
    return addresses;
  }

  /**
   * Derive multiple change addresses
   */
  deriveChangeAddresses(count: number, startIndex: number = 0): MultisigAddressInfo[] {
    const addresses: MultisigAddressInfo[] = [];
    for (let i = 0; i < count; i++) {
      addresses.push(this.deriveAddress(startIndex + i, true));
    }
    return addresses;
  }

  /**
   * Generate the output descriptor for this multisig wallet
   */
  getDescriptor(isChange: boolean = false): string {
    if (!this.isComplete()) {
      throw new Error('Multisig configuration is incomplete');
    }

    const keys = this.config.cosigners.map(cosigner => ({
      fingerprint: cosigner.fingerprint,
      derivationPath: cosigner.derivationPath,
      xpub: cosigner.xpub,
    }));

    const scriptType = this.config.scriptType === MULTISIG_SCRIPT_TYPES.P2SH
      ? 'p2sh'
      : this.config.scriptType === MULTISIG_SCRIPT_TYPES.P2WSH
        ? 'p2wsh'
        : 'p2sh-p2wsh';

    return createMultisigDescriptor(
      this.config.m,
      keys,
      scriptType,
      this.config.sortedKeys,
      isChange ? 1 : 0,
      true // with checksum
    );
  }

  /**
   * Create a PSBT for spending from this multisig
   */
  createPSBT(
    recipients: Array<{ address: string; amount: number }>,
    utxos: Array<UTXO & { addressInfo: MultisigAddressInfo }>,
    feeRate: number,
    changeIndex?: number
  ): bitcoin.Psbt {
    if (recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }

    if (utxos.length === 0) {
      throw new Error('At least one UTXO is required');
    }

    const psbt = new bitcoin.Psbt({ network: this.network });

    // Calculate totals
    const totalOutput = recipients.reduce((sum, r) => sum + r.amount, 0);
    const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);

    // Estimate fee (simplified)
    const inputVBytes = utxos.length * 100; // Rough estimate for multisig inputs
    const outputVBytes = (recipients.length + 1) * 32;
    const fee = Math.ceil((inputVBytes + outputVBytes + 10) * feeRate);

    const change = totalInput - totalOutput - fee;

    if (change < 0) {
      throw new Error('Insufficient funds');
    }

    // Add inputs
    for (const utxo of utxos) {
      const outputScript = bitcoin.address.toOutputScript(utxo.address, this.network);

      const inputData: any = {
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: outputScript,
          value: BigInt(utxo.value),
        },
      };

      // Add scripts based on type
      if (utxo.addressInfo.witnessScript) {
        inputData.witnessScript = utxo.addressInfo.witnessScript;
      }
      if (utxo.addressInfo.redeemScript) {
        inputData.redeemScript = utxo.addressInfo.redeemScript;
      }

      // Add BIP32 derivation info for each pubkey using the correct fingerprint
      // IMPORTANT: publicKeys are in SORTED order (due to sortedmulti), so we must use
      // the pubkeyToFingerprint map to get the correct fingerprint for each pubkey
      const bip32Derivation = [];
      for (const pubkey of utxo.addressInfo.publicKeys) {
        const pubkeyHex = pubkey.toString('hex');
        const fingerprint = utxo.addressInfo.pubkeyToFingerprint?.get(pubkeyHex);

        if (fingerprint) {
          // Find the cosigner with this fingerprint to get the correct derivation path
          const cosigner = this.config.cosigners.find(c => c.fingerprint === fingerprint);
          if (cosigner) {
            bip32Derivation.push({
              masterFingerprint: Buffer.from(fingerprint, 'hex'),
              pubkey: pubkey,
              path: utxo.addressInfo.path,
            });
          }
        }
      }
      inputData.bip32Derivation = bip32Derivation;

      psbt.addInput(inputData);
    }

    // Add recipient outputs
    for (const recipient of recipients) {
      psbt.addOutput({
        address: recipient.address,
        value: BigInt(recipient.amount),
      });
    }

    // Add change output if needed
    if (change > 546 && changeIndex !== undefined) {
      const changeAddr = this.deriveAddress(changeIndex, true);
      psbt.addOutput({
        address: changeAddr.address,
        value: BigInt(change),
      });
    }

    return psbt;
  }

  /**
   * Export configuration for sharing with cosigners
   * Can be used to import into other wallets
   */
  exportConfig(): string {
    const exportData = {
      version: 1,
      format: 'multisig-config',
      config: this.config,
      network: this.networkType,
      descriptor: this.isComplete() ? this.getDescriptor(false) : null,
      changeDescriptor: this.isComplete() ? this.getDescriptor(true) : null,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import configuration from shared export
   */
  static importConfig(json: string, networkType?: NetworkType): MultisigWallet {
    const data = JSON.parse(json);

    if (data.format !== 'multisig-config') {
      throw new Error('Invalid config format');
    }

    const network = networkType || data.network || 'mainnet';
    return MultisigWallet.fromConfig(data.config, network);
  }

  /**
   * Convert special format xpub to standard format
   */
  private static convertToStandardXpub(xpub: string, network: NetworkType): string {
    const VERSION_BYTES: Record<string, Buffer> = {
      xpub: Buffer.from('0488b21e', 'hex'),
      ypub: Buffer.from('049d7cb2', 'hex'),
      zpub: Buffer.from('04b24746', 'hex'),
      Ypub: Buffer.from('0295b43f', 'hex'),
      Zpub: Buffer.from('02aa7ed3', 'hex'),
      tpub: Buffer.from('043587cf', 'hex'),
      upub: Buffer.from('044a5262', 'hex'),
      vpub: Buffer.from('045f1cf6', 'hex'),
      Upub: Buffer.from('024289ef', 'hex'),
      Vpub: Buffer.from('02575483', 'hex'),
    };

    const STANDARD_VERSION = network === 'mainnet'
      ? VERSION_BYTES.xpub
      : VERSION_BYTES.tpub;

    const prefix = xpub.slice(0, 4);

    if (prefix === 'xpub' || prefix === 'tpub') {
      return xpub;
    }

    const data = bs58check.decode(xpub);
    const newData = Buffer.concat([STANDARD_VERSION, data.slice(4)]);
    return bs58check.encode(newData);
  }

  /**
   * Find an address in this wallet
   */
  findAddress(address: string, maxIndex: number = 100): MultisigAddressInfo | null {
    if (!this.isComplete()) {
      return null;
    }

    // Check cache first (instant lookup)
    const cached = this.addressCache.get(address);
    if (cached) return cached;

    // Populate cache up to maxIndex if not already done
    // Only derive addresses we haven't cached yet
    const startIndex = this.addressCacheMaxIndex;
    if (startIndex < maxIndex) {
      for (let i = startIndex; i < maxIndex; i++) {
        const recv = this.deriveAddress(i, false);
        this.addressCache.set(recv.address, recv);
        const change = this.deriveAddress(i, true);
        this.addressCache.set(change.address, change);
      }
      this.addressCacheMaxIndex = maxIndex;
    }

    // Check cache again after population
    return this.addressCache.get(address) || null;
  }

  /**
   * Get the network type
   */
  getNetworkType(): NetworkType {
    return this.networkType;
  }

  /**
   * Validate that the configuration is internally consistent
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.config.m < 1) {
      errors.push('Threshold must be at least 1');
    }

    if (this.config.m > this.config.n) {
      errors.push('Threshold cannot exceed total signers');
    }

    if (this.config.n < 2 || this.config.n > 15) {
      errors.push('Total signers must be between 2 and 15');
    }

    if (this.config.cosigners.length > this.config.n) {
      errors.push('Too many cosigners for configuration');
    }

    // Check for duplicate fingerprints
    const fingerprints = new Set<string>();
    for (const cosigner of this.config.cosigners) {
      if (fingerprints.has(cosigner.fingerprint)) {
        errors.push(`Duplicate fingerprint: ${cosigner.fingerprint}`);
      }
      fingerprints.add(cosigner.fingerprint);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
