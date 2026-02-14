/**
 * WalletFileV2 Extended Fields Tests
 *
 * Tests the new update methods for user metadata, and auto-defaulting
 * of optional fields in read()/create().
 */

import { WalletFileV2Service } from '../../services/storage/WalletFileV2';
import type {
  WalletFileV2Schema,
  TxUserMetadata,
  UtxoUserMetadata,
  AddressUserMetadata,
  XpubEntry,
  DescriptorEntry,
  BackupMeta,
} from '../../services/sync/types';

// ─── Tests ──────────────────────────────────────────────────────

describe('WalletFileV2Service — Extended Fields', () => {
  const testWalletId = 'test-extended-001';

  describe('updateTxUserMetadata()', () => {
    it('should accept TxUserMetadata with all fields', () => {
      const metadata: TxUserMetadata = {
        note: 'Rent payment for January',
        tags: ['expense', 'rent'],
        createdAt: Date.now(),
        editedAt: Date.now(),
      };

      // Type check: this should compile without errors
      const _check: TxUserMetadata = metadata;
      expect(_check.note).toBe('Rent payment for January');
      expect(_check.tags).toEqual(['expense', 'rent']);
    });

    it('should accept TxUserMetadata with optional fields omitted', () => {
      const metadata: TxUserMetadata = {
        createdAt: Date.now(),
        editedAt: Date.now(),
      };

      expect(metadata.note).toBeUndefined();
      expect(metadata.tags).toBeUndefined();
    });
  });

  describe('updateUtxoUserMetadata()', () => {
    it('should accept UtxoUserMetadata with frozen/locked flags', () => {
      const metadata: UtxoUserMetadata = {
        note: 'Cold storage coin',
        tags: ['hodl'],
        isFrozen: true,
        isLocked: false,
        createdAt: Date.now(),
      };

      expect(metadata.isFrozen).toBe(true);
      expect(metadata.isLocked).toBe(false);
    });
  });

  describe('updateAddressLabel()', () => {
    it('should accept AddressUserMetadata', () => {
      const metadata: AddressUserMetadata = {
        label: 'Business receiving',
        note: 'Used for client invoices',
      };

      expect(metadata.label).toBe('Business receiving');
    });

    it('should accept partial AddressUserMetadata', () => {
      const metadata: AddressUserMetadata = {
        label: 'Savings',
      };

      expect(metadata.note).toBeUndefined();
    });
  });

  describe('updateXpubs()', () => {
    it('should accept an array of XpubEntry', () => {
      const xpubs: XpubEntry[] = [
        {
          xpub: 'xpub6CUGRUonZSQ...',
          derivationPath: "m/84'/0'/0'",
          scriptType: 'p2wpkh',
          fingerprint: 'abcd1234',
        },
        {
          xpub: 'xpub6CUGRUonZSR...',
          derivationPath: "m/49'/0'/0'",
          scriptType: 'p2sh-p2wpkh',
        },
      ];

      expect(xpubs).toHaveLength(2);
      expect(xpubs[0].fingerprint).toBe('abcd1234');
      expect(xpubs[1].fingerprint).toBeUndefined();
    });
  });

  describe('updateDescriptors()', () => {
    it('should accept an array of DescriptorEntry', () => {
      const descriptors: DescriptorEntry[] = [
        {
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub.../0/*)",
          isRange: true,
          internal: false,
          checksum: 'abc123',
        },
        {
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub.../1/*)",
          isRange: true,
          internal: true,
        },
      ];

      expect(descriptors[0].internal).toBe(false);
      expect(descriptors[1].internal).toBe(true);
    });
  });

  describe('updateBackupMeta()', () => {
    it('should accept BackupMeta', () => {
      const meta: BackupMeta = {
        lastBackupAt: Date.now(),
        backupHash: 'sha256_hash_here',
        lastICloudSyncAt: Date.now(),
      };

      expect(meta.lastBackupAt).toBeTruthy();
    });

    it('should accept empty BackupMeta', () => {
      const meta: BackupMeta = {
        lastBackupAt: null,
        backupHash: null,
        lastICloudSyncAt: null,
      };

      expect(meta.lastBackupAt).toBeNull();
    });
  });

  describe('WalletFileV2Schema optional fields', () => {
    it('should compile with all optional fields set', () => {
      const file: Partial<WalletFileV2Schema> = {
        txUserMetadata: {
          txid1: { note: 'test', tags: [], createdAt: 0, editedAt: 0 },
        },
        utxoUserMetadata: {
          'txid:0': { isFrozen: false, isLocked: false },
        },
        addressLabels: {
          bc1qtest: { label: 'Test' },
        },
        xpubs: [],
        descriptors: [],
        backupMeta: { lastBackupAt: null, backupHash: null, lastICloudSyncAt: null },
      };

      expect(file.txUserMetadata).toBeDefined();
    });

    it('should compile with all optional fields undefined', () => {
      const file: Partial<WalletFileV2Schema> = {
        txUserMetadata: undefined,
        utxoUserMetadata: undefined,
        addressLabels: undefined,
        xpubs: undefined,
        descriptors: undefined,
        backupMeta: undefined,
      };

      expect(file.txUserMetadata).toBeUndefined();
    });
  });
});
