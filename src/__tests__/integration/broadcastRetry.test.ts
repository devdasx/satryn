/**
 * Broadcast Retry Integration Tests — 021 Enhancement Pack
 *
 * Tests policy check validation and recent recipient recording.
 * Cannot test actual Electrum broadcast, but validates:
 * - Policy check catches dust outputs
 * - Policy check catches low fee rate
 * - Policy check passes valid transactions
 * - Policy check returns multiple violations for bad tx
 * - Recent recipient recording after successful send
 */

import { checkLocalPolicies, type PolicyCheckParams } from '../../utils/policyCheck';
import { useRecentRecipientStore } from '../../stores/recentRecipientStore';

// Helper to create valid transaction params
function createValidParams(overrides?: Partial<PolicyCheckParams>): PolicyCheckParams {
  return {
    outputs: [{ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 50000 }],
    feeRate: 10,
    fee: 1410,
    vSize: 141,
    totalInput: 60000,
    ...overrides,
  };
}

beforeEach(() => {
  useRecentRecipientStore.getState().clear();
});

describe('Broadcast Retry Integration', () => {
  // ============================================
  // Policy check catches dust outputs
  // ============================================

  test('policy check rejects transaction with dust output', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_recipient', amount: 300 }],
    }));

    const dust = violations.find(v => v.code === 'DUST_OUTPUT');
    expect(dust).toBeDefined();
    expect(dust?.severity).toBe('error');
    expect(dust?.title).toContain('Dust');
  });

  test('policy check accepts output above dust threshold', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_recipient', amount: 1000 }],
    }));

    const dust = violations.find(v => v.code === 'DUST_OUTPUT');
    expect(dust).toBeUndefined();
  });

  test('policy check catches dust in multi-output transaction', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [
        { address: 'bc1q_recipient1', amount: 50000 },
        { address: 'bc1q_recipient2', amount: 200 }, // dust
      ],
      totalInput: 60000,
    }));

    const dust = violations.find(v => v.code === 'DUST_OUTPUT');
    expect(dust).toBeDefined();
  });

  // ============================================
  // Policy check catches low fee rate
  // ============================================

  test('policy check rejects fee rate below 1 sat/vB', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 0.5,
    }));

    const low = violations.find(v => v.code === 'FEE_TOO_LOW');
    expect(low).toBeDefined();
    expect(low?.severity).toBe('error');
  });

  test('policy check accepts fee rate at exactly 1 sat/vB', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 1,
    }));

    const low = violations.find(v => v.code === 'FEE_TOO_LOW');
    expect(low).toBeUndefined();
  });

  test('policy check warns on unusually high fee rate', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 600,
    }));

    const high = violations.find(v => v.code === 'FEE_RATE_HIGH');
    expect(high).toBeDefined();
    expect(high?.severity).toBe('warning');
  });

  // ============================================
  // Policy check passes valid transaction
  // ============================================

  test('valid transaction produces zero violations', () => {
    const violations = checkLocalPolicies(createValidParams());
    expect(violations).toHaveLength(0);
  });

  test('valid transaction with moderate fee rate passes clean', () => {
    const violations = checkLocalPolicies(createValidParams({
      feeRate: 25,
      fee: 3525,
      vSize: 141,
      outputs: [{ address: 'bc1q_recipient', amount: 50000 }],
      totalInput: 60000,
    }));

    expect(violations).toHaveLength(0);
  });

  // ============================================
  // Policy check returns multiple violations for bad tx
  // ============================================

  test('multiple violations returned for transaction with many issues', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_recipient', amount: 300 }], // dust
      feeRate: 0.5, // too low
      fee: -10, // negative
      totalInput: 200, // less than output + fee
    }));

    // Should have at least dust + fee too low
    expect(violations.length).toBeGreaterThanOrEqual(2);

    const codes = violations.map(v => v.code);
    expect(codes).toContain('DUST_OUTPUT');
    expect(codes).toContain('FEE_TOO_LOW');
  });

  test('high fee ratio detected alongside other violations', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_recipient', amount: 1000 }],
      fee: 600, // 60% of output — triggers FEE_RATIO_HIGH
      feeRate: 600, // also triggers FEE_RATE_HIGH
      totalInput: 2000,
    }));

    const codes = violations.map(v => v.code);
    expect(codes).toContain('FEE_RATIO_HIGH');
    expect(codes).toContain('FEE_RATE_HIGH');
  });

  test('output exceeds input is caught', () => {
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: 'bc1q_recipient', amount: 100000 }],
      fee: 5000,
      totalInput: 50000, // not enough for output + fee
    }));

    const exceeds = violations.find(v => v.code === 'OUTPUT_EXCEEDS_INPUT');
    expect(exceeds).toBeDefined();
    expect(exceeds?.severity).toBe('error');
  });

  // ============================================
  // Recent recipient recording after send
  // ============================================

  test('recording a new recipient adds to recent recipients store', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    useRecentRecipientStore.getState().recordRecipient(address);

    const state = useRecentRecipientStore.getState();
    expect(state.isKnownRecipient(address)).toBe(true);
    expect(state.getAllAddresses()).toContain(address);
  });

  test('recording same recipient twice increments use count', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    useRecentRecipientStore.getState().recordRecipient(address);
    useRecentRecipientStore.getState().recordRecipient(address);

    const recent = useRecentRecipientStore.getState().getRecent(10);
    const entry = recent.find(r => r.address === address);
    expect(entry).toBeDefined();
    expect(entry?.useCount).toBe(2);
  });

  test('recording recipient with label stores the label', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    useRecentRecipientStore.getState().recordRecipient(address, null, 'Coffee shop');

    const recent = useRecentRecipientStore.getState().getRecent(10);
    const entry = recent.find(r => r.address === address);
    expect(entry?.label).toBe('Coffee shop');
  });

  test('multiple recipients recorded in order', () => {
    useRecentRecipientStore.getState().recordRecipient('bc1q_first_recipient_11111111111111111');
    useRecentRecipientStore.getState().recordRecipient('bc1q_second_recipient_2222222222222222');
    useRecentRecipientStore.getState().recordRecipient('bc1q_third_recipient_33333333333333333');

    const allAddresses = useRecentRecipientStore.getState().getAllAddresses();
    expect(allAddresses).toHaveLength(3);

    const recent = useRecentRecipientStore.getState().getRecent(10);
    // Most recent first
    expect(recent[0].address).toBe('bc1q_third_recipient_33333333333333333');
  });

  test('recent recipients integrate with policy check workflow', () => {
    // Simulate: first do policy check, then record recipient on success
    const recipientAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    // Step 1: Run policy checks
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: recipientAddress, amount: 50000 }],
    }));

    // Step 2: Only record recipient if policy check passes
    if (violations.length === 0) {
      useRecentRecipientStore.getState().recordRecipient(recipientAddress);
    }

    // Verify the recipient was recorded
    expect(useRecentRecipientStore.getState().isKnownRecipient(recipientAddress)).toBe(true);
  });

  test('failed policy check does not record recipient', () => {
    const recipientAddress = 'bc1q_bad_recipient';

    // Policy check with dust output should fail
    const violations = checkLocalPolicies(createValidParams({
      outputs: [{ address: recipientAddress, amount: 100 }], // dust
    }));

    // Only record on success
    if (violations.length === 0) {
      useRecentRecipientStore.getState().recordRecipient(recipientAddress);
    }

    // Recipient should NOT be recorded
    expect(useRecentRecipientStore.getState().isKnownRecipient(recipientAddress)).toBe(false);
  });

  test('clear removes all recent recipients', () => {
    useRecentRecipientStore.getState().recordRecipient('bc1q_first_11111111111111111111111111');
    useRecentRecipientStore.getState().recordRecipient('bc1q_second_2222222222222222222222222');

    expect(useRecentRecipientStore.getState().getAllAddresses()).toHaveLength(2);

    useRecentRecipientStore.getState().clear();

    expect(useRecentRecipientStore.getState().getAllAddresses()).toHaveLength(0);
  });
});
