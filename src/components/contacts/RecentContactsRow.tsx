/**
 * RecentContactsRow
 * Horizontal scroll of recent contact avatars for the Send flow.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { ContactAvatar } from './ContactAvatar';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import type { Contact } from '../../types/contacts';

export interface RecentContactsRowProps {
  contacts: Contact[];
  onSelect: (contact: Contact) => void;
}

export function RecentContactsRow({ contacts, onSelect }: RecentContactsRowProps) {
  const { colors } = useTheme();
  const haptics = useHaptics();

  if (contacts.length === 0) return null;

  const recent = contacts.slice(0, 8);

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Recent</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {recent.map((contact) => (
          <TouchableOpacity
            key={contact.id}
            style={styles.item}
            activeOpacity={0.7}
            onPress={() => {
              haptics.trigger('selection');
              onSelect(contact);
            }}
          >
            <ContactAvatar name={contact.name} size="sm" isFavorite={contact.isFavorite} color={contact.color} />
            <Text
              style={[styles.name, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {contact.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  item: {
    alignItems: 'center',
    width: 52,
  },
  name: {
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
    width: 52,
  },
});
