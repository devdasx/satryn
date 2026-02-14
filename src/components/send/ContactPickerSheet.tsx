/**
 * ContactPickerSheet — Bottom sheet to pick from saved contacts and recent recipients.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, SectionList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { useTheme } from '../../hooks';
import { useContactStore } from '../../stores/contactStore';
import { useRecentRecipientStore } from '../../stores/recentRecipientStore';
import type { Contact } from '../../types/contacts';

interface ContactPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (address: string, label?: string) => void;
}

export function ContactPickerSheet({
  visible,
  onClose,
  onSelect,
}: ContactPickerSheetProps) {
  const { colors } = useTheme();
  const contacts = useContactStore((s) => s.contacts);
  const recentRecipients = useRecentRecipientStore((s) => s.recipients);

  const sections = useMemo(() => {
    const result: Array<{ title: string; data: Array<{ address: string; label: string }> }> = [];

    if (recentRecipients.length > 0) {
      result.push({
        title: 'Recent',
        data: recentRecipients.slice(0, 5).map((r) => ({
          address: r.address,
          label: r.label || `${r.address.slice(0, 8)}...${r.address.slice(-6)}`,
        })),
      });
    }

    if (contacts.length > 0) {
      const contactItems: Array<{ address: string; label: string }> = [];
      for (const contact of contacts) {
        if (contact.addresses && contact.addresses.length > 0) {
          for (const addr of contact.addresses) {
            contactItems.push({
              address: addr.address,
              label: contact.name,
            });
          }
        }
      }
      if (contactItems.length > 0) {
        result.push({ title: 'Contacts', data: contactItems });
      }
    }

    return result;
  }, [contacts, recentRecipients]);

  const handleSelect = (address: string, label?: string) => {
    onSelect(address, label);
    onClose();
  };

  const renderItem = ({ item }: { item: { address: string; label: string } }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.fillSecondary }]}
      onPress={() => handleSelect(item.address, item.label)}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, { backgroundColor: colors.fillTertiary }]}>
        <Text style={[styles.avatarText, { color: colors.textSecondary }]}>
          {item.label.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.label}
        </Text>
        <Text style={[styles.address, { color: colors.textMuted }]} numberOfLines={1}>
          {item.address.slice(0, 12)}...{item.address.slice(-8)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <Text style={[styles.sectionHeader, { color: colors.textTertiary }]}>
      {section.title}
    </Text>
  );

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Choose Recipient"
      sizing="large"
    >
      <View style={styles.content}>
        {sections.length > 0 ? (
          <SectionList
            sections={sections}
            keyExtractor={(item, index) => `${item.address}-${index}`}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No contacts or recent recipients
            </Text>
          </View>
        )}
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    maxHeight: 450,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 12,
    marginBottom: 4,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  address: {
    fontSize: 12,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
  },
});
