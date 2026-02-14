/**
 * ContactAvatar
 * Deterministic monogram circle with muted color palette (no orange)
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Vibrant, distinct palette — each color is visually unique, works on both light/dark
const AVATAR_COLORS = [
  '#5B7FFF', // Royal blue
  '#30D158', // Green
  '#FF6482', // Rose pink
  '#8E8CE6', // Purple
  '#FF9F0A', // Amber
  '#4ECDC4', // Teal
  '#FF453A', // Coral red
  '#BF5AF2', // Vivid purple
  '#5AC8FA', // Sky blue
  '#34D399', // Emerald
  '#FF6B6B', // Salmon
  '#A78BFA', // Lavender
  '#F59E0B', // Gold
  '#06B6D4', // Cyan
  '#EC4899', // Hot pink
  '#10B981', // Mint
  '#6366F1', // Indigo
  '#EF4444', // Red
  '#14B8A6', // Teal green
  '#8B5CF6', // Violet
];

function getColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

interface ContactAvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  isFavorite?: boolean;
  color?: string;
}

const SIZES = {
  sm: { container: 36, font: 13, badgeSize: 14, starSize: 8 },
  md: { container: 44, font: 16, badgeSize: 16, starSize: 9 },
  lg: { container: 64, font: 22, badgeSize: 20, starSize: 11 },
};

export function ContactAvatar({ name, size = 'md', isFavorite, color: colorProp }: ContactAvatarProps) {
  const color = useMemo(() => colorProp || getColorForName(name), [colorProp, name]);
  const initials = useMemo(() => getInitials(name), [name]);
  const dimensions = SIZES[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dimensions.container,
          height: dimensions.container,
          borderRadius: dimensions.container / 2,
          backgroundColor: color + '20', // 12% opacity
        },
      ]}
    >
      <Text
        style={[
          styles.initials,
          {
            fontSize: dimensions.font,
            color,
          },
        ]}
      >
        {initials}
      </Text>
      {isFavorite && (
        <View
          style={[
            styles.favoriteIndicator,
            {
              width: dimensions.badgeSize,
              height: dimensions.badgeSize,
              borderRadius: dimensions.badgeSize / 2,
            },
          ]}
        >
          <Ionicons name="star" size={dimensions.starSize} color="#FFF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  favoriteIndicator: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    backgroundColor: '#FFD60A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
