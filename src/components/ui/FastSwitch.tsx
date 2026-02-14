import React, { useState, useEffect, useCallback } from 'react';
import { Switch, type SwitchProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../../stores';
import { useTheme } from '../../hooks';

/**
 * FastSwitch — premium toggle with built-in haptics and consistent styling.
 *
 * Features:
 * - Instant visual response via local state mirror
 * - Built-in haptic feedback (selection) on every toggle
 * - Theme-aware track + thumb colors by default
 * - Optional `accentColor` to override the on-state track color
 */

export interface FastSwitchProps extends Omit<SwitchProps, 'trackColor' | 'thumbColor'> {
  /** Custom on-state track color (default: #30D158 green) */
  accentColor?: string;
  /** Override track colors if you need full control */
  trackColor?: SwitchProps['trackColor'];
  /** Override thumb color */
  thumbColor?: string;
}

export function FastSwitch({
  value,
  onValueChange,
  accentColor,
  trackColor: trackColorOverride,
  thumbColor: thumbColorOverride,
  ...rest
}: FastSwitchProps) {
  const [localValue, setLocalValue] = useState(value ?? false);
  const hapticsEnabled = useSettingsStore(s => s.hapticsEnabled);
  const { isDark } = useTheme();

  // Sync parent → local when the parent value changes
  useEffect(() => {
    setLocalValue(value ?? false);
  }, [value]);

  const handleValueChange = useCallback((newValue: boolean) => {
    setLocalValue(newValue); // Instant visual update

    // Haptic feedback on every toggle
    if (hapticsEnabled) {
      Haptics.selectionAsync();
    }

    onValueChange?.(newValue); // Propagate to parent
  }, [onValueChange, hapticsEnabled]);

  // Default premium styling
  const onColor = accentColor ?? '#30D158';
  const offColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';

  return (
    <Switch
      {...rest}
      value={localValue}
      onValueChange={handleValueChange}
      trackColor={trackColorOverride ?? { false: offColor, true: onColor }}
      thumbColor={thumbColorOverride ?? '#FFFFFF'}
    />
  );
}
