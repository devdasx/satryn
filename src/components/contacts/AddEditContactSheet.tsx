/**
 * AddEditContactSheet
 * Multi-step bottom sheet for creating or editing a contact.
 * Step 1: Name & Addresses  •  Step 2: Tags & Notes  •  Step 3: Review & Save
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { TextInput as TextInputType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import { useContactStore } from '../../stores/contactStore';
import { isValidBitcoinAddress } from '../../utils/validation';
import { useSettingsStore } from '../../stores/settingsStore';
import { QRScanner } from '../scanner/QRScanner';
import type { Contact } from '../../types/contacts';

export interface AddEditContactSheetProps {
  visible: boolean;
  onClose: () => void;
  editingContact?: Contact;
}

interface AddressField {
  key: string;
  address: string;
  label: string;
}

type Step = 1 | 2 | 3;

export function AddEditContactSheet({
  visible,
  onClose,
  editingContact,
}: AddEditContactSheetProps) {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const { addContact, updateContact, addAddress, getContactByAddress } = useContactStore();
  const { network } = useSettingsStore();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<AddressField[]>([
    { key: '1', address: '', label: '' },
  ]);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanTargetKey, setScanTargetKey] = useState<string | null>(null);

  // Input refs for keyboard flow
  const nameRef = useRef<TextInputType>(null);
  const addressRefs = useRef<Record<string, TextInputType | null>>({});
  const labelRefs = useRef<Record<string, TextInputType | null>>({});
  const tagInputRef = useRef<TextInputType>(null);
  const notesRef = useRef<TextInputType>(null);

  // Reset on open
  useEffect(() => {
    if (visible) {
      if (editingContact) {
        setName(editingContact.name);
        setNotes(editingContact.notes || '');
        setTags(editingContact.tags);
        setAddresses(
          editingContact.addresses.length > 0
            ? editingContact.addresses.map((a, i) => ({
                key: String(i + 1),
                address: a.address,
                label: a.label || '',
              }))
            : [{ key: '1', address: '', label: '' }]
        );
        setStep(1);
      } else {
        setName('');
        setNotes('');
        setTags([]);
        setTagInput('');
        setAddresses([{ key: '1', address: '', label: '' }]);
        setStep(1);
      }
    }
  }, [visible, editingContact]);

  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // ── Address handlers ──────────────────────────────
  const handleAddAddressField = useCallback(() => {
    setAddresses((prev) => [
      ...prev,
      { key: String(Date.now()), address: '', label: '' },
    ]);
  }, []);

  const handleRemoveAddressField = useCallback((key: string) => {
    setAddresses((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const handleUpdateAddress = useCallback(
    (key: string, field: 'address' | 'label', value: string) => {
      setAddresses((prev) =>
        prev.map((a) => (a.key === key ? { ...a, [field]: value } : a))
      );
    },
    []
  );

  const handlePasteToAddress = useCallback(
    async (key: string) => {
      try {
        const text = await Clipboard.getStringAsync();
        if (text && text.trim()) {
          const cleaned = text.replace(/^bitcoin:/i, '').split('?')[0].trim();
          handleUpdateAddress(key, 'address', cleaned);
          haptics.trigger('light');
        } else {
          haptics.trigger('error');
          Alert.alert('Clipboard Empty', 'No text found in clipboard. Copy a Bitcoin address first.');
        }
      } catch {
        haptics.trigger('error');
        Alert.alert('Clipboard Error', 'Could not read clipboard. Please try again.');
      }
    },
    [handleUpdateAddress, haptics]
  );

  const handleScanForAddress = useCallback((key: string) => {
    setScanTargetKey(key);
    setScannerVisible(true);
  }, []);

  const handleScanResult = useCallback((data: string) => {
    setScannerVisible(false);
    if (!scanTargetKey) return;
    // Strip bitcoin: URI prefix if present
    let address = data;
    if (address.toLowerCase().startsWith('bitcoin:')) {
      address = address.replace(/^bitcoin:/i, '').split('?')[0];
    }
    address = address.trim();
    if (address) {
      handleUpdateAddress(scanTargetKey, 'address', address);
      haptics.trigger('success');
    }
  }, [scanTargetKey, handleUpdateAddress, haptics]);

  // ── Tag handlers ──────────────────────────────────
  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput('');
      haptics.trigger('light');
    }
  }, [tagInput, tags, haptics]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  // ── Navigation ────────────────────────────────────
  const canContinueStep1 = name.trim().length > 0;

  const handleNext = useCallback(() => {
    haptics.trigger('selection');
    if (step === 1) {
      if (!canContinueStep1) return;
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }, [step, canContinueStep1, haptics]);

  const handleBack = useCallback(() => {
    haptics.trigger('light');
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }, [step, haptics]);

  // ── Save ──────────────────────────────────────────
  const validAddresses = useMemo(
    () => addresses.filter((a) => a.address.trim()),
    [addresses]
  );

  const handleSave = useCallback(() => {
    // Validate addresses
    for (const addr of validAddresses) {
      if (!isValidBitcoinAddress(addr.address.trim(), network)) {
        Alert.alert(
          'Invalid Address',
          `"${addr.address.slice(0, 20)}..." is not a valid ${network} address.`
        );
        setStep(1);
        return;
      }
      const existing = getContactByAddress(addr.address.trim());
      if (existing && existing.id !== editingContact?.id) {
        Alert.alert(
          'Duplicate Address',
          `This address already belongs to "${existing.name}".`
        );
        setStep(1);
        return;
      }
    }

    if (editingContact) {
      updateContact(editingContact.id, {
        name: name.trim(),
        notes: notes.trim() || undefined,
        tags,
      });
      const existingAddrs = new Set(editingContact.addresses.map((a) => a.address));
      for (const addr of validAddresses) {
        if (!existingAddrs.has(addr.address.trim())) {
          addAddress(editingContact.id, {
            address: addr.address.trim(),
            label: addr.label.trim() || undefined,
            isDefault: editingContact.addresses.length === 0,
          });
        }
      }
      haptics.trigger('success');
    } else {
      try {
        addContact({
          name: name.trim(),
          tags,
          notes: notes.trim() || undefined,
          isFavorite: false,
          addresses: validAddresses.map((a, i) => ({
            id: `addr_${Date.now()}_${i}`,
            address: a.address.trim(),
            label: a.label.trim() || undefined,
            isDefault: i === 0,
            createdAt: Date.now(),
          })),
        });
        haptics.trigger('success');
      } catch (err: any) {
        haptics.trigger('error');
        Alert.alert('Cannot Save', err?.message || 'Failed to save contact');
        setStep(1);
        return;
      }
    }
    onClose();
  }, [
    name, notes, tags, validAddresses, editingContact, network,
    addContact, updateContact, addAddress, getContactByAddress,
    haptics, onClose,
  ]);

  // ── Step titles ───────────────────────────────────
  const stepTitles: Record<Step, string> = {
    1: editingContact ? 'Edit Contact' : 'New Contact',
    2: 'Details',
    3: 'Review',
  };

  const stepSubtitles: Record<Step, string> = {
    1: 'Name and address',
    2: 'Tags and notes',
    3: 'Confirm and save',
  };

  // ── Footer ────────────────────────────────────────
  const renderFooter = () => {
    if (step === 3) {
      return (
        <View style={styles.footerContainer}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' }]}
            onPress={handleSave}
          >
            <Ionicons name="checkmark" size={18} color={isDark ? '#000000' : '#FFFFFF'} />
            <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
              {editingContact ? 'Save Changes' : 'Save Contact'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const canContinue = step === 1 ? canContinueStep1 : true;

    return (
      <View style={styles.footerContainer}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            {
              backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
              opacity: canContinue ? 1 : 0.35,
            },
          ]}
          onPress={handleNext}
          disabled={!canContinue}
        >
          <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
            Continue
          </Text>
          <Ionicons name="arrow-forward" size={16} color={isDark ? '#000000' : '#FFFFFF'} />
        </TouchableOpacity>
        {step === 2 && (
          <TouchableOpacity style={styles.skipButton} onPress={() => setStep(3)}>
            <Text style={[styles.skipButtonText, { color: colors.textMuted }]}>
              Skip
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
  <>
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={stepTitles[step]}
      subtitle={stepSubtitles[step]}
      sizing={addresses.length > 2 ? ['auto', 'large'] : 'auto'}
      scrollable={addresses.length > 2}
      footer={renderFooter()}
      contentKey={`step-${step}-addr-${addresses.length}`}
    >
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {[1, 2, 3].map((s) => (
          <View
            key={s}
            style={[
              styles.stepDot,
              {
                backgroundColor:
                  s === step
                    ? (isDark ? '#FFFFFF' : '#000000')
                    : s < step
                      ? (isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)')
                      : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                width: s === step ? 20 : 6,
              },
            ]}
          />
        ))}
      </View>

      {/* Back button for steps 2 and 3 */}
      {step > 1 && (
        <TouchableOpacity style={styles.backRow} onPress={handleBack}>
          <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
          <Text style={[styles.backText, { color: colors.textMuted }]}>Back</Text>
        </TouchableOpacity>
      )}

      {/* ── Step 1: Name & Addresses ──────────────── */}
      {step === 1 && (
        <View style={styles.stepContent}>
          <PremiumInputCard label="NAME">
            <PremiumInput
              ref={nameRef}
              icon="person"
              iconColor="#007AFF"
              placeholder="Contact name"
              value={name}
              onChangeText={setName}
              showClear
              autoFocus={!editingContact}
              returnKeyType="next"
              onSubmitEditing={() => {
                const firstKey = addresses[0]?.key;
                if (firstKey) addressRefs.current[firstKey]?.focus();
              }}
              blurOnSubmit={false}
            />
          </PremiumInputCard>

          {addresses.map((addr, idx) => (
            <View key={addr.key} style={styles.addressBlock}>
              <PremiumInputCard label={idx === 0 ? 'ADDRESS' : undefined}>
                <PremiumInput
                  ref={(r) => { addressRefs.current[addr.key] = r; }}
                  icon="wallet"
                  iconColor="#FF9F0A"
                  placeholder="Bitcoin address"
                  value={addr.address}
                  onChangeText={(v) => handleUpdateAddress(addr.key, 'address', v)}
                  monospace
                  showClear
                  returnKeyType="next"
                  onSubmitEditing={() => labelRefs.current[addr.key]?.focus()}
                  blurOnSubmit={false}
                />
                <PremiumInput
                  ref={(r) => { labelRefs.current[addr.key] = r; }}
                  icon="pricetag"
                  iconColor="#5E5CE6"
                  placeholder="Label (optional)"
                  value={addr.label}
                  onChangeText={(v) => handleUpdateAddress(addr.key, 'label', v)}
                  showClear
                  returnKeyType={idx < addresses.length - 1 ? 'next' : 'done'}
                  onSubmitEditing={() => {
                    const nextAddr = addresses[idx + 1];
                    if (nextAddr) {
                      addressRefs.current[nextAddr.key]?.focus();
                    } else if (canContinueStep1) {
                      handleNext();
                    }
                  }}
                  blurOnSubmit={idx >= addresses.length - 1}
                />
              </PremiumInputCard>
              <View style={styles.addressActions}>
                <TouchableOpacity
                  style={[styles.actionCapsule, { backgroundColor: inputBg }]}
                  onPress={() => handlePasteToAddress(addr.key)}
                >
                  <Ionicons name="clipboard-outline" size={13} color={colors.textSecondary} />
                  <Text style={[styles.actionCapsuleText, { color: colors.textSecondary }]}>Paste</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionCapsule, { backgroundColor: inputBg }]}
                  onPress={() => handleScanForAddress(addr.key)}
                >
                  <Ionicons name="scan-outline" size={13} color={colors.textSecondary} />
                  <Text style={[styles.actionCapsuleText, { color: colors.textSecondary }]}>Scan</Text>
                </TouchableOpacity>
              </View>
              {addresses.length > 1 && (
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemoveAddressField(addr.key)}
                >
                  <Ionicons name="close-circle" size={18} color="#FF453A" />
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.addRow} onPress={handleAddAddressField}>
            <Ionicons name="add" size={15} color={colors.textMuted} />
            <Text style={[styles.addRowText, { color: colors.textMuted }]}>Add address</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Step 2: Tags & Notes ──────────────────── */}
      {step === 2 && (
        <View style={styles.stepContent}>
          <View style={styles.tagsContainer}>
            {tags.map((tag) => (
              <Pressable
                key={tag}
                style={[
                  styles.tagChip,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
                ]}
                onPress={() => handleRemoveTag(tag)}
              >
                <Text style={[styles.tagChipText, { color: colors.textSecondary }]}>{tag}</Text>
                <Ionicons name="close" size={11} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
          <PremiumInputCard label="TAGS" style={{ marginTop: tags.length > 0 ? 10 : 0 }}>
            <PremiumInput
              ref={tagInputRef}
              icon="bookmark"
              iconColor="#30D158"
              placeholder={tags.length === 0 ? 'e.g. Family, Exchange, Mining...' : 'Add tag...'}
              value={tagInput}
              onChangeText={setTagInput}
              showClear
              onSubmitEditing={() => {
                if (tagInput.trim()) {
                  handleAddTag();
                } else {
                  notesRef.current?.focus();
                }
              }}
              returnKeyType={tagInput.trim() ? 'done' : 'next'}
              blurOnSubmit={false}
              autoFocus
              rightElement={
                tagInput.trim().length > 0 ? (
                  <TouchableOpacity onPress={handleAddTag}>
                    <Ionicons name="add-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : undefined
              }
            />
          </PremiumInputCard>

          <PremiumInputCard label="NOTES" style={{ marginTop: 8 }}>
            <PremiumInput
              ref={notesRef}
              icon="document-text"
              iconColor="#8E8E93"
              placeholder="Add a note about this contact..."
              value={notes}
              onChangeText={setNotes}
              showClear
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={handleNext}
            />
          </PremiumInputCard>
        </View>
      )}

      {/* ── Step 3: Review ────────────────────────── */}
      {step === 3 && (
        <View style={styles.stepContent}>
          <View style={[styles.reviewCard, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
          }]}>
            {/* Name */}
            <View style={styles.reviewRow}>
              <View style={[styles.reviewIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}>
                <Ionicons name="person" size={14} color={colors.textMuted} />
              </View>
              <View style={styles.reviewInfo}>
                <Text style={[styles.reviewLabel, { color: colors.textMuted }]}>Name</Text>
                <Text style={[styles.reviewValue, { color: colors.text }]} numberOfLines={1}>
                  {name.trim()}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.editLink, { color: colors.textSecondary }]}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.reviewDivider, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
            }]} />

            {/* Addresses */}
            <View style={styles.reviewRow}>
              <View style={[styles.reviewIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}>
                <Ionicons name="wallet" size={14} color={colors.textMuted} />
              </View>
              <View style={styles.reviewInfo}>
                <Text style={[styles.reviewLabel, { color: colors.textMuted }]}>
                  {validAddresses.length === 1 ? 'Address' : 'Addresses'}
                </Text>
                {validAddresses.length > 0 ? (
                  validAddresses.map((a, i) => (
                    <Text key={i} style={[styles.reviewAddress, { color: colors.text }]} numberOfLines={1}>
                      {a.address.slice(0, 10)}...{a.address.slice(-6)}
                      {a.label ? ` · ${a.label}` : ''}
                    </Text>
                  ))
                ) : (
                  <Text style={[styles.reviewMuted, { color: colors.textMuted }]}>None added</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.editLink, { color: colors.textSecondary }]}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.reviewDivider, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
            }]} />

            {/* Tags */}
            <View style={styles.reviewRow}>
              <View style={[styles.reviewIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}>
                <Ionicons name="pricetag" size={14} color={colors.textMuted} />
              </View>
              <View style={styles.reviewInfo}>
                <Text style={[styles.reviewLabel, { color: colors.textMuted }]}>Tags</Text>
                {tags.length > 0 ? (
                  <View style={styles.reviewTags}>
                    {tags.map((t) => (
                      <View key={t} style={[styles.reviewTagChip, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      }]}>
                        <Text style={[styles.reviewTagText, { color: colors.textSecondary }]}>{t}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.reviewMuted, { color: colors.textMuted }]}>None</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setStep(2)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.editLink, { color: colors.textSecondary }]}>Edit</Text>
              </TouchableOpacity>
            </View>

            {/* Notes (only if present) */}
            {notes.trim().length > 0 && (
              <>
                <View style={[styles.reviewDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                }]} />
                <View style={styles.reviewRow}>
                  <View style={[styles.reviewIconCircle, {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }]}>
                    <Ionicons name="document-text" size={14} color={colors.textMuted} />
                  </View>
                  <View style={styles.reviewInfo}>
                    <Text style={[styles.reviewLabel, { color: colors.textMuted }]}>Notes</Text>
                    <Text style={[styles.reviewValue, { color: colors.text }]} numberOfLines={2}>
                      {notes.trim()}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setStep(2)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={[styles.editLink, { color: colors.textSecondary }]}>Edit</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      )}
    </AppBottomSheet>
    <QRScanner
      visible={scannerVisible}
      onClose={() => setScannerVisible(false)}
      onScan={handleScanResult}
      title="Scan Address"
      subtitle="Scan a Bitcoin address QR code"
    />
  </>
  );
}

const styles = StyleSheet.create({
  // Step indicator
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    paddingBottom: 4,
    paddingHorizontal: 24,
  },
  stepDot: {
    height: 5,
    borderRadius: 2.5,
  },
  // Back navigation
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 4,
  },
  backText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Step content
  stepContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  // Address block
  addressBlock: {
    marginBottom: 10,
    position: 'relative',
  },
  addressActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  actionCapsuleText: {
    fontSize: 12,
    fontWeight: '500',
  },
  removeBtn: {
    position: 'absolute',
    top: 11,
    right: 10,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    marginTop: 2,
  },
  addRowText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Tags
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Review card
  reviewCard: {
    borderRadius: 20,
    padding: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  reviewIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  reviewInfo: {
    flex: 1,
  },
  reviewLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  reviewValue: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  reviewAddress: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  reviewMuted: {
    fontSize: 13,
    fontWeight: '400',
  },
  reviewTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  reviewTagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  reviewTagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  editLink: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  reviewDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  // Footer
  footerContainer: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    gap: 10,
    alignItems: 'center',
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  skipButton: {
    paddingVertical: 4,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
