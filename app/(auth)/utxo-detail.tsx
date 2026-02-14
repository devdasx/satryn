import '../../shim';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, withSequence } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useWalletStore, useUTXOStore, usePriceStore } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import { formatAmount } from '../../src/utils/formatting';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { PriceAPI } from '../../src/services/api/PriceAPI';
import { FORMATTING } from '../../src/constants';
import type { ManagedUTXO } from '../../src/types';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';

export default function UTXODetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ utxoId: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const utxos = useWalletStore(s => s.utxos);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);
  const {
    getManagedUtxo,
    setNote,
    addTag,
    removeTag,
    freezeUtxo,
    unfreezeUtxo,
    lockUtxo,
    unlockUtxo,
    utxoMetadata,
  } = useUTXOStore();

  const [noteInput, setNoteInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [utxo, setUtxo] = useState<ManagedUTXO | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
  const subtleText = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const sectionTitleColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const greenColor = '#30D158';
  const orangeColor = '#FF9500';
  const redColor = '#FF453A';
  const accentPurple = isDark ? '#8E8EF5' : '#5856D6';
  const accentPurpleBg = isDark ? 'rgba(88,86,214,0.15)' : 'rgba(88,86,214,0.08)';

  const heroScale = useSharedValue(1);
  const heroOpacity = useSharedValue(1);
  const buttonScale = useSharedValue(1);

  const heroAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroScale.value }],
    opacity: heroOpacity.value,
  }));

  const buttonsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  useEffect(() => {
    if (params.utxoId) {
      const [txid, vout] = params.utxoId.split(':');
      const baseUtxo = utxos.find(u => u.txid === txid && u.vout === parseInt(vout));
      if (baseUtxo) {
        const managed = getManagedUtxo(baseUtxo);
        setUtxo(managed);
        setNoteInput(managed.note || '');
      }
    }
  }, [params.utxoId, utxos, utxoMetadata]);

  const statusColor = utxo?.isFrozen ? orangeColor : utxo?.isLocked ? redColor : greenColor;
  const statusLabel = utxo?.isFrozen ? 'Frozen' : utxo?.isLocked ? 'Locked' : 'Available';
  const statusBg = utxo?.isFrozen
    ? (isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.08)')
    : utxo?.isLocked
      ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
      : (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.08)');
  const isSpendable = utxo ? !utxo.isFrozen && !utxo.isLocked : false;
  const fiatValue = utxo && price ? (utxo.value / FORMATTING.SATS_PER_BTC) * price : null;

  const triggerStateAnimation = useCallback(() => {
    heroScale.value = withSequence(
      withTiming(0.97, { duration: 120 }),
      withSpring(1, { damping: 12, stiffness: 200 }),
    );
    heroOpacity.value = withSequence(
      withTiming(0.7, { duration: 100 }),
      withTiming(1, { duration: 250 }),
    );
    buttonScale.value = withSequence(
      withTiming(0.95, { duration: 100 }),
      withSpring(1, { damping: 14, stiffness: 180 }),
    );
  }, [heroScale, heroOpacity, buttonScale]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleCopy = useCallback(async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    await haptics.trigger('success');
  }, [haptics]);

  const handleSaveNote = useCallback(async () => {
    if (!utxo) return;
    setNote(utxo.id, noteInput);
    setIsEditingNote(false);
    await haptics.trigger('success');
  }, [utxo, noteInput, setNote, haptics]);

  const handleToggleFreeze = useCallback(async () => {
    if (!utxo) return;

    if (utxo.isFrozen) {
      unfreezeUtxo(utxo.id);
      setUtxo({ ...utxo, isFrozen: false });
      triggerStateAnimation();
      await haptics.trigger('success');
    } else {
      Alert.alert(
        'Freeze this UTXO?',
        'Frozen UTXOs are excluded from automatic coin selection. You can unfreeze later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Freeze',
            onPress: async () => {
              freezeUtxo(utxo.id);
              setUtxo({ ...utxo, isFrozen: true });
              triggerStateAnimation();
              await haptics.trigger('warning');
            },
          },
        ],
      );
    }
  }, [utxo, freezeUtxo, unfreezeUtxo, haptics, triggerStateAnimation]);

  const handleToggleLock = useCallback(async () => {
    if (!utxo) return;

    if (utxo.isLocked) {
      unlockUtxo(utxo.id);
      setUtxo({ ...utxo, isLocked: false });
      triggerStateAnimation();
      await haptics.trigger('success');
    } else {
      Alert.alert(
        'Lock this UTXO?',
        'Locked UTXOs cannot be spent in transactions. You can unlock them later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Lock',
            style: 'destructive',
            onPress: async () => {
              lockUtxo(utxo.id);
              setUtxo({ ...utxo, isLocked: true });
              triggerStateAnimation();
              await haptics.trigger('warning');
            },
          },
        ],
      );
    }
  }, [utxo, lockUtxo, unlockUtxo, haptics, triggerStateAnimation]);

  if (!utxo) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>UTXO Details</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyRings}>
            <View style={[styles.emptyRing3, {
              borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
            }]} />
            <View style={[styles.emptyRing2, {
              borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
            }]} />
            <View style={[styles.emptyIconCircle, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
            }]}>
              <Ionicons name="cube-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
            </View>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>UTXO not found</Text>
          <Text style={[styles.emptySubtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
            This output may have been spent
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}
          activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>UTXO Details</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section - open layout, no card */}
        <Animated.View style={[styles.heroSection, heroAnimatedStyle]}>
          <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
          </View>

          <Text style={[styles.heroAmount, { color: colors.text }]}>
            {formatAmount(utxo.value, 'btc')}
          </Text>

          <Text style={[styles.heroSecondary, { color: subtleText }]}>
            {utxo.value.toLocaleString()} sats
            {fiatValue != null && `  \u00B7  ${PriceAPI.formatPrice(fiatValue, currency)}`}
          </Text>

          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaItem}>
              <Ionicons
                name={utxo.confirmations > 0 ? 'checkmark-done' : 'time-outline'}
                size={13}
                color={utxo.confirmations > 0 ? greenColor : orangeColor}
              />
              <Text style={[styles.heroMetaText, {
                color: utxo.confirmations > 0 ? greenColor : orangeColor,
              }]}>
                {utxo.confirmations > 0 ? `${utxo.confirmations} conf` : 'Pending'}
              </Text>
            </View>
            <View style={[styles.heroMetaDot, { backgroundColor: dividerColor }]} />
            <Text style={[styles.heroMetaText, {
              color: isSpendable ? greenColor : redColor,
            }]}>
              {isSpendable ? 'Spendable' : 'Not spendable'}
            </Text>
          </View>
        </Animated.View>

        {/* Action Buttons - circular icon buttons with label underneath */}
        <Animated.View style={[styles.actionsRow, buttonsAnimatedStyle]}>
          <TouchableOpacity
            style={styles.actionItem}
            onPress={handleToggleFreeze}
            activeOpacity={0.7}
          >
            <View style={[styles.actionCircle, {
              backgroundColor: utxo.isFrozen
                ? (isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.10)')
                : surfaceBg,
            }]}>
              <Ionicons
                name="snow"
                size={22}
                color={utxo.isFrozen ? orangeColor : subtleText}
              />
            </View>
            <Text style={[styles.actionLabel, {
              color: utxo.isFrozen ? orangeColor : subtleText,
            }]}>
              {utxo.isFrozen ? 'Unfreeze' : 'Freeze'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionItem}
            onPress={handleToggleLock}
            activeOpacity={0.7}
          >
            <View style={[styles.actionCircle, {
              backgroundColor: utxo.isLocked
                ? (isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)')
                : surfaceBg,
            }]}>
              <Ionicons
                name={utxo.isLocked ? 'lock-closed' : 'lock-open-outline'}
                size={22}
                color={utxo.isLocked ? redColor : subtleText}
              />
            </View>
            <Text style={[styles.actionLabel, {
              color: utxo.isLocked ? redColor : subtleText,
            }]}>
              {utxo.isLocked ? 'Unlock' : 'Lock'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionItem}
            onPress={() => handleCopy(utxo.txid, 'Transaction ID')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionCircle, { backgroundColor: surfaceBg }]}>
              <Ionicons name="copy-outline" size={22} color={subtleText} />
            </View>
            <Text style={[styles.actionLabel, { color: subtleText }]}>Copy ID</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionItem}
            onPress={() => handleCopy(utxo.address, 'Address')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionCircle, { backgroundColor: surfaceBg }]}>
              <Ionicons name="wallet-outline" size={22} color={subtleText} />
            </View>
            <Text style={[styles.actionLabel, { color: subtleText }]}>Address</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Note Section */}
        <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>NOTE</Text>
        {isEditingNote || !utxo.note ? (
          <View>
            <PremiumInputCard>
              <PremiumInput
                icon="create-outline"
                iconColor="#FF9F0A"
                placeholder="Add a note (e.g., source, purpose)..."
                value={noteInput}
                onChangeText={setNoteInput}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus={isEditingNote}
              />
            </PremiumInputCard>
            <View style={styles.noteActions}>
              {isEditingNote && (
                <TouchableOpacity
                  style={[styles.noteSecondaryBtn, { backgroundColor: chipBg }]}
                  onPress={() => {
                    setNoteInput(utxo.note || '');
                    setIsEditingNote(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.noteSecondaryText, { color: subtleText }]}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.notePrimaryBtn, {
                  backgroundColor: isDark ? '#FFFFFF' : '#0A0A0A',
                }]}
                onPress={handleSaveNote}
                activeOpacity={0.7}
              >
                <Text style={[styles.notePrimaryText, {
                  color: isDark ? '#000000' : '#FFFFFF',
                }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            <TouchableOpacity
              onPress={() => setIsEditingNote(true)}
              activeOpacity={0.7}
              style={styles.noteDisplayRow}
            >
              <Text style={[styles.noteDisplay, { color: colors.text }]} numberOfLines={4}>{utxo.note}</Text>
              <Ionicons name="pencil-outline" size={16} color={mutedText} />
            </TouchableOpacity>
          </View>
        )}

        {/* Tags Section */}
        <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>TAGS</Text>
        <View style={[styles.card, { backgroundColor: surfaceBg }]}>
          {(utxo.tags && utxo.tags.length > 0) && (
            <View style={[styles.tagsWrap, { marginBottom: 14 }]}>
              {utxo.tags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagChip, { backgroundColor: accentPurpleBg }]}
                  onPress={() => {
                    removeTag(utxo.id, tag);
                    haptics.trigger('selection');
                    const base = utxos.find(u => `${u.txid}:${u.vout}` === utxo.id);
                    if (base) setTimeout(() => setUtxo(getManagedUtxo(base)), 50);
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.tagChipText, { color: accentPurple }]}>{tag}</Text>
                  <Ionicons name="close" size={12} color={mutedText} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <PremiumInputCard>
            <PremiumInput
              icon="pricetag-outline"
              iconColor="#BF5AF2"
              placeholder="Add tag..."
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={() => {
                if (tagInput.trim()) {
                  addTag(utxo.id, tagInput);
                  setTagInput('');
                  haptics.trigger('selection');
                  const base = utxos.find(u => `${u.txid}:${u.vout}` === utxo.id);
                  if (base) setTimeout(() => setUtxo(getManagedUtxo(base)), 50);
                }
              }}
              returnKeyType="done"
            />
          </PremiumInputCard>

          <View style={[styles.tagsWrap, { marginTop: 12 }]}>
            {['kyc', 'no-kyc', 'exchange', 'income', 'mining', 'donation', 'change'].map(preset => {
              const isActive = utxo.tags?.includes(preset);
              return (
                <TouchableOpacity
                  key={preset}
                  style={[styles.tagChip, {
                    backgroundColor: isActive ? (isDark ? 'rgba(88,86,214,0.2)' : 'rgba(88,86,214,0.1)') : chipBg,
                    opacity: isActive ? 0.5 : 1,
                  }]}
                  onPress={() => {
                    if (!isActive) {
                      addTag(utxo.id, preset);
                      haptics.trigger('selection');
                      const base = utxos.find(u => `${u.txid}:${u.vout}` === utxo.id);
                      if (base) setTimeout(() => setUtxo(getManagedUtxo(base)), 50);
                    }
                  }}
                  disabled={isActive}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.tagChipText, {
                    color: isActive ? accentPurple : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'),
                  }]}>{preset}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Details Section */}
        <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>DETAILS</Text>
        <View style={[styles.card, { backgroundColor: surfaceBg }]}>
          <TouchableOpacity
            style={styles.detailRow}
            onPress={() => handleCopy(utxo.txid, 'Transaction ID')}
            activeOpacity={0.7}
          >
            <Text style={[styles.detailLabel, { color: mutedText }]}>Transaction ID</Text>
            <View style={styles.detailValueRow}>
              <Text style={[styles.detailValueMono, { color: colors.text }]} numberOfLines={1}>
                {utxo.txid.substring(0, 16)}...{utxo.txid.substring(utxo.txid.length - 8)}
              </Text>
              <Ionicons name="copy-outline" size={14} color={mutedText} />
            </View>
          </TouchableOpacity>

          <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: mutedText }]}>Output Index</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{utxo.vout}</Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

          <TouchableOpacity
            style={styles.detailRow}
            onPress={() => handleCopy(utxo.address, 'Address')}
            activeOpacity={0.7}
          >
            <Text style={[styles.detailLabel, { color: mutedText }]}>Address</Text>
            <View style={styles.detailValueRow}>
              <Text style={[styles.detailValueMono, { color: colors.text }]} numberOfLines={1}>
                {utxo.address.substring(0, 12)}...{utxo.address.substring(utxo.address.length - 6)}
              </Text>
              <Ionicons name="copy-outline" size={14} color={mutedText} />
            </View>
          </TouchableOpacity>

          <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: mutedText }]}>Confirmations</Text>
            <Text style={[styles.detailValue, {
              color: utxo.confirmations > 0 ? greenColor : orangeColor,
            }]}>
              {utxo.confirmations > 0 ? utxo.confirmations : 'Pending'}
            </Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: mutedText }]}>Value</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {formatAmount(utxo.value, denomination)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRings: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  emptyRing3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  emptyRing2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 24,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  heroSection: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 28,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
    marginBottom: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  heroAmount: {
    fontSize: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    marginBottom: 6,
  },
  heroSecondary: {
    fontSize: 16,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
    marginBottom: 18,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  heroMetaText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 8,
  },
  actionItem: {
    alignItems: 'center',
    gap: 8,
  },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 2,
  },

  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  noteSecondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  noteSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  notePrimaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 20,
  },
  notePrimaryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noteDisplayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  noteDisplay: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },

  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '600',
  },

  detailRow: {
    paddingVertical: 14,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginBottom: 5,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  detailValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailValueMono: {
    fontSize: 14,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
  },
});
