/**
 * iCloudService — NSUbiquitousKeyValueStore wrapper
 *
 * Stores and retrieves encrypted backup blobs from iCloud Key-Value Storage.
 * Each wallet backup is stored under key: backup_<walletId>
 *
 * iCloud KVS limits:
 * - 1 MB total storage
 * - 1024 key-value pairs max
 * - Individual values up to ~1 MB
 * These limits are generous for wallet backup metadata.
 *
 * NOTE: The native module is loaded lazily to avoid crashes when the module
 * is imported but the native binary hasn't been rebuilt yet.
 */

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EncryptedBackupBlob, EncryptedFullBackupBlob, BackupMetadata } from './BackupService';
import { BackupService } from './BackupService';

const BACKUP_KEY_PREFIX = 'backup_';
const FULL_BACKUP_KEY_PREFIX = 'fullbackup_';

/**
 * Load the native iCloud module using Expo's optional loader.
 * Returns null if the native module hasn't been built into the binary.
 * Unlike requireNativeModule, this does NOT throw when the module is missing.
 */
let _iCloudModule: any | null | undefined;
function getICloudModule(): any | null {
  if (_iCloudModule === undefined) {
    _iCloudModule = requireOptionalNativeModule('ExpoAppleCloudStorage');
  }
  return _iCloudModule;
}

// ============================================
// TYPES
// ============================================

export interface BackupListItem {
  walletId: string;
  metadata: BackupMetadata;
}

export interface FullBackupListItem {
  backupId: string;
  backupName: string;
  backupDate: number;
  walletCount: number;
  walletNames: string[];
}

// ============================================
// iCLOUD SERVICE
// ============================================

export class ICloudService {
  /**
   * Check if iCloud KVS is available on this device.
   * Only supported on iOS.
   */
  static isAvailable(): boolean {
    if (Platform.OS !== 'ios') return false;
    try {
      const iCloud = getICloudModule();
      if (!iCloud) return false;
      iCloud.getAllKeys();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store an encrypted backup blob in iCloud.
   * @param walletId - Wallet identifier
   * @param blob - Encrypted backup blob
   */
  static writeBackup(walletId: string, blob: EncryptedBackupBlob): void {
    const iCloud = getICloudModule();
    if (!iCloud) throw new Error('iCloud is not available');
    const key = `${BACKUP_KEY_PREFIX}${walletId}`;
    const value = BackupService.serializeBlob(blob);
    iCloud.set(key, value);
    // Trigger sync so subsequent reads can find the key
    if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
  }

  /**
   * Read an encrypted backup blob from iCloud.
   * @param walletId - Wallet identifier
   * @returns Encrypted blob, or null if not found
   */
  static readBackup(walletId: string): EncryptedBackupBlob | null {
    const iCloud = getICloudModule();
    if (!iCloud) return null;
    const key = `${BACKUP_KEY_PREFIX}${walletId}`;
    const value = iCloud.getString(key);
    if (!value) return null;
    return BackupService.parseBlob(value);
  }

  /**
   * Delete a backup from iCloud.
   * Uses native removeAndVerify() for atomic removal + verification.
   * Falls back to remove() + JS-side verification if removeAndVerify is unavailable.
   * @param walletId - Wallet identifier
   * @returns true if successfully deleted, false if verification failed
   */
  static deleteBackup(walletId: string): boolean {
    const iCloud = getICloudModule();
    if (!iCloud) throw new Error('iCloud is not available');
    const key = `${BACKUP_KEY_PREFIX}${walletId}`;


    // Prefer native atomic removeAndVerify if available
    if (typeof iCloud.removeAndVerify === 'function') {
      try {
        const success = iCloud.removeAndVerify(key);
        return success;
      } catch (e) {
        // Fall through to legacy approach
      }
    }

    // Fallback: remove() + JS-side verification
    try {
      iCloud.remove(key);
    } catch (e) {
      return false;
    }

    // Sync + verify
    try {
      if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
      const stillExists = iCloud.getString(key);
      if (stillExists !== null && stillExists !== undefined) {
        iCloud.set(key, '');
        iCloud.remove(key);
        if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
        const stillExistsAfterRetry = iCloud.getString(key);
        if (stillExistsAfterRetry !== null && stillExistsAfterRetry !== undefined) {
          return false;
        }
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  /**
   * List all backup metadata stored in iCloud.
   * Returns wallet IDs and unencrypted metadata (name, type, dates).
   */
  static listBackups(deviceId?: string): BackupListItem[] {
    const iCloud = getICloudModule();
    if (!iCloud) return [];
    const allKeys = iCloud.getAllKeys();
    if (!allKeys) return [];
    const backupKeys = allKeys.filter((k: string) => k.startsWith(BACKUP_KEY_PREFIX));

    const results: BackupListItem[] = [];

    for (const key of backupKeys) {
      const walletId = key.slice(BACKUP_KEY_PREFIX.length);
      const value = iCloud.getString(key);
      if (!value) continue;

      const blob = BackupService.parseBlob(value);
      if (!blob) continue;

      // Device-specific filtering: skip backups from other devices
      if (deviceId && blob.deviceId && blob.deviceId !== deviceId) continue;

      results.push({
        walletId,
        metadata: {
          walletName: blob.walletName,
          walletType: blob.walletType,
          createdAt: blob.createdAt,
          backupDate: blob.backupDate,
        },
      });
    }

    // Sort by backup date (newest first)
    results.sort((a, b) => b.metadata.backupDate - a.metadata.backupDate);
    return results;
  }

  /**
   * Check if a specific wallet has a backup in iCloud.
   * @param walletId - Wallet identifier
   */
  static hasBackup(walletId: string): boolean {
    const iCloud = getICloudModule();
    if (!iCloud) return false;
    const key = `${BACKUP_KEY_PREFIX}${walletId}`;
    const value = iCloud.getString(key);
    return value !== null;
  }

  /**
   * Get the count of individual wallet backups stored in iCloud.
   */
  static getBackupCount(deviceId?: string): number {
    if (deviceId) return this.listBackups(deviceId).length;
    const iCloud = getICloudModule();
    if (!iCloud) return 0;
    const allKeys = iCloud.getAllKeys();
    if (!allKeys) return 0;
    return allKeys.filter((k: string) =>
      k.startsWith(BACKUP_KEY_PREFIX) && !k.startsWith(FULL_BACKUP_KEY_PREFIX)
    ).length;
  }

  // ============================================
  // FULL BACKUP METHODS
  // ============================================

  /**
   * Store an encrypted full backup blob in iCloud.
   * @param backupId - Unique backup identifier
   * @param blob - Encrypted full backup blob
   */
  static writeFullBackup(backupId: string, blob: EncryptedFullBackupBlob): void {
    const iCloud = getICloudModule();
    if (!iCloud) throw new Error('iCloud is not available');
    const key = `${FULL_BACKUP_KEY_PREFIX}${backupId}`;
    const value = BackupService.serializeFullBlob(blob);
    iCloud.set(key, value);
    // Trigger sync so subsequent reads can find the key
    if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
  }

  /**
   * Read an encrypted full backup blob from iCloud.
   * @param backupId - Unique backup identifier
   * @returns Encrypted full blob, or null if not found
   */
  static readFullBackup(backupId: string): EncryptedFullBackupBlob | null {
    const iCloud = getICloudModule();
    if (!iCloud) return null;
    const key = `${FULL_BACKUP_KEY_PREFIX}${backupId}`;
    const value = iCloud.getString(key);
    if (!value) return null;
    return BackupService.parseFullBlob(value);
  }

  /**
   * Delete a full backup from iCloud.
   * Uses native removeAndVerify() for atomic removal + verification.
   * Falls back to remove() + JS-side verification if removeAndVerify is unavailable.
   * @param backupId - Unique backup identifier
   * @returns true if successfully deleted, false if verification failed
   */
  static deleteFullBackup(backupId: string): boolean {
    const iCloud = getICloudModule();
    if (!iCloud) throw new Error('iCloud is not available');
    const key = `${FULL_BACKUP_KEY_PREFIX}${backupId}`;


    // Prefer native atomic removeAndVerify if available
    if (typeof iCloud.removeAndVerify === 'function') {
      try {
        const success = iCloud.removeAndVerify(key);
        return success;
      } catch (e) {
        // Fall through to legacy approach
      }
    }

    // Fallback: remove() + JS-side verification
    try {
      iCloud.remove(key);
    } catch (e) {
      return false;
    }

    // Sync + verify
    try {
      if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
      const stillExists = iCloud.getString(key);
      if (stillExists !== null && stillExists !== undefined) {
        iCloud.set(key, '');
        iCloud.remove(key);
        if (typeof iCloud.synchronize === 'function') iCloud.synchronize();
        const stillExistsAfterRetry = iCloud.getString(key);
        if (stillExistsAfterRetry !== null && stillExistsAfterRetry !== undefined) {
          return false;
        }
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  /**
   * List all full backups stored in iCloud.
   * Returns metadata without the encrypted payload.
   */
  static listFullBackups(deviceId?: string): FullBackupListItem[] {
    const iCloud = getICloudModule();
    if (!iCloud) return [];
    const allKeys = iCloud.getAllKeys();
    if (!allKeys) return [];
    const fullBackupKeys = allKeys.filter((k: string) => k.startsWith(FULL_BACKUP_KEY_PREFIX));

    const results: FullBackupListItem[] = [];

    for (const key of fullBackupKeys) {
      const backupId = key.slice(FULL_BACKUP_KEY_PREFIX.length);
      const value = iCloud.getString(key);
      if (!value) continue;

      const blob = BackupService.parseFullBlob(value);
      if (!blob) continue;

      // Device-specific filtering: skip backups from other devices
      if (deviceId && blob.deviceId && blob.deviceId !== deviceId) continue;

      results.push({
        backupId,
        backupName: blob.backupName,
        backupDate: blob.backupDate,
        walletCount: blob.walletCount,
        walletNames: blob.walletNames || [],
      });
    }

    // Sort by backup date (newest first)
    results.sort((a, b) => b.backupDate - a.backupDate);
    return results;
  }

  /**
   * Get the count of full backups stored in iCloud.
   */
  static getFullBackupCount(deviceId?: string): number {
    if (deviceId) return this.listFullBackups(deviceId).length;
    const iCloud = getICloudModule();
    if (!iCloud) return 0;
    const allKeys = iCloud.getAllKeys();
    if (!allKeys) return 0;
    return allKeys.filter((k: string) => k.startsWith(FULL_BACKUP_KEY_PREFIX)).length;
  }

  /**
   * Debug: dump all iCloud KVS keys related to backups.
   * Useful for diagnosing deletion issues.
   */
  static debugDumpKeys(): { allKeys: string[]; backupKeys: string[]; fullBackupKeys: string[] } {
    const iCloud = getICloudModule();
    if (!iCloud) return { allKeys: [], backupKeys: [], fullBackupKeys: [] };
    const allKeys: string[] = iCloud.getAllKeys() || [];
    const backupKeys = allKeys.filter((k: string) =>
      k.startsWith(BACKUP_KEY_PREFIX) && !k.startsWith(FULL_BACKUP_KEY_PREFIX)
    );
    const fullBackupKeys = allKeys.filter((k: string) => k.startsWith(FULL_BACKUP_KEY_PREFIX));
    return { allKeys, backupKeys, fullBackupKeys };
  }
}
