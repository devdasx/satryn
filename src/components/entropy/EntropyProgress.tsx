/**
 * Entropy Progress Component
 * Circular progress indicator showing entropy collection status
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';

interface EntropyProgressProps {
  current: number;
  target: number;
  size?: number;
  strokeWidth?: number;
  isDark: boolean;
}

export function EntropyProgress({
  current,
  target,
  size = 80,
  strokeWidth = 6,
  isDark,
}: EntropyProgressProps) {
  const percentage = Math.min(100, Math.floor((current / target) * 100));
  const isComplete = percentage >= 100;

  // Circle calculations
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Color based on progress
  const getProgressColor = () => {
    if (isComplete) return isDark ? '#30D158' : '#34C759';
    if (percentage >= 75) return isDark ? '#30D158' : '#34C759';
    if (percentage >= 50) return '#FFD60A';
    if (percentage >= 25) return '#FF9F0A';
    return isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';
  };

  const progressColor = getProgressColor();
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Progress arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      {/* Center content */}
      <View style={styles.centerContent}>
        {isComplete ? (
          <Ionicons name="checkmark" size={size * 0.35} color={progressColor} />
        ) : (
          <Text
            style={[
              styles.percentageText,
              {
                color: isDark ? '#FFFFFF' : '#000000',
                fontSize: size * 0.22,
              },
            ]}
          >
            {percentage}%
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Compact progress bar variant for inline use
 */
interface EntropyProgressBarProps {
  current: number;
  target: number;
  isDark: boolean;
  showLabel?: boolean;
}

export function EntropyProgressBar({
  current,
  target,
  isDark,
  showLabel = true,
}: EntropyProgressBarProps) {
  const percentage = Math.min(100, Math.floor((current / target) * 100));
  const isComplete = percentage >= 100;

  const getProgressColor = () => {
    if (isComplete) return isDark ? '#30D158' : '#34C759';
    if (percentage >= 75) return isDark ? '#30D158' : '#34C759';
    if (percentage >= 50) return '#FFD60A';
    return '#FF9F0A';
  };

  return (
    <View style={styles.barContainer}>
      {showLabel && (
        <Text
          style={[
            styles.barLabel,
            { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' },
          ]}
        >
          {current} / {target}
        </Text>
      )}
      <View
        style={[
          styles.barTrack,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.05)',
          },
        ]}
      >
        <View
          style={[
            styles.barFill,
            {
              backgroundColor: getProgressColor(),
              width: `${percentage}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContent: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentageText: {
    fontWeight: '700',
  },
  barContainer: {
    width: '100%',
    gap: 6,
  },
  barLabel: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
});
