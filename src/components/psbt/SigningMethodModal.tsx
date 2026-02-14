import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../../constants';
import { AppBottomSheet } from '../ui';

export type SigningMethod = 'pin' | 'qr' | 'seed' | 'import';

interface SigningMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectMethod: (method: SigningMethod) => void;
  cosignerName: string;
  hasStoredSeed?: boolean;
}

export function SigningMethodModal({
  visible,
  onClose,
  onSelectMethod,
  cosignerName,
  hasStoredSeed = false,
}: SigningMethodModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? THEME.dark : THEME.light;

  // Build options array dynamically based on whether stored seed is available
  const options: Array<{
    method: SigningMethod;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    highlight?: boolean;
  }> = [];

  // Add "Use Stored Seed" option first if available (recommended)
  if (hasStoredSeed) {
    options.push({
      method: 'pin',
      icon: 'lock-closed-outline',
      title: 'Use Stored Seed (Recommended)',
      description: 'Sign with your securely stored seed using PIN',
      highlight: true,
    });
  }

  // Always add these options
  options.push(
    {
      method: 'qr',
      icon: 'qr-code-outline',
      title: 'QR Code (Air-Gapped)',
      description: 'Export PSBT as QR, sign on external device, scan back',
    },
    {
      method: 'seed',
      icon: 'key-outline',
      title: 'Enter Seed Phrase',
      description: 'Type or scan your recovery words to sign',
    },
    {
      method: 'import',
      icon: 'download-outline',
      title: 'Import Signed PSBT',
      description: 'Paste or scan a partially signed transaction',
    },
  );

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Sign Transaction"
      subtitle={`Choose how to sign with ${cosignerName}`}
    >
      {/* Options */}
      <View style={styles.optionsContainer}>
        {options.map((option, index) => (
          <TouchableOpacity
            key={option.method}
            style={[
              styles.option,
              {
                backgroundColor: option.highlight
                  ? THEME.brand.bitcoin + '12'
                  : isDark
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(0,0,0,0.03)',
                borderColor: option.highlight ? THEME.brand.bitcoin + '40' : colors.border,
                borderWidth: option.highlight ? 1.5 : StyleSheet.hairlineWidth,
              },
              index < options.length - 1 && { marginBottom: 12 },
            ]}
            onPress={() => onSelectMethod(option.method)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.optionIcon,
                {
                  backgroundColor: option.highlight
                    ? THEME.brand.bitcoin + '20'
                    : isDark
                      ? 'rgba(255,255,255,0.08)'
                      : 'rgba(0,0,0,0.05)',
                },
              ]}
            >
              <Ionicons name={option.icon} size={24} color={THEME.brand.bitcoin} />
            </View>
            <View style={styles.optionContent}>
              <Text style={[styles.optionTitle, { color: colors.text }]}>
                {option.title}
              </Text>
              <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
                {option.description}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={option.highlight ? THEME.brand.bitcoin : colors.textMuted}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Cancel button - Premium style */}
      <TouchableOpacity
        style={[
          styles.cancelBtn,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          },
        ]}
        onPress={onClose}
        activeOpacity={0.7}
      >
        <Text style={[styles.cancelText, { color: colors.text }]}>Cancel</Text>
      </TouchableOpacity>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  optionsContainer: {
    marginBottom: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  optionDesc: {
    fontSize: 14,
    lineHeight: 19,
  },
  cancelBtn: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    marginBottom: 8,
  },
  cancelText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
