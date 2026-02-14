import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { truncateAddress } from '../../utils/formatting';
import { useTheme } from '../../hooks/useTheme';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';

interface AddressDisplayProps {
  address: string;
  label?: string;
  showFull?: boolean;
  onCopy?: () => void;
}

export function AddressDisplay({
  address,
  label,
  showFull = false,
  onCopy,
}: AddressDisplayProps) {
  const { colors } = useTheme();
  const { copied, copy } = useCopyFeedback();

  const handleCopy = async () => {
    await copy(address);
    onCopy?.();
  };

  const displayAddress = showFull ? address : truncateAddress(address, 12, 8);

  return (
    <TouchableOpacity style={styles.container} onPress={handleCopy} activeOpacity={0.7}>
      {label && <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>}

      <View style={[styles.addressContainer, { backgroundColor: colors.surface }]}>
        <Text style={[styles.address, { color: colors.text }, showFull && styles.addressFull]} selectable>
          {displayAddress}
        </Text>
        <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={16} color={copied ? '#30D158' : colors.textSecondary} style={styles.copyIcon} />
      </View>

      <Text style={[styles.hint, { color: copied ? '#30D158' : colors.textSecondary }]}>{copied ? 'Copied!' : 'Tap to copy'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 16,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  address: {
    fontSize: 16,
    fontWeight: '500',
  },
  addressFull: {
    fontSize: 14,
    textAlign: 'center',
  },
  copyIcon: {
    marginLeft: 12,
  },
  hint: {
    fontSize: 12,
    marginTop: 8,
  },
});
