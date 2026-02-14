/**
 * WalletHeader - Compact wallet identity header
 *
 * Shows avatar, wallet name, and sync status.
 * No card wrapper - blends with background.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../hooks';
import { getColors } from '../../constants';
import { SyncStatusCapsule } from './SyncStatusCapsule';
import type { WalletType } from '../../stores/multiWalletStore';

type WalletAvatar = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
};

interface WalletHeaderProps {
  walletName: string;
  walletType: WalletType;
  avatar: WalletAvatar;
  hasMultipleWallets: boolean;
  onEditName: () => void;
  onEditAvatar: () => void;
  onSwitchWallet: () => void;
  onSyncTap: () => void;
}

function getWalletTypeLabel(type: WalletType): string {
  switch (type) {
    case 'hd': return 'HD Wallet';
    case 'imported_key': return 'Imported Key';
    case 'watch_xpub': return 'Watch-only';
    case 'watch_descriptor': return 'Watch-only';
    case 'watch_addresses': return 'Watch-only';
    case 'multisig': return 'Multisig';
    default: return 'Wallet';
  }
}

export function WalletHeader({
  walletName,
  walletType,
  avatar,
  hasMultipleWallets,
  onEditName,
  onEditAvatar,
  onSwitchWallet,
  onSyncTap,
}: WalletHeaderProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const { trigger } = useHaptics();

  const handleAvatarPress = () => {
    trigger('selection');
    if (hasMultipleWallets) {
      onSwitchWallet();
    } else {
      onEditAvatar();
    }
  };

  const handleNamePress = () => {
    trigger('selection');
    onEditName();
  };

  const typeLabel = getWalletTypeLabel(walletType);

  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
      {/* Avatar */}
      <Pressable
        onPress={handleAvatarPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: c.walletHeader.avatarBg,
            },
          ]}
        >
          <Ionicons
            name={avatar.icon}
            size={22}
            color={c.walletHeader.iconColor}
          />
          {hasMultipleWallets && (
            <View
              style={[
                styles.switchIndicator,
                {
                  backgroundColor: c.walletHeader.switchBg,
                },
              ]}
            >
              <Ionicons
                name="chevron-expand"
                size={10}
                color={c.walletHeader.chevron}
              />
            </View>
          )}
        </View>
      </Pressable>

      {/* Name and type */}
      <Pressable
        style={styles.nameContainer}
        onPress={handleNamePress}
        hitSlop={{ top: 8, bottom: 8 }}
      >
        <View style={styles.nameRow}>
          <Text
            style={[
              styles.name,
              { color: c.walletHeader.name },
            ]}
            numberOfLines={1}
          >
            {walletName}
          </Text>
          <Ionicons
            name="pencil"
            size={12}
            color={c.walletHeader.editIcon}
            style={styles.editIcon}
          />
        </View>
        <Text
          style={[
            styles.type,
            {
              color: c.walletHeader.typeText,
            },
          ]}
          numberOfLines={1}
        >
          {typeLabel}
        </Text>
      </Pressable>

      {/* Sync status capsule — uses connection-aware source of truth */}
      <SyncStatusCapsule onPress={onSyncTap} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  nameContainer: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.3,
    maxWidth: 180,
  },
  editIcon: {
    opacity: 0.6,
  },
  type: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
  },
});

export default WalletHeader;
