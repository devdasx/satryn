/**
 * Entropy Collection Modal
 * Bottom sheet modal for collecting user entropy via various methods
 * Design: Premium banking / Apple Wallet style
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import {
  EntropyMethod,
  EntropyResult,
  TouchPoint,
  EntropyService,
  EntropyCollector,
} from '../../services/entropy';
import { AppBottomSheet } from '../ui';
import { EntropyProgress } from './EntropyProgress';
import { TouchEntropyCollector } from './TouchEntropyCollector';
import { CoinFlipCollector } from './CoinFlipCollector';
import { DiceRollCollector } from './DiceRollCollector';
import { NumbersCollector } from './NumbersCollector';

interface EntropyCollectionModalProps {
  visible: boolean;
  method: EntropyMethod;
  seedLength: 12 | 24;
  onComplete: (result: EntropyResult) => void;
  onCancel: () => void;
  isDark: boolean;
}

export function EntropyCollectionModal({
  visible,
  method,
  seedLength,
  onComplete,
  onCancel,
  isDark,
}: EntropyCollectionModalProps) {
  const config = EntropyService.METHOD_CONFIGS[method];
  const targetInputs = EntropyService.getMinInputsRequired(method, seedLength);

  // Collection state based on method
  const [touchPoints, setTouchPoints] = useState<TouchPoint[]>([]);
  const [coinFlips, setCoinFlips] = useState<string[]>([]);
  const [diceRolls, setDiceRolls] = useState<number[]>([]);
  const [numberText, setNumberText] = useState('');

  // Track progress
  const [currentInputs, setCurrentInputs] = useState(0);
  const lastMilestone = useRef(0);

  // Calculate current inputs based on method
  useEffect(() => {
    let count = 0;
    switch (method) {
      case 'touch':
        count = touchPoints.length;
        break;
      case 'coinFlips':
        count = coinFlips.length;
        break;
      case 'diceRolls':
        count = diceRolls.length;
        break;
      case 'numbers':
        count = numberText.replace(/\s/g, '').length;
        break;
    }
    setCurrentInputs(count);

    // Haptic feedback at milestones
    const percentage = Math.floor((count / targetInputs) * 100);
    const milestone = Math.floor(percentage / 25) * 25;
    if (milestone > lastMilestone.current && milestone <= 100) {
      if (milestone === 100) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      lastMilestone.current = milestone;
    }
  }, [touchPoints, coinFlips, diceRolls, numberText, method, targetInputs]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setTouchPoints([]);
      setCoinFlips([]);
      setDiceRolls([]);
      setNumberText('');
      setCurrentInputs(0);
      lastMilestone.current = 0;
    }
  }, [visible]);

  const isComplete = currentInputs >= targetInputs;

  const handleDone = useCallback(async () => {
    if (!isComplete) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let result: EntropyResult;
    switch (method) {
      case 'touch':
        result = await EntropyCollector.processTouchEntropy(touchPoints);
        break;
      case 'coinFlips':
        result = await EntropyCollector.processCoinFlips(coinFlips);
        break;
      case 'diceRolls':
        result = await EntropyCollector.processDiceRolls(diceRolls);
        break;
      case 'numbers':
        result = await EntropyCollector.processNumbers(numberText);
        break;
    }

    onComplete(result);
  }, [isComplete, method, touchPoints, coinFlips, diceRolls, numberText, onComplete]);

  const handleCancel = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  }, [onCancel]);

  // Generate subtitle based on method
  const getSubtitle = (): string => {
    switch (method) {
      case 'touch':
        return 'Tap anywhere to generate randomness';
      case 'coinFlips':
        return 'Record heads or tails for each flip';
      case 'diceRolls':
        return 'Enter your dice roll results';
      case 'numbers':
        return 'Type random numbers for entropy';
      default:
        return 'Collect entropy for your wallet';
    }
  };

  const renderCollector = () => {
    switch (method) {
      case 'touch':
        return (
          <TouchEntropyCollector
            targetPoints={targetInputs}
            onPointsUpdate={setTouchPoints}
            isDark={isDark}
          />
        );
      case 'coinFlips':
        return (
          <CoinFlipCollector
            targetFlips={targetInputs}
            onFlipsUpdate={setCoinFlips}
            isDark={isDark}
          />
        );
      case 'diceRolls':
        return (
          <DiceRollCollector
            targetRolls={targetInputs}
            onRollsUpdate={setDiceRolls}
            isDark={isDark}
          />
        );
      case 'numbers':
        return (
          <NumbersCollector
            targetChars={targetInputs}
            onTextUpdate={setNumberText}
            isDark={isDark}
          />
        );
    }
  };

  // Render footer with Cancel and Done buttons - Vertically stacked, smaller size
  const renderFooter = () => (
    <View style={styles.footerButtons}>
      {/* Primary: Done button */}
      <TouchableOpacity
        onPress={handleDone}
        disabled={!isComplete}
        style={[
          styles.doneButton,
          {
            backgroundColor: isComplete
              ? isDark
                ? '#FFFFFF'
                : '#0D0D0D'
              : isDark
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.08)',
          },
        ]}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.doneButtonText,
            {
              color: isComplete
                ? isDark
                  ? '#000000'
                  : '#FFFFFF'
                : isDark
                ? 'rgba(255,255,255,0.25)'
                : 'rgba(0,0,0,0.2)',
            },
          ]}
        >
          Done
        </Text>
      </TouchableOpacity>

      {/* Secondary: Cancel button */}
      <TouchableOpacity
        onPress={handleCancel}
        style={[
          styles.cancelButton,
          {
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
          },
        ]}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.cancelButtonText,
            { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' },
          ]}
        >
          Cancel
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <AppBottomSheet
      visible={visible}
      onClose={handleCancel}
      title={config.name}
      subtitle={getSubtitle()}
      sizing="auto"
      dismissible={false}
      footer={renderFooter()}
    >
      <View style={styles.content}>
        {/* Progress indicator */}
        <View style={styles.progressHeader}>
          <EntropyProgress
            current={currentInputs}
            target={targetInputs}
            size={64}
            strokeWidth={5}
            isDark={isDark}
          />
        </View>

        {/* Collector content */}
        {renderCollector()}
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 28,
  },
  progressHeader: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerButtons: {
    flexDirection: 'column',
    gap: 10,
    paddingHorizontal: 28,
  },
  doneButton: {
    height: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  cancelButton: {
    height: 45,
    borderRadius: 24,
    borderWidth: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.05,
  },
});
