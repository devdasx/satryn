/**
 * TagFilterBar
 * Compact horizontal tag chips for filtering contacts.
 */

import React from 'react';
import { View, ScrollView, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';

export interface TagFilterBarProps {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

export function TagFilterBar({ tags, selected, onSelect }: TagFilterBarProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  if (tags.length === 0) return null;

  const handleSelect = (tag: string | null) => {
    haptics.trigger('selection');
    onSelect(tag);
  };

  const isAllActive = selected === null;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {/* "All" chip */}
        <Pressable
          style={[
            styles.chip,
            isAllActive
              ? { backgroundColor: isDark ? '#FFFFFF' : '#000000' }
              : {
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(0,0,0,0.04)',
                },
          ]}
          onPress={() => handleSelect(null)}
        >
          <Text
            style={[
              styles.chipText,
              {
                color: isAllActive
                  ? (isDark ? '#000000' : '#FFFFFF')
                  : colors.textSecondary,
              },
            ]}
          >
            All
          </Text>
        </Pressable>

        {/* Tag chips */}
        {tags.map((tag) => {
          const isActive = selected === tag;
          return (
            <Pressable
              key={tag}
              style={[
                styles.chip,
                isActive
                  ? { backgroundColor: isDark ? '#FFFFFF' : '#000000' }
                  : {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(0,0,0,0.04)',
                    },
              ]}
              onPress={() => handleSelect(isActive ? null : tag)}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isActive
                      ? (isDark ? '#000000' : '#FFFFFF')
                      : colors.textSecondary,
                  },
                ]}
              >
                {tag}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 38,
  },
  container: {
    paddingHorizontal: 16,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
  },
  chip: {
    paddingHorizontal: 14,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
