/**
 * ContactCard
 * Row component for the contacts list — avatar, name, tags, default address, chevron.
 * Unified design language: no borders, borderRadius 20 surface, solid backgrounds.
 */

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ContactAvatar } from './ContactAvatar';
import { useTheme } from '../../hooks/useTheme';
import { useHaptics } from '../../hooks/useHaptics';
import type { Contact } from '../../types/contacts';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ContactCardProps {
  contact: Contact;
  onPress: () => void;
  onLongPress: () => void;
}

export const ContactCard = memo(function ContactCard({ contact, onPress, onLongPress }: ContactCardProps) {
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [scale]);

  const handlePress = useCallback(() => {
    haptics.trigger('selection');
    onPress();
  }, [haptics, onPress]);

  const handleLongPress = useCallback(() => {
    haptics.trigger('medium');
    onLongPress();
  }, [haptics, onLongPress]);

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const chevronColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';

  const defaultAddr = contact.addresses.find((a) => a.isDefault) || contact.addresses[0];
  const truncatedAddress = defaultAddr
    ? `${defaultAddr.address.slice(0, 8)}...${defaultAddr.address.slice(-6)}`
    : 'No address';
  const visibleTags = contact.tags.slice(0, 2);
  const overflowCount = contact.tags.length - 2;

  return (
    <AnimatedPressable
      style={[
        animStyle,
        styles.container,
        { backgroundColor: surfaceBg },
      ]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={handleLongPress}
    >
      <ContactAvatar name={contact.name} size="md" isFavorite={contact.isFavorite} color={contact.color} />

      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {contact.name}
        </Text>
        <View style={styles.subtitleRow}>
          <Text style={[styles.address, { color: mutedText }]} numberOfLines={1}>
            {truncatedAddress}
          </Text>
          {visibleTags.length > 0 && (
            <>
              <Text style={[styles.tagDot, { color: mutedText }]}>·</Text>
              {visibleTags.map((tag) => (
                <Text
                  key={tag}
                  style={[styles.tagInline, { color: mutedText }]}
                  numberOfLines={1}
                >
                  {tag}
                </Text>
              ))}
              {overflowCount > 0 && (
                <Text style={[styles.tagInline, { color: mutedText }]}>
                  +{overflowCount}
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      <View style={styles.trailing}>
        {contact.addresses.length > 1 && (
          <Text style={[styles.addressCount, { color: mutedText }]}>
            {contact.addresses.length}
          </Text>
        )}
        <Ionicons
          name="chevron-forward"
          size={16}
          color={chevronColor}
        />
      </View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 6,
  },
  content: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  address: {
    fontSize: 12,
    flexShrink: 1,
  },
  tagDot: {
    fontSize: 10,
  },
  tagInline: {
    fontSize: 11,
    fontWeight: '500',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressCount: {
    fontSize: 11,
    fontWeight: '500',
  },
});
