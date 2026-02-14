/**
 * useAutoBackup — React hook that triggers daily auto-backup checks.
 *
 * Listens for AppState foreground events and calls AutoBackupManager.triggerIfDue()
 * which checks all conditions (enabled, password set, 24h elapsed, PIN available).
 *
 * Mount in (auth)/_layout.tsx alongside useBackgroundWalletSync.
 * Only activates when autoBackupEnabled is true and wallet is unlocked.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';
import { useWalletStore } from '../stores';

export function useAutoBackup(): void {
  const autoBackupEnabled = useSettingsStore(s => s.autoBackupEnabled);
  const isLocked = useWalletStore(s => s.isLocked);

  useEffect(() => {
    if (!autoBackupEnabled || isLocked) return;

    // Lazy-import to avoid circular deps
    const { AutoBackupManager } = require('../services/backup/AutoBackupManager');

    // Check on mount (covers app startup after unlock)
    AutoBackupManager.triggerIfDue();

    // Check on every foreground event
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          AutoBackupManager.triggerIfDue();
        }
      },
    );

    return () => subscription.remove();
  }, [autoBackupEnabled, isLocked]);
}
