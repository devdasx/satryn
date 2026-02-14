import React, { useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import type { DerivationPathConfig, DerivationPathPreset } from '../../services/import/types';
import { getSecureInputProps } from '../../services/import/security';
import { isValidDerivationPath, buildDerivationPathString } from '../../services/import/parsers/extendedKey';

interface DerivationPathSelectorProps {
  isDark: boolean;
  config: DerivationPathConfig;
  onConfigChange: (config: DerivationPathConfig) => void;
}

const PRESETS: {
  key: DerivationPathPreset;
  label: string;
  description: string;
  badge?: string;
}[] = [
  { key: 'hd', label: 'HD', description: 'All Paths', badge: 'Recommended' },
  { key: 'bip32', label: 'BIP32', description: 'Raw (0/index)' },
  { key: 'bip44', label: 'BIP44', description: 'Legacy' },
  { key: 'bip49', label: 'BIP49', description: 'Wrapped SegWit' },
  { key: 'bip84', label: 'BIP84', description: 'Native SegWit' },
  { key: 'bip86', label: 'BIP86', description: 'Taproot' },
  { key: 'custom', label: 'Custom', description: 'Enter path' },
];

export function DerivationPathSelector({
  isDark,
  config,
  onConfigChange,
}: DerivationPathSelectorProps) {
  const secureProps = getSecureInputProps();

  // Show account index for BIP44/49/84/86 presets (not for HD which derives all)
  const showAccountIndex = ['bip44', 'bip49', 'bip84', 'bip86'].includes(config.preset);
  const showCustomInput = config.preset === 'custom';
  const isHDPreset = config.preset === 'hd';

  // Build path preview string
  const pathPreview = useMemo(() => {
    if (config.preset === 'hd') {
      return 'All standard paths (BIP44/49/84/86)';
    }
    if (config.preset === 'custom') {
      return config.customPath || 'm/...';
    }
    return buildDerivationPathString(config);
  }, [config]);

  // Custom path validation
  const isCustomPathValid = config.preset !== 'custom' ||
    (config.customPath ? isValidDerivationPath(config.customPath) : false);

  const handlePresetChange = (preset: DerivationPathPreset) => {
    onConfigChange({
      ...config,
      preset,
      // Reset custom path if switching away from custom
      customPath: preset === 'custom' ? (config.customPath || "m/84'/0'/0'/0/0") : config.customPath,
    });
  };

  const handleAccountIndexChange = (delta: number) => {
    const newIndex = Math.max(0, Math.min(100, config.accountIndex + delta));
    onConfigChange({ ...config, accountIndex: newIndex });
  };

  const handleCustomPathChange = (path: string) => {
    onConfigChange({ ...config, customPath: path });
  };

  return (
    <View style={styles.container}>
      {/* Section label */}
      <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
        Derivation Path
      </Text>

      {/* Preset grid (3x2 + HD at top) */}
      <View style={styles.presetGrid}>
        {PRESETS.map((preset) => {
          const isSelected = config.preset === preset.key;
          const hasBadge = !!preset.badge;
          return (
            <TouchableOpacity
              key={preset.key}
              style={[
                styles.presetButton,
                hasBadge && styles.presetButtonWide,
                {
                  backgroundColor: isSelected
                    ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                    : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                  borderColor: isSelected
                    ? (hasBadge ? 'rgba(48,209,88,0.4)' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'))
                    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                },
              ]}
              onPress={() => handlePresetChange(preset.key)}
              activeOpacity={0.7}
            >
              <View style={styles.presetContent}>
                <Text style={[
                  styles.presetLabel,
                  {
                    color: isSelected
                      ? (isDark ? '#FFFFFF' : '#000000')
                      : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'),
                    fontWeight: isSelected ? '600' : '400',
                  },
                ]}>
                  {preset.label}
                </Text>
                <Text style={[
                  styles.presetDescription,
                  {
                    color: isSelected
                      ? (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')
                      : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'),
                  },
                ]}>
                  {preset.description}
                </Text>
              </View>
              {hasBadge && (
                <View style={styles.presetBadge}>
                  <Text style={styles.presetBadgeText}>{preset.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Account index stepper (for BIP44/49/84/86) */}
      {showAccountIndex && (
        <View style={[styles.accountRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
          <Text style={[styles.accountLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
            Account Index
          </Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[
                styles.stepperButton,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  opacity: config.accountIndex <= 0 ? 0.3 : 1,
                },
              ]}
              onPress={() => handleAccountIndexChange(-1)}
              disabled={config.accountIndex <= 0}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={18} color={isDark ? '#FFFFFF' : '#000000'} />
            </TouchableOpacity>
            <Text style={[
              styles.stepperValue,
              {
                color: isDark ? '#FFFFFF' : '#000000',
              },
            ]}>
              {config.accountIndex}
            </Text>
            <TouchableOpacity
              style={[
                styles.stepperButton,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  opacity: config.accountIndex >= 100 ? 0.3 : 1,
                },
              ]}
              onPress={() => handleAccountIndexChange(1)}
              disabled={config.accountIndex >= 100}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={18} color={isDark ? '#FFFFFF' : '#000000'} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Custom path input */}
      {showCustomInput && (
        <View style={styles.customPathContainer}>
          <PremiumInputCard>
            <PremiumInput
              icon="git-branch"
              iconColor="#8E8E93"
              monospace
              value={config.customPath || ''}
              onChangeText={handleCustomPathChange}
              placeholder="m/84'/0'/0'/0/0"
              placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
              {...secureProps}
            />
          </PremiumInputCard>
          {config.customPath && !isCustomPathValid && (
            <Text style={styles.customPathError}>
              Invalid path. Use format: m/purpose'/coin'/account'/chain/index
            </Text>
          )}
        </View>
      )}

      {/* Path preview */}
      <View style={[styles.pathPreview, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
        <Text style={[styles.pathPreviewLabel, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
          Full path
        </Text>
        <Text style={[
          styles.pathPreviewValue,
          {
            color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
          },
        ]}>
          {pathPreview}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetButton: {
    width: '31%',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  presetButtonWide: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  presetContent: {
    alignItems: 'center',
    gap: 2,
  },
  presetLabel: {
    fontSize: 14,
  },
  presetDescription: {
    fontSize: 10,
  },
  presetBadge: {
    backgroundColor: 'rgba(48,209,88,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  presetBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#30D158',
    letterSpacing: 0.2,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  accountLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 28,
    textAlign: 'center',
  },
  customPathContainer: {
    gap: 6,
  },
  customPathInput: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  customPathError: {
    fontSize: 12,
    color: '#FF453A',
    fontWeight: '500',
  },
  pathPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pathPreviewLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  pathPreviewValue: {
    fontSize: 13,
    fontWeight: '500',
  },
});
