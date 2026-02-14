/**
 * Numbers Entropy Collector
 * Collects entropy from user-typed random numbers or text
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import { EntropyProgressBar } from './EntropyProgress';

interface NumbersCollectorProps {
  targetChars: number;
  onTextUpdate: (text: string) => void;
  isDark: boolean;
}

export function NumbersCollector({
  targetChars,
  onTextUpdate,
  isDark,
}: NumbersCollectorProps) {
  const [text, setText] = useState('');

  const handleTextChange = useCallback(
    (value: string) => {
      setText(value);
      onTextUpdate(value);
    },
    [onTextUpdate]
  );

  const clearAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setText('');
    onTextUpdate('');
  }, [onTextUpdate]);

  // Count non-whitespace characters for entropy calculation
  const charCount = text.replace(/\s/g, '').length;
  const isComplete = charCount >= targetChars;

  return (
    <View style={styles.container}>
      {/* Instructions */}
      <View style={styles.instructionContainer}>
        <Text
          style={[
            styles.instructionText,
            { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' },
          ]}
        >
          {isComplete
            ? 'Enough entropy collected!'
            : 'Type random numbers, letters, or mash your keyboard'}
        </Text>
      </View>

      {/* Text Input */}
      <PremiumInputCard>
        <PremiumInput
          icon="dice-outline"
          iconColor="#BF5AF2"
          placeholder="Type random characters here..."
          value={text}
          onChangeText={handleTextChange}
          multiline
          numberOfLines={6}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          showClear={text.length > 0}
        />
      </PremiumInputCard>

      {/* Character counter */}
      <View style={styles.counterRow}>
        <Text
          style={[
            styles.counterText,
            { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' },
          ]}
        >
          {charCount} characters entered
        </Text>

        <TouchableOpacity
          onPress={clearAll}
          disabled={text.length === 0}
          activeOpacity={0.7}
          style={[styles.clearButton, text.length === 0 && { opacity: 0.3 }]}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'}
          />
          <Text
            style={[
              styles.clearButtonText,
              { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' },
            ]}
          >
            Clear
          </Text>
        </TouchableOpacity>
      </View>

      {/* Suggestion */}
      <View
        style={[
          styles.suggestionCard,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(0,0,0,0.02)',
            borderColor: isDark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(0,0,0,0.04)',
          },
        ]}
      >
        <Ionicons
          name="bulb-outline"
          size={16}
          color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
        />
        <Text
          style={[
            styles.suggestionText,
            { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' },
          ]}
        >
          Tip: Mix numbers, letters, and symbols for maximum entropy
        </Text>
      </View>

      {/* Progress */}
      <View style={styles.progressContainer}>
        <EntropyProgressBar
          current={charCount}
          target={targetChars}
          isDark={isDark}
          showLabel={true}
        />
        <Text
          style={[
            styles.progressLabel,
            { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' },
          ]}
        >
          {charCount} / {targetChars} characters
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 0,
  },
  instructionContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  // (Raw TextInput styles removed — using PremiumInput)
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  counterText: {
    fontSize: 13,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  progressContainer: {
    paddingTop: 8,
    gap: 8,
  },
  progressLabel: {
    fontSize: 13,
    textAlign: 'center',
  },
});
