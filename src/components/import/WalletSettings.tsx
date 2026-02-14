import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import { getSecureInputProps } from '../../services/import/security';

interface WalletSettingsProps {
  walletName: string;
  onNameChange: (name: string) => void;
  scriptType: AddressType;
  onScriptTypeChange: (type: AddressType) => void;
  isDark: boolean;
  showScriptType?: boolean;
  /** Script types that should be greyed out and non-selectable */
  disabledScriptTypes?: AddressType[];
  /** Explanation shown below the grid when some types are disabled */
  disabledReason?: string;
}

const SCRIPT_TYPE_OPTIONS: { type: AddressType; label: string; prefix: string }[] = [
  { type: ADDRESS_TYPES.NATIVE_SEGWIT, label: 'Native SegWit', prefix: 'bc1q...' },
  { type: ADDRESS_TYPES.TAPROOT, label: 'Taproot', prefix: 'bc1p...' },
  { type: ADDRESS_TYPES.WRAPPED_SEGWIT, label: 'Wrapped SegWit', prefix: '3...' },
  { type: ADDRESS_TYPES.LEGACY, label: 'Legacy', prefix: '1...' },
];

export function WalletSettings({
  walletName,
  onNameChange,
  scriptType,
  onScriptTypeChange,
  isDark,
  showScriptType = true,
  disabledScriptTypes,
  disabledReason,
}: WalletSettingsProps) {
  return (
    <View style={styles.container}>
      {/* Wallet Name */}
      <View style={styles.field}>
        <Text style={[styles.label, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
          Wallet Name
        </Text>
        <PremiumInputCard>
          <PremiumInput
            icon="pencil"
            iconColor="#007AFF"
            value={walletName}
            onChangeText={onNameChange}
            placeholder="My Wallet"
            placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
            {...getSecureInputProps()}
            maxLength={30}
          />
        </PremiumInputCard>
      </View>

      {/* Script Type */}
      {showScriptType && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
            Address Format
          </Text>
          <View style={styles.scriptTypeGrid}>
            {SCRIPT_TYPE_OPTIONS.map((option) => {
              const isSelected = option.type === scriptType;
              const isDisabled = disabledScriptTypes?.includes(option.type) ?? false;
              return (
                <TouchableOpacity
                  key={option.type}
                  style={[
                    styles.scriptTypeOption,
                    {
                      backgroundColor: isDisabled
                        ? (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)')
                        : isSelected
                          ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                      borderColor: isDisabled
                        ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)')
                        : isSelected
                          ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')
                          : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                      opacity: isDisabled ? 0.4 : 1,
                    },
                  ]}
                  onPress={() => { if (!isDisabled) onScriptTypeChange(option.type); }}
                  activeOpacity={isDisabled ? 1 : 0.7}
                  disabled={isDisabled}
                >
                  <Text style={[
                    styles.scriptTypeLabel,
                    {
                      color: isSelected && !isDisabled
                        ? (isDark ? '#FFFFFF' : '#000000')
                        : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'),
                      fontWeight: isSelected && !isDisabled ? '600' : '400',
                    },
                  ]}>
                    {option.label}
                  </Text>
                  <Text style={[
                    styles.scriptTypePrefix,
                    {
                      color: isSelected && !isDisabled
                        ? (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')
                        : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'),
                    },
                  ]}>
                    {option.prefix}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {disabledReason && disabledScriptTypes && disabledScriptTypes.length > 0 && (
            <Text style={[styles.disabledNote, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }]}>
              {disabledReason}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nameInput: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  scriptTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scriptTypeOption: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  scriptTypeLabel: {
    fontSize: 14,
  },
  scriptTypePrefix: {
    fontSize: 12,
  },
  disabledNote: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
