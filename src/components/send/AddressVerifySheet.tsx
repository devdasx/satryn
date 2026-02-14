/**
 * AddressVerifySheet — Bottom sheet for verifying a Bitcoin address.
 *
 * Features:
 * - Large font toggle for easy visual verification
 * - Character grouping (4-char chunks) for readability
 * - Address type badge (Native SegWit, Taproot, etc.)
 * - Copy address
 * - Share address
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme } from '../../hooks';

// ─── Address type detection (prefix-based) ──────────────────────

type AddressTypeInfo = {
  label: string;
  color: string;
};

function getAddressType(address: string): AddressTypeInfo {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return { label: 'Taproot', color: '#FF9F0A' };
  }
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
    return { label: 'Native SegWit', color: '#0A84FF' };
  }
  if (address.startsWith('3') || address.startsWith('2')) {
    return { label: 'Wrapped SegWit', color: '#BF5AF2' };
  }
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return { label: 'Legacy', color: '#8E8E93' };
  }
  return { label: 'Unknown', color: '#8E8E93' };
}

/** Split an address into 4-char groups for readability */
function groupAddress(address: string): string {
  return address.match(/.{1,4}/g)?.join('  ') || address;
}

// ─── Props ──────────────────────────────────────────────────────

interface AddressVerifySheetProps {
  visible: boolean;
  onClose: () => void;
  address: string;
  label?: string;
}

// ─── Component ──────────────────────────────────────────────────

export function AddressVerifySheet({
  visible,
  onClose,
  address,
  label,
}: AddressVerifySheetProps) {
  const { isDark, colors } = useTheme();
  const [largeFont, setLargeFont] = useState(false);
  const [copied, setCopied] = useState(false);

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const mutedColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)';

  const addressType = useMemo(() => getAddressType(address), [address]);
  const grouped = useMemo(() => groupAddress(address), [address]);

  const handleCopy = useCallback(async () => {
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const handleShare = useCallback(async () => {
    await Haptics.selectionAsync();
    try {
      await Share.share({ message: address });
    } catch {
      // Share cancelled
    }
  }, [address]);

  const handleToggleSize = useCallback(() => {
    Haptics.selectionAsync();
    setLargeFont((prev) => !prev);
  }, []);

  const fontSize = largeFont ? 22 : 15;
  const lineHeight = largeFont ? 34 : 24;

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Verify Address"
    >
      <View style={styles.sheetBody}>
        {/* Label if present */}
        {label && (
          <Text style={[styles.contactLabel, { color: colors.text }]} numberOfLines={1}>
            {label}
          </Text>
        )}

        {/* Address type badge */}
        <View style={styles.badgeRow}>
          <View style={[styles.typeBadge, { backgroundColor: `${addressType.color}18` }]}>
            <Text style={[styles.typeBadgeText, { color: addressType.color }]}>
              {addressType.label}
            </Text>
          </View>
          <Text style={[styles.charCount, { color: mutedColor }]}>
            {address.length} characters
          </Text>
        </View>

        {/* Address display card */}
        <View style={[styles.addressCard, { backgroundColor: surfaceBg }]}>
          <Text
            style={[
              styles.addressText,
              { color: colors.text, fontSize, lineHeight },
            ]}
            selectable
          >
            {grouped}
          </Text>
        </View>

        {/* Action row */}
        <View style={styles.actionRow}>
          {/* Font size toggle */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: surfaceBg }]}
            onPress={handleToggleSize}
            activeOpacity={0.6}
          >
            <Ionicons
              name={largeFont ? 'text-outline' : 'resize-outline'}
              size={18}
              color={mutedColor}
            />
            <Text style={[styles.actionLabel, { color: mutedColor }]}>
              {largeFont ? 'SMALLER' : 'LARGER'}
            </Text>
          </TouchableOpacity>

          {/* Copy */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: surfaceBg }]}
            onPress={handleCopy}
            activeOpacity={0.6}
          >
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={18}
              color={copied ? '#30D158' : mutedColor}
            />
            <Text style={[styles.actionLabel, { color: copied ? '#30D158' : mutedColor }]}>
              {copied ? 'COPIED' : 'COPY'}
            </Text>
          </TouchableOpacity>

          {/* Share */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: surfaceBg }]}
            onPress={handleShare}
            activeOpacity={0.6}
          >
            <Ionicons
              name="share-outline"
              size={18}
              color={mutedColor}
            />
            <Text style={[styles.actionLabel, { color: mutedColor }]}>
              SHARE
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetBody: {
    paddingHorizontal: 28,
    paddingBottom: 20,
    gap: 16,
  },
  contactLabel: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  addressCard: {
    borderRadius: 16,
    padding: 18,
  },
  addressText: {
    fontWeight: '500',
    letterSpacing: 0.8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
