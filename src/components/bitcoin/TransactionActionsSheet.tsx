import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTransactionLabelStore } from '../../stores';
import { useSettingsStore } from '../../stores';
import { formatUnitAmount } from '../../utils/formatting';
import type { DetailedTransactionInfo } from '../../types';

interface TransactionActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  transaction: DetailedTransactionInfo | null;
  isDark: boolean;
}

export function TransactionActionsSheet({
  visible,
  onClose,
  transaction,
  isDark,
}: TransactionActionsSheetProps) {
  const network = useSettingsStore((s) => s.network);
  const denomination = useSettingsStore((s) => s.denomination);
  const { labels, updateNote } = useTransactionLabelStore();
  const [noteInput, setNoteInput] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const existingNote = transaction ? labels[transaction.txid]?.note : undefined;

  const colors = useMemo(() => ({
    bg: isDark ? '#1C1C1E' : '#FFFFFF',
    text: isDark ? '#FFFFFF' : '#000000',
    textSecondary: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)',
    rowBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    rowPressedBg: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    accent: '#007AFF',
    inputBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  }), [isDark]);

  const handleCopy = useCallback(async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  }, [onClose]);

  const handleViewOnMempool = useCallback(() => {
    if (!transaction) return;
    const baseUrl = network === 'testnet'
      ? 'https://mempool.space/testnet/tx/'
      : 'https://mempool.space/tx/';
    Linking.openURL(`${baseUrl}${transaction.txid}`);
    onClose();
  }, [transaction, network, onClose]);

  const handleAddNote = useCallback(() => {
    setNoteInput(existingNote || '');
    setShowNoteInput(true);
  }, [existingNote]);

  const handleSaveNote = useCallback(() => {
    if (!transaction) return;
    updateNote(transaction.txid, noteInput.trim());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowNoteInput(false);
    onClose();
  }, [transaction, noteInput, updateNote, onClose]);

  const handleSheetClose = useCallback(() => {
    setShowNoteInput(false);
    setNoteInput('');
    onClose();
  }, [onClose]);

  if (!transaction) return null;

  const totalAmount = Math.abs(transaction.balanceDiff);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={handleSheetClose}
      title="Transaction Actions"
      sizing="auto"
    >
      <View style={styles.content}>
        {showNoteInput ? (
          <View style={styles.noteSection}>
            <Text style={[styles.noteLabel, { color: colors.text }]}>
              {existingNote ? 'Edit Note' : 'Add Note'}
            </Text>
            <TextInput
              style={[
                styles.noteInput,
                {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={noteInput}
              onChangeText={setNoteInput}
              placeholder="Enter a note for this transaction..."
              placeholderTextColor={colors.textSecondary}
              multiline
              autoFocus
              maxLength={200}
            />
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleSaveNote}
            >
              <Text style={styles.saveButtonText}>Save Note</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ActionRow
              icon="create-outline"
              label={existingNote ? 'Edit Note' : 'Add Note'}
              sublabel={existingNote}
              onPress={handleAddNote}
              colors={colors}
            />
            <ActionRow
              icon="cash-outline"
              label="Copy Amount"
              sublabel={formatUnitAmount(totalAmount, denomination)}
              onPress={() => handleCopy(totalAmount.toString(), 'Amount')}
              colors={colors}
            />
            <ActionRow
              icon="copy-outline"
              label="Copy TXID"
              sublabel={`${transaction.txid.slice(0, 12)}...${transaction.txid.slice(-12)}`}
              onPress={() => handleCopy(transaction.txid, 'TXID')}
              colors={colors}
            />
            <ActionRow
              icon="globe-outline"
              label="View on Mempool"
              sublabel="mempool.space"
              onPress={handleViewOnMempool}
              colors={colors}
            />
            {transaction.rawHex && (
              <ActionRow
                icon="code-slash-outline"
                label="Copy Raw Hex"
                onPress={() => handleCopy(transaction.rawHex!, 'Raw Hex')}
                colors={colors}
              />
            )}
          </>
        )}
      </View>
    </AppBottomSheet>
  );
}

function ActionRow({
  icon,
  label,
  sublabel,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress: () => void;
  colors: Record<string, string>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionRow,
        {
          backgroundColor: pressed ? colors.rowPressedBg : colors.rowBg,
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.actionTextContainer}>
        <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
        {sublabel && (
          <Text style={[styles.actionSublabel, { color: colors.textSecondary }]} numberOfLines={1}>
            {sublabel}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 6,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  actionSublabel: {
    fontSize: 13,
    marginTop: 2,
  },
  noteSection: {
    paddingVertical: 8,
  },
  noteLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  noteInput: {
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  saveButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
