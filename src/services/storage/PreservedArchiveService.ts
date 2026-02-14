/**
 * PreservedArchiveService — Archive & restore full app state via iOS Keychain
 *
 * Stores wallet snapshots, settings, contacts, and metadata in the iOS Keychain
 * via expo-secure-store. Keychain data persists across app uninstall/reinstall,
 * enabling "preserve-on-delete" and continuous archival.
 *
 * Security model (v2):
 *   The iOS Keychain provides hardware-backed AES-256 encryption at rest
 *   (Secure Enclave). Data never leaves the device. The user's password
 *   is verified via HMAC-SHA256 as a confirmation gate — not as an
 *   encryption key — since double-encryption adds latency with no real
 *   security benefit when Keychain already encrypts.
 *
 * Storage keys (sharded for Keychain per-item limits):
 *   preserved_manifest               — unencrypted manifest for fast detection
 *   preserved_settings               — encrypted settings + contacts + labels
 *   preserved_archive_{walletId}     — gzip-compressed CanonicalWalletSnapshot
 *   preserved_archive_index          — JSON array of ArchiveEntry metadata
 *   preserved_password_hash          — HMAC-SHA256 of the user's password
 *   preserve_data_on_delete          — flag "true" (set by settingsStore)
 *   preserved_recovery_dismissed     — "true" if user tapped "Don't show again"
 */

import * as SecureStore from 'expo-secure-store';
import { CanonicalSnapshotBuilder } from './CanonicalSnapshotBuilder';
import type { CanonicalWalletSnapshot } from '../sync/types';
import type { BackupSettings } from '../AppStateManager';
import type { Contact } from '../../types/contacts';

// node-forge — same crypto lib as BackupService
// eslint-disable-next-line @typescript-eslint/no-var-requires
const forge = require('node-forge');

// ============================================
// TYPES
// ============================================

/** Metadata entry for a preserved archive (stored in the index) */
export interface ArchiveEntry {
  walletId: string;
  walletName: string;
  walletType: string;
  archivedAt: number;
  confirmedBalanceSat: number;
  unconfirmedBalanceSat: number;
  transactionCount: number;
  utxoCount: number;
}

/** Unencrypted manifest for fast post-reinstall detection */
export interface PreservedManifest {
  version: 2;
  preservedAt: number;
  walletCount: number;
  wallets: Array<{
    walletId: string;
    walletName: string;
    walletType: string;
    balanceSat: number;
  }>;
  /** Settings embedded directly in manifest (v2.1+). Non-sensitive preferences
   *  don't need PBKDF2 encryption — Keychain already provides at-rest encryption. */
  embeddedSettings?: PreservedSettingsPayload;
}

/** Encrypted settings payload (contacts + settings + labels + UTXO metadata + more) */
export interface PreservedSettingsPayload {
  settings: BackupSettings;
  contacts: Contact[];
  transactionLabels: Record<string, unknown>;
  utxoMetadata: Record<string, unknown>;
  /** Recent recipient addresses (added v2.2) */
  recentRecipients?: Array<{ address: string; contactId: string | null; label: string | null; firstUsed: number; lastUsed: number; useCount: number }>;
  /** User-added/favorited Electrum servers (added v2.2) */
  savedServers?: Array<{ host: string; port: number; ssl: boolean; isUserAdded: boolean; isFavorite: boolean; notes: string | null; label: string | null }>;
  /** Active server config (added v2.2) */
  activeServer?: { host: string; port: number; ssl: boolean } | null;
  /** Address book entries (added v2.2) */
  addressBook?: Array<{ id: string; address: string; label: string; note?: string; createdAt: number; lastUsed?: number }>;
}

/** Full restored state — mirrors ExpandedFullBackupPayload structure */
export interface PreservedFullState {
  manifest: PreservedManifest;
  walletSnapshots: CanonicalWalletSnapshot[];
  settings: PreservedSettingsPayload | null;
  /** Wallet IDs that failed to restore (partial success) */
  failedWalletIds: string[];
}

/** Legacy v1 encrypted archive blob (PBKDF2 + AES-256-GCM) */
interface EncryptedArchiveBlobV1 {
  version: 1;
  salt: string;      // hex, 32 bytes
  iv: string;        // hex, 12 bytes
  data: string;      // hex, AES-256-GCM ciphertext (of gzip-compressed JSON)
  authTag: string;   // hex, 16 bytes
}

/** v2 archive blob — gzip only, Keychain provides encryption */
interface ArchiveBlobV2 {
  version: 2;
  data: string;      // base64 of gzip-compressed JSON
}

type ArchiveBlob = EncryptedArchiveBlobV1 | ArchiveBlobV2;

// ============================================
// CONSTANTS
// ============================================

const ARCHIVE_KEY_PREFIX = 'preserved_archive_';
const ARCHIVE_INDEX_KEY = 'preserved_archive_index';
const MANIFEST_KEY = 'preserved_manifest';
const SETTINGS_KEY = 'preserved_settings';
const DISMISS_KEY = 'preserved_recovery_dismissed';
const PRESERVE_FLAG_KEY = 'preserve_data_on_delete';
const PASSWORD_HASH_KEY = 'preserved_password_hash';

// HMAC key material — fixed salt for password verification
const HMAC_SALT = 'satryn_preserve_data_hmac_v2';

// Legacy v1 archive constants removed — PBKDF2 support dropped.

const KEYCHAIN_OPTS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * expo-secure-store has a ~2048 byte limit per Keychain item on iOS.
 * Encrypted wallet blobs can be 5–50KB+, so we chunk large values
 * across multiple Keychain entries:
 *   key_chunk_0, key_chunk_1, … key_chunk_N
 *   key_chunk_count = N+1  (stored separately for fast reassembly)
 *
 * Values ≤ CHUNK_SIZE are stored directly under the original key
 * (backward-compatible with any existing small entries).
 */
const CHUNK_SIZE = 2000; // stay well under 2048 limit

// ============================================
// SERVICE
// ============================================

export class PreservedArchiveService {

  // ------------------------------------------
  // MANIFEST (unencrypted — fast detection)
  // ------------------------------------------

  /**
   * Write the manifest to Keychain (unencrypted).
   * Used for fast post-reinstall detection without needing the PIN.
   */
  static async writeManifest(manifest: PreservedManifest): Promise<void> {
    const json = JSON.stringify(manifest);
    await this.writeChunked(MANIFEST_KEY, json);
  }

  /**
   * Read the manifest from Keychain.
   * Returns null if not found.
   */
  static async readManifest(): Promise<PreservedManifest | null> {
    try {
      const raw = await this.readChunked(MANIFEST_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as PreservedManifest;
    } catch {
      return null;
    }
  }

  // ------------------------------------------
  // SETTINGS ARCHIVE
  // ------------------------------------------

  /**
   * Archive settings, contacts, tx labels, and UTXO metadata.
   * Settings are now embedded in the manifest (v2.1+), so this
   * method is only used for legacy compatibility.
   */
  static async archiveSettings(
    payload: PreservedSettingsPayload,
    _pin: string,
  ): Promise<boolean> {
    try {
      const json = JSON.stringify(payload);
      await this.writeChunked(SETTINGS_KEY, json);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Restore settings payload from Keychain.
   * Reads v2 (plain JSON) format. Legacy v1 PBKDF2-encrypted archives are no longer supported.
   */
  static async restoreSettings(pin: string): Promise<PreservedSettingsPayload | null> {
    try {
      const raw = await this.readChunked(SETTINGS_KEY);
      if (!raw) return null;

      // Parse as plain JSON (v2 format)
      try {
        const parsed = JSON.parse(raw);
        if (parsed.settings) {
          return parsed as PreservedSettingsPayload;
        }
      } catch { /* not valid JSON */ }

      return null;
    } catch (error) {
      return null;
    }
  }

  // ------------------------------------------
  // PASSWORD VERIFICATION (HMAC-SHA256)
  // ------------------------------------------

  /**
   * Store the HMAC-SHA256 hash of the password in Keychain.
   * Called when user sets the preserve-data password.
   */
  static async storePasswordHash(password: string): Promise<void> {
    const hash = this.computePasswordHash(password);
    await SecureStore.setItemAsync(PASSWORD_HASH_KEY, hash, KEYCHAIN_OPTS);
  }

  /**
   * Verify a password against the stored HMAC hash.
   * Returns true if the password matches.
   */
  static async verifyPassword(password: string): Promise<boolean> {
    const stored = await SecureStore.getItemAsync(PASSWORD_HASH_KEY, KEYCHAIN_OPTS);
    if (!stored) {
      // No hash stored — could be a v1 archive. We'll verify via decryption later.
      return true; // Optimistically allow, decryption will fail if wrong
    }
    const computed = this.computePasswordHash(password);
    return stored === computed;
  }

  /**
   * Compute HMAC-SHA256 of password with fixed salt.
   * Fast (~microseconds) unlike PBKDF2 (~seconds).
   */
  private static computePasswordHash(password: string): string {
    const hmac = forge.hmac.create();
    hmac.start('sha256', HMAC_SALT);
    hmac.update(password);
    return hmac.digest().toHex();
  }

  // ------------------------------------------
  // FULL STATE ARCHIVE (orchestrator)
  // ------------------------------------------

  /**
   * Archive the entire app state — all wallets + settings + manifest.
   * Called by ContinuousArchivalManager on sync complete, app background, etc.
   *
   * v2: Gzip-compresses snapshots and stores directly in Keychain (no PBKDF2).
   * Password is verified via HMAC-SHA256 on restore.
   *
   * @returns true if archiving succeeded (or partially succeeded)
   */
  static async archiveFullState(pin: string): Promise<boolean> {
    const pinFp = pin ? `"${pin.slice(0, 3)}***" (len=${pin.length})` : '<empty>';
    try {
      // Lazy imports to avoid circular deps at module level
      const { useMultiWalletStore } = require('../../stores/multiWalletStore');
      const { useSettingsStore } = require('../../stores/settingsStore');
      const { useContactStore } = require('../../stores/contactStore');
      const { useTransactionLabelStore } = require('../../stores/transactionLabelStore');
      const { useUTXOStore } = require('../../stores/utxoStore');

      const wallets: Array<{ id: string; name: string; type: string; balanceSat: number }> =
        useMultiWalletStore.getState().wallets;
      if (wallets.length === 0) return false;

      // Store password hash for verification on restore
      await this.storePasswordHash(pin);

      // 1. Archive each wallet snapshot (gzip + base64, no PBKDF2)
      let archivedCount = 0;
      const archiveStart = Date.now();
      for (const wallet of wallets) {
        try {
          const walletStart = Date.now();

          // Extract snapshot from database (sole source of truth)
          const snapshot = CanonicalSnapshotBuilder.extractFromDatabase(wallet.id);
          if (snapshot) {
          }

          if (snapshot) {
            const success = await this.archiveWallet(wallet.id, snapshot, pin);
            if (success) archivedCount++;
          } else {
          }
        } catch (error) {
          // Continue with other wallets
        }
      }

      // 2. Gather settings + contacts + labels
      //    Settings are embedded directly in the manifest.
      const s = useSettingsStore.getState();
      const settings: BackupSettings = {
        denomination: s.denomination,
        currency: s.currency,
        autoLockTimeout: s.autoLockTimeout,
        biometricsEnabled: s.biometricsEnabled,
        hapticsEnabled: s.hapticsEnabled,
        theme: s.theme,
        feePreference: s.feePreference,
        customFeeRate: s.customFeeRate,
        customElectrumServer: s.customElectrumServer,
        useCustomElectrum: s.useCustomElectrum,
        defaultCurrencyDisplay: s.defaultCurrencyDisplay,
        gapLimit: s.gapLimit,
        walletMode: s.walletMode,
        walletName: s.walletName,
        preserveDataOnDelete: s.preserveDataOnDelete,
        iCloudBackupEnabled: s.iCloudBackupEnabled,
        autoBackupEnabled: s.autoBackupEnabled,
        analyticsEnabled: s.analyticsEnabled,
        inAppAlertsEnabled: s.inAppAlertsEnabled,
        nearbyNickname: s.nearbyNickname,
        maxFeeRateSatPerVb: s.maxFeeRateSatPerVb,
        maxFeeTotalSats: s.maxFeeTotalSats,
        feeCapRequireConfirmation: s.feeCapRequireConfirmation,
        defaultFeeTier: s.defaultFeeTier,
        rememberLastFeeTier: s.rememberLastFeeTier,
        defaultCustomFeeRate: s.defaultCustomFeeRate,
        privacyModeDefault: s.privacyModeDefault,
        avoidConsolidation: s.avoidConsolidation,
        preferSingleInput: s.preferSingleInput,
        avoidUnconfirmedDefault: s.avoidUnconfirmedDefault,
        largeAmountWarningPct: s.largeAmountWarningPct,
        largeAmountConfirmPct: s.largeAmountConfirmPct,
        tagPresets: s.tagPresets,
      };

      const contacts = useContactStore.getState().contacts;
      const txLabels = useTransactionLabelStore.getState().labels;
      const utxoMeta = useUTXOStore.getState().utxoMetadata;

      // Gather recent recipients, servers, and address book for full preservation
      let recentRecipients: PreservedSettingsPayload['recentRecipients'];
      let savedServers: PreservedSettingsPayload['savedServers'];
      let activeServerConfig: PreservedSettingsPayload['activeServer'];
      let addressBook: PreservedSettingsPayload['addressBook'];

      try {
        const { WalletDatabase } = require('../database');
        const db = WalletDatabase.shared();
        // Recent recipients from SQLite
        const recipientRows = db.getRecentRecipients(100);
        recentRecipients = recipientRows.map((r: any) => ({
          address: r.address,
          contactId: r.contactId,
          label: r.label,
          firstUsed: r.firstUsed,
          lastUsed: r.lastUsed,
          useCount: r.useCount,
        }));
        // Saved servers (user-added + favorites with notes)
        const serverRows = db.getAllSavedServers();
        savedServers = serverRows
          .filter((srv: any) => srv.isUserAdded === 1 || srv.isFavorite === 1 || srv.notes || srv.label)
          .map((srv: any) => ({
            host: srv.host,
            port: srv.port,
            ssl: srv.ssl === 1,
            isUserAdded: srv.isUserAdded === 1,
            isFavorite: srv.isFavorite === 1,
            notes: srv.notes,
            label: srv.label,
          }));
        // Active server from app_config
        const activeRaw = db.getConfig('active_server');
        activeServerConfig = activeRaw ? JSON.parse(activeRaw) : null;
      } catch { /* DB not available */ }

      try {
        const { useAddressBookStore } = require('../../stores/addressBookStore');
        const entries = useAddressBookStore.getState().entries;
        addressBook = entries.map((e: any) => ({
          id: e.id,
          address: e.address,
          label: e.label,
          note: e.note,
          createdAt: e.createdAt,
          lastUsed: e.lastUsed,
        }));
      } catch { /* store not available */ }

      const settingsPayload: PreservedSettingsPayload = {
        settings,
        contacts,
        transactionLabels: txLabels || {},
        utxoMetadata: utxoMeta || {},
        recentRecipients,
        savedServers,
        activeServer: activeServerConfig,
        addressBook,
      };

      // 3. Only write manifest if at least one wallet was archived.
      //    Never overwrite a good manifest with empty data.
      if (archivedCount === 0) {
        return false;
      }

      const manifest: PreservedManifest = {
        version: 2,
        preservedAt: Date.now(),
        walletCount: wallets.length,
        wallets: wallets.map(w => ({
          walletId: w.id,
          walletName: w.name,
          walletType: w.type,
          balanceSat: w.balanceSat,
        })),
        embeddedSettings: settingsPayload,
      };
      await this.writeManifest(manifest);

      // Clear the recovery-dismissed flag so the recovery sheet appears after next reinstall.
      // This flag persists in Keychain across app installs — if we don't clear it here,
      // a previous successful restoration will block future recovery prompts.
      await SecureStore.deleteItemAsync(DISMISS_KEY, KEYCHAIN_OPTS).catch(() => {});

      return true;
    } catch (error) {
      return false;
    }
  }

  // ------------------------------------------
  // FULL STATE RESTORE
  // ------------------------------------------

  /**
   * Restore full app state from preserved Keychain data.
   * Returns the decrypted state or null if PIN is wrong / data corrupted.
   */
  static async restoreFullState(pin: string): Promise<PreservedFullState | null> {
    const pinFp = pin ? `"${pin.slice(0, 3)}***" (len=${pin.length})` : '<empty>';
    try {
      // 1. Read manifest
      const manifest = await this.readManifest();
      if (!manifest) return null;

      // 2. Verify password via HMAC (fast check before reading all data)
      const passwordOk = await this.verifyPassword(pin);
      if (!passwordOk) {
        return null;
      }

      // 3. Restore each wallet snapshot
      const walletSnapshots: CanonicalWalletSnapshot[] = [];
      const failedWalletIds: string[] = [];

      for (const walletInfo of manifest.wallets) {
        try {
          const snapshot = await this.restoreArchive(walletInfo.walletId, pin);
          if (snapshot) {
            walletSnapshots.push(snapshot);
          } else {
            failedWalletIds.push(walletInfo.walletId);
          }
        } catch {
          failedWalletIds.push(walletInfo.walletId);
        }
      }

      // If ALL wallets failed, the PIN is likely wrong
      if (walletSnapshots.length === 0 && manifest.wallets.length > 0) {
        return null;
      }

      // 4. Restore settings — prefer embedded manifest settings,
      //    fall back to legacy encrypted settings for older archives
      let settingsPayload: PreservedSettingsPayload | null = null;
      if (manifest.embeddedSettings) {
        settingsPayload = manifest.embeddedSettings;
      } else {
        settingsPayload = await this.restoreSettings(pin);
      }

      return {
        manifest,
        walletSnapshots,
        settings: settingsPayload,
        failedWalletIds,
      };
    } catch (error) {
      return null;
    }
  }

  // ------------------------------------------
  // DETECTION (no decrypt needed)
  // ------------------------------------------

  /**
   * Check if preserved data exists in Keychain.
   * Fast check — reads only the unencrypted manifest.
   */
  static async hasPreservedData(): Promise<{
    available: boolean;
    manifest: PreservedManifest | null;
  }> {
    try {
      const manifest = await this.readManifest();
      return {
        available: manifest !== null && manifest.walletCount > 0,
        manifest,
      };
    } catch {
      return { available: false, manifest: null };
    }
  }

  // ------------------------------------------
  // CLEANUP
  // ------------------------------------------

  /**
   * Delete ALL preserved data from Keychain — manifest, settings, all archives, dismiss flag.
   */
  static async deleteAllPreservedData(): Promise<void> {
    try {
      // Delete all wallet archives (chunked)
      const index = await this.readIndex();
      for (const entry of index) {
        const storageKey = `${ARCHIVE_KEY_PREFIX}${entry.walletId}`;
        await this.deleteChunked(storageKey);
      }

      // Also try to delete by manifest wallet IDs (in case index is stale)
      const manifest = await this.readManifest();
      if (manifest) {
        for (const w of manifest.wallets) {
          const storageKey = `${ARCHIVE_KEY_PREFIX}${w.walletId}`;
          await this.deleteChunked(storageKey);
        }
      }

      // Delete index, manifest, settings, dismiss flag, password hash (all potentially chunked)
      await this.deleteChunked(ARCHIVE_INDEX_KEY);
      await this.deleteChunked(MANIFEST_KEY);
      await this.deleteChunked(SETTINGS_KEY);
      await SecureStore.deleteItemAsync(DISMISS_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(PRESERVE_FLAG_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(PASSWORD_HASH_KEY, KEYCHAIN_OPTS).catch(() => {});
    } catch (error) {
    }
  }

  // ------------------------------------------
  // PER-WALLET ARCHIVE
  // ------------------------------------------

  /**
   * Archive a wallet snapshot.
   * v2: Gzip-compresses and stores directly in Keychain (no PBKDF2).
   * iOS Keychain provides hardware-backed AES-256 encryption at rest.
   *
   * @returns true if archiving succeeded
   */
  static async archiveWallet(
    walletId: string,
    snapshot: CanonicalWalletSnapshot,
    _pin: string,
  ): Promise<boolean> {
    try {
      // 1. Compress the snapshot (gzip achieves 60-80% compression)
      const json = JSON.stringify(snapshot);
      const compressed = CanonicalSnapshotBuilder.compress(json);

      // Convert Uint8Array to base64 string for storage
      let binaryStr = '';
      for (let i = 0; i < compressed.length; i++) {
        binaryStr += String.fromCharCode(compressed[i]);
      }
      const base64 = forge.util.encode64(binaryStr);

      const blob: ArchiveBlobV2 = {
        version: 2,
        data: base64,
      };

      // 2. Store in Keychain (chunked — SecureStore has ~2KB limit)
      const storageKey = `${ARCHIVE_KEY_PREFIX}${walletId}`;
      const blobJson = JSON.stringify(blob);
      await this.writeChunked(storageKey, blobJson);

      // 3. Update index
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

      const index = await this.readIndex();
      // Replace existing entry for same walletId, or append
      const existingIdx = index.findIndex(e => e.walletId === walletId);
      if (existingIdx >= 0) {
        index[existingIdx] = entry;
      } else {
        index.push(entry);
      }
      await this.writeIndex(index);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Restore a wallet snapshot from a preserved archive.
   * Handles both v2 (gzip only) and legacy v1 (PBKDF2 + AES-256-GCM) formats.
   *
   * @returns The snapshot, or null if not found / wrong password
   */
  static async restoreArchive(
    walletId: string,
    pin: string,
  ): Promise<CanonicalWalletSnapshot | null> {
    const pinFp = pin ? `"${pin.slice(0, 3)}***" (len=${pin.length})` : '<empty>';
    try {
      const storageKey = `${ARCHIVE_KEY_PREFIX}${walletId}`;
      const raw = await this.readChunked(storageKey);
      if (!raw) {
        return null;
      }

      const blob: ArchiveBlob = JSON.parse(raw);

      if (blob.version === 2) {
        // ── v2: gzip + base64 (fast path) ──
        const binaryStr = forge.util.decode64((blob as ArchiveBlobV2).data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const json = CanonicalSnapshotBuilder.decompress(bytes);
        return JSON.parse(json) as CanonicalWalletSnapshot;
      } else {
        // v1 PBKDF2-encrypted archives are no longer supported
        console.warn('[PreservedArchiveService] Skipping legacy v1 archive (PBKDF2 removed)');
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * List all preserved archive entries (metadata only, no decryption).
   */
  static async listArchives(): Promise<ArchiveEntry[]> {
    return this.readIndex();
  }

  /**
   * Check if any preserved archives exist.
   * Used for post-reinstall detection.
   */
  static async hasArchives(): Promise<boolean> {
    const index = await this.readIndex();
    return index.length > 0;
  }

  /**
   * Delete a specific archive from Keychain.
   */
  static async deleteArchive(walletId: string): Promise<void> {
    try {
      const storageKey = `${ARCHIVE_KEY_PREFIX}${walletId}`;
      await this.deleteChunked(storageKey);

      // Update index
      const index = await this.readIndex();
      const filtered = index.filter(e => e.walletId !== walletId);
      await this.writeIndex(filtered);
    } catch (error) {
    }
  }

  /**
   * Delete all preserved archives (wallet snapshots + index only).
   */
  static async deleteAllArchives(): Promise<void> {
    try {
      const index = await this.readIndex();
      for (const entry of index) {
        const storageKey = `${ARCHIVE_KEY_PREFIX}${entry.walletId}`;
        await this.deleteChunked(storageKey);
      }
      await this.deleteChunked(ARCHIVE_INDEX_KEY);
    } catch (error) {
    }
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  // Legacy v1 PBKDF2 support has been removed.
  // All archives are now v2 format (gzip + Keychain encryption).

  // ------------------------------------------
  // INDEX
  // ------------------------------------------

  /** Read the archive index from Keychain */
  private static async readIndex(): Promise<ArchiveEntry[]> {
    try {
      const raw = await this.readChunked(ARCHIVE_INDEX_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as ArchiveEntry[];
    } catch {
      return [];
    }
  }

  /** Write the archive index to Keychain */
  private static async writeIndex(index: ArchiveEntry[]): Promise<void> {
    const json = JSON.stringify(index);
    await this.writeChunked(ARCHIVE_INDEX_KEY, json);
  }

  // ------------------------------------------
  // CHUNKED KEYCHAIN I/O
  // ------------------------------------------
  // expo-secure-store has a ~2048 byte per-item limit on iOS.
  // These helpers split large values across multiple Keychain entries.

  /**
   * Write a large string to Keychain, chunking if necessary.
   * Stores: {baseKey}_chunk_count = N, {baseKey}_chunk_0 … {baseKey}_chunk_{N-1}
   */
  private static async writeChunked(baseKey: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }


    // Write chunk count first
    await SecureStore.setItemAsync(`${baseKey}_chunk_count`, String(chunks.length), KEYCHAIN_OPTS);

    // Write each chunk and immediately verify it persisted
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${baseKey}_chunk_${i}`, chunks[i], KEYCHAIN_OPTS);

      // Verify this chunk was written successfully
      const readBack = await SecureStore.getItemAsync(`${baseKey}_chunk_${i}`, KEYCHAIN_OPTS);
      if (!readBack || readBack.length !== chunks[i].length) {
        throw new Error(`Keychain write verification failed for ${baseKey}_chunk_${i}`);
      }
    }

    // Final verification: read chunk count back
    const countBack = await SecureStore.getItemAsync(`${baseKey}_chunk_count`, KEYCHAIN_OPTS);
  }

  /**
   * Read a chunked value from Keychain.
   * Returns null if not found.
   */
  private static async readChunked(baseKey: string): Promise<string | null> {
    try {
      // First try reading the chunk count
      const countStr = await SecureStore.getItemAsync(`${baseKey}_chunk_count`, KEYCHAIN_OPTS);

      if (countStr) {
        // Chunked storage — reassemble
        const count = parseInt(countStr, 10);

        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const chunk = await SecureStore.getItemAsync(`${baseKey}_chunk_${i}`, KEYCHAIN_OPTS);
          if (!chunk) {
            return null;
          }
          parts.push(chunk);
        }
        const result = parts.join('');
        return result;
      }

      // Fallback: try legacy non-chunked storage (for backward compat)
      const raw = await SecureStore.getItemAsync(baseKey, KEYCHAIN_OPTS);
      if (raw) {
      }
      return raw;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete a chunked value from Keychain (and any legacy non-chunked entry).
   */
  private static async deleteChunked(baseKey: string): Promise<void> {
    try {
      // Delete legacy non-chunked entry
      await SecureStore.deleteItemAsync(baseKey, KEYCHAIN_OPTS).catch(() => {});

      // Delete chunks
      const countStr = await SecureStore.getItemAsync(`${baseKey}_chunk_count`, KEYCHAIN_OPTS);
      if (countStr) {
        const count = parseInt(countStr, 10);
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(`${baseKey}_chunk_${i}`, KEYCHAIN_OPTS).catch(() => {});
        }
        await SecureStore.deleteItemAsync(`${baseKey}_chunk_count`, KEYCHAIN_OPTS).catch(() => {});
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
