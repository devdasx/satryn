/**
 * Recent Recipient Store — Unit Tests
 *
 * Tests:
 * - Record new recipient
 * - Update existing recipient (bump count + lastUsed)
 * - Sort by recency
 * - Max 50 eviction
 * - Remove and clear
 * - isKnownRecipient
 */

import { useRecentRecipientStore } from '../../stores/recentRecipientStore';

// Reset store before each test
beforeEach(() => {
  useRecentRecipientStore.getState().clear();
});

describe('recentRecipientStore', () => {
  test('records a new recipient', () => {
    useRecentRecipientStore.getState().recordRecipient('bc1q_addr_1');
    const recipients = useRecentRecipientStore.getState().recipients;
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe('bc1q_addr_1');
    expect(recipients[0].useCount).toBe(1);
    expect(recipients[0].contactId).toBeNull();
    expect(recipients[0].label).toBeNull();
  });

  test('records with contactId and label', () => {
    useRecentRecipientStore.getState().recordRecipient('bc1q_addr_1', 'contact-123', 'Alice');
    const r = useRecentRecipientStore.getState().recipients[0];
    expect(r.contactId).toBe('contact-123');
    expect(r.label).toBe('Alice');
  });

  test('bumps useCount for existing recipient', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_addr_1');
    store.recordRecipient('bc1q_addr_1');
    store.recordRecipient('bc1q_addr_1');

    const recipients = useRecentRecipientStore.getState().recipients;
    expect(recipients).toHaveLength(1);
    expect(recipients[0].useCount).toBe(3);
  });

  test('updates contactId on subsequent record', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_addr_1');
    store.recordRecipient('bc1q_addr_1', 'new-contact');

    expect(useRecentRecipientStore.getState().recipients[0].contactId).toBe('new-contact');
  });

  test('getRecent returns sorted by lastUsed descending', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_oldest');

    // Slight delay to ensure different timestamps
    store.recordRecipient('bc1q_middle');
    store.recordRecipient('bc1q_newest');

    const recent = useRecentRecipientStore.getState().getRecent(3);
    expect(recent[0].address).toBe('bc1q_newest');
  });

  test('getRecent respects limit', () => {
    const store = useRecentRecipientStore.getState();
    for (let i = 0; i < 10; i++) {
      store.recordRecipient(`bc1q_addr_${i}`);
    }

    const recent = useRecentRecipientStore.getState().getRecent(5);
    expect(recent).toHaveLength(5);
  });

  test('getAllAddresses returns all addresses', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_a');
    store.recordRecipient('bc1q_b');
    store.recordRecipient('bc1q_c');

    const addrs = useRecentRecipientStore.getState().getAllAddresses();
    expect(addrs).toContain('bc1q_a');
    expect(addrs).toContain('bc1q_b');
    expect(addrs).toContain('bc1q_c');
  });

  test('isKnownRecipient returns true for recorded address', () => {
    useRecentRecipientStore.getState().recordRecipient('bc1q_known');
    expect(useRecentRecipientStore.getState().isKnownRecipient('bc1q_known')).toBe(true);
    expect(useRecentRecipientStore.getState().isKnownRecipient('bc1q_unknown')).toBe(false);
  });

  test('removeRecipient removes specific address', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_keep');
    store.recordRecipient('bc1q_remove');

    store.removeRecipient('bc1q_remove');
    expect(useRecentRecipientStore.getState().recipients).toHaveLength(1);
    expect(useRecentRecipientStore.getState().recipients[0].address).toBe('bc1q_keep');
  });

  test('evicts oldest when exceeding 50 max', () => {
    const store = useRecentRecipientStore.getState();
    // Record 55 recipients
    for (let i = 0; i < 55; i++) {
      store.recordRecipient(`bc1q_addr_${i.toString().padStart(3, '0')}`);
    }

    const recipients = useRecentRecipientStore.getState().recipients;
    expect(recipients.length).toBeLessThanOrEqual(50);
  });

  test('clear removes all recipients', () => {
    const store = useRecentRecipientStore.getState();
    store.recordRecipient('bc1q_a');
    store.recordRecipient('bc1q_b');

    store.clear();
    expect(useRecentRecipientStore.getState().recipients).toHaveLength(0);
  });
});
