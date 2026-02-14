/**
 * PriceChart
 * Premium price chart component using react-native-svg
 * Simple touch interaction without gesture handler to avoid crashes
 * Supports live streaming data with smooth animation
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  LayoutChangeEvent,
  PanResponder,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
  useDerivedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import { THEME, getColors } from '../../constants';
import type { PricePoint } from '../../services/api/MarketAPI';

// Create animated components
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface PriceChartProps {
  data: PricePoint[];
  isLoading?: boolean;
  isPositive?: boolean;
  onPriceSelect?: (price: number | null, timestamp: number | null) => void;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  height?: number;
  isLive?: boolean;
}

const CHART_PADDING = { top: 20, bottom: 20, left: 0, right: 0 };

// Animation duration for smooth transitions
const LIVE_ANIMATION_DURATION = 400;

export function PriceChart({
  data,
  isLoading = false,
  isPositive = true,
  onPriceSelect,
  onTouchStart,
  onTouchEnd,
  height = 220,
  isLive = false,
}: PriceChartProps) {
  const { colors, isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const [chartWidth, setChartWidth] = useState(Dimensions.get('window').width);
  const [touchPosition, setTouchPosition] = useState<{ x: number; y: number } | null>(null);
  const lastHapticIndex = useRef<number>(-1);

  // Animated values for smooth live chart transitions
  const animatedProgress = useSharedValue(1);
  const prevPathRef = useRef<string>('');
  const prevAreaPathRef = useRef<string>('');
  const prevLastPointRef = useRef<{ x: number; y: number }>({ x: 0, y: height / 2 });

  // Pulsing animation for live indicator
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.3);

  // Animated last point position
  const animatedLastX = useSharedValue(0);
  const animatedLastY = useSharedValue(height / 2);

  // Start pulsing animation when in live mode
  useEffect(() => {
    if (isLive) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.8, { duration: 800, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.in(Easing.ease) })
        ),
        -1,
        false
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 800, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 800, easing: Easing.in(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      pulseScale.value = 1;
      pulseOpacity.value = 0.3;
    }
  }, [isLive, pulseScale, pulseOpacity]);

  // Animated props for the pulsing outer circle
  const pulseAnimatedProps = useAnimatedProps(() => {
    return {
      r: 8 * pulseScale.value,
      opacity: pulseOpacity.value,
    };
  });

  // Calculate chart dimensions
  const chartHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const innerWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right;

  // Process data for chart
  const chartData = useMemo(() => {
    if (!data || data.length < 2) {
      return { path: '', areaPath: '', minPrice: 0, maxPrice: 0, points: [] as { x: number; y: number }[] };
    }

    const prices = data.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    // Create points array
    const points = data.map((point, index) => {
      const x = CHART_PADDING.left + (index / Math.max(data.length - 1, 1)) * innerWidth;
      const y = CHART_PADDING.top + chartHeight - ((point.price - minPrice) / priceRange) * chartHeight;
      return { x, y };
    });

    // Line path
    let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }

    // Area path (for gradient fill)
    let areaPath = path;
    areaPath += ` L ${points[points.length - 1].x.toFixed(2)} ${height}`;
    areaPath += ` L ${points[0].x.toFixed(2)} ${height}`;
    areaPath += ' Z';

    return { path, areaPath, minPrice, maxPrice, points };
  }, [data, chartHeight, innerWidth, height]);

  // Animate smoothly when data changes in live mode
  useEffect(() => {
    if (isLive && chartData.points.length > 0) {
      const lastPoint = chartData.points[chartData.points.length - 1];

      // Animate the last point position smoothly
      animatedLastX.value = withTiming(lastPoint.x, {
        duration: LIVE_ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
      });
      animatedLastY.value = withTiming(lastPoint.y, {
        duration: LIVE_ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
      });

      // Store previous values for interpolation
      prevPathRef.current = chartData.path;
      prevAreaPathRef.current = chartData.areaPath;
      prevLastPointRef.current = lastPoint;
    }
  }, [chartData, isLive, animatedLastX, animatedLastY]);

  // Animated props for the live indicator circle position
  const liveCircleAnimatedProps = useAnimatedProps(() => {
    return {
      cx: animatedLastX.value,
      cy: animatedLastY.value,
    };
  });

  // Handle layout
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setChartWidth(width);
  }, []);

  // Get data at x position
  const getDataAtX = useCallback((x: number): { price: number; timestamp: number; y: number; pointX: number; index: number } | null => {
    if (!data || data.length === 0 || chartData.points.length === 0) return null;

    const normalizedX = Math.max(0, Math.min(innerWidth, x - CHART_PADDING.left));
    const index = Math.round((normalizedX / innerWidth) * (data.length - 1));
    const clampedIndex = Math.max(0, Math.min(data.length - 1, index));

    return {
      price: data[clampedIndex].price,
      timestamp: data[clampedIndex].timestamp,
      y: chartData.points[clampedIndex]?.y ?? height / 2,
      pointX: chartData.points[clampedIndex]?.x ?? x,
      index: clampedIndex,
    };
  }, [data, innerWidth, chartData.points, height]);

  // PanResponder for touch interaction
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      onTouchStart?.();
      lastHapticIndex.current = -1;
      const x = evt.nativeEvent.locationX;
      const result = getDataAtX(x);
      if (result) {
        setTouchPosition({ x: result.pointX, y: result.y });
        lastHapticIndex.current = result.index;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPriceSelect?.(result.price, result.timestamp);
      }
    },
    onPanResponderMove: (evt) => {
      const x = evt.nativeEvent.locationX;
      const result = getDataAtX(x);
      if (result) {
        setTouchPosition({ x: result.pointX, y: result.y });
        if (result.index !== lastHapticIndex.current) {
          lastHapticIndex.current = result.index;
          Haptics.selectionAsync();
        }
        onPriceSelect?.(result.price, result.timestamp);
      }
    },
    onPanResponderRelease: () => {
      onTouchEnd?.();
      setTouchPosition(null);
      onPriceSelect?.(null, null);
    },
    onPanResponderTerminate: () => {
      onTouchEnd?.();
      setTouchPosition(null);
      onPriceSelect?.(null, null);
    },
  }), [getDataAtX, onPriceSelect, onTouchStart, onTouchEnd]);

  // Colors based on price direction
  const lineColor = isPositive ? c.priceChart.lineUp : c.priceChart.lineDown;

  const gradientId = isPositive ? 'chartGradientPositive' : 'chartGradientNegative';

  // Loading skeleton
  if (isLoading || !data || data.length === 0) {
    return (
      <View style={[styles.container, { height }]} onLayout={onLayout}>
        <View style={[styles.skeleton, { backgroundColor: colors.glass }]}>
          <Svg width={chartWidth} height={height}>
            <Path
              d={`M 0 ${height / 2} Q ${chartWidth / 4} ${height / 3}, ${chartWidth / 2} ${height / 2} T ${chartWidth} ${height / 2}`}
              stroke={colors.border}
              strokeWidth={2}
              fill="none"
              opacity={0.3}
            />
          </Svg>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      <View style={styles.chartArea} {...panResponder.panHandlers}>
        <Svg width={chartWidth} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
              <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
            </LinearGradient>
          </Defs>

          {/* Area fill */}
          <Path
            d={chartData.areaPath}
            fill={`url(#${gradientId})`}
          />

          {/* Price line */}
          <Path
            d={chartData.path}
            stroke={lineColor}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Live indicator at the last point - animated position */}
          {isLive && chartData.points.length > 0 && !touchPosition && (
            <>
              {/* Pulsing outer circle - animated */}
              <AnimatedCircle
                fill={c.semantic.error}
                animatedProps={{
                  ...pulseAnimatedProps,
                  ...liveCircleAnimatedProps,
                }}
              />
              {/* Inner solid red dot - animated position */}
              <AnimatedCircle
                r={4}
                fill={c.semantic.error}
                animatedProps={liveCircleAnimatedProps}
              />
            </>
          )}

          {/* Touch cursor */}
          {touchPosition && (
            <>
              <Line
                x1={touchPosition.x}
                y1={CHART_PADDING.top}
                x2={touchPosition.x}
                y2={height - CHART_PADDING.bottom}
                stroke={colors.textTertiary}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <Circle
                cx={touchPosition.x}
                cy={touchPosition.y}
                r={6}
                fill={lineColor}
                stroke={colors.surface}
                strokeWidth={2}
              />
            </>
          )}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  chartArea: {
    flex: 1,
  },
  skeleton: {
    flex: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
