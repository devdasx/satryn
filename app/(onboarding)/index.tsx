import '../../shim';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  Dimensions,
  Animated,
  PanResponder,
  Image,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { THEME, getThemeColors } from '../../src/constants';
import type { ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { ICloudService } from '../../src/services/backup';
import { getDeviceId } from '../../src/services/DeviceIdentity';
import { PreservedArchiveService, type PreservedManifest } from '../../src/services/storage/PreservedArchiveService';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { PreserveDataSession } from '../../src/services/auth/PreserveDataSession';
import { PreservedDataRecoverySheet } from '../../src/components/preserve/PreservedDataRecoverySheet';
import { PasswordInputSheet } from '../../src/components/preserve/PasswordInputSheet';
import { RestorationProgressSheet } from '../../src/components/preserve/RestorationProgressSheet';

const SWIPE_THRESHOLD = 50;

// Muted accent color (less saturated orange)
const ACCENT = {
  primary: '#E8913A', // Slightly muted orange for logo only
  subtle: 'rgba(232, 145, 58, 0.08)', // Very subtle for icon backgrounds
  indicator: 'rgba(255, 255, 255, 0.6)', // Neutral for active indicator (dark)
  indicatorLight: 'rgba(0, 0, 0, 0.4)', // Neutral for active indicator (light)
};

// Hero slides - Explain the app comprehensively
const FEATURES = [
  {
    icon: 'shield-checkmark' as const,
    headline: 'Your Keys',
    subline: 'Your Bitcoin',
    description: 'True self-custody. No third parties. No compromises. You own it.',
  },
  {
    icon: 'finger-print' as const,
    headline: 'Secure',
    subline: 'by Design',
    description: 'Face ID, Touch ID, and PIN protection. AES-256 encryption.',
  },
  {
    icon: 'wallet-outline' as const,
    headline: 'Multiple',
    subline: 'Wallets',
    description: 'Create and manage unlimited wallets. Organize your Bitcoin your way.',
  },
  {
    icon: 'swap-horizontal' as const,
    headline: 'Send &',
    subline: 'Receive',
    description: 'Fast transactions. QR codes. Address book. Simple and intuitive.',
  },
  {
    icon: 'people' as const,
    headline: 'Multisig',
    subline: 'Vaults',
    description: 'Shared custody with 2-of-3, 3-of-5, or custom configurations.',
  },
  {
    icon: 'eye-off' as const,
    headline: 'Watch',
    subline: 'Only',
    description: 'Monitor any wallet without exposing private keys. Perfect for cold storage.',
  },
  {
    icon: 'hardware-chip-outline' as const,
    headline: 'Hardware',
    subline: 'Wallets',
    description: 'Connect Ledger, Trezor, or Coldcard. Sign transactions securely.',
  },
  {
    icon: 'document-text-outline' as const,
    headline: 'PSBT',
    subline: 'Support',
    description: 'Create, sign, and broadcast partially signed transactions.',
  },
  {
    icon: 'options-outline' as const,
    headline: 'Coin',
    subline: 'Control',
    description: 'Select specific UTXOs. Optimize fees. Maximize privacy.',
  },
  {
    icon: 'cloud-outline' as const,
    headline: 'iCloud',
    subline: 'Backup',
    description: 'Encrypted backups to iCloud. Restore on any device seamlessly.',
  },
  {
    icon: 'code-slash' as const,
    headline: 'Open',
    subline: 'Source',
    description: 'Fully auditable code. Transparent. Community-driven development.',
  },
];

const AUTO_ADVANCE_INTERVAL = 5000;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Get theme setting from store to respect app's theme preference
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [backupCount, setBackupCount] = useState(0);

  // Preserved data recovery state
  const [preservedManifest, setPreservedManifest] = useState<PreservedManifest | null>(null);
  const [showRecoverySheet, setShowRecoverySheet] = useState(false);
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);
  const [showRestoreProgress, setShowRestoreProgress] = useState(false);
  const [verifiedPassword, setVerifiedPassword] = useState<string | null>(null);
  // Track whether the password was submitted (vs user swiping down to dismiss)
  const passwordSubmittedRef = useRef(false);

  // Check iCloud for existing backups on mount (device-specific)
  useEffect(() => {
    (async () => {
      try {
        const deviceId = await getDeviceId();
        const individual = ICloudService.getBackupCount(deviceId);
        const full = ICloudService.getFullBackupCount(deviceId);
        setBackupCount(individual + full);
      } catch {
        // iCloud not available
      }
    })();
  }, []);

  // Check for preserved data on mount
  useEffect(() => {
    (async () => {
      try {
        const { available, manifest } = await PreservedArchiveService.hasPreservedData();
        const dismissed = await SecureStore.getItemAsync('preserved_recovery_dismissed', {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }).catch(() => null);

        if (available && manifest && dismissed !== 'true') {
          setPreservedManifest(manifest);
          // Small delay to let the screen render first
          setTimeout(() => setShowRecoverySheet(true), 600);
        }
      } catch {
        // Keychain not available
      }
    })();
  }, []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSlideRef = useRef(activeSlide);
  const swipeHandlerRef = useRef<((dx: number) => void) | undefined>(undefined);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  const styles = createStyles(colors, isDark, insets);

  // Animate slide transition
  const animateTransition = useCallback((toIndex: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.97,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnim, {
        toValue: -6,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setActiveSlide(toIndex);
      translateYAnim.setValue(6);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [fadeAnim, scaleAnim, translateYAnim]);

  // Keep refs in sync
  useEffect(() => {
    activeSlideRef.current = activeSlide;
  }, [activeSlide]);

  // Update swipe handler ref with latest animateTransition
  useEffect(() => {
    swipeHandlerRef.current = (dx: number) => {
      const currentSlide = activeSlideRef.current;
      if (dx < -SWIPE_THRESHOLD) {
        const nextIndex = (currentSlide + 1) % FEATURES.length;
        Haptics.selectionAsync();
        animateTransition(nextIndex);
      } else if (dx > SWIPE_THRESHOLD) {
        const prevIndex = (currentSlide - 1 + FEATURES.length) % FEATURES.length;
        Haptics.selectionAsync();
        animateTransition(prevIndex);
      }
      setIsPaused(true);
      setTimeout(() => setIsPaused(false), 3000);
    };
  }, [animateTransition]);

  // Pan responder for swipe - calls ref which always has latest handler
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 10,
      onPanResponderGrant: () => {},
      onPanResponderRelease: (_, gestureState) => {
        swipeHandlerRef.current?.(gestureState.dx);
      },
    })
  ).current;

  // Auto-advance
  useEffect(() => {
    if (isPaused) return;

    timerRef.current = setTimeout(() => {
      const nextIndex = (activeSlide + 1) % FEATURES.length;
      animateTransition(nextIndex);
    }, AUTO_ADVANCE_INTERVAL);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeSlide, isPaused, animateTransition]);

  const handleIndicatorPress = useCallback((index: number) => {
    if (index === activeSlide) return;
    Haptics.selectionAsync();
    setIsPaused(true);
    animateTransition(index);
    setTimeout(() => setIsPaused(false), 3000);
  }, [activeSlide, animateTransition]);

  const currentFeature = FEATURES[activeSlide];

  return (
    <View style={styles.container}>
      {/* Background */}
      <LinearGradient
        colors={isDark ? ['#000000', '#050505'] : ['#FAFAFA', '#F2F2F7']}
        style={StyleSheet.absoluteFill}
      />

      {/* Content */}
      <View style={styles.content}>
        {/* Brand Header - App Logo + Skip */}
        <View style={styles.brandHeader}>
          <Image
            source={isDark ? require('../../darkLogo.png') : require('../../appLogo.png')}
            style={styles.appLogo}
            resizeMode="contain"
          />
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: '/(onboarding)/pin', params: { skipMode: 'true' } });
            }}
            activeOpacity={0.6}
            style={[styles.discoverCapsule, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
          >
            <Text style={[styles.discoverCapsuleText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)' }]}>
              Discover App
            </Text>
          </TouchableOpacity>
        </View>

        {/* Hero Slider */}
        <View style={styles.sliderContainer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.sliderContent,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }, { translateY: translateYAnim }],
              },
            ]}
          >
            {/* Icon - Premium, intentional container */}
            <View style={[styles.sliderIcon, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            }]}>
              <Ionicons
                name={currentFeature.icon}
                size={30}
                color={isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'}
              />
            </View>

            {/* Headlines - Refined typography */}
            <View style={styles.headlineContainer}>
              <Text style={[styles.sliderHeadline, { color: colors.text }]}>
                {currentFeature.headline}
              </Text>
              <Text style={[styles.sliderSubline, { color: colors.textSecondary }]}>
                {currentFeature.subline}
              </Text>
            </View>

            {/* Description - Compact, clear */}
            <Text style={[styles.sliderDescription, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)' }]}>
              {currentFeature.description}
            </Text>
          </Animated.View>

          {/* Indicators - Compact, animated */}
          <View style={styles.indicators}>
            {FEATURES.map((_, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => handleIndicatorPress(index)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Animated.View
                  style={[
                    styles.indicator,
                    {
                      backgroundColor: index === activeSlide
                        ? (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)')
                        : (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)'),
                      width: index === activeSlide ? 14 : 4,
                      transform: [{ scale: index === activeSlide ? 1 : 0.9 }],
                    },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Security note - Clearly readable trust guarantee */}
        <View style={styles.securityNote}>
          <Ionicons
            name="lock-closed"
            size={12}
            color={isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)'}
          />
          <Text style={[styles.securityText, {
            color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)'
          }]}>
            Your keys never leave this device
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actionsSection}>
          {/* Primary: Create - Clean, no shadow */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/(onboarding)/create');
            }}
            activeOpacity={0.85}
            style={[
              styles.primaryButton,
              {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
              Create New Wallet
            </Text>
          </TouchableOpacity>

          {/* Secondary: Import - Clean border, no shadow */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(onboarding)/import');
            }}
            activeOpacity={0.8}
            style={[styles.secondaryButton, {
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
              backgroundColor: 'transparent',
            }]}
          >
            <Text style={[styles.secondaryButtonText, { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' }]}>
              Import Wallet
            </Text>
          </TouchableOpacity>

          {/* Tertiary: Chips - clean, no shadow */}
          <View style={styles.tertiaryRow}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/(onboarding)/multisig-intro');
              }}
              activeOpacity={0.7}
              style={[styles.tertiaryChip, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              }]}
            >
              <Ionicons name="people" size={14} color={isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'} />
              <Text style={[styles.tertiaryChipText, {
                color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
              }]}>
                Multisig
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/(auth)/import-watch-only');
              }}
              activeOpacity={0.7}
              style={[styles.tertiaryChip, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              }]}
            >
              <Ionicons name="eye" size={14} color={isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'} />
              <Text style={[styles.tertiaryChipText, {
                color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
              }]}>
                Watch-Only
              </Text>
            </TouchableOpacity>

            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push('/(onboarding)/recover-icloud');
                }}
                activeOpacity={0.7}
                style={[styles.tertiaryChip, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                }]}
              >
                <Ionicons name="cloud-download" size={14} color={isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'} />
                <Text style={[styles.tertiaryChipText, {
                  color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
                }]}>
                  Restore iCloud
                </Text>
              </TouchableOpacity>
              {backupCount > 0 && (
                <View style={styles.backupBadge}>
                  <Text style={styles.backupBadgeText}>{backupCount}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Footer */}
        <Text style={[styles.footer, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }]}>
          Open source · Bitcoin only
        </Text>
      </View>

      {/* ── Preserved Data Recovery Sheet ─────────────── */}
      {preservedManifest && (
        <PreservedDataRecoverySheet
          visible={showRecoverySheet}
          onClose={() => setShowRecoverySheet(false)}
          manifest={preservedManifest}
          onRecover={() => {
            setShowRecoverySheet(false);
            passwordSubmittedRef.current = false;
            setTimeout(() => setShowPasswordSheet(true), 300);
          }}
          onStartFresh={async () => {
            setShowRecoverySheet(false);
            await PreservedArchiveService.deleteAllPreservedData();
            await SecureStorage.deleteWallet().catch(() => {});
            setPreservedManifest(null);
          }}
          onDismissForever={async () => {
            setShowRecoverySheet(false);
            await SecureStore.setItemAsync('preserved_recovery_dismissed', 'true', {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
            setPreservedManifest(null);
          }}
        />
      )}

      {/* ── Password Input Sheet (Restore) ──────────── */}
      <PasswordInputSheet
        visible={showPasswordSheet}
        onClose={() => {
          setShowPasswordSheet(false);
          // Only re-show recovery sheet if user dismissed (swiped down),
          // NOT if they submitted the password and the sheet closed programmatically.
          if (!passwordSubmittedRef.current) {
            setTimeout(() => setShowRecoverySheet(true), 300);
          }
        }}
        onSubmit={async (password: string) => {
          // Mark as submitted so onClose doesn't re-show recovery sheet
          passwordSubmittedRef.current = true;
          setVerifiedPassword(password);
          // Store password so ContinuousArchivalManager uses the correct key
          await PreserveDataSession.setPassword(password);
          setShowPasswordSheet(false);
          setTimeout(() => setShowRestoreProgress(true), 300);
        }}
        mode="verify"
        title="Enter Encryption Password"
        subtitle="Enter the password you used to encrypt your preserved data"
      />

      {/* ── Restoration Progress Sheet ───────────────── */}
      {verifiedPassword && (
        <RestorationProgressSheet
          visible={showRestoreProgress}
          onClose={() => {
            // Cancel pressed — close everything and go back to the recovery sheet
            setShowRestoreProgress(false);
            setVerifiedPassword(null);
            setTimeout(() => setShowRecoverySheet(true), 300);
          }}
          onRetry={() => {
            // Try Again pressed — close this sheet and re-open password input
            setShowRestoreProgress(false);
            setVerifiedPassword(null);
            passwordSubmittedRef.current = false;
            setTimeout(() => setShowPasswordSheet(true), 300);
          }}
          onComplete={() => {
            // Clear all recovery state to prevent re-showing
            setShowRestoreProgress(false);
            setShowRecoverySheet(false);
            setShowPasswordSheet(false);
            setPreservedManifest(null);
            setVerifiedPassword(null);
            // Navigate to PIN creation so user sets a PIN before entering the app.
            // The PIN screen in preserveRestore mode will store the PIN and route to (auth).
            router.replace({ pathname: '/(onboarding)/pin', params: { preserveRestore: 'true' } });
          }}
          pin={verifiedPassword}
        />
      )}
    </View>
  );
}

const createStyles = (
  colors: ThemeColors,
  isDark: boolean,
  insets: { top: number; bottom: number }
) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      paddingTop: insets.top + 20,
      paddingBottom: insets.bottom + 12,
      paddingHorizontal: 24,
    },

    // Brand Header - App Logo + Skip
    brandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 0,
    },
    appLogo: {
      height: 30,
      width: 125,
    },
    discoverCapsule: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
    },
    discoverCapsuleText: {
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.1,
    },

    // Slider - Connected to wordmark
    sliderContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: -40,
      marginBottom: 0,
    },
    sliderContent: {
      alignItems: 'center',
      width: '100%',
    },
    sliderIcon: {
      width: 60,
      height: 60,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 22,
    },
    headlineContainer: {
      alignItems: 'center',
      marginBottom: 10,
    },
    sliderHeadline: {
      fontSize: 36,
      fontWeight: '700',
      letterSpacing: -0.6,
      lineHeight: 40,
      textAlign: 'center',
    },
    sliderSubline: {
      fontSize: 36,
      fontWeight: '700',
      letterSpacing: -0.6,
      lineHeight: 40,
      textAlign: 'center',
      marginTop: -4,
    },
    sliderDescription: {
      fontSize: 15,
      lineHeight: 21,
      textAlign: 'center',
      paddingHorizontal: 28,
    },
    indicators: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 14,
    },
    indicator: {
      height: 2.5,
      borderRadius: 1.25,
    },

    // Security Note - More readable
    securityNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 22,
    },
    securityText: {
      fontSize: 13,
      fontWeight: '500',
      letterSpacing: 0.15,
    },

    // Actions - Refined proportions
    actionsSection: {
      gap: 10,
    },
    primaryButton: {
      height: 50,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    secondaryButton: {
      height: 45,
      borderRadius: 24,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.05,
    },
    tertiaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingTop: 4,
    },
    tertiaryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 11,
      paddingHorizontal: 18,
      borderRadius: 22,
    },
    tertiaryChipText: {
      fontSize: 14,
      fontWeight: '600',
    },
    backupBadge: {
      position: 'absolute',
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: '#007AFF',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    backupBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 13,
    },

    // Footer
    footer: {
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 0.25,
      textAlign: 'center',
      marginTop: 18,
    },
  });
