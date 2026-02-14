/**
 * AutoBackupManager — Daily iCloud auto-backup service
 *
 * Automatically creates an encrypted iCloud backup every 24 hours when:
 *   1. Auto-backup is enabled in settings
 *   2. A backup password has been set
 *   3. The user's PIN is available (SensitiveSession active)
 *   4. 24+ hours have passed since the last auto-backup
 *
 * Triggered by the useAutoBackup hook on foreground events.
 * Follows the ContinuousArchivalManager pattern: static class, mutex,
 * deferred execution via InteractionManager.
 *
 * Uses encryptFullBackupCompressed (gzip + AES-256-GCM) to minimize
 * iCloud KVS storage consumption (~60-80% smaller).
 */

import { InteractionManager } from 'react-native';
import { BackupService } from './BackupService';
import { ICloudService } from './iCloudService';
import { SensitiveSession } from '../auth/SensitiveSession';
import { getDeviceId } from '../DeviceIdentity';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export class AutoBackupManager {
  private static isRunning = false;
  private static pendingTrigger: ReturnType<typeof setTimeout> | null = null;

  /**
   * Check if a daily auto-backup is due and run it if conditions are met.
   * Safe to call from anywhere — silently skips if conditions not met.
   */
  static triggerIfDue(): void {
    try {
      const { useSettingsStore } = require('../../stores/settingsStore');
      const state = useSettingsStore.getState();

      if (!state.autoBackupEnabled) return;
      if (!state.autoBackupPassword) return;
      if (this.isRunning) return;

      // Check 24-hour interval
      const lastBackup = state.lastAutoBackupDate;
      if (lastBackup && Date.now() - lastBackup < TWENTY_FOUR_HOURS) return;

      // PIN must be available (user is unlocked)
      const pin = SensitiveSession.getPin();
      if (!pin) return;

      // Cancel pending trigger to avoid double-fires
      if (this.pendingTrigger) {
        clearTimeout(this.pendingTrigger);
        this.pendingTrigger = null;
      }

      // Defer: wait 5s, then run after animations settle
      this.pendingTrigger = setTimeout(() => {
        this.pendingTrigger = null;
        InteractionManager.runAfterInteractions(() => {
          this.executeAutoBackup();
        });
      }, 5000);
    } catch {
      // Non-critical — silently skip
    }
  }

  /**
   * Perform an immediate auto-backup. Used when enabling
   * auto-backup for the first time (bypasses 24h check).
   */
  static async performImmediate(pin: string, password: string): Promise<boolean> {
    if (this.isRunning) return false;
    return this.runBackupPipeline(pin, password);
  }

  /**
   * Internal: execute the deferred auto-backup.
   */
  private static async executeAutoBackup(): Promise<void> {
    try {
      const { useSettingsStore } = require('../../stores/settingsStore');
      const state = useSettingsStore.getState();

      // Re-check guards (state may have changed during defer)
      if (!state.autoBackupEnabled) return;
      if (!state.autoBackupPassword) return;
      if (this.isRunning) return;

      const pin = SensitiveSession.getPin();
      if (!pin) return;

      const lastBackup = state.lastAutoBackupDate;
      if (lastBackup && Date.now() - lastBackup < TWENTY_FOUR_HOURS) return;

      await this.runBackupPipeline(pin, state.autoBackupPassword);
    } catch {
      // Silent failure — auto-backup is best-effort
    }
  }

  /**
   * Core backup pipeline: assemble → compress+encrypt → upload → update store.
   */
  private static async runBackupPipeline(
    pin: string,
    password: string,
  ): Promise<boolean> {
    this.isRunning = true;
    try {
      // Generate auto-backup name with date
      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const backupName = `Auto Backup \u2014 ${dateStr}`;

      // Step 1: Assemble wallet data
      const payload = await BackupService.assembleFullPayload(pin, backupName);
      if (!payload) {
        if (__DEV__) console.warn('[AutoBackup] Failed to assemble payload');
        return false;
      }

      // Step 2: Compress + Encrypt
      const deviceId = await getDeviceId();
      const blob = BackupService.encryptFullBackupCompressed(
        payload,
        password,
        deviceId,
      );

      // Step 3: Write to iCloud
      const backupId = `auto_${Date.now()}`;
      ICloudService.writeFullBackup(backupId, blob);

      // Step 4: Update settings store
      const { useSettingsStore } = require('../../stores/settingsStore');
      const store = useSettingsStore.getState();
      store.setLastAutoBackupDate(Date.now());
      store.addICloudBackup({
        id: backupId,
        name: backupName,
        timestamp: Date.now(),
        walletCount: payload.wallets.length,
        walletNames: payload.wallets.map((w: { walletName: string }) => w.walletName),
      });

      if (__DEV__) console.log('[AutoBackup] Backup completed:', backupName);
      return true;
    } catch (e) {
      if (__DEV__) console.warn('[AutoBackup] Pipeline failed:', e);
      return false;
    } finally {
      this.isRunning = false;
    }
  }
}
