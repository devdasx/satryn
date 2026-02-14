/**
 * StepIndicator — Horizontal 3-step progress bar for the Sign Message flow.
 * Shows current, completed, and future steps with labels.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
}

const STEPS = [
  { label: 'Address', icon: 'location-outline' as const },
  { label: 'Message', icon: 'chatbubble-outline' as const },
  { label: 'Sign', icon: 'pencil-outline' as const },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const { isDark } = useTheme();

  // Colors
  const activeColor = '#FFFFFF';
  const activeBg = isDark ? '#FFFFFF' : '#000000';
  const completedBg = isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)';
  const completedColor = '#30D158';
  const futureBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const futureColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)';
  const lineActive = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)';
  const lineInactive = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const labelActive = isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.70)';
  const labelInactive = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)';

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: currentStep, min: 1, max: 3 }}
    >
      {STEPS.map((step, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;
        const isFuture = stepNum > currentStep;

        // Circle styling
        let circleBg: string;
        let circleContent: React.ReactNode;

        if (isCompleted) {
          circleBg = completedBg;
          circleContent = <Ionicons name="checkmark" size={12} color={completedColor} />;
        } else if (isActive) {
          circleBg = activeBg;
          circleContent = (
            <Text style={[styles.stepNumber, { color: isDark ? '#000000' : '#FFFFFF' }]}>
              {stepNum}
            </Text>
          );
        } else {
          circleBg = futureBg;
          circleContent = (
            <Text style={[styles.stepNumber, { color: futureColor }]}>
              {stepNum}
            </Text>
          );
        }

        return (
          <React.Fragment key={step.label}>
            {/* Connector line (before each step except first) */}
            {idx > 0 && (
              <View
                style={[styles.line, {
                  backgroundColor: isCompleted || isActive ? lineActive : lineInactive,
                }]}
              />
            )}

            {/* Step circle + label */}
            <View style={styles.stepColumn}>
              <View style={[styles.circle, { backgroundColor: circleBg }]}>
                {circleContent}
              </View>
              <Text
                style={[styles.label, {
                  color: isActive ? labelActive : labelInactive,
                  fontWeight: isActive ? '600' : '400',
                }]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 12,
    marginBottom: 8,
  },
  stepColumn: {
    alignItems: 'center',
    width: 56,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    marginTop: 6,
    letterSpacing: -0.1,
  },
  line: {
    flex: 1,
    height: 1,
    marginTop: 12, // Vertically center with circle
    marginHorizontal: 4,
  },
});
