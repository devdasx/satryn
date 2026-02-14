/**
 * SyncStatusChip
 * Header sync indicator showing connection/sync state
 * Tap to open SyncDetailsSheet
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSyncStore, type SyncState } from '../../stores';
import { THEME } from '../../constants/theme';
import { useTheme } from '../../hooks';

interface SyncStatusChipProps {
  onPress: () => void;
}

// Get label for sync state
function getSyncLabel(state: SyncState): string {
  switch (state) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing';
    case 'not_synced':
      return 'Not Synced';
    case 'offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

// Get dot color for sync state
function getSyncColor(state: SyncState): string {
  switch (state) {
    case 'synced':
      return THEME.syncStatus.synced;
    case 'syncing':
      return THEME.syncStatus.syncing;
    case 'not_synced':
      return THEME.syncStatus.notSynced;
    case 'offline':
      return THEME.syncStatus.offline;
    default:
      return THEME.syncStatus.notSynced;
  }
}

export function SyncStatusChip({ onPress }: SyncStatusChipProps) {
  const { colors, isDark } = useTheme();
  const syncState = useSyncStore((s) => s.syncState);

  const label = getSyncLabel(syncState);
  const dotColor = getSyncColor(syncState);
  const isSyncing = syncState === 'syncing';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(0, 0, 0, 0.04)',
          borderColor: isDark
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(0, 0, 0, 0.08)',
        },
      ]}
    >
      {/* Status indicator */}
      {isSyncing ? (
        <ActivityIndicator
          size="small"
          color={dotColor}
          style={styles.spinner}
        />
      ) : (
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      )}

      {/* Label */}
      <Text
        style={[
          styles.label,
          {
            color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.7)',
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 32,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  spinner: {
    width: 14,
    height: 14,
    transform: [{ scale: 0.7 }],
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});

export default SyncStatusChip;
