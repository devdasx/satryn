/**
 * Fee Bumper
 * Supports RBF (Replace-by-Fee) and CPFP (Child-Pays-for-Parent) transactions
 *
 * RBF (BIP 125):
 * - Replace an unconfirmed transaction with a new one paying a higher fee
 * - Original transaction must have signaled RBF (sequence < 0xFFFFFFFF - 1)
 * - New transaction must pay at least 1 sat/vB more than the original
 *
 * CPFP:
 * - Speed up a stuck parent transaction by spending one of its outputs
 * - The child transaction pays enough fee for both parent and child
 * - Miners include both transactions together
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { TRANSACTION, ADDRESS_TYPES } from '../../constants';
import type {
  UTXO,
  RBFTransaction,
  CPFPTransaction,
  PreparedTransaction,
  DetailedTransactionInfo,
  AddressType,
} from '../../types';

// Initialize bitcoinjs-lib with ecc
bitcoin.initEccLib(ecc);

type NetworkType = 'mainnet' | 'testnet';

export interface RBFOptions {
  /** New fee rate in sat/vB */
  newFeeRate: number;
  /** Explicit change address — used to identify which output to reduce for additional fee */
  changeAddress: string;
  /** Whether to signal RBF on the replacement (default: true) */
  enableRBF?: boolean;
}

export interface CPFPOptions {
  /** Index of the output to spend from parent */
  outputIndex: number;
  /** Target effective fee rate for the package */
  targetFeeRate: number;
  /** Address for the CPFP output */
  outputAddress: string;
  /** Whether to signal RBF on the child (default: true) */
  enableRBF?: boolean;
}

export interface BumpAnalysis {
  canBump: boolean;
  reason?: string;
  currentFee: number;
  currentFeeRate: number;
  minimumNewFeeRate: number;
  recommendedFeeRate: number;
  estimatedNewFee: number;
}

/**
 * Fee Bumper class for RBF and CPFP transactions
 */
export class FeeBumper {
  private network: bitcoin.Network;
  private networkType: NetworkType;

  constructor(networkType: NetworkType = 'mainnet') {
    this.networkType = networkType;
    this.network = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;
  }

  /**
   * Check if a transaction can be replaced with RBF
   * @param txInfo - Detailed transaction information
   * @returns Analysis of RBF eligibility
   */
  analyzeRBF(txInfo: DetailedTransactionInfo, recommendedFeeRate: number): BumpAnalysis {
    // Check if transaction is confirmed
    if (txInfo.confirmed) {
      return {
        canBump: false,
        reason: 'Transaction is already confirmed',
        currentFee: txInfo.fee,
        currentFeeRate: txInfo.feeRate,
        minimumNewFeeRate: 0,
        recommendedFeeRate: 0,
        estimatedNewFee: 0,
      };
    }

    // Check if RBF is signaled
    if (!txInfo.isRBF) {
      return {
        canBump: false,
        reason: 'Transaction did not signal RBF (sequence >= 0xFFFFFFFE)',
        currentFee: txInfo.fee,
        currentFeeRate: txInfo.feeRate,
        minimumNewFeeRate: 0,
        recommendedFeeRate: 0,
        estimatedNewFee: 0,
      };
    }

    // Calculate minimum fee rate (must be at least 1 sat/vB higher)
    const minimumNewFeeRate = Math.ceil(txInfo.feeRate) + 1;

    // Calculate estimated new fee
    const estimatedNewFee = Math.ceil(txInfo.vsize * recommendedFeeRate);

    return {
      canBump: true,
      currentFee: txInfo.fee,
      currentFeeRate: txInfo.feeRate,
      minimumNewFeeRate,
      recommendedFeeRate: Math.max(minimumNewFeeRate, recommendedFeeRate),
      estimatedNewFee,
    };
  }

  /**
   * Create an RBF replacement transaction
   * @param originalTx - The original transaction to replace
   * @param utxos - All wallet UTXOs (needed to re-select inputs)
   * @param options - RBF options
   * @returns RBF transaction details and PSBT
   */
  createRBFReplacement(
    originalTx: DetailedTransactionInfo,
    inputPaths: Map<string, string>, // address -> derivation path
    options: RBFOptions
  ): { psbt: bitcoin.Psbt; rbfInfo: RBFTransaction } {
    const { newFeeRate, enableRBF = true } = options;

    // Verify RBF is possible
    if (originalTx.confirmed) {
      throw new Error('Cannot RBF a confirmed transaction');
    }

    if (!originalTx.isRBF) {
      throw new Error('Original transaction did not signal RBF');
    }

    // Calculate new fee
    const newFee = Math.ceil(originalTx.vsize * newFeeRate);
    const additionalFee = newFee - originalTx.fee;

    if (additionalFee <= 0) {
      throw new Error('New fee must be higher than original fee');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Re-add inputs from original transaction
    for (const input of originalTx.inputs) {
      const addressType = this.detectAddressType(input.address);
      const sequence = enableRBF ? 0xfffffffd : 0xffffffff;

      if (addressType === ADDRESS_TYPES.LEGACY) {
        // P2PKH (Legacy) inputs MUST use nonWitnessUtxo (full raw tx)
        // The rawTxHex should be provided on the input if available
        const rawHex = (input as any).rawTxHex;
        if (rawHex) {
          psbt.addInput({
            hash: input.prevTxid,
            index: input.prevVout,
            sequence,
            nonWitnessUtxo: Buffer.from(rawHex, 'hex'),
          });
        } else {
          throw new Error(
            `Legacy input ${input.prevTxid}:${input.prevVout} is missing rawTxHex. ` +
            `Legacy (P2PKH) inputs require the full raw transaction for fee bumping.`
          );
        }
      } else {
        // SegWit inputs use witnessUtxo
        const outputScript = bitcoin.address.toOutputScript(input.address, this.network);
        psbt.addInput({
          hash: input.prevTxid,
          index: input.prevVout,
          sequence,
          witnessUtxo: {
            script: outputScript,
            value: BigInt(input.value),
          },
        });
      }
    }

    // Re-add outputs, but adjust the change output to pay higher fee
    const outputs = [...originalTx.outputs];
    const { changeAddress } = options;

    // Find the change output by matching the explicit changeAddress
    let changeReduced = false;
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (output.address === changeAddress) {
        if (output.value <= additionalFee + TRANSACTION.DUST_THRESHOLD) {
          throw new Error(`Change output value (${output.value} sats) too small to cover additional fee (${additionalFee} sats)`);
        }
        outputs[i] = {
          ...output,
          value: output.value - additionalFee,
        };
        changeReduced = true;
        break;
      }
    }

    if (!changeReduced) {
      throw new Error(`Change address ${changeAddress} not found in transaction outputs`);
    }

    // Add outputs to PSBT
    for (const output of outputs) {
      if (output.address) {
        psbt.addOutput({
          address: output.address,
          value: BigInt(output.value),
        });
      }
    }

    const rbfInfo: RBFTransaction = {
      originalTxid: originalTx.txid,
      originalFee: originalTx.fee,
      originalFeeRate: originalTx.feeRate,
      newFeeRate,
      newFee,
      additionalFee,
      canBump: true,
    };

    return { psbt, rbfInfo };
  }

  /**
   * Analyze CPFP eligibility for a transaction
   * @param parentTx - The parent transaction to accelerate
   * @param outputIndex - Which output we can spend
   * @param targetFeeRate - Desired effective fee rate
   */
  analyzeCPFP(
    parentTx: DetailedTransactionInfo,
    outputIndex: number,
    targetFeeRate: number
  ): {
    canBump: boolean;
    reason?: string;
    parentFee: number;
    parentFeeRate: number;
    parentVsize: number;
    outputValue: number;
    requiredChildFee: number;
    effectivePackageFeeRate: number;
  } {
    // Check if transaction is confirmed
    if (parentTx.confirmed) {
      return {
        canBump: false,
        reason: 'Parent transaction is already confirmed',
        parentFee: parentTx.fee,
        parentFeeRate: parentTx.feeRate,
        parentVsize: parentTx.vsize,
        outputValue: 0,
        requiredChildFee: 0,
        effectivePackageFeeRate: 0,
      };
    }

    // Check if output index is valid
    const output = parentTx.outputs[outputIndex];
    if (!output) {
      return {
        canBump: false,
        reason: `Invalid output index: ${outputIndex}`,
        parentFee: parentTx.fee,
        parentFeeRate: parentTx.feeRate,
        parentVsize: parentTx.vsize,
        outputValue: 0,
        requiredChildFee: 0,
        effectivePackageFeeRate: 0,
      };
    }

    if (!output.address) {
      return {
        canBump: false,
        reason: 'Output has no address (OP_RETURN or non-standard)',
        parentFee: parentTx.fee,
        parentFeeRate: parentTx.feeRate,
        parentVsize: parentTx.vsize,
        outputValue: output.value,
        requiredChildFee: 0,
        effectivePackageFeeRate: 0,
      };
    }

    // Estimate child transaction size (1 input, 1 output)
    const childVsize = this.estimateChildVsize(output.address);

    // Calculate required fee for the package
    // Package fee rate = (parent_fee + child_fee) / (parent_vsize + child_vsize)
    // Solving for child_fee:
    // child_fee = target_rate * (parent_vsize + child_vsize) - parent_fee
    const totalVsize = parentTx.vsize + childVsize;
    const requiredTotalFee = Math.ceil(targetFeeRate * totalVsize);
    const requiredChildFee = requiredTotalFee - parentTx.fee;

    // Check if output value can cover the child fee
    const minOutputValue = requiredChildFee + TRANSACTION.DUST_THRESHOLD;
    if (output.value < minOutputValue) {
      return {
        canBump: false,
        reason: `Output value (${output.value} sats) insufficient for CPFP. Need at least ${minOutputValue} sats.`,
        parentFee: parentTx.fee,
        parentFeeRate: parentTx.feeRate,
        parentVsize: parentTx.vsize,
        outputValue: output.value,
        requiredChildFee,
        effectivePackageFeeRate: targetFeeRate,
      };
    }

    const effectivePackageFeeRate = requiredTotalFee / totalVsize;

    return {
      canBump: true,
      parentFee: parentTx.fee,
      parentFeeRate: parentTx.feeRate,
      parentVsize: parentTx.vsize,
      outputValue: output.value,
      requiredChildFee,
      effectivePackageFeeRate,
    };
  }

  /**
   * Create a CPFP child transaction
   * @param parentTx - The parent transaction to accelerate
   * @param options - CPFP options
   */
  createCPFPChild(
    parentTx: DetailedTransactionInfo,
    options: CPFPOptions
  ): { psbt: bitcoin.Psbt; cpfpInfo: CPFPTransaction } {
    const { outputIndex, targetFeeRate, outputAddress, enableRBF = true } = options;

    // Analyze first
    const analysis = this.analyzeCPFP(parentTx, outputIndex, targetFeeRate);
    if (!analysis.canBump) {
      throw new Error(analysis.reason || 'Cannot create CPFP transaction');
    }

    const parentOutput = parentTx.outputs[outputIndex];
    const childVsize = this.estimateChildVsize(parentOutput.address!);

    // Calculate fees
    const totalVsize = parentTx.vsize + childVsize;
    const requiredTotalFee = Math.ceil(targetFeeRate * totalVsize);
    const childFee = requiredTotalFee - parentTx.fee;
    const childOutputValue = parentOutput.value - childFee;

    if (childOutputValue < TRANSACTION.DUST_THRESHOLD) {
      throw new Error('CPFP would create dust output');
    }

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add parent output as input
    const outputScript = bitcoin.address.toOutputScript(parentOutput.address!, this.network);
    psbt.addInput({
      hash: parentTx.txid,
      index: outputIndex,
      sequence: enableRBF ? 0xfffffffd : 0xffffffff,
      witnessUtxo: {
        script: outputScript,
        value: BigInt(parentOutput.value),
      },
    });

    // Add output
    psbt.addOutput({
      address: outputAddress,
      value: BigInt(childOutputValue),
    });

    const cpfpInfo: CPFPTransaction = {
      parentTxid: parentTx.txid,
      parentFee: parentTx.fee,
      parentFeeRate: parentTx.feeRate,
      parentVsize: parentTx.vsize,
      childFeeRate: childFee / childVsize,
      childFee,
      outputIndex,
      outputValue: parentOutput.value,
      effectivePackageFeeRate: requiredTotalFee / totalVsize,
    };

    return { psbt, cpfpInfo };
  }

  /**
   * Estimate the virtual size of a CPFP child transaction
   */
  private estimateChildVsize(inputAddress: string): number {
    const inputType = this.detectAddressType(inputAddress);

    let inputVBytes: number;
    switch (inputType) {
      case ADDRESS_TYPES.TAPROOT:
        inputVBytes = TRANSACTION.INPUT_VBYTES.P2TR;
        break;
      case ADDRESS_TYPES.NATIVE_SEGWIT:
        inputVBytes = TRANSACTION.INPUT_VBYTES.P2WPKH;
        break;
      case ADDRESS_TYPES.WRAPPED_SEGWIT:
        inputVBytes = TRANSACTION.INPUT_VBYTES.P2SH_P2WPKH;
        break;
      case ADDRESS_TYPES.LEGACY:
      default:
        inputVBytes = TRANSACTION.INPUT_VBYTES.P2PKH;
        break;
    }

    // 1 input, 1 output (P2WPKH)
    return Math.ceil(inputVBytes + TRANSACTION.VBYTES_PER_OUTPUT + TRANSACTION.VBYTES_OVERHEAD);
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
   * Calculate the recommended bump fee for stuck transaction
   * @param stuckFeeRate - The current fee rate of the stuck transaction
   * @param currentMempoolFeeRate - Current mempool fee rate for fast confirmation
   */
  static calculateRecommendedBumpFee(
    stuckFeeRate: number,
    currentMempoolFeeRate: number
  ): number {
    // Bump to at least the current mempool rate, or 50% higher than original
    const minBump = Math.ceil(stuckFeeRate) + 1;
    const percentageBump = Math.ceil(stuckFeeRate * 1.5);

    return Math.max(minBump, percentageBump, currentMempoolFeeRate);
  }

  /**
   * Check if a raw transaction signals RBF
   * @param txHex - Raw transaction hex
   */
  static isRBFSignaled(txHex: string): boolean {
    const tx = bitcoin.Transaction.fromHex(txHex);

    // Check if any input has sequence < 0xFFFFFFFE
    for (const input of tx.ins) {
      if (input.sequence < 0xfffffffe) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate the total fee for a CPFP package
   * @param parentVsize - Parent transaction vsize
   * @param childVsize - Child transaction vsize
   * @param targetFeeRate - Desired effective fee rate
   */
  static calculatePackageFee(
    parentVsize: number,
    childVsize: number,
    targetFeeRate: number
  ): { totalFee: number; parentPortion: number; childPortion: number } {
    const totalVsize = parentVsize + childVsize;
    const totalFee = Math.ceil(targetFeeRate * totalVsize);

    // The parent already has its fee; calculate child's additional contribution
    // In practice, the child pays the deficit
    return {
      totalFee,
      parentPortion: Math.ceil(targetFeeRate * parentVsize),
      childPortion: Math.ceil(targetFeeRate * childVsize),
    };
  }
}
