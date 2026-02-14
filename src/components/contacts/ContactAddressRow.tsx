/**
 * ContactAddressRow
 * Individual address row in contact detail — type badge, address, label, actions.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import { getAddressType } from '../../utils/validation';
import type { ContactAddress } from '../../types/contacts';

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  p2wpkh: 'SegWit',
  p2wsh: 'Taproot',
  p2sh: 'Wrapped',
  p2pkh: 'Legacy',
  unknown: 'Address',
};

const ADDRESS_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  p2wpkh: 'flash-outline',
  p2wsh: 'shield-outline',
  p2sh: 'layers-outline',
  p2pkh: 'time-outline',
  unknown: 'wallet-outline',
};

export interface ContactAddressRowProps {
  address: ContactAddress;
  isDefault: boolean;
  onCopy: () => void;
  onSend: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}

export function ContactAddressRow({
  address,
  isDefault,
  onCopy,
  onSend,
  onSetDefault,
  onRemove,
}: ContactAddressRowProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const [showActions, setShowActions] = useState(false);

  const addrType = getAddressType(address.address);
  const typeLabel = ADDRESS_TYPE_LABELS[addrType] || 'Address';
  const typeIcon = ADDRESS_TYPE_ICONS[addrType] || 'wallet-outline';
  const truncated = `${address.address.slice(0, 12)}...${address.address.slice(-8)}`;

  const handleToggleActions = () => {
    haptics.trigger('selection');
    setShowActions(!showActions);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        },
      ]}
    >
      <View style={styles.mainRow}>
        {/* Type icon */}
        <View
          style={[
            styles.typeIcon,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.04)',
            },
          ]}
        >
          <Ionicons name={typeIcon} size={16} color={colors.textSecondary} />
        </View>

        {/* Address info */}
        <View style={styles.addressInfo}>
          <View style={styles.labelRow}>
            {address.label && (
              <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
                {address.label}
              </Text>
            )}
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(0,0,0,0.04)',
                },
              ]}
            >
              <Text style={[styles.typeBadgeText, { color: colors.textMuted }]}>
                {typeLabel}
              </Text>
            </View>
            {isDefault && (
              <View style={styles.defaultPill}>
                <Text style={styles.defaultPillText}>Default</Text>
              </View>
            )}
          </View>
          <Text style={[styles.address, { color: colors.textMuted }]} numberOfLines={1}>
            {truncated}
          </Text>
        </View>

        {/* Overflow menu button */}
        <TouchableOpacity
          onPress={handleToggleActions}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.menuButton}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {/* Expanded actions */}
      {showActions && (
        <View style={[styles.actionsRow, { borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <TouchableOpacity style={styles.actionButton} onPress={() => { haptics.trigger('selection'); onCopy(); setShowActions(false); }}>
            <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.actionText, { color: colors.textSecondary }]}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => { haptics.trigger('selection'); onSend(); setShowActions(false); }}>
            <Ionicons name="send-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.actionText, { color: colors.textSecondary }]}>Send</Text>
          </TouchableOpacity>
          {!isDefault && (
            <TouchableOpacity style={styles.actionButton} onPress={() => { haptics.trigger('selection'); onSetDefault(); setShowActions(false); }}>
              <Ionicons name="star-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>Default</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={() => { haptics.trigger('warning'); onRemove(); setShowActions(false); }}>
            <Ionicons name="trash-outline" size={16} color="#FF453A" />
            <Text style={[styles.actionText, { color: '#FF453A' }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    overflow: 'hidden',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  typeIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  defaultPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: 'rgba(48,209,88,0.12)',
  },
  defaultPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#30D158',
  },
  address: {
    fontSize: 12,
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
