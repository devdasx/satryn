/**
 * PSBT Service
 * Provides comprehensive PSBT (Partially Signed Bitcoin Transactions) handling
 *
 * Features:
 * - Create unsigned PSBTs
 * - Import PSBTs from base64/hex
 * - Export PSBTs to base64/hex
 * - Sign PSBTs with local keys
 * - Combine partial signatures
 * - Finalize and extract transactions
 * - Analyze PSBT details
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { KeyDerivation } from '../../core/wallet/KeyDerivation';
import { ADDRESS_TYPES, TRANSACTION } from '../../constants';
import type {
  UTXO,
  PSBTData,
  PSBTInput,
  PSBTOutput,
  PSBTAnalysis,
  TransactionRecipient,
  AddressType,
} from '../../types';

// Initialize bitcoinjs-lib with ecc
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

export interface PSBTCreateOptions {
  recipients: TransactionRecipient[];
  utxos: UTXO[];
  feeRate: number;
  changeAddress?: string;
  enableRBF?: boolean;
  locktime?: number;
}

export interface PSBTSignOptions {
  /** Specific input indices to sign (default: all inputs we can sign) */
  inputIndices?: number[];
  /** Derivation paths for each input (required for signing) */
  inputPaths: Map<string, string>; // address -> derivation path
}

/**
 * Multisig signature status information
 */
export interface MultisigSignatureStatus {
  requiredSigs: number;
  presentSigs: number;
  signers: Array<{
    fingerprint: string;
    name: string;
    hasSigned: boolean;
    isLocal: boolean;
  }>;
  canFinalize: boolean;
  isComplete: boolean;
}

/**
 * Multisig config for PSBT signing
 */
export interface MultisigPSBTConfig {
  m: number;
  n: number;
  cosigners: Array<{
    fingerprint: string;
    name: string;
    isLocal: boolean;
  }>;
}

/**
 * Address path info for multisig signing
 */
export interface MultisigAddressPathInfo {
  path: string;
  witnessScript?: Buffer;
  redeemScript?: Buffer;
}

/**
 * PSBT Service for handling Partially Signed Bitcoin Transactions
 */
export class PSBTService {
  private network: bitcoin.Network;
  private networkType: NetworkType;

  constructor(networkType: NetworkType = 'mainnet') {
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
  }

  /**
   * Create a new unsigned PSBT
   */
  createPSBT(options: PSBTCreateOptions): { psbt: bitcoin.Psbt; psbtData: PSBTData } {
    const {
      recipients,
      utxos,
      feeRate,
      changeAddress,
      enableRBF = true,
      locktime,
    } = options;

    if (recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }

    if (utxos.length === 0) {
      throw new Error('At least one UTXO is required');
    }

    // Calculate totals
    const totalOutput = recipients.reduce((sum, r) => sum + r.amount, 0);
    const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);

    // Estimate fee
    const outputCount = changeAddress ? recipients.length + 1 : recipients.length;
    const estimatedVSize = this.estimateVSize(utxos, outputCount);
    const fee = Math.ceil(estimatedVSize * feeRate);

    const change = totalInput - totalOutput - fee;

    if (change < 0) {
      throw new Error('Insufficient funds');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    if (locktime !== undefined) {
      psbt.setLocktime(locktime);
    }

    // Add inputs
    for (const utxo of utxos) {
      this.addInput(psbt, utxo, enableRBF);
    }

    // Add recipient outputs
    for (const recipient of recipients) {
      psbt.addOutput({
        address: recipient.address,
        value: BigInt(recipient.amount),
      });
    }

    // Add change output if needed
    if (change > TRANSACTION.DUST_THRESHOLD && changeAddress) {
      psbt.addOutput({
        address: changeAddress,
        value: BigInt(change),
      });
    }

    // Create PSBTData structure
    const psbtData = this.analyzePSBT(psbt);

    return { psbt, psbtData };
  }

  /**
   * Add an input to the PSBT based on address type
   */
  private addInput(psbt: bitcoin.Psbt, utxo: UTXO, enableRBF: boolean = true): void {
    const addressType = this.detectAddressType(utxo.address);
    const outputScript = bitcoin.address.toOutputScript(utxo.address, this.network);

    // Sequence for RBF: 0xFFFFFFFD enables RBF, 0xFFFFFFFF disables
    const sequence = enableRBF ? 0xfffffffd : 0xffffffff;

    if (addressType === ADDRESS_TYPES.LEGACY) {
      // P2PKH (Legacy) inputs MUST use nonWitnessUtxo (full raw tx)
      if (utxo.rawTxHex) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence,
          nonWitnessUtxo: Buffer.from(utxo.rawTxHex, 'hex'),
        });
      } else {
        throw new Error(
          `Legacy UTXO ${utxo.txid}:${utxo.vout} is missing rawTxHex. ` +
          `Legacy (P2PKH) inputs require the full raw transaction for signing.`
        );
      }
    } else {
      // SegWit inputs (Taproot, Native SegWit, Wrapped SegWit) use witnessUtxo
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
  }

  /**
   * Import PSBT from base64 string
   */
  fromBase64(base64: string): bitcoin.Psbt {
    return bitcoin.Psbt.fromBase64(base64, { network: this.network });
  }

  /**
   * Import PSBT from hex string
   */
  fromHex(hex: string): bitcoin.Psbt {
    return bitcoin.Psbt.fromHex(hex, { network: this.network });
  }

  /**
   * Import PSBT from buffer
   */
  fromBuffer(buffer: Buffer): bitcoin.Psbt {
    return bitcoin.Psbt.fromBuffer(buffer, { network: this.network });
  }

  /**
   * Export PSBT to base64 string
   */
  toBase64(psbt: bitcoin.Psbt): string {
    return psbt.toBase64();
  }

  /**
   * Export PSBT to hex string
   */
  toHex(psbt: bitcoin.Psbt): string {
    return psbt.toHex();
  }

  /**
   * Export PSBT to buffer
   */
  toBuffer(psbt: bitcoin.Psbt): Buffer {
    return Buffer.from(psbt.toBuffer());
  }

  /**
   * Sign PSBT with local keys
   */
  signPSBT(
    psbt: bitcoin.Psbt,
    keyDerivation: KeyDerivation,
    options: PSBTSignOptions
  ): bitcoin.Psbt {
    const { inputIndices, inputPaths } = options;
    const indicesToSign = inputIndices || [...Array(psbt.inputCount).keys()];

    for (const index of indicesToSign) {
      const input = psbt.data.inputs[index];

      // Get the address from witnessUtxo or nonWitnessUtxo
      let address: string | undefined;
      if (input.witnessUtxo) {
        try {
          address = bitcoin.address.fromOutputScript(
            input.witnessUtxo.script,
            this.network
          );
        } catch { /* skip */ }
      } else if (input.nonWitnessUtxo) {
        // For Legacy inputs, extract the address from the referenced output
        try {
          const txInput = psbt.txInputs[index];
          const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
          const output = prevTx.outs[txInput.index];
          if (output) {
            address = bitcoin.address.fromOutputScript(output.script, this.network);
          }
        } catch { /* skip */ }
      }

      if (!address) continue;

      const path = inputPaths.get(address);
      if (!path) {
        // We don't have the key for this input
        continue;
      }

      const addressType = this.detectAddressType(address);

      if (addressType === ADDRESS_TYPES.TAPROOT) {
        // Taproot signing
        const taprootKeyPair = keyDerivation.getTaprootKeyPair(path);

        // Update tapInternalKey if not set
        if (!input.tapInternalKey) {
          psbt.updateInput(index, { tapInternalKey: taprootKeyPair.internalPubkey });
        }

        // IMPORTANT: publicKey must use the tweaked output key (not internal key)
        const taprootSigner = {
          publicKey: Buffer.concat([Buffer.from([0x02]), taprootKeyPair.tweakedPubkey]),
          sign: (hash: Buffer): Buffer => taprootKeyPair.signSchnorr(hash),
          signSchnorr: (hash: Buffer): Buffer => taprootKeyPair.signSchnorr(hash),
        };

        psbt.signTaprootInput(index, taprootSigner as any);

        // Clear sensitive data
        taprootKeyPair.privateKey.fill(0);
        taprootKeyPair.tweakedPrivateKey.fill(0);
      } else {
        // ECDSA signing (P2WPKH, P2SH-P2WPKH, P2PKH)
        const keyPair = keyDerivation.getSigningKeyPair(path);

        const signer = {
          publicKey: Buffer.from(keyPair.publicKey),
          sign: (hash: Buffer): Buffer => Buffer.from(keyPair.sign(hash)),
        };

        // Add redeem script for wrapped segwit
        if (addressType === ADDRESS_TYPES.WRAPPED_SEGWIT && !input.redeemScript) {
          const redeemScript = keyDerivation.getRedeemScript(path);
          psbt.updateInput(index, { redeemScript });
        }

        psbt.signInput(index, signer);

        // Clear sensitive data
        keyPair.privateKey.fill(0);
      }
    }

    return psbt;
  }

  /**
   * Combine multiple partially signed PSBTs
   */
  combinePSBTs(psbts: bitcoin.Psbt[]): bitcoin.Psbt {
    if (psbts.length === 0) {
      throw new Error('At least one PSBT is required');
    }

    if (psbts.length === 1) {
      return psbts[0];
    }

    const combined = psbts[0].clone();

    for (let i = 1; i < psbts.length; i++) {
      combined.combine(psbts[i]);
    }

    return combined;
  }

  /**
   * Finalize a PSBT (all inputs must be signed)
   */
  finalize(psbt: bitcoin.Psbt): bitcoin.Psbt {
    psbt.finalizeAllInputs();
    return psbt;
  }

  /**
   * Try to finalize a PSBT, returning success status
   */
  tryFinalize(psbt: bitcoin.Psbt): { success: boolean; error?: string } {
    try {
      psbt.finalizeAllInputs();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract the final transaction from a finalized PSBT
   */
  extractTransaction(psbt: bitcoin.Psbt): { txHex: string; txid: string } {
    const tx = psbt.extractTransaction();
    return {
      txHex: tx.toHex(),
      txid: tx.getId(),
    };
  }

  /**
   * Check if a PSBT is fully signed and ready to finalize
   */
  isComplete(psbt: bitcoin.Psbt): boolean {
    const analysis = this.analyzePSBT(psbt);
    return analysis.isComplete;
  }

  /**
   * Analyze a PSBT and return detailed information
   */
  analyzePSBT(psbt: bitcoin.Psbt): PSBTData {
    const inputs: PSBTInput[] = [];
    const outputs: PSBTOutput[] = [];
    let totalInputValue = 0;
    let totalOutputValue = 0;
    let allInputsSigned = true;
    let missingSignatures = 0;

    // Analyze inputs
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      const txInput = psbt.txInputs[i];

      let value = 0;
      let address = '';
      let scriptType: PSBTInput['scriptType'] = 'p2wpkh';

      if (input.witnessUtxo) {
        value = Number(input.witnessUtxo.value);
        try {
          address = bitcoin.address.fromOutputScript(
            input.witnessUtxo.script,
            this.network
          );
        } catch {
          address = 'unknown';
        }
        scriptType = this.getScriptType(address);
      } else if (input.nonWitnessUtxo) {
        // Legacy (P2PKH) input — extract value and address from the referenced output
        try {
          const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
          const output = prevTx.outs[txInput.index];
          if (output) {
            value = Number(output.value);
            address = bitcoin.address.fromOutputScript(output.script, this.network);
            scriptType = 'p2pkh';
          }
        } catch {
          address = 'unknown';
        }
      }

      totalInputValue += value;

      // Check if signed
      const hasPartialSig = input.partialSig && input.partialSig.length > 0;
      const hasFinalScript = !!(input.finalScriptSig || input.finalScriptWitness);
      const hasTapKeySig = !!input.tapKeySig;
      const signed = hasPartialSig || hasFinalScript || hasTapKeySig;

      if (!signed) {
        allInputsSigned = false;
        missingSignatures++;
      }

      // Get signer fingerprints
      const signerFingerprints: string[] = [];
      if (input.partialSig) {
        for (const sig of input.partialSig) {
          // We can't easily get the fingerprint from just the pubkey
          // Would need to track this separately
        }
      }

      inputs.push({
        index: i,
        txid: Buffer.from(txInput.hash).reverse().toString('hex'),
        vout: txInput.index,
        value,
        address,
        scriptType,
        signed,
        signerFingerprints,
        canSign: false, // Will be updated by caller with wallet info
      });
    }

    // Analyze outputs
    for (let i = 0; i < psbt.txOutputs.length; i++) {
      const txOutput = psbt.txOutputs[i];
      const value = Number(txOutput.value);
      totalOutputValue += value;

      let address = '';
      try {
        address = bitcoin.address.fromOutputScript(txOutput.script, this.network);
      } catch {
        address = 'unknown';
      }

      outputs.push({
        index: i,
        address,
        value,
        isChange: false, // Would need wallet context to determine
      });
    }

    const fee = totalInputValue - totalOutputValue;
    const vsize = this.estimateVSizeFromPSBT(psbt);
    const feeRate = vsize > 0 ? fee / vsize : 0;

    return {
      id: this.generatePSBTId(psbt),
      base64: psbt.toBase64(),
      hex: psbt.toHex(),
      inputs,
      outputs,
      fee,
      feeRate: Math.round(feeRate * 100) / 100,
      size: vsize,
      isComplete: allInputsSigned,
      missingSignatures,
      createdAt: Date.now(),
    };
  }

  /**
   * Get detailed analysis of a PSBT
   */
  analyze(psbt: bitcoin.Psbt, walletAddresses?: Set<string>): PSBTAnalysis {
    const psbtData = this.analyzePSBT(psbt);

    // Update canSign based on wallet addresses
    if (walletAddresses) {
      for (const input of psbtData.inputs) {
        input.canSign = walletAddresses.has(input.address);
      }

      // Update isChange for outputs
      for (const output of psbtData.outputs) {
        output.isChange = walletAddresses.has(output.address);
      }
    }

    const presentSignatures = psbtData.inputs.filter(i => i.signed).length;

    return {
      inputs: psbtData.inputs,
      outputs: psbtData.outputs,
      fee: psbtData.fee,
      feeRate: psbtData.feeRate,
      requiredSignatures: psbtData.inputs.length, // Simplified: 1 sig per input
      presentSignatures,
      isComplete: psbtData.isComplete,
      canFinalize: psbtData.isComplete,
      warnings: this.getWarnings(psbtData),
    };
  }

  /**
   * Generate warnings for a PSBT
   */
  private getWarnings(psbtData: PSBTData): string[] {
    const warnings: string[] = [];

    // High fee warning
    if (psbtData.feeRate > 100) {
      warnings.push(`High fee rate: ${psbtData.feeRate.toFixed(1)} sat/vB`);
    }

    // Very low fee warning
    if (psbtData.feeRate < 1 && psbtData.feeRate > 0) {
      warnings.push(`Very low fee rate: ${psbtData.feeRate.toFixed(1)} sat/vB - transaction may not confirm`);
    }

    // Large transaction warning
    if (psbtData.size > 10000) {
      warnings.push(`Large transaction: ${psbtData.size} vBytes`);
    }

    return warnings;
  }

  /**
   * Detect address type from address string
   */
  private detectAddressType(address: string): AddressType {
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return ADDRESS_TYPES.TAPROOT;
    }
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return ADDRESS_TYPES.NATIVE_SEGWIT;
    }
    if (address.startsWith('3') || address.startsWith('2')) {
      return ADDRESS_TYPES.WRAPPED_SEGWIT;
    }
    return ADDRESS_TYPES.LEGACY;
  }

  /**
   * Get script type from address
   */
  private getScriptType(address: string): PSBTInput['scriptType'] {
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return 'p2tr';
    }
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return 'p2wpkh';
    }
    if (address.startsWith('3') || address.startsWith('2')) {
      return 'p2sh-p2wpkh';
    }
    return 'p2pkh';
  }

  /**
   * Estimate virtual size of transaction
   */
  private estimateVSize(utxos: UTXO[], outputCount: number): number {
    let inputVBytes = 0;

    for (const utxo of utxos) {
      const type = this.detectAddressType(utxo.address);
      switch (type) {
        case ADDRESS_TYPES.TAPROOT:
          inputVBytes += TRANSACTION.INPUT_VBYTES.P2TR;
          break;
        case ADDRESS_TYPES.NATIVE_SEGWIT:
          inputVBytes += TRANSACTION.INPUT_VBYTES.P2WPKH;
          break;
        case ADDRESS_TYPES.WRAPPED_SEGWIT:
          inputVBytes += TRANSACTION.INPUT_VBYTES.P2SH_P2WPKH;
          break;
        case ADDRESS_TYPES.LEGACY:
        default:
          inputVBytes += TRANSACTION.INPUT_VBYTES.P2PKH;
          break;
      }
    }

    // Assume P2WPKH outputs by default
    const outputVBytes = outputCount * TRANSACTION.VBYTES_PER_OUTPUT;

    return Math.ceil(inputVBytes + outputVBytes + TRANSACTION.VBYTES_OVERHEAD);
  }

  /**
   * Estimate virtual size from existing PSBT
   */
  private estimateVSizeFromPSBT(psbt: bitcoin.Psbt): number {
    // Try to get actual size if finalized
    try {
      const tx = psbt.extractTransaction(true);
      return tx.virtualSize();
    } catch {
      // Not finalized, estimate
      const inputCount = psbt.inputCount;
      const outputCount = psbt.txOutputs.length;
      return Math.ceil(
        inputCount * TRANSACTION.VBYTES_PER_INPUT +
        outputCount * TRANSACTION.VBYTES_PER_OUTPUT +
        TRANSACTION.VBYTES_OVERHEAD
      );
    }
  }

  /**
   * Generate a unique ID for a PSBT
   */
  private generatePSBTId(psbt: bitcoin.Psbt): string {
    // Use first input's txid and all output addresses as identifier
    const txInput = psbt.txInputs[0];
    const inputId = txInput
      ? Buffer.from(txInput.hash).reverse().toString('hex').slice(0, 8)
      : 'unknown';

    const timestamp = Date.now().toString(36);
    return `psbt_${inputId}_${timestamp}`;
  }

  /**
   * Validate a PSBT for basic correctness
   */
  validate(psbt: bitcoin.Psbt): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (psbt.inputCount === 0) {
      errors.push('PSBT has no inputs');
    }

    if (psbt.txOutputs.length === 0) {
      errors.push('PSBT has no outputs');
    }

    // Check for missing witness UTXOs
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (!input.witnessUtxo && !input.nonWitnessUtxo) {
        errors.push(`Input ${i} is missing UTXO data`);
      }
    }

    // Check for negative outputs
    for (let i = 0; i < psbt.txOutputs.length; i++) {
      const output = psbt.txOutputs[i];
      if (Number(output.value) < 0) {
        errors.push(`Output ${i} has negative value`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ============================================
  // MULTISIG PSBT METHODS
  // ============================================

  /**
   * Get signature status for a multisig PSBT
   * Analyzes which cosigners have signed each input
   */
  getMultisigSignatureStatus(
    psbt: bitcoin.Psbt,
    multisigConfig: MultisigPSBTConfig
  ): MultisigSignatureStatus {
    const { m, cosigners } = multisigConfig;

    // Track which fingerprints have signed (across all inputs)
    const signedFingerprints = new Set<string>();

    // Build a map from pubkey hex to fingerprint using bip32Derivation from ALL inputs
    const pubkeyToFingerprint = new Map<string, string>();
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (input.bip32Derivation) {
        for (const deriv of input.bip32Derivation) {
          const pubkeyHex = Buffer.from(deriv.pubkey).toString('hex');
          const fingerprint = Buffer.from(deriv.masterFingerprint).toString('hex').toUpperCase();
          pubkeyToFingerprint.set(pubkeyHex, fingerprint);
          // Also store lowercase version for case-insensitive matching
          pubkeyToFingerprint.set(pubkeyHex.toLowerCase(), fingerprint);
        }
      }
    }
    // Analyze each input for signatures
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];

      // Check if input is finalized (all required signatures present)
      if (input.finalScriptWitness || input.finalScriptSig) {
        // Input is finalized - mark ALL cosigners as having signed
        for (const cosigner of cosigners) {
          signedFingerprints.add(cosigner.fingerprint.toUpperCase());
        }
        break; // Once we find a finalized input, all signers are considered signed
      }

      // Check partial signatures
      if (input.partialSig && input.partialSig.length > 0) {
        for (const partialSig of input.partialSig) {
          const sigPubkeyHex = Buffer.from(partialSig.pubkey).toString('hex');
          let foundFingerprint = false;

          // Method 1: Look up in our pre-built pubkey-to-fingerprint map
          // Try both original and lowercase versions
          let mappedFingerprint = pubkeyToFingerprint.get(sigPubkeyHex);
          if (!mappedFingerprint) {
            mappedFingerprint = pubkeyToFingerprint.get(sigPubkeyHex.toLowerCase());
          }
          if (mappedFingerprint) {
            signedFingerprints.add(mappedFingerprint);
            foundFingerprint = true;
          }

          // Method 2: Match by pubkey position in witnessScript
          // In sortedmulti, pubkeys are sorted lexicographically in the witnessScript
          // We extract pubkeys from witnessScript and match positions to bip32Derivation
          if (!foundFingerprint && input.witnessScript) {
            const pubkeysInScript = this.extractPubkeysFromWitnessScript(input.witnessScript);
            const sigPubkeyLower = sigPubkeyHex.toLowerCase();

            // Find the position of this signature's pubkey in the witnessScript
            const pubkeyIndex = pubkeysInScript.findIndex(pk => pk.toLowerCase() === sigPubkeyLower);

            if (pubkeyIndex !== -1) {
              // Now match each witnessScript pubkey to its fingerprint via bip32Derivation
              // This gives us the sorted order of fingerprints
              const fingerprintsInOrder: (string | null)[] = pubkeysInScript.map(wsPubkey => {
                const fp = pubkeyToFingerprint.get(wsPubkey.toLowerCase());
                return fp || null;
              });

              // If we have a fingerprint at this position, that's our signer
              if (fingerprintsInOrder[pubkeyIndex]) {
                const matchedFingerprint = fingerprintsInOrder[pubkeyIndex];
                signedFingerprints.add(matchedFingerprint!);
                foundFingerprint = true;
              } else {
                // The pubkey is valid but we don't have its fingerprint in bip32Derivation
                // This likely means it's from an external signer
                // Find which cosigner fingerprints are NOT mapped to any pubkey
                const mappedFingerprints = new Set(fingerprintsInOrder.filter(f => f !== null));
                for (const cosigner of cosigners) {
                  const cfp = cosigner.fingerprint.toUpperCase();
                  if (!mappedFingerprints.has(cfp) && !signedFingerprints.has(cfp)) {
                    signedFingerprints.add(cfp);
                    foundFingerprint = true;
                    break;
                  }
                }
              }
            }
          }

          if (!foundFingerprint) {
            // Even if we can't identify the specific signer, the signature is still valid
            // We'll rely on the actual signature count for determining if we can finalize
          }
        }
      }
    }

    // If we have more signatures than identified fingerprints, try to match remaining
    // This handles the case where BlueWallet returns a PSBT without bip32Derivation for its key
    const actualSigCountPerInput = psbt.data.inputs[0]?.partialSig?.length || 0;

    if (actualSigCountPerInput > signedFingerprints.size) {
      // Find unidentified cosigners (ones we haven't matched yet)
      const unidentifiedCosigners = cosigners.filter(c => !signedFingerprints.has(c.fingerprint.toUpperCase()));

      // Calculate how many signatures we need to match
      const unidentifiedSigCount = actualSigCountPerInput - signedFingerprints.size;

      // Match remaining signatures to remaining cosigners
      // If counts match exactly, we can auto-match all
      // If we have more unidentified cosigners than signatures, match as many as we have signatures
      const countToMatch = Math.min(unidentifiedSigCount, unidentifiedCosigners.length);
      for (let i = 0; i < countToMatch; i++) {
        const cosigner = unidentifiedCosigners[i];
        signedFingerprints.add(cosigner.fingerprint.toUpperCase());
      }
    }

    // Build signer status array
    const signers = cosigners.map(cosigner => {
      const normalizedFingerprint = cosigner.fingerprint.toUpperCase();
      return {
        fingerprint: cosigner.fingerprint,
        name: cosigner.name,
        hasSigned: signedFingerprints.has(normalizedFingerprint),
        isLocal: cosigner.isLocal,
      };
    });

    // Count identified signers
    const identifiedSigs = signers.filter(s => s.hasSigned).length;

    // Also count actual signatures in case we couldn't identify all signers
    const actualSigCount = psbt.data.inputs[0]?.partialSig?.length || 0;

    // Use the higher of the two counts for determining if we can finalize
    const presentSigs = Math.max(identifiedSigs, actualSigCount);

    const canFinalize = presentSigs >= m;
    const isComplete = canFinalize;

    return {
      requiredSigs: m,
      presentSigs,
      signers,
      canFinalize,
      isComplete,
    };
  }

  /**
   * Extract pubkeys from a multisig witnessScript
   * witnessScript format: OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG
   * Returns pubkeys in their sorted order (as they appear in the script)
   */
  private extractPubkeysFromWitnessScript(witnessScript: Uint8Array): string[] {
    const pubkeys: string[] = [];
    const script = Buffer.from(witnessScript);

    let i = 1; // Skip OP_M
    while (i < script.length - 2) { // Stop before OP_N OP_CHECKMULTISIG
      const len = script[i];

      // Valid compressed pubkey lengths are 33 (0x21) or 65 (0x41) for uncompressed
      if (len === 0x21 || len === 0x41) {
        const pubkey = script.slice(i + 1, i + 1 + len);
        pubkeys.push(pubkey.toString('hex'));
        i += 1 + len;
      } else if (len >= 0x51 && len <= 0x60) {
        // This is OP_N (OP_1 through OP_16), we've reached the end
        break;
      } else {
        // Unknown opcode, skip
        i++;
      }
    }

    return pubkeys;
  }

  /**
   * Sign a multisig PSBT with a single cosigner's key
   * Only signs inputs that belong to addresses we can derive
   */
  signMultisigPSBT(
    psbt: bitcoin.Psbt,
    keyDerivation: KeyDerivation,
    cosignerInfo: { fingerprint: string; derivationPath: string },
    addressToPathMap: Map<string, MultisigAddressPathInfo>
  ): bitcoin.Psbt {
    const { fingerprint, derivationPath } = cosignerInfo;
    const fingerprintBuffer = Buffer.from(fingerprint, 'hex');

    if (__DEV__) console.log(`[PSBTService.signMultisig] START — fingerprint=${fingerprint}, derivationPath=${derivationPath}, inputCount=${psbt.inputCount}, addressMapSize=${addressToPathMap.size}`);

    // Log all addresses in the map
    const mapAddresses = Array.from(addressToPathMap.keys());
    if (__DEV__) console.log(`[PSBTService.signMultisig] addressToPathMap addresses: ${JSON.stringify(mapAddresses)}`);

    let signedCount = 0;

    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];

      // Skip if already finalized
      if (input.finalScriptWitness || input.finalScriptSig) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — already finalized`);
        continue;
      }

      // Get the address from witnessUtxo OR nonWitnessUtxo
      let address: string;
      if (input.witnessUtxo) {
        try {
          address = bitcoin.address.fromOutputScript(
            input.witnessUtxo.script,
            this.network
          );
        } catch (err: any) {
          if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — cannot decode address from witnessUtxo: ${err.message}`);
          continue;
        }
      } else if (input.nonWitnessUtxo) {
        // For legacy/P2SH inputs, extract address from the full raw transaction
        try {
          const txInput = psbt.txInputs[i];
          const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
          const output = prevTx.outs[txInput.index];
          if (!output) {
            if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — nonWitnessUtxo output[${txInput.index}] not found`);
            continue;
          }
          address = bitcoin.address.fromOutputScript(output.script, this.network);
        } catch (err: any) {
          if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — cannot decode address from nonWitnessUtxo: ${err.message}`);
          continue;
        }
      } else {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — no witnessUtxo or nonWitnessUtxo`);
        continue;
      }

      if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: address=${address}`);

      // Check if we have path info for this address
      const pathInfo = addressToPathMap.get(address);
      if (!pathInfo) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — address NOT in addressToPathMap`);
        continue;
      }

      if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: pathInfo found — path=${pathInfo.path}, hasWitnessScript=${!!pathInfo.witnessScript}, hasRedeemScript=${!!pathInfo.redeemScript}`);

      // Check if this input needs our signature (via bip32Derivation)
      let shouldSign = false;
      let ourDerivation: { pubkey: Buffer; path: string } | undefined;

      if (input.bip32Derivation) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: bip32Derivation has ${input.bip32Derivation.length} entries`);
        for (const deriv of input.bip32Derivation) {
          const derivFp = Buffer.from(deriv.masterFingerprint).toString('hex');
          if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: bip32Deriv fp=${derivFp}, path=${deriv.path}, matchesOurs=${Buffer.from(deriv.masterFingerprint).equals(fingerprintBuffer)}`);
          if (Buffer.from(deriv.masterFingerprint).equals(fingerprintBuffer)) {
            shouldSign = true;
            // Construct the full path from masterFingerprint's path
            ourDerivation = {
              pubkey: Buffer.from(deriv.pubkey),
              path: deriv.path,
            };
            break;
          }
        }
      } else {
        // FALLBACK: No bip32Derivation — sign anyway using the pathInfo.path
        // This happens when TransactionBuilder creates the PSBT without BIP32 metadata.
        // Since we already matched the address to our addressToPathMap, we know this
        // input belongs to the multisig wallet and we should attempt to sign it.
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: NO bip32Derivation — using pathInfo.path fallback`);
        shouldSign = true;
      }

      if (!shouldSign) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — no matching bip32Derivation for our fingerprint`);
        continue;
      }

      // Determine the signing derivation path:
      // PRIORITY 1: Use bip32Derivation path (from PSBT metadata) — this is the correct BIP48 multisig path
      // PRIORITY 2: Fall back to pathInfo.path (from addressToPathMap) — only if no bip32Derivation
      // This prevents using a wrong BIP44 path when the address appears in both HD and multisig maps
      const signingPath = ourDerivation?.path || pathInfo.path;

      if (!signingPath) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: SKIP — no derivation path available (bip32=${ourDerivation?.path}, pathInfo=${pathInfo.path})`);
        continue;
      }

      if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: WILL SIGN — bip32Path=${ourDerivation?.path}, pathInfoPath=${pathInfo.path}, using signingPath=${signingPath}`);

      // Add witness/redeem scripts if not present
      if (pathInfo.witnessScript && !input.witnessScript) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: adding witnessScript`);
        psbt.updateInput(i, { witnessScript: pathInfo.witnessScript });
      }
      if (pathInfo.redeemScript && !input.redeemScript) {
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: adding redeemScript`);
        psbt.updateInput(i, { redeemScript: pathInfo.redeemScript });
      }

      // Derive the signing key pair using the correct path
      const keyPair = keyDerivation.getSigningKeyPair(signingPath);

      if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: keyPair publicKey=${Buffer.from(keyPair.publicKey).toString('hex').slice(0, 16)}...`);

      const signer = {
        publicKey: Buffer.from(keyPair.publicKey),
        sign: (hash: Buffer): Buffer => Buffer.from(keyPair.sign(hash)),
      };

      try {
        psbt.signInput(i, signer);
        signedCount++;
        if (__DEV__) console.log(`[PSBTService.signMultisig] Input ${i}: ✓ SIGNED successfully`);
      } catch (error: any) {
        if (__DEV__) console.warn(`[PSBTService.signMultisig] Input ${i}: ✗ Failed to sign:`, error?.message || error);
      }

      // Clear sensitive data
      keyPair.privateKey.fill(0);
    }

    if (__DEV__) console.log(`[PSBTService.signMultisig] DONE — signed ${signedCount} of ${psbt.inputCount} inputs`);

    return psbt;
  }

  /**
   * Check if a multisig PSBT can be finalized (has M signatures)
   * Handles mixed inputs: non-multisig inputs (no witnessScript/redeemScript with
   * OP_CHECKMULTISIG) are checked for single-sig readiness instead.
   */
  canFinalizeMultisig(psbt: bitcoin.Psbt, m: number): boolean {
    // Check each input
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];

      // If already finalized, this input is good
      if (input.finalScriptWitness || input.finalScriptSig) continue;

      // Determine if this is a multisig input by checking for multisig scripts
      const isMultisigInput = this.isMultisigInput(input);

      if (isMultisigInput) {
        // Multisig input: needs M partial signatures
        const sigCount = input.partialSig?.length || 0;
        if (sigCount < m) {
          if (__DEV__) console.log(`[canFinalizeMultisig] Input ${i}: multisig input has ${sigCount} sigs, need ${m}`);
          return false;
        }
      } else {
        // Non-multisig input (e.g., P2PKH, P2WPKH single-sig that got mixed in):
        // These need at least 1 partial signature OR already have enough data to finalize
        const sigCount = input.partialSig?.length || 0;
        const hasTapKeySig = !!input.tapKeySig;
        if (sigCount < 1 && !hasTapKeySig) {
          if (__DEV__) console.log(`[canFinalizeMultisig] Input ${i}: non-multisig input has ${sigCount} sigs (need at least 1)`);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a PSBT input is a multisig input by examining its scripts.
   * Returns true if the input has a witnessScript or redeemScript ending in OP_CHECKMULTISIG.
   */
  private isMultisigInput(input: any): boolean {
    // Check witnessScript for OP_CHECKMULTISIG (0xae) or OP_CHECKMULTISIGVERIFY (0xaf)
    if (input.witnessScript) {
      const lastByte = input.witnessScript[input.witnessScript.length - 1];
      if (lastByte === 0xae || lastByte === 0xaf) return true;
    }

    // Check redeemScript for OP_CHECKMULTISIG
    if (input.redeemScript) {
      const lastByte = input.redeemScript[input.redeemScript.length - 1];
      if (lastByte === 0xae || lastByte === 0xaf) return true;
    }

    // Check bip32Derivation: multisig inputs typically have multiple entries per input
    if (input.bip32Derivation && input.bip32Derivation.length > 1) return true;

    return false;
  }

  /**
   * Finalize a multisig PSBT
   * This creates the final witness/script from the partial signatures.
   * Handles PSBTs from various wallets (BlueWallet, hardware wallets, etc.)
   * Also handles mixed inputs: non-multisig inputs (P2PKH/P2WPKH single-sig)
   * are finalized using standard single-sig finalization.
   */
  finalizeMultisig(psbt: bitcoin.Psbt): { success: boolean; error?: string } {
    try {
      for (let i = 0; i < psbt.inputCount; i++) {
        const input = psbt.data.inputs[i];

        // Skip already finalized inputs
        if (input.finalScriptWitness || input.finalScriptSig) {
          if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: already finalized, skipping`);
          continue;
        }

        // Check if this is a multisig input or a regular single-sig input
        const isMultisig = this.isMultisigInput(input);

        // Detailed pre-finalization logging
        const sigPubkeys = input.partialSig?.map(s => Buffer.from(s.pubkey).toString('hex').slice(0, 16)) ?? [];
        const wsHex = input.witnessScript ? Buffer.from(input.witnessScript).toString('hex').slice(0, 40) : 'none';
        if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: isMultisig=${isMultisig}, sigs=${input.partialSig?.length ?? 0} [${sigPubkeys.join(', ')}], ws=${wsHex}..., rs=${!!input.redeemScript}, bip32=${input.bip32Derivation?.length ?? 0}`);

        if (!isMultisig) {
          // NON-MULTISIG INPUT: finalize as standard single-sig
          // This handles the case where a multisig wallet's PSBT contains UTXOs from
          // non-multisig addresses (e.g., P2PKH addresses from HD gap discovery)
          try {
            psbt.finalizeInput(i);
            if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ NON-MULTISIG finalized with default finalizer`);
            continue;
          } catch (singleSigErr: any) {
            if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: NON-MULTISIG finalize FAILED: ${singleSigErr.message}`);
            throw new Error(`Cannot finalize non-multisig input #${i}: ${singleSigErr.message}. This input may not belong to this wallet.`);
          }
        }

        // MULTISIG INPUT: standard multisig finalization logic

        // Parse M from witnessScript or redeemScript to know how many signatures are needed.
        // OP_CHECKMULTISIG requires EXACTLY M signatures. If we have more (e.g., 2 sigs for 1-of-2),
        // we must trim to M before finalization, otherwise both default and custom finalizers fail.
        const multisigScript = input.witnessScript || input.redeemScript;
        if (multisigScript && input.partialSig && input.partialSig.length > 0) {
          const firstByte = multisigScript[0];
          // OP_1=0x51 through OP_16=0x60 encode M
          if (firstByte >= 0x51 && firstByte <= 0x60) {
            const m = firstByte - 0x50;
            if (input.partialSig.length > m) {
              if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: trimming partialSig from ${input.partialSig.length} to ${m} (m-of-n requires exactly m=${m})`);

              // Keep only M signatures, ordered by their pubkey position in the script
              const scriptBuf = Buffer.from(multisigScript);
              const pubkeysInScript = this.extractPubkeysFromWitnessScript(scriptBuf);
              const orderedSigs: typeof input.partialSig = [];
              for (const scriptPubkey of pubkeysInScript) {
                const scriptPubkeyLower = scriptPubkey.toLowerCase();
                const matchingSig = input.partialSig.find((ps: any) =>
                  Buffer.from(ps.pubkey).toString('hex').toLowerCase() === scriptPubkeyLower
                );
                if (matchingSig) {
                  orderedSigs.push(matchingSig);
                }
                if (orderedSigs.length >= m) break;
              }
              if (orderedSigs.length >= m) {
                input.partialSig = orderedSigs;
              }
            }
          }
        }

        // Strategy 1: Use bitcoinjs-lib's default finalizer (works when witnessScript is present)
        // The default finalizer correctly handles P2WSH, P2SH-P2WSH, and P2SH multisig
        // by using the payments module which properly constructs the witness stack with OP_0.
        try {
          psbt.finalizeInput(i);
          // Log the finalized witness data
          const finInput = psbt.data.inputs[i];
          if (finInput.finalScriptWitness) {
            const witnessHex = Buffer.from(finInput.finalScriptWitness).toString('hex');
            if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ DEFAULT finalizer — witnessLen=${witnessHex.length / 2}, firstByte=0x${witnessHex.slice(0, 2)}, hex=${witnessHex.slice(0, 80)}...`);
          }
          if (finInput.finalScriptSig) {
            if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ DEFAULT finalizer — scriptSigLen=${Buffer.from(finInput.finalScriptSig).length}`);
          }
          continue;
        } catch (defaultErr: any) {
          if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: default finalizer FAILED: ${defaultErr.message}`);
        }

        // Strategy 2: Custom finalizer fallback
        if (input.witnessScript && input.partialSig && input.partialSig.length > 0) {
          psbt.finalizeInput(i, this.createMultisigFinalizer(input.witnessScript));
          const finInput = psbt.data.inputs[i];
          const witnessHex = finInput.finalScriptWitness ? Buffer.from(finInput.finalScriptWitness).toString('hex') : 'none';
          if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ CUSTOM P2WSH — witnessLen=${witnessHex.length / 2}, hex=${witnessHex.slice(0, 80)}...`);
        } else if (input.redeemScript && input.witnessScript && input.partialSig && input.partialSig.length > 0) {
          psbt.finalizeInput(i, this.createP2shP2wshMultisigFinalizer(input.redeemScript, input.witnessScript));
          if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ CUSTOM P2SH-P2WSH`);
        } else if (input.redeemScript && !input.witnessScript && input.partialSig && input.partialSig.length > 0) {
          psbt.finalizeInput(i, this.createP2shMultisigFinalizer(input.redeemScript));
          if (__DEV__) console.log(`[PSBTService.finalizeMultisig] Input ${i}: ✓ CUSTOM P2SH`);
        } else {
          throw new Error(`Cannot finalize input #${i}: no suitable finalization strategy (sigs=${input.partialSig?.length ?? 0}, ws=${!!input.witnessScript}, rs=${!!input.redeemScript})`);
        }
      }
      if (__DEV__) console.log(`[PSBTService.finalizeMultisig] ALL INPUTS FINALIZED`);
      return { success: true };
    } catch (error) {
      if (__DEV__) console.log(`[PSBTService.finalizeMultisig] FAILED:`, error instanceof Error ? error.message : error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to finalize multisig PSBT',
      };
    }
  }

  /**
   * Create a custom finalizer for P2WSH multisig inputs
   * This properly orders signatures to match the pubkey order in the witnessScript,
   * and only includes exactly M signatures (as required by OP_CHECKMULTISIG).
   */
  private createMultisigFinalizer(witnessScript: Buffer | Uint8Array): (
    inputIndex: number,
    input: any,
  ) => { finalScriptWitness: Buffer } {
    const wsBuffer = Buffer.from(witnessScript);

    return (_inputIndex: number, input: any) => {
      const partialSigs = input.partialSig as Array<{ pubkey: Buffer; signature: Buffer }>;

      if (!partialSigs || partialSigs.length === 0) {
        throw new Error('No partial signatures found');
      }

      // Parse M (required signatures) from the witnessScript.
      // The first byte is OP_M: OP_1=0x51 (m=1), OP_2=0x52 (m=2), ..., OP_16=0x60 (m=16)
      const firstByte = wsBuffer[0];
      const m = firstByte - 0x50; // OP_1 (0x51) → 1, OP_2 (0x52) → 2, etc.
      if (__DEV__) console.log(`[createMultisigFinalizer] witnessScript OP_M=0x${firstByte.toString(16)}, m=${m}, partialSigs=${partialSigs.length}`);

      // Extract pubkeys from witnessScript in their sorted order
      const pubkeysInScript = this.extractPubkeysFromWitnessScript(wsBuffer);

      // Sort signatures to match the order of pubkeys in the witnessScript
      // This is critical for multisig validation — OP_CHECKMULTISIG requires
      // signatures in the same order as their corresponding pubkeys appear in the script
      const orderedSigs: Buffer[] = [];

      for (const scriptPubkey of pubkeysInScript) {
        const scriptPubkeyLower = scriptPubkey.toLowerCase();
        const matchingSig = partialSigs.find(ps =>
          Buffer.from(ps.pubkey).toString('hex').toLowerCase() === scriptPubkeyLower
        );
        if (matchingSig) {
          orderedSigs.push(Buffer.from(matchingSig.signature));
        }
        // Stop once we have exactly M signatures — OP_CHECKMULTISIG requires exactly M
        if (orderedSigs.length >= m) break;
      }

      if (orderedSigs.length === 0) {
        throw new Error('Could not match any signatures to witnessScript pubkeys');
      }

      if (orderedSigs.length < m) {
        throw new Error(`Not enough signatures: have ${orderedSigs.length}, need ${m}`);
      }

      if (__DEV__) console.log(`[createMultisigFinalizer] Using ${orderedSigs.length} of ${partialSigs.length} signatures (m=${m})`);

      // Build witness stack: OP_0 (dummy for CHECKMULTISIG bug) + M signatures + witnessScript
      const witness = [
        Buffer.alloc(0), // OP_0 dummy element for CHECKMULTISIG off-by-one bug
        ...orderedSigs,
        wsBuffer,
      ];

      // Encode as witness stack
      const finalScriptWitness = this.witnessStackToScriptWitness(witness);

      return { finalScriptWitness };
    };
  }

  /**
   * Create a custom finalizer for P2SH-P2WSH multisig inputs
   */
  private createP2shP2wshMultisigFinalizer(redeemScript: Buffer | Uint8Array, witnessScript: Buffer | Uint8Array): (
    inputIndex: number,
    input: any,
  ) => { finalScriptSig: Buffer; finalScriptWitness: Buffer } {
    const rsBuffer = Buffer.from(redeemScript);
    const wsBuffer = Buffer.from(witnessScript);

    return (inputIndex: number, input: any) => {
      // Get the witness using the P2WSH finalizer
      const { finalScriptWitness } = this.createMultisigFinalizer(wsBuffer)(inputIndex, input);

      // scriptSig just pushes the redeemScript
      const finalScriptSig = Buffer.concat([
        Buffer.from([rsBuffer.length]),
        rsBuffer,
      ]);

      return { finalScriptSig, finalScriptWitness };
    };
  }

  /**
   * Create a custom finalizer for P2SH multisig inputs (legacy)
   */
  private createP2shMultisigFinalizer(redeemScript: Buffer | Uint8Array): (
    inputIndex: number,
    input: any,
  ) => { finalScriptSig: Buffer; finalScriptWitness: undefined } {
    const rsBuffer = Buffer.from(redeemScript);

    return (_inputIndex: number, input: any) => {
      const partialSigs = input.partialSig as Array<{ pubkey: Buffer; signature: Buffer }>;

      if (!partialSigs || partialSigs.length === 0) {
        throw new Error('No partial signatures found');
      }

      // Parse M (required signatures) from the redeemScript.
      // The first byte is OP_M: OP_1=0x51 (m=1), OP_2=0x52 (m=2), ..., OP_16=0x60 (m=16)
      const firstByte = rsBuffer[0];
      const m = firstByte - 0x50;
      if (__DEV__) console.log(`[createP2shMultisigFinalizer] redeemScript OP_M=0x${firstByte.toString(16)}, m=${m}, partialSigs=${partialSigs.length}`);

      // Extract pubkeys from redeemScript
      const pubkeysInScript = this.extractPubkeysFromWitnessScript(rsBuffer);

      // Sort signatures to match pubkey order, limited to M signatures
      const orderedSigs: Buffer[] = [];
      for (const scriptPubkey of pubkeysInScript) {
        const scriptPubkeyLower = scriptPubkey.toLowerCase();
        const matchingSig = partialSigs.find(ps =>
          Buffer.from(ps.pubkey).toString('hex').toLowerCase() === scriptPubkeyLower
        );
        if (matchingSig) {
          orderedSigs.push(Buffer.from(matchingSig.signature));
        }
        // Stop once we have exactly M signatures
        if (orderedSigs.length >= m) break;
      }

      // Build scriptSig: OP_0 + signatures + redeemScript
      const chunks: Buffer[] = [Buffer.from([0x00])]; // OP_0
      for (const sig of orderedSigs) {
        chunks.push(Buffer.from([sig.length]));
        chunks.push(sig);
      }
      // Push redeemScript with proper length encoding
      if (rsBuffer.length < 76) {
        chunks.push(Buffer.from([rsBuffer.length]));
      } else if (rsBuffer.length <= 255) {
        chunks.push(Buffer.from([0x4c, rsBuffer.length])); // OP_PUSHDATA1
      } else {
        chunks.push(Buffer.from([0x4d, rsBuffer.length & 0xff, rsBuffer.length >> 8])); // OP_PUSHDATA2
      }
      chunks.push(rsBuffer);

      return { finalScriptSig: Buffer.concat(chunks), finalScriptWitness: undefined };
    };
  }

  /**
   * Try to reconstruct witnessScript from partial signatures and UTXO
   * This handles cases where external wallets don't include witnessScript
   */
  private tryReconstructWitnessScript(input: any): Buffer | null {
    // If we have bip32Derivation, we might be able to determine the multisig structure
    // For now, return null - the wallet should provide the witnessScript
    // This could be enhanced to reconstruct from known wallet addresses
    return null;
  }

  /**
   * Convert a witness stack to the serialized witness format
   */
  private witnessStackToScriptWitness(witness: Buffer[]): Buffer {
    // Witness serialization: varint(stack_items) + for each item: varint(len) + data
    const chunks: Buffer[] = [];

    // Number of stack items as varint
    chunks.push(this.encodeVarInt(witness.length));

    // Each stack item
    for (const item of witness) {
      chunks.push(this.encodeVarInt(item.length));
      chunks.push(item);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Encode a number as a Bitcoin varint
   */
  private encodeVarInt(n: number): Buffer {
    if (n < 0xfd) {
      return Buffer.from([n]);
    } else if (n <= 0xffff) {
      const buf = Buffer.alloc(3);
      buf[0] = 0xfd;
      buf.writeUInt16LE(n, 1);
      return buf;
    } else if (n <= 0xffffffff) {
      const buf = Buffer.alloc(5);
      buf[0] = 0xfe;
      buf.writeUInt32LE(n, 1);
      return buf;
    } else {
      const buf = Buffer.alloc(9);
      buf[0] = 0xff;
      buf.writeBigUInt64LE(BigInt(n), 1);
      return buf;
    }
  }

  /**
   * Detect if a PSBT is for a multisig wallet
   * Checks for witnessScript with OP_CHECKMULTISIG
   */
  isMultisigPSBT(psbt: bitcoin.Psbt): boolean {
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];

      // Check for witnessScript (P2WSH multisig)
      if (input.witnessScript) {
        const script = input.witnessScript;
        // Multisig scripts end with OP_CHECKMULTISIG (0xae) or OP_CHECKMULTISIGVERIFY (0xaf)
        if (script[script.length - 1] === 0xae || script[script.length - 1] === 0xaf) {
          return true;
        }
      }

      // Check for redeemScript (P2SH or P2SH-P2WSH multisig)
      if (input.redeemScript) {
        const script = input.redeemScript;
        if (script[script.length - 1] === 0xae || script[script.length - 1] === 0xaf) {
          return true;
        }
      }

      // Check bip32Derivation count (multisig has multiple entries per input)
      if (input.bip32Derivation && input.bip32Derivation.length > 1) {
        return true;
      }
    }

    return false;
  }
}
