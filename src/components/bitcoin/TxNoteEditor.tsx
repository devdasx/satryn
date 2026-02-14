/**
 * TxNoteEditor — Inline note/tag editor for transaction details
 *
 * Features:
 * - Multiline text input for notes
 * - Horizontal chip row for tags with "+" button
 * - Pre-defined tag suggestions + custom tag input
 * - Saves to transactionLabelStore (DB-backed) for reliability
 * - Debounced note saving, instant tag saving
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTransactionLabelStore } from '../../stores/transactionLabelStore';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';

// ─── Constants ────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 800;

const SUGGESTED_TAGS = [
  'income',
  'expense',
  'exchange',
  'kyc',
  'non-kyc',
  'gift',
  'donation',
  'salary',
] as const;

// ─── Props ────────────────────────────────────────────────────────

interface TxNoteEditorProps {
  walletId: string;
  txid: string;
  colors: {
    text: string;
    textMuted: string;
    background: string;
    surface: string;
    surfaceBorder: string;
    primary: string;
  };
  isDark: boolean;
}

// ─── Component ────────────────────────────────────────────────────

export function TxNoteEditor({ walletId, txid, colors, isDark }: TxNoteEditorProps) {
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [customTagText, setCustomTagText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customTagInputRef = useRef<TextInput>(null);
  // Refs to track latest values for blur/unmount saves (avoids stale closures)
  const latestNote = useRef('');
  const latestTags = useRef<string[]>([]);

  // ─── Load on mount ──────────────────────────────

  useEffect(() => {
    // Load from transactionLabelStore (DB-backed)
    const label = useTransactionLabelStore.getState().getLabel(txid);
    if (label) {
      const loadedNote = label.note ?? '';
      const loadedTags = label.tags ?? [];
      setNote(loadedNote);
      setTags(loadedTags);
      latestNote.current = loadedNote;
      latestTags.current = loadedTags;
    }
  }, [walletId, txid]);

  // ─── Save helpers ───────────────────────────────

  const saveToStores = useCallback((newNote: string, newTags: string[]) => {
    // Update refs
    latestNote.current = newNote;
    latestTags.current = newTags;

    // Save to transactionLabelStore (DB-backed Zustand store)
    const labelStore = useTransactionLabelStore.getState();
    if (newNote || newTags.length > 0) {
      labelStore.setLabel(txid, '', newNote, newTags);
    }
  }, [walletId, txid]);

  // ─── Note handlers ──────────────────────────────

  const handleNoteChange = (text: string) => {
    setNote(text);
    latestNote.current = text;
    // Debounce note saves
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      saveToStores(text, latestTags.current);
    }, SAVE_DEBOUNCE_MS);
  };

  const handleNoteBlur = () => {
    setIsEditing(false);
    // Flush note save immediately on blur using refs for latest values
    if (noteTimer.current) clearTimeout(noteTimer.current);
    saveToStores(latestNote.current, latestTags.current);
  };

  // Flush pending note save on unmount
  useEffect(() => {
    return () => {
      if (noteTimer.current) {
        clearTimeout(noteTimer.current);
        // Save latest values on unmount
        saveToStores(latestNote.current, latestTags.current);
      }
    };
  }, [saveToStores]);

  // ─── Tag handlers ───────────────────────────────

  const addTag = useCallback((tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || latestTags.current.includes(normalized)) return;
    const newTags = [...latestTags.current, normalized];
    setTags(newTags);
    latestTags.current = newTags;
    // Save tags immediately (no debounce)
    saveToStores(latestNote.current, newTags);
  }, [saveToStores]);

  const removeTag = useCallback((tag: string) => {
    const newTags = latestTags.current.filter(t => t !== tag);
    setTags(newTags);
    latestTags.current = newTags;
    saveToStores(latestNote.current, newTags);
  }, [saveToStores]);

  const handleCustomTagSubmit = () => {
    const trimmed = customTagText.trim();
    if (trimmed) {
      addTag(trimmed);
      setCustomTagText('');
    }
  };

  const availableSuggestions = SUGGESTED_TAGS.filter(t => !tags.includes(t));

  // ─── Design tokens ─────────────────────────────

  const chipBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const chipActiveBg = isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.10)';
  const mutedText = colors.textMuted;

  return (
    <View>
      {/* Note Input */}
      <PremiumInputCard label="Note">
        <PremiumInput
          icon="document-text"
          iconColor="#8E8E93"
          placeholder="Add a note..."
          value={note}
          onChangeText={handleNoteChange}
          onFocus={() => setIsEditing(true)}
          onBlur={handleNoteBlur}
          multiline
          textAlignVertical="top"
          maxLength={500}
          returnKeyType="done"
          blurOnSubmit
          showClear={note.length > 0}
        />
      </PremiumInputCard>

      {/* Tags Section */}
      <View style={styles.tagsSection}>
        <View style={styles.tagsLabelRow}>
          <Ionicons name="pricetags-outline" size={15} color={mutedText} />
          <Text style={[styles.tagsLabel, { color: mutedText }]}>Tags</Text>
        </View>

        {/* Active tags + Add button */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagsRow}
        >
          {tags.map(tag => (
            <TouchableOpacity
              key={tag}
              style={[styles.tagChip, { backgroundColor: chipActiveBg }]}
              onPress={() => removeTag(tag)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tagText, { color: colors.primary ?? '#FF9500' }]}>{tag}</Text>
              <Ionicons name="close" size={12} color={colors.primary ?? '#FF9500'} />
            </TouchableOpacity>
          ))}

          {/* Add tag button */}
          <TouchableOpacity
            style={[styles.addTagBtn, { backgroundColor: chipBg }]}
            onPress={() => {
              setShowTagPanel(!showTagPanel);
              if (!showTagPanel) {
                setTimeout(() => customTagInputRef.current?.focus(), 100);
              }
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={showTagPanel ? 'chevron-up' : 'add'}
              size={14}
              color={mutedText}
            />
            {!showTagPanel && (
              <Text style={[styles.addTagText, { color: mutedText }]}>Add</Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Tag panel: custom input + suggestions */}
        {showTagPanel && (
          <View style={styles.tagPanel}>
            {/* Custom tag input */}
            <PremiumInputCard>
              <PremiumInput
                ref={customTagInputRef}
                icon="bookmark"
                iconColor="#30D158"
                placeholder="Type a custom tag..."
                value={customTagText}
                onChangeText={setCustomTagText}
                onSubmitEditing={handleCustomTagSubmit}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
                rightElement={
                  customTagText.trim().length > 0 ? (
                    <TouchableOpacity
                      onPress={handleCustomTagSubmit}
                      style={[styles.customTagAddBtn, { backgroundColor: colors.primary ?? '#FF9500' }]}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={14} color="#FFFFFF" />
                    </TouchableOpacity>
                  ) : undefined
                }
              />
            </PremiumInputCard>

            {/* Suggestion chips */}
            {availableSuggestions.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.suggestionsRow}
              >
                {availableSuggestions.map(tag => (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.suggestionChip, { backgroundColor: chipBg }]}
                    onPress={() => addTag(tag)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={12} color={mutedText} />
                    <Text style={[styles.suggestionText, { color: mutedText }]}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tagsSection: {
    padding: 16,
  },
  tagsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  tagsLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '500',
  },
  addTagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  addTagText: {
    fontSize: 13,
    fontWeight: '500',
  },
  tagPanel: {
    marginTop: 12,
    gap: 10,
  },
  customTagAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  suggestionText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
