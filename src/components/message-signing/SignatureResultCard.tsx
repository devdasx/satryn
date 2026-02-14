/**
 * SignatureResultCard — Displays the signature output with copy/share/bundle/verify actions.
 * Used in the Sign Message screen after successful signing.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { SettingsCard, MonoSelectableText, SectionLabel } from '../ui';

interface SignatureResultCardProps {
  signature: string;
  address: string;
  message: string;
  onCopy: () => void;
  onShare: () => void;
  onCopyBundle: () => void;
  onVerify: () => void;
}

export function SignatureResultCard({
  signature,
  address,
  message,
  onCopy,
  onShare,
  onCopyBundle,
  onVerify,
}: SignatureResultCardProps) {
  const { isDark } = useTheme();

  const actionBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
  const actionText = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';
  const verifyColor = '#30D158';

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <SectionLabel text="Signature (Base64)" />
      <SettingsCard>
        <MonoSelectableText text={signature} />
        <View style={styles.actions}>
          <ActionButton
            icon="copy-outline"
            label="Copy"
            color={actionText}
            bg={actionBg}
            onPress={onCopy}
          />
          <ActionButton
            icon="share-outline"
            label="Share"
            color={actionText}
            bg={actionBg}
            onPress={onShare}
          />
          <ActionButton
            icon="document-attach-outline"
            label="Bundle"
            color={actionText}
            bg={actionBg}
            onPress={onCopyBundle}
          />
          <ActionButton
            icon="shield-checkmark-outline"
            label="Verify"
            color={verifyColor}
            bg={actionBg}
            onPress={onVerify}
          />
        </View>
      </SettingsCard>
    </Animated.View>
  );
}

// ─── Action Button ──────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  color,
  bg,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
});
