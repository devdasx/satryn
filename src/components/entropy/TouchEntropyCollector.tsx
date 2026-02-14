/**
 * Touch Entropy Collector
 * Collects entropy from user's random touch/drag patterns
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  Animated,
} from 'react-native';
import { TouchPoint } from '../../services/entropy';
import { EntropyProgressBar } from './EntropyProgress';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_HEIGHT = 300;

interface TouchEntropyCollectorProps {
  targetPoints: number;
  onPointsUpdate: (points: TouchPoint[]) => void;
  isDark: boolean;
}

export function TouchEntropyCollector({
  targetPoints,
  onPointsUpdate,
  isDark,
}: TouchEntropyCollectorProps) {
  const [points, setPoints] = useState<TouchPoint[]>([]);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const addPoint = useCallback(
    (x: number, y: number, pressure?: number) => {
      const newPoint: TouchPoint = {
        x,
        y,
        timestamp: Date.now(),
        pressure,
      };

      setPoints((prev) => {
        const updated = [...prev, newPoint];
        onPointsUpdate(updated);
        return updated;
      });

      setCurrentPath((prev) => [...prev, { x, y }]);
    },
    [onPointsUpdate]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        // @ts-ignore - force is available on some devices
        const pressure = evt.nativeEvent.force;
        addPoint(locationX, locationY, pressure);

        // Reset fade for new stroke
        fadeAnim.setValue(1);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        // @ts-ignore
        const pressure = evt.nativeEvent.force;
        addPoint(locationX, locationY, pressure);
      },
      onPanResponderRelease: () => {
        // Fade out the current path
        Animated.timing(fadeAnim, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }).start(() => {
          // Clear path after fade
          setTimeout(() => setCurrentPath([]), 200);
        });
      },
    })
  ).current;

  const isComplete = points.length >= targetPoints;

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
            : 'Draw random patterns below'}
        </Text>
      </View>

      {/* Drawing Canvas */}
      <View
        style={[
          styles.canvas,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(0,0,0,0.02)',
            borderColor: isDark
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.06)',
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Path visualization */}
        <Animated.View style={[styles.pathContainer, { opacity: fadeAnim }]}>
          {currentPath.map((point, index) => (
            <View
              key={index}
              style={[
                styles.pathDot,
                {
                  left: point.x - 4,
                  top: point.y - 4,
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.5)'
                    : 'rgba(0,0,0,0.4)',
                },
              ]}
            />
          ))}
        </Animated.View>

        {/* Canvas hint when empty */}
        {points.length === 0 && (
          <View style={styles.canvasHint}>
            <Text
              style={[
                styles.canvasHintText,
                {
                  color: isDark
                    ? 'rgba(255,255,255,0.25)'
                    : 'rgba(0,0,0,0.2)',
                },
              ]}
            >
              Touch and drag here
            </Text>
          </View>
        )}
      </View>

      {/* Progress */}
      <View style={styles.progressContainer}>
        <EntropyProgressBar
          current={points.length}
          target={targetPoints}
          isDark={isDark}
          showLabel={true}
        />
        <Text
          style={[
            styles.progressLabel,
            { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' },
          ]}
        >
          {points.length} / {targetPoints} points
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
  canvas: {
    width: '100%',
    height: CANVAS_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  pathContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pathDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  canvasHint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasHintText: {
    fontSize: 16,
    fontWeight: '500',
  },
  progressContainer: {
    paddingTop: 20,
    gap: 8,
  },
  progressLabel: {
    fontSize: 13,
    textAlign: 'center',
  },
});
