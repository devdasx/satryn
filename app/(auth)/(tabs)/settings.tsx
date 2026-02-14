import '../../../shim';
import React, { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { PremiumInput, PremiumInputCard } from '../../../src/components/ui/PremiumInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { useWalletStore, useSettingsStore, usePriceStore } from '../../../src/stores';
import { useTheme, useHaptics } from '../../../src/hooks';
import { ICloudService } from '../../../src/services/backup';
import { getDeviceId } from '../../../src/services/DeviceIdentity';
import { SecureStorage } from '../../../src/services/storage/SecureStorage';
import { PinCodeScreen } from '../../../src/components/security';
import {
  AppBottomSheet,
  SheetOptionRow,
  FastSwitch,
} from '../../../src/components/ui';
import {
  SECURITY,
  DERIVATION,
  FEE_PREFERENCE_LABELS,
  WALLET_MODE_LABELS,
} from '../../../src/constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Icon Color Map ──────────────────────────────────────────────────
// Semantic tinting for setting icons — matches dashboard's icon circle pattern.

const SETTING_ICON_COLORS: Record<string, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
  // Display
  'moon-outline':            { light: { bg: 'rgba(0,122,255,0.10)', color: '#007AFF' }, dark: { bg: 'rgba(0,122,255,0.18)', color: '#0A84FF' } },
  'sunny-outline':           { light: { bg: 'rgba(0,122,255,0.10)', color: '#007AFF' }, dark: { bg: 'rgba(0,122,255,0.18)', color: '#0A84FF' } },
  'phone-portrait-outline':  { light: { bg: 'rgba(0,122,255,0.10)', color: '#007AFF' }, dark: { bg: 'rgba(0,122,255,0.18)', color: '#0A84FF' } },
  'logo-bitcoin':            { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'cash-outline':            { light: { bg: 'rgba(52,199,89,0.10)', color: '#34C759' }, dark: { bg: 'rgba(48,209,88,0.18)', color: '#30D158' } },
  // Security
  'finger-print':            { light: { bg: 'rgba(0,122,255,0.10)', color: '#007AFF' }, dark: { bg: 'rgba(0,122,255,0.18)', color: '#0A84FF' } },
  'time-outline':            { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'lock-closed-outline':     { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  // Wallet
  'git-branch-outline':      { light: { bg: 'rgba(175,82,222,0.10)', color: '#AF52DE' }, dark: { bg: 'rgba(191,90,242,0.18)', color: '#BF5AF2' } },
  'flash-outline':           { light: { bg: 'rgba(255,204,0,0.10)', color: '#FFCC00' }, dark: { bg: 'rgba(255,214,10,0.18)', color: '#FFD60A' } },
  'layers-outline':          { light: { bg: 'rgba(90,200,250,0.10)', color: '#5AC8FA' }, dark: { bg: 'rgba(100,210,255,0.18)', color: '#64D2FF' } },
  // Preferences
  'notifications-outline':   { light: { bg: 'rgba(255,59,48,0.10)', color: '#FF3B30' }, dark: { bg: 'rgba(255,69,58,0.18)', color: '#FF453A' } },
  'hand-left-outline':       { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  // Advanced
  'server-outline':          { light: { bg: 'rgba(90,200,250,0.10)', color: '#5AC8FA' }, dark: { bg: 'rgba(100,210,255,0.18)', color: '#64D2FF' } },
  'radio-outline':           { light: { bg: 'rgba(52,199,89,0.10)', color: '#34C759' }, dark: { bg: 'rgba(48,209,88,0.18)', color: '#30D158' } },
  'eye-off-outline':         { light: { bg: 'rgba(175,82,222,0.10)', color: '#AF52DE' }, dark: { bg: 'rgba(191,90,242,0.18)', color: '#BF5AF2' } },
  // Actions
  'trash-outline':           { light: { bg: 'rgba(255,59,48,0.10)', color: '#FF3B30' }, dark: { bg: 'rgba(255,69,58,0.18)', color: '#FF453A' } },
  // Info
  'information-circle-outline': { light: { bg: 'rgba(142,142,147,0.10)', color: '#8E8E93' }, dark: { bg: 'rgba(142,142,147,0.18)', color: '#8E8E93' } },
  'document-text-outline':   { light: { bg: 'rgba(255,149,0,0.10)', color: '#FF9500' }, dark: { bg: 'rgba(255,159,10,0.18)', color: '#FF9F0A' } },
  'bug-outline':             { light: { bg: 'rgba(255,204,0,0.10)', color: '#FFCC00' }, dark: { bg: 'rgba(255,214,10,0.18)', color: '#FFD60A' } },
  'star-outline':            { light: { bg: 'rgba(255,204,0,0.10)', color: '#FFCC00' }, dark: { bg: 'rgba(255,214,10,0.18)', color: '#FFD60A' } },
};

// ─── Setting Row ─────────────────────────────────────────────────────

const SettingRow = memo(function SettingRow({
  icon,
  label,
  value,
  onPress,
  showArrow = true,
  danger = false,
  isLast = false,
  isDark,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  showArrow?: boolean;
  danger?: boolean;
  isLast?: boolean;
  isDark: boolean;
  children?: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Get icon colors from the map, with a fallback
  const iconTheme = SETTING_ICON_COLORS[icon as string];
  const iconBg = danger
    ? (isDark ? 'rgba(255,69,58,0.18)' : 'rgba(255,59,48,0.10)')
    : (iconTheme ? (isDark ? iconTheme.dark.bg : iconTheme.light.bg) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'));
  const iconColor = danger
    ? '#FF453A'
    : (iconTheme ? (isDark ? iconTheme.dark.color : iconTheme.light.color) : (isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.65)'));

  const content = (
    <Animated.View style={[styles.settingRow, animStyle]}>
      <View style={[styles.settingIconCircle, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.settingLabelContainer}>
        <Text style={[
          styles.settingLabel,
          { color: danger ? '#FF453A' : (isDark ? '#FFFFFF' : '#1A1A1A') }
        ]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.settingRight}>
        {children || (
          <>
            {value && (
              <Text style={[styles.settingValue, {
                color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
              }]} numberOfLines={1}>{value}</Text>
            )}
            {showArrow && onPress && (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'}
              />
            )}
          </>
        )}
      </View>
      {!isLast && (
        <View style={[styles.settingDivider, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        }]} />
      )}
    </Animated.View>
  );

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
      >
        {content}
      </AnimatedPressable>
    );
  }

  return content;
});

// ─── Settings Section ─────────────────────────────────────────────────

const SettingsSection = memo(function SettingsSection({
  title,
  visible,
  delay,
  isDark,
  cardBg,
  children,
}: {
  title: string;
  visible: boolean;
  delay: number;
  isDark: boolean;
  cardBg: string;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.delay(delay).duration(400)}>
      <Text style={[styles.sectionLabel, {
        color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)',
      }]}>
        {title}
      </Text>
      <View style={[styles.settingsCard, { backgroundColor: cardBg }]}>
        {children}
      </View>
    </Animated.View>
  );
});

// ─── Main Screen ───────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, isDark } = useTheme();
  const haptics = useHaptics();
  const lock = useWalletStore(s => s.lock);
  const deleteWallet = useWalletStore(s => s.deleteWallet);
  const network = useWalletStore(s => s.network);
  const priceCurrency = usePriceStore(s => s.currency);
  const setPriceCurrency = usePriceStore(s => s.setCurrency);
  const denomination = useSettingsStore(s => s.denomination);
  const setDenomination = useSettingsStore(s => s.setDenomination);
  const currency = useSettingsStore(s => s.currency);
  const setCurrency = useSettingsStore(s => s.setCurrency);
  const hapticsEnabled = useSettingsStore(s => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore(s => s.setHapticsEnabled);
  const appTheme = useSettingsStore(s => s.theme);
  const setTheme = useSettingsStore(s => s.setTheme);
  const iCloudBackupHistory = useSettingsStore(s => s.iCloudBackupHistory);
  // Security
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const setBiometricsEnabled = useSettingsStore(s => s.setBiometricsEnabled);
  const autoLockTimeout = useSettingsStore(s => s.autoLockTimeout);
  const setAutoLockTimeout = useSettingsStore(s => s.setAutoLockTimeout);
  // Wallet
  const walletMode = useSettingsStore(s => s.walletMode);
  const setWalletMode = useSettingsStore(s => s.setWalletMode);
  const feePreference = useSettingsStore(s => s.feePreference);
  const setFeePreference = useSettingsStore(s => s.setFeePreference);
  const customFeeRate = useSettingsStore(s => s.customFeeRate);
  const setCustomFeeRate = useSettingsStore(s => s.setCustomFeeRate);
  const gapLimit = useSettingsStore(s => s.gapLimit);
  const setGapLimit = useSettingsStore(s => s.setGapLimit);
  // Advanced
  const useCustomElectrum = useSettingsStore(s => s.useCustomElectrum);
  const customElectrumServer = useSettingsStore(s => s.customElectrumServer);

  // Sheet states
  const [showAutoLockSheet, setShowAutoLockSheet] = useState(false);

  // Biometric state
  const [biometricLabel, setBiometricLabel] = useState('Face ID / Touch ID');
  const [showBiometricPinVerification, setShowBiometricPinVerification] = useState(false);


  // Backup stats
  const [fullBackupCount, setFullBackupCount] = useState(0);
  const [singleBackupCount, setSingleBackupCount] = useState(0);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  // Card background color (dashboard-matched)
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;

  // Detect biometric type on mount
  useEffect(() => {
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        if (hasFace && hasFingerprint) setBiometricLabel('Face ID / Touch ID');
        else if (hasFace) setBiometricLabel('Face ID');
        else if (hasFingerprint) setBiometricLabel('Touch ID');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (ICloudService.isAvailable()) {
          const deviceId = await getDeviceId();
          setFullBackupCount(ICloudService.getFullBackupCount(deviceId));
          setSingleBackupCount(ICloudService.getBackupCount(deviceId));
        }
      } catch {}
    })();
  }, [iCloudBackupHistory]);


  // ─── Search filtering ─────────────────────────────────────────────

  const allSettings = useMemo(() => [
    { section: 'DISPLAY', key: 'theme', label: 'Appearance', keywords: 'theme dark light mode appearance' },
    { section: 'DISPLAY', key: 'denomination', label: 'Display Unit', keywords: 'btc sats denomination unit' },
    { section: 'DISPLAY', key: 'currency', label: 'Local Currency', keywords: 'currency usd eur money fiat' },
    { section: 'SECURITY', key: 'biometrics', label: 'Face ID / Touch ID', keywords: 'face id touch biometric fingerprint' },
    { section: 'SECURITY', key: 'autolock', label: 'Auto-Lock', keywords: 'auto lock timeout' },
    { section: 'SECURITY', key: 'changepin', label: 'Change PIN', keywords: 'pin code change update' },
    { section: 'WALLET', key: 'walletmode', label: 'Wallet Mode', keywords: 'wallet mode hd simple address' },
    { section: 'WALLET', key: 'fee', label: 'Default Fee', keywords: 'fee rate transaction speed custom' },
    { section: 'WALLET', key: 'gaplimit', label: 'Address Gap Limit', keywords: 'gap limit address scan' },
    { section: 'PREFERENCES', key: 'haptics', label: 'Haptic Feedback', keywords: 'haptic vibration' },
    { section: 'ADVANCED', key: 'electrum', label: 'Electrum Server', keywords: 'electrum server custom default' },
    { section: 'ADVANCED', key: 'broadcast', label: 'Broadcast Transaction', keywords: 'broadcast raw transaction hex' },
    { section: 'ADVANCED', key: 'privacy', label: 'Privacy & Analytics', keywords: 'privacy analytics data collection anonymous' },
    { section: 'ACTIONS', key: 'lock', label: 'Lock Wallet', keywords: 'lock' },
    { section: 'ACTIONS', key: 'delete', label: 'Reset App', keywords: 'delete reset erase' },
    { section: 'INFO', key: 'about', label: 'About Satryn', keywords: 'about version' },
    { section: 'INFO', key: 'legal', label: 'Legal', keywords: 'legal privacy terms' },
    { section: 'INFO', key: 'bugbounty', label: 'Bug Bounty', keywords: 'bug bounty security' },
    { section: 'INFO', key: 'rate', label: 'Rate on App Store', keywords: 'rate review app store' },
  ], []);

  const visibleSections = useMemo(() => {
    if (!searchQuery.trim()) return null; // show all
    const q = searchQuery.toLowerCase();
    const matched = allSettings.filter(s =>
      s.label.toLowerCase().includes(q) || s.keywords.includes(q)
    );
    const sections = new Set(matched.map(m => m.section));
    const keys = new Set(matched.map(m => m.key));
    return { sections, keys };
  }, [searchQuery, allSettings]);

  const isSectionVisible = (section: string) => !visibleSections || visibleSections.sections.has(section);
  const isKeyVisible = (key: string) => !visibleSections || visibleSections.keys.has(key);

  // ─── Helpers ────────────────────────────────────────────────────

  const getThemeLabel = () => {
    switch (appTheme) {
      case 'midnight': return 'Midnight';
      case 'light': return 'Light';
      default: return 'System';
    }
  };

  const getCurrencyLabel = () => currency || priceCurrency || 'USD';

  const getAutoLockLabel = () =>
    SECURITY.AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockTimeout)?.label || '1 minute';

  const getFeeLabel = () =>
    feePreference === 'custom'
      ? `${customFeeRate} sat/vB`
      : (FEE_PREFERENCE_LABELS[feePreference]?.label || 'Medium');

  const getGapLimitLabel = () =>
    DERIVATION.GAP_LIMIT_OPTIONS.find((o) => o.value === gapLimit)?.label || `${gapLimit}`;

  const isSimpleMode = walletMode === 'simple';

  // ─── Handlers ──────────────────────────────────────────────────

  const handleDenominationChange = async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/display-unit');
  };

  const handleCurrencyChange = async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/local-currency');
  };

  const handleThemeChange = async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/appearance');
  };

  const handleLockWallet = async () => {
    await haptics.trigger('medium');
    lock(true);
    router.replace('/(lock)');
  };

  const handleDeleteWallet = async () => {
    await haptics.trigger('warning');
    router.push('/(auth)/reset-app');
  };

  const handleHapticsToggle = async (value: boolean) => {
    setHapticsEnabled(value);
    if (value) {
      await haptics.trigger('success');
    }
  };

  // ─── Biometrics handlers ──────────────────────────────────────

  const handleBiometricsToggle = useCallback(async (value: boolean) => {
    if (value) {
      // Use supportedAuthenticationTypesAsync for reliable detection —
      // hasHardwareAsync can return false on some devices with Face ID
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (types.length === 0 || !enrolled) {
        Alert.alert(
          'Biometrics Unavailable',
          'Face ID or Touch ID is not enabled on your device. Please enable it in your device Settings first.',
          [{ text: 'OK' }],
        );
        return;
      }
      setShowBiometricPinVerification(true);
    } else {
      await SecureStorage.removeBiometricPin();
      setBiometricsEnabled(false);
    }
  }, [haptics, setBiometricsEnabled]);

  const handleBiometricPinVerify = useCallback(
    async (pin: string): Promise<{ success: boolean; error?: string }> => {
      const isValid = await SecureStorage.verifyPin(pin);
      if (!isValid) return { success: false, error: 'Incorrect PIN' };
      return { success: true };
    },
    [],
  );

  const handleBiometricPinSuccess = useCallback(
    async (pin: string) => {
      setShowBiometricPinVerification(false);
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: `Enable ${biometricLabel}`,
          fallbackLabel: 'Cancel',
          disableDeviceFallback: true,
        });
        if (!result.success) return;
        await SecureStorage.storePinForBiometrics(pin);
        setBiometricsEnabled(true);
        await haptics.trigger('success');
      } catch {
        // Face ID error — do not enable
      }
    },
    [biometricLabel, setBiometricsEnabled, haptics],
  );

  // ─── Auto-Lock handler ────────────────────────────────────────

  const handleAutoLockSelect = useCallback(
    async (value: number) => {
      await haptics.trigger('selection');
      setAutoLockTimeout(value);
      setShowAutoLockSheet(false);
    },
    [haptics, setAutoLockTimeout],
  );

  // ─── Wallet handlers ──────────────────────────────────────────

  const handleFeeChange = async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/default-fee');
  };

  const handleGapLimitChange = async () => {
    await haptics.trigger('selection');
    router.push('/(auth)/gap-limit');
  };

  // Hero card press animation
  const heroScale = useSharedValue(1);
  const heroAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroScale.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 120,
        }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Animated.Text
          entering={FadeIn.duration(400)}
          style={[styles.screenTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}
        >
          Settings
        </Animated.Text>

        {/* ── Search Bar ──────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(30).duration(400)}>
          <PremiumInputCard>
            <PremiumInput
              ref={searchInputRef}
              icon="search"
              iconColor="#8E8E93"
              placeholder="Search settings..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              showClear={searchQuery.length > 0}
            />
          </PremiumInputCard>
        </Animated.View>

        {/* ── Data & Backup Hero Card ─────────────────────────── */}
        {!visibleSections && (
          <AnimatedPressable
            entering={FadeIn.delay(40).duration(400)}
            onPress={() => router.push('/(auth)/data-backup')}
            onPressIn={() => { heroScale.value = withSpring(0.975, { damping: 15, stiffness: 400 }); }}
            onPressOut={() => { heroScale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
            style={[heroAnimStyle, styles.backupHero, { backgroundColor: cardBg }]}
          >
            {/* Top Row: Icon + Title + Arrow */}
            <View style={styles.backupHeroTop}>
              <View style={[styles.backupHeroIconCircle, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
              }]}>
                <Ionicons name="shield-checkmark" size={20} color={isDark ? '#0A84FF' : '#007AFF'} />
              </View>
              <View style={styles.backupHeroTitleArea}>
                <Text style={[styles.backupHeroTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                  Data & Backup
                </Text>
                <Text style={[styles.backupHeroSubtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
                  {(fullBackupCount + singleBackupCount) > 0
                    ? `${fullBackupCount + singleBackupCount} backup${(fullBackupCount + singleBackupCount) !== 1 ? 's' : ''} stored`
                    : 'Protect your wallets'}
                </Text>
              </View>
              <View style={[styles.backupHeroArrow, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }]}>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)'}
                />
              </View>
            </View>

          </AnimatedPressable>
        )}

        {/* ── Group 1: Display ────────────────────────────────────── */}
        <SettingsSection title="DISPLAY" visible={isSectionVisible('DISPLAY')} delay={50} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('theme') && (
            <SettingRow
              icon={appTheme === 'midnight' ? 'moon-outline' : appTheme === 'light' ? 'sunny-outline' : 'phone-portrait-outline'}
              label="Appearance"
              value={getThemeLabel()}
              onPress={handleThemeChange}
              isDark={isDark}
            />
          )}
          {isKeyVisible('denomination') && (
            <SettingRow
              icon="logo-bitcoin"
              label="Display Unit"
              value={denomination === 'btc' ? 'BTC' : 'Satoshis'}
              onPress={handleDenominationChange}
              isDark={isDark}
            />
          )}
          {isKeyVisible('currency') && (
            <SettingRow
              icon="cash-outline"
              label="Local Currency"
              value={getCurrencyLabel()}
              onPress={handleCurrencyChange}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* ── Group 2: Security ─────────────────────────────────── */}
        <SettingsSection title="SECURITY" visible={isSectionVisible('SECURITY')} delay={80} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('biometrics') && (
            <SettingRow
              icon="finger-print"
              label={biometricLabel}
              showArrow={false}
              isDark={isDark}
            >
              <FastSwitch
                value={biometricsEnabled}
                onValueChange={handleBiometricsToggle}
              />
            </SettingRow>
          )}
          {isKeyVisible('autolock') && (
            <SettingRow
              icon="time-outline"
              label="Auto-Lock"
              value={getAutoLockLabel()}
              onPress={() => {
                haptics.trigger('light');
                setShowAutoLockSheet(true);
              }}
              isDark={isDark}
            />
          )}
          {isKeyVisible('changepin') && (
            <SettingRow
              icon="lock-closed-outline"
              label="Change PIN"
              onPress={async () => {
                await haptics.trigger('light');
                router.push('/(auth)/change-pin');
              }}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* ── Group 3: Wallet ───────────────────────────────────── */}
        <SettingsSection title="WALLET" visible={isSectionVisible('WALLET')} delay={110} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('walletmode') && (
            <SettingRow
              icon="git-branch-outline"
              label="Wallet Mode"
              value={WALLET_MODE_LABELS[walletMode]?.label || 'HD Wallet'}
              onPress={async () => {
                await haptics.trigger('selection');
                router.push('/(auth)/wallet-mode');
              }}
              isDark={isDark}
            />
          )}
          {isKeyVisible('fee') && (
            <SettingRow
              icon="flash-outline"
              label="Default Fee"
              value={getFeeLabel()}
              onPress={handleFeeChange}
              isDark={isDark}
            />
          )}
          {isKeyVisible('gaplimit') && (
            <SettingRow
              icon="layers-outline"
              label="Address Gap Limit"
              value={isSimpleMode ? 'N/A' : getGapLimitLabel()}
              onPress={isSimpleMode ? undefined : handleGapLimitChange}
              showArrow={!isSimpleMode}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* ── Group 4: Preferences (inline toggles) ───────────── */}
        <SettingsSection title="PREFERENCES" visible={isSectionVisible('PREFERENCES')} delay={140} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('haptics') && (
            <SettingRow
              icon="phone-portrait-outline"
              label="Haptic Feedback"
              showArrow={false}
              isDark={isDark}
              isLast
            >
              <FastSwitch
                value={hapticsEnabled}
                onValueChange={handleHapticsToggle}
              />
            </SettingRow>
          )}
        </SettingsSection>

        {/* ── Group 5: Advanced ─────────────────────────────────── */}
        <SettingsSection title="ADVANCED" visible={isSectionVisible('ADVANCED')} delay={170} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('electrum') && (
            <SettingRow
              icon="server-outline"
              label="Electrum Server"
              value={useCustomElectrum && customElectrumServer ? 'Custom' : 'Default'}
              onPress={async () => {
                await haptics.trigger('selection');
                router.push('/(auth)/electrum-server');
              }}
              isDark={isDark}
            />
          )}
          {isKeyVisible('broadcast') && (
            <SettingRow
              icon="radio-outline"
              label="Broadcast Transaction"
              onPress={async () => {
                await haptics.trigger('selection');
                router.push('/(auth)/broadcast');
              }}
              isDark={isDark}
            />
          )}
          {isKeyVisible('privacy') && (
            <SettingRow
              icon="eye-off-outline"
              label="Privacy & Analytics"
              value={useSettingsStore.getState().analyticsEnabled ? 'On' : 'Off'}
              onPress={async () => {
                await haptics.trigger('selection');
                router.push('/(auth)/privacy');
              }}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* ── Group 6: Actions ────────────────────────────────── */}
        <SettingsSection title="ACTIONS" visible={isSectionVisible('ACTIONS')} delay={200} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('lock') && (
            <SettingRow
              icon="lock-closed-outline"
              label="Lock Wallet"
              onPress={handleLockWallet}
              showArrow={false}
              isDark={isDark}
            />
          )}
          {isKeyVisible('delete') && (
            <SettingRow
              icon="trash-outline"
              label="Reset App"
              onPress={handleDeleteWallet}
              danger
              showArrow={false}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* ── Group 7: Info ──────────────────────────────────── */}
        <SettingsSection title="INFO" visible={isSectionVisible('INFO')} delay={230} isDark={isDark} cardBg={cardBg}>
          {isKeyVisible('about') && (
            <SettingRow
              icon="information-circle-outline"
              label="About Satryn"
              onPress={() => router.push('/(auth)/about')}
              isDark={isDark}
            />
          )}
          {isKeyVisible('legal') && (
            <SettingRow
              icon="document-text-outline"
              label="Legal"
              onPress={() => router.push('/(auth)/legal')}
              isDark={isDark}
            />
          )}
          {isKeyVisible('bugbounty') && (
            <SettingRow
              icon="bug-outline"
              label="Bug Bounty"
              onPress={() => router.push('/(auth)/bug-bounty')}
              isDark={isDark}
            />
          )}
          {isKeyVisible('rate') && (
            <SettingRow
              icon="star-outline"
              label="Rate on App Store"
              onPress={() => Linking.openURL('https://apps.apple.com/app/id6758677225?action=write-review')}
              isDark={isDark}
              isLast
            />
          )}
        </SettingsSection>

        {/* No results */}
        {visibleSections && visibleSections.keys.size === 0 && (
          <View style={styles.emptySearch}>
            <Ionicons name="search-outline" size={36} color={isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'} />
            <Text style={[styles.emptySearchText, { color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }]}>
              No settings found
            </Text>
          </View>
        )}
      </ScrollView>


      {/* ── Auto-Lock Sheet ────────────────────────────────────────── */}
      <AppBottomSheet
        visible={showAutoLockSheet}
        onClose={() => setShowAutoLockSheet(false)}
        title="Auto-Lock"
        subtitle="Lock wallet after a period of inactivity"
      >
        {SECURITY.AUTO_LOCK_OPTIONS.map((option, index) => (
          <SheetOptionRow
            key={option.value}
            label={option.label}
            selected={autoLockTimeout === option.value}
            onPress={() => handleAutoLockSelect(option.value)}
            showDivider={index < SECURITY.AUTO_LOCK_OPTIONS.length - 1}
          />
        ))}
      </AppBottomSheet>


      {/* ── Biometric PIN verification modal ───────────────────────── */}
      <Modal
        visible={showBiometricPinVerification}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowBiometricPinVerification(false)}
      >
        <PinCodeScreen
          mode="verify"
          title="Enable Biometrics"
          subtitle={`Enter your PIN to enable ${biometricLabel}`}
          icon="shield"
          iconColor="#34C759"
          onVerify={handleBiometricPinVerify}
          onSuccess={handleBiometricPinSuccess}
          onCancel={() => setShowBiometricPinVerification(false)}
          biometricEnabled={false}
          showBackButton={true}
        />
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  screenTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 16,
  },

  // (Search bar raw styles removed — using PremiumInput)

  // ── Section Label & Card ────────────────────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
    paddingLeft: 4,
  },
  settingsCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },

  // ── Backup Hero Card ──────────────────────────────────────
  backupHero: {
    borderRadius: 20,
    padding: 20,
    marginTop: 18,
    marginBottom: 6,
    overflow: 'hidden' as const,
  },
  backupHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backupHeroIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backupHeroTitleArea: {
    flex: 1,
    marginRight: 8,
  },
  backupHeroTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  backupHeroSubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  backupHeroArrow: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupHeroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  backupHeroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backupHeroPillText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // ── Setting Row ─────────────────────────────────────────────
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    position: 'relative',
  },
  settingIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  settingDescription: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingValue: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 160,
  },
  settingDivider: {
    position: 'absolute',
    bottom: 0,
    left: 64,
    right: 16,
    height: StyleSheet.hairlineWidth,
  },

  // ── Empty Search ────────────────────────────────────────────
  emptySearch: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptySearchText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
