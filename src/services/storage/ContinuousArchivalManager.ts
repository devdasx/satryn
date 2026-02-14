/**
 * ContinuousArchivalManager — Event-driven archival trigger
 *
 * Lightweight static service that decides when to run a full state archive
 * to the iOS Keychain. Called from:
 *   - Background sync completion (useBackgroundWalletSync)
 *   - App backgrounding (_layout.tsx AppState listener)
 *   - Wallet add/remove (multiWalletStore)
 *
 * Guards:
 *   - preserveDataOnDelete must be enabled
 *   - PreserveDataSession must have the password in memory
 *   - Not already archiving (mutex)
 *   - Min 5 minutes debounce between archives
 *   - AppStateManager must not be resetting
 *
 * Performance:
 *   - All triggers are deferred via InteractionManager so animations
 *     and touches are never blocked by archival work.
 *   - The archiveFullState pipeline inserts 50ms yields between wallet
 *     archives to keep the JS thread responsive (see PreservedArchiveService).
 */

import { InteractionManager } from 'react-native';
import { PreserveDataSession } from '../auth/PreserveDataSession';
import { PreservedArchiveService } from './PreservedArchiveService';
import { AppStateManager } from '../AppStateManager';

// ============================================
// SERVICE
// ============================================

export class ContinuousArchivalManager {
  private static isArchiving = false;
  private static lastArchiveAt = 0;
  private static MIN_INTERVAL = 300_000; // 5 minutes debounce
  private static pendingTrigger: ReturnType<typeof setTimeout> | null = null;

  /**
   * Trigger a full state archive if all conditions are met.
   * Safe to call from anywhere — will silently skip if conditions not met.
   *
   * The actual work is deferred via InteractionManager to avoid
   * blocking animations or touch handling with archival operations.
   */
  static triggerIfNeeded(): void {
    // Quick synchronous guard checks (no async, no blocking)
    try {
      const { useSettingsStore } = require('../../stores/settingsStore');
      if (!useSettingsStore.getState().preserveDataOnDelete) return;
      if (AppStateManager.isResetting()) return;
      if (Date.now() - this.lastArchiveAt < this.MIN_INTERVAL) return;
      if (this.isArchiving) return;

      // Use the preserve-data password (set when user enabled the feature).
      // This ensures background archives use the same key as the initial
      // password-based encryption, not the app PIN.
      const pin = PreserveDataSession.getPassword();
      if (!pin) return;

      // Cancel any pending trigger to avoid double-fires
      if (this.pendingTrigger) {
        clearTimeout(this.pendingTrigger);
        this.pendingTrigger = null;
      }

      // Defer heavy work: wait 10s, then run after all animations finish.
      // The longer delay ensures app startup / navigation has fully settled
      // before we start any archival work.
      this.pendingTrigger = setTimeout(() => {
        this.pendingTrigger = null;
        InteractionManager.runAfterInteractions(() => {
          // Yield one more frame before starting heavy work
          requestAnimationFrame(() => {
            this.executeArchive(pin);
          });
        });
      }, 10000);
    } catch {
      // Non-critical — silently skip
    }
  }

  /**
   * Internal: execute the archival. Separated to keep triggerIfNeeded sync.
   */
  private static async executeArchive(pin: string): Promise<void> {
    // Re-check guards (state may have changed during defer)
    try {
      const { useSettingsStore } = require('../../stores/settingsStore');
      if (!useSettingsStore.getState().preserveDataOnDelete) {
        return;
      }
      if (AppStateManager.isResetting()) {
        return;
      }
      if (this.isArchiving) {
        return;
      }

      this.isArchiving = true;
      try {
        await PreservedArchiveService.archiveFullState(pin);
        this.lastArchiveAt = Date.now();
      } finally {
        this.isArchiving = false;
      }
    } catch (error) {
      this.isArchiving = false;
    }
  }

  /**
   * Perform an immediate full archive (used when enabling the feature).
   * Bypasses debounce but respects other guards.
   */
  static async performFullArchive(pin: string): Promise<boolean> {
    if (this.isArchiving) return false;

    this.isArchiving = true;
    try {
      const success = await PreservedArchiveService.archiveFullState(pin);
      if (success) this.lastArchiveAt = Date.now();
      return success;
    } finally {
      this.isArchiving = false;
    }
  }
}
