/**
 * Policy Check — 021 Enhancement Pack (Feature 9)
 *
 * Local mempool policy validation before broadcast.
 * Catches common issues that would cause node rejection.
 */

// ============================================
// TYPES
// ============================================

export type PolicySeverity = 'warning' | 'error';

export interface PolicyViolation {
  code: string;
  severity: PolicySeverity;
  title: string;
  message: string;
}

export interface PolicyCheckParams {
  outputs: { address: string; amount: number }[];
  feeRate: number;
  fee: number;
  vSize: number;
  totalInput: number;
}

// ============================================
// THRESHOLDS
// ============================================

const DUST_THRESHOLD = 547; // sats
const MIN_FEE_RATE = 1; // sat/vB
const HIGH_FEE_RATE = 500; // sat/vB — unusually high
const FEE_RATIO_WARNING = 0.5; // fee > 50% of total output

// ============================================
// CHECKER
// ============================================

/**
 * Run local policy checks on transaction parameters.
 * Returns array of violations (empty = all good).
 */
export function checkLocalPolicies(params: PolicyCheckParams): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const { outputs, feeRate, fee, vSize, totalInput } = params;

  const totalOutput = outputs.reduce((sum, o) => sum + o.amount, 0);

  // 1. Dust outputs
  for (const output of outputs) {
    if (output.amount > 0 && output.amount < DUST_THRESHOLD) {
      violations.push({
        code: 'DUST_OUTPUT',
        severity: 'error',
        title: 'Dust Output',
        message: `Output of ${output.amount} sats is below the dust threshold (${DUST_THRESHOLD} sats). Nodes will reject this transaction.`,
      });
    }
  }

  // 2. Fee rate too low
  if (feeRate < MIN_FEE_RATE) {
    violations.push({
      code: 'FEE_TOO_LOW',
      severity: 'error',
      title: 'Fee Rate Too Low',
      message: `Fee rate of ${feeRate} sat/vB is below the minimum relay fee (1 sat/vB). This transaction will not propagate.`,
    });
  }

  // 3. Fee rate unusually high
  if (feeRate > HIGH_FEE_RATE) {
    violations.push({
      code: 'FEE_RATE_HIGH',
      severity: 'warning',
      title: 'Unusually High Fee Rate',
      message: `Fee rate of ${feeRate} sat/vB is much higher than typical. This may result in significant overpayment.`,
    });
  }

  // 4. Fee is a large portion of output
  if (totalOutput > 0 && fee > totalOutput * FEE_RATIO_WARNING) {
    const pct = Math.round((fee / totalOutput) * 100);
    violations.push({
      code: 'FEE_RATIO_HIGH',
      severity: 'warning',
      title: 'High Fee Ratio',
      message: `The fee (${fee} sats) is ${pct}% of the total output amount. Consider reducing the fee rate.`,
    });
  }

  // 5. Output exceeds input (shouldn't happen but sanity check)
  if (totalOutput + fee > totalInput) {
    violations.push({
      code: 'OUTPUT_EXCEEDS_INPUT',
      severity: 'error',
      title: 'Insufficient Inputs',
      message: 'Total outputs plus fee exceed total inputs. This transaction is invalid.',
    });
  }

  // 6. Negative fee (fee would be less than 0)
  if (fee < 0) {
    violations.push({
      code: 'NEGATIVE_FEE',
      severity: 'error',
      title: 'Invalid Fee',
      message: 'The calculated fee is negative. This indicates a transaction construction error.',
    });
  }

  return violations;
}
