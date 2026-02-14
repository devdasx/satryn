/**
 * SyncValidator — Sanity checks before committing sync results
 *
 * Validates a StagingSnapshot against the current LKG to prevent
 * data corruption. If validation fails, the staging data is DISCARDED
 * and the LKG remains unchanged.
 *
 * 5 SANITY CHECKS:
 * 1. Completeness — all scripthashes must have been queried successfully
 * 2. "Do not zero out" — reject suspicious empty balance when previous > 0
 * 3. "Do not delete transactions" — reject empty tx set when previous had txs
 * 4. Height sanity — tip height must not regress beyond reorg threshold
 * 5. Parse integrity — >10% tx decode failures → reject
 */

import type {
  StagingSnapshot,
  LkgSnapshot,
  WalletFileV2Schema,
  ValidationResult,
} from './types';

// Maximum allowed block height regression (beyond normal reorg)
const MAX_HEIGHT_REGRESSION = 6;

// Maximum percentage of tx decode failures before rejecting
const MAX_TX_FAILURE_RATE = 0.10;

export class SyncValidator {
  /**
   * Validate a staging snapshot before committing to LKG.
   *
   * Returns { valid: true } if safe to commit, or
   * { valid: false, errors: [...] } if staging should be discarded.
   *
   * Warnings are non-fatal observations that don't block the commit.
   */
  validate(
    staging: StagingSnapshot,
    currentLkg: LkgSnapshot,
    walletFile: WalletFileV2Schema
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Check 1: Completeness ───────────────────────────────────────
    this.checkCompleteness(staging, errors, warnings);

    // ── Check 2: Do not zero out ────────────────────────────────────
    this.checkDoNotZeroOut(staging, currentLkg, errors, warnings);

    // ── Check 3: Do not delete transactions ─────────────────────────
    this.checkDoNotDeleteTransactions(staging, currentLkg, errors, warnings);

    // ── Check 4: Height sanity ──────────────────────────────────────
    this.checkHeightSanity(staging, currentLkg, errors, warnings);

    // ── Check 5: Parse integrity ────────────────────────────────────
    this.checkParseIntegrity(staging, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check 1: Completeness
   * All scripthashes must have been queried successfully.
   * If partial (not all succeeded), REJECT.
   */
  private checkCompleteness(
    staging: StagingSnapshot,
    errors: string[],
    warnings: string[]
  ): void {
    if (!staging.meta.isComplete) {
      const queried = staging.meta.scripthashesQueried;
      const succeeded = staging.meta.scripthashesSucceeded;
      errors.push(
        `Incomplete sync: ${succeeded}/${queried} scripthashes succeeded`
      );
    }
  }

  /**
   * Check 2: "Do not zero out" rule
   * If LKG has confirmed balance > 0 and staging produces 0 confirmed balance,
   * require ALL of: isComplete, has history, no missing tx details, sane tip height.
   * If any condition fails → REJECT.
   *
   * This prevents a misbehaving server from zeroing out a wallet.
   */
  private checkDoNotZeroOut(
    staging: StagingSnapshot,
    currentLkg: LkgSnapshot,
    errors: string[],
    warnings: string[]
  ): void {
    // Only applies if current LKG has a non-zero confirmed balance
    if (currentLkg.confirmedBalanceSat <= 0) return;

    // Compute staging confirmed balance from UTXOs
    let stagingConfirmed = 0;
    for (const u of staging.utxos) {
      if (u.height > 0) stagingConfirmed += u.valueSat;
    }

    // If staging has confirmed balance, no issue
    if (stagingConfirmed > 0) return;

    // Zero confirmed balance with non-zero previous — suspicious
    // Check all conditions for legitimate zero-out
    const failReasons: string[] = [];

    if (!staging.meta.isComplete) {
      failReasons.push('sync is incomplete');
    }

    // Check if there's ANY history at all
    const hasHistory = Object.values(staging.historyMap).some(
      entries => entries.length > 0
    );
    if (!hasHistory) {
      failReasons.push('no transaction history found');
    }

    if (staging.meta.txDetailsMissing.length > 0) {
      failReasons.push(
        `${staging.meta.txDetailsMissing.length} tx details missing`
      );
    }

    // If tip height is sane (not regressed), it's more trustworthy
    if (currentLkg.tipHeightAtCommit !== null && staging.meta.tipHeight > 0) {
      if (staging.meta.tipHeight < currentLkg.tipHeightAtCommit - MAX_HEIGHT_REGRESSION) {
        failReasons.push('tip height regressed significantly');
      }
    }

    if (failReasons.length > 0) {
      errors.push(
        `Suspicious zero-out: previous confirmed=${currentLkg.confirmedBalanceSat} sat, ` +
        `staging confirmed=0 sat. Reasons: ${failReasons.join(', ')}`
      );
    } else {
      // All conditions met — allow the zero-out but warn
      warnings.push(
        `Balance went from ${currentLkg.confirmedBalanceSat} sat to 0 sat. ` +
        `Sync was complete with history — legitimate spend.`
      );
    }
  }

  /**
   * Check 3: "Do not delete transactions" rule
   * If LKG has transactions and staging produces 0 txids AND sync is incomplete → REJECT.
   * A legitimate wallet with history should not suddenly have zero transactions.
   */
  private checkDoNotDeleteTransactions(
    staging: StagingSnapshot,
    currentLkg: LkgSnapshot,
    errors: string[],
    warnings: string[]
  ): void {
    // Only applies if LKG has transactions
    if (currentLkg.transactions.length === 0) return;

    // Count unique txids from staging history
    const stagingTxids = new Set<string>();
    for (const entries of Object.values(staging.historyMap)) {
      for (const entry of entries) {
        stagingTxids.add(entry.txHash);
      }
    }

    if (stagingTxids.size > 0) return; // Has transactions, OK

    // Zero transactions with non-zero previous
    if (!staging.meta.isComplete) {
      errors.push(
        `Transaction deletion: LKG has ${currentLkg.transactions.length} txs, ` +
        `staging has 0 txids and sync is incomplete`
      );
    } else {
      // Complete sync with zero txids — possible if watching new addresses
      // that replaced old ones, but still suspicious
      warnings.push(
        `LKG had ${currentLkg.transactions.length} transactions but staging found 0. ` +
        `Sync was complete — possibly address set changed.`
      );
    }
  }

  /**
   * Check 4: Height sanity
   * If staging tip height regresses more than MAX_HEIGHT_REGRESSION blocks
   * from LKG tip height → REJECT (exceeds normal reorg threshold).
   */
  private checkHeightSanity(
    staging: StagingSnapshot,
    currentLkg: LkgSnapshot,
    errors: string[],
    warnings: string[]
  ): void {
    // Skip if we don't have a reference height
    if (currentLkg.tipHeightAtCommit === null) return;
    if (staging.meta.tipHeight <= 0) return;

    const regression = currentLkg.tipHeightAtCommit - staging.meta.tipHeight;

    if (regression > MAX_HEIGHT_REGRESSION) {
      errors.push(
        `Height regression: LKG tip=${currentLkg.tipHeightAtCommit}, ` +
        `staging tip=${staging.meta.tipHeight}, ` +
        `regression=${regression} blocks (max allowed: ${MAX_HEIGHT_REGRESSION})`
      );
    } else if (regression > 0) {
      // Small regression within reorg threshold — warn but allow
      warnings.push(
        `Minor height regression of ${regression} blocks ` +
        `(within ${MAX_HEIGHT_REGRESSION}-block reorg threshold)`
      );
    }
  }

  /**
   * Check 5: Parse integrity
   * If more than MAX_TX_FAILURE_RATE of new txids failed to decode → REJECT.
   * This catches protocol-level corruption or server-sent garbage.
   */
  private checkParseIntegrity(
    staging: StagingSnapshot,
    errors: string[],
    warnings: string[]
  ): void {
    const totalFetched = staging.meta.txDetailsFetched;
    const totalMissing = staging.meta.txDetailsMissing.length;

    if (totalFetched === 0 && totalMissing === 0) return; // No txs to check

    const totalAttempted = totalFetched + totalMissing;
    if (totalAttempted === 0) return;

    const failureRate = totalMissing / totalAttempted;

    if (failureRate > MAX_TX_FAILURE_RATE) {
      errors.push(
        `Parse integrity failure: ${totalMissing}/${totalAttempted} ` +
        `(${(failureRate * 100).toFixed(1)}%) tx details failed. ` +
        `Max allowed: ${(MAX_TX_FAILURE_RATE * 100).toFixed(0)}%`
      );
    } else if (totalMissing > 0) {
      warnings.push(
        `${totalMissing} tx detail(s) could not be fetched ` +
        `(${(failureRate * 100).toFixed(1)}% failure rate, within tolerance)`
      );
    }
  }
}
