/**
 * SectionHeader - Section title with optional action
 *
 * Matches Settings tab design language:
 * 13px/700 uppercase labels with 0.8 letter-spacing.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme, useHaptics } from '../../hooks';

interface SectionHeaderProps {
  title: string;
  action?: {
    label: string;
    onPress: () => void;
  };
  marginTop?: number;
}

export function SectionHeader({ title, action, marginTop = 20 }: SectionHeaderProps) {
  const { isDark } = useTheme();
  const { trigger } = useHaptics();

  const handleActionPress = () => {
    if (action) {
      trigger('light');
      action.onPress();
    }
  };

  return (
    <View style={[styles.container, { marginTop }]}>
      <Text
        style={[
          styles.title,
          {
            color: isDark
              ? 'rgba(255,255,255,0.30)'
              : 'rgba(0,0,0,0.30)',
          },
        ]}
      >
        {title}
      </Text>

      {action && (
        <Pressable
          onPress={handleActionPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text
            style={[
              styles.action,
              {
                color: isDark
                  ? 'rgba(255,255,255,0.50)'
                  : 'rgba(0,0,0,0.50)',
              },
            ]}
          >
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  action: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});

export default SectionHeader;
