/**
 * CosignerSignatureRow — Interactive cosigner row for the multisig signing screen.
 *
 * Each cosigner row shows:
 * - Signed: green check + "Signed" badge (read-only)
 * - Local & unsigned: "Sign" button that signs with that specific cosigner's key
 * - External & unsigned: "Import" button to import a signed PSBT from that cosigner
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';

interface CosignerSignatureRowProps {
  name: string;
  fingerprint: string;
  hasSigned: boolean;
  isLocal: boolean;
  /** Called when user taps "Sign" on a local unsigned cosigner */
  onSign?: () => void;
  /** Called when user taps "Import" on an external unsigned cosigner */
  onImport?: () => void;
  /** Shows loading spinner on the Sign button */
  isSigning?: boolean;
}

export function CosignerSignatureRow({
  name,
  fingerprint,
  hasSigned,
  isLocal,
  onSign,
  onImport,
  isSigning = false,
}: CosignerSignatureRowProps) {
  const { colors } = useTheme();

  const truncatedFingerprint = fingerprint.length > 8
    ? fingerprint.slice(0, 8)
    : fingerprint;

  return (
    <View style={[
      styles.row,
      {
        backgroundColor: hasSigned
          ? `${THEME.brand.bitcoin}08`
          : colors.fillSecondary,
        borderColor: hasSigned
          ? `${THEME.brand.bitcoin}25`
          : `${colors.fillTertiary}`,
      },
    ]}>
      {/* Left: status icon */}
      <View style={[
        styles.statusIcon,
        {
          backgroundColor: hasSigned
            ? THEME.brand.bitcoin
            : isLocal
              ? `${THEME.brand.bitcoin}15`
              : colors.fillTertiary,
        },
      ]}>
        {hasSigned ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : isLocal ? (
          <Ionicons name="key" size={12} color={THEME.brand.bitcoin} />
        ) : (
          <Ionicons name="globe-outline" size={12} color={colors.textMuted} />
        )}
      </View>

      {/* Center: cosigner info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.fingerprint, { color: colors.textMuted }]}>
            {truncatedFingerprint.toUpperCase()}
          </Text>
          <View style={styles.metaDot} />
          <View style={[
            styles.typeBadge,
            {
              backgroundColor: isLocal
                ? `${THEME.brand.bitcoin}12`
                : `${colors.textMuted}15`,
            },
          ]}>
            <Text style={[
              styles.typeBadgeText,
              { color: isLocal ? THEME.brand.bitcoin : colors.textMuted },
            ]}>
              {isLocal ? 'Local' : 'External'}
            </Text>
          </View>
        </View>
      </View>

      {/* Right: action or status */}
      {hasSigned ? (
        <View style={[styles.signedBadge, { backgroundColor: `${THEME.brand.bitcoin}15` }]}>
          <Ionicons name="checkmark-circle" size={14} color={THEME.brand.bitcoin} />
          <Text style={[styles.signedText, { color: THEME.brand.bitcoin }]}>Signed</Text>
        </View>
      ) : isLocal && onSign ? (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: THEME.brand.bitcoin }]}
          onPress={onSign}
          activeOpacity={0.7}
          disabled={isSigning}
        >
          {isSigning ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="key" size={13} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Sign</Text>
            </>
          )}
        </TouchableOpacity>
      ) : !isLocal && onImport ? (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.fillTertiary }]}
          onPress={onImport}
          activeOpacity={0.7}
        >
          <Ionicons name="download-outline" size={13} color={colors.text} />
          <Text style={[styles.actionButtonTextSecondary, { color: colors.text }]}>Import</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.awaitingBadge, { backgroundColor: colors.fillTertiary }]}>
          <Text style={[styles.awaitingText, { color: colors.textMuted }]}>Awaiting</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#999',
    opacity: 0.5,
  },
  fingerprint: {
    fontSize: 12,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Signed state
  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  signedText: {
    fontSize: 12,
    fontWeight: '700',
  },
  // Action buttons
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 70,
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionButtonTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Awaiting state
  awaitingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  awaitingText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
