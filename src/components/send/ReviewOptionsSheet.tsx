/**
 * ReviewOptionsSheet — Bottom sheet with fee selector, RBF toggle, and memo input.
 * Opened from the "Options" pill on the review screen.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { FeeSelector } from './FeeSelector';
import { FeeSelectorSheet } from './FeeSelectorSheet';
import { FastSwitch } from '../ui/FastSwitch';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { useTheme } from '../../hooks';
import { useSendStore } from '../../stores/sendStore';
import { THEME } from '../../constants';

interface ReviewOptionsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ReviewOptionsSheet({ visible, onClose }: ReviewOptionsSheetProps) {
  const { colors } = useTheme();

  const feeOption = useSendStore(s => s.feeOption);
  const feeRate = useSendStore(s => s.feeRate);
  const feeEstimates = useSendStore(s => s.feeEstimates);
  const enableRBF = useSendStore(s => s.enableRBF);
  const memo = useSendStore(s => s.memo);
  const setFeeOption = useSendStore(s => s.setFeeOption);
  const setCustomFeeRate = useSendStore(s => s.setCustomFeeRate);
  const toggleRBF = useSendStore(s => s.toggleRBF);
  const setMemo = useSendStore(s => s.setMemo);

  const [showCustomFee, setShowCustomFee] = useState(false);

  const handleMemoChange = useCallback((text: string) => {
    setMemo(text);
  }, [setMemo]);

  return (
    <>
      <AppBottomSheet
        visible={visible}
        onClose={onClose}
        title="Options"
        sizing="auto"
      >
        <View style={styles.content}>
          {/* Fee selector */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
              NETWORK FEE
            </Text>
            <FeeSelector
              selected={feeOption}
              feeRate={feeRate}
              estimates={feeEstimates}
              onSelect={setFeeOption}
              onCustomPress={() => setShowCustomFee(true)}
            />
          </View>

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
              onValueChange={toggleRBF}
              accentColor={THEME.brand.bitcoin}
            />
          </View>

          {/* Memo */}
          <PremiumInputCard label="MEMO (OPTIONAL)">
            <PremiumInput
              icon="create-outline"
              iconColor="#8E8E93"
              placeholder="Add a note"
              value={memo}
              onChangeText={handleMemoChange}
              returnKeyType="done"
            />
          </PremiumInputCard>
        </View>
      </AppBottomSheet>

      {/* Nested custom fee sheet */}
      <FeeSelectorSheet
        visible={showCustomFee}
        onClose={() => setShowCustomFee(false)}
        currentRate={feeRate}
        enableRBF={enableRBF}
        onApply={(rate) => setCustomFeeRate(rate)}
        onToggleRBF={toggleRBF}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
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
