/**
 * ConnectionProgressSheet — Step-based connection progress visualization
 *
 * Shows the ElectrumClient 6-state FSM as a 4-step progress sequence:
 *   1. Resolving server...
 *   2. Establishing connection...
 *   3. Handshaking...
 *   4. Connected!
 *
 * Auto-dismisses on success, shows retry on failure.
 * Premium, minimal design matching the app's black-first brand.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  cancelAnimation,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import { AppBottomSheet } from './ui/AppBottomSheet';
import { useTheme, useHaptics } from '../hooks';
import { ElectrumAPI } from '../services/electrum/ElectrumAPI';
import type { ConnectionState } from '../services/electrum/types';

// ─── Types ──────────────────────────────────────────────────────

interface ConnectionProgressSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
  targetServer?: { host: string; port: number; ssl: boolean } | null;
}

type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StepConfig {
  label: string;
  icon: string;
}

const STEPS: StepConfig[] = [
  { label: 'Resolving server', icon: 'globe-outline' },
  { label: 'Establishing connection', icon: 'link-outline' },
  { label: 'Handshaking', icon: 'shield-checkmark-outline' },
  { label: 'Connected', icon: 'checkmark-circle' },
];

// Minimum display time per step to prevent steps flying by
const MIN_STEP_DURATION = 400;
const POLL_INTERVAL = 300;
const SUCCESS_DISMISS_DELAY = 1200;

// Map FSM state to step index
function fsmToStepIndex(state: ConnectionState): number {
  switch (state) {
    case 'disconnected': return 0;
    case 'connecting': return 1;
    case 'handshaking': return 2;
    case 'ready': return 3;
    case 'draining': return 3;
    case 'error': return -1; // Special: failed
    default: return 0;
  }
}

// ─── Animated Step Row ──────────────────────────────────────────

function AnimatedStepRow({
  step,
  index,
  status,
  isDark,
  colors,
}: {
  step: StepConfig;
  index: number;
  status: StepStatus;
  isDark: boolean;
  colors: { text: string; textMuted: string };
}) {
  const pulseOpacity = useSharedValue(1);
  const checkScale = useSharedValue(0);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      checkScale.value = 0;
    } else if (status === 'completed') {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      checkScale.value = withSpring(1, { damping: 12 });
    } else if (status === 'failed') {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(1, { duration: 200 });
      shakeX.value = withSequence(
        withTiming(-4, { duration: 50 }),
        withTiming(4, { duration: 50 }),
        withTiming(-4, { duration: 50 }),
        withTiming(0, { duration: 50 })
      );
    } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = 1;
      checkScale.value = 0;
    }

    return () => {
      cancelAnimation(pulseOpacity);
    };
  }, [status]);

  const animatedPulse = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const animatedCheck = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const animatedShake = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  // Colors per status
  const circleColor =
    status === 'completed'
      ? '#30D158'
      : status === 'failed'
      ? '#FF453A'
      : status === 'active'
      ? (isDark ? '#FFFFFF' : '#000000')
      : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)');

  const circleBg =
    status === 'completed'
      ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
      : status === 'failed'
      ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
      : status === 'active'
      ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
      : 'transparent';

  const labelColor =
    status === 'completed'
      ? '#30D158'
      : status === 'failed'
      ? '#FF453A'
      : status === 'active'
      ? colors.text
      : colors.textMuted;

  return (
    <Animated.View style={[styles.stepRow, animatedShake]}>
      {/* Circle indicator */}
      <Animated.View
        style={[
          styles.stepCircle,
          { backgroundColor: circleBg, borderColor: circleColor },
          status === 'active' && animatedPulse,
        ]}
      >
        {status === 'completed' ? (
          <Animated.View style={animatedCheck}>
            <Ionicons name="checkmark" size={16} color="#30D158" />
          </Animated.View>
        ) : status === 'failed' ? (
          <Ionicons name="close" size={16} color="#FF453A" />
        ) : status === 'active' ? (
          <ActivityIndicator size={14} color={isDark ? '#FFFFFF' : '#000000'} />
        ) : (
          <Text style={[styles.stepNumber, { color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)' }]}>
            {index + 1}
          </Text>
        )}
      </Animated.View>

      {/* Label */}
      <Text style={[styles.stepLabel, { color: labelColor }]}>
        {status === 'active' ? `${step.label}...` : step.label}
      </Text>

      {/* Right side indicator for active */}
      {status === 'active' && (
        <Animated.View style={[styles.stepActiveIndicator, animatedPulse]}>
          <View style={[styles.stepActiveDot, {
            backgroundColor: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.20)',
          }]} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function ConnectionProgressSheet({
  visible,
  onClose,
  onComplete,
  targetServer,
}: ConnectionProgressSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [currentStep, setCurrentStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepChangeRef = useRef<number>(Date.now());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTriggeredComplete = useRef(false);

  // Reset state when sheet becomes visible
  useEffect(() => {
    if (visible) {
      setCurrentStep(0);
      setFailed(false);
      setErrorMessage(null);
      setCompleted(false);
      lastStepChangeRef.current = Date.now();
      hasTriggeredComplete.current = false;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [visible]);

  // Poll ElectrumClient FSM state
  useEffect(() => {
    if (!visible) return;

    const poll = () => {
      try {
        const api = ElectrumAPI.shared('mainnet');
        const client = api.getClient();
        const state = client.getState();
        const targetStep = fsmToStepIndex(state);

        if (targetStep === -1) {
          // Error state
          setFailed(true);
          const diag = client.getDiagnostics();
          setErrorMessage(
            diag.server
              ? `Connection to ${diag.server} failed`
              : 'Connection failed'
          );
          haptics.trigger('error');

          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }

        // Enforce minimum step duration
        const now = Date.now();
        const elapsed = now - lastStepChangeRef.current;

        if (targetStep > currentStep && elapsed >= MIN_STEP_DURATION) {
          setCurrentStep(targetStep);
          lastStepChangeRef.current = now;

          // Completed!
          if (targetStep === 3 && !hasTriggeredComplete.current) {
            hasTriggeredComplete.current = true;
            setCompleted(true);
            haptics.trigger('success');

            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            // Auto-dismiss after delay
            dismissTimerRef.current = setTimeout(() => {
              onComplete?.();
              onClose();
            }, SUCCESS_DISMISS_DELAY);
          }
        }
      } catch {
        // API not ready
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);
    // Initial poll
    poll();

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [visible, currentStep, haptics, onClose, onComplete]);

  const handleRetry = useCallback(async () => {
    setFailed(false);
    setErrorMessage(null);
    setCurrentStep(0);
    lastStepChangeRef.current = Date.now();
    hasTriggeredComplete.current = false;
    haptics.trigger('light');

    try {
      const api = ElectrumAPI.shared('mainnet');
      api.disconnect();
      // connect() will re-trigger the FSM which our poll will track
      api.connect().catch(() => {
        // Error will be caught by poll
      });
    } catch {
      // ElectrumAPI not ready
    }
  }, [haptics]);

  // Compute step statuses
  const getStepStatus = (index: number): StepStatus => {
    if (failed) {
      if (index < currentStep) return 'completed';
      if (index === currentStep) return 'failed';
      return 'pending';
    }
    if (index < currentStep) return 'completed';
    if (index === currentStep) return completed ? 'completed' : 'active';
    return 'pending';
  };

  const serverDisplay = targetServer
    ? `${targetServer.host}:${targetServer.port}`
    : null;

  const footer = failed ? (
    <View style={styles.footerContainer}>
      <TouchableOpacity
        style={[styles.retryButton, {
          backgroundColor: isDark ? '#FFFFFF' : '#0A0A0A',
        }]}
        onPress={handleRetry}
        activeOpacity={0.85}
      >
        <Ionicons name="refresh" size={17} color={isDark ? '#000000' : '#FFFFFF'} />
        <Text style={[styles.retryText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
          Try Again
        </Text>
      </TouchableOpacity>
    </View>
  ) : undefined;

  // Progress percentage
  const progressPercent = STEPS.reduce((acc, _, i) => {
    const s = getStepStatus(i);
    if (s === 'completed') return acc + 25;
    if (s === 'active') return acc + 12;
    return acc;
  }, 0);

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing="auto"
      dismissible={failed || completed}
      footer={footer}
    >
      <View style={styles.content}>
        {/* Hero icon */}
        <View style={styles.heroContainer}>
          <View style={[styles.heroGlowRing, {
            backgroundColor: isDark
              ? (failed ? 'rgba(255,69,58,0.06)' : completed ? 'rgba(48,209,88,0.06)' : 'rgba(255,255,255,0.03)')
              : (failed ? 'rgba(255,69,58,0.04)' : completed ? 'rgba(48,209,88,0.04)' : 'rgba(0,0,0,0.02)'),
          }]} />
          <View style={[styles.heroGlowCircle, {
            backgroundColor: isDark
              ? (failed ? 'rgba(255,69,58,0.10)' : completed ? 'rgba(48,209,88,0.10)' : 'rgba(255,255,255,0.05)')
              : (failed ? 'rgba(255,69,58,0.07)' : completed ? 'rgba(48,209,88,0.07)' : 'rgba(0,0,0,0.03)'),
          }]} />
          <View style={[styles.heroIconCircle, {
            backgroundColor: isDark
              ? (failed ? 'rgba(255,69,58,0.15)' : completed ? 'rgba(48,209,88,0.15)' : 'rgba(255,255,255,0.08)')
              : (failed ? 'rgba(255,69,58,0.10)' : completed ? 'rgba(48,209,88,0.10)' : 'rgba(0,0,0,0.05)'),
          }]}>
            <Ionicons
              name={failed ? 'alert-circle' : completed ? 'checkmark-circle' : 'globe-outline'}
              size={32}
              color={failed ? '#FF453A' : completed ? '#30D158' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')}
            />
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>
          {completed ? 'Connected' : failed ? 'Connection Failed' : 'Connecting'}
        </Text>
        <Text style={[styles.subtitle, {
          color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
        }]}>
          {serverDisplay || 'Electrum server'}
        </Text>

        {/* Progress bar */}
        <View style={[styles.progressTrack, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        }]}>
          <View style={[styles.progressFill, {
            width: `${progressPercent}%` as any,
            backgroundColor: failed ? '#FF453A' : '#30D158',
          }]} />
        </View>

        {/* Steps card */}
        <View style={[styles.stepsCard, { backgroundColor: surfaceBg }]}>
          {STEPS.map((step, index) => (
            <AnimatedStepRow
              key={index}
              step={step}
              index={index}
              status={getStepStatus(index)}
              isDark={isDark}
              colors={{ text: colors.text, textMuted: colors.textMuted }}
            />
          ))}
        </View>

        {/* Error message */}
        {failed && errorMessage && (
          <Animated.View entering={FadeInDown.duration(300)} style={[styles.errorCard, {
            backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
          }]}>
            <View style={[styles.errorIconCircle, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : 'rgba(255,69,58,0.10)',
            }]}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
            </View>
            <Text style={[styles.errorText, {
              color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A',
            }]}>
              {errorMessage}
            </Text>
          </Animated.View>
        )}
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
  },

  // Hero icon
  heroContainer: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  heroGlowRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  heroGlowCircle: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  heroIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Title
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },

  // Progress bar
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginBottom: 28,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Steps card
  stepsCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },

  // Step row
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  stepCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  stepLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    flex: 1,
  },
  stepActiveIndicator: {
    width: 20,
    alignItems: 'center',
  },
  stepActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
    gap: 12,
  },
  errorIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 20,
  },

  // Footer
  footerContainer: {
    paddingHorizontal: 28,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    gap: 8,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ConnectionProgressSheet;
