/**
 * SendHeader — Step indicator dots + back navigation + error icon.
 * Receives `step` as a prop from the route (no longer reads from store).
 * Back arrow only — no close (X) button.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks';
import { useSendStore } from '../../stores/sendStore';
import type { SendStep } from '../../stores/sendStore';

const STEPS: SendStep[] = ['recipient', 'amount', 'review'];

const STEP_LABELS: Record<SendStep, string> = {
  recipient: 'Recipient',
  amount: 'Amount',
  review: 'Review',
  broadcasting: 'Sending',
  success: 'Done',
  psbt: 'Export',
};

interface SendHeaderProps {
  step: SendStep;
  onClose: () => void;
  onErrorPress?: () => void;
}

export function SendHeader({ step, onClose, onErrorPress }: SendHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const error = useSendStore((s) => s.error);
  const errorLevel = useSendStore((s) => s.errorLevel);

  const currentIndex = STEPS.indexOf(step);
  const showDots = STEPS.includes(step);

  // Back button navigates back; if nothing to go back to, go home
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      onClose();
    }
  };

  // Error icon color: red for errors, orange for warnings
  const errorIconColor = errorLevel === 'warning' ? '#FF9F0A' : '#FF453A';
  const errorIconName = errorLevel === 'warning' ? 'warning' : 'alert-circle';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Left: Back arrow */}
      <TouchableOpacity
        style={styles.navButton}
        onPress={handleBack}
        activeOpacity={0.6}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>

      {/* Center: Step dots + label */}
      <View style={styles.center}>
        {showDots && (
          <View style={styles.dotsRow}>
            {STEPS.map((s, i) => (
              <View
                key={s}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i <= currentIndex
                        ? colors.text
                        : colors.fillTertiary,
                  },
                ]}
              />
            ))}
          </View>
        )}
        <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>
          {STEP_LABELS[step]}
        </Text>
      </View>

      {/* Right: Error icon or spacer */}
      <View style={styles.navButton}>
        {error && onErrorPress ? (
          <TouchableOpacity
            style={styles.errorButton}
            onPress={onErrorPress}
            activeOpacity={0.6}
          >
            <Ionicons name={errorIconName} size={20} color={errorIconColor} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  errorButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
