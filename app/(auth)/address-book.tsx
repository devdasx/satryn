import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAddressBookStore } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';

export default function AddressBookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const { entries, addEntry, updateEntry, removeEntry } = useAddressBookStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNote, setNewNote] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(e =>
      e.label.toLowerCase().includes(q) ||
      e.address.toLowerCase().includes(q) ||
      e.note?.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  const handleAdd = useCallback(() => {
    if (!newAddress.trim() || !newLabel.trim()) return;
    addEntry(newAddress.trim(), newLabel.trim(), newNote.trim() || undefined);
    setShowAddSheet(false);
    setNewAddress('');
    setNewLabel('');
    setNewNote('');
    haptics.trigger('success');
  }, [newAddress, newLabel, newNote, addEntry, haptics]);

  const handleEdit = useCallback((id: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    setEditingId(id);
    setNewLabel(entry.label);
    setNewNote(entry.note || '');
    setShowEditSheet(true);
  }, [entries]);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !newLabel.trim()) return;
    updateEntry(editingId, { label: newLabel.trim(), note: newNote.trim() || undefined });
    setShowEditSheet(false);
    setEditingId(null);
    setNewLabel('');
    setNewNote('');
    haptics.trigger('success');
  }, [editingId, newLabel, newNote, updateEntry, haptics]);

  const handleDelete = useCallback((id: string, label: string) => {
    Alert.alert('Delete Contact', `Remove "${label}" from address book?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeEntry(id);
          haptics.trigger('warning');
        },
      },
    ]);
  }, [removeEntry, haptics]);

  const handleCopy = useCallback(async (address: string) => {
    await Clipboard.setStringAsync(address);
    haptics.trigger('success');
  }, [haptics]);

  const textColor = isDark ? '#FFFFFF' : '#000000';
  const mutedColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  const surfaceColor = isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF';
  const borderColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  const renderItem = useCallback(({ item }: { item: typeof entries[0] }) => (
    <TouchableOpacity
      style={[styles.entryCard, { backgroundColor: surfaceColor, borderColor }]}
      activeOpacity={0.7}
      onPress={() => handleCopy(item.address)}
      onLongPress={() => handleEdit(item.id)}
    >
      <View style={styles.entryHeader}>
        <Text style={[styles.entryLabel, { color: textColor }]} numberOfLines={1}>{item.label}</Text>
        <TouchableOpacity onPress={() => handleDelete(item.id, item.label)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="trash-outline" size={16} color={isDark ? 'rgba(255,69,58,0.6)' : 'rgba(255,69,58,0.8)'} />
        </TouchableOpacity>
      </View>
      <Text style={[styles.entryAddress, { color: mutedColor }]} numberOfLines={1}>{item.address}</Text>
      {item.note ? <Text style={[styles.entryNote, { color: mutedColor }]} numberOfLines={1}>{item.note}</Text> : null}
    </TouchableOpacity>
  ), [surfaceColor, borderColor, textColor, mutedColor, isDark, handleCopy, handleEdit, handleDelete]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor }]}>Address Book</Text>
        <TouchableOpacity onPress={() => { setNewAddress(''); setNewLabel(''); setNewNote(''); setShowAddSheet(true); }} style={styles.addButton}>
          <Ionicons name="add" size={24} color={textColor} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { marginHorizontal: 16 }]}>
        <PremiumInputCard>
          <PremiumInput
            icon="search"
            iconColor="#8E8E93"
            placeholder="Search contacts..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            showClear
          />
        </PremiumInputCard>
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
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
                <Ionicons name="book-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
              </View>
            </View>
            <Text style={[styles.emptyText, { color: textColor }]}>
              {searchQuery ? 'No matching contacts' : 'No saved contacts'}
            </Text>
            <Text style={[styles.emptySubtext, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
              {searchQuery ? 'Try a different search' : 'Tap + to add a Bitcoin address'}
            </Text>
          </View>
        }
      />

      {/* Add Sheet */}
      <AppBottomSheet
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        title="Add Contact"
        sizing="auto"
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetForm}>
            <PremiumInputCard>
              <PremiumInput
                icon="person-outline"
                iconColor="#007AFF"
                placeholder="Label (e.g., Alice)"
                value={newLabel}
                onChangeText={setNewLabel}
                autoFocus
                showClear
              />
              <PremiumInput
                icon="location-outline"
                iconColor="#FF9500"
                placeholder="Bitcoin address"
                value={newAddress}
                onChangeText={setNewAddress}
                showClear
              />
              <PremiumInput
                icon="document-text-outline"
                iconColor="#8E8E93"
                placeholder="Note (optional)"
                value={newNote}
                onChangeText={setNewNote}
                showClear
              />
            </PremiumInputCard>
            <TouchableOpacity
              style={[styles.formButton, (!newAddress.trim() || !newLabel.trim()) && styles.formButtonDisabled]}
              onPress={handleAdd}
              disabled={!newAddress.trim() || !newLabel.trim()}
            >
              <Text style={styles.formButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </AppBottomSheet>

      {/* Edit Sheet */}
      <AppBottomSheet
        visible={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        title="Edit Contact"
        sizing="auto"
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetForm}>
            <PremiumInputCard>
              <PremiumInput
                icon="person-outline"
                iconColor="#007AFF"
                placeholder="Label"
                value={newLabel}
                onChangeText={setNewLabel}
                autoFocus
                showClear
              />
              <PremiumInput
                icon="document-text-outline"
                iconColor="#8E8E93"
                placeholder="Note (optional)"
                value={newNote}
                onChangeText={setNewNote}
                showClear
              />
            </PremiumInputCard>
            <TouchableOpacity
              style={[styles.formButton, !newLabel.trim() && styles.formButtonDisabled]}
              onPress={handleSaveEdit}
              disabled={!newLabel.trim()}
            >
              <Text style={styles.formButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: { width: 40 },
  title: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  addButton: { width: 40, alignItems: 'flex-end' },
  searchContainer: { marginBottom: 12 },
  listContent: { paddingHorizontal: 16 },
  entryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  entryLabel: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  entryAddress: { fontSize: 12 },
  entryNote: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
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
  emptyText: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8 },
  emptySubtext: { fontSize: 15, fontWeight: '400', lineHeight: 22, textAlign: 'center', paddingHorizontal: 40 },
  sheetForm: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  formButton: {
    backgroundColor: '#F7931A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  formButtonDisabled: { opacity: 0.4 },
  formButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
