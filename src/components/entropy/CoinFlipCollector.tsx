/**
 * Coin Flip Entropy Collector
 * Collects entropy from user's coin flip sequence (H/T)
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

interface CoinFlipCollectorProps {
  targetFlips: number;
  onFlipsUpdate: (flips: string[]) => void;
  isDark: boolean;
}

export function CoinFlipCollector({
  targetFlips,
  onFlipsUpdate,
  isDark,
}: CoinFlipCollectorProps) {
  const [flips, setFlips] = useState<string[]>([]);

  const addFlip = useCallback(
    (value: 'H' | 'T') => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFlips((prev) => {
        const updated = [...prev, value];
        onFlipsUpdate(updated);
        return updated;
      });
    },
    [onFlipsUpdate]
  );

  const undoLast = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlips((prev) => {
      const updated = prev.slice(0, -1);
      onFlipsUpdate(updated);
      return updated;
    });
  }, [onFlipsUpdate]);

  const clearAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlips([]);
    onFlipsUpdate([]);
  }, [onFlipsUpdate]);

  const isComplete = flips.length >= targetFlips;

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
            : 'Flip a coin and enter the results'}
        </Text>
      </View>

      {/* Flip Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={() => addFlip('H')}
          activeOpacity={0.8}
          style={[
            styles.flipButton,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)',
              borderColor: isDark
                ? 'rgba(255,255,255,0.15)'
                : 'rgba(0,0,0,0.1)',
            },
          ]}
        >
          <View
            style={[
              styles.flipIconBg,
              { backgroundColor: isDark ? '#FFD60A' : '#FFC107' },
            ]}
          >
            <Text style={styles.flipIconText}>H</Text>
          </View>
          <Text
            style={[
              styles.flipButtonLabel,
              { color: isDark ? '#FFFFFF' : '#000000' },
            ]}
          >
            Heads
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => addFlip('T')}
          activeOpacity={0.8}
          style={[
            styles.flipButton,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)',
              borderColor: isDark
                ? 'rgba(255,255,255,0.15)'
                : 'rgba(0,0,0,0.1)',
            },
          ]}
        >
          <View
            style={[
              styles.flipIconBg,
              { backgroundColor: isDark ? '#8E8E93' : '#636366' },
            ]}
          >
            <Text style={styles.flipIconText}>T</Text>
          </View>
          <Text
            style={[
              styles.flipButtonLabel,
              { color: isDark ? '#FFFFFF' : '#000000' },
            ]}
          >
            Tails
          </Text>
        </TouchableOpacity>
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
          {flips.length === 0 ? (
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
              Your sequence will appear here
            </Text>
          ) : (
            flips.map((flip, index) => (
              <View
                key={index}
                style={[
                  styles.sequenceBadge,
                  {
                    backgroundColor:
                      flip === 'H'
                        ? isDark
                          ? 'rgba(255,214,10,0.2)'
                          : 'rgba(255,193,7,0.2)'
                        : isDark
                        ? 'rgba(142,142,147,0.2)'
                        : 'rgba(99,99,102,0.2)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sequenceBadgeText,
                    {
                      color:
                        flip === 'H'
                          ? isDark
                            ? '#FFD60A'
                            : '#FFA000'
                          : isDark
                          ? '#8E8E93'
                          : '#636366',
                    },
                  ]}
                >
                  {flip}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={undoLast}
          disabled={flips.length === 0}
          activeOpacity={0.7}
          style={[styles.actionButton, flips.length === 0 && { opacity: 0.3 }]}
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
          disabled={flips.length === 0}
          activeOpacity={0.7}
          style={[styles.actionButton, flips.length === 0 && { opacity: 0.3 }]}
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
          current={flips.length}
          target={targetFlips}
          isDark={isDark}
          showLabel={true}
        />
        <Text
          style={[
            styles.progressLabel,
            { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' },
          ]}
        >
          {flips.length} / {targetFlips} flips
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
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  flipButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  flipIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIconText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  flipButtonLabel: {
    fontSize: 17,
    fontWeight: '600',
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
    gap: 6,
  },
  sequencePlaceholder: {
    fontSize: 14,
  },
  sequenceBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sequenceBadgeText: {
    fontSize: 14,
    fontWeight: '700',
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
