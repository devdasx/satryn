/**
 * Contacts Screen
 * Premium contacts/beneficiaries manager — search, tags, favorites, CRUD.
 * Unified design language: large title, 24px padding, borderRadius 20 cards.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContactStore } from '../../src/stores';
import { useTheme, useHaptics, useCopyFeedback } from '../../src/hooks';
import { THEME } from '../../src/constants';
import { ContactCard, TagFilterBar, EmptyContactsState, ContactAvatar } from '../../src/components/contacts';
import { AddEditContactSheet } from '../../src/components/contacts/AddEditContactSheet';
import { ContactQuickActionsSheet } from '../../src/components/contacts/ContactQuickActionsSheet';
import { migrateAddressBook } from '../../src/utils/contactMigration';
import type { Contact } from '../../src/types/contacts';

export default function ContactsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const { copy } = useCopyFeedback();

  const {
    contacts,
    removeContact,
    importContacts,
    getAllTags,
    toggleFavorite,
  } = useContactStore();

  // Design tokens
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Multi-select mode
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sheets
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Legacy address book migration — now handled by initFromDb() in the store.
  // Kept as a one-time migration for users who still have the old address book format.
  useEffect(() => {
    (async () => {
      const migrated = await migrateAddressBook();
      if (migrated.length > 0) {
        importContacts(migrated);
      }
    })();
  }, [importContacts]);

  // All tags
  const allTags = useMemo(() => getAllTags(), [contacts, getAllTags]);

  // Filtered contacts
  const filtered = useMemo(() => {
    let result = [...contacts];

    // Tag filter
    if (selectedTag) {
      result = result.filter((c) => c.tags.includes(selectedTag));
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.addresses.some((a) => a.address.toLowerCase().includes(q)) ||
          c.tags.some((t) => t.toLowerCase().includes(q)) ||
          c.notes?.toLowerCase().includes(q)
      );
    }

    // Sort: favorites first, then alphabetical
    result.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [contacts, searchQuery, selectedTag]);

  // Favorites
  const favorites = useMemo(
    () => contacts.filter((c) => c.isFavorite).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );


  const handleContactPress = useCallback(
    (contact: Contact) => {
      router.push({ pathname: '/(auth)/contact-details', params: { contactId: contact.id } });
    },
    [router]
  );

  const handleContactLongPress = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setShowQuickActions(true);
  }, []);

  const handleDelete = useCallback(
    (contact: Contact) => {
      Alert.alert('Delete Contact', `Remove "${contact.name}" from contacts?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeContact(contact.id);
            haptics.trigger('warning');
          },
        },
      ]);
    },
    [removeContact, haptics]
  );

  const handleCopyAddress = useCallback(
    async (contact: Contact) => {
      const defaultAddr = contact.addresses.find((a) => a.isDefault) || contact.addresses[0];
      if (defaultAddr) {
        await copy(defaultAddr.address);
      }
    },
    [copy]
  );

  const handleToggleFavorite = useCallback(
    (contact: Contact) => {
      toggleFavorite(contact.id);
      haptics.trigger('selection');
    },
    [toggleFavorite, haptics]
  );

  // Multi-select handlers
  const toggleSelectMode = useCallback(() => {
    setIsSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleSelectContact = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  }, [filtered]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      'Delete Contacts',
      `Remove ${selectedIds.size} contact${selectedIds.size > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            selectedIds.forEach((id) => removeContact(id));
            haptics.trigger('warning');
            setSelectedIds(new Set());
            setIsSelectMode(false);
          },
        },
      ]
    );
  }, [selectedIds, removeContact, haptics]);

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;

  // Quick actions callbacks
  const handleQuickAction = useCallback(
    (action: string) => {
      if (!selectedContact) return;
      setShowQuickActions(false);

      switch (action) {
        case 'view':
          router.push({
            pathname: '/(auth)/contact-details',
            params: { contactId: selectedContact.id },
          });
          break;
        case 'send': {
          const addr = selectedContact.addresses?.find((a) => a.isDefault) || selectedContact.addresses?.[0];
          if (addr) {
            router.push({ pathname: '/(auth)/send', params: { address: addr.address } });
          }
          break;
        }
        case 'copy':
          handleCopyAddress(selectedContact);
          break;
        case 'favorite':
          handleToggleFavorite(selectedContact);
          break;
        case 'delete':
          handleDelete(selectedContact);
          break;
      }
    },
    [selectedContact, router, handleCopyAddress, handleToggleFavorite, handleDelete]
  );

  const renderItem = useCallback(
    ({ item }: { item: Contact }) => {
      if (isSelectMode) {
        const isSelected = selectedIds.has(item.id);
        return (
          <TouchableOpacity
            style={[
              styles.selectRow,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary },
            ]}
            onPress={() => toggleSelectContact(item.id)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.checkbox,
              {
                borderColor: isSelected ? (isDark ? THEME.brand.bitcoin : '#000000') : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'),
                backgroundColor: isSelected ? (isDark ? THEME.brand.bitcoin : '#000000') : 'transparent',
              },
            ]}>
              {isSelected && <Ionicons name="checkmark" size={13} color={isDark ? '#000' : '#FFF'} />}
            </View>
            <ContactAvatar name={item.name} size="md" isFavorite={item.isFavorite} color={item.color} />
            <Text style={[styles.selectName, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
          </TouchableOpacity>
        );
      }
      return (
        <ContactCard
          contact={item}
          onPress={() => handleContactPress(item)}
          onLongPress={() => handleContactLongPress(item)}
        />
      );
    },
    [handleContactPress, handleContactLongPress, isSelectMode, selectedIds, toggleSelectContact, isDark, colors]
  );

  const hasFavorites = favorites.length > 0 && !searchQuery.trim() && !selectedTag;

  // Footer: muted "Add contact" capsule + address disclaimer
  const renderListFooter = () => {
    if (filtered.length === 0) return null;
    return (
      <View>
        <TouchableOpacity
          style={[
            styles.addContactCapsule,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : 'rgba(0,0,0,0.03)',
            },
          ]}
          onPress={() => setShowAddSheet(true)}
        >
          <Ionicons name="add" size={14} color={mutedText} />
          <Text style={[styles.addContactCapsuleText, { color: mutedText }]}>
            Add contact
          </Text>
        </TouchableOpacity>

        <View style={[styles.disclaimerCard, {
          backgroundColor: isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.04)',
          borderColor: isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,159,10,0.07)',
        }]}>
          <Ionicons name="shield-checkmark-outline" size={15} color="#FF9F0A" style={{ marginTop: 1 }} />
          <Text style={[styles.disclaimerText, {
            color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
          }]}>
            Always verify the recipient's address before sending. A contact may change their address at any time. Bitcoin transactions cannot be reversed.
          </Text>
        </View>
      </View>
    );
  };

  // List header with favorites circle row + section label + long press hint
  const renderListHeader = () => (
    <View>
      {hasFavorites && !isSelectMode ? (
        <View style={styles.favoritesSection}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>FAVORITES</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.favoritesRow}
          >
            {favorites.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.favoriteCircle}
                onPress={() => handleContactPress(c)}
                onLongPress={() => handleContactLongPress(c)}
                activeOpacity={0.7}
              >
                <ContactAvatar name={c.name} size="lg" color={c.color} />
                <Text
                  style={[styles.favoriteName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {c.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>ALL CONTACTS</Text>
        </View>
      ) : filtered.length > 0 ? (
        <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>
          {searchQuery.trim() ? 'RESULTS' : 'ALL CONTACTS'}
        </Text>
      ) : null}

      {/* Long press hint — only if there are contacts and not in select mode */}
      {filtered.length > 0 && !isSelectMode && (
        <View style={styles.longPressHint}>
          <Ionicons name="finger-print-outline" size={12} color={mutedText} />
          <Text style={[styles.longPressHintText, { color: mutedText }]}>
            Long press a contact for quick actions
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — large title with add button */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.largeTitle, { color: colors.text }]}>Contacts</Text>
        <View style={styles.headerActions}>
          {contacts.length > 1 && (
            <TouchableOpacity
              onPress={toggleSelectMode}
              style={styles.addButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                {isSelectMode ? 'Done' : 'Select'}
              </Text>
            </TouchableOpacity>
          )}
          {!isSelectMode && (
            <TouchableOpacity
              onPress={() => setShowAddSheet(true)}
              style={styles.addButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Select mode bar */}
      {isSelectMode && (
        <View style={[styles.selectBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
          <TouchableOpacity
            onPress={allSelected ? deselectAll : selectAll}
            style={[styles.selectBarPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}
          >
            <Ionicons
              name={allSelected ? 'checkbox' : 'square-outline'}
              size={15}
              color={colors.text}
            />
            <Text style={[styles.selectBarText, { color: colors.text }]}>
              {allSelected ? 'Deselect' : 'All'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.selectBarCount, { color: mutedText }]}>
            {selectedIds.size} of {filtered.length}
          </Text>
          <TouchableOpacity
            onPress={handleBulkDelete}
            disabled={selectedIds.size === 0}
            style={[
              styles.selectBarDeletePill,
              {
                backgroundColor: selectedIds.size > 0
                  ? (isDark ? 'rgba(255,59,48,0.15)' : 'rgba(255,59,48,0.08)')
                  : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
              },
            ]}
          >
            <Ionicons
              name="trash-outline"
              size={14}
              color={selectedIds.size > 0 ? '#FF3B30' : mutedText}
            />
            <Text style={[styles.selectBarText, { color: selectedIds.size > 0 ? '#FF3B30' : mutedText }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrapper}>
        <PremiumInputCard>
          <PremiumInput
            icon="search"
            iconColor="#8E8E93"
            placeholder="Search contacts..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            showClear
          />
        </PremiumInputCard>
      </View>

      {/* Tag Filter */}
      <TagFilterBar tags={allTags} selected={selectedTag} onSelect={setSelectedTag} />

      {/* Contact List */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 20, flexGrow: 1 },
        ]}
        ListHeaderComponent={renderListHeader}
        ListFooterComponent={renderListFooter}
        ListEmptyComponent={
          searchQuery.trim() || selectedTag ? (
            <View style={styles.emptySearch}>
              <Text style={[styles.emptySearchText, { color: mutedText }]}>
                No matching contacts
              </Text>
            </View>
          ) : (
            <EmptyContactsState onAddContact={() => setShowAddSheet(true)} />
          )
        }
      />

      {/* Add/Edit Sheet */}
      <AddEditContactSheet
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
      />

      {/* Quick Actions Sheet */}
      <ContactQuickActionsSheet
        visible={showQuickActions}
        onClose={() => setShowQuickActions(false)}
        contact={selectedContact}
        onAction={handleQuickAction}
      />
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
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  addButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrapper: {
    paddingHorizontal: 24,
    marginBottom: 0,
  },
  listContent: {
    paddingHorizontal: 24,
  },
  favoritesSection: {
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 18,
    paddingBottom: 10,
    paddingLeft: 4,
  },
  emptySearch: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptySearchText: {
    fontSize: 15,
  },
  addContactCapsule: {
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
  addContactCapsuleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 20,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  // Header actions row
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Multi-select bar
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  selectBarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  selectBarDeletePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  selectBarText: {
    fontSize: 13,
    fontWeight: '600',
  },
  selectBarCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Select mode row
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 6,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  // Favorites circle row
  favoritesRow: {
    paddingVertical: 8,
    paddingRight: 12,
    gap: 16,
  },
  favoriteCircle: {
    alignItems: 'center',
    width: 68,
  },
  favoriteName: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  // Long press hint
  longPressHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingBottom: 6,
  },
  longPressHintText: {
    fontSize: 11,
    fontWeight: '400',
  },
});
