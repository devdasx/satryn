import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  LayoutChangeEvent,
} from 'react-native';

export interface Segment {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  segments: Segment[];
  selectedKey: string;
  onSelect: (key: string) => void;
  isDark: boolean;
}

export function SegmentedControl({ segments, selectedKey, onSelect, isDark }: SegmentedControlProps) {
  const selectedIndex = segments.findIndex(s => s.key === selectedKey);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const segmentWidth = useRef(0);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: selectedIndex * segmentWidth.current,
      useNativeDriver: true,
      tension: 300,
      friction: 30,
    }).start();
  }, [selectedIndex, slideAnim]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const totalWidth = e.nativeEvent.layout.width - 4; // account for padding
    segmentWidth.current = totalWidth / segments.length;
    // Jump to current position without animation
    slideAnim.setValue(selectedIndex * segmentWidth.current);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isDark ? '#1C1C1E' : 'rgba(0,0,0,0.06)' },
      ]}
      onLayout={handleLayout}
    >
      {/* Sliding indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            width: `${100 / segments.length}%` as any,
            backgroundColor: isDark ? '#2C2C2E' : '#FFFFFF',
            transform: [{ translateX: slideAnim }],
          },
        ]}
      />

      {/* Segment buttons */}
      {segments.map((segment) => {
        const isSelected = segment.key === selectedKey;
        return (
          <TouchableOpacity
            key={segment.key}
            style={styles.segment}
            onPress={() => onSelect(segment.key)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color: isSelected
                    ? (isDark ? '#FFFFFF' : '#000000')
                    : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)'),
                  fontWeight: isSelected ? '600' : '500',
                },
              ]}
            >
              {segment.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
});
