/**
 * WalletListRow
 * Wallet row for the Wallet Hub list — name, type, balance, sync dot, active bar.
 * Matches the visual style of WalletSwitcherSheet's WalletRow.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import { useSettingsStore } from '../../stores';
import { formatUnitAmount, getUnitSymbol } from '../../utils/formatting';
import type { WalletInfo } from '../../stores/multiWalletStore';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface WalletListRowProps {
  wallet: WalletInfo;
  isActive: boolean;
  isSwitching: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const WALLET_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  hd: 'key-outline',
  watch_xpub: 'eye-outline',
  watch_descriptor: 'eye-outline',
  watch_addresses: 'eye-outline',
  multisig: 'shield-checkmark-outline',
};

const WALLET_TYPE_LABELS: Record<string, string> = {
  hd: 'HD Wallet',
  watch_xpub: 'Watch-Only (xpub)',
  watch_descriptor: 'Watch-Only (descriptor)',
  watch_addresses: 'Watch-Only (addresses)',
  multisig: 'Multisig',
};

const SYNC_STATUS_COLORS: Record<string, string> = {
  synced: '#30D158',
  syncing: '#FFD60A',
  error: '#FF453A',
  idle: 'rgba(255,255,255,0.20)',
};

// Uses the centralized formatting utilities now

export function WalletListRow({
  wallet,
  isActive,
  isSwitching,
  onPress,
  onLongPress,
}: WalletListRowProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const scale = useSharedValue(1);
  const { denomination } = useSettingsStore();

  const unit = getUnitSymbol(denomination);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    if (isSwitching && !isActive) return;
    haptics.trigger('light');
    onPress();
  };

  const handleLongPress = () => {
    haptics.trigger('medium');
    onLongPress();
  };

  const iconName = WALLET_TYPE_ICONS[wallet.type] || 'wallet-outline';
  const typeLabel = WALLET_TYPE_LABELS[wallet.type] || 'Wallet';
  const syncColor = SYNC_STATUS_COLORS[wallet.syncStatus || 'idle'];
  const totalBalance = (wallet.balanceSat || 0) + (wallet.unconfirmedSat || 0);

  // During switching, dim non-active/non-switching rows
  const isDisabledDuringSwitch = isSwitching && !isActive;

  return (
      <AnimatedPressable
        style={[
          animStyle,
          styles.container,
          {
            backgroundColor: isActive
              ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)')
              : 'transparent',
            opacity: isDisabledDuringSwitch ? 0.4 : 1,
          },
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        disabled={isDisabledDuringSwitch}
      >
        {/* Active bar */}
        {isActive && (
          <View
            style={[
              styles.activeBar,
              { backgroundColor: isDark ? '#FFFFFF' : '#000000' },
            ]}
          />
        )}

        {/* Icon */}
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.1)'
                : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          <Ionicons name={iconName} size={18} color={colors.textSecondary} />
        </View>

        {/* Name & type */}
        <View style={styles.textContent}>
          <Text
            style={[styles.walletName, { color: colors.text }]}
            numberOfLines={1}
          >
            {wallet.name.toUpperCase()}
          </Text>
          <View style={styles.typeRow}>
            <Text style={[styles.typeLabel, { color: colors.textMuted }]}>
              {typeLabel}
            </Text>
            <View style={[styles.syncDot, { backgroundColor: syncColor }]} />
          </View>
        </View>

        {/* Balance or spinner */}
        <View style={styles.balanceContainer}>
          {isSwitching && isActive ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <>
              <Text
                style={[styles.balance, { color: colors.text }]}
                numberOfLines={1}
              >
                {formatUnitAmount(totalBalance, denomination, false)}
              </Text>
              <Text style={[styles.unitLabel, { color: colors.textMuted }]}>
                {unit}
              </Text>
            </>
          )}
        </View>
      </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 2,
    position: 'relative',
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  walletName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 6,
  },
  typeLabel: {
    fontSize: 12,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  balanceContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  balance: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  unitLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    marginTop: 1,
  },
});
