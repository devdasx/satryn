/**
 * PasswordInputSheet — Premium password entry for Preserve Data encryption
 *
 * Two modes:
 *   - 'create': User sets a new password (with confirmation field)
 *   - 'verify': User enters existing password to decrypt
 *
 * The password is used as the key material for PBKDF2 encryption of wallet
 * archives stored in the iOS Keychain.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { PremiumInput } from '../ui/PremiumInput';
import { useTheme, useHaptics } from '../../hooks';
import { THEME } from '../../constants';

// ─── Types ──────────────────────────────────────────────────────

interface PasswordInputSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
  mode: 'create' | 'verify';
  title?: string;
  subtitle?: string;
}

const MIN_PASSWORD_LENGTH = 6;

// ─── Animated Icon ──────────────────────────────────────────────

function ShieldIcon({ isDark, mode }: { isDark: boolean; mode: 'create' | 'verify' }) {
  const glowOpacity = useSharedValue(0.3);

  useEffect(() => {
    glowOpacity.value = withRepeat(
      withTiming(0.7, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const accentColor = mode === 'create' ? '#FF9F0A' : '#5E5CE6';

  return (
    <View style={iconStyles.container}>
      <Animated.View style={[iconStyles.glowCircle, animatedGlow, {
        backgroundColor: isDark ? `${accentColor}12` : `${accentColor}08`,
      }]} />
      <View style={[iconStyles.iconCircle, {
        backgroundColor: isDark ? `${accentColor}20` : `${accentColor}14`,
      }]}>
        <Ionicons
          name={mode === 'create' ? 'key' : 'lock-open'}
          size={26}
          color={accentColor}
        />
      </View>
    </View>
  );
}

const iconStyles = StyleSheet.create({
  container: {
    width: 76,
    height: 76,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  glowCircle: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─── Password Strength ──────────────────────────────────────────

function getStrength(password: string): { label: string; color: string; width: number } {
  if (password.length === 0) return { label: '', color: 'transparent', width: 0 };
  if (password.length < MIN_PASSWORD_LENGTH) return { label: 'Too short', color: '#FF453A', width: 15 };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { label: 'Weak', color: '#FF9F0A', width: 33 };
  if (score <= 3) return { label: 'Good', color: '#30D158', width: 66 };
  return { label: 'Strong', color: '#30D158', width: 100 };
}

// ─── Component ──────────────────────────────────────────────────

export function PasswordInputSheet({
  visible,
  onClose,
  onSubmit,
  mode,
  title,
  subtitle,
}: PasswordInputSheetProps) {
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const shakeX = useSharedValue(0);

  // Reset state when sheet opens
  useEffect(() => {
    if (visible) {
      setPassword('');
      setConfirmPassword('');
      setError(null);
      setTimeout(() => passwordRef.current?.focus(), 400);
    }
  }, [visible]);

  const animatedShake = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (mode === 'create') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        triggerShake();
        await haptics.trigger('error');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        triggerShake();
        await haptics.trigger('error');
        return;
      }
    } else {
      if (password.length === 0) {
        setError('Please enter your password');
        triggerShake();
        await haptics.trigger('error');
        return;
      }
    }

    await haptics.trigger('success');
    onSubmit(password);
  }, [password, confirmPassword, mode, onSubmit, haptics, triggerShake]);

  const strength = mode === 'create' ? getStrength(password) : null;
  const isValid = mode === 'create'
    ? password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword
    : password.length > 0;

  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  const defaultTitle = mode === 'create' ? 'Create Encryption Password' : 'Enter Password';
  const defaultSubtitle = mode === 'create'
    ? 'This password encrypts your preserved wallet data'
    : 'Enter the password used to encrypt your data';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      sizing="auto"
      dismissible={true}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <Animated.View style={[styles.container, animatedShake]}>
          {/* Icon */}
          <ShieldIcon isDark={isDark} mode={mode} />

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {title || defaultTitle}
          </Text>
          <Text style={[styles.subtitle, {
            color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
          }]}>
            {subtitle || defaultSubtitle}
          </Text>

          {/* Password field */}
          <View style={[styles.inputCard, { backgroundColor: surfaceBg }]}>
            <PremiumInput
              ref={passwordRef}
              icon="key"
              iconColor="#FF9F0A"
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              returnKeyType={mode === 'create' ? 'next' : 'done'}
              onSubmitEditing={() => {
                if (mode === 'create') confirmRef.current?.focus();
                else handleSubmit();
              }}
            />

            {/* Strength indicator (create mode) */}
            {mode === 'create' && strength && password.length > 0 && (
              <View style={styles.strengthRow}>
                <View style={[styles.strengthTrack, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }]}>
                  <Animated.View style={[styles.strengthFill, {
                    backgroundColor: strength.color,
                    width: `${strength.width}%` as any,
                  }]} />
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>
                  {strength.label}
                </Text>
              </View>
            )}

            {/* Confirm password (create mode) */}
            {mode === 'create' && (
              <>
                <View style={[styles.inputDivider, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                }]} />
                <PremiumInput
                  ref={confirmRef}
                  icon="shield-checkmark"
                  iconColor="#5E5CE6"
                  placeholder="Confirm password"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
              </>
            )}
          </View>

          {/* Error message */}
          {error && (
            <Animated.View
              entering={FadeInDown.duration(200)}
              style={[styles.errorRow, {
                backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.04)',
              }]}
            >
              <Ionicons name="alert-circle" size={14} color="#FF453A" />
              <Text style={[styles.errorText, {
                color: isDark ? 'rgba(255,69,58,0.90)' : '#FF453A',
              }]}>
                {error}
              </Text>
            </Animated.View>
          )}

          {/* Info note */}
          <Text style={[styles.infoNote, {
            color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
          }]}>
            {mode === 'create'
              ? 'Remember this password — it cannot be recovered. You will need it to restore your data after reinstalling.'
              : 'Enter the password you used when enabling Preserve Data.'
            }
          </Text>

          {/* Submit button */}
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.7}
            style={[styles.primaryButton, {
              backgroundColor: isValid
                ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
                : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
            }]}
          >
            <Text style={[styles.primaryButtonText, {
              color: isValid
                ? '#FFFFFF'
                : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'),
            }]}>
              {mode === 'create' ? 'Encrypt & Preserve' : 'Decrypt Data'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  // Input card
  inputCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
  },
  inputDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
    marginRight: 16,
  },

  // Strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  strengthTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 55,
    textAlign: 'right',
  },

  // Error
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },

  // Info note
  infoNote: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  // Button
  primaryButton: {
    height: 50,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
