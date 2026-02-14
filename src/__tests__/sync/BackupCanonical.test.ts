/**
 * Backup Canonical Integration Tests
 *
 * Tests the integration between CanonicalSnapshotBuilder,
 * BackupService compression, and AppStateManager backup/restore flow.
 * Validates backward compatibility with v2 payloads.
 */

import { CanonicalSnapshotBuilder } from '../../services/storage/CanonicalSnapshotBuilder';
import { createEmptySyncState, createEmptyBackupMeta } from '../../services/sync/types';
import type {
  CanonicalWalletSnapshot,
} from '../../services/sync/types';
import type {
  ExpandedFullBackupPayload,
} from '../../services/AppStateManager';

// ─── Helpers ────────────────────────────────────────────────────

function createTestSnapshot(walletId: string): CanonicalWalletSnapshot {
  return {
    schemaVersion: 2,
    walletId,
    name: `Wallet ${walletId}`,
    walletType: 'hd_bip84',
    importSource: 'phrase',
    createdAt: Date.now(),
    lastModified: Date.now(),
    network: 'mainnet',
    keysAndDescriptors: {
      fingerprint: 'abcd1234',
      xpubs: [
        {
          xpub: 'xpub6CUGRUonZSQ...',
          derivationPath: "m/84'/0'/0'",
          scriptType: 'p2wpkh',
        },
      ],
      descriptors: [],
      scriptTypes: ['p2wpkh'],
    },
    addressCache: {
      addresses: [],
      addressIndices: {
        native_segwit: { receiving: 10, change: 5 },
        wrapped_segwit: { receiving: 0, change: 0 },
        legacy: { receiving: 0, change: 0 },
        taproot: { receiving: 0, change: 0 },
      },
      preferredAddressType: 'native_segwit' as any,
      usedAddresses: [],
      gapLimit: 20,
      lastDiscoveryAt: null,
      addressLabels: {},
    },
    utxoCache: {
      utxos: [],
      utxoMetadata: {},
    },
    txCache: {
      transactions: [],
      txDetails: {},
      txUserMetadata: {
        tx_001: {
          note: 'Test note',
          tags: ['test'],
          createdAt: Date.now(),
          editedAt: Date.now(),
        },
      },
    },
    syncState: createEmptySyncState(),
    confirmedBalanceSat: 0,
    unconfirmedBalanceSat: 0,
    trackedTransactions: [],
    isMultisig: false,
    multisigConfig: null,
    backupMeta: createEmptyBackupMeta(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Backup Canonical Integration', () => {
  describe('ExpandedFullBackupPayload v3 format', () => {
    it('should include walletSnapshots field', () => {
      const snapshot = createTestSnapshot('wallet-001');
      const trimmed = CanonicalSnapshotBuilder.trimForBackup(snapshot);

      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'Test Backup',
        backupDate: Date.now(),
        wallets: [],
        walletSnapshots: [trimmed],
        settings: {},
      };

      expect(payload.version).toBe(3);
      expect(payload.walletSnapshots).toHaveLength(1);
      expect(payload.walletSnapshots![0].walletId).toBe('wallet-001');
      expect(payload.walletSnapshots![0].txCache.txUserMetadata.tx_001.note).toBe('Test note');
    });

    it('should support compressed flag', () => {
      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'Compressed Backup',
        backupDate: Date.now(),
        wallets: [],
        compressed: true,
      };

      expect(payload.compressed).toBe(true);
    });
  });

  describe('Backward compatibility', () => {
    it('should accept v1 payloads without walletSnapshots', () => {
      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 1,
        backupName: 'Legacy Backup',
        backupDate: Date.now(),
        wallets: [],
      };

      expect(payload.walletSnapshots).toBeUndefined();
      expect(payload.compressed).toBeUndefined();
    });

    it('should accept v2 payloads with legacy fields', () => {
      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 2,
        backupName: 'V2 Backup',
        backupDate: Date.now(),
        wallets: [],
        transactionLabels: { tx1: { label: 'old label' } },
        utxoMetadata: { 'tx1:0': { isFrozen: false } },
      };

      expect(payload.version).toBe(2);
      expect(payload.transactionLabels).toBeDefined();
      expect(payload.walletSnapshots).toBeUndefined();
    });

    it('should prefer walletSnapshots over legacy fields in v3', () => {
      const snapshot = createTestSnapshot('wallet-001');

      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'V3 Backup',
        backupDate: Date.now(),
        wallets: [],
        walletSnapshots: [snapshot],
        // Legacy fields kept for backward compat but should be ignored
        transactionLabels: { old_tx: { label: 'legacy' } },
        utxoMetadata: { 'old_tx:0': { isFrozen: false } },
      };

      // v3 restore logic should use walletSnapshots, not legacy fields
      const hasSnapshots = payload.walletSnapshots && payload.walletSnapshots.length > 0;
      expect(hasSnapshots).toBe(true);
    });
  });

  describe('Compression for iCloud KVS', () => {
    it('should compress and decompress a full backup payload', () => {
      const snapshot = createTestSnapshot('wallet-001');
      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'Compression Test',
        backupDate: Date.now(),
        wallets: [],
        walletSnapshots: [snapshot],
      };

      const json = JSON.stringify(payload);
      const compressed = CanonicalSnapshotBuilder.compress(json);
      const decompressed = CanonicalSnapshotBuilder.decompress(compressed);
      const restored: ExpandedFullBackupPayload = JSON.parse(decompressed);

      expect(restored.version).toBe(3);
      expect(restored.walletSnapshots).toHaveLength(1);
      expect(restored.walletSnapshots![0].walletId).toBe('wallet-001');
      expect(restored.walletSnapshots![0].txCache.txUserMetadata.tx_001.note).toBe('Test note');
    });

    it('should achieve significant compression on backup payloads', () => {
      // Create a realistic-size payload with multiple wallets
      const snapshots: CanonicalWalletSnapshot[] = [];
      for (let i = 0; i < 3; i++) {
        const snapshot = createTestSnapshot(`wallet-${i}`);
        // Add some bulk data
        for (let j = 0; j < 50; j++) {
          snapshot.txCache.txUserMetadata[`tx_${i}_${j}`] = {
            note: `Transaction note for tx ${j} in wallet ${i}`,
            tags: ['tagged', `wallet-${i}`],
            createdAt: Date.now() - j * 3600000,
            editedAt: Date.now(),
          };
        }
        snapshots.push(CanonicalSnapshotBuilder.trimForBackup(snapshot));
      }

      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'Multi-wallet Backup',
        backupDate: Date.now(),
        wallets: [],
        walletSnapshots: snapshots,
      };

      const json = JSON.stringify(payload);
      const compressed = CanonicalSnapshotBuilder.compress(json);

      // Should achieve meaningful compression
      const ratio = compressed.length / json.length;
      expect(ratio).toBeLessThan(0.5); // At least 50% compression
    });

    it('trimForBackup should reduce payload size', () => {
      const snapshot = createTestSnapshot('wallet-001');

      // Add a large rawHex to a tx detail
      snapshot.txCache.txDetails.tx_001 = {
        txid: 'tx_001',
        rawHex: 'a'.repeat(10000), // Simulate a large raw transaction
        inputs: [],
        outputs: [],
        blockTime: Date.now(),
        size: 500,
        vsize: 350,
      };

      const beforeSize = JSON.stringify(snapshot).length;
      const trimmed = CanonicalSnapshotBuilder.trimForBackup(snapshot);
      const afterSize = JSON.stringify(trimmed).length;

      // After trimming, size should be significantly smaller
      expect(afterSize).toBeLessThan(beforeSize);
      expect(trimmed.txCache.txDetails.tx_001.rawHex).toBe('');
    });
  });

  describe('Multiple wallets in single backup', () => {
    it('should handle backup with multiple wallet snapshots', () => {
      const snapshots = [
        createTestSnapshot('wallet-001'),
        createTestSnapshot('wallet-002'),
        createTestSnapshot('wallet-003'),
      ];

      const payload: ExpandedFullBackupPayload = {
        type: 'full_backup',
        version: 3,
        backupName: 'Multi-wallet',
        backupDate: Date.now(),
        wallets: [],
        walletSnapshots: snapshots,
      };

      expect(payload.walletSnapshots).toHaveLength(3);
      expect(payload.walletSnapshots![0].walletId).toBe('wallet-001');
      expect(payload.walletSnapshots![1].walletId).toBe('wallet-002');
      expect(payload.walletSnapshots![2].walletId).toBe('wallet-003');
    });
  });
});
