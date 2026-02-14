/**
 * NearbyPeerList — Manual peer selection list
 *
 * Displays discovered nearby peers as tappable rows.
 * Used by NearbyAdvertising (receiver) so the user can
 * manually choose which peer to connect with.
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import { useNearby } from './NearbyProvider';
import type { DiscoveredPeer } from '../../services/nearby/types';

interface NearbyPeerListProps {
  /** Whether a connection attempt is currently in progress */
  connecting?: boolean;
}

export function NearbyPeerList({ connecting }: NearbyPeerListProps) {
  const { colors, isDark } = useTheme();
  const { selectAndAccept } = useNearby();
  const discoveredPeers = useNearbySessionStore((s) => s.discoveredPeers);
  const selectedPeerId = useNearbySessionStore((s) => s.selectedPeerId);

  // Convert Map to sorted array (oldest first — order of discovery)
  const peers = useMemo(
    () =>
      Array.from(discoveredPeers.values()).sort(
        (a, b) => a.discoveredAt - b.discoveredAt,
      ),
    [discoveredPeers],
  );

  const handleSelect = useCallback(
    (peerId: string) => {
      selectAndAccept(peerId);
    },
    [selectAndAccept],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: DiscoveredPeer; index: number }) => {
      const isSelected = selectedPeerId === item.peerId;
      const isDisabled = connecting && !isSelected;

      return (
        <Animated.View entering={FadeInDown.delay(index * 80).duration(300)}>
          <TouchableOpacity
            onPress={() => handleSelect(item.peerId)}
            disabled={isDisabled || (connecting && isSelected)}
            activeOpacity={0.7}
            style={styles.peerTouchable}
          >
            <View style={[styles.peerCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
              <View style={styles.peerRow}>
                <View
                  style={[
                    styles.peerIcon,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(0,0,0,0.04)',
                    },
                  ]}
                >
                  <Ionicons
                    name="person-circle-outline"
                    size={24}
                    color={isSelected ? colors.success : colors.textSecondary}
                  />
                </View>
                <View style={styles.peerInfo}>
                  <Text
                    style={[
                      styles.peerName,
                      {
                        color: isDisabled
                          ? colors.textTertiary
                          : colors.textPrimary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {item.displayName || 'Unknown Device'}
                  </Text>
                  <Text
                    style={[styles.peerHint, { color: colors.textTertiary }]}
                  >
                    Sender
                  </Text>
                </View>
                {isSelected && connecting ? (
                  <ActivityIndicator size="small" color={colors.success} />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={
                      isDisabled ? colors.textMuted : colors.textTertiary
                    }
                  />
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      );
    },
    [
      handleSelect,
      selectedPeerId,
      connecting,
      isDark,
      colors,
    ],
  );

  // ─── Empty state ─────────────────────────────────────────────
  if (peers.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ActivityIndicator size="small" color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
          Looking for nearby devices...
        </Text>
      </View>
    );
  }

  // ─── Peer list ───────────────────────────────────────────────
  return (
    <FlatList
      data={peers}
      keyExtractor={(item) => item.peerId}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  peerTouchable: {
    // Touch target
  },
  peerCard: {
    borderRadius: 16,
    padding: 8,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  peerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerInfo: {
    flex: 1,
  },
  peerName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  peerHint: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: -0.1,
    marginTop: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
});
