/**
 * EmptyContactsState
 * Premium empty state shown when no contacts exist.
 * Matches Portfolio screen design: 3 concentric rings + title + subtitle + CTA.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';

export interface EmptyContactsStateProps {
  onAddContact: () => void;
}

export function EmptyContactsState({ onAddContact }: EmptyContactsStateProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  return (
    <View style={styles.container}>
      {/* Decorative rings — matches Portfolio design */}
      <View style={styles.rings}>
        <Animated.View
          entering={FadeInDown.duration(600).delay(100)}
          style={[styles.ring3, {
            borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          }]}
        />
        <Animated.View
          entering={FadeInDown.duration(600).delay(50)}
          style={[styles.ring2, {
            borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
          }]}
        />
        <Animated.View
          entering={FadeInDown.duration(500)}
          style={[styles.iconCircle, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
          }]}
        >
          <Ionicons
            name="people"
            size={30}
            color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}
          />
        </Animated.View>
      </View>

      <Animated.Text
        entering={FadeInDown.duration(500).delay(150)}
        style={[styles.title, { color: colors.text }]}
      >
        No contacts yet
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(500).delay(200)}
        style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}
      >
        Save addresses to quickly send{'\n'}Bitcoin to people you trust.
      </Animated.Text>

      <Animated.View entering={FadeInDown.duration(500).delay(280)}>
        <Pressable
          style={[
            styles.cta,
            { backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D' },
          ]}
          onPress={() => {
            haptics.trigger('light');
            onAddContact();
          }}
        >
          <Ionicons
            name="person-add-outline"
            size={16}
            color={isDark ? '#000000' : '#FFFFFF'}
          />
          <Text
            style={[
              styles.ctaText,
              { color: isDark ? '#000000' : '#FFFFFF' },
            ]}
          >
            Add Contact
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  rings: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ring3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  ring2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '400',
    marginBottom: 28,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 28,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
