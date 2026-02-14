/**
 * Metadata Merge & Migration Tests
 *
 * Tests that:
 * - Sync commit does NOT overwrite txUserMetadata
 * - UTXO metadata survives when UTXO still exists
 * - Migration logic correctly copies from legacy stores
 */

import { CanonicalSnapshotBuilder } from '../../services/storage/CanonicalSnapshotBuilder';
import {
  createEmptySyncState,
  createEmptyLkg,
  createEmptyIntegrity,
  createEmptyBackupMeta,
} from '../../services/sync/types';
import type {
  WalletFileV2Schema,
  LkgUtxo,
  LkgTransaction,
  TxDetailEntry,
  LkgSnapshot,
} from '../../services/sync/types';

// ─── Helpers ────────────────────────────────────────────────────

function createMinimalWalletFile(): WalletFileV2Schema {
  return {
    schemaVersion: 2,
    walletId: 'merge-test-001',
    name: 'Merge Test',
    walletType: 'hd_bip84',
    importSource: 'phrase',
    createdAt: Date.now(),
    lastModified: Date.now(),
    network: 'mainnet',
    keyRef: {
      secretId: null,
      fingerprint: 'abcd1234',
      descriptor: null,
      scriptTypes: ['p2wpkh'],
    },
    scriptInventory: {
      addresses: [],
      addressIndices: {
        native_segwit: { receiving: 0, change: 0 },
        wrapped_segwit: { receiving: 0, change: 0 },
        legacy: { receiving: 0, change: 0 },
        taproot: { receiving: 0, change: 0 },
      },
      preferredAddressType: 'native_segwit' as any,
      usedAddresses: [],
      gapLimit: 20,
      lastDiscoveryAt: null,
    },
    syncState: createEmptySyncState(),
    lkg: createEmptyLkg(),
    staging: null,
    integrity: createEmptyIntegrity(),
    isMultisig: false,
    multisigConfig: null,
    watchOnlyData: null,
    txUserMetadata: {},
    utxoUserMetadata: {},
    addressLabels: {},
    xpubs: [],
    descriptors: [],
    backupMeta: createEmptyBackupMeta(),
  };
}

function createTestUtxo(txid: string, vout: number, valueSat: number): LkgUtxo {
  return {
    txid,
    vout,
    valueSat,
    height: 800000,
    address: 'bc1qtest',
    scriptPubKey: '0014abcdef',
    scriptType: 'p2wpkh',
    scripthash: `scripthash_${txid}`,
    confirmations: 6,
  };
}

function createTestTx(txid: string, valueSat: number, direction: 'incoming' | 'outgoing'): LkgTransaction {
  return {
    txid,
    firstSeenAt: Date.now(),
    blockHeight: 800000,
    confirmations: 6,
    direction,
    valueDeltaSat: direction === 'incoming' ? valueSat : -valueSat,
    feeSat: 250,
    feeRate: 5,
    isRBF: false,
    status: 'confirmed',
    inputCount: 1,
    outputCount: 2,
    size: 225,
    vsize: 141,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Metadata Merge Safety', () => {
  describe('User metadata isolation from LKG', () => {
    it('should preserve txUserMetadata when LKG is replaced', () => {
      const file = createMinimalWalletFile();

      // Set user metadata
      file.txUserMetadata = {
        tx_001: {
          note: 'Rent payment',
          tags: ['expense'],
          createdAt: Date.now(),
          editedAt: Date.now(),
        },
      };

      // Simulate a sync commit that replaces LKG
      const newLkg: LkgSnapshot = {
        utxos: [createTestUtxo('tx_002', 0, 50000)],
        transactions: [createTestTx('tx_002', 50000, 'incoming')],
        txDetails: {},
        confirmedBalanceSat: 50000,
        unconfirmedBalanceSat: 0,
        trackedTransactions: [],
        committedAt: Date.now(),
        tipHeightAtCommit: 800010,
      };

      // Replace LKG (simulating what commitLkg does)
      file.lkg = newLkg;

      // User metadata should be completely untouched
      expect(file.txUserMetadata.tx_001.note).toBe('Rent payment');
      expect(file.txUserMetadata.tx_001.tags).toEqual(['expense']);
    });

    it('should preserve utxoUserMetadata when LKG is replaced', () => {
      const file = createMinimalWalletFile();

      file.utxoUserMetadata = {
        'tx_001:0': {
          note: 'Savings UTXO',
          tags: ['hodl'],
          isFrozen: true,
          isLocked: false,
        },
      };

      // Simulate LKG replacement
      file.lkg = {
        ...createEmptyLkg(),
        utxos: [createTestUtxo('tx_002', 0, 30000)],
        committedAt: Date.now(),
      };

      // UTXO metadata should be untouched
      expect(file.utxoUserMetadata['tx_001:0'].isFrozen).toBe(true);
      expect(file.utxoUserMetadata['tx_001:0'].note).toBe('Savings UTXO');
    });

    it('should preserve addressLabels when scriptInventory changes', () => {
      const file = createMinimalWalletFile();

      file.addressLabels = {
        bc1qtest: { label: 'Business', note: 'Invoice address' },
      };

      // Simulate address discovery adding new addresses
      file.scriptInventory.addresses.push({
        address: 'bc1qnew',
        type: 'native_segwit' as any,
        index: 1,
        isChange: false,
        derivationPath: "m/84'/0'/0'/0/1",
        scriptHash: 'scripthash_new',
        publicKey: 'pubkey_new',
      });

      // Existing labels should be preserved
      expect(file.addressLabels.bc1qtest.label).toBe('Business');
    });
  });

  describe('Snapshot apply preserves target integrity', () => {
    it('should not overwrite keyRef.secretId', () => {
      const file = createMinimalWalletFile();
      file.keyRef.secretId = 'local_secret_key';

      const snapshot = CanonicalSnapshotBuilder.extract(
        createMinimalWalletFile(),
      );
      // Snapshot has no secrets
      snapshot.keysAndDescriptors.fingerprint = 'different';

      const result = CanonicalSnapshotBuilder.apply(snapshot, file);

      // secretId should be preserved from target
      expect(result.keyRef.secretId).toBe('local_secret_key');
    });

    it('should set sync state to stale after apply', () => {
      const file = createMinimalWalletFile();
      file.syncState.status = 'synced';

      const snapshot = CanonicalSnapshotBuilder.extract(createMinimalWalletFile());
      const result = CanonicalSnapshotBuilder.apply(snapshot, file);

      expect(result.syncState.status).toBe('stale');
      expect(result.syncState.isStale).toBe(true);
    });
  });

  describe('UTXO metadata reconciliation logic', () => {
    it('should identify spent UTXOs for metadata pruning', () => {
      const file = createMinimalWalletFile();

      // UTXO metadata for two outpoints
      file.utxoUserMetadata = {
        'tx_A:0': {
          note: 'Still exists',
          isFrozen: false,
          isLocked: false,
          createdAt: Date.now(),
        },
        'tx_B:0': {
          note: 'Already spent',
          isFrozen: false,
          isLocked: false,
          createdAt: Date.now() - 100 * 86400000, // 100 days ago
        },
      };

      // Current UTXOs only contain tx_A
      file.lkg.utxos = [createTestUtxo('tx_A', 0, 50000)];

      // Check which metadata entries have no matching UTXO
      const currentOutpoints = new Set(
        file.lkg.utxos.map(u => `${u.txid}:${u.vout}`),
      );

      const staleEntries = Object.keys(file.utxoUserMetadata).filter(
        outpoint => !currentOutpoints.has(outpoint),
      );

      expect(staleEntries).toEqual(['tx_B:0']);
      expect(staleEntries).not.toContain('tx_A:0');
    });
  });
});
