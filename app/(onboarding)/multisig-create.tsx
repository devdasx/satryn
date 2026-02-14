import '../../shim';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Pressable,
  useColorScheme,
  Share,
  Animated,
  Dimensions,
} from 'react-native';
import { AppBottomSheet, KeyboardSafeBottomBar } from '../../src/components/ui';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { QRScanner } from '../../src/components/scanner';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME, getThemeColors, ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer } from '../../src/services/auth/SecureSessionTransfer';
import { SeedGenerator, KeyDerivation } from '../../src/core/wallet';
import { addDescriptorChecksum } from '../../src/utils/descriptor';

type Step = 'setup' | 'cosigners' | 'review';
type ScriptType = 'p2wsh' | 'p2sh-p2wsh' | 'p2sh';

interface Cosigner {
  id: string;
  name: string;
  xpub: string;
  fingerprint: string;
  derivationPath: string;
  isLocal: boolean;
  localIndex?: number;
  seedHash?: string; // Hash of seed phrase for duplicate detection (not the actual seed)
  mnemonic?: string; // Only stored for local cosigners we created - passed to setup for secure storage
}

const SCRIPT_TYPES: { value: ScriptType; label: string; description: string; recommended?: boolean }[] = [
  {
    value: 'p2wsh',
    label: 'Native SegWit (P2WSH)',
    description: 'Lowest fees, modern wallets',
    recommended: true,
  },
  {
    value: 'p2sh-p2wsh',
    label: 'Wrapped SegWit',
    description: 'Wider compatibility',
  },
  {
    value: 'p2sh',
    label: 'Legacy (P2SH)',
    description: 'Maximum compatibility',
  },
];

const DEFAULT_WALLET_NAME = 'Multisig Wallet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SMALL_SCREEN = SCREEN_HEIGHT < 700;

// Simple xpub validation
const isValidXpub = (xpub: string): boolean => {
  const trimmed = xpub.trim();
  const validPrefixes = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub', 'tpub', 'upub', 'vpub'];
  const hasValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));
  return hasValidPrefix && trimmed.length >= 100;
};

// Generate fingerprint for local signers
const generateLocalFingerprint = (index: number): string => {
  const chars = 'ABCDEF0123456789';
  let fingerprint = '';
  const seed = (index + 1) * 7919;
  for (let i = 0; i < 8; i++) {
    fingerprint += chars[(seed * (i + 1) * 31) % chars.length];
  }
  return fingerprint;
};

// Generate a hash from seed phrase for duplicate detection (NOT the actual seed)
const generateSeedHash = (seedPhrase: string): string => {
  const normalized = seedPhrase.trim().toLowerCase().split(/\s+/).join(' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `seed_${Math.abs(hash).toString(16).padStart(8, '0')}`;
};

export default function MultisigCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Theme
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  // Step state
  const [step, setStep] = useState<Step>('setup');

  // Step 1: Setup state
  const [walletName, setWalletName] = useState('');
  const [requiredSigs, setRequiredSigs] = useState(2);
  const [totalSigners, setTotalSigners] = useState(3);
  const [scriptType, setScriptType] = useState<ScriptType>('p2wsh');

  // Step 2: Cosigners state
  const [cosigners, setCosigners] = useState<Cosigner[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sheetMode, setSheetMode] = useState<'default' | 'import-seed'>('default');
  const [xpubInput, setXpubInput] = useState('');
  const [cosignerName, setCosignerName] = useState('');
  const [xpubError, setXpubError] = useState<string | null>(null);
  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [importSignerName, setImportSignerName] = useState('');

  // Derive local signer count from actual cosigners (not a separate counter)
  const localSignerCount = useMemo(() =>
    cosigners.filter(c => c.isLocal).length,
    [cosigners]
  );

  // UI state
  const [showScanner, setShowScanner] = useState(false);

  // Animation
  const fadeAnim = useRef(new Animated.Value(1)).current;


  const styles = createStyles(colors, isDark);


  // Xpub validation
  useEffect(() => {
    if (xpubInput.trim().length > 0) {
      if (!isValidXpub(xpubInput)) {
        setXpubError('Invalid xpub format');
      } else {
        const trimmedXpub = xpubInput.trim();
        const isDuplicate = cosigners.some(c =>
          c.xpub.startsWith(trimmedXpub.substring(0, 20)) ||
          trimmedXpub.startsWith(c.xpub.replace('...', ''))
        );
        if (isDuplicate) {
          setXpubError('This xpub has already been added');
        } else {
          setXpubError(null);
        }
      }
    } else {
      setXpubError(null);
    }
  }, [xpubInput, cosigners]);

  // Step transition animation - matches Create Wallet
  const animateTransition = useCallback((direction: 'forward' | 'back', callback: () => void) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      callback();
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
  }, [fadeAnim]);

  // Config for review
  const config = useMemo(() => ({
    name: walletName.trim() || DEFAULT_WALLET_NAME,
    m: requiredSigs,
    n: totalSigners,
    scriptType,
    cosigners,
  }), [walletName, requiredSigs, totalSigners, scriptType, cosigners]);

  // Derivation path based on script type
  const derivationPath = useMemo(() => {
    switch (scriptType) {
      case 'p2wsh': return "m/48'/0'/0'/2'";
      case 'p2sh-p2wsh': return "m/48'/0'/0'/1'";
      case 'p2sh': return "m/48'/0'/0'/0'";
      default: return "m/48'/0'/0'/2'";
    }
  }, [scriptType]);

  // Network (mainnet for production)
  const network = 'Bitcoin Mainnet';

  // Get the script type suffix for the derivation path
  const getScriptTypeSuffix = useCallback((st: ScriptType): string => {
    switch (st) {
      case 'p2wsh': return '2h'; // Native SegWit
      case 'p2sh-p2wsh': return '1h'; // Wrapped SegWit
      case 'p2sh': return '0h'; // Legacy
      default: return '2h';
    }
  }, []);

  // Build the descriptor wrapper based on script type
  const wrapDescriptor = useCallback((multiExpr: string, st: ScriptType): string => {
    switch (st) {
      case 'p2wsh':
        return `wsh(${multiExpr})`;
      case 'p2sh-p2wsh':
        return `sh(wsh(${multiExpr}))`;
      case 'p2sh':
        return `sh(${multiExpr})`;
      default:
        return `wsh(${multiExpr})`;
    }
  }, []);

  // Descriptor with real BIP380 checksum
  const descriptor = useMemo(() => {
    if (cosigners.length === 0) return '';
    const scriptSuffix = getScriptTypeSuffix(scriptType);
    const xpubs = cosigners.map((c) =>
      `[${c.fingerprint}/48h/0h/0h/${scriptSuffix}]${c.xpub}`
    ).join(',');
    const multiExpr = `sortedmulti(${requiredSigs},${xpubs})`;
    const baseDescriptor = wrapDescriptor(multiExpr, scriptType);
    // Compute real BIP380 checksum
    return addDescriptorChecksum(baseDescriptor);
  }, [cosigners, requiredSigs, scriptType, getScriptTypeSuffix, wrapDescriptor]);

  // Full descriptor for display (formatted with newlines)
  const descriptorFormatted = useMemo(() => {
    const scriptSuffix = getScriptTypeSuffix(scriptType);
    const xpubs = cosigners.map((c) =>
      `[${c.fingerprint}/48h/0h/0h/${scriptSuffix}]${c.xpub}`
    ).join(',\n');
    const multiExpr = `sortedmulti(${requiredSigs},\n${xpubs}\n)`;
    return `${wrapDescriptor(multiExpr, scriptType)}#checksum`;
  }, [cosigners, requiredSigs, scriptType, getScriptTypeSuffix, wrapDescriptor]);

  // Professional share content with all required details
  const getFullShareContent = useCallback(() => {
    const cosignerDetails = cosigners.map((c, i) =>
      `${i + 1}. ${c.name}\n   Fingerprint: ${c.fingerprint}\n   Type: ${c.isLocal ? 'Local' : 'External'}`
    ).join('\n\n');

    return [
      '═══════════════════════════════════════════════',
      'MULTISIG WALLET CONFIGURATION',
      '═══════════════════════════════════════════════',
      '',
      `Wallet Name: ${config.name}`,
      '',
      `Network: ${network}`,
      '',
      `Multisig Policy: ${config.m}-of-${config.n}`,
      '',
      `Address Format: ${getScriptTypeLabel(config.scriptType)} (${config.scriptType.toUpperCase()})`,
      '',
      `Derivation Path: ${derivationPath}`,
      '',
      '───────────────────────────────────────────────',
      'SIGNERS',
      '───────────────────────────────────────────────',
      '',
      cosignerDetails,
      '',
      '───────────────────────────────────────────────',
      'WALLET DESCRIPTOR (Required for Import)',
      '───────────────────────────────────────────────',
      '',
      descriptorFormatted,
      '',
      '═══════════════════════════════════════════════',
      'IMPORT INSTRUCTIONS',
      '═══════════════════════════════════════════════',
      '',
      '1. Import this configuration as a multisig wallet',
      '   using the full descriptor above.',
      '',
      '2. Verify the checksum matches when importing.',
      '',
      '3. Ensure all signers import the same descriptor.',
      '',
      '───────────────────────────────────────────────',
      'SECURITY NOTICE',
      '───────────────────────────────────────────────',
      '',
      '⚠ Do not share this file publicly.',
      '',
      '✓ This configuration allows WATCH-ONLY access',
      '  and multisig coordination.',
      '',
      '✓ No private keys or recovery phrases are included.',
      '',
      '✓ Spending requires signatures from the actual',
      '  private keys held by each signer.',
      '',
      '═══════════════════════════════════════════════',
    ].join('\n');
  }, [config, cosigners, derivationPath, descriptorFormatted, network]);


  // Check if there's unsaved progress
  const hasProgress = useMemo(() => {
    return walletName.trim().length > 0 ||
           cosigners.length > 0 ||
           requiredSigs !== 2 ||
           totalSigners !== 3 ||
           scriptType !== 'p2wsh';
  }, [walletName, cosigners, requiredSigs, totalSigners, scriptType]);

  // Navigation handlers
  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    switch (step) {
      case 'setup':
        if (hasProgress) {
          Alert.alert(
            'Exit Multisig Setup?',
            'Your configuration will be lost. Are you sure you want to exit?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Exit',
                style: 'destructive',
                onPress: () => router.back(),
              },
            ]
          );
        } else {
          router.back();
        }
        break;
      case 'cosigners':
        animateTransition('back', () => setStep('setup'));
        break;
      case 'review':
        animateTransition('back', () => setStep('cosigners'));
        break;
    }
  }, [step, router, animateTransition, hasProgress]);

  // Step 1 handlers
  const handleRequiredChange = useCallback((delta: number) => {
    const newValue = requiredSigs + delta;
    if (newValue >= 1 && newValue <= totalSigners && newValue <= 15) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRequiredSigs(newValue);
    }
  }, [requiredSigs, totalSigners]);

  const handleTotalChange = useCallback((delta: number) => {
    const newValue = totalSigners + delta;
    if (newValue >= 2 && newValue <= 15) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTotalSigners(newValue);
      if (requiredSigs > newValue) {
        setRequiredSigs(newValue);
      }
    }
  }, [totalSigners, requiredSigs]);

  const handleScriptTypeSelect = useCallback((type: ScriptType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setScriptType(type);
  }, []);

  const handleNextFromSetup = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateTransition('forward', () => setStep('cosigners'));
  }, [animateTransition]);

  // Step 2 handlers
  const handleAddThisDevice = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Generate a new seed phrase for this local signer
      const mnemonic = SeedGenerator.generate(12);
      const seed = await SeedGenerator.toSeed(mnemonic);
      const keyDerivation = new KeyDerivation(seed, 'mainnet');

      // Get xpub info for BIP48 multisig path based on selected script type
      const multisigXpub = keyDerivation.getMultisigXpub(scriptType, 0);

      // Get master fingerprint
      const fingerprint = multisigXpub.fingerprint;

      // Clean up sensitive data
      keyDerivation.destroy();

      // Find the next available index by looking at max existing localIndex + 1
      // Index starts at 0 for consistency with storage
      const existingLocalIndices = cosigners
        .filter(c => c.isLocal && c.localIndex !== undefined)
        .map(c => c.localIndex as number);
      const nextIndex = existingLocalIndices.length > 0
        ? Math.max(...existingLocalIndices) + 1
        : 0;

      if (cosigners.some(c => c.fingerprint === fingerprint)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Error', 'Could not generate unique signer. Please try again.');
        return;
      }

      const newCosigner: Cosigner = {
        id: `local-${Date.now()}-${nextIndex}`,
        name: `Local Signer ${nextIndex + 1}`,
        xpub: multisigXpub.xpub, // Real xpub derived from generated seed using BIP48
        fingerprint,
        derivationPath: multisigXpub.path, // BIP48 path from getMultisigXpub
        isLocal: true,
        localIndex: nextIndex,
        mnemonic: mnemonic, // Store seed for secure storage during wallet creation
      };

      setCosigners([...cosigners, newCosigner]);
      setShowAddModal(false);
    } catch (error) {
      // Failed to generate local signer
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to generate local signer. Please try again.');
    }
  }, [cosigners, scriptType]);

  const handleAddFromXpub = useCallback(() => {
    if (!xpubInput.trim() || !cosignerName.trim() || xpubError) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const fullXpub = xpubInput.trim();
    const newCosigner: Cosigner = {
      id: `ext-${Date.now()}`,
      name: cosignerName.trim(),
      xpub: fullXpub, // Store full xpub for address derivation
      fingerprint: fullXpub.substring(4, 12).toUpperCase(),
      derivationPath, // Use the derivation path based on script type
      isLocal: false,
    };
    setCosigners([...cosigners, newCosigner]);
    setXpubInput('');
    setCosignerName('');
    setXpubError(null);
    setShowAddModal(false);
  }, [xpubInput, cosignerName, xpubError, cosigners, derivationPath]);

  // Validate seed phrase (basic word count check)
  const isValidSeedPhrase = useCallback((phrase: string): boolean => {
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return words.length === 12 || words.length === 24;
  }, []);

  // Handle adding local signer from imported seed
  const handleAddFromSeed = useCallback(async () => {
    if (!seedPhraseInput.trim()) {
      setSeedError('Please enter a seed phrase');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (!isValidSeedPhrase(seedPhraseInput)) {
      setSeedError('Enter a valid 12 or 24 word seed phrase');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Validate mnemonic using bip39
    const mnemonic = seedPhraseInput.trim().toLowerCase();
    if (!SeedGenerator.validate(mnemonic)) {
      setSeedError('Invalid seed phrase. Please check the words.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Check for duplicate seed phrase
    const seedHash = generateSeedHash(seedPhraseInput);
    const isDuplicateSeed = cosigners.some(c => c.seedHash === seedHash);
    if (isDuplicateSeed) {
      setSeedError('This seed phrase has already been added');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Derive the actual xpub from the seed phrase using BIP48 for multisig
      const seed = await SeedGenerator.toSeed(mnemonic);
      const keyDerivation = new KeyDerivation(seed, 'mainnet');

      // Get xpub info for BIP48 multisig path based on selected script type
      // BIP48 path: m/48'/coin'/account'/script_type'
      // Script types: 0' = P2SH, 1' = P2SH-P2WSH, 2' = P2WSH
      const multisigXpub = keyDerivation.getMultisigXpub(scriptType, 0);

      // Get master fingerprint from the xpub result
      const fingerprint = multisigXpub.fingerprint;

      // Clean up sensitive data
      keyDerivation.destroy();

      // Find next available index (starting at 0 for consistency with storage)
      const existingLocalIndices = cosigners
        .filter(c => c.isLocal && c.localIndex !== undefined)
        .map(c => c.localIndex as number);
      const nextIndex = existingLocalIndices.length > 0
        ? Math.max(...existingLocalIndices) + 1
        : 0;

      const signerName = importSignerName.trim() || `Imported Key ${nextIndex + 1}`;

      const newCosigner: Cosigner = {
        id: `imported-${Date.now()}-${nextIndex}`,
        name: signerName,
        xpub: multisigXpub.xpub, // Real xpub derived from seed using BIP48
        fingerprint: fingerprint,
        derivationPath: multisigXpub.path, // BIP48 path from getMultisigXpub
        isLocal: true,
        localIndex: nextIndex,
        seedHash: seedHash, // Store hash for duplicate detection
        mnemonic: mnemonic, // Store seed for secure storage during wallet creation
      };

      setCosigners([...cosigners, newCosigner]);
      setSeedPhraseInput('');
      setImportSignerName('');
      setSeedError(null);
      setSheetMode('default');
      setShowAddModal(false);
    } catch (error) {
      // Failed to derive xpub from seed
      setSeedError('Failed to derive key from seed phrase');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [seedPhraseInput, importSignerName, cosigners, isValidSeedPhrase, scriptType]);

  const handleRemoveCosigner = useCallback((cosigner: Cosigner) => {
    Alert.alert(
      'Remove Signer',
      `Are you sure you want to remove "${cosigner.name}" from this wallet?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setCosigners(cosigners.filter(c => c.id !== cosigner.id));
          },
        },
      ]
    );
  }, [cosigners]);

  const handlePaste = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = await Clipboard.getStringAsync();
    if (text) setXpubInput(text.trim());
  }, []);

  const handleOpenScanner = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Close the sheet first, then open scanner to avoid nested modal issues
    setShowAddModal(false);
    // Small delay to let sheet close animation complete
    setTimeout(() => {
      setShowScanner(true);
    }, 300);
  }, []);

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false);
    // Reopen the sheet after scanner closes
    setTimeout(() => {
      setShowAddModal(true);
    }, 300);
  }, []);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowScanner(false);
    // Check if it looks like an xpub
    const trimmed = data.trim();
    if (isValidXpub(trimmed)) {
      setXpubInput(trimmed);
    } else {
      // Try to extract xpub from various formats (some wallets wrap xpub in JSON or other formats)
      const xpubMatch = trimmed.match(/([xyztuv]pub[a-zA-Z0-9]{100,})/);
      if (xpubMatch) {
        setXpubInput(xpubMatch[1]);
      } else {
        setXpubInput(trimmed);
        setXpubError('Scanned data does not appear to be a valid xpub');
      }
    }
    // Reopen the sheet after scanning
    setTimeout(() => {
      setShowAddModal(true);
    }, 300);
  }, []);

  const handleNextFromCosigners = useCallback(() => {
    if (cosigners.length !== totalSigners) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateTransition('forward', () => setStep('review'));
  }, [cosigners.length, totalSigners, animateTransition]);

  // Step 3 handlers
  const handleCopyDescriptor = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(descriptor);
  }, [descriptor]);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const shareContent = getFullShareContent();
      await Share.share({ message: shareContent, title: `${config.name} - Multisig Configuration` });
    } catch (err) {
      // Share error
    }
  }, [config.name, getFullShareContent]);

  // Copy full configuration to clipboard
  const handleCopyFullConfig = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(getFullShareContent());
  }, [getFullShareContent]);

  // Validate multisig configuration before creation
  const validateMultisigConfig = useCallback((): { valid: boolean; error?: string } => {
    // Check m-of-n requirements
    if (requiredSigs < 1 || requiredSigs > totalSigners) {
      return { valid: false, error: 'Invalid signature requirement: m must be between 1 and n' };
    }
    if (totalSigners < 2 || totalSigners > 15) {
      return { valid: false, error: 'Invalid signer count: n must be between 2 and 15' };
    }
    if (cosigners.length !== totalSigners) {
      return { valid: false, error: `Expected ${totalSigners} signers, but only ${cosigners.length} added` };
    }

    // Check for unique fingerprints
    const fingerprints = new Set<string>();
    for (const cosigner of cosigners) {
      if (fingerprints.has(cosigner.fingerprint)) {
        return { valid: false, error: `Duplicate fingerprint detected: ${cosigner.fingerprint}` };
      }
      fingerprints.add(cosigner.fingerprint);
    }

    // Check for empty xpubs
    const emptyXpub = cosigners.find(c => !c.xpub || c.xpub.trim().length === 0);
    if (emptyXpub) {
      return { valid: false, error: `Signer "${emptyXpub.name}" has no xpub` };
    }

    // Check descriptor is properly formed
    if (!descriptor || descriptor.length < 50) {
      return { valid: false, error: 'Invalid or incomplete wallet descriptor' };
    }

    return { valid: true };
  }, [requiredSigs, totalSigners, cosigners, descriptor]);

  const handleCreate = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Validate configuration first
    const validation = validateMultisigConfig();
    if (!validation.valid) {
      Alert.alert('Configuration Error', validation.error);
      return;
    }

    // Collect local cosigner seeds for secure storage during wallet creation
    const localCosignerSeeds = cosigners
      .filter(c => c.isLocal && c.mnemonic)
      .map(c => ({
        localIndex: c.localIndex,
        mnemonic: c.mnemonic,
        name: c.name,
      }));

    // Build multisig params
    const multisigParams = {
      isMultisig: 'true',
      walletName: config.name,
      descriptor: descriptor,
      multisigConfig: JSON.stringify({
        m: requiredSigs,
        n: totalSigners,
        scriptType,
        cosigners: cosigners.map(c => ({
          name: c.name,
          fingerprint: c.fingerprint,
          xpub: c.xpub,
          derivationPath: c.derivationPath,
          isLocal: c.isLocal,
        })),
      }),
      localCosignerSeeds: localCosignerSeeds.length > 0 ? JSON.stringify(localCosignerSeeds) : undefined,
    };

    // Try to get PIN without asking: session cache → biometrics
    const cachedPin = await SensitiveSession.ensureAuth();
    if (cachedPin) {
      const token = SecureSessionTransfer.store({ ...multisigParams, pin: cachedPin });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
    } else {
      const hasPinSet = await SecureStorage.hasPinSet();
      if (hasPinSet) {
        const token = SecureSessionTransfer.store({ ...multisigParams, verifyOnly: 'true' });
        router.push({
          pathname: '/(onboarding)/pin',
          params: { _sst: token },
        });
      } else {
        const token = SecureSessionTransfer.store(multisigParams);
        router.push({
          pathname: '/(onboarding)/pin',
          params: { _sst: token },
        });
      }
    }
  }, [router, config, descriptor, validateMultisigConfig, requiredSigs, totalSigners, scriptType, cosigners]);

  // Validation
  const isSetupValid = requiredSigs >= 1 && requiredSigs <= totalSigners && totalSigners >= 2;
  const canDecreaseRequired = requiredSigs > 1;
  const canIncreaseRequired = requiredSigs < totalSigners && requiredSigs < 15;
  const canDecreaseTotal = totalSigners > 2 && totalSigners > requiredSigs;
  const canIncreaseTotal = totalSigners < 15;
  const canAddMore = cosigners.length < totalSigners;
  const isXpubFormValid = cosignerName.trim().length > 0 && xpubInput.trim().length > 0 && !xpubError;

  // Step number
  const getStepNumber = () => {
    switch (step) {
      case 'setup': return 1;
      case 'cosigners': return 2;
      case 'review': return 3;
    }
  };

  const getScriptTypeLabel = (type: string) => {
    switch (type) {
      case 'p2wsh': return 'Native SegWit';
      case 'p2sh-p2wsh': return 'Wrapped SegWit';
      case 'p2sh': return 'Legacy';
      default: return type.toUpperCase();
    }
  };

  // ========================================
  // STEP 1: SETUP
  // ========================================
  const renderSetupStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.scrollWrapper}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Compact Step Header */}
          <View style={styles.stepHeader}>
            <View style={styles.stepHeaderIcon}>
              <Ionicons name="people" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.stepHeaderText}>
              <Text style={styles.stepHeaderTitle}>Multisig Wallet</Text>
              <Text style={styles.stepHeaderSubtitle}>Multiple signatures required</Text>
            </View>
          </View>

          {/* Wallet Name */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>WALLET NAME</Text>
            <Text style={styles.sectionSubtitle}>Optional</Text>
            <PremiumInputCard>
              <PremiumInput
                icon="wallet-outline"
                iconColor="#FF9F0A"
                placeholder={DEFAULT_WALLET_NAME}
                value={walletName}
                onChangeText={setWalletName}
                autoCapitalize="words"
              />
            </PremiumInputCard>
          </View>

          {/* Signature Requirements */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SIGNATURE REQUIREMENTS</Text>
            <Text style={styles.sectionHelper}>
              You will need {requiredSigs} signature{requiredSigs > 1 ? 's' : ''} out of {totalSigners} total to spend funds.
            </Text>

            <View style={styles.mnCard}>
              <View style={styles.mnDisplay}>
                <Text style={styles.mnValue}>{requiredSigs}</Text>
                <Text style={styles.mnOf}>of</Text>
                <Text style={styles.mnValue}>{totalSigners}</Text>
              </View>

              <View style={styles.countersRow}>
                <View style={styles.counter}>
                  <Text style={styles.counterLabel}>Required</Text>
                  <View style={styles.counterControls}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canDecreaseRequired && styles.counterBtnDisabled,
                        pressed && canDecreaseRequired && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleRequiredChange(-1)}
                      disabled={!canDecreaseRequired}
                    >
                      <Ionicons name="remove" size={22} color={canDecreaseRequired ? colors.text : colors.textDisabled} />
                    </Pressable>
                    <Text style={styles.counterValue}>{requiredSigs}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canIncreaseRequired && styles.counterBtnDisabled,
                        pressed && canIncreaseRequired && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleRequiredChange(1)}
                      disabled={!canIncreaseRequired}
                    >
                      <Ionicons name="add" size={22} color={canIncreaseRequired ? colors.text : colors.textDisabled} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.counter}>
                  <Text style={styles.counterLabel}>Total Signers</Text>
                  <View style={styles.counterControls}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canDecreaseTotal && styles.counterBtnDisabled,
                        pressed && canDecreaseTotal && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleTotalChange(-1)}
                      disabled={!canDecreaseTotal}
                    >
                      <Ionicons name="remove" size={22} color={canDecreaseTotal ? colors.text : colors.textDisabled} />
                    </Pressable>
                    <Text style={styles.counterValue}>{totalSigners}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.counterBtn,
                        !canIncreaseTotal && styles.counterBtnDisabled,
                        pressed && canIncreaseTotal && styles.counterBtnPressed,
                      ]}
                      onPress={() => handleTotalChange(1)}
                      disabled={!canIncreaseTotal}
                    >
                      <Ionicons name="add" size={22} color={canIncreaseTotal ? colors.text : colors.textDisabled} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Address Format */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ADDRESS FORMAT</Text>
            <Text style={styles.sectionHelper}>
              This affects compatibility and transaction fees.
            </Text>

            <View style={styles.scriptTypesContainer}>
              {SCRIPT_TYPES.map((type) => {
                const isSelected = scriptType === type.value;
                return (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.scriptTypeCard,
                      isSelected && styles.scriptTypeCardSelected,
                    ]}
                    onPress={() => handleScriptTypeSelect(type.value)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.scriptTypeContent}>
                      <View style={styles.scriptTypeInfo}>
                        <View style={styles.scriptTypeTitleRow}>
                          <Text style={[
                            styles.scriptTypeTitle,
                            isSelected && styles.scriptTypeTitleSelected,
                          ]}>
                            {type.label}
                          </Text>
                          {type.recommended && (
                            <View style={styles.recommendedBadge}>
                              <Text style={styles.recommendedText}>Recommended</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.scriptTypeDesc}>{type.description}</Text>
                      </View>
                      <View style={[
                        styles.radioOuter,
                        isSelected && styles.radioOuterSelected,
                      ]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>

      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[styles.primaryButton, !isSetupValid && styles.primaryButtonDisabled]}
          onPress={handleNextFromSetup}
          disabled={!isSetupValid}
          activeOpacity={0.85}
        >
          <Text style={[
            styles.primaryButtonText,
            !isSetupValid && styles.primaryButtonTextDisabled,
          ]}>
            Continue
          </Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>
    </View>
  );

  // ========================================
  // STEP 2: SIGNERS
  // ========================================
  const renderCosignersStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.scrollWrapper}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Compact Step Header - Progress Focused */}
          <View style={styles.stepHeader}>
            <View style={styles.stepHeaderIcon}>
              <Ionicons name="person-add" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.stepHeaderText}>
              <Text style={styles.stepHeaderTitle}>Add Signers</Text>
              <Text style={styles.stepHeaderSubtitle}>
                {cosigners.length} of {totalSigners} added
              </Text>
            </View>
            {/* Completion indicator when all cosigners added */}
            {cosigners.length === totalSigners ? (
              <View style={styles.completeBadge}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={styles.completeBadgeText}>Ready</Text>
              </View>
            ) : (
              <View style={styles.progressBadge}>
                <Text style={styles.progressBadgeText}>{cosigners.length}/{totalSigners}</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>SIGNERS</Text>

          {cosigners.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyRings}>
                <View style={styles.emptyRing3} />
                <View style={styles.emptyRing2} />
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="people-outline" size={24} color={colors.textMuted} />
                </View>
              </View>
              <Text style={styles.emptyStateTitle}>No signers yet</Text>
              <Text style={styles.emptyStateText}>
                Add your first signer to continue.
              </Text>
            </View>
          ) : (
            <View style={styles.cosignersList}>
              {cosigners.map((cosigner) => (
                <View key={cosigner.id} style={styles.cosignerCard}>
                  <View style={styles.cosignerIconContainer}>
                    <Ionicons
                      name={cosigner.isLocal ? 'phone-portrait-outline' : 'person-outline'}
                      size={16}
                      color={colors.textSecondary}
                    />
                  </View>
                  <View style={styles.cosignerInfo}>
                    <View style={styles.cosignerNameRow}>
                      <Text style={styles.cosignerName}>{cosigner.name}</Text>
                      <View style={[
                        styles.cosignerBadge,
                        cosigner.isLocal ? styles.cosignerBadgeLocal : styles.cosignerBadgeExternal,
                      ]}>
                        <Text style={styles.cosignerBadgeText}>
                          {cosigner.isLocal ? 'Local' : 'External'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cosignerFingerprint}>{cosigner.fingerprint}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveCosigner(cosigner)}
                    style={styles.removeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {canAddMore && (
            <View style={styles.addSection}>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowAddModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={22} color={colors.textSecondary} />
                <Text style={styles.addButtonText}>Add Signer</Text>
              </TouchableOpacity>
              <Text style={styles.addHelperText}>
                Add another device or external wallet as a signer.
              </Text>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>

      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            cosigners.length !== totalSigners && styles.primaryButtonDisabled,
          ]}
          onPress={handleNextFromCosigners}
          disabled={cosigners.length !== totalSigners}
          activeOpacity={0.85}
        >
          <Text style={[
            styles.primaryButtonText,
            cosigners.length !== totalSigners && styles.primaryButtonTextDisabled,
          ]}>
            Continue
          </Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>

      {/* Add Signer Sheet */}
      <AppBottomSheet
        visible={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setSheetMode('default');
          setXpubInput('');
          setCosignerName('');
          setXpubError(null);
          setSeedPhraseInput('');
          setImportSignerName('');
          setSeedError(null);
        }}
        title="Add Signer"
        subtitle="Create a new key or add an external signer"
        sizing="large"
        scrollable
      >
        <View style={styles.sheetScrollContent}>
              {sheetMode === 'import-seed' ? (
                <>
                  {/* ===== IMPORT KEY SHEET ===== */}

                  {/* Back Navigation */}
                  <TouchableOpacity
                    style={styles.sheetBackBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSheetMode('default');
                      setSeedPhraseInput('');
                      setImportSignerName('');
                      setSeedError(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-back" size={20} color={colors.text} />
                  </TouchableOpacity>

                  {/* Import Header */}
                  <View style={styles.importHeader}>
                    <View style={styles.importIconWrap}>
                      <Ionicons name="key" size={24} color={isDark ? '#FFFFFF' : THEME.brand.bitcoin} />
                    </View>
                    <Text style={styles.importTitle}>Import Existing Key</Text>
                    <Text style={styles.importSubtitle}>
                      Enter a seed phrase to add an existing key as a signer
                    </Text>
                  </View>

                  {/* Import Form Card */}
                  <View style={{ marginBottom: 20 }}>
                    <PremiumInputCard label="Seed Phrase">
                      <PremiumInput
                        icon="key-outline"
                        iconColor="#FF9500"
                        placeholder="Enter your 12 or 24 word recovery phrase..."
                        value={seedPhraseInput}
                        onChangeText={(text) => {
                          setSeedPhraseInput(text);
                          if (seedError) setSeedError(null);
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        error={!!seedError}
                      />
                    </PremiumInputCard>
                    {seedError && (
                      <View style={styles.errorRow}>
                        <Ionicons name="alert-circle" size={14} color={colors.error} />
                        <Text style={styles.errorText}>{seedError}</Text>
                      </View>
                    )}
                    <View style={{ marginTop: 12 }}>
                      <PremiumInputCard label="Signer Name (optional)">
                        <PremiumInput
                          icon="person-outline"
                          iconColor="#007AFF"
                          placeholder="e.g. Backup Key, Cold Storage"
                          value={importSignerName}
                          onChangeText={setImportSignerName}
                          autoCapitalize="words"
                          returnKeyType="done"
                        />
                      </PremiumInputCard>
                    </View>
                  </View>

                  {/* Security Notice */}
                  <View style={styles.securityNoticeCompact}>
                    <Ionicons name="lock-closed" size={14} color={colors.success} />
                    <Text style={styles.securityNoticeText}>
                      Encrypted locally. Never leaves this device.
                    </Text>
                  </View>

                  {/* Import CTA */}
                  <TouchableOpacity
                    style={[
                      styles.importCta,
                      !seedPhraseInput.trim() && styles.importCtaDisabled,
                    ]}
                    onPress={handleAddFromSeed}
                    disabled={!seedPhraseInput.trim()}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.importCtaText,
                      !seedPhraseInput.trim() && styles.importCtaTextDisabled,
                    ]}>
                      Import Key
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* ===== CHOOSER SHEET ===== */}

                  {/* Section: This Device */}
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>This Device</Text>

                    {/* Action Cards */}
                    <View style={styles.actionCardsContainer}>
                      {/* Create New Key - Primary Card */}
                      <TouchableOpacity
                        style={styles.actionCard}
                        onPress={handleAddThisDevice}
                        activeOpacity={0.7}
                      >
                        <View style={styles.actionCardIcon}>
                          <Ionicons name="add" size={22} color={isDark ? '#FFFFFF' : THEME.brand.bitcoin} />
                        </View>
                        <View style={styles.actionCardContent}>
                          <Text style={styles.actionCardTitle}>Create New Key</Text>
                          <Text style={styles.actionCardSubtitle}>Generate a fresh signing key</Text>
                        </View>
                        <View style={styles.actionCardArrow}>
                          <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
                        </View>
                      </TouchableOpacity>

                      {/* Import Existing Key - Secondary Card */}
                      <TouchableOpacity
                        style={[styles.actionCard, styles.actionCardSecondary]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSheetMode('import-seed');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.actionCardIcon, styles.actionCardIconSecondary]}>
                          <Ionicons name="download-outline" size={20} color={colors.text} />
                        </View>
                        <View style={styles.actionCardContent}>
                          <Text style={styles.actionCardTitle}>Import Existing Key</Text>
                          <Text style={styles.actionCardSubtitle}>Use an existing seed phrase</Text>
                        </View>
                        <View style={styles.actionCardArrow}>
                          <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
                        </View>
                      </TouchableOpacity>
                    </View>

                    {/* Local Keys Status */}
                    {localSignerCount > 0 && (
                      <View style={styles.localKeysStatus}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={styles.localKeysStatusText}>
                          {localSignerCount} local key{localSignerCount > 1 ? 's' : ''} added
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Section: External Signer */}
                  <View style={[styles.sectionBlock, styles.sectionBlockExternal]}>
                    <Text style={styles.sectionTitle}>External Signer</Text>
                    <Text style={styles.sectionSubtitle}>
                      Add a hardware wallet or another software wallet
                    </Text>

                    {/* External Signer Form */}
                    <View style={{ gap: 12 }}>
                      <PremiumInputCard label="Name">
                        <PremiumInput
                          icon="hardware-chip-outline"
                          iconColor="#007AFF"
                          placeholder="Coldcard, Ledger, Sparrow..."
                          value={cosignerName}
                          onChangeText={setCosignerName}
                          autoCapitalize="words"
                          returnKeyType="next"
                        />
                      </PremiumInputCard>

                      <PremiumInputCard label="Extended Public Key">
                        <PremiumInput
                          icon="key-outline"
                          iconColor="#FF9500"
                          placeholder="xpub/ypub/zpub..."
                          value={xpubInput}
                          onChangeText={(text) => {
                            setXpubInput(text);
                            if (xpubError) setXpubError(null);
                          }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          multiline
                          numberOfLines={2}
                          textAlignVertical="top"
                          error={!!xpubError}
                        />
                      </PremiumInputCard>
                      {xpubError && (
                        <View style={styles.errorRow}>
                          <Ionicons name="alert-circle" size={14} color={colors.error} />
                          <Text style={styles.errorText}>{xpubError}</Text>
                        </View>
                      )}

                      {/* Quick Actions */}
                      <View style={styles.quickActionsRow}>
                        <TouchableOpacity
                          style={styles.quickActionBtn}
                          onPress={handlePaste}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="clipboard-outline" size={16} color={colors.text} />
                          <Text style={styles.quickActionText}>Paste</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.quickActionBtn}
                          onPress={handleOpenScanner}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="scan-outline" size={16} color={colors.text} />
                          <Text style={styles.quickActionText}>Scan QR</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Add External Signer CTA */}
                      <TouchableOpacity
                        style={[
                          styles.externalCta,
                          !isXpubFormValid && styles.externalCtaDisabled,
                        ]}
                        onPress={handleAddFromXpub}
                        disabled={!isXpubFormValid}
                        activeOpacity={0.85}
                      >
                        <Text style={[
                          styles.externalCtaText,
                          !isXpubFormValid && styles.externalCtaTextDisabled,
                        ]}>
                          Add External Signer
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}
        </View>
      </AppBottomSheet>

      {/* QR Scanner - MUST be separate from sheet modal */}
      <QRScanner
        visible={showScanner}
        onClose={handleCloseScanner}
        onScan={(data) => handleBarCodeScanned({ data })}
        title="Scan xpub"
        subtitle="Point camera at an extended public key QR code"
      />
    </View>
  );

  // ========================================
  // STEP 3: REVIEW
  // ========================================
  const renderReviewStep = () => (
    <View style={styles.stepContainer}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        {/* Compact Summary Header */}
        <View style={styles.stepHeader}>
          <View style={styles.stepHeaderIcon}>
            <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
          </View>
          <View style={styles.stepHeaderText}>
            <Text style={styles.stepHeaderTitle}>{config.name}</Text>
            <Text style={styles.stepHeaderSubtitle}>Review configuration</Text>
          </View>
        </View>

        {/* Summary Badges Row */}
        <View style={styles.summaryBadgesRow}>
          <View style={styles.badgePrimary}>
            <Text style={styles.badgePrimaryText}>{config.m} of {config.n}</Text>
          </View>
          <View style={styles.badgeSecondary}>
            <Text style={styles.badgeSecondaryText}>{getScriptTypeLabel(config.scriptType)}</Text>
          </View>
        </View>

        {/* Configuration Details Card */}
        <Text style={styles.sectionTitle}>CONFIGURATION</Text>
        <View style={styles.configDetailsCard}>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Network</Text>
            <View style={styles.configValueRow}>
              <View style={styles.networkBadge}>
                <View style={styles.networkDot} />
                <Text style={styles.networkText}>{network}</Text>
              </View>
            </View>
          </View>
          <View style={styles.configDivider} />
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Derivation Path</Text>
            <Text style={styles.configValueMono}>{derivationPath}</Text>
          </View>
          <View style={styles.configDivider} />
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Address Format</Text>
            <Text style={styles.configValue}>{getScriptTypeLabel(config.scriptType)}</Text>
          </View>
        </View>

        {/* Cosigners Section */}
        <Text style={styles.sectionTitle}>SIGNERS</Text>
        <View style={styles.cosignersReviewCard}>
          {cosigners.map((cosigner, index) => (
            <View
              key={cosigner.id}
              style={[
                styles.cosignerReviewRow,
                index < cosigners.length - 1 && styles.cosignerReviewRowBorder,
              ]}
            >
              <View style={styles.cosignerNumber}>
                <Text style={styles.cosignerNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.cosignerReviewInfo}>
                <View style={styles.cosignerNameTypeRow}>
                  <Text style={styles.cosignerReviewName}>{cosigner.name}</Text>
                  {cosigner.isLocal ? (
                    <View style={styles.typeBadgeLocal}>
                      <Text style={styles.typeBadgeLocalText}>Local</Text>
                    </View>
                  ) : (
                    <View style={styles.typeBadgeExternal}>
                      <Text style={styles.typeBadgeExternalText}>External</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cosignerReviewFingerprint}>
                  Fingerprint: {cosigner.fingerprint}
                </Text>
              </View>
              {cosigner.isLocal && (
                <View style={styles.youBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.youBadgeText}>You</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Wallet Descriptor - Full with Checksum */}
        <Text style={styles.sectionTitle}>WALLET DESCRIPTOR</Text>
        <Text style={styles.descriptorHelper}>
          Required for importing this wallet into other apps.
        </Text>
        <View style={styles.descriptorCard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.descriptorScroll}
          >
            <Text style={styles.descriptorText}>{descriptorFormatted}</Text>
          </ScrollView>
          <View style={styles.descriptorActions}>
            <TouchableOpacity
              style={styles.descriptorActionButton}
              onPress={handleCopyDescriptor}
              activeOpacity={0.7}
            >
              <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.descriptorActionText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Export Options */}
        <Text style={styles.sectionTitle}>SHARE WITH SIGNERS</Text>
        <View style={styles.exportOptionsCard}>
          <TouchableOpacity
            style={styles.exportOption}
            onPress={handleCopyFullConfig}
            activeOpacity={0.7}
          >
            <View style={styles.exportOptionIcon}>
              <Ionicons name="clipboard-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.exportOptionInfo}>
              <Text style={styles.exportOptionTitle}>Copy Full Configuration</Text>
              <Text style={styles.exportOptionDesc}>
                Copy all details including descriptor
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.exportDivider} />

          <TouchableOpacity
            style={styles.exportOption}
            onPress={handleShare}
            activeOpacity={0.7}
          >
            <View style={styles.exportOptionIcon}>
              <Ionicons name="share-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.exportOptionInfo}>
              <Text style={styles.exportOptionTitle}>Share Configuration</Text>
              <Text style={styles.exportOptionDesc}>
                Send via Messages, Mail, or AirDrop
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Security Notice - Safe to share */}
        <View style={styles.securityNotice}>
          <View style={styles.securityNoticeHeader}>
            <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            <Text style={[styles.securityNoticeTitle, { color: colors.success }]}>Safe to Share</Text>
          </View>
          <View style={styles.securityBullets}>
            <View style={styles.securityBullet}>
              <Ionicons name="checkmark" size={14} color={colors.textSecondary} />
              <Text style={styles.securityBulletText}>Watch-only + coordination only</Text>
            </View>
            <View style={styles.securityBullet}>
              <Ionicons name="checkmark" size={14} color={colors.textSecondary} />
              <Text style={styles.securityBulletText}>No private keys or recovery phrases included</Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleCreate}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Create Multisig Wallet</Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>

    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <LinearGradient
        colors={isDark ? ['#000000', '#050505'] : ['#FAFAFA', '#F2F2F7']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBackButton} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.stepIndicatorText}>Step {getStepNumber()} of 3</Text>
        <View style={styles.headerBackButton} />
      </View>

      {/* Content with fade transition */}
      <Animated.View style={[styles.contentContainer, { opacity: fadeAnim }]}>
        {step === 'setup' && renderSetupStep()}
        {step === 'cosigners' && renderCosignersStep()}
        {step === 'review' && renderReviewStep()}
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicatorText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  stepContainer: {
    flex: 1,
  },
  scrollWrapper: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  bottomSpacer: {
    height: 120,
  },

  // Compact Step Header - tightened spacing
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  stepHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.glassLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepHeaderText: {
    flex: 1,
  },
  stepHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  stepHeaderSubtitle: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 1,
  },
  progressBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  progressBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.1)',
  },
  completeBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
  },

  // Summary Badges Row (Step 3)
  summaryBadgesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginBottom: 10,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textDisabled,
    marginBottom: 12,
    marginTop: -8,
  },
  sectionHelper: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textTertiary,
    marginBottom: 16,
    lineHeight: 20,
  },

  // Name Input
  // M of N Card - tighter padding
  mnCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  mnDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  mnValue: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -2,
  },
  mnOf: {
    fontSize: 20,
    fontWeight: '500',
    marginHorizontal: 14,
    color: colors.textMuted,
  },
  countersRow: {
    flexDirection: 'row',
    gap: 20,
  },
  counter: {
    flex: 1,
  },
  counterLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  counterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  counterBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnDisabled: {
    opacity: 0.4,
  },
  counterBtnPressed: {
    backgroundColor: colors.glassStrong,
    transform: [{ scale: 0.96 }],
  },
  counterValue: {
    fontSize: 22,
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
    color: colors.text,
  },

  // Script Types
  scriptTypesContainer: {
    gap: 10,
  },
  scriptTypeCard: {
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  scriptTypeCardSelected: {
    backgroundColor: colors.glassMedium,
    borderColor: colors.borderStrong,
  },
  scriptTypeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  scriptTypeInfo: {
    flex: 1,
  },
  scriptTypeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  scriptTypeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scriptTypeTitleSelected: {
    color: colors.text,
  },
  recommendedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.glassMedium,
  },
  recommendedText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
    letterSpacing: 0.2,
  },
  scriptTypeDesc: {
    fontSize: 13,
    color: colors.textMuted,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: isDark ? '#FFFFFF' : colors.text,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: isDark ? '#FFFFFF' : colors.text,
  },

  // Footer - No background container, button directly on page
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    // No background - button lives directly on page surface
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  primaryButtonTextDisabled: {
    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  },

  // Empty State
  emptyState: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: colors.glassLight,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: 16,
  },
  emptyRings: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyRing3: {
    position: 'absolute' as const,
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  emptyRing2: {
    position: 'absolute' as const,
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassLight,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    color: colors.text,
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },

  // Cosigners List
  cosignersList: {
    gap: 10,
    marginBottom: 16,
  },
  cosignerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  cosignerIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cosignerIconLocal: {
    // Same as external - no orange accent for structure icons
    backgroundColor: colors.glassMedium,
  },
  cosignerInfo: {
    flex: 1,
  },
  cosignerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cosignerName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  cosignerBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  cosignerBadgeLocal: {
    backgroundColor: colors.glassMedium,
  },
  cosignerBadgeExternal: {
    backgroundColor: colors.glassMedium,
  },
  cosignerBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  cosignerFingerprint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 3,
  },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Add Section
  addSection: {
    marginTop: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: 10,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  addHelperText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },

  // Add Signer Sheet Content
  sheetScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },

  // ===== CHOOSER SHEET STYLES =====

  // Section Block
  sectionBlock: {
    marginBottom: 32,
  },
  sectionBlockExternal: {
    paddingTop: 28,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  },
  // Note: sectionTitle and sectionSubtitle defined earlier in Sections block

  // Action Cards
  actionCardsContainer: {
    gap: 12,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(247,147,26,0.12)' : 'rgba(247,147,26,0.08)',
    borderWidth: 1.5,
    borderColor: isDark ? 'rgba(247,147,26,0.25)' : 'rgba(247,147,26,0.2)',
  },
  actionCardSecondary: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    borderStyle: undefined,
  },
  actionCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(247,147,26,0.2)' : 'rgba(247,147,26,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionCardIconSecondary: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
  },
  actionCardContent: {
    flex: 1,
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 3,
  },
  actionCardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  actionCardArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Local Keys Status
  localKeysStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  localKeysStatusText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // External Form
  inputError: {
    borderColor: colors.error,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
  },

  // Quick Actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },

  // External CTA
  externalCta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: isDark ? '#FFFFFF' : colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalCtaDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  externalCtaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  externalCtaTextDisabled: {
    color: colors.textMuted,
  },

  // ===== IMPORT SHEET STYLES =====

  // Back Button
  sheetBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  // Import Header
  importHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  importIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: isDark ? 'rgba(247,147,26,0.15)' : 'rgba(247,147,26,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  importTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
    letterSpacing: -0.4,
  },
  importSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },

  // Import Form Card

  // Security Notice
  securityNoticeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  securityNoticeText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // Import CTA
  importCta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: isDark ? '#FFFFFF' : colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importCtaDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  },
  importCtaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  importCtaTextDisabled: {
    color: colors.textMuted,
  },

  // ===== LEGACY STYLES (kept for compatibility) =====

  // Divider
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    marginBottom: 20,
  },
  sheetSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 14,
    letterSpacing: -0.1,
  },
  localSignerHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },

  // Input Group (legacy)
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 6,
    marginLeft: 2,
  },
  textInput: {
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    color: colors.text,
  },
  textInputMultiline: {
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    color: colors.text,
    minHeight: 72,
  },
  textInputError: {
    borderColor: colors.error,
  },
  inputErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 6,
    marginLeft: 2,
  },
  inputHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
    marginLeft: 2,
  },

  // Action Buttons Row
  actionBtnsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },

  // Sheet Primary Button
  sheetPrimaryBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: isDark ? THEME.brand.bitcoin : '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryBtnDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
  },
  sheetPrimaryBtnText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  sheetPrimaryBtnTextDisabled: {
    color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
  },

  sheetKeyboardView: {
    // No flex: 1 - content-sized
  },
  sheetBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },

  // This Device row - compact
  thisDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    borderRadius: 12,
    marginBottom: 16,
  },
  thisDeviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  thisDeviceContent: {
    flex: 1,
  },
  thisDeviceTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  thisDeviceSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  thisDeviceAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Section header
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginBottom: 10,
  },

  // Field styling - tighter
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 5,
    marginLeft: 2,
  },
  fieldInput: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    color: colors.text,
  },
  fieldInputMultiline: {
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    color: colors.text,
    minHeight: 64,
  },
  fieldInputError: {
    borderColor: colors.error,
  },
  fieldHelper: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    marginLeft: 2,
  },
  fieldError: {
    fontSize: 11,
    color: colors.error,
    marginTop: 4,
    marginLeft: 2,
  },

  // Action row - Paste / Scan QR buttons
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },

  // Add button (inside scroll for content-sizing)
  addCosignerBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: isDark ? THEME.brand.bitcoin : '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCosignerBtnDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
  },
  addCosignerBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addCosignerBtnTextDisabled: {
    color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
  },

  // Review Step - Summary Badges (neutral, no orange)
  badgePrimary: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  badgePrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  badgeSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.glassLight,
  },
  badgeSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Configuration Details Card - tighter padding
  configDetailsCard: {
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 24,
    overflow: 'hidden',
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  configLabel: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  configValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  configValueMono: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  configValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  configDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginHorizontal: 14,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.1)',
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  networkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
  },

  // Cosigner Name/Type Row
  cosignerNameTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadgeLocal: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.glassMedium,
  },
  typeBadgeLocalText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  typeBadgeExternal: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.glassMedium,
  },
  typeBadgeExternalText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },

  // Descriptor Helper
  descriptorHelper: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
    marginTop: -4,
  },
  descriptorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  descriptorActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  descriptorActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Export Options Card - tighter padding
  exportOptionsCard: {
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 20,
    overflow: 'hidden',
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  exportDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginHorizontal: 14,
  },
  exportOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  exportOptionInfo: {
    flex: 1,
  },
  exportOptionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  exportOptionDesc: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Security Notice - tighter padding
  securityNotice: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  securityNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  securityNoticeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    letterSpacing: 0.2,
  },
  securityNoticeBody: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  securityNoticeHighlight: {
    fontWeight: '600',
    color: colors.textSecondary,
  },
  securityBullets: {
    gap: 6,
  },
  securityBullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securityBulletText: {
    fontSize: 13,
    color: colors.textMuted,
  },

  // Cosigners Review Card - tighter padding
  cosignersReviewCard: {
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 24,
    overflow: 'hidden',
  },
  cosignerReviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  cosignerReviewRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  cosignerNumber: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cosignerNumberText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cosignerReviewInfo: {
    flex: 1,
  },
  cosignerReviewName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  cosignerReviewFingerprint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  youBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.1)',
  },
  youBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  externalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  externalBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },

  // Descriptor Card - tighter padding
  descriptorCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 20,
  },
  descriptorScroll: {
    marginBottom: 12,
  },
  descriptorText: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
  },


});
