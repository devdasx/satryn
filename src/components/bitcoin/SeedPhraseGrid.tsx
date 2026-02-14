import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { THEME, getColors } from '../../constants';
import { useTheme } from '../../hooks';

interface SeedPhraseGridProps {
  words: string[];
  hideWords?: boolean;
  highlightIndices?: number[];
}

export function SeedPhraseGrid({
  words,
  hideWords = false,
  highlightIndices = [],
}: SeedPhraseGridProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  return (
    <View style={styles.container}>
      {words.map((word, index) => {
        const isHighlighted = highlightIndices.includes(index);
        const displayWord = hideWords && !isHighlighted ? '••••••' : word;

        return (
          <View
            key={index}
            style={[
              styles.wordContainer,
              {
                backgroundColor: c.seedPhrase.cellBg,
                borderColor: c.seedPhrase.cellBorder,
              },
              isHighlighted && {
                borderColor: c.brand.bitcoin,
                borderWidth: 2,
                backgroundColor: c.glass.bitcoin,
              },
            ]}
          >
            <View style={[styles.wordNumberContainer, { backgroundColor: c.glass.light }]}>
              <Text style={[styles.wordNumber, { color: c.seedPhrase.indexText }]}>{index + 1}</Text>
            </View>
            <Text
              style={[
                styles.word,
                { color: c.seedPhrase.wordText },
                hideWords && !isHighlighted && { color: c.text.muted },
              ]}
            >
              {displayWord}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: THEME.spacing.sm,
    padding: THEME.spacing.base,
  },
  wordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    minWidth: 110,
  },
  wordNumberContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: THEME.spacing.sm,
  },
  wordNumber: {
    fontSize: THEME.typography.size.xs,
    fontWeight: THEME.typography.weight.semibold,
  },
  word: {
    fontSize: THEME.typography.size.sm,
    fontWeight: THEME.typography.weight.semibold,
  },
});
