/**
 * CanonicalSnapshotBuilder Tests
 *
 * Tests extract/apply round-trip, trimForBackup, compress/decompress.
 * These tests validate the core snapshot transformation logic.
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
  CanonicalWalletSnapshot,
  LkgUtxo,
  LkgTransaction,
  TxDetailEntry,
  TxUserMetadata,
  UtxoUserMetadata,
} from '../../services/sync/types';

// ─── Test Fixtures ──────────────────────────────────────────────

function createTestWalletFile(overrides?: Partial<WalletFileV2Schema>): WalletFileV2Schema {
  const utxo: LkgUtxo = {
    txid: 'abc123def456',
    vout: 0,
    valueSat: 100000,
    height: 800000,
    address: 'bc1qtest123',
    scriptPubKey: '0014abcdef',
    scriptType: 'p2wpkh',
    scripthash: 'scripthash_abc',
    confirmations: 6,
  };

  const tx: LkgTransaction = {
    txid: 'abc123def456',
    firstSeenAt: Date.now() - 3600000,
    blockHeight: 800000,
    confirmations: 6,
    direction: 'incoming',
    valueDeltaSat: 100000,
    feeSat: 250,
    feeRate: 5,
    isRBF: false,
    status: 'confirmed',
    inputCount: 1,
    outputCount: 2,
    size: 225,
    vsize: 141,
  };

  const txDetail: TxDetailEntry = {
    txid: 'abc123def456',
    rawHex: 'deadbeef'.repeat(100), // Simulate a large rawHex
    inputs: [
      {
        prevTxid: 'prev_txid_001',
        prevVout: 0,
        address: 'bc1qsender',
        valueSat: 200000,
        isWalletOwned: false,
      },
    ],
    outputs: [
      {
        index: 0,
        address: 'bc1qtest123',
        valueSat: 100000,
        scriptPubKey: '0014abcdef',
        isWalletOwned: true,
      },
      {
        index: 1,
        address: 'bc1qchange',
        valueSat: 99750,
        scriptPubKey: '0014change',
        isWalletOwned: false,
      },
    ],
    blockTime: Date.now() - 3600000,
    size: 225,
    vsize: 141,
  };

  return {
    schemaVersion: 2,
    walletId: 'test-wallet-001',
    name: 'Test Wallet',
    walletType: 'hd_bip84',
    importSource: 'phrase',
    createdAt: Date.now() - 86400000,
    lastModified: Date.now(),
    network: 'mainnet',

    keyRef: {
      secretId: 'sec_test',
      fingerprint: 'abcd1234',
      descriptor: "wpkh([abcd1234/84'/0'/0']xpub...)",
      scriptTypes: ['p2wpkh'],
    },

    scriptInventory: {
      addresses: [
        {
          address: 'bc1qtest123',
          type: 'native_segwit' as any,
          index: 0,
          isChange: false,
          derivationPath: "m/84'/0'/0'/0/0",
          scriptHash: 'scripthash_abc',
          publicKey: 'pubkey_abc',
        },
      ],
      addressIndices: {
        native_segwit: { receiving: 1, change: 0 },
        wrapped_segwit: { receiving: 0, change: 0 },
        legacy: { receiving: 0, change: 0 },
        taproot: { receiving: 0, change: 0 },
      },
      preferredAddressType: 'native_segwit' as any,
      usedAddresses: ['bc1qtest123'],
      gapLimit: 20,
      lastDiscoveryAt: Date.now() - 3600000,
    },

    syncState: {
      ...createEmptySyncState(),
      status: 'synced',
      lastSuccessfulSyncAt: Date.now() - 60000,
      lastKnownTipHeight: 800006,
      lastServerUsed: 'electrum.example.com:50002',
    },

    lkg: {
      utxos: [utxo],
      transactions: [tx],
      txDetails: { abc123def456: txDetail },
      confirmedBalanceSat: 100000,
      unconfirmedBalanceSat: 0,
      trackedTransactions: [
        ['abc123def456', {
          txid: 'abc123def456',
          confirmations: 6,
          amount: 100000,
          address: 'bc1qtest123',
          isIncoming: true,
        }],
      ],
      committedAt: Date.now() - 60000,
      tipHeightAtCommit: 800006,
    },

    staging: null,
    integrity: createEmptyIntegrity(),

    isMultisig: false,
    multisigConfig: null,
    watchOnlyData: null,

    // User metadata
    txUserMetadata: {
      abc123def456: {
        note: 'Payment from Alice',
        tags: ['income', 'non-kyc'],
        createdAt: Date.now() - 3600000,
        editedAt: Date.now() - 1800000,
      },
    },
    utxoUserMetadata: {
      'abc123def456:0': {
        note: 'Cold storage UTXO',
        tags: ['hodl'],
        isFrozen: false,
        isLocked: false,
      },
    },
    addressLabels: {
      bc1qtest123: {
        label: 'Main receiving',
        note: 'Primary address for Alice',
      },
    },
    xpubs: [
      {
        xpub: 'xpub6CUGRUonZ...',
        derivationPath: "m/84'/0'/0'",
        scriptType: 'p2wpkh',
        fingerprint: 'abcd1234',
      },
    ],
    descriptors: [
      {
        descriptor: "wpkh([abcd1234/84'/0'/0']xpub6CUGRUonZ.../0/*)",
        isRange: true,
        internal: false,
      },
      {
        descriptor: "wpkh([abcd1234/84'/0'/0']xpub6CUGRUonZ.../1/*)",
        isRange: true,
        internal: true,
      },
    ],
    backupMeta: {
      lastBackupAt: Date.now() - 86400000,
      backupHash: 'sha256_backup_hash',
      lastICloudSyncAt: Date.now() - 86400000,
    },

    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CanonicalSnapshotBuilder', () => {
  describe('extract()', () => {
    it('should produce a CanonicalWalletSnapshot from a V2 file', () => {
      const file = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(file);

      // Identity
      expect(snapshot.schemaVersion).toBe(2);
      expect(snapshot.walletId).toBe('test-wallet-001');
      expect(snapshot.name).toBe('Test Wallet');
      expect(snapshot.walletType).toBe('hd_bip84');
      expect(snapshot.importSource).toBe('phrase');
      expect(snapshot.network).toBe('mainnet');

      // Keys & descriptors
      expect(snapshot.keysAndDescriptors.fingerprint).toBe('abcd1234');
      expect(snapshot.keysAndDescriptors.xpubs).toHaveLength(1);
      expect(snapshot.keysAndDescriptors.descriptors).toHaveLength(2);
      expect(snapshot.keysAndDescriptors.scriptTypes).toEqual(['p2wpkh']);

      // Address cache
      expect(snapshot.addressCache.addresses).toHaveLength(1);
      expect(snapshot.addressCache.usedAddresses).toContain('bc1qtest123');
      expect(snapshot.addressCache.addressLabels.bc1qtest123.label).toBe('Main receiving');

      // UTXO cache
      expect(snapshot.utxoCache.utxos).toHaveLength(1);
      expect(snapshot.utxoCache.utxos[0].valueSat).toBe(100000);
      expect(snapshot.utxoCache.utxoMetadata['abc123def456:0'].note).toBe('Cold storage UTXO');

      // TX cache
      expect(snapshot.txCache.transactions).toHaveLength(1);
      expect(snapshot.txCache.txDetails.abc123def456.rawHex).toBeTruthy();
      expect(snapshot.txCache.txUserMetadata.abc123def456.note).toBe('Payment from Alice');
      expect(snapshot.txCache.txUserMetadata.abc123def456.tags).toEqual(['income', 'non-kyc']);

      // Balances
      expect(snapshot.confirmedBalanceSat).toBe(100000);
      expect(snapshot.unconfirmedBalanceSat).toBe(0);

      // Tracked transactions
      expect(snapshot.trackedTransactions).toHaveLength(1);

      // Backup meta
      expect(snapshot.backupMeta.backupHash).toBe('sha256_backup_hash');
    });

    it('should default missing optional fields', () => {
      const file = createTestWalletFile({
        txUserMetadata: undefined,
        utxoUserMetadata: undefined,
        addressLabels: undefined,
        xpubs: undefined,
        descriptors: undefined,
        backupMeta: undefined,
      });

      const snapshot = CanonicalSnapshotBuilder.extract(file);

      expect(snapshot.txCache.txUserMetadata).toEqual({});
      expect(snapshot.utxoCache.utxoMetadata).toEqual({});
      expect(snapshot.addressCache.addressLabels).toEqual({});
      expect(snapshot.keysAndDescriptors.xpubs).toEqual([]);
      expect(snapshot.keysAndDescriptors.descriptors).toEqual([]);
      expect(snapshot.backupMeta.lastBackupAt).toBeNull();
    });
  });

  describe('apply()', () => {
    it('should merge a snapshot into a target V2 file', () => {
      const source = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(source);

      // Create a fresh empty target
      const target = createTestWalletFile({
        name: 'Empty Wallet',
        lkg: createEmptyLkg(),
        txUserMetadata: {},
        utxoUserMetadata: {},
        addressLabels: {},
      });

      const result = CanonicalSnapshotBuilder.apply(snapshot, target);

      // Verify chain state was applied
      expect(result.lkg.utxos).toHaveLength(1);
      expect(result.lkg.transactions).toHaveLength(1);
      expect(result.lkg.confirmedBalanceSat).toBe(100000);

      // Verify user metadata was applied
      expect(result.txUserMetadata?.abc123def456?.note).toBe('Payment from Alice');
      expect(result.utxoUserMetadata?.['abc123def456:0']?.note).toBe('Cold storage UTXO');
      expect(result.addressLabels?.bc1qtest123?.label).toBe('Main receiving');

      // Verify sync state was set to stale
      expect(result.syncState.status).toBe('stale');
      expect(result.syncState.isStale).toBe(true);

      // Verify staging was cleared
      expect(result.staging).toBeNull();

      // Verify name was updated
      expect(result.name).toBe('Test Wallet');
    });
  });

  describe('extract() → apply() round-trip', () => {
    it('should produce equivalent data after round-trip', () => {
      const original = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(original);

      const target = createTestWalletFile({
        lkg: createEmptyLkg(),
        txUserMetadata: {},
        utxoUserMetadata: {},
      });

      const result = CanonicalSnapshotBuilder.apply(snapshot, target);

      // Chain state should match
      expect(result.lkg.utxos).toEqual(original.lkg.utxos);
      expect(result.lkg.transactions).toEqual(original.lkg.transactions);
      expect(result.lkg.confirmedBalanceSat).toBe(original.lkg.confirmedBalanceSat);
      expect(result.lkg.unconfirmedBalanceSat).toBe(original.lkg.unconfirmedBalanceSat);

      // User metadata should match
      expect(result.txUserMetadata).toEqual(original.txUserMetadata);
      expect(result.utxoUserMetadata).toEqual(original.utxoUserMetadata);
      expect(result.addressLabels).toEqual(original.addressLabels);

      // Keys & descriptors should match
      expect(result.xpubs).toEqual(original.xpubs);
      expect(result.descriptors).toEqual(original.descriptors);

      // Address cache should match
      expect(result.scriptInventory.addresses).toEqual(original.scriptInventory.addresses);
      expect(result.scriptInventory.usedAddresses).toEqual(original.scriptInventory.usedAddresses);
    });
  });

  describe('trimForBackup()', () => {
    it('should strip rawHex from txDetails', () => {
      const file = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(file);

      // Verify rawHex exists before trim
      expect(snapshot.txCache.txDetails.abc123def456.rawHex.length).toBeGreaterThan(0);

      const trimmed = CanonicalSnapshotBuilder.trimForBackup(snapshot);

      // rawHex should be empty string
      expect(trimmed.txCache.txDetails.abc123def456.rawHex).toBe('');

      // Everything else should be preserved
      expect(trimmed.txCache.txDetails.abc123def456.inputs).toEqual(
        snapshot.txCache.txDetails.abc123def456.inputs,
      );
      expect(trimmed.txCache.txDetails.abc123def456.outputs).toEqual(
        snapshot.txCache.txDetails.abc123def456.outputs,
      );
      expect(trimmed.txCache.txUserMetadata).toEqual(snapshot.txCache.txUserMetadata);
    });

    it('should not mutate the original snapshot', () => {
      const file = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(file);
      const originalRawHex = snapshot.txCache.txDetails.abc123def456.rawHex;

      CanonicalSnapshotBuilder.trimForBackup(snapshot);

      // Original should be unchanged
      expect(snapshot.txCache.txDetails.abc123def456.rawHex).toBe(originalRawHex);
    });
  });

  describe('compress() / decompress()', () => {
    it('should round-trip a JSON string through gzip', () => {
      const original = JSON.stringify(createTestWalletFile());

      const compressed = CanonicalSnapshotBuilder.compress(original);
      const decompressed = CanonicalSnapshotBuilder.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should achieve meaningful compression on wallet JSON', () => {
      const json = JSON.stringify(createTestWalletFile());
      const compressed = CanonicalSnapshotBuilder.compress(json);

      // Gzip should compress repetitive JSON significantly
      expect(compressed.length).toBeLessThan(json.length);

      // Expect at least 30% reduction for structured JSON
      const ratio = compressed.length / json.length;
      expect(ratio).toBeLessThan(0.7);
    });

    it('should handle empty strings', () => {
      const compressed = CanonicalSnapshotBuilder.compress('');
      const decompressed = CanonicalSnapshotBuilder.decompress(compressed);
      expect(decompressed).toBe('');
    });

    it('should handle large payloads', () => {
      // Simulate a wallet with many transactions
      const largePayload: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largePayload[`tx_${i}`] = `value_${i}_${'x'.repeat(100)}`;
      }
      const json = JSON.stringify(largePayload);

      const compressed = CanonicalSnapshotBuilder.compress(json);
      const decompressed = CanonicalSnapshotBuilder.decompress(compressed);

      expect(decompressed).toBe(json);
    });
  });

  describe('estimateCompressedSize()', () => {
    it('should return a positive number', () => {
      const file = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(file);

      const size = CanonicalSnapshotBuilder.estimateCompressedSize(snapshot);
      expect(size).toBeGreaterThan(0);
    });

    it('should be smaller than the uncompressed JSON', () => {
      const file = createTestWalletFile();
      const snapshot = CanonicalSnapshotBuilder.extract(file);

      const compressedSize = CanonicalSnapshotBuilder.estimateCompressedSize(snapshot);
      const uncompressedSize = JSON.stringify(snapshot).length;

      expect(compressedSize).toBeLessThan(uncompressedSize);
    });
  });
});
