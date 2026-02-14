/**
 * HelpSheet — Premium Wallet Types reference sheet
 *
 * Redesigned with a modern card-based layout, colored accent icons,
 * and tight padding for a polished, premium feel.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme } from '../../hooks';

export interface HelpSheetProps {
  visible: boolean;
  onClose: () => void;
}

const WALLET_TYPES = [
  {
    icon: 'key-outline' as const,
    label: 'HD Wallet',
    description: 'Full-featured wallet with seed phrase backup',
    accentColors: ['#FF9F0A', '#FF6B00'] as [string, string],
  },
  {
    icon: 'shield-checkmark-outline' as const,
    label: 'Multisig Wallet',
    description: 'Multiple keys required to spend funds',
    accentColors: ['#30D158', '#0AB24E'] as [string, string],
  },
  {
    icon: 'eye-outline' as const,
    label: 'Watch-Only',
    description: 'Track funds without private keys',
    accentColors: ['#64D2FF', '#0A84FF'] as [string, string],
  },
  {
    icon: 'document-text-outline' as const,
    label: 'Seed Import',
    description: 'Restore with 12 or 24-word phrase',
    accentColors: ['#BF5AF2', '#9747FF'] as [string, string],
  },
  {
    icon: 'cloud-download-outline' as const,
    label: 'iCloud Restore',
    description: 'Restore encrypted backup from iCloud',
    accentColors: ['#FF375F', '#FF2D55'] as [string, string],
  },
];

export function HelpSheet({ visible, onClose }: HelpSheetProps) {
  const { colors, isDark } = useTheme();

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Wallet Types"
      sizing="auto"
    >
      <View style={styles.container}>
        {WALLET_TYPES.map((type) => (
          <View
            key={type.label}
            style={[
              styles.card,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : 'rgba(0,0,0,0.025)',
                borderColor: isDark
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(0,0,0,0.04)',
              },
            ]}
          >
            <LinearGradient
              colors={isDark
                ? [`${type.accentColors[0]}18`, `${type.accentColors[1]}08`]
                : [`${type.accentColors[0]}12`, `${type.accentColors[1]}06`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconGradient}
            >
              <Ionicons
                name={type.icon}
                size={18}
                color={type.accentColors[0]}
              />
            </LinearGradient>
            <View style={styles.cardContent}>
              <Text
                style={[
                  styles.cardLabel,
                  { color: colors.text },
                ]}
                numberOfLines={1}
              >
                {type.label}
              </Text>
              <Text
                style={[
                  styles.cardDescription,
                  {
                    color: isDark
                      ? 'rgba(255,255,255,0.45)'
                      : 'rgba(0,0,0,0.45)',
                  },
                ]}
                numberOfLines={1}
              >
                {type.description}
              </Text>
            </View>
          </View>
        ))}

        {/* Footer */}
        <View style={styles.footer}>
          <Ionicons
            name="lock-closed"
            size={12}
            color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'}
          />
          <Text
            style={[
              styles.footerText,
              {
                color: isDark
                  ? 'rgba(255,255,255,0.20)'
                  : 'rgba(0,0,0,0.20)',
              },
            ]}
          >
            Your keys never leave this device
          </Text>
        </View>
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  iconGradient: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  cardDescription: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: -0.1,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 8,
    paddingBottom: 4,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
});
