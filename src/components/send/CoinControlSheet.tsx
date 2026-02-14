/**
 * CoinControlSheet — Bottom sheet listing UTXOs with checkboxes.
 * Loads UTXOs from the database via walletStore/utxoStore and allows
 * manual coin selection for privacy-conscious users.
 *
 * Features:
 *  - Select All / Deselect All buttons
 *  - Auto Select mode (let wallet choose)
 *  - Frozen / Locked status badges
 *  - Confirmation count
 *  - Empty-state when no UTXOs
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { AppButton } from '../ui/AppButton';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWalletStore } from '../../stores/walletStore';
import { useUTXOStore } from '../../stores/utxoStore';
import { WalletDatabase } from '../../services/database';
import { formatUnitAmount } from '../../utils/formatting';
import type { UTXO, ManagedUTXO } from '../../types';

interface CoinControlSheetProps {
  visible: boolean;
  onClose: () => void;
  utxos: UTXO[];
  selectedUtxos: UTXO[] | null;
  onApply: (selected: UTXO[] | null) => void;
}

export function CoinControlSheet({
  visible,
  onClose,
  utxos: propUtxos,
  selectedUtxos,
  onApply,
}: CoinControlSheetProps) {
  const { isDark, colors } = useTheme();
  const { denomination } = useSettingsStore();
  const { getManagedUtxo, utxoMetadata } = useUTXOStore();

  const storeUtxos = useWalletStore((s) => s.utxos);
  const walletId = useWalletStore((s) => s.walletId);
  const [isLoadingUtxos, setIsLoadingUtxos] = useState(false);
  const [dbUtxos, setDbUtxos] = useState<UTXO[]>([]);

  // Load UTXOs directly from DB when sheet opens — most reliable source
  useEffect(() => {
    if (!visible) return;

    // Ensure UTXO metadata is initialized
    useUTXOStore.getState().initFromDb();

    setIsLoadingUtxos(true);

    // Read directly from SQLite — same approach as utxo-management screen
    try {
      if (walletId) {
        const db = WalletDatabase.shared();
        const rows = db.getUtxos(walletId);
        const utxos: UTXO[] = rows.map(u => ({
          txid: u.txid,
          vout: u.vout,
          value: u.valueSat,
          address: u.address,
          scriptPubKey: u.scriptPubKey,
          confirmations: u.confirmations,
        }));
        if (utxos.length > 0) {
          setDbUtxos(utxos);
          // Also update the store so other components benefit
          useWalletStore.setState({ utxos });
        }
      }
    } catch {
      // DB read error — fall through to store UTXOs
    }
    setIsLoadingUtxos(false);
  }, [visible, walletId]);

  // Use DB-fetched first, then prop UTXOs, then store fallback
  const rawUtxos = dbUtxos.length > 0 ? dbUtxos : propUtxos.length > 0 ? propUtxos : storeUtxos;

  // Enrich with metadata from utxoStore
  const managedUtxos = useMemo(() => {
    return rawUtxos.map((u) => getManagedUtxo(u));
  }, [rawUtxos, getManagedUtxo, utxoMetadata]);

  const [selected, setSelected] = useState<Set<string>>(
    new Set(selectedUtxos?.map((u) => `${u.txid}:${u.vout}`) ?? [])
  );

  // Reset selection when sheet opens with new props
  useEffect(() => {
    if (visible) {
      setSelected(new Set(selectedUtxos?.map((u) => `${u.txid}:${u.vout}`) ?? []));
    }
  }, [visible]);

  const toggleUtxo = useCallback((utxo: ManagedUTXO) => {
    // Don't allow selecting frozen/locked UTXOs
    if (utxo.isFrozen || utxo.isLocked) return;

    const key = `${utxo.txid}:${utxo.vout}`;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const spendableUtxos = useMemo(() => {
    return managedUtxos.filter((u) => !u.isFrozen && !u.isLocked);
  }, [managedUtxos]);

  const selectedTotal = useMemo(() => {
    return managedUtxos
      .filter((u) => selected.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.value, 0);
  }, [managedUtxos, selected]);

  const handleApply = () => {
    if (selected.size === 0) {
      onApply(null); // auto mode
    } else {
      const selectedList = rawUtxos.filter((u) => selected.has(`${u.txid}:${u.vout}`));
      onApply(selectedList);
    }
    onClose();
  };

  const handleAutoSelect = () => {
    setSelected(new Set());
  };

  const handleSelectAll = () => {
    const allSpendable = new Set(
      spendableUtxos.map((u) => `${u.txid}:${u.vout}`)
    );
    setSelected(allSpendable);
  };

  const handleDeselectAll = () => {
    setSelected(new Set());
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Coin Control"
      sizing="large"
      scrollable
    >
      <View style={styles.content}>
        {/* Action bar: Auto / Select All / Deselect All */}
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              selected.size === 0 && { backgroundColor: colors.fillSecondary },
            ]}
            onPress={handleAutoSelect}
          >
            <Text style={[
              styles.actionText,
              { color: selected.size === 0 ? colors.text : colors.textTertiary },
            ]}>
              Auto
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleSelectAll}
            disabled={spendableUtxos.length === 0}
          >
            <Text style={[
              styles.actionText,
              { color: spendableUtxos.length > 0 ? THEME.brand.bitcoin : colors.textMuted },
            ]}>
              Select All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleDeselectAll}
            disabled={selected.size === 0}
          >
            <Text style={[
              styles.actionText,
              { color: selected.size > 0 ? colors.textSecondary : colors.textMuted },
            ]}>
              Deselect All
            </Text>
          </TouchableOpacity>
        </View>

        {/* Selection info */}
        <Text style={[styles.selectedInfo, { color: colors.textMuted }]}>
          {selected.size > 0
            ? `${selected.size} selected \u2022 ${formatUnitAmount(selectedTotal, denomination)}`
            : `${managedUtxos.length} UTXOs available`
          }
        </Text>

        {/* UTXO list */}
        {isLoadingUtxos ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={THEME.brand.bitcoin} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
              Loading UTXOs...
            </Text>
          </View>
        ) : managedUtxos.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="layers-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
              No UTXOs Available
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              Your wallet has no spendable outputs. Receive some bitcoin first.
            </Text>
          </View>
        ) : (
          <>
            {managedUtxos.map((item) => {
              const key = `${item.txid}:${item.vout}`;
              const isChecked = selected.has(key);
              const isDisabled = item.isFrozen || item.isLocked;
              const truncatedTxid = `${item.txid.slice(0, 8)}...${item.txid.slice(-6)}:${item.vout}`;

              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.utxoRow,
                    {
                      backgroundColor: isChecked
                        ? colors.fillSecondary
                        : 'transparent',
                      opacity: isDisabled ? 0.5 : 1,
                    },
                  ]}
                  onPress={() => toggleUtxo(item)}
                  activeOpacity={isDisabled ? 1 : 0.7}
                  disabled={isDisabled}
                >
                  <Ionicons
                    name={isChecked ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isDisabled ? colors.textMuted : isChecked ? THEME.brand.bitcoin : colors.textMuted}
                  />
                  <View style={styles.utxoContent}>
                    <View style={styles.utxoTopRow}>
                      <Text style={[styles.utxoAmount, { color: colors.text }]}>
                        {formatUnitAmount(item.value, denomination)}
                      </Text>
                      {/* Status badges */}
                      {item.isFrozen && (
                        <View style={[styles.badge, { backgroundColor: 'rgba(0,122,255,0.15)' }]}>
                          <Ionicons name="snow" size={10} color="#007AFF" />
                          <Text style={[styles.badgeText, { color: '#007AFF' }]}>Frozen</Text>
                        </View>
                      )}
                      {item.isLocked && (
                        <View style={[styles.badge, { backgroundColor: 'rgba(255,69,58,0.15)' }]}>
                          <Ionicons name="lock-closed" size={10} color="#FF453A" />
                          <Text style={[styles.badgeText, { color: '#FF453A' }]}>Locked</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.utxoBottomRow}>
                      <Text style={[styles.utxoTxid, { color: colors.textMuted }]} numberOfLines={1}>
                        {truncatedTxid}
                      </Text>
                      {item.confirmations !== undefined && (
                        <Text style={[styles.confirmations, { color: colors.textTertiary }]}>
                          {item.confirmations === 0 ? 'unconfirmed' : `${item.confirmations} conf`}
                        </Text>
                      )}
                    </View>
                    {item.note ? (
                      <Text style={[styles.noteText, { color: colors.textTertiary }]} numberOfLines={1}>
                        {item.note}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Apply button */}
        <AppButton
          title={selected.size === 0 ? 'Use Auto Selection' : `Use ${selected.size} Selected`}
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
    gap: 4,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  selectedInfo: {
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  utxoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 10,
    marginBottom: 2,
  },
  utxoContent: {
    flex: 1,
    gap: 3,
  },
  utxoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  utxoBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  utxoAmount: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  utxoTxid: {
    fontSize: 11,
    flex: 1,
  },
  confirmations: {
    fontSize: 11,
    marginLeft: 8,
  },
  noteText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
