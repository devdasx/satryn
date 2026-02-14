/**
 * Dice Roll Entropy Collector
 * Collects entropy from user's 6-sided dice roll results
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EntropyProgressBar } from './EntropyProgress';

interface DiceRollCollectorProps {
  targetRolls: number;
  onRollsUpdate: (rolls: number[]) => void;
  isDark: boolean;
}

// Dice face representations using dots
const DICE_FACES: Record<number, { dots: number[][]; color: string }> = {
  1: { dots: [[1, 1]], color: '#FF3B30' },
  2: { dots: [[0, 0], [2, 2]], color: '#FF9500' },
  3: { dots: [[0, 0], [1, 1], [2, 2]], color: '#FFCC00' },
  4: { dots: [[0, 0], [0, 2], [2, 0], [2, 2]], color: '#34C759' },
  5: { dots: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], color: '#007AFF' },
  6: { dots: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]], color: '#AF52DE' },
};

function DiceFace({ value, size = 44, isDark }: { value: number; size?: number; isDark: boolean }) {
  const face = DICE_FACES[value];
  const dotSize = size / 6;
  const padding = size / 6;

  return (
    <View
      style={[
        styles.diceFace,
        {
          width: size,
          height: size,
          backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
          borderRadius: size / 5,
        },
      ]}
    >
      {face.dots.map((pos, i) => (
        <View
          key={i}
          style={[
            styles.diceDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: face.color,
              left: padding + pos[1] * ((size - padding * 2 - dotSize) / 2),
              top: padding + pos[0] * ((size - padding * 2 - dotSize) / 2),
            },
          ]}
        />
      ))}
    </View>
  );
}

export function DiceRollCollector({
  targetRolls,
  onRollsUpdate,
  isDark,
}: DiceRollCollectorProps) {
  const [rolls, setRolls] = useState<number[]>([]);

  const addRoll = useCallback(
    (value: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRolls((prev) => {
        const updated = [...prev, value];
        onRollsUpdate(updated);
        return updated;
      });
    },
    [onRollsUpdate]
  );

  const undoLast = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRolls((prev) => {
      const updated = prev.slice(0, -1);
      onRollsUpdate(updated);
      return updated;
    });
  }, [onRollsUpdate]);

  const clearAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRolls([]);
    onRollsUpdate([]);
  }, [onRollsUpdate]);

  const isComplete = rolls.length >= targetRolls;

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
            : 'Roll a dice and enter the results'}
        </Text>
      </View>

      {/* Dice Buttons - 2x3 Grid */}
      <View style={styles.diceGrid}>
        {[1, 2, 3, 4, 5, 6].map((value) => (
          <TouchableOpacity
            key={value}
            onPress={() => addRoll(value)}
            activeOpacity={0.8}
            style={[
              styles.diceButton,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(0,0,0,0.03)',
                borderColor: isDark
                  ? 'rgba(255,255,255,0.1)'
                  : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            <DiceFace value={value} size={48} isDark={isDark} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Sequence Display */}
      <View
        style={[
          styles.sequenceContainer,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(0,0,0,0.02)',
            borderColor: isDark
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sequenceScroll}
        >
          {rolls.length === 0 ? (
            <Text
              style={[
                styles.sequencePlaceholder,
                {
                  color: isDark
                    ? 'rgba(255,255,255,0.25)'
                    : 'rgba(0,0,0,0.2)',
                },
              ]}
            >
              Your rolls will appear here
            </Text>
          ) : (
            rolls.map((roll, index) => (
              <DiceFace key={index} value={roll} size={32} isDark={isDark} />
            ))
          )}
        </ScrollView>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={undoLast}
          disabled={rolls.length === 0}
          activeOpacity={0.7}
          style={[styles.actionButton, rolls.length === 0 && { opacity: 0.3 }]}
        >
          <Ionicons
            name="arrow-undo"
            size={18}
            color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'}
          />
          <Text
            style={[
              styles.actionButtonText,
              { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' },
            ]}
          >
            Undo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={clearAll}
          disabled={rolls.length === 0}
          activeOpacity={0.7}
          style={[styles.actionButton, rolls.length === 0 && { opacity: 0.3 }]}
        >
          <Ionicons
            name="trash-outline"
            size={18}
            color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'}
          />
          <Text
            style={[
              styles.actionButtonText,
              { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' },
            ]}
          >
            Clear
          </Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      <View style={styles.progressContainer}>
        <EntropyProgressBar
          current={rolls.length}
          target={targetRolls}
          isDark={isDark}
          showLabel={true}
        />
        <Text
          style={[
            styles.progressLabel,
            { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' },
          ]}
        >
          {rolls.length} / {targetRolls} rolls
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
  diceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  diceButton: {
    width: 80,
    height: 80,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceFace: {
    position: 'relative',
  },
  diceDot: {
    position: 'absolute',
  },
  sequenceContainer: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    justifyContent: 'center',
  },
  sequenceScroll: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  sequencePlaceholder: {
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
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
