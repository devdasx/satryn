/**
 * FeeSelectorSheet — Bottom sheet for custom fee entry + RBF toggle.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { AppButton } from '../ui/AppButton';
import { FastSwitch } from '../ui/FastSwitch';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';

interface FeeSelectorSheetProps {
  visible: boolean;
  onClose: () => void;
  currentRate: number;
  enableRBF: boolean;
  onApply: (feeRate: number) => void;
  onToggleRBF: () => void;
}

export function FeeSelectorSheet({
  visible,
  onClose,
  currentRate,
  enableRBF,
  onApply,
  onToggleRBF,
}: FeeSelectorSheetProps) {
  const { colors } = useTheme();
  const [rateInput, setRateInput] = useState(String(currentRate));

  const handleApply = () => {
    const rate = parseInt(rateInput, 10);
    if (isNaN(rate) || rate < 1) return;
    onApply(rate);
    onClose();
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Custom Fee"
      sizing="auto"
    >
      <View style={styles.content}>
        <PremiumInputCard label="FEE RATE (SAT/VB)">
          <PremiumInput
            icon="speedometer-outline"
            iconColor="#FF9500"
            placeholder="1"
            value={rateInput}
            onChangeText={(text) => setRateInput(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            centered
          />
        </PremiumInputCard>

        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Minimum: 1 sat/vB. Higher fee = faster confirmation.
        </Text>

        {/* RBF toggle */}
        <View style={[styles.rbfRow, { backgroundColor: colors.fillSecondary }]}>
          <View style={styles.rbfContent}>
            <Text style={[styles.rbfLabel, { color: colors.text }]}>
              Replace-By-Fee (RBF)
            </Text>
            <Text style={[styles.rbfDesc, { color: colors.textTertiary }]}>
              Allow fee bumping after broadcast
            </Text>
          </View>
          <FastSwitch
            value={enableRBF}
            onValueChange={onToggleRBF}
            accentColor={THEME.brand.bitcoin}
          />
        </View>

        <AppButton
          title="Apply"
          onPress={handleApply}
          variant="primary"
        />
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 16,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: -8,
  },
  rbfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
  },
  rbfContent: {
    flex: 1,
    gap: 2,
  },
  rbfLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  rbfDesc: {
    fontSize: 13,
  },
});
