/**
 * SyncStatusCapsule — Unified sync status indicator
 *
 * Uses useConnectionState() (ElectrumClient FSM + syncStore) as the
 * single source of truth. If the Electrum client is connected, shows
 * "Synced" even if the sync pipeline hasn't caught up yet.
 *
 * This is the same logic the Portfolio tab uses — now extracted into
 * a reusable component for use across Portfolio, Wallet, and anywhere
 * else that needs to display sync status.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useConnectionState } from '../../hooks/useConnectionState';
import { THEME } from '../../constants/theme';
import { useHaptics } from '../../hooks';

interface SyncStatusCapsuleProps {
  onPress?: () => void;
}

export function SyncStatusCapsule({ onPress }: SyncStatusCapsuleProps) {
  const { trigger } = useHaptics();
  const connection = useConnectionState();

  // Derive color — same logic as Portfolio tab
  const getColor = (): string => {
    if (connection.isConnected && connection.syncState !== 'offline') {
      if (connection.syncState === 'syncing') return THEME.syncStatus.syncing;
      return THEME.syncStatus.synced;
    }
    switch (connection.syncState) {
      case 'synced': return THEME.syncStatus.synced;
      case 'syncing': return THEME.syncStatus.syncing;
      case 'not_synced': return THEME.syncStatus.notSynced;
      case 'offline': return THEME.syncStatus.offline;
      default: return THEME.syncStatus.notSynced;
    }
  };

  // Derive label — same logic as Portfolio tab
  const getLabel = (): string => {
    if (connection.isConnected && connection.syncState !== 'offline') {
      if (connection.syncState === 'syncing') return 'Syncing';
      return 'Synced';
    }
    switch (connection.syncState) {
      case 'synced': return 'Synced';
      case 'syncing': return 'Syncing';
      case 'not_synced': return 'Not synced';
      case 'offline': return 'Offline';
      default: return 'Not synced';
    }
  };

  const color = getColor();
  const label = getLabel();
  const isSyncing = label === 'Syncing';

  const handlePress = () => {
    trigger('light');
    onPress?.();
  };

  const capsule = (
    <View style={[styles.capsule, { backgroundColor: `${color}18` }]}>
      {isSyncing ? (
        <ActivityIndicator size={10} color={color} style={styles.indicator} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={handlePress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {capsule}
      </Pressable>
    );
  }

  return capsule;
}

const styles = StyleSheet.create({
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  indicator: {
    marginRight: -2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default SyncStatusCapsule;
