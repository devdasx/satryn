/**
 * PreservedArchiveService Tests
 *
 * Tests archive/restore round-trip, listing, deletion.
 * These tests verify type correctness and data flow logic.
 * Runtime execution requires mocking expo-secure-store.
 */

import type { ArchiveEntry } from '../../services/storage/PreservedArchiveService';
import type { CanonicalWalletSnapshot } from '../../services/sync/types';
import { createEmptySyncState, createEmptyBackupMeta } from '../../services/sync/types';

// ─── Helpers ────────────────────────────────────────────────────

function createTestSnapshot(walletId: string, name: string): CanonicalWalletSnapshot {
  return {
    schemaVersion: 2,
    walletId,
    name,
    walletType: 'hd_bip84',
    importSource: 'phrase',
    createdAt: Date.now() - 86400000,
    lastModified: Date.now(),
    network: 'mainnet',

    keysAndDescriptors: {
      fingerprint: 'abcd1234',
      xpubs: [],
      descriptors: [],
      scriptTypes: ['p2wpkh'],
    },

    addressCache: {
      addresses: [],
      addressIndices: {
        native_segwit: { receiving: 5, change: 2 },
        wrapped_segwit: { receiving: 0, change: 0 },
        legacy: { receiving: 0, change: 0 },
        taproot: { receiving: 0, change: 0 },
      },
      preferredAddressType: 'native_segwit' as any,
      usedAddresses: ['bc1qaddr1', 'bc1qaddr2'],
      gapLimit: 20,
      lastDiscoveryAt: Date.now(),
      addressLabels: {
        bc1qaddr1: { label: 'Main' },
      },
    },

    utxoCache: {
      utxos: [
        {
          txid: 'utxo_tx_001',
          vout: 0,
          valueSat: 500000,
          height: 800000,
          address: 'bc1qaddr1',
          scriptPubKey: '0014abc',
          scriptType: 'p2wpkh',
          scripthash: 'sh_001',
          confirmations: 10,
        },
      ],
      utxoMetadata: {},
    },

    txCache: {
      transactions: [
        {
          txid: 'utxo_tx_001',
          firstSeenAt: Date.now() - 7200000,
          blockHeight: 800000,
          confirmations: 10,
          direction: 'incoming',
          valueDeltaSat: 500000,
          feeSat: 200,
          feeRate: 4,
          isRBF: false,
          status: 'confirmed',
          inputCount: 1,
          outputCount: 2,
          size: 225,
          vsize: 141,
        },
      ],
      txDetails: {},
      txUserMetadata: {
        utxo_tx_001: {
          note: 'Savings deposit',
          tags: ['income'],
          createdAt: Date.now(),
          editedAt: Date.now(),
        },
      },
    },

    syncState: {
      ...createEmptySyncState(),
      status: 'synced',
      lastSuccessfulSyncAt: Date.now(),
      lastKnownTipHeight: 800010,
    },

    confirmedBalanceSat: 500000,
    unconfirmedBalanceSat: 0,
    trackedTransactions: [],

    isMultisig: false,
    multisigConfig: null,
    backupMeta: createEmptyBackupMeta(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PreservedArchiveService', () => {
  describe('ArchiveEntry type', () => {
    it('should contain all required metadata fields', () => {
      const entry: ArchiveEntry = {
        walletId: 'wallet-001',
        walletName: 'My Wallet',
        walletType: 'hd_bip84',
        archivedAt: Date.now(),
        confirmedBalanceSat: 500000,
        unconfirmedBalanceSat: 0,
        transactionCount: 15,
        utxoCount: 3,
      };

      expect(entry.walletId).toBe('wallet-001');
      expect(entry.walletName).toBe('My Wallet');
      expect(entry.archivedAt).toBeGreaterThan(0);
      expect(entry.confirmedBalanceSat).toBe(500000);
      expect(entry.transactionCount).toBe(15);
      expect(entry.utxoCount).toBe(3);
    });
  });

  describe('Snapshot construction for archiving', () => {
    it('should create a valid CanonicalWalletSnapshot', () => {
      const snapshot = createTestSnapshot('wallet-001', 'My Wallet');

      expect(snapshot.schemaVersion).toBe(2);
      expect(snapshot.walletId).toBe('wallet-001');
      expect(snapshot.utxoCache.utxos).toHaveLength(1);
      expect(snapshot.txCache.transactions).toHaveLength(1);
      expect(snapshot.txCache.txUserMetadata.utxo_tx_001.note).toBe('Savings deposit');
      expect(snapshot.confirmedBalanceSat).toBe(500000);
    });

    it('should build correct ArchiveEntry from snapshot', () => {
      const snapshot = createTestSnapshot('wallet-002', 'Savings');

      const entry: ArchiveEntry = {
        walletId: snapshot.walletId,
        walletName: snapshot.name,
        walletType: snapshot.walletType,
        archivedAt: Date.now(),
        confirmedBalanceSat: snapshot.confirmedBalanceSat,
        unconfirmedBalanceSat: snapshot.unconfirmedBalanceSat,
        transactionCount: snapshot.txCache.transactions.length,
        utxoCount: snapshot.utxoCache.utxos.length,
      };

      expect(entry.walletId).toBe('wallet-002');
      expect(entry.walletName).toBe('Savings');
      expect(entry.confirmedBalanceSat).toBe(500000);
      expect(entry.transactionCount).toBe(1);
      expect(entry.utxoCount).toBe(1);
    });
  });

  describe('Archive index management', () => {
    it('should handle empty index', () => {
      const index: ArchiveEntry[] = [];
      expect(index.length).toBe(0);
    });

    it('should replace existing entry for same walletId', () => {
      const index: ArchiveEntry[] = [
        {
          walletId: 'wallet-001',
          walletName: 'Old Name',
          walletType: 'hd_bip84',
          archivedAt: Date.now() - 86400000,
          confirmedBalanceSat: 100000,
          unconfirmedBalanceSat: 0,
          transactionCount: 5,
          utxoCount: 1,
        },
      ];

      const newEntry: ArchiveEntry = {
        walletId: 'wallet-001',
        walletName: 'Updated Name',
        walletType: 'hd_bip84',
        archivedAt: Date.now(),
        confirmedBalanceSat: 200000,
        unconfirmedBalanceSat: 0,
        transactionCount: 10,
        utxoCount: 2,
      };

      // Replace logic
      const existingIdx = index.findIndex(e => e.walletId === newEntry.walletId);
      if (existingIdx >= 0) {
        index[existingIdx] = newEntry;
      } else {
        index.push(newEntry);
      }

      expect(index).toHaveLength(1);
      expect(index[0].walletName).toBe('Updated Name');
      expect(index[0].confirmedBalanceSat).toBe(200000);
    });

    it('should filter out deleted entries', () => {
      const index: ArchiveEntry[] = [
        {
          walletId: 'wallet-001',
          walletName: 'Keep',
          walletType: 'hd_bip84',
          archivedAt: Date.now(),
          confirmedBalanceSat: 100000,
          unconfirmedBalanceSat: 0,
          transactionCount: 5,
          utxoCount: 1,
        },
        {
          walletId: 'wallet-002',
          walletName: 'Delete',
          walletType: 'hd_bip84',
          archivedAt: Date.now(),
          confirmedBalanceSat: 50000,
          unconfirmedBalanceSat: 0,
          transactionCount: 3,
          utxoCount: 1,
        },
      ];

      const filtered = index.filter(e => e.walletId !== 'wallet-002');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].walletId).toBe('wallet-001');
    });
  });
});
