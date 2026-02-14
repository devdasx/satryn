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
import { THEME } from '../../src/constants';
import { WatchOnlyWallet } from '../../src/core/wallet/WatchOnlyWallet';
import { QRScanner } from '../../src/components/scanner';
import { parseXpubQR } from '../../src/utils/qrParser';
import { WalletManager } from '../../src/services/wallet';
import { useMultiWalletStore } from '../../src/stores';
import { KeyboardSafeBottomBar } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import type { AddressType } from '../../src/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Mainnet xpub prefixes only
const XPUB_PREFIXES: Record<string, { type: AddressType; name: string; format: string }> = {
  'xpub': { type: 'legacy', name: 'Legacy (P2PKH)', format: 'xpub' },
  'ypub': { type: 'wrapped_segwit', name: 'Wrapped SegWit', format: 'ypub' },
  'zpub': { type: 'native_segwit', name: 'Native SegWit', format: 'zpub' },
};

const DEFAULT_WALLET_NAME = 'Watch-Only Wallet';

type ValidationState = 'empty' | 'valid' | 'invalid' | 'private_key';

interface ValidationResult {
  state: ValidationState;
  valid: boolean;
  type?: AddressType;
  typeName?: string;
  format?: string;
  error?: string;
}

// Check if looks like private key or seed
const looksLikePrivateKey = (text: string): boolean => {
  const lower = text.trim().toLowerCase();
  if (lower.startsWith('xprv') || lower.startsWith('yprv') || lower.startsWith('zprv')) return true;
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 12 || words.length === 24) return true;
  return false;
};

export default function ImportXpubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const [xpubInput, setXpubInput] = useState('');
  const [walletName, setWalletName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const prevValidRef = useRef<boolean | null>(null);

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

  // Validate xpub
  const validationResult: ValidationResult = useMemo(() => {
    if (!xpubInput.trim()) {
      return { state: 'empty', valid: false };
    }

    const trimmed = xpubInput.trim();

    if (looksLikePrivateKey(trimmed)) {
      return {
        state: 'private_key',
        valid: false,
        error: 'This looks like a seed phrase. Paste an xpub/ypub/zpub instead.',
      };
    }

    const prefix = trimmed.substring(0, 4).toLowerCase();
    const prefixInfo = XPUB_PREFIXES[prefix];

    if (!prefixInfo) {
      return {
        state: 'invalid',
        valid: false,
        error: "That doesn't look like a valid account xpub/ypub/zpub.",
      };
    }

    if (trimmed.length < 100 || trimmed.length > 120) {
      return {
        state: 'invalid',
        valid: false,
        error: "That doesn't look like a valid account xpub/ypub/zpub.",
      };
    }

    try {
      WatchOnlyWallet.fromExtendedPublicKey(trimmed);
      return {
        state: 'valid',
        valid: true,
        type: prefixInfo.type,
        typeName: prefixInfo.name,
        format: prefixInfo.format,
      };
    } catch {
      return {
        state: 'invalid',
        valid: false,
        error: "That doesn't look like a valid account xpub/ypub/zpub.",
      };
    }
  }, [xpubInput]);

  // Haptics on validation state change
  useEffect(() => {
    if (prevValidRef.current !== null) {
      if (validationResult.valid && !prevValidRef.current) {
        haptics.trigger('success');
      } else if (!validationResult.valid && validationResult.state !== 'empty' && prevValidRef.current) {
        haptics.trigger('error');
      }
    }
    prevValidRef.current = validationResult.valid;
  }, [validationResult.valid, validationResult.state, haptics]);

  const handleBack = useCallback(async () => {
    router.back();
  }, [router]);

  const handlePaste = useCallback(async () => {
    await haptics.trigger('light');
    const text = await Clipboard.getStringAsync();
    if (text) {
      setXpubInput(text.trim());
      setPasteMessage('Pasted from clipboard.');
    }
  }, [haptics]);

  const handleScan = useCallback(async () => {
    await haptics.trigger('light');
    Keyboard.dismiss();
    setShowScanner(true);
  }, [haptics]);

  const handleScanResult = useCallback(async (data: string) => {
    const result = parseXpubQR(data);

    if (result.success && result.data) {
      await haptics.trigger('success');
      setXpubInput(result.data);
      setShowScanner(false);
      setPasteMessage('Scanned successfully.');
    } else {
      await haptics.trigger('error');
      Alert.alert(
        'Invalid QR Code',
        result.error || 'No valid xpub/ypub/zpub found.',
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
    setXpubInput('');
  }, [haptics]);

  const handleImport = useCallback(async () => {
    if (!validationResult.valid || isImporting) return;

    setIsImporting(true);
    await haptics.trigger('light');
    Keyboard.dismiss();

    try {
      const finalWalletName = walletName.trim() || DEFAULT_WALLET_NAME;

      const wallet = await WalletManager.importXpubWallet(
        finalWalletName,
        xpubInput.trim()
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
  }, [validationResult.valid, isImporting, walletName, xpubInput, haptics, router]);

  // Dynamic border color for input
  const inputBorderColor = validationResult.valid
    ? (isDark ? 'rgba(48,209,88,0.4)' : 'rgba(48,209,88,0.35)')
    : (validationResult.state === 'invalid' || validationResult.state === 'private_key')
      ? (isDark ? 'rgba(255,69,58,0.4)' : 'rgba(220,53,69,0.35)')
      : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)');

  // CTA colors
  const ctaBg = validationResult.valid
    ? (isDark ? THEME.brand.bitcoin : '#0D0D0D')
    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
  const ctaTextColor = validationResult.valid
    ? '#FFFFFF'
    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)');

  const actionBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const actionColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';

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
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color: colors.text }]}>Extended Public Key</Text>
          <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
            Import an account xpub to derive all addresses — without exposing private keys.
          </Text>
        </View>

        {/* Wallet Name */}
        <View style={styles.fieldSection}>
          <PremiumInputCard label="Wallet Name">
            <PremiumInput
              icon="pencil"
              iconColor="#007AFF"
              placeholder={DEFAULT_WALLET_NAME}
              value={walletName}
              onChangeText={setWalletName}
              autoCapitalize="words"
            />
          </PremiumInputCard>
        </View>

        {/* Extended Public Key Input */}
        <View style={styles.fieldSection}>
          <View style={styles.labelRow}>
            <Text style={[styles.inputLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              Extended Public Key
            </Text>
            {validationResult.valid && (
              <Animated.View
                entering={FadeIn.duration(200)}
                style={[styles.detectedBadge, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)',
                }]}
              >
                <Ionicons name="checkmark-circle" size={14} color="#30D158" />
                <Text style={styles.detectedBadgeText}>
                  {validationResult.format} · {validationResult.typeName}
                </Text>
              </Animated.View>
            )}
          </View>

          <PremiumInputCard>
            <PremiumInput
              icon="link"
              iconColor="#007AFF"
              monospace
              multiline
              placeholder="xpub / ypub / zpub"
              value={xpubInput}
              onChangeText={setXpubInput}
              autoCapitalize="none"
              autoCorrect={false}
              numberOfLines={3}
              textAlignVertical="top"
              showClear={xpubInput.length > 0}
            />
          </PremiumInputCard>

          {/* Error */}
          {(validationResult.state === 'invalid' || validationResult.state === 'private_key') && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.errorText}>{validationResult.error}</Text>
            </View>
          )}

          {/* Paste feedback */}
          {pasteMessage && (
            <Text style={[styles.feedbackText, { color: '#30D158' }]}>{pasteMessage}</Text>
          )}

          {/* Action buttons */}
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

        {/* Supported Formats — plain text */}
        <View style={styles.formatsSection}>
          <Text style={[styles.formatsLabel, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            SUPPORTED FORMATS
          </Text>
          {[
            { code: 'xpub', desc: 'Legacy (P2PKH)' },
            { code: 'ypub', desc: 'Wrapped SegWit' },
            { code: 'zpub', desc: 'Native SegWit' },
          ].map((f) => (
            <View key={f.code} style={styles.formatItem}>
              <Text style={[styles.formatCode, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>{f.code}</Text>
              <Text style={[styles.formatDesc, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }]}>— {f.desc}</Text>
            </View>
          ))}
          <Text style={[styles.formatsNote, { color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)' }]}>
            Format is detected automatically.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <KeyboardSafeBottomBar backgroundColor={colors.background} horizontalPadding={24}>
        <AnimatedPressable
          onPress={handleImport}
          disabled={!validationResult.valid || isImporting}
          onPressIn={() => { ctaScale.value = withSpring(0.97, { damping: 15, stiffness: 400 }); }}
          onPressOut={() => { ctaScale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
        >
          <Animated.View style={[styles.ctaButton, { backgroundColor: ctaBg }, ctaAnimStyle]}>
            <Text style={[styles.ctaText, { color: ctaTextColor }]}>
              {isImporting ? 'Importing…' : 'Import Watch-Only Wallet'}
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
        subtitle="Align the xpub QR code in the frame"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  // Title
  titleSection: { marginBottom: 24 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, maxWidth: '95%' },

  // Fields
  fieldSection: { marginBottom: 24 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  inputLabel: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  nameInput: { fontSize: 16, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 },
  inputContainer: { borderRadius: 16, borderWidth: 1.5, padding: 12, minHeight: 100, position: 'relative' },
  textInput: { fontSize: 14, lineHeight: 20, paddingRight: 32, minHeight: 76, textAlignVertical: 'top' },
  inputActions: { position: 'absolute', top: 12, right: 12, gap: 12 },

  // Detected badge
  detectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  detectedBadgeText: { fontSize: 12, fontWeight: '600', color: '#30D158' },

  // Error
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500', flex: 1 },
  feedbackText: { fontSize: 13, marginTop: 8, fontWeight: '500' },

  // Action buttons
  actions: { flexDirection: 'row', marginTop: 14, gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 45, borderRadius: 24, gap: 7 },
  actionText: { fontSize: 14, fontWeight: '500' },

  // Formats
  formatsSection: { marginBottom: 24 },
  formatsLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 },
  formatItem: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4, marginBottom: 6 },
  formatCode: { fontSize: 14, fontWeight: '600', width: 48 },
  formatDesc: { fontSize: 14, marginLeft: 4 },
  formatsNote: { fontSize: 13, marginTop: 8, paddingLeft: 4, fontStyle: 'italic' },

  // CTA
  ctaButton: { height: 50, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
});
