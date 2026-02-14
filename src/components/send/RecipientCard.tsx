/**
 * RecipientCard — Premium recipient card for the send flow.
 *
 * Uses the same card tokens as Settings (settingsCard.bg / .border) so it
 * looks consistent across Light / Dim / Midnight modes.
 * White card in light, subtle glass in dark — exactly like Settings.
 *
 * Features:
 * - Colored left accent stripe (address type)
 * - Grouped address display (4-char chunks)
 * - Type badge + validation indicator
 * - Verify (eye) + Clear actions
 * - iOS BlurView overlay for glass depth
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { THEME, getColors } from '../../constants';
import type { ThemeMode } from '../../types';

// ─── Address type detection ──────────────────────────────────────
type AddressTypeInfo = { label: string; color: string };

function getAddressType(address: string): AddressTypeInfo {
  if (address.startsWith('bc1p') || address.startsWith('tb1p'))
    return { label: 'Taproot', color: '#FF9F0A' };
  if (address.startsWith('bc1q') || address.startsWith('tb1q'))
    return { label: 'Native SegWit', color: '#0A84FF' };
  if (address.startsWith('3') || address.startsWith('2'))
    return { label: 'Wrapped SegWit', color: '#BF5AF2' };
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n'))
    return { label: 'Legacy', color: '#8E8E93' };
  return { label: 'Unknown', color: '#8E8E93' };
}

/** Split address into 4-char groups for readability */
function groupAddress(address: string): string {
  return address.match(/.{1,4}/g)?.join(' ') || address;
}

// ─── Props ───────────────────────────────────────────────────────
export interface RecipientCardProps {
  address: string;
  label?: string;
  index: number;
  isActive: boolean;
  /** Whether address passes validation */
  addressValid?: boolean | null;
  onVerify?: () => void;
  onClear: () => void;
  onPress: () => void;
  isDark: boolean;
  themeMode: ThemeMode;
  colors: any;
}

// ─── Component ───────────────────────────────────────────────────
export function RecipientCard({
  address,
  label,
  index,
  isActive,
  addressValid,
  onVerify,
  onClear,
  onPress,
  isDark,
  themeMode,
  colors,
}: RecipientCardProps) {
  const c = useMemo(() => getColors(themeMode), [themeMode]);

  // ── Card colors — same for all cards, matches Settings ────────
  const cardBg = c.settingsCard.bg;
  const cardBorder = c.settingsCard.border;

  // ── Text / UI tokens from theme ─────────────────────────────
  const textPrimary = c.text.primary;
  const textMuted = c.settingsRow.description;
  const dividerColor = c.settingsRow.divider;
  const iconBg = c.settingsRow.iconBg;
  const stripeFallback = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';

  // ── Address type ──────────────────────────────────────────────
  const addressType = useMemo(() => {
    if (!address) return null;
    return getAddressType(address);
  }, [address]);

  const stripeColor = addressType ? addressType.color : stripeFallback;
  const grouped = useMemo(() => groupAddress(address), [address]);

  // ── Validation ────────────────────────────────────────────────
  const validationIcon = addressValid === true
    ? 'checkmark-circle' as const
    : addressValid === false
      ? 'close-circle' as const
      : 'ellipse' as const;
  const validationColor = addressValid === true
    ? '#30D158'
    : addressValid === false
      ? '#FF453A'
      : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)');

  if (!address) return null;

  return (
    <TouchableOpacity
      activeOpacity={isActive ? 1 : 0.75}
      onPress={onPress}
      style={styles.cardWrapper}
    >
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        {/* iOS blur overlay — same as SettingsCard */}
        {Platform.OS === 'ios' && !isActive && (
          <BlurView
            intensity={30}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Left accent stripe */}
        <View style={[styles.stripe, { backgroundColor: stripeColor }]} />

        {/* Card content */}
        <View style={styles.body}>
          {/* ── Header: validation + label + type badge ── */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Ionicons
                name={validationIcon}
                size={14}
                color={validationColor}
              />
              <Text style={[styles.headerLabel, { color: textMuted }]} numberOfLines={1}>
                {label || `Recipient ${index + 1}`}
              </Text>
            </View>
            {addressType && (
              <View style={[styles.typeBadge, { backgroundColor: `${addressType.color}14` }]}>
                <View style={[styles.typeDot, { backgroundColor: addressType.color }]} />
                <Text style={[styles.typeBadgeText, { color: addressType.color }]}>
                  {addressType.label}
                </Text>
              </View>
            )}
          </View>

          {/* ── Address display ──────────────────────────── */}
          <Text
            style={[styles.addressText, { color: textPrimary }]}
            selectable={isActive}
          >
            {grouped}
          </Text>

          {/* ── Divider ─────────────────────────────────── */}
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />

          {/* ── Footer: char count + actions ─────────────── */}
          <View style={styles.footerRow}>
            <Text style={[styles.charCount, { color: textMuted }]}>
              {address.length} characters
            </Text>

            <View style={styles.actions}>
              {addressValid === true && onVerify && (
                <TouchableOpacity
                  onPress={onVerify}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.actionBtn, { backgroundColor: iconBg }]}
                >
                  <Ionicons name="eye-outline" size={15} color={textMuted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClear}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[styles.clearBtn, {
                  backgroundColor: isDark ? 'rgba(255,59,48,0.08)' : 'rgba(255,59,48,0.06)',
                }]}
              >
                <Ionicons name="close" size={13} color="#FF453A" style={{ opacity: 0.7 }} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  cardWrapper: {
    width: '100%',
    marginBottom: 10,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  stripe: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 16,
    gap: 12,
  },

  // ── Header ─────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    flex: 1,
  },

  // ── Type badge ─────────
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // ── Address ─────────
  addressText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
    lineHeight: 23,
  },

  // ── Divider ─────────
  divider: {
    height: StyleSheet.hairlineWidth,
  },

  // ── Footer ─────────
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },

  // ── Actions ─────────
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
