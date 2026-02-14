/**
 * Contact Details Screen
 * Hero, quick actions, insights, addresses, notes, delete.
 * Unified design language: large title, 24px padding, no BlurView, solid surfaces.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useContactStore, useSettingsStore } from '../../src/stores';
import { useTheme, useHaptics, useContactStats, useCopyFeedback } from '../../src/hooks';
import { ContactAvatar, ContactAddressRow } from '../../src/components/contacts';
import { AddEditContactSheet } from '../../src/components/contacts/AddEditContactSheet';
import { RequestFromContactSheet } from '../../src/components/contacts/RequestFromContactSheet';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useWalletStore } from '../../src/stores';
import { isValidBitcoinAddress } from '../../src/utils/validation';
import { THEME } from '../../src/constants';
import { formatUnitAmount, getUnitSymbol } from '../../src/utils/formatting';
import type { ContactAddress } from '../../src/types/contacts';

export default function ContactDetailsScreen() {
  const router = useRouter();
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const { copy } = useCopyFeedback();
  const denomination = useSettingsStore(s => s.denomination);
  const walletAddresses = useWalletStore(s => s.addresses);

  const {
    getContactById,
    toggleFavorite,
    removeContact,
    updateContact,
    removeAddress,
    setDefaultAddress,
    addAddress,
  } = useContactStore();
  const { getStats } = useContactStats();

  const contact = getContactById(contactId || '');
  const stats = contactId ? getStats(contactId) : null;

  const [showEditSheet, setShowEditSheet] = useState(false);
  const [showRequestSheet, setShowRequestSheet] = useState(false);
  const [showFullAddressSheet, setShowFullAddressSheet] = useState(false);
  const [fullAddressText, setFullAddressText] = useState('');
  const [showNoAddressSheet, setShowNoAddressSheet] = useState(false);
  const [showAddAddressSheet, setShowAddAddressSheet] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressLabel, setNewAddressLabel] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const newAddressRef = useRef<TextInput>(null);
  const newLabelRef = useRef<TextInput>(null);

  // Design tokens
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  const unit = getUnitSymbol(denomination);

  const fmtAmount = useCallback(
    (satoshis: number): string => {
      return formatUnitAmount(satoshis, denomination, false);
    },
    [denomination]
  );

  if (!contact) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.notFound}>
          <Text style={{ color: mutedText }}>Contact not found</Text>
        </View>
      </View>
    );
  }

  const defaultAddr = contact.addresses.find((a) => a.isDefault) || contact.addresses[0];

  const handleSend = () => {
    if (!defaultAddr) {
      setShowNoAddressSheet(true);
      return;
    }
    router.push({ pathname: '/(auth)/send', params: { address: defaultAddr.address } });
  };

  const handleRequest = () => {
    setShowRequestSheet(true);
  };

  const handleCopyDefault = async () => {
    if (!defaultAddr) {
      setShowNoAddressSheet(true);
      return;
    }
    await copy(defaultAddr.address);
  };

  const handleToggleFavorite = () => {
    toggleFavorite(contact.id);
    haptics.trigger('selection');
  };

  const handleDelete = () => {
    Alert.alert('Delete Contact', `Remove "${contact.name}" from contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeContact(contact.id);
          haptics.trigger('warning');
          router.back();
        },
      },
    ]);
  };

  const handleCopyAddress = async (addr: ContactAddress) => {
    await copy(addr.address);
  };

  const handleShowFullAddress = (addr: ContactAddress) => {
    setFullAddressText(addr.address);
    setShowFullAddressSheet(true);
  };

  const handleSendToAddress = (addr: ContactAddress) => {
    router.push({ pathname: '/(auth)/send', params: { address: addr.address } });
  };

  const handleSetDefault = (addr: ContactAddress) => {
    setDefaultAddress(contact.id, addr.id);
    haptics.trigger('selection');
  };

  const handleRemoveAddress = (addr: ContactAddress) => {
    Alert.alert(
      'Remove Address',
      `Remove ${addr.address.slice(0, 12)}...?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeAddress(contact.id, addr.id);
            haptics.trigger('warning');
          },
        },
      ]
    );
  };

  const handleAddAddress = () => {
    setNewAddress('');
    setNewAddressLabel('');
    setShowAddAddressSheet(true);
  };

  const handlePasteAddress = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      const cleaned = text.replace(/^bitcoin:/i, '').split('?')[0].trim();
      setNewAddress(cleaned);
      haptics.trigger('light');
    }
  };

  const handleScanAddress = () => {
    router.push('/(auth)/scan');
  };

  const handleSaveNewAddress = () => {
    const trimmed = newAddress.trim();
    if (!trimmed) {
      Alert.alert('Address Required', 'Enter a Bitcoin address.');
      return;
    }
    const { network } = useSettingsStore.getState();
    if (!isValidBitcoinAddress(trimmed, network)) {
      Alert.alert('Invalid Address', 'This is not a valid Bitcoin address for the current network.');
      return;
    }
    addAddress(contact.id, {
      address: trimmed,
      label: newAddressLabel.trim() || undefined,
      isDefault: contact.addresses.length === 0,
    });
    haptics.trigger('success');
    setNewAddress('');
    setNewAddressLabel('');
    setShowAddAddressSheet(false);
  };

  const totalSent = stats?.totalSentSats || 0;
  const totalReceived = stats?.totalReceivedSats || 0;
  const totalTxs = stats ? stats.outgoingTxCount + stats.incomingTxCount : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
        }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back + Edit */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowEditSheet(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="create-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.hero}>
          <ContactAvatar name={contact.name} size="lg" isFavorite={contact.isFavorite} color={contact.color} />
          <Text style={[styles.heroName, { color: colors.text }]}>{contact.name}</Text>
          {contact.tags.length > 0 && (
            <View style={styles.heroTags}>
              {contact.tags.map((tag) => (
                <View
                  key={tag}
                  style={[styles.heroTag, { backgroundColor: mutedBg }]}
                >
                  <Text style={[styles.heroTagText, { color: mutedText }]}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>

        {/* Quick Actions */}
        <Animated.View entering={FadeIn.delay(80).duration(400)} style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: surfaceBg }]}
            onPress={handleSend}
          >
            <Ionicons name="send-outline" size={20} color={colors.text} />
            <Text style={[styles.quickActionLabel, { color: mutedText }]}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: surfaceBg }]}
            onPress={handleRequest}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.text} />
            <Text style={[styles.quickActionLabel, { color: mutedText }]}>Request</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: surfaceBg }]}
            onPress={handleCopyDefault}
          >
            <Ionicons name="copy-outline" size={20} color={colors.text} />
            <Text style={[styles.quickActionLabel, { color: mutedText }]}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: surfaceBg }]}
            onPress={handleToggleFavorite}
          >
            <Ionicons
              name={contact.isFavorite ? 'star' : 'star-outline'}
              size={20}
              color={contact.isFavorite ? '#FFD60A' : colors.text}
            />
            <Text style={[styles.quickActionLabel, { color: mutedText }]}>
              {contact.isFavorite ? 'Unfav' : 'Favorite'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Insights */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>INSIGHTS</Text>
          <View style={styles.insightsGrid}>
            <View style={styles.insightsRow}>
              <View style={[styles.metricBlock, { backgroundColor: surfaceBg }]}>
                <View style={[styles.metricIconCircle, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)' }]}>
                  <Ionicons name="arrow-up" size={14} color="#30D158" />
                </View>
                <Text style={[styles.metricValue, { color: '#30D158' }]}>
                  {fmtAmount(totalSent)}
                </Text>
                <Text style={[styles.metricLabel, { color: mutedText }]}>
                  Sent ({unit})
                </Text>
              </View>
              <View style={[styles.metricBlock, { backgroundColor: surfaceBg }]}>
                <View style={[styles.metricIconCircle, { backgroundColor: mutedBg }]}>
                  <Ionicons name="arrow-down" size={14} color={colors.text} />
                </View>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {fmtAmount(totalReceived)}
                </Text>
                <Text style={[styles.metricLabel, { color: mutedText }]}>
                  Received ({unit})
                </Text>
              </View>
            </View>
            <View style={styles.insightsRow}>
              <View style={[styles.metricBlock, { backgroundColor: surfaceBg }]}>
                <View style={[styles.metricIconCircle, { backgroundColor: mutedBg }]}>
                  <Ionicons name="swap-horizontal" size={14} color={mutedText} />
                </View>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {totalTxs}
                </Text>
                <Text style={[styles.metricLabel, { color: mutedText }]}>
                  Transactions
                </Text>
              </View>
              <View style={[styles.metricBlock, { backgroundColor: surfaceBg }]}>
                <View style={[styles.metricIconCircle, { backgroundColor: mutedBg }]}>
                  <Ionicons name="time-outline" size={14} color={mutedText} />
                </View>
                <Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>
                  {stats?.lastActivityTimestamp
                    ? new Date(stats.lastActivityTimestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : '—'}
                </Text>
                <Text style={[styles.metricLabel, { color: mutedText }]}>
                  Last Activity
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Addresses */}
        <Animated.View entering={FadeIn.delay(240).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>ADDRESSES</Text>
          <View style={styles.addressesContent}>
            {contact.addresses.length > 0 ? (
              contact.addresses.map((addr) => (
                <ContactAddressRow
                  key={addr.id}
                  address={addr}
                  isDefault={addr.isDefault}
                  onCopy={() => handleCopyAddress(addr)}
                  onSend={() => handleSendToAddress(addr)}
                  onSetDefault={() => handleSetDefault(addr)}
                  onRemove={() => handleRemoveAddress(addr)}
                />
              ))
            ) : (
              <Text style={[styles.noAddressText, { color: mutedText }]}>
                No addresses added yet
              </Text>
            )}
            <TouchableOpacity
              style={[styles.addCapsule, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}
              onPress={handleAddAddress}
            >
              <Ionicons name="add" size={14} color={mutedText} />
              <Text style={[styles.addCapsuleText, { color: mutedText }]}>Add address</Text>
            </TouchableOpacity>
          </View>

          {/* Address Disclaimer */}
          <View style={[styles.disclaimerCard, {
            backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
            borderColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.07)',
          }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#FF9F0A" style={{ marginTop: 1 }} />
            <Text style={[styles.disclaimerText, {
              color: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)',
            }]}>
              Always verify the address before sending. Contacts may change their address or use a different one. Bitcoin transactions are irreversible.
            </Text>
          </View>
        </Animated.View>

        {/* Notes */}
        {contact.notes ? (
          <Animated.View entering={FadeIn.delay(320).duration(400)}>
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>NOTES</Text>
            <View style={[styles.notesCard, { backgroundColor: surfaceBg }]}>
              <Text style={[styles.notesText, { color: isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)' }]}>
                {contact.notes}
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {/* Delete */}
        <Animated.View entering={FadeIn.delay(400).duration(400)} style={styles.dangerZone}>
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color="#FF453A" />
            <Text style={styles.deleteText}>Delete Contact</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {/* Edit Sheet */}
      <AddEditContactSheet
        visible={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        editingContact={contact}
      />

      {/* Request Sheet */}
      <RequestFromContactSheet
        visible={showRequestSheet}
        onClose={() => setShowRequestSheet(false)}
        contact={contact}
      />

      {/* No Address Sheet */}
      <AppBottomSheet
        visible={showNoAddressSheet}
        onClose={() => setShowNoAddressSheet(false)}
        title="No Address"
        sizing="auto"
      >
        <View style={styles.sheetContent}>
          <View style={[
            styles.sheetIconCircle,
            { backgroundColor: isDark ? 'rgba(255,59,48,0.12)' : 'rgba(255,59,48,0.08)' },
          ]}>
            <Ionicons name="alert-circle" size={32} color="#FF453A" />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            No address found
          </Text>
          <Text style={[styles.sheetDesc, { color: mutedText }]}>
            Add a Bitcoin address to this contact before you can send or copy.
          </Text>
          <TouchableOpacity
            style={[styles.sheetPrimaryBtn, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={() => {
              setShowNoAddressSheet(false);
              handleAddAddress();
            }}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={[styles.sheetPrimaryBtnText, { color: '#FFFFFF' }]}>
              Add Address
            </Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>

      {/* Add Address Sheet */}
      <AppBottomSheet
        visible={showAddAddressSheet}
        onClose={() => setShowAddAddressSheet(false)}
        title="Add Address"
        subtitle="Enter a Bitcoin address"
        sizing="auto"
        footer={
          <View style={styles.sheetFooter}>
            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                {
                  backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
                  opacity: newAddress.trim() ? 1 : 0.35,
                },
              ]}
              onPress={handleSaveNewAddress}
              disabled={!newAddress.trim()}
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              <Text style={[styles.sheetPrimaryBtnText, { color: '#FFFFFF' }]}>
                Save Address
              </Text>
            </TouchableOpacity>
          </View>
        }
      >
        <View style={styles.addSheetContent}>
          <PremiumInputCard>
            <PremiumInput
              ref={newAddressRef}
              icon="wallet-outline"
              iconColor="#FF9F0A"
              placeholder="Bitcoin address"
              value={newAddress}
              onChangeText={setNewAddress}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => newLabelRef.current?.focus()}
              blurOnSubmit={false}
              monospace={true}
            />
            <PremiumInput
              ref={newLabelRef}
              icon="text-outline"
              iconColor="#007AFF"
              placeholder="Label (optional)"
              value={newAddressLabel}
              onChangeText={setNewAddressLabel}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (newAddress.trim()) handleSaveNewAddress();
              }}
            />
          </PremiumInputCard>
          <View style={styles.addSheetActions}>
            <TouchableOpacity
              style={[styles.addSheetCapsule, { backgroundColor: inputBg }]}
              onPress={handlePasteAddress}
            >
              <Ionicons name="clipboard-outline" size={13} color={mutedText} />
              <Text style={[styles.addSheetCapsuleText, { color: mutedText }]}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addSheetCapsule, { backgroundColor: inputBg }]}
              onPress={handleScanAddress}
            >
              <Ionicons name="scan-outline" size={13} color={mutedText} />
              <Text style={[styles.addSheetCapsuleText, { color: mutedText }]}>Scan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </AppBottomSheet>

      {/* Full Address Sheet */}
      <AppBottomSheet
        visible={showFullAddressSheet}
        onClose={() => setShowFullAddressSheet(false)}
        title="Full Address"
        sizing="auto"
      >
        <View style={styles.fullAddressContent}>
          <Text
            style={[styles.fullAddressText, { color: colors.text }]}
            selectable
          >
            {fullAddressText}
          </Text>
          <TouchableOpacity
            style={[styles.sheetPrimaryBtn, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
            onPress={async () => {
              await copy(fullAddressText);
              setShowFullAddressSheet(false);
            }}
          >
            <Ionicons name="copy" size={16} color="#FFFFFF" />
            <Text style={[styles.sheetPrimaryBtnText, { color: '#FFFFFF' }]}>
              Copy Address
            </Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hero ──────────────────────
  hero: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 12,
  },
  heroTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  heroTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  heroTagText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // ── Quick Actions ──────────────────────
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 8,
  },
  quickAction: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
    borderRadius: 20,
    gap: 4,
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  // ── Section ──────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 22,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  // ── Insights ──────────────────────
  insightsGrid: {
    gap: 8,
    marginBottom: 4,
  },
  insightsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricBlock: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  metricIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '500',
  },

  // ── Addresses ──────────────────────
  addressesContent: {
  },
  noAddressText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 12,
  },
  addCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignSelf: 'center',
    marginTop: 8,
  },
  addCapsuleText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Address Disclaimer ──────────────────────
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },

  // ── Notes ──────────────────────
  notesCard: {
    borderRadius: 20,
    padding: 16,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Delete ──────────────────────
  dangerZone: {
    paddingTop: 32,
    alignItems: 'center',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  deleteText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FF453A',
  },

  // ── Sheet Shared ──────────────────────
  sheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  sheetIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  sheetDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  sheetPrimaryBtn: {
    height: 50,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  sheetPrimaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  sheetFooter: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },

  // ── Add Address Sheet ──────────────────────
  addSheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    gap: 8,
  },
  addSheetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  addSheetCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addSheetCapsuleText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // ── Full Address Sheet ──────────────────────
  fullAddressContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  fullAddressText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
});
