/**
 * SyncDetailsSheet
 * Premium connection details sheet with conditional reconnect functionality.
 *
 * When CONNECTED: Shows server info, latency, block height — NO Reconnect button.
 * When SYNCING: Shows sync progress — NO Reconnect button.
 * When NOT CONNECTED/OFFLINE: Shows Reconnect button + error state.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { ConnectionProgressSheet } from '../ConnectionProgressSheet';
import { useWalletStore } from '../../stores';
import { getTimeSinceLastSync } from '../../stores/syncStore';
import { useTheme, useHaptics, useConnectionState } from '../../hooks';
import { WalletSyncManager } from '../../services/sync/WalletSyncManager';

interface SyncDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function SyncDetailsSheet({ visible, onClose }: SyncDetailsSheetProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const connection = useConnectionState();
  const walletId = useWalletStore(s => s.walletId);
  const isRefreshing = useWalletStore(s => s.isRefreshing);

  const [showProgress, setShowProgress] = useState(false);

  // The server is connected if either:
  // 1. The ElectrumClient FSM is in 'ready' state (real TCP connection)
  // 2. The sync pipeline completed successfully (syncState === 'synced')
  // This prevents the "not connected" false alarm when FSM is ready but sync hasn't re-run yet
  const isConnected = connection.isConnected || connection.syncState === 'synced' || connection.syncState === 'syncing';
  const isSyncing = connection.syncState === 'syncing';
  const isOffline = connection.syncState === 'offline' && !connection.isConnected;
  const isNotSynced = connection.syncState === 'not_synced' && !connection.isConnected;
  const timeSinceSync = getTimeSinceLastSync(connection.lastSyncTime);

  // Status display config
  const statusDotColor = isConnected
    ? '#30D158'
    : isOffline
    ? '#FF453A'
    : '#8E8E93';

  const statusLabel = isSyncing
    ? 'Syncing...'
    : isConnected
    ? 'Connected'
    : isOffline
    ? 'Offline'
    : 'Not connected';

  const statusLabelColor = isConnected
    ? (isDark ? '#30D158' : '#248A3D')
    : isOffline
    ? (isDark ? '#FF453A' : '#D70015')
    : colors.textMuted;

  const handleReconnect = async () => {
    haptics.trigger('medium');
    setShowProgress(true);

    try {
      if (walletId) {
        await WalletSyncManager.shared().triggerSync(walletId, 'manual');
      }
      haptics.trigger('success');
    } catch {
      haptics.trigger('error');
    }
  };

  const handleProgressComplete = () => {
    setShowProgress(false);
    // Trigger a full sync now that we're reconnected
    if (walletId) {
      WalletSyncManager.shared().triggerSync(walletId, 'manual').catch(() => {});
    }
  };

  const handleServerSettings = () => {
    haptics.trigger('light');
    onClose();
    router.push('/(auth)/electrum-server');
  };

  // Build footer based on connection state
  const footer = (
    <View style={styles.actions}>
      {/* Only show Reconnect when NOT connected and NOT syncing */}
      {!isConnected && (
        <TouchableOpacity
          onPress={handleReconnect}
          disabled={isRefreshing}
          activeOpacity={0.85}
          style={[
            styles.primaryButton,
            {
              backgroundColor: isDark ? '#FFFFFF' : '#0A0A0A',
              opacity: isRefreshing ? 0.6 : 1,
            },
          ]}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={isDark ? '#000000' : '#FFFFFF'} />
          ) : (
            <>
              <Ionicons name="refresh" size={17} color={isDark ? '#000000' : '#FFFFFF'} />
              <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
                Reconnect
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Server Settings — always shown */}
      <TouchableOpacity
        onPress={handleServerSettings}
        activeOpacity={0.7}
        style={styles.secondaryButton}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
          Server Settings
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={colors.textMuted}
          style={{ marginLeft: 2 }}
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <AppBottomSheet
        visible={visible}
        onClose={onClose}
        title="Connection"
        subtitle="Server status"
        footer={footer}
        contentKey={connection.syncState}
      >
        <View style={styles.content}>
          {/* Status Row */}
          <View style={styles.statusSection}>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                Server
              </Text>
              <View style={styles.statusValue}>
                <View style={[
                  styles.statusDot,
                  { backgroundColor: statusDotColor }
                ]} />
                <Text style={[styles.statusText, { color: statusLabelColor }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>

            {/* Host */}
            {(connection.displayHost && connection.displayHost !== 'No server') && (
              <View style={styles.statusRow}>
                <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                  Host
                </Text>
                <Text
                  style={[styles.hostText, { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {connection.displayHost}
                  {connection.currentServer ? `:${connection.currentServer.port}` : ''}
                </Text>
              </View>
            )}

            {/* Server implementation */}
            {connection.serverImpl && isConnected && (
              <View style={styles.statusRow}>
                <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                  Server
                </Text>
                <Text style={[styles.statusText, { color: colors.text }]}>
                  {connection.serverImpl}
                </Text>
              </View>
            )}

            {/* Latency */}
            {connection.latencyMs !== null && isConnected && (
              <View style={styles.statusRow}>
                <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                  Latency
                </Text>
                <View style={[styles.latencyPill, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}>
                  <Text style={[styles.latencyText, { color: colors.text }]}>
                    {connection.latencyMs}ms
                  </Text>
                </View>
              </View>
            )}

            {/* Last update */}
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                Last update
              </Text>
              <Text style={[styles.statusText, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                {isSyncing ? 'In progress...' : timeSinceSync}
              </Text>
            </View>

            {/* Block height */}
            {connection.blockHeight && connection.blockHeight > 0 && (
              <View style={styles.statusRow}>
                <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                  Block height
                </Text>
                <Text style={[styles.statusText, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                  {connection.blockHeight.toLocaleString()}
                </Text>
              </View>
            )}

            {/* Sync error */}
            {connection.syncError && !isConnected && (
              <View style={[styles.errorCard, {
                backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,69,58,0.04)',
                borderColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.10)',
              }]}>
                <Ionicons name="alert-circle" size={14} color={isDark ? '#FF453A' : '#D70015'} />
                <Text style={[styles.errorText, {
                  color: isDark ? '#FF453A' : '#D70015',
                }]}>
                  {connection.syncError}
                </Text>
              </View>
            )}
          </View>
        </View>
      </AppBottomSheet>

      {/* Connection Progress Sheet */}
      <ConnectionProgressSheet
        visible={showProgress}
        onClose={() => setShowProgress(false)}
        onComplete={handleProgressComplete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 28,
  },
  statusSection: {
    gap: 20,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '400',
  },
  statusValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
  },
  hostText: {
    fontSize: 13,
    fontWeight: '400',
    maxWidth: 200,
  },
  latencyPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  latencyText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '400',
    flex: 1,
    lineHeight: 16,
  },
  actions: {
    gap: 7,
    paddingHorizontal: 28,
  },
  primaryButton: {
    flexDirection: 'row',
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default SyncDetailsSheet;
