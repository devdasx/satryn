import type { UTXO, AddressType } from '../../types';
import { TRANSACTION, ADDRESS_TYPES } from '../../constants';

interface CoinSelectionResult {
  inputs: UTXO[];
  inputTotal: number;
  fee: number;
  change: number;
}

type InputType = 'P2TR' | 'P2WPKH' | 'P2SH_P2WPKH' | 'P2PKH';
type OutputType = 'P2TR' | 'P2WPKH' | 'P2SH' | 'P2PKH';

/**
 * UTXO Coin Selection Algorithm
 * Implements a simple but effective algorithm for selecting UTXOs
 * Supports P2TR (Taproot), P2WPKH (Native SegWit), P2SH-P2WPKH (Wrapped SegWit), and P2PKH (Legacy)
 */
export class UTXOSelector {
  // Simple sort cache to avoid re-sorting the same UTXO set
  private static _sortedCache: { hash: string; sorted: UTXO[] } | null = null;

  /**
   * Get UTXOs sorted by value descending, using cache if UTXO set hasn't changed.
   */
  private static getSortedUtxos(utxos: UTXO[]): UTXO[] {
    // Stable hash: include first, last, middle element + total value for collision resistance
    const mid = utxos.length > 2 ? utxos[Math.floor(utxos.length / 2)] : null;
    const totalValue = utxos.reduce((s, u) => s + u.value, 0);
    const hash = `${utxos.length}_${totalValue}_${utxos[0]?.txid}:${utxos[0]?.vout}_${utxos[utxos.length - 1]?.txid}:${utxos[utxos.length - 1]?.vout}_${mid?.txid ?? ''}:${mid?.vout ?? ''}`;
    if (this._sortedCache?.hash === hash) {
      return this._sortedCache.sorted;
    }
    const sorted = [...utxos].sort((a, b) => b.value - a.value);
    this._sortedCache = { hash, sorted };
    return sorted;
  }
  /**
   * Detect the input type from an address
   */
  static detectInputType(address: string): InputType {
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return 'P2TR';
    }
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return 'P2WPKH';
    }
    if (address.startsWith('3') || address.startsWith('2')) {
      return 'P2SH_P2WPKH';
    }
    return 'P2PKH';
  }

  /**
   * Detect the output type from an address
   */
  static detectOutputType(address: string): OutputType {
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      return 'P2TR';
    }
    if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      return 'P2WPKH';
    }
    if (address.startsWith('3') || address.startsWith('2')) {
      return 'P2SH';
    }
    return 'P2PKH';
  }

  /**
   * Get vBytes for an input type
   */
  static getInputVBytes(inputType: InputType): number {
    return TRANSACTION.INPUT_VBYTES[inputType];
  }

  /**
   * Get vBytes for an output type
   */
  static getOutputVBytes(outputType: OutputType): number {
    return TRANSACTION.OUTPUT_VBYTES[outputType];
  }

  /**
   * Estimate the transaction size in virtual bytes
   * @param inputCount - Number of inputs (assumes P2WPKH for backward compatibility)
   * @param outputCount - Number of outputs (assumes P2WPKH for backward compatibility)
   * @returns Estimated size in vBytes
   */
  static estimateVSize(inputCount: number, outputCount: number): number {
    // Default to P2WPKH for backward compatibility
    return Math.ceil(
      inputCount * TRANSACTION.VBYTES_PER_INPUT +
      outputCount * TRANSACTION.VBYTES_PER_OUTPUT +
      TRANSACTION.VBYTES_OVERHEAD
    );
  }

  /**
   * Estimate the transaction size with specific input and output types
   * @param inputs - Array of UTXOs (to detect input types)
   * @param outputAddresses - Array of output addresses (to detect output types)
   * @returns Estimated size in vBytes
   */
  static estimateVSizeWithTypes(inputs: UTXO[], outputAddresses: string[]): number {
    let inputVBytes = 0;
    for (const input of inputs) {
      const inputType = this.detectInputType(input.address);
      inputVBytes += this.getInputVBytes(inputType);
    }

    let outputVBytes = 0;
    for (const address of outputAddresses) {
      const outputType = this.detectOutputType(address);
      outputVBytes += this.getOutputVBytes(outputType);
    }

    return Math.ceil(inputVBytes + outputVBytes + TRANSACTION.VBYTES_OVERHEAD);
  }

  /**
   * Calculate the fee for a transaction
   * @param vSize - Transaction size in vBytes
   * @param feeRate - Fee rate in sat/vB
   * @returns Fee in satoshis
   */
  static calculateFee(vSize: number, feeRate: number): number {
    return Math.ceil(vSize * feeRate);
  }

  /**
   * Select UTXOs for a transaction using a simple accumulator algorithm
   * Prefers using fewer, larger UTXOs to minimize fees
   *
   * @param utxos - Available UTXOs
   * @param targetAmount - Amount to send (in satoshis)
   * @param feeRate - Fee rate in sat/vB
   * @param hasChange - Whether a change output is expected
   * @returns Selection result or null if insufficient funds
   */
  static select(
    utxos: UTXO[],
    targetAmount: number,
    feeRate: number,
    hasChange: boolean = true
  ): CoinSelectionResult | null {
    if (utxos.length === 0) {
      return null;
    }

    // Sort UTXOs by value descending (prefer larger UTXOs), using cache
    const sortedUtxos = this.getSortedUtxos(utxos);

    // Calculate output count (1 for recipient, optionally 1 for change)
    const outputCount = hasChange ? 2 : 1;

    const selectedUtxos: UTXO[] = [];
    let inputTotal = 0;

    // Accumulate UTXOs until we have enough
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      inputTotal += utxo.value;

      // Calculate fee with current selection using per-input type estimation
      // This gives more accurate fees for Taproot and mixed-type wallets
      let vSize: number;
      if (selectedUtxos.every(u => u.address)) {
        // Use type-aware estimation when addresses are available
        const dummyOutputAddresses = hasChange
          ? [selectedUtxos[0].address, selectedUtxos[0].address] // approximate output types
          : [selectedUtxos[0].address];
        vSize = this.estimateVSizeWithTypes(selectedUtxos, dummyOutputAddresses);
      } else {
        vSize = this.estimateVSize(selectedUtxos.length, outputCount);
      }
      const fee = this.calculateFee(vSize, feeRate);
      const required = targetAmount + fee;

      if (inputTotal >= required) {
        const change = inputTotal - targetAmount - fee;

        // If change is dust, add it to the fee (with sanity check)
        if (change > 0 && change < TRANSACTION.DUST_THRESHOLD) {
          const feeWithDust = fee + change;
          // Sanity check: warn if fee becomes unreasonably high (>5x estimated)
          const maxReasonableFee = fee * 5;
          if (feeWithDust > maxReasonableFee && maxReasonableFee > 0) {
            console.warn(`[UTXOSelector] Dust absorption caused fee to exceed 5x estimate: ${feeWithDust} vs expected ~${fee}`);
          }
          return {
            inputs: selectedUtxos,
            inputTotal,
            fee: feeWithDust,
            change: 0,
          };
        }

        return {
          inputs: selectedUtxos,
          inputTotal,
          fee,
          change,
        };
      }
    }

    // Insufficient funds
    return null;
  }

  /**
   * Select UTXOs optimized for a specific output amount
   * Tries to find a combination that minimizes change
   *
   * @param utxos - Available UTXOs
   * @param targetAmount - Amount to send
   * @param feeRate - Fee rate in sat/vB
   * @returns Selection result or null if insufficient funds
   */
  static selectOptimal(
    utxos: UTXO[],
    targetAmount: number,
    feeRate: number
  ): CoinSelectionResult | null {
    // First try without change (exact match or dust change)
    const noChangeVSize = this.estimateVSize(1, 1);
    const minFeeNoChange = this.calculateFee(noChangeVSize, feeRate);

    // Look for single UTXO that's close to target
    for (const utxo of utxos) {
      const excess = utxo.value - targetAmount - minFeeNoChange;
      if (excess >= 0 && excess < TRANSACTION.DUST_THRESHOLD) {
        return {
          inputs: [utxo],
          inputTotal: utxo.value,
          fee: utxo.value - targetAmount, // Excess goes to fee
          change: 0,
        };
      }
    }

    // Fall back to standard selection
    return this.select(utxos, targetAmount, feeRate, true);
  }

  /**
   * Calculate the maximum sendable amount given UTXOs and fee rate
   * @param utxos - Available UTXOs
   * @param feeRate - Fee rate in sat/vB
   * @returns Maximum amount that can be sent (in satoshis)
   */
  static calculateMaxSendable(utxos: UTXO[], feeRate: number): number {
    if (utxos.length === 0) {
      return 0;
    }

    const totalValue = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    // Use all UTXOs, 1 output (no change when sending max)
    const vSize = this.estimateVSize(utxos.length, 1);
    const fee = this.calculateFee(vSize, feeRate);

    const maxSendable = totalValue - fee;
    return maxSendable > 0 ? maxSendable : 0;
  }

  /**
   * Filter out dust UTXOs that would cost more to spend than they're worth
   * @param utxos - UTXOs to filter
   * @param feeRate - Current fee rate
   * @returns Economically viable UTXOs
   */
  static filterDust(utxos: UTXO[], feeRate: number): UTXO[] {
    // Cost to spend a P2WPKH input
    const costToSpend = Math.ceil(TRANSACTION.VBYTES_PER_INPUT * feeRate);

    return utxos.filter(utxo => utxo.value > costToSpend);
  }
}
