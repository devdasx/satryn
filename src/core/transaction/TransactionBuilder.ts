import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { KeyDerivation } from '../wallet/KeyDerivation';
import { ImportedKeySigner } from '../wallet/ImportedKeySigner';
import { UTXOSelector } from './UTXOSelector';
import { ADDRESS_TYPES } from '../../constants';
import type { UTXO, PreparedTransaction, AddressType } from '../../types';

// Initialize bitcoinjs-lib with ecc
bitcoin.initEccLib(ecc);

interface BuildTransactionParams {
  recipientAddress: string;
  amount: number; // in satoshis
  utxos: UTXO[];
  changeAddress: string;
  feeRate: number; // sat/vB
  inputPaths: Map<string, string>; // address -> derivation path
  /** Signal RBF on inputs (sequence 0xFFFFFFFD). Default: true */
  enableRBF?: boolean;
}

interface RecipientOutput {
  address: string;
  amount: number; // in satoshis
}

interface BuildMultiRecipientParams {
  recipients: RecipientOutput[];
  utxos: UTXO[];
  changeAddress: string;
  feeRate: number; // sat/vB
  inputPaths: Map<string, string>; // address -> derivation path
  /** Signal RBF on inputs (sequence 0xFFFFFFFD). Default: true */
  enableRBF?: boolean;
}

interface SignedTransaction {
  hex: string;
  txid: string;
  fee: number;
}

interface InputData {
  utxo: UTXO;
  path: string;
  type: AddressType;
}

/**
 * Bitcoin Transaction Builder
 * Builds and signs transactions using PSBT format
 * Supports P2TR (Taproot), P2WPKH (Native SegWit), P2SH-P2WPKH (Wrapped SegWit), and P2PKH (Legacy)
 */
export class TransactionBuilder {
  private network: bitcoin.Network;

  constructor(networkType: 'mainnet' | 'testnet' = 'testnet') {
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
  }

  /**
   * Validate a Bitcoin address
   * @param address - Address to validate
   * @returns Whether the address is valid for this network
   */
  validateAddress(address: string): boolean {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (err) {
      // validateAddress failed
      return false;
    }
  }

  /**
   * Detect the address type from an address string
   * @param address - The Bitcoin address
   * @returns The address type
   */
  private detectAddressType(address: string): AddressType {
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
    // Legacy addresses: 1... (mainnet), m.../n... (testnet)
    return ADDRESS_TYPES.LEGACY;
  }

  /**
   * Convert a 33-byte compressed public key to a 32-byte x-only public key
   * @param pubkey - 33-byte compressed public key
   * @returns 32-byte x-only public key
   */
  private toXOnlyPublicKey(pubkey: Buffer): Buffer {
    return pubkey.slice(1, 33);
  }

  /**
   * Add an input to the PSBT based on address type
   * @param psbt - The PSBT to add input to
   * @param utxo - The UTXO to spend
   * @param keyDerivation - KeyDerivation instance for getting public keys
   * @param path - Derivation path for this input
   */
  private addInput(
    psbt: bitcoin.Psbt,
    utxo: UTXO,
    keyDerivation?: KeyDerivation,
    path?: string,
    enableRBF: boolean = true
  ): void {
    const addressType = this.detectAddressType(utxo.address);
    const outputScript = bitcoin.address.toOutputScript(utxo.address, this.network);
    // RBF: sequence 0xFFFFFFFD signals opt-in RBF (BIP 125)
    // Non-RBF: sequence 0xFFFFFFFF (default, disables RBF)
    const sequence = enableRBF ? 0xfffffffd : 0xffffffff;

    switch (addressType) {
      case ADDRESS_TYPES.TAPROOT: {
        // P2TR - Taproot
        // For Taproot key-path spending, we need:
        // - witnessUtxo with script and value
        // - tapInternalKey (the 32-byte x-only internal public key)
        if (keyDerivation && path) {
          const internalPubkey = keyDerivation.getTaprootInternalPubkey(path);
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence,
            witnessUtxo: {
              script: outputScript,
              value: BigInt(utxo.value),
            },
            tapInternalKey: internalPubkey,
          });
        } else {
          // Without key derivation, we can't set tapInternalKey
          // This input won't be signable without additional info
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence,
            witnessUtxo: {
              script: outputScript,
              value: BigInt(utxo.value),
            },
          });
        }
        break;
      }

      case ADDRESS_TYPES.NATIVE_SEGWIT: {
        // P2WPKH - Native SegWit
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence,
          witnessUtxo: {
            script: outputScript,
            value: BigInt(utxo.value),
          },
        });
        break;
      }

      case ADDRESS_TYPES.WRAPPED_SEGWIT: {
        // P2SH-P2WPKH - Wrapped SegWit
        // Need to include the redeemScript
        if (keyDerivation && path) {
          const redeemScript = keyDerivation.getRedeemScript(path);
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence,
            witnessUtxo: {
              script: outputScript,
              value: BigInt(utxo.value),
            },
            redeemScript: redeemScript,
          });
        } else {
          // Fallback without redeemScript - will need to be added during signing
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence,
            witnessUtxo: {
              script: outputScript,
              value: BigInt(utxo.value),
            },
          });
        }
        break;
      }

      case ADDRESS_TYPES.LEGACY: {
        // P2PKH - Legacy
        // Legacy inputs MUST use nonWitnessUtxo (full previous tx buffer)
        // because P2PKH is not a SegWit script type.
        if (utxo.rawTxHex) {
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence,
            nonWitnessUtxo: Buffer.from(utxo.rawTxHex, 'hex'),
          });
        } else {
          // Legacy UTXOs MUST have rawTxHex — callers must pre-fetch via enrichLegacyUtxos()
          // or ElectrumAPI.getRawTransactionHexBatch() before building.
          throw new Error(
            `Legacy UTXO ${utxo.txid}:${utxo.vout} is missing rawTxHex. ` +
            `Legacy (P2PKH) inputs require the full raw transaction for signing. ` +
            `Pre-fetch with ElectrumAPI.getRawTransactionHexBatch() before building.`
          );
        }
        break;
      }
    }
  }

  /**
   * Build an unsigned transaction (PSBT)
   * @param params - Transaction parameters
   * @returns Prepared transaction info
   */
  build(params: BuildTransactionParams): { psbt: bitcoin.Psbt; info: PreparedTransaction } {
    const { recipientAddress, amount, utxos, changeAddress, feeRate, enableRBF = true } = params;

    // Validate addresses
    if (!this.validateAddress(recipientAddress)) {
      throw new Error(`Invalid recipient address: ${recipientAddress}`);
    }
    if (!this.validateAddress(changeAddress)) {
      throw new Error(`Invalid change address: ${changeAddress?.slice(0, 20)}...`);
    }

    // Select UTXOs
    const selection = UTXOSelector.select(utxos, amount, feeRate);
    if (!selection) {
      throw new Error('Insufficient funds');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add inputs
    for (const utxo of selection.inputs) {
      this.addInput(psbt, utxo, undefined, undefined, enableRBF);
    }

    // Add recipient output
    psbt.addOutput({
      address: recipientAddress,
      value: BigInt(amount),
    });

    // Add change output if needed
    if (selection.change > 0) {
      psbt.addOutput({
        address: changeAddress,
        value: BigInt(selection.change),
      });
    }

    const info: PreparedTransaction = {
      hex: '', // Will be set after signing
      fee: selection.fee,
      inputTotal: selection.inputTotal,
      outputTotal: amount + selection.change,
      changeAmount: selection.change,
    };

    return { psbt, info };
  }

  /**
   * Build an unsigned transaction with multiple recipient outputs
   * @param params - Transaction parameters with multiple recipients
   * @returns Prepared transaction info
   */
  buildMultiRecipient(params: BuildMultiRecipientParams): { psbt: bitcoin.Psbt; info: PreparedTransaction } {
    const { recipients, utxos, changeAddress, feeRate, enableRBF = true } = params;

    if (recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }

    // Validate all recipient addresses
    for (const r of recipients) {
      if (!this.validateAddress(r.address)) {
        throw new Error(`Invalid recipient address: ${r.address}`);
      }
    }
    if (!this.validateAddress(changeAddress)) {
      throw new Error(`Invalid change address: ${changeAddress?.slice(0, 20)}...`);
    }

    // Total amount across all recipients
    const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

    // Select UTXOs for the total amount
    const outputCount = recipients.length + 1; // recipients + change
    const selection = UTXOSelector.select(utxos, totalAmount, feeRate, true);
    if (!selection) {
      throw new Error('Insufficient funds');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add inputs
    for (const utxo of selection.inputs) {
      this.addInput(psbt, utxo, undefined, undefined, enableRBF);
    }

    // Add all recipient outputs
    for (const r of recipients) {
      psbt.addOutput({
        address: r.address,
        value: BigInt(r.amount),
      });
    }

    // Add change output if needed
    if (selection.change > 0) {
      psbt.addOutput({
        address: changeAddress,
        value: BigInt(selection.change),
      });
    }

    const info: PreparedTransaction = {
      hex: '', // Will be set after signing
      fee: selection.fee,
      inputTotal: selection.inputTotal,
      outputTotal: totalAmount + selection.change,
      changeAmount: selection.change,
    };

    return { psbt, info };
  }

  /**
   * Build a "send max" transaction that spends all UTXOs with no change
   * @param params - Transaction parameters (amount will be calculated)
   * @returns Prepared transaction info
   */
  buildSendMax(params: Omit<BuildTransactionParams, 'changeAddress'>): { psbt: bitcoin.Psbt; info: PreparedTransaction; sendAmount: number } {
    const { recipientAddress, utxos, feeRate, enableRBF = true } = params;

    // Validate addresses
    if (!this.validateAddress(recipientAddress)) {
      throw new Error(`Invalid recipient address: ${recipientAddress}`);
    }

    if (utxos.length === 0) {
      throw new Error('No UTXOs available');
    }

    // Calculate total value and fee
    const totalValue = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
    const vSize = UTXOSelector.estimateVSize(utxos.length, 1); // 1 output only (no change)
    const fee = UTXOSelector.calculateFee(vSize, feeRate);
    const sendAmount = totalValue - fee;

    if (sendAmount <= 0) {
      throw new Error('Insufficient funds after fee deduction');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add ALL inputs
    for (const utxo of utxos) {
      this.addInput(psbt, utxo, undefined, undefined, enableRBF);
    }

    // Add single recipient output (no change)
    psbt.addOutput({
      address: recipientAddress,
      value: BigInt(sendAmount),
    });

    const info: PreparedTransaction = {
      hex: '', // Will be set after signing
      fee,
      inputTotal: totalValue,
      outputTotal: sendAmount,
      changeAmount: 0,
    };

    return { psbt, info, sendAmount };
  }

  /**
   * Sign a PSBT with the provided key derivation instance
   * Handles P2TR (Taproot), P2WPKH, P2SH-P2WPKH, and P2PKH inputs
   * @param psbt - The PSBT to sign
   * @param keyDerivation - KeyDerivation instance with the seed
   * @param inputPaths - Array of derivation paths for each input
   * @returns The signed transaction hex
   */
  sign(
    psbt: bitcoin.Psbt,
    keyDerivation: KeyDerivation,
    inputPaths: string[]
  ): SignedTransaction {
    // Sign each input
    for (let i = 0; i < inputPaths.length; i++) {
      this.signSingleInput(psbt, keyDerivation, inputPaths[i], i);
    }

    // Finalize all inputs
    psbt.finalizeAllInputs();

    // Extract the transaction
    const tx = psbt.extractTransaction();

    return {
      hex: tx.toHex(),
      txid: tx.getId(),
      fee: 0, // Fee should be tracked from the build step
    };
  }

  /**
   * Async version of sign() that yields to the event loop every 2 inputs.
   * Prevents UI freezing during signing of transactions with many inputs.
   */
  async signAsync(
    psbt: bitcoin.Psbt,
    keyDerivation: KeyDerivation,
    inputPaths: string[]
  ): Promise<SignedTransaction> {
    // Sign each input, yielding every 2 to keep UI responsive
    for (let i = 0; i < inputPaths.length; i++) {
      this.signSingleInput(psbt, keyDerivation, inputPaths[i], i);
      if (i % 2 === 1 && i < inputPaths.length - 1) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    // Finalize all inputs
    psbt.finalizeAllInputs();

    // Extract the transaction
    const tx = psbt.extractTransaction();

    return {
      hex: tx.toHex(),
      txid: tx.getId(),
      fee: 0, // Fee should be tracked from the build step
    };
  }

  /**
   * Sign a single PSBT input (shared between sync and async sign methods)
   */
  private signSingleInput(
    psbt: bitcoin.Psbt,
    keyDerivation: KeyDerivation,
    path: string,
    inputIndex: number
  ): void {
    const input = psbt.data.inputs[inputIndex];

    // Check if this is a Taproot input (BIP86 path: m/86'/...)
    const isTaproot = path.includes("/86'/") || input.tapInternalKey;

    if (isTaproot) {
      // Taproot signing using Schnorr signatures
      const taprootKeyPair = keyDerivation.getTaprootKeyPair(path);

      // Update the tapInternalKey if not already set
      if (!input.tapInternalKey) {
        psbt.updateInput(inputIndex, { tapInternalKey: taprootKeyPair.internalPubkey });
      }

      // Create a Taproot signer with both sign and signSchnorr
      // IMPORTANT: publicKey must use the tweaked output key (not internal key)
      // because bitcoinjs-lib compares toXOnly(publicKey) against the P2TR output key
      const taprootSigner = {
        publicKey: Buffer.concat([Buffer.from([0x02]), taprootKeyPair.tweakedPubkey]),
        sign: (hash: Buffer): Buffer => {
          return taprootKeyPair.signSchnorr(hash);
        },
        signSchnorr: (hash: Buffer): Buffer => {
          return taprootKeyPair.signSchnorr(hash);
        },
      };

      // Sign the Taproot input
      psbt.signTaprootInput(inputIndex, taprootSigner as any);

      // Clear sensitive data
      taprootKeyPair.privateKey.fill(0);
      taprootKeyPair.tweakedPrivateKey.fill(0);
    } else {
      // Non-Taproot signing (ECDSA)
      const keyPair = keyDerivation.getSigningKeyPair(path);

      // Create a signer object
      const signer = {
        publicKey: Buffer.from(keyPair.publicKey),
        sign: (hash: Buffer): Buffer => {
          return Buffer.from(keyPair.sign(hash));
        },
      };

      // Check if this input needs a redeemScript (P2SH-P2WPKH)
      if (!input.redeemScript) {
        // Check if it's a wrapped segwit address by looking at the path
        // BIP49 paths start with m/49'/
        if (path.includes("/49'/")) {
          const redeemScript = keyDerivation.getRedeemScript(path);
          psbt.updateInput(inputIndex, { redeemScript });
        }
      }

      psbt.signInput(inputIndex, signer);

      // Clear the private key from memory immediately
      keyPair.privateKey.fill(0);
    }
  }

  /**
   * Sign a PSBT using an imported single private key (WIF)
   * This is for wallets that have a single imported private key rather than HD derivation.
   * All inputs are signed with the same key.
   *
   * @param psbt - The PSBT to sign
   * @param importedKeySigner - ImportedKeySigner instance with the private key
   * @returns The signed transaction hex
   */
  signWithImportedKey(
    psbt: bitcoin.Psbt,
    importedKeySigner: ImportedKeySigner
  ): SignedTransaction {
    // Sign each input with the same key.
    // Detect address type PER INPUT from the PSBT witness data, because an
    // imported-key wallet may hold UTXOs on different address types (native
    // segwit, taproot, wrapped segwit, legacy) derived from the same key.
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i];

      // Determine if this specific input is Taproot by inspecting PSBT fields:
      // - tapInternalKey is set for Taproot inputs added via addInput()
      // - witnessUtxo script starting with 0x51 (OP_1) indicates P2TR output
      const isTaprootInput = !!input.tapInternalKey || (
        input.witnessUtxo?.script &&
        input.witnessUtxo.script.length === 34 &&
        input.witnessUtxo.script[0] === 0x51
      );

      if (isTaprootInput) {
        // Taproot signing using Schnorr signatures
        // getTaprootKeyPair() creates Buffer copies internally, so safe across iterations
        const taprootKeyPair = importedKeySigner.getTaprootKeyPairFromRawKey();

        // Update the tapInternalKey if not already set
        if (!input.tapInternalKey) {
          psbt.updateInput(i, { tapInternalKey: taprootKeyPair.internalPubkey });
        }

        // Create a Taproot signer with both sign and signSchnorr
        // IMPORTANT: publicKey must use the tweaked output key (not internal key)
        const taprootSigner = {
          publicKey: Buffer.concat([Buffer.from([0x02]), taprootKeyPair.tweakedPubkey]),
          sign: (hash: Buffer): Buffer => {
            return taprootKeyPair.signSchnorr(hash);
          },
          signSchnorr: (hash: Buffer): Buffer => {
            return taprootKeyPair.signSchnorr(hash);
          },
        };

        // Sign the Taproot input
        psbt.signTaprootInput(i, taprootSigner as any);

        // Clear copies only (original key is preserved for remaining inputs)
        taprootKeyPair.privateKey.fill(0);
        taprootKeyPair.tweakedPrivateKey.fill(0);
      } else {
        // Non-Taproot signing (ECDSA)
        // getSigningKeyPair() returns a reference to the internal key — do NOT
        // zero it here; we need it intact for subsequent inputs.
        const keyPair = importedKeySigner.getSigningKeyPair();

        // Create a signer object
        const signer = {
          publicKey: Buffer.from(keyPair.publicKey),
          sign: (hash: Buffer): Buffer => {
            return Buffer.from(keyPair.sign(hash));
          },
        };

        // Check if this input needs a redeemScript (P2SH-P2WPKH)
        // Detect wrapped segwit from the witnessUtxo script: P2SH scripts are
        // OP_HASH160 <20-byte-hash> OP_EQUAL (0xa914...87), length 23
        const isWrappedSegwit = !input.redeemScript &&
          input.witnessUtxo?.script &&
          input.witnessUtxo.script.length === 23 &&
          input.witnessUtxo.script[0] === 0xa9;

        if (isWrappedSegwit) {
          const redeemScript = importedKeySigner.getRedeemScriptForKey();
          psbt.updateInput(i, { redeemScript });
        }

        psbt.signInput(i, signer);
      }
    }

    // Clear the private key from memory AFTER all inputs are signed
    importedKeySigner.destroy();

    // Finalize all inputs
    psbt.finalizeAllInputs();

    // Extract the transaction
    const tx = psbt.extractTransaction();

    return {
      hex: tx.toHex(),
      txid: tx.getId(),
      fee: 0, // Fee should be tracked from the build step
    };
  }

  /**
   * Build and sign a transaction in one step
   * @param params - Transaction parameters
   * @param keyDerivation - KeyDerivation instance
   * @returns Signed transaction
   */
  buildAndSign(
    params: BuildTransactionParams,
    keyDerivation: KeyDerivation
  ): SignedTransaction & PreparedTransaction {
    const { psbt, info } = this.build(params);

    // Get derivation paths for inputs
    const inputPaths: string[] = [];
    for (const utxo of params.utxos) {
      const path = params.inputPaths.get(utxo.address);
      if (!path) {
        throw new Error(`No derivation path for address ${utxo.address}`);
      }
      inputPaths.push(path);
    }

    const signed = this.sign(psbt, keyDerivation, inputPaths);

    return {
      ...info,
      ...signed,
      fee: info.fee,
    };
  }

  /**
   * Estimate the fee for a transaction
   * @param inputCount - Number of inputs
   * @param outputCount - Number of outputs (including change)
   * @param feeRate - Fee rate in sat/vB
   * @returns Estimated fee in satoshis
   */
  static estimateFee(
    inputCount: number,
    outputCount: number,
    feeRate: number
  ): number {
    const vSize = UTXOSelector.estimateVSize(inputCount, outputCount);
    return UTXOSelector.calculateFee(vSize, feeRate);
  }

  /**
   * Parse a Bitcoin URI (BIP21)
   * @param uri - The BIP21 URI
   * @returns Parsed address and optional amount/label
   */
  static parseBitcoinUri(uri: string): {
    address: string;
    amount?: number;
    label?: string;
    message?: string;
  } {
    // bitcoin:address?amount=0.001&label=Label&message=Message
    const match = uri.match(/^bitcoin:([a-zA-Z0-9]+)(\?.*)?$/i);
    if (!match) {
      // Might just be an address
      return { address: uri };
    }

    const address = match[1];
    const result: ReturnType<typeof TransactionBuilder.parseBitcoinUri> = { address };

    if (match[2]) {
      const params = new URLSearchParams(match[2]);

      const amountStr = params.get('amount');
      if (amountStr) {
        // Amount in BIP21 is in BTC, convert to satoshis
        result.amount = Math.round(parseFloat(amountStr) * 100000000);
      }

      const label = params.get('label');
      if (label) {
        result.label = decodeURIComponent(label);
      }

      const message = params.get('message');
      if (message) {
        result.message = decodeURIComponent(message);
      }
    }

    return result;
  }

  /**
   * Create a Bitcoin URI (BIP21)
   * @param address - Bitcoin address
   * @param amount - Optional amount in satoshis
   * @param label - Optional label
   * @param message - Optional message
   * @returns BIP21 URI
   */
  static createBitcoinUri(
    address: string,
    amount?: number,
    label?: string,
    message?: string
  ): string {
    let uri = `bitcoin:${address}`;
    const params: string[] = [];

    if (amount && amount > 0) {
      // Convert satoshis to BTC
      const btcAmount = (amount / 100000000).toFixed(8);
      params.push(`amount=${btcAmount}`);
    }

    if (label) {
      params.push(`label=${encodeURIComponent(label)}`);
    }

    if (message) {
      params.push(`message=${encodeURIComponent(message)}`);
    }

    if (params.length > 0) {
      uri += '?' + params.join('&');
    }

    return uri;
  }
}
