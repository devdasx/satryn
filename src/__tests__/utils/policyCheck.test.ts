/**
 * Policy Check — Unit Tests
 *
 * Tests:
 * - Dust output detection
 * - Low fee rate detection
 * - High fee rate warning
 * - High fee ratio warning
 * - Output exceeds input detection
 * - Valid transaction passes clean
 */

import { checkLocalPolicies, type PolicyCheckParams } from '../../utils/policyCheck';

function createValidParams(overrides?: Partial<PolicyCheckParams>): PolicyCheckParams {
  return {
    outputs: [{ address: 'bc1q_test', amount: 50000 }],
    feeRate: 10,
    fee: 1410,
    vSize: 141,
    totalInput: 60000,
    ...overrides,
  };
}

describe('checkLocalPolicies', () => {
  test('valid transaction returns no violations', () => {
    const violations = checkLocalPolicies(createValidParams());
    expect(violations).toHaveLength(0);
  });

  test('detects dust output', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_test', amount: 300 }],
    }));
    const dust = violations.find(v => v.code === 'DUST_OUTPUT');
    expect(dust).toBeDefined();
    expect(dust?.severity).toBe('error');
  });

  test('does not flag non-dust output', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_test', amount: 600 }],
    }));
    const dust = violations.find(v => v.code === 'DUST_OUTPUT');
    expect(dust).toBeUndefined();
  });

  test('detects fee rate below minimum', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 0.5,
    }));
    const low = violations.find(v => v.code === 'FEE_TOO_LOW');
    expect(low).toBeDefined();
    expect(low?.severity).toBe('error');
  });

  test('detects unusually high fee rate', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 600,
    }));
    const high = violations.find(v => v.code === 'FEE_RATE_HIGH');
    expect(high).toBeDefined();
    expect(high?.severity).toBe('warning');
  });

  test('does not flag normal fee rate', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 50,
    }));
    const high = violations.find(v => v.code === 'FEE_RATE_HIGH');
    expect(high).toBeUndefined();
  });

  test('detects high fee ratio (fee > 50% of output)', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_test', amount: 1000 }],
      fee: 600, // 60% of 1000
      totalInput: 2000,
    }));
    const ratio = violations.find(v => v.code === 'FEE_RATIO_HIGH');
    expect(ratio).toBeDefined();
    expect(ratio?.severity).toBe('warning');
  });

  test('detects output exceeds input', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_test', amount: 50000 }],
      fee: 1410,
      totalInput: 40000, // Less than 50000 + 1410
    }));
    const exceeds = violations.find(v => v.code === 'OUTPUT_EXCEEDS_INPUT');
    expect(exceeds).toBeDefined();
    expect(exceeds?.severity).toBe('error');
  });

  test('multiple violations returned together', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_test', amount: 300 }], // dust
      feeRate: 0.5, // too low
      fee: -10, // negative
      totalInput: 200, // less than outputs
    }));
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});
