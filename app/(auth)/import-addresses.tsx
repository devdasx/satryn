import '../../shim';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Keyboard,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { useTheme, useHaptics } from '../../src/hooks';
import { QRScanner } from '../../src/components/scanner';
import { parseAddressQR } from '../../src/utils/qrParser';
import { WalletManager } from '../../src/services/wallet';
import { useMultiWalletStore } from '../../src/stores';
import { KeyboardSafeBottomBar } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME } from '../../src/constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Bitcoin mainnet address validation
const isValidBitcoinAddress = (address: string): boolean => {
  const trimmed = address.trim();
  if (trimmed.startsWith('1') && trimmed.length >= 26 && trimmed.length <= 35) return true;
  if (trimmed.startsWith('3') && trimmed.length >= 26 && trimmed.length <= 35) return true;
  if (trimmed.startsWith('bc1q') && trimmed.length >= 42 && trimmed.length <= 62) return true;
  if (trimmed.startsWith('bc1p') && trimmed.length >= 42 && trimmed.length <= 62) return true;
  return false;
};

const DEFAULT_WALLET_NAME = 'Watch-Only Wallet';

type ValidationState = 'empty' | 'valid' | 'partial' | 'all_invalid';

interface ValidationResult {
  state: ValidationState;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  addresses: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ImportAddressesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [addressInput, setAddressInput] = useState('');
  const [walletName, setWalletName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const prevValidRef = useRef<number | null>(null);

  // CTA press animation
  const ctaScale = useSharedValue(1);
  const ctaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ctaScale.value }],
  }));

  // Clear paste message after delay
  useEffect(() => {
    if (pasteMessage) {
      const timer = setTimeout(() => setPasteMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [pasteMessage]);

  // Parse and validate addresses
  const validationResult: ValidationResult = useMemo(() => {
    if (!addressInput.trim()) {
      return {
        state: 'empty',
        total: 0,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        addresses: [],
      };
    }

    const lines = addressInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const validAddresses: string[] = [];
    let invalidCount = 0;
    let duplicates = 0;
    const seenAddresses = new Set<string>();

    lines.forEach((line) => {
      if (isValidBitcoinAddress(line)) {
        if (seenAddresses.has(line)) {
          duplicates++;
        } else {
          seenAddresses.add(line);
          validAddresses.push(line);
        }
      } else {
        invalidCount++;
      }
    });

    const valid = validAddresses.length;

    let state: ValidationState;
    if (valid === 0 && invalidCount > 0) {
      state = 'all_invalid';
    } else if (valid > 0 && invalidCount > 0) {
      state = 'partial';
    } else if (valid > 0) {
      state = 'valid';
    } else {
      state = 'empty';
    }

    return {
      state,
      total: lines.length,
      valid,
      invalid: invalidCount,
      duplicates,
      addresses: validAddresses,
    };
  }, [addressInput]);

  // Haptics on validation state change
  useEffect(() => {
    if (prevValidRef.current !== null) {
      if (validationResult.valid > 0 && prevValidRef.current === 0) {
        haptics.trigger('success');
      } else if (validationResult.valid === 0 && prevValidRef.current > 0) {
        haptics.trigger('error');
      }
    }
    prevValidRef.current = validationResult.valid;
  }, [validationResult.valid, haptics]);

  const handleBack = useCallback(async () => {
    router.back();
  }, [router]);

  const handlePaste = useCallback(async () => {
    await haptics.trigger('light');
    const text = await Clipboard.getStringAsync();
    if (text) {
      setAddressInput(text.trim());
      setPasteMessage('Pasted from clipboard.');
    }
  }, [haptics]);

  const handleScan = useCallback(async () => {
    await haptics.trigger('light');
    Keyboard.dismiss();
    setShowScanner(true);
  }, [haptics]);

  const handleScanResult = useCallback(async (data: string) => {
    const result = parseAddressQR(data);

    if (result.success && result.addresses && result.addresses.length > 0) {
      await haptics.trigger('success');

      // Append to existing addresses (deduplicate)
      setAddressInput((prev) => {
        const existingLines = prev.trim().split('\n').filter(l => l.trim().length > 0);
        const existingSet = new Set(existingLines);
        const newAddresses = result.addresses!.filter(addr => !existingSet.has(addr));

        if (newAddresses.length === 0) {
          return prev;
        }

        if (existingLines.length === 0) {
          return newAddresses.join('\n');
        }
        return [...existingLines, ...newAddresses].join('\n');
      });

      setShowScanner(false);
      setPasteMessage('Scanned successfully.');
    } else {
      await haptics.trigger('error');
      Alert.alert(
        'Invalid QR Code',
        result.error || 'No valid Bitcoin address found.',
        [
          { text: 'Try Again', style: 'default' },
          { text: 'Close', onPress: () => setShowScanner(false) },
        ]
      );
    }
  }, [haptics]);

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false);
  }, []);

  const handleClear = useCallback(async () => {
    await haptics.trigger('light');
    setAddressInput('');
  }, [haptics]);

  const handleRemoveInvalid = useCallback(async () => {
    await haptics.trigger('light');
    const lines = addressInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const validLines = lines.filter(line => isValidBitcoinAddress(line));
    const uniqueLines = [...new Set(validLines)];
    setAddressInput(uniqueLines.join('\n'));
  }, [addressInput, haptics]);

  const handleGoToXpub = useCallback(async () => {
    await haptics.trigger('light');
    router.replace('/(auth)/import-xpub');
  }, [haptics, router]);

  const handleImport = useCallback(async () => {
    if (validationResult.valid === 0 || isImporting) return;

    setIsImporting(true);
    await haptics.trigger('light');
    Keyboard.dismiss();

    try {
      const finalWalletName = walletName.trim() || DEFAULT_WALLET_NAME;

      const wallet = await WalletManager.importAddressesWallet(
        finalWalletName,
        validationResult.addresses
      );

      const { useWalletStore } = await import('../../src/stores');
      await useWalletStore.getState().switchToWallet(wallet.id);
      await useMultiWalletStore.getState().setActiveWallet(wallet.id);

      await haptics.trigger('success');
      router.replace('/(auth)/(tabs)');
    } catch (error) {
      await haptics.trigger('error');
      Alert.alert(
        'Import Failed',
        error instanceof Error ? error.message : 'Failed to import wallet',
        [{ text: 'OK' }]
      );
    } finally {
      setIsImporting(false);
    }
  }, [validationResult.valid, validationResult.addresses, isImporting, walletName, haptics, router]);

  // Dynamic border color for address input
  const inputBorderColor = validationResult.state === 'valid'
    ? (isDark ? 'rgba(48,209,88,0.4)' : 'rgba(48,209,88,0.35)')
    : validationResult.state === 'partial'
      ? (isDark ? 'rgba(255,204,0,0.4)' : 'rgba(255,204,0,0.35)')
      : validationResult.state === 'all_invalid'
        ? (isDark ? 'rgba(255,69,58,0.4)' : 'rgba(220,53,69,0.35)')
        : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)');

  // CTA colors
  const isCtaEnabled = validationResult.valid > 0;
  const ctaBg = isCtaEnabled
    ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
  const ctaTextColor = isCtaEnabled
    ? '#FFFFFF'
    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)');

  const actionBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const actionColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';

  // Counter text
  const getCounterText = () => {
    if (validationResult.state === 'empty') return '0 addresses detected';
    const parts: string[] = [];
    if (validationResult.valid > 0) {
      parts.push(`${validationResult.valid} valid`);
    }
    if (validationResult.invalid > 0) {
      parts.push(`${validationResult.invalid} invalid`);
    }
    if (validationResult.duplicates > 0) {
      parts.push(`${validationResult.duplicates} duplicate${validationResult.duplicates > 1 ? 's' : ''}`);
    }
    return parts.join(' · ');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 140 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Title — left-aligned, matching import screen pattern */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color: colors.text }]}>Address List</Text>
          <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
            Track specific addresses only. No derivation — you won't generate new receive addresses.
          </Text>
        </View>

        {/* Limitations notice — accent bar style */}
        <View style={[styles.limitationsNotice, { backgroundColor: isDark ? 'rgba(255,204,0,0.08)' : 'rgba(255,149,0,0.06)' }]}>
          <View style={[styles.limitationsAccent, { backgroundColor: isDark ? '#FFD60A' : '#FF9500' }]} />
          <View style={styles.limitationsContent}>
            <Ionicons name="information-circle-outline" size={16} color={isDark ? '#FFD60A' : '#FF9500'} />
            <View style={styles.limitationsTextWrap}>
              <Text style={[styles.limitationsText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
                No new addresses can be generated. Best for monitoring known addresses.
              </Text>
              <TouchableOpacity onPress={handleGoToXpub} style={styles.xpubLink}>
                <Text style={[styles.xpubLinkText, { color: isDark ? '#FF9F0A' : '#FF9500' }]}>
                  Import an xpub instead
                </Text>
                <Ionicons name="arrow-forward" size={12} color={isDark ? '#FF9F0A' : '#FF9500'} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Wallet Name */}
        <View style={styles.fieldSection}>
          <PremiumInputCard label="Wallet Name">
            <PremiumInput
              icon="wallet-outline"
              iconColor="#007AFF"
              placeholder={DEFAULT_WALLET_NAME}
              value={walletName}
              onChangeText={setWalletName}
              autoCapitalize="words"
              showClear={walletName.length > 0}
            />
          </PremiumInputCard>
        </View>

        {/* Address Input — standalone input */}
        <View style={styles.fieldSection}>
          <View style={styles.labelRow}>
            <Text style={[styles.inputLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              Bitcoin Addresses
            </Text>
            {validationResult.state === 'valid' && (
              <Animated.View
                entering={FadeIn.duration(200)}
                style={[styles.detectedBadge, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)',
                }]}
              >
                <Ionicons name="checkmark-circle" size={14} color="#30D158" />
                <Text style={styles.detectedBadgeText}>
                  {validationResult.valid === 1 ? '1 valid' : `${validationResult.valid} valid`}
                </Text>
              </Animated.View>
            )}
          </View>

          <PremiumInputCard>
            <PremiumInput
              icon="location-outline"
              iconColor="#FF9500"
              placeholder="One address per line"
              value={addressInput}
              onChangeText={setAddressInput}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={5}
              monospace
              showClear={addressInput.length > 0}
            />
          </PremiumInputCard>

          {/* Validation feedback */}
          {validationResult.state === 'all_invalid' && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.errorText}>No valid Bitcoin addresses found. Check format.</Text>
            </View>
          )}

          {validationResult.state === 'partial' && (
            <View style={styles.warningRow}>
              <Ionicons name="warning" size={16} color={isDark ? '#FFD60A' : '#D4A600'} />
              <Text style={[styles.warningText, { color: isDark ? '#FFD60A' : '#D4A600' }]}>
                {validationResult.invalid} invalid line{validationResult.invalid > 1 ? 's' : ''} detected
              </Text>
              <TouchableOpacity onPress={handleRemoveInvalid}>
                <Text style={[styles.removeAction, { color: isDark ? '#FFFFFF' : '#000000' }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Paste feedback */}
          {pasteMessage && (
            <Text style={[styles.feedbackText, { color: '#30D158' }]}>{pasteMessage}</Text>
          )}

          {/* Counter */}
          {validationResult.state !== 'empty' && (
            <Text style={[styles.counterText, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }]}>
              {getCounterText()}
            </Text>
          )}

          {/* Action buttons — equal-width row */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: actionBg }]}
              onPress={handlePaste}
              activeOpacity={0.7}
            >
              <Ionicons name="clipboard-outline" size={18} color={actionColor} />
              <Text style={[styles.actionText, { color: actionColor }]}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: actionBg }]}
              onPress={handleScan}
              activeOpacity={0.7}
            >
              <Ionicons name="qr-code-outline" size={18} color={actionColor} />
              <Text style={[styles.actionText, { color: actionColor }]}>Scan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Supported Formats — plain text, not in a card */}
        <View style={styles.formatsSection}>
          <Text style={[styles.formatsLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            SUPPORTED FORMATS
          </Text>
          {[
            { label: 'Legacy', prefix: '1…', example: 'P2PKH' },
            { label: 'Script Hash', prefix: '3…', example: 'P2SH' },
            { label: 'Native SegWit', prefix: 'bc1q…', example: 'Bech32' },
            { label: 'Taproot', prefix: 'bc1p…', example: 'Bech32m' },
          ].map((f) => (
            <View key={f.prefix} style={styles.formatItem}>
              <Text style={[styles.formatCode, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>{f.prefix}</Text>
              <Text style={[styles.formatDesc, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }]}>— {f.label}</Text>
            </View>
          ))}
          <Text style={[styles.formatsNote, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            Duplicates are removed automatically.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <KeyboardSafeBottomBar backgroundColor={colors.background} horizontalPadding={24}>
        <AnimatedPressable
          onPress={handleImport}
          disabled={!isCtaEnabled || isImporting}
          onPressIn={() => { ctaScale.value = withSpring(0.97, { damping: 15, stiffness: 400 }); }}
          onPressOut={() => { ctaScale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
        >
          <Animated.View style={[styles.ctaButton, { backgroundColor: ctaBg }, ctaAnimStyle]}>
            <Text style={[styles.ctaText, { color: ctaTextColor }]}>
              {isImporting ? 'Importing…' : 'Import Addresses'}
            </Text>
          </Animated.View>
        </AnimatedPressable>
      </KeyboardSafeBottomBar>

      {/* QR Scanner */}
      <QRScanner
        visible={showScanner}
        onClose={handleCloseScanner}
        onScan={handleScanResult}
        onPasteInstead={handlePaste}
        title="Scan QR"
        subtitle="Scan a Bitcoin address or URI"
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  // Title — left-aligned
  titleSection: { marginBottom: 24 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, maxWidth: '95%' },

  // Limitations notice — accent bar style
  limitationsNotice: { flexDirection: 'row', borderRadius: 14, marginBottom: 28, overflow: 'hidden' },
  limitationsAccent: { width: 3 },
  limitationsContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingLeft: 12, gap: 10 },
  limitationsTextWrap: { flex: 1 },
  limitationsText: { fontSize: 14, lineHeight: 21 },
  xpubLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  xpubLinkText: { fontSize: 14, fontWeight: '600' },

  // Fields — standalone
  fieldSection: { marginBottom: 24 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  inputLabel: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  // (TextInput styles removed — using PremiumInput)

  // Detected badge
  detectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  detectedBadgeText: { fontSize: 12, fontWeight: '600', color: '#30D158' },

  // Error / Warning
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500', flex: 1 },
  warningRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  warningText: { fontSize: 14, fontWeight: '500' },
  removeAction: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline', marginLeft: 4 },
  feedbackText: { fontSize: 13, marginTop: 8, fontWeight: '500' },
  counterText: { fontSize: 13, marginTop: 8, fontWeight: '500' },

  // Action buttons
  actions: { flexDirection: 'row', marginTop: 14, gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 45, borderRadius: 24, gap: 7 },
  actionText: { fontSize: 14, fontWeight: '500' },

  // Formats — plain text
  formatsSection: { marginBottom: 24 },
  formatsLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 },
  formatItem: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4, marginBottom: 6 },
  formatCode: { fontSize: 14, fontWeight: '600', width: 56 },
  formatDesc: { fontSize: 14, marginLeft: 4 },
  formatsNote: { fontSize: 13, marginTop: 8, paddingLeft: 4, fontStyle: 'italic' },

  // CTA
  ctaButton: { height: 50, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
});
