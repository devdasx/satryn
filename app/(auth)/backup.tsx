import '../../shim';
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Platform,
  Share,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { PinCodeScreen } from '../../src/components/security';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { QRCode } from '../../src/components/bitcoin';
import { AppBottomSheet } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useTheme, useHaptics, useCopyFeedback } from '../../src/hooks';
import { useSettingsStore, useWalletStore, useMultiWalletStore } from '../../src/stores';
import { shareQRAsPNG } from '../../src/utils/qrExport';
import { THEME, getColors } from '../../src/constants';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SeedGenerator } from '../../src/core/wallet/SeedGenerator';
import { KeyDerivation } from '../../src/core/wallet/KeyDerivation';
import type { WalletType } from '../../src/stores/multiWalletStore';

// Map script type to display label
const MULTISIG_SCRIPT_TYPE_LABELS: Record<string, string> = {
  'p2wsh': 'Native SegWit (P2WSH)',
  'p2sh-p2wsh': 'Wrapped SegWit (P2SH-P2WSH)',
  'p2sh': 'Legacy (P2SH)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ViewState = 'verify' | 'display';
type DisplayTab = 'words' | 'qr';

export default function BackupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, isDark, themeMode } = useTheme();
  const haptics = useHaptics();
  const { copied, copy } = useCopyFeedback();
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const isMultisig = useWalletStore(s => s.isMultisig);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const network = useWalletStore(s => s.network);
  const preferredAddressType = useWalletStore(s => s.preferredAddressType);
  const { activeWalletId } = useMultiWalletStore();
  const wallets = useMultiWalletStore(s => s.wallets);
  const activeWallet = wallets.find(w => w.id === activeWalletId);
  const walletType: WalletType = activeWallet?.type || 'hd';

  // Determine wallet category
  const isWatchOnly = walletType === 'watch_xpub' || walletType === 'watch_descriptor' || walletType === 'watch_addresses';

  const [viewState, setViewState] = useState<ViewState>(isWatchOnly ? 'display' : 'verify');
  const [displayTab, setDisplayTab] = useState<DisplayTab>('words');
  const [seedPhrase, setSeedPhrase] = useState<string[]>([]);
  const [descriptor, setDescriptor] = useState<string>('');
  const [localCosignerSeeds, setLocalCosignerSeeds] = useState<{ index: number; seed: string }[]>([]);
  const [expandedCosigner, setExpandedCosigner] = useState<number | null>(null);
  const [showBlur, setShowBlur] = useState(true);
  const [tipsExpanded, setTipsExpanded] = useState(false);
  const [revealWarningShown, setRevealWarningShown] = useState(false);

  // Import seed modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCosignerIndex, setImportCosignerIndex] = useState<number | null>(null);
  const [importCosignerName, setImportCosignerName] = useState<string>('');
  const [importCosignerXpub, setImportCosignerXpub] = useState<string>('');
  const [importSeedInput, setImportSeedInput] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [currentPin, setCurrentPin] = useState<string>('');

  // QR SVG ref for PNG export
  const qrSvgRef = useRef<any>(null);

  // Multisig signer selector
  const [selectedSignerIndex, setSelectedSignerIndex] = useState<number>(0);

  // Determine if we have a seed to display
  const hasSeedPhrase = seedPhrase.length > 0;
  const wordCount = seedPhrase.length;

  // ─── PIN Verification ────────────────────────────────────────────

  const handleVerify = async (pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const isValid = await SecureStorage.verifyPin(pin);
      if (!isValid) return { success: false, error: 'Incorrect PIN' };
      SensitiveSession.start(pin);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Failed to verify PIN' };
    }
  };

  const handleVerifySuccess = async (pin: string) => {
    setCurrentPin(pin);
    try {
      if (isMultisig) {
        const desc = await SecureStorage.retrieveMultisigDescriptor(pin);
        if (desc) {
          setDescriptor(desc);
          const localSeeds = await SecureStorage.retrieveAllLocalCosignerSeeds(pin);
          setLocalCosignerSeeds(localSeeds);
        }
      } else {
        // Handle different wallet types appropriately
        const currentWalletId = activeWalletId || '';

        switch (walletType) {
          case 'hd_xprv': {
            // Extended private key - retrieve and display it
            const xprv = await SecureStorage.retrieveWalletXprv(currentWalletId, pin);
            if (xprv) {
              // Display xprv as a single "word" for the UI
              // User can copy it to back up
              setSeedPhrase([xprv]);
              setDescriptor(xprv); // Also set descriptor for alternative display
            }
            break;
          }

          case 'hd_seed': {
            // Raw seed bytes - retrieve and display as hex
            const seedHex = await SecureStorage.retrieveWalletSeedHex(currentWalletId, pin);
            if (seedHex) {
              // Display seed hex as a single "word"
              setSeedPhrase([seedHex]);
              setDescriptor(seedHex);
            }
            break;
          }

          case 'imported_key': {
            // Single imported private key - retrieve WIF
            const wif = await SecureStorage.retrieveWalletPrivateKey(currentWalletId, pin);
            if (wif) {
              setSeedPhrase([wif]);
              setDescriptor(wif);
            }
            break;
          }

          case 'hd':
          case 'hd_electrum':
          case 'hd_descriptor':
          default: {
            // Standard mnemonic-based wallet
            // Try wallet-specific seed first, then fall back to legacy single-wallet seed
            let mnemonic = await SecureStorage.retrieveWalletSeed(currentWalletId, pin);
            if (!mnemonic) {
              mnemonic = await SecureStorage.retrieveSeed(pin);
            }
            if (mnemonic && !mnemonic.startsWith('__imported_')) {
              setSeedPhrase(mnemonic.split(' '));
            }
            break;
          }
        }
      }
    } catch (err) {
      // Failed to load backup data
    }
    setViewState('display');
  };

  const handleBiometricSuccess = async (): Promise<{ success: boolean; pin?: string }> => {
    try {
      const pin = await SecureStorage.getPinForBiometrics();
      if (!pin) return { success: false };
      const isValid = await SecureStorage.verifyPin(pin);
      if (!isValid) return { success: false };
      SensitiveSession.start(pin);
      return { success: true, pin };
    } catch (err) {
      // Failed biometric auth
      return { success: false };
    }
  };

  // ─── Actions ─────────────────────────────────────────────────────

  const handleClose = () => {
    if (viewState === 'display' && hasSeedPhrase && !isWatchOnly) {
      Alert.alert(
        'Are you done?',
        'Make sure you have saved your seed phrase in a safe place.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Close',
            onPress: () => {
              setSeedPhrase([]);
              router.back();
            },
          },
        ]
      );
    } else {
      router.back();
    }
  };

  const handleCopyPhrase = async () => {
    if (showBlur && !isWatchOnly) return;
    const textToCopy = isMultisig ? descriptor : seedPhrase.join(' ');
    await copy(textToCopy);
  };

  const handleCopyCosignerSeed = async (index: number, seed: string) => {
    if (showBlur) return;
    await copy(seed);
  };

  const toggleCosignerExpanded = async (index: number) => {
    await haptics.trigger('selection');
    setExpandedCosigner(expandedCosigner === index ? null : index);
  };

  const getCosignerName = (cosignerIndex: number): string => {
    if (!multisigConfig) return `Signer ${cosignerIndex + 1}`;
    const cosigner = multisigConfig.cosigners[cosignerIndex];
    return cosigner?.name || `Signer ${cosignerIndex + 1}`;
  };

  const getCosignerByIndex = (cosignerIndex: number) => {
    if (!multisigConfig) return null;
    return multisigConfig.cosigners[cosignerIndex];
  };

  const cosignerHasSeed = useCallback((cosignerIndex: number): boolean => {
    return localCosignerSeeds.some(s => s.index === cosignerIndex);
  }, [localCosignerSeeds]);

  const handleRemoveSeed = async (cosignerIndex: number) => {
    const cosignerName = getCosignerName(cosignerIndex);
    Alert.alert(
      'Remove Seed Phrase',
      `Are you sure you want to remove the seed phrase for "${cosignerName}"?\n\nThis cosigner will become watch-only.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await haptics.trigger('warning');
              await SecureStorage.deleteLocalCosignerSeed(cosignerIndex);
              setLocalCosignerSeeds(prev => prev.filter(s => s.index !== cosignerIndex));
              await haptics.trigger('success');
              Alert.alert('Seed Removed', `"${cosignerName}" is now watch-only.`);
            } catch (error) {
              // Failed to remove seed
              Alert.alert('Error', 'Failed to remove seed phrase.');
            }
          },
        },
      ]
    );
  };

  const openImportModal = (cosignerIndex: number) => {
    const cosigner = getCosignerByIndex(cosignerIndex);
    if (!cosigner) return;
    setImportCosignerIndex(cosignerIndex);
    setImportCosignerName(cosigner.name);
    setImportCosignerXpub(cosigner.xpub);
    setImportSeedInput('');
    setImportError(null);
    setShowImportModal(true);
  };

  const isValidSeedPhrase = (phrase: string): boolean => {
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return words.length === 12 || words.length === 24;
  };

  const handleImportSeed = async () => {
    if (!importSeedInput.trim() || importCosignerIndex === null) {
      setImportError('Please enter a seed phrase');
      return;
    }
    if (!isValidSeedPhrase(importSeedInput)) {
      setImportError('Enter a valid 12 or 24 word seed phrase');
      return;
    }
    const mnemonic = importSeedInput.trim().toLowerCase();
    if (!SeedGenerator.validate(mnemonic)) {
      setImportError('Invalid seed phrase. Please check the words.');
      return;
    }

    setIsVerifying(true);
    setImportError(null);

    try {
      const seed = await SeedGenerator.toSeed(mnemonic);
      const keyDerivation = new KeyDerivation(seed, network);
      const scriptType = multisigConfig?.scriptType as 'p2sh' | 'p2sh-p2wsh' | 'p2wsh' || 'p2wsh';
      const derived = keyDerivation.getMultisigXpub(scriptType, 0);
      keyDerivation.destroy();

      let matchedCosignerIndex = importCosignerIndex;
      let matchedCosignerName = importCosignerName;
      let isMatch = derived.xpub === importCosignerXpub;

      if (!isMatch && multisigConfig) {
        const matchIdx = multisigConfig.cosigners.findIndex(c => c.xpub === derived.xpub);
        if (matchIdx !== -1) {
          matchedCosignerIndex = matchIdx;
          matchedCosignerName = multisigConfig.cosigners[matchIdx].name;
          isMatch = true;
        }
      }

      if (!isMatch) {
        setImportError('This seed phrase does not match any cosigner in this wallet.');
        setIsVerifying(false);
        await haptics.trigger('error');
        return;
      }

      if (matchedCosignerIndex !== importCosignerIndex) {
        setImportCosignerIndex(matchedCosignerIndex);
        setImportCosignerName(matchedCosignerName);
      }

      const finalIndex = matchedCosignerIndex ?? importCosignerIndex;
      if (finalIndex === null) {
        setImportError('Unable to determine cosigner index.');
        setIsVerifying(false);
        return;
      }

      if (!currentPin) {
        const pin = await SecureStorage.getPinForBiometrics();
        if (pin) {
          await SecureStorage.storeLocalCosignerSeed(finalIndex, mnemonic, pin);
        } else {
          setImportError('Unable to store seed. Please re-authenticate.');
          setIsVerifying(false);
          return;
        }
      } else {
        await SecureStorage.storeLocalCosignerSeed(finalIndex, mnemonic, currentPin);
      }

      setLocalCosignerSeeds(prev => [...prev, { index: finalIndex, seed: mnemonic }]);
      setIsVerifying(false);
      setShowImportModal(false);
      await haptics.trigger('success');

      const finalName = matchedCosignerName || importCosignerName;
      Alert.alert('Seed Imported', `"${finalName}" has been verified and stored.`);
    } catch (error) {
      // Failed to import seed
      setImportError('Failed to verify seed phrase. Please try again.');
      setIsVerifying(false);
    }
  };

  const handleShareBackup = async () => {
    if (showBlur && !isWatchOnly) return;
    await haptics.trigger('selection');

    if (isMultisig) {
      Alert.alert(
        'Share Wallet Configuration',
        'This will share your multisig descriptor. It does not expose private keys.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Share',
            onPress: async () => {
              try {
                const configToShare = JSON.stringify({ descriptor, config: multisigConfig }, null, 2);
                await Share.share({ message: configToShare, title: 'Multisig Wallet Configuration' });
              } catch (err) { /* share cancelled */ }
            },
          },
        ]
      );
    } else if (isWatchOnly) {
      try {
        await Share.share({ message: descriptor || 'Watch-only wallet', title: 'Wallet Export' });
      } catch (err) { /* share cancelled */ }
    } else {
      // Sensitive: show warning before sharing
      const isQRTab = displayTab === 'qr';
      Alert.alert(
        isQRTab ? 'Share QR Image' : 'Share Seed Phrase',
        'Anyone with your recovery phrase can steal your funds. Are you absolutely sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I Understand, Share',
            style: 'destructive',
            onPress: async () => {
              if (isQRTab && qrSvgRef.current) {
                await shareQRAsPNG(qrSvgRef.current, seedPhrase.join(' '), 'recovery-phrase-qr');
              } else {
                try {
                  await Share.share({ message: seedPhrase.join(' '), title: 'Recovery Phrase' });
                } catch (err) { /* share cancelled */ }
              }
            },
          },
        ]
      );
    }
  };

  const toggleBlur = async () => {
    await haptics.trigger('selection');
    if (showBlur) {
      setShowBlur(false);
      setRevealWarningShown(true);
    } else {
      setShowBlur(true);
    }
  };

  // ─── Styles ──────────────────────────────────────────────────────

  const styles = createStyles(colors, theme, isDark, insets);

  // ─── PIN Verification Screen ─────────────────────────────────────

  if (viewState === 'verify') {
    return (
      <PinCodeScreen
        mode="verify"
        title={isMultisig ? "Manage Keys" : "View Seed Phrase"}
        subtitle={isMultisig ? "Enter PIN to view and manage your signing keys" : "Enter PIN to reveal your recovery phrase"}
        icon={isMultisig ? "key" : "document"}
        iconColor={colors.text}
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── Watch-Only Wallet ───────────────────────────────────────────

  if (isWatchOnly) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name="close" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Backup</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.watchOnlyCard}>
            <View style={[styles.watchOnlyIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
              <Ionicons name="eye-outline" size={40} color={colors.textSecondary} />
            </View>
            <Text style={[styles.watchOnlyTitle, { color: colors.text }]}>
              No recovery phrase
            </Text>
            <Text style={[styles.watchOnlySubtitle, { color: colors.textSecondary }]}>
              This is a watch-only wallet. It cannot sign transactions or generate a seed phrase.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.watchOnlyActions}>
            <TouchableOpacity
              style={[styles.watchOnlyRow, { backgroundColor: colors.surface, overflow: 'hidden' }]}
              onPress={() => router.push('/(auth)/export-xpub' as any)}
            >
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={[styles.watchOnlyRowIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Ionicons name="key-outline" size={17} color={colors.textSecondary} />
              </View>
              <View style={styles.watchOnlyRowContent}>
                <Text style={[styles.watchOnlyRowTitle, { color: colors.text }]}>View Extended Public Key</Text>
                <Text style={[styles.watchOnlyRowSubtitle, { color: colors.textMuted }]}>View and share your xpub</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.watchOnlyRow, { backgroundColor: colors.surface, overflow: 'hidden' }]}
              onPress={() => router.push('/(auth)/export-descriptors' as any)}
            >
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={[styles.watchOnlyRowIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Ionicons name="code-slash-outline" size={17} color={colors.textSecondary} />
              </View>
              <View style={styles.watchOnlyRowContent}>
                <Text style={[styles.watchOnlyRowTitle, { color: colors.text }]}>View Output Descriptors</Text>
                <Text style={[styles.watchOnlyRowSubtitle, { color: colors.textMuted }]}>Full wallet descriptor</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.watchOnlyShareButton, {
                backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
              }]}
              onPress={handleShareBackup}
            >
              <Ionicons name="share-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.watchOnlyShareText, { color: '#FFFFFF' }]}>
                Share Wallet Info
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // ─── Multisig Wallet ─────────────────────────────────────────────

  if (isMultisig && multisigConfig) {
    // Determine which cosigners are local (have seeds)
    const localSignerIndices = localCosignerSeeds.map(s => s.index);
    const hasLocalSigner = localSignerIndices.length > 0;
    // Selected signer's seed data
    const selectedSeed = localCosignerSeeds.find(s => s.index === selectedSignerIndex);
    const selectedSeedWords = selectedSeed ? selectedSeed.seed.split(' ') : [];
    const selectedCosignerInfo = getCosignerByIndex(selectedSignerIndex);
    const isSelectedLocal = cosignerHasSeed(selectedSignerIndex);

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name="close" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Manage Keys</Text>
          <TouchableOpacity onPress={toggleBlur} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name={showBlur ? 'eye' : 'eye-off'} size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Policy Card */}
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={[styles.multisigPolicyCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={[styles.multisigIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
              <Ionicons name="people" size={28} color={colors.textSecondary} />
            </View>
            <Text style={[styles.multisigPolicyTitle, { color: colors.text }]}>
              {multisigConfig.m}-of-{multisigConfig.n} Multisig
            </Text>
            <Text style={[styles.multisigPolicySubtitle, { color: colors.textMuted }]}>
              {MULTISIG_SCRIPT_TYPE_LABELS[multisigConfig.scriptType] || multisigConfig.scriptType}
            </Text>
          </Animated.View>

          {/* Warning card */}
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={[styles.warningCard, { backgroundColor: isDark ? 'rgba(255,200,120,0.06)' : 'rgba(180,140,60,0.06)', overflow: 'hidden' }]}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={[styles.warningIconSmall, { backgroundColor: isDark ? 'rgba(255,200,120,0.12)' : 'rgba(180,140,60,0.10)' }]}>
              <Ionicons name="shield-outline" size={18} color={isDark ? 'rgba(255,210,140,0.7)' : 'rgba(150,110,40,0.7)'} />
            </View>
            <View style={styles.warningContent}>
              <Text style={[styles.warningTitle, { color: isDark ? 'rgba(255,210,140,0.8)' : 'rgba(140,100,30,0.8)' }]}>
                Keep this private
              </Text>
              <Text style={[styles.warningText, { color: colors.textSecondary }]}>
                Never share signing keys. Anyone with them can move your funds.
              </Text>
            </View>
          </Animated.View>

          {revealWarningShown && !showBlur && (
            <Animated.View entering={FadeIn.duration(300)} style={styles.revealMicrocopy}>
              <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.revealMicrocopyText, { color: colors.textMuted }]}>
                Make sure no one is watching your screen.
              </Text>
            </Animated.View>
          )}

          {/* Signer Selector */}
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>SIGNERS</Text>
            <View style={styles.signerSelector}>
              {multisigConfig.cosigners.map((cosigner, index) => {
                const isLocal = cosignerHasSeed(index);
                const isSelected = selectedSignerIndex === index;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.signerChip,
                      { backgroundColor: isSelected
                        ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                        : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)')
                      },
                      isSelected && { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)', borderWidth: 1 },
                    ]}
                    onPress={() => {
                      haptics.trigger('selection');
                      setSelectedSignerIndex(index);
                    }}
                  >
                    <Ionicons
                      name={isLocal ? 'key' : 'eye-outline'}
                      size={14}
                      color={isLocal ? colors.success : colors.textMuted}
                    />
                    <Text style={[styles.signerChipText, { color: isSelected ? colors.text : colors.textSecondary }]}>
                      {cosigner.name}
                    </Text>
                    {isLocal && (
                      <View style={[styles.signerLocalDot, { backgroundColor: colors.success }]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          {/* Selected Signer Content */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)}>
            {isSelectedLocal && selectedSeedWords.length > 0 ? (
              // Local signer — show words grid
              <View style={[styles.contentCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
                {Platform.OS === 'ios' && (
                  <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                )}
                <View style={styles.contentCardHeader}>
                  <Text style={[styles.contentCardTitle, { color: colors.text }]}>
                    Recovery Phrase
                  </Text>
                  <View style={[styles.wordCountChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Text style={[styles.wordCountChipText, { color: colors.textMuted }]}>
                      {selectedSeedWords.length}-word
                    </Text>
                  </View>
                </View>

                <View style={styles.wordsGrid}>
                  {selectedSeedWords.map((word, index) => (
                    <View
                      key={index}
                      style={[styles.wordCell, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' }]}
                    >
                      <Text style={[styles.wordIndex, { color: colors.textMuted }]}>
                        {index + 1}
                      </Text>
                      <Text style={[styles.wordValue, { color: colors.text }, showBlur && styles.wordBlurred]}>
                        {showBlur ? '•••••' : word}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={[styles.writeDownHint, { color: colors.textMuted }]}>
                  Write down these words in order.
                </Text>

                {/* Actions */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                    onPress={() => handleCopyCosignerSeed(selectedSignerIndex, selectedSeed!.seed)}
                    disabled={showBlur}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={16} color={showBlur ? colors.textMuted : colors.text} />
                    <Text style={[styles.actionPillText, { color: showBlur ? colors.textMuted : colors.text }]}>
                      {copied ? 'Copied!' : 'Copy Phrase'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.removePill, { backgroundColor: isDark ? 'rgba(255,70,70,0.10)' : 'rgba(220,50,50,0.06)' }]}
                    onPress={() => handleRemoveSeed(selectedSignerIndex)}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.removePillText, { color: colors.error }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // External or watch-only signer — show xpub/fingerprint
              <View style={[styles.contentCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
                {Platform.OS === 'ios' && (
                  <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                )}
                <View style={styles.contentCardHeader}>
                  <Text style={[styles.contentCardTitle, { color: colors.text }]}>
                    {selectedCosignerInfo?.name || `Signer ${selectedSignerIndex + 1}`}
                  </Text>
                  <View style={[styles.watchOnlyChip, { backgroundColor: isDark ? 'rgba(255,200,50,0.10)' : 'rgba(200,150,30,0.08)' }]}>
                    <Text style={[styles.watchOnlyChipText, { color: isDark ? 'rgba(255,210,80,0.7)' : 'rgba(170,120,20,0.7)' }]}>
                      WATCH-ONLY
                    </Text>
                  </View>
                </View>

                <View style={[styles.infoRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                  <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Fingerprint</Text>
                  <Text style={[styles.infoValue, { color: colors.text }, showBlur && styles.wordBlurred]}>
                    {showBlur ? '••••••••' : (selectedCosignerInfo?.fingerprint || '—')}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Extended Public Key</Text>
                  <Text style={[styles.infoValueMono, { color: colors.textSecondary }, showBlur && styles.wordBlurred]} numberOfLines={2}>
                    {showBlur ? '••••••••••••••••••••' : (selectedCosignerInfo?.xpub || '—')}
                  </Text>
                </View>

                {!isSelectedLocal && (
                  <TouchableOpacity
                    style={[styles.importButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
                    onPress={() => openImportModal(selectedSignerIndex)}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                    <Text style={[styles.importButtonText, { color: '#FFFFFF' }]}>
                      Import Seed Phrase
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Animated.View>

          {/* Descriptor */}
          <Animated.View entering={FadeInDown.delay(400).duration(500)}>
            <View style={[styles.contentCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={styles.contentCardHeader}>
                <Text style={[styles.contentCardTitle, { color: colors.text }]}>Output Descriptor</Text>
              </View>
              <View style={[styles.descriptorBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)' }]}>
                <Text
                  style={[styles.descriptorText, { color: colors.text }, showBlur && styles.wordBlurred]}
                  selectable={!showBlur}
                >
                  {showBlur ? '•'.repeat(Math.min(descriptor.length, 80)) : descriptor}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.actionPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignSelf: 'flex-start', marginTop: 12 }]}
                onPress={handleCopyPhrase}
                disabled={showBlur}
              >
                <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={16} color={showBlur ? colors.textMuted : colors.text} />
                <Text style={[styles.actionPillText, { color: showBlur ? colors.textMuted : colors.text }]}>
                  {copied ? 'Copied!' : 'Copy Descriptor'}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Share Config */}
          <Animated.View entering={FadeInDown.delay(500).duration(500)} style={{ marginTop: 4 }}>
            <TouchableOpacity
              style={[styles.shareConfigButton, { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }]}
              onPress={handleShareBackup}
              disabled={showBlur}
            >
              <Ionicons name="share-outline" size={18} color={showBlur ? colors.textMuted : colors.text} />
              <Text style={[styles.shareConfigText, { color: showBlur ? colors.textMuted : colors.text }]}>
                Export Configuration
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>

        {/* Import Seed Sheet */}
        {renderImportSheet()}
      </View>
    );
  }

  // ─── Single-Sig Wallet ───────────────────────────────────────────

  const qrData = seedPhrase.join(' ');
  const qrMaxWidth = Math.min(SCREEN_WIDTH - 120, 280);
  const isActionsDisabled = showBlur;

  // Helper for import sheet (shared with multisig)
  function renderImportSheet() {
    return (
      <AppBottomSheet
        visible={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Import Seed Phrase"
        subtitle="Verify and store a cosigner's recovery phrase"
        showCloseButton={true}
        sizing="large"
        scrollable={true}
      >
        <View style={styles.modalContent}>
          <View style={[styles.importInfoCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={[styles.importIconBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
              <Ionicons name="key" size={24} color={colors.textSecondary} />
            </View>
            <Text style={[styles.importInfoTitle, { color: colors.text }]}>
              {importCosignerName}
            </Text>
            <Text style={[styles.importInfoSubtitle, { color: colors.textSecondary }]}>
              The seed will be verified against the stored xpub before saving.
            </Text>
          </View>

          <View style={[styles.seedInputCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <Text style={[styles.seedInputLabel, { color: colors.text }]}>
              Seed Phrase (12 or 24 words)
            </Text>
            <PremiumInputCard>
              <PremiumInput
                icon="key-outline"
                iconColor="#FF9F0A"
                placeholder="Enter seed phrase words separated by spaces..."
                value={importSeedInput}
                onChangeText={(text) => {
                  setImportSeedInput(text);
                  setImportError(null);
                }}
                monospace={true}
                multiline
                numberOfLines={4}
                autoCapitalize="none"
                autoCorrect={false}
                textAlignVertical="top"
              />
            </PremiumInputCard>
            {importError && (
              <View style={styles.importErrorRow}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={[styles.importErrorText, { color: colors.error }]}>{importError}</Text>
              </View>
            )}
          </View>

          <View style={styles.wordCountIndicator}>
            <Text style={[styles.wordCountLabel, { color: colors.textSecondary }]}>
              Words: {importSeedInput.trim().split(/\s+/).filter(w => w.length > 0).length}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.importSubmitButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
              (!importSeedInput.trim() || isVerifying) && { opacity: 0.4 },
            ]}
            onPress={handleImportSeed}
            disabled={!importSeedInput.trim() || isVerifying}
          >
            {isVerifying ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={[styles.importSubmitText, { color: '#FFFFFF' }]}>Verifying...</Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={[styles.importSubmitText, { color: '#FFFFFF' }]}>Verify & Import</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.importCancelButton, { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }]}
            onPress={() => setShowImportModal(false)}
          >
            <Text style={[styles.importCancelText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="close" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Backup</Text>
        <TouchableOpacity onPress={toggleBlur} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name={showBlur ? 'eye' : 'eye-off'} size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Security Warning Card */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={[styles.warningCard, { backgroundColor: isDark ? 'rgba(255,200,120,0.06)' : 'rgba(180,140,60,0.06)', overflow: 'hidden' }]}>
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <View style={[styles.warningIconSmall, { backgroundColor: isDark ? 'rgba(255,200,120,0.12)' : 'rgba(180,140,60,0.10)' }]}>
            <Ionicons name="shield-outline" size={18} color={isDark ? 'rgba(255,210,140,0.7)' : 'rgba(150,110,40,0.7)'} />
          </View>
          <View style={styles.warningContent}>
            <Text style={[styles.warningTitle, { color: isDark ? 'rgba(255,210,140,0.8)' : 'rgba(140,100,30,0.8)' }]}>
              Keep this private
            </Text>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              Never share it. Anyone with it can take your funds.
            </Text>
          </View>
        </Animated.View>

        {/* Reveal microcopy */}
        {revealWarningShown && !showBlur && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.revealMicrocopy}>
            <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.revealMicrocopyText, { color: colors.textMuted }]}>
              Make sure no one is watching your screen.
            </Text>
          </Animated.View>
        )}

        {/* 2. Segmented Control */}
        <Animated.View entering={FadeInDown.delay(150).duration(500)} style={[styles.segmentedControl, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)', overflow: 'hidden' }]}>
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <TouchableOpacity
            style={[
              styles.segment,
              displayTab === 'words' && [styles.segmentActive, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#FFFFFF' }],
            ]}
            onPress={() => setDisplayTab('words')}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.segmentText,
              { color: displayTab === 'words' ? colors.text : colors.textSecondary },
              displayTab === 'words' && styles.segmentTextActive,
            ]}>
              Words
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segment,
              displayTab === 'qr' && [styles.segmentActive, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#FFFFFF' }],
            ]}
            onPress={() => setDisplayTab('qr')}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.segmentText,
              { color: displayTab === 'qr' ? colors.text : colors.textSecondary },
              displayTab === 'qr' && styles.segmentTextActive,
            ]}>
              QR Code
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* 3. Main Content */}
        {displayTab === 'words' ? (
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <View style={[styles.contentCard, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={styles.contentCardHeader}>
                <Text style={[styles.contentCardTitle, { color: colors.text }]}>
                  {walletType === 'hd_xprv' ? 'Extended Private Key' :
                   walletType === 'hd_seed' ? 'Seed Bytes (Hex)' :
                   walletType === 'imported_key' ? 'Private Key (WIF)' :
                   'Recovery Phrase'}
                </Text>
                {/* Show word count chip only for mnemonic wallets */}
                {(walletType === 'hd' || walletType === 'hd_electrum' || walletType === 'hd_descriptor' || wordCount > 1) && wordCount !== 1 && (
                  <View style={[styles.wordCountChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Text style={[styles.wordCountChipText, { color: colors.textMuted }]}>
                      {wordCount}-word
                    </Text>
                  </View>
                )}
              </View>

              {/* Show error if no backup data could be loaded */}
              {!hasSeedPhrase ? (
                <View style={{ alignItems: 'center', padding: 24 }}>
                  <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
                  <Text style={[styles.writeDownHint, { color: colors.textSecondary, marginTop: 12 }]}>
                    Could not load backup data for this wallet.
                  </Text>
                </View>
              ) : /* For non-mnemonic wallet types, show the key in a single block */
              (walletType === 'hd_xprv' || walletType === 'hd_seed' || walletType === 'imported_key') && wordCount === 1 ? (
                <View style={[styles.descriptorBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)' }]}>
                  <Text
                    style={[styles.descriptorText, { color: colors.text }, showBlur && styles.wordBlurred]}
                    selectable={!showBlur}
                  >
                    {showBlur ? '•'.repeat(Math.min(seedPhrase[0]?.length || 40, 60)) : seedPhrase[0]}
                  </Text>
                </View>
              ) : (
                <View style={[styles.wordsGrid, wordCount <= 12 && styles.wordsGrid2Col]}>
                  {seedPhrase.map((word, index) => (
                    <View
                      key={index}
                      style={[
                        styles.wordCell,
                        wordCount <= 12 && styles.wordCell2Col,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)' },
                      ]}
                    >
                      <Text style={[styles.wordIndex, { color: colors.textMuted }]}>
                        {index + 1}
                      </Text>
                      <Text style={[styles.wordValue, { color: colors.text }, showBlur && styles.wordBlurred]}>
                        {showBlur ? '•••••' : word}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {hasSeedPhrase && (
                <Text style={[styles.writeDownHint, { color: colors.textMuted }]}>
                  {walletType === 'hd_xprv' ? 'Copy and store this extended private key securely.' :
                   walletType === 'hd_seed' ? 'Copy and store this seed hex securely.' :
                   walletType === 'imported_key' ? 'Copy and store this private key securely.' :
                   'Write down these words in order.'}
                </Text>
              )}
            </View>
          </Animated.View>
        ) : (
          /* QR Code — matches Receive page design exactly */
          <Animated.View entering={FadeIn.delay(200).duration(500)} style={styles.qrArea}>
            <View style={[styles.qrCard, { backgroundColor: getColors(themeMode).qrCode.bg }]}>
              {showBlur ? (
                <View style={[styles.qrBlurred, { width: SCREEN_WIDTH - 120, height: SCREEN_WIDTH - 120 }]}>
                  <Ionicons name="eye-off" size={44} color={colors.textMuted} />
                  <Text style={[styles.qrBlurredText, { color: colors.textMuted }]}>
                    Tap the eye icon to reveal
                  </Text>
                </View>
              ) : (
                <QRCode
                  address={qrData}
                  size={SCREEN_WIDTH - 120}
                  showLogo={true}
                  onRef={(ref) => { qrSvgRef.current = ref; }}
                />
              )}
            </View>

            <View style={[styles.qrWarningPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
              <Ionicons name="shield-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.qrWarningText, { color: colors.textMuted }]}>
                Only scan in trusted environments
              </Text>
            </View>
          </Animated.View>
        )}

        {/* 4. Actions Row — matches Receive page button system */}
        <Animated.View entering={FadeInDown.delay(300).duration(500)} style={styles.secondaryRow}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' },
              isActionsDisabled && { opacity: 0.35 },
            ]}
            onPress={handleCopyPhrase}
            disabled={isActionsDisabled}
            activeOpacity={0.7}
          >
            <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={colors.text} />
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              {copied ? 'Copied!' : (displayTab === 'qr' ? 'Copy QR Data' : 'Copy Phrase')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' },
              isActionsDisabled && { opacity: 0.35 },
            ]}
            onPress={handleShareBackup}
            disabled={isActionsDisabled}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={18} color={colors.text} />
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Share</Text>
          </TouchableOpacity>
        </Animated.View>

        {isActionsDisabled && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.revealToActHint}>
            <Ionicons name="eye-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.revealToActHintText, { color: colors.textMuted }]}>
              Reveal to copy or share
            </Text>
          </Animated.View>
        )}

        {/* 5. Storage Tips (Collapsible) */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)}>
          <TouchableOpacity
            style={[styles.tipsHeader, { backgroundColor: colors.surface, overflow: 'hidden' }]}
            onPress={() => {
              haptics.trigger('selection');
              setTipsExpanded(!tipsExpanded);
            }}
            activeOpacity={0.7}
          >
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.tipsHeaderLeft}>
              <Ionicons name="bulb-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.tipsHeaderTitle, { color: colors.text }]}>Storage Tips</Text>
            </View>
            <Ionicons
              name={tipsExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {!tipsExpanded && (
            <View style={[styles.tipsPreview, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <Text style={[styles.tipsPreviewText, { color: colors.textMuted }]}>
                Write it down on paper, store in a secure location...
              </Text>
            </View>
          )}

          {tipsExpanded && (
            <Animated.View entering={FadeIn.duration(200)} style={[styles.tipsBody, { backgroundColor: colors.surface, overflow: 'hidden' }]}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              {[
                { icon: 'create-outline', text: 'Write it down on paper, in exact order' },
                { icon: 'lock-closed-outline', text: 'Store in a secure location (safe, vault)' },
                { icon: 'cloud-offline-outline', text: 'Never store in cloud or take photos' },
                { icon: 'shield-checkmark-outline', text: 'Consider a metal backup for durability' },
              ].map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <View style={[styles.tipIconBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                    <Ionicons name={tip.icon as any} size={15} color={colors.textSecondary} />
                  </View>
                  <Text style={[styles.tipText, { color: colors.textSecondary }]}>
                    {tip.text}
                  </Text>
                </View>
              ))}
            </Animated.View>
          )}
        </Animated.View>
      </ScrollView>

      {/* 6. Sticky Bottom CTA */}
      <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' }]}
          onPress={() => {
            haptics.trigger('selection');
            router.push('/(auth)/backup-flow' as any);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
            Back up wallet
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const createStyles = (colors: any, theme: any, isDark: boolean, insets: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonBg: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
    },

    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 24,
    },

    // Warning Card (soft, premium)
    warningCard: {
      flexDirection: 'row',
      borderRadius: 14,
      padding: 14,
      marginBottom: 16,
      gap: 12,
      alignItems: 'center',
    },
    warningIconSmall: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    warningContent: {
      flex: 1,
    },
    warningTitle: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 2,
    },
    warningText: {
      fontSize: 13,
      lineHeight: 17,
    },

    // Reveal microcopy
    revealMicrocopy: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 16,
      marginTop: -4,
    },
    revealMicrocopyText: {
      fontSize: 12,
      fontWeight: '500',
    },

    // Segmented Control
    segmentedControl: {
      flexDirection: 'row',
      borderRadius: 12,
      padding: 3,
      marginBottom: 20,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: 10,
    },
    segmentActive: {
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isDark ? 0.3 : 0.08,
          shadowRadius: 3,
        },
        android: { elevation: 2 },
      }),
    },
    segmentText: {
      fontSize: 14,
      fontWeight: '500',
    },
    segmentTextActive: {
      fontWeight: '600',
    },

    // Content Card (soft card style)
    contentCard: {
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
    },
    contentCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    contentCardTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    wordCountChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
    },
    wordCountChipText: {
      fontSize: 12,
      fontWeight: '600',
    },

    // Words Grid — 3-column default for 24, 2-column for 12
    wordsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    wordsGrid2Col: {
      // Override for 12-word (2 columns)
    },
    wordCell: {
      width: '31%',
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 10,
      gap: 8,
    },
    wordCell2Col: {
      width: '48%',
    },
    wordIndex: {
      fontSize: 11,
      fontWeight: '700',
      width: 18,
      textAlign: 'center',
    },
    wordValue: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
    },
    wordBlurred: {
      opacity: 0.2,
    },
    writeDownHint: {
      fontSize: 12,
      textAlign: 'center',
      marginTop: 14,
    },

    // QR Area — matches Receive page exactly
    qrArea: {
      alignItems: 'center',
      marginBottom: 24,
    },
    qrCard: {
      borderRadius: 24,
      padding: 20,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.4 : 0.08,
          shadowRadius: isDark ? 20 : 16,
        },
        android: {
          elevation: isDark ? 8 : 4,
        },
      }),
    },
    qrBlurred: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    qrBlurredText: {
      fontSize: 14,
      fontWeight: '500',
    },
    qrWarningPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      gap: 6,
      marginTop: 14,
    },
    qrWarningText: {
      fontSize: 12,
      fontWeight: '500',
    },

    // Secondary Actions — matches Receive page buttons
    secondaryRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 8,
    },
    secondaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 45,
      borderRadius: 24,
      borderWidth: 1,
      gap: 6,
    },
    secondaryButtonText: {
      fontSize: 15,
      fontWeight: '600',
    },

    // Actions Row (multisig signer card internal)
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    actionPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      gap: 7,
    },
    actionPillText: {
      fontSize: 14,
      fontWeight: '600',
    },
    revealToActHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      marginBottom: 16,
      marginTop: 2,
    },
    revealToActHintText: {
      fontSize: 12,
      fontWeight: '500',
    },

    // Remove pill (multisig signer)
    removePill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      gap: 7,
    },
    removePillText: {
      fontSize: 14,
      fontWeight: '600',
    },

    // Tips (Collapsible)
    tipsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
      marginTop: 12,
    },
    tipsHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    tipsHeaderTitle: {
      fontSize: 15,
      fontWeight: '600',
    },
    tipsPreview: {
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
      paddingHorizontal: 16,
      paddingBottom: 14,
      paddingTop: 0,
    },
    tipsPreviewText: {
      fontSize: 13,
      lineHeight: 18,
    },
    tipsBody: {
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 12,
    },
    tipItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    tipIconBg: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tipText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 17,
    },

    // Sticky Bottom
    stickyBottom: {
      paddingHorizontal: 24,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    primaryButton: {
      height: 50,
      borderRadius: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
    },

    // Watch-Only Styles
    watchOnlyCard: {
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 20,
    },
    watchOnlyIconContainer: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    watchOnlyTitle: {
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 8,
    },
    watchOnlySubtitle: {
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 21,
    },
    watchOnlyActions: {
      gap: 10,
    },
    watchOnlyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 14,
      gap: 12,
    },
    watchOnlyRowIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    watchOnlyRowContent: {
      flex: 1,
    },
    watchOnlyRowTitle: {
      fontSize: 15,
      fontWeight: '600',
    },
    watchOnlyRowSubtitle: {
      fontSize: 12,
      marginTop: 2,
    },
    watchOnlyShareButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 46,
      borderRadius: 12,
      gap: 8,
      marginTop: 8,
    },
    watchOnlyShareText: {
      fontSize: 16,
      fontWeight: '600',
    },

    // Multisig Styles
    multisigPolicyCard: {
      alignItems: 'center',
      padding: 24,
      borderRadius: 16,
      marginBottom: 16,
    },
    multisigIconContainer: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    multisigPolicyTitle: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 4,
    },
    multisigPolicySubtitle: {
      fontSize: 14,
    },

    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 1,
      marginBottom: 10,
      marginTop: 4,
    },

    // Signer Selector
    signerSelector: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    signerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      gap: 6,
    },
    signerChipText: {
      fontSize: 13,
      fontWeight: '600',
    },
    signerLocalDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },

    // Watch-only chip (inside multisig signer card)
    watchOnlyChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    watchOnlyChipText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },

    // Info rows (multisig signer detail)
    infoRow: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    infoLabel: {
      fontSize: 12,
      fontWeight: '500',
      marginBottom: 4,
    },
    infoValue: {
      fontSize: 15,
      fontWeight: '600',
    },
    infoValueMono: {
      fontSize: 12,
      lineHeight: 18,
    },

    // Import button (multisig)
    importButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 45,
      borderRadius: 24,
      gap: 8,
      marginTop: 16,
    },
    importButtonText: {
      fontSize: 15,
      fontWeight: '600',
    },

    // Descriptor
    descriptorBox: {
      padding: 14,
      borderRadius: 10,
    },
    descriptorText: {
      fontSize: 12,
      lineHeight: 17,
    },

    // Share config (multisig)
    shareConfigButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 44,
      borderRadius: 11,
      borderWidth: 1,
      gap: 8,
      marginBottom: 16,
    },
    shareConfigText: {
      fontSize: 15,
      fontWeight: '600',
    },

    // Import Sheet
    modalContent: {
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    importInfoCard: {
      alignItems: 'center',
      padding: 24,
      borderRadius: 16,
      marginBottom: 16,
    },
    importIconBg: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    importInfoTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 8,
    },
    importInfoSubtitle: {
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    seedInputCard: {
      padding: 20,
      borderRadius: 14,
      marginBottom: 12,
    },
    seedInputLabel: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 10,
    },
    importErrorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      gap: 6,
    },
    importErrorText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '500',
    },
    wordCountIndicator: {
      alignItems: 'center',
      marginBottom: 16,
    },
    wordCountLabel: {
      fontSize: 13,
    },
    importSubmitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 46,
      borderRadius: 12,
      gap: 8,
      marginBottom: 10,
    },
    importSubmitText: {
      fontSize: 16,
      fontWeight: '600',
    },
    importCancelButton: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 44,
      borderRadius: 11,
      borderWidth: 1,
    },
    importCancelText: {
      fontSize: 16,
      fontWeight: '600',
    },
  });
