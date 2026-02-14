import '../../shim';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useColorScheme,
  ActivityIndicator,
  Platform,
  Alert,
  LayoutAnimation,
} from 'react-native';
import { AppBottomSheet, KeyboardSafeBottomBar } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { QRScanner } from '../../src/components/scanner';
import { THEME, getThemeColors, ADDRESS_TYPES } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { useWalletStore } from '../../src/stores/walletStore';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer } from '../../src/services/auth/SecureSessionTransfer';
import { useMultiWalletStore } from '../../src/stores/multiWalletStore';
import { WalletManager } from '../../src/services/wallet/WalletManager';
import { detectInputType, detectFileType } from '../../src/services/import/detector';
import { parsePrivateKey } from '../../src/services/import/parsers/privateKey';
import { parseExtendedKey } from '../../src/services/import/parsers/extendedKey';
import { parseSeedBytes } from '../../src/services/import/parsers/seedBytes';
import { parseDescriptorExport } from '../../src/services/import/parsers/descriptor';
import { parseDumpwallet } from '../../src/services/import/parsers/dumpwallet';
import { parseElectrumFile } from '../../src/services/import/parsers/electrumFile';
import { isBIP38, decryptBIP38 } from '../../src/services/import/parsers/bip38';
import { getSecureInputProps } from '../../src/services/import/security';
import * as ecc from '@bitcoinerlab/secp256k1';
import BIP32Factory from 'bip32';
import { SeedGenerator } from '../../src/core/wallet';
import { checkImportDuplicate, checkFingerprintDuplicate } from '../../src/services/wallet/DuplicateDetector';
import { getUniqueWalletName } from '../../src/stores/multiWalletStore';
import { PathDiscovery } from '../../src/services/import/PathDiscovery';
import { PathDiscoveryCard } from '../../src/components/import/PathDiscoveryCard';
import { ImportInfoSheet } from '../../src/components/import/ImportInfoSheet';
import { SheetPrimaryButton, SheetSectionFooter } from '../../src/components/ui';
import type { ImportResult, DerivationPathConfig, DetectionResult, PathDiscoveryResult, SuggestedScriptType } from '../../src/services/import/types';
import type { AddressType } from '../../src/types';

// Lazy-loaded for file import
function getDocumentPicker(): typeof import('expo-document-picker') | null {
  try { return require('expo-document-picker'); } catch { return null; }
}
function getExpoFile(): typeof import('expo-file-system').File | null {
  try { return require('expo-file-system').File; } catch { return null; }
}

/** Detected import category */
type ImportCategory = 'mnemonic' | 'key' | 'extended' | 'seed' | 'file' | 'watch' | null;

function formatToCategory(format: string): ImportCategory {
  if (format === 'bip39_mnemonic') return 'mnemonic';
  if (['wif_compressed', 'wif_uncompressed', 'hex_privkey', 'decimal_privkey', 'base64_privkey', 'mini_privkey', 'bip38_encrypted', 'sec1_pem', 'pkcs8_pem', 'pkcs8_encrypted'].includes(format)) return 'key';
  if (['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'].includes(format)) return 'extended';
  if (['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub'].includes(format)) return 'watch';
  if (['seed_bytes_hex'].includes(format)) return 'seed';
  if (['descriptor_set', 'dumpwallet', 'electrum_json', 'wallet_dat'].includes(format)) return 'file';
  if (['ur_crypto_hdkey', 'ur_crypto_eckey', 'ur_crypto_seed'].includes(format)) return 'extended';
  return null;
}

function categoryIcon(cat: ImportCategory): string {
  switch (cat) {
    case 'mnemonic': return 'grid-outline';
    case 'key': return 'key-outline';
    case 'extended': return 'git-branch-outline';
    case 'seed': return 'finger-print-outline';
    case 'file': return 'document-text-outline';
    case 'watch': return 'eye-outline';
    default: return 'help-outline';
  }
}

function categoryLabel(cat: ImportCategory): string {
  switch (cat) {
    case 'mnemonic': return 'Recovery Phrase';
    case 'key': return 'Private Key';
    case 'extended': return 'Extended Key';
    case 'seed': return 'Seed Bytes';
    case 'file': return 'File Import';
    case 'watch': return 'Watch-Only';
    default: return 'Unknown';
  }
}

// suggestedToAddressType / addressTypeToSuggested — identity conversions
// SuggestedScriptType and AddressType use the same string values
function suggestedToAddressType(s: SuggestedScriptType): AddressType {
  return (s as AddressType) ?? ADDRESS_TYPES.NATIVE_SEGWIT;
}

function addressTypeToSuggested(t: AddressType): SuggestedScriptType {
  return (t as SuggestedScriptType) ?? 'native_segwit';
}

export default function ImportWalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();
  const importPrivateKey = useWalletStore(s => s.importPrivateKey);
  const importFromXprv = useWalletStore(s => s.importFromXprv);
  const importFromSeedBytes = useWalletStore(s => s.importFromSeedBytes);

  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  // ─── Input state ──────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [category, setCategory] = useState<ImportCategory>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // ─── Mnemonic-specific state ──────────────────────────────────────
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
  const [mnemonicValid, setMnemonicValid] = useState(false);

  // ─── Shared settings ──────────────────────────────────────────────
  const [walletName, setWalletName] = useState('Imported Wallet');
  const [scriptType, setScriptType] = useState<AddressType>(ADDRESS_TYPES.NATIVE_SEGWIT);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [derivationConfig, setDerivationConfig] = useState<DerivationPathConfig>({
    preset: 'hd', accountIndex: 0, addressIndex: 0,
  });

  // ─── Import state ─────────────────────────────────────────────────
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Duplicate detection ───────────────────────────────────────────
  const [duplicateWallet, setDuplicateWallet] = useState<{ name: string; walletId: string } | null>(null);

  // ─── UI state ─────────────────────────────────────────────────────
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showQRWarning, setShowQRWarning] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // BIP38
  const [showBIP38Modal, setShowBIP38Modal] = useState(false);
  const [bip38Key, setBip38Key] = useState('');
  const [bip38Password, setBip38Password] = useState('');
  const [bip38Decrypting, setBip38Decrypting] = useState(false);
  const [bip38Error, setBip38Error] = useState<string | null>(null);

  // Path discovery
  const [discoveryResults, setDiscoveryResults] = useState<PathDiscoveryResult[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryHasActivity, setDiscoveryHasActivity] = useState(false);
  const [discoveryTotalBalance, setDiscoveryTotalBalance] = useState(0);
  const cancelDiscoveryRef = useRef<{ current: boolean }>({ current: false });

  const inputRef = useRef<TextInput>(null);
  const secureProps = getSecureInputProps();

  const canImport = (!!parseResult || mnemonicValid) && !duplicateWallet;
  const showPassphraseOption = category === 'mnemonic' || category === 'extended' || category === 'seed';

  // ─── Auto-detect on input change ──────────────────────────────────
  const processInput = useCallback((text: string, file?: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setDetection(null);
      setCategory(null);
      setParseResult(null);
      setParseError(null);
      setMnemonicWords([]);
      setMnemonicValid(false);
      setDuplicateWallet(null);
      return;
    }

    // Detect format
    const detected = file ? detectFileType(trimmed, file) : detectInputType(trimmed);
    setDetection(detected);

    if (!detected) {
      // Could be partial mnemonic — check word-by-word
      const words = trimmed.toLowerCase().split(/\s+/);
      if (words.length >= 2 && words.every(w => SeedGenerator.isValidWord(w))) {
        setCategory('mnemonic');
        setMnemonicWords(words);
        const isValid = (words.length === 12 || words.length === 24) && SeedGenerator.validate(words.join(' '));
        setMnemonicValid(isValid);
        setParseResult(null);
        setParseError(null);
        if (isValid) {
          setWalletName(getUniqueWalletName('Imported Wallet'));
        }
        return;
      }
      setCategory(null);
      setParseResult(null);
      setParseError(null);
      setMnemonicWords([]);
      setMnemonicValid(false);
      setDuplicateWallet(null);
      return;
    }

    if (!detected.isMainnet) {
      setCategory(null);
      setParseResult(null);
      setParseError('Testnet keys are not supported. Mainnet only.');
      setMnemonicWords([]);
      setMnemonicValid(false);
      setDuplicateWallet(null);
      return;
    }

    const cat = formatToCategory(detected.format);
    setCategory(cat);
    setParseError(null);

    // ─── Parse based on category ────────────────────────────────
    let parsedResult: ImportResult | null = null;
    try {
      if (cat === 'mnemonic') {
        const words = trimmed.toLowerCase().split(/\s+/);
        setMnemonicWords(words);
        const isValid = (words.length === 12 || words.length === 24) && SeedGenerator.validate(words.join(' '));
        setMnemonicValid(isValid);
        setParseResult(null);
        setWalletName(getUniqueWalletName('Imported Wallet'));
        // Mnemonic duplicate check handled by useEffect (needs seed derivation)
        if (!isValid) setDuplicateWallet(null);
      } else if (cat === 'key') {
        setMnemonicWords([]);
        setMnemonicValid(false);
        // BIP38 check
        if (detected.format === 'bip38_encrypted') {
          setBip38Key(trimmed);
          setShowBIP38Modal(true);
          setInput('');
          return;
        }
        const result = parsePrivateKey(trimmed, scriptType);
        parsedResult = result;
        setParseResult(result);
        setWalletName(getUniqueWalletName('Imported Key'));
        if (result.compressed === false) {
          setScriptType(ADDRESS_TYPES.LEGACY);
        }
      } else if (cat === 'extended') {
        setMnemonicWords([]);
        setMnemonicValid(false);
        const result = parseExtendedKey(trimmed, undefined, derivationConfig);
        parsedResult = result;
        setParseResult(result);
        setWalletName(getUniqueWalletName('Imported xprv'));
        if (result.suggestedScriptType) {
          setScriptType(suggestedToAddressType(result.suggestedScriptType));
        }
      } else if (cat === 'watch') {
        setMnemonicWords([]);
        setMnemonicValid(false);
        // Determine script type from prefix
        let autoScript: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT;
        let sugScript: SuggestedScriptType = 'native_segwit';
        if (trimmed.startsWith('xpub')) { autoScript = ADDRESS_TYPES.LEGACY; sugScript = 'legacy'; }
        else if (trimmed.startsWith('ypub') || trimmed.startsWith('Ypub')) { autoScript = ADDRESS_TYPES.WRAPPED_SEGWIT; sugScript = 'wrapped_segwit'; }
        setScriptType(autoScript);
        setWalletName(getUniqueWalletName('Watch-Only Wallet'));
        let sourceFormat: 'xpub' | 'ypub' | 'zpub' | 'Ypub' | 'Zpub' = 'xpub';
        if (trimmed.startsWith('ypub')) sourceFormat = 'ypub';
        else if (trimmed.startsWith('Ypub')) sourceFormat = 'Ypub';
        else if (trimmed.startsWith('zpub')) sourceFormat = 'zpub';
        else if (trimmed.startsWith('Zpub')) sourceFormat = 'Zpub';
        const watchResult: ImportResult = {
          type: 'watch_xpub', sourceFormat, xpub: trimmed,
          suggestedScriptType: sugScript, previewAddress: '', fingerprint: undefined,
        };
        parsedResult = watchResult;
        setParseResult(watchResult);
      } else if (cat === 'seed') {
        setMnemonicWords([]);
        setMnemonicValid(false);
        const result = parseSeedBytes(trimmed.toLowerCase(), addressTypeToSuggested(scriptType), derivationConfig);
        parsedResult = result;
        setParseResult(result);
        setWalletName(getUniqueWalletName('Imported Seed'));
      } else if (cat === 'file') {
        setMnemonicWords([]);
        setMnemonicValid(false);
        let result: ImportResult;
        switch (detected.format) {
          case 'descriptor_set': result = parseDescriptorExport(trimmed); break;
          case 'dumpwallet': result = parseDumpwallet(trimmed); break;
          case 'electrum_json': result = parseElectrumFile(trimmed); break;
          default: throw new Error(`Unsupported file format: ${detected.format}`);
        }
        parsedResult = result;
        setParseResult(result);
        setWalletName(getUniqueWalletName(result.suggestedName || 'Imported Wallet'));
      }

      // ─── Duplicate check for non-mnemonic categories ───────────
      if (cat !== 'mnemonic' && parsedResult) {
        const dupCheck = checkImportDuplicate(cat, parsedResult);
        setDuplicateWallet(dupCheck.isDuplicate && dupCheck.existingWallet ? {
          name: dupCheck.existingWallet.name,
          walletId: dupCheck.existingWallet.walletId,
        } : null);
      } else if (cat !== 'mnemonic') {
        setDuplicateWallet(null);
      }
    } catch (err) {
      setParseResult(null);
      setParseError(err instanceof Error ? err.message : 'Failed to parse input');
      setMnemonicWords([]);
      setMnemonicValid(false);
      setDuplicateWallet(null);
    }
  }, [scriptType, derivationConfig]);

  // ─── Path discovery ───────────────────────────────────────────────
  useEffect(() => {
    // Determine discoverable material
    const material = parseResult?.xprv || parseResult?.privateKeyWIF || parseResult?.seed;
    const validMnemonic = mnemonicValid ? mnemonicWords.join(' ') : null;

    if (!material && !validMnemonic) {
      cancelDiscoveryRef.current.current = true;
      setDiscoveryResults([]);
      setIsDiscovering(false);
      setDiscoveryHasActivity(false);
      setDiscoveryTotalBalance(0);
      return;
    }

    cancelDiscoveryRef.current.current = true;
    const cancelRef = { current: false };
    cancelDiscoveryRef.current = cancelRef;

    const run = async () => {
      await new Promise(r => setTimeout(r, 50));
      if (cancelRef.current) return;

      setIsDiscovering(true);
      setDiscoveryResults([]);
      setDiscoveryHasActivity(false);
      setDiscoveryTotalBalance(0);

      try {
        let result;
        const onPathResult = (pathResult: PathDiscoveryResult) => {
          if (cancelRef.current) return;
          setDiscoveryResults(prev => {
            const idx = prev.findIndex(r => r.path === pathResult.path);
            if (idx >= 0) { const u = [...prev]; u[idx] = pathResult; return u; }
            return [...prev, pathResult];
          });
        };

        if (validMnemonic) {
          result = await PathDiscovery.discoverHD(
            { type: 'mnemonic', mnemonic: validMnemonic, passphrase },
            { onPathResult, cancelRef }
          );
        } else if (parseResult?.xprv) {
          result = await PathDiscovery.discoverHD(
            { type: 'xprv', xprv: parseResult.xprv },
            { onPathResult, cancelRef }
          );
        } else if (parseResult?.privateKeyWIF) {
          result = await PathDiscovery.discoverWIF(
            parseResult.privateKeyWIF,
            parseResult.compressed !== false,
            { onPathResult, cancelRef }
          );
        } else if (parseResult?.seed) {
          result = await PathDiscovery.discoverHD(
            { type: 'seed', seed: Buffer.from(parseResult.seed) },
            { onPathResult, cancelRef }
          );
        }

        if (result && !cancelRef.current) {
          setDiscoveryHasActivity(result.hasActivity);
          setDiscoveryTotalBalance(result.totalBalanceSats);
          if (result.hasActivity && result.totalBalanceSats > 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch {
        // Silent
      } finally {
        if (!cancelRef.current) setIsDiscovering(false);
      }
    };

    run();
    return () => { cancelRef.current = true; };
  }, [parseResult?.xprv, parseResult?.privateKeyWIF, parseResult?.seed, mnemonicValid, mnemonicWords.join(' '), passphrase]);

  // ─── Mnemonic duplicate detection ──────────────────────────────────
  useEffect(() => {
    if (!mnemonicValid) {
      // Only clear if we're in mnemonic category (don't overwrite other checks)
      if (category === 'mnemonic') setDuplicateWallet(null);
      return;
    }
    try {
      const mnemonic = mnemonicWords.join(' ');
      const seed = SeedGenerator.toSeedSync(mnemonic, passphrase);
      const bip32 = BIP32Factory(ecc);
      const root = bip32.fromSeed(seed);
      const fp = Buffer.from(root.fingerprint).toString('hex');
      const dupCheck = checkFingerprintDuplicate(fp);
      setDuplicateWallet(dupCheck.isDuplicate && dupCheck.existingWallet ? {
        name: dupCheck.existingWallet.name,
        walletId: dupCheck.existingWallet.walletId,
      } : null);
    } catch {
      setDuplicateWallet(null);
    }
  }, [mnemonicValid, mnemonicWords.join(' '), passphrase, category]);

  // ─── Input handler ────────────────────────────────────────────────
  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setFileName(null);
    processInput(text);
  }, [processInput]);

  // ─── Paste ────────────────────────────────────────────────────────
  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setInput(text.trim());
        setFileName(null);
        processInput(text.trim());
      }
    } catch {}
  }, [processInput]);

  // ─── File picker ──────────────────────────────────────────────────
  const handlePickFile = useCallback(async () => {
    try {
      const DocPicker = getDocumentPicker();
      const FileClass = getExpoFile();
      if (!DocPicker || !FileClass) {
        Alert.alert('Not Available', 'File picking requires a native rebuild. Use paste instead.');
        return;
      }
      const result = await DocPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      const file = new FileClass(asset.uri);
      const content = await file.text();
      if (!content || content.trim().length === 0) {
        Alert.alert('Empty File', 'The selected file is empty.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInput(content);
      setFileName(asset.name);
      processInput(content, asset.name);
    } catch (err: any) {
      if (err?.message?.includes('native module') || err?.message?.includes('ExpoDocumentPicker')) {
        Alert.alert('Not Available', 'File picker requires a development build. Use paste instead.');
      } else {
        setParseError('Failed to read file');
      }
    }
  }, [processInput]);

  // ─── QR Scanner ───────────────────────────────────────────────────
  const handleScanQR = useCallback(() => { setShowQRWarning(true); }, []);
  const handleQRWarningConfirm = useCallback(() => {
    setShowQRWarning(false);
    setHasScanned(false);
    setShowQRScanner(true);
  }, []);
  const handleQRScanned = useCallback(({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowQRScanner(false);
    setInput(data);
    processInput(data);
  }, [hasScanned, processInput]);

  // ─── BIP38 decrypt ────────────────────────────────────────────────
  const handleBIP38Decrypt = useCallback(async () => {
    if (!bip38Key || !bip38Password) return;
    setBip38Decrypting(true);
    setBip38Error(null);
    try {
      const result = await decryptBIP38(bip38Key, bip38Password, scriptType);
      if (!result.privateKeyWIF) throw new Error('Decryption failed');
      setInput(result.privateKeyWIF);
      setParseResult(result);
      setCategory('key');
      setShowBIP38Modal(false);
      setBip38Password('');
      setBip38Key('');
      setWalletName(getUniqueWalletName('BIP38 Imported'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setBip38Error(err instanceof Error ? err.message : 'Decryption failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBip38Decrypting(false);
    }
  }, [bip38Key, bip38Password, scriptType]);

  // ─── Path select from discovery ───────────────────────────────────
  const handlePathSelect = useCallback((path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => {
    const pathToType: Record<string, AddressType> = {
      bip44: ADDRESS_TYPES.LEGACY, bip49: ADDRESS_TYPES.WRAPPED_SEGWIT,
      bip84: ADDRESS_TYPES.NATIVE_SEGWIT, bip86: ADDRESS_TYPES.TAPROOT,
    };
    const newType = pathToType[path];
    if (newType) {
      setScriptType(newType);
      setDerivationConfig(prev => ({ ...prev, preset: path }));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ─── Settings changes ─────────────────────────────────────────────
  const handleScriptTypeChange = useCallback((type: AddressType) => {
    setScriptType(type);
    // Re-parse if needed
    if (input.trim() && (category === 'key' || category === 'extended' || category === 'seed')) {
      processInput(input);
    }
  }, [input, category, processInput]);

  const handleNameChange = useCallback((name: string) => { setWalletName(name); }, []);

  const handleDerivationConfigChange = useCallback((newConfig: DerivationPathConfig) => {
    setDerivationConfig(newConfig);
    // Re-parse for extended/seed
    if (input.trim() && (category === 'extended' || category === 'seed')) {
      processInput(input);
    }
  }, [input, category, processInput]);

  const toggleAdvanced = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAdvanced(!showAdvanced);
  }, [showAdvanced]);

  // ─── Import with PIN helper ───────────────────────────────────────
  const importWithPin = useCallback(async (
    _doImport: (pin: string) => Promise<boolean>,
    routeParams: Record<string, string>,
  ) => {
    const cachedPin = await SensitiveSession.ensureAuth();
    if (cachedPin) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const token = SecureSessionTransfer.store({
        pin: cachedPin,
        isImport: 'true',
        walletName: routeParams.importKeyName || '',
        ...routeParams,
      });
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { _sst: token },
      });
    } else {
      const hasPinSet = await SecureStorage.hasPinSet();
      const token = SecureSessionTransfer.store({
        isImport: 'true',
        ...routeParams,
        ...(hasPinSet ? { verifyOnly: 'true' } : {}),
      });
      router.push({
        pathname: '/(onboarding)/pin',
        params: { _sst: token },
      });
    }
  }, [router]);

  // ─── Main import handler ──────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (isImporting) return;
    setIsImporting(true);
    setError(null);

    try {
      if (category === 'mnemonic' && mnemonicValid) {
        const mnemonic = mnemonicWords.join(' ');
        const configParam = derivationConfig.preset !== 'hd' ? JSON.stringify(derivationConfig) : undefined;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const cachedPin = await SensitiveSession.ensureAuth();
        if (cachedPin) {
          const token = SecureSessionTransfer.store({
            mnemonic, passphrase, isImport: 'true', pin: cachedPin,
            ...(configParam ? { derivationConfig: configParam } : {}),
          });
          router.replace({
            pathname: '/(onboarding)/setup',
            params: { _sst: token },
          });
        } else {
          const hasPinSet = await SecureStorage.hasPinSet();
          const token = SecureSessionTransfer.store({
            mnemonic, passphrase, isImport: 'true',
            ...(hasPinSet ? { verifyOnly: 'true' } : {}),
            ...(configParam ? { derivationConfig: configParam } : {}),
          });
          router.push({
            pathname: '/(onboarding)/pin',
            params: { _sst: token },
          });
        }
      } else if (category === 'key' && parseResult) {
        if (!parseResult.privateKeyWIF) throw new Error('No WIF key available');
        await importWithPin(
          (pin) => importPrivateKey(parseResult.privateKeyWIF!, parseResult.compressed ?? true, pin, walletName, scriptType),
          {
            importKeyWIF: parseResult.privateKeyWIF,
            importKeyCompressed: parseResult.compressed ? 'true' : 'false',
            importKeyName: walletName,
            importKeyScriptType: scriptType,
          },
        );
      } else if (category === 'extended' && parseResult) {
        if (!parseResult.xprv) throw new Error('No extended private key available');
        await importWithPin(
          (pin) => importFromXprv(parseResult.xprv!, pin, walletName, scriptType, parseResult.derivationPathConfig),
          {
            importXprv: parseResult.xprv,
            importKeyName: walletName,
            importKeyScriptType: scriptType,
          },
        );
      } else if (category === 'watch' && parseResult) {
        if (!parseResult.xpub) throw new Error('No xpub available');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const wallet = await WalletManager.importXpubWallet(walletName, parseResult.xpub);
        await useWalletStore.getState().switchToWallet(wallet.id);
        await useMultiWalletStore.getState().setActiveWallet(wallet.id);
        router.replace('/(auth)/(tabs)');
      } else if (category === 'seed' && parseResult) {
        if (!parseResult.seed) throw new Error('No seed data available');
        const seedHex = Array.from(parseResult.seed).map(b => b.toString(16).padStart(2, '0')).join('');
        await importWithPin(
          (pin) => importFromSeedBytes(seedHex, pin, walletName, scriptType, parseResult.derivationPathConfig),
          {
            importSeedHex: seedHex,
            importKeyName: walletName,
            importKeyScriptType: scriptType,
          },
        );
      } else if (category === 'file' && parseResult) {
        // Route based on file content type
        if (parseResult.type === 'watch_only' && parseResult.xpub) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const wallet = await WalletManager.importXpubWallet(walletName, parseResult.xpub);
          await useWalletStore.getState().switchToWallet(wallet.id);
          await useMultiWalletStore.getState().setActiveWallet(wallet.id);
          router.replace('/(auth)/(tabs)');
        } else if (parseResult.mnemonic) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const cachedPin = await SensitiveSession.ensureAuth();
          if (cachedPin) {
            const token = SecureSessionTransfer.store({
              mnemonic: parseResult.mnemonic, passphrase: '', isImport: 'true', pin: cachedPin,
            });
            router.replace({
              pathname: '/(onboarding)/setup',
              params: { _sst: token },
            });
          } else {
            const hasPinSet = await SecureStorage.hasPinSet();
            const token = SecureSessionTransfer.store({
              mnemonic: parseResult.mnemonic, passphrase: '', isImport: 'true',
              ...(hasPinSet ? { verifyOnly: 'true' } : {}),
            });
            router.push({
              pathname: '/(onboarding)/pin',
              params: { _sst: token },
            });
          }
        } else if (parseResult.xprv) {
          await importWithPin(
            (pin) => importFromXprv(parseResult.xprv!, pin, walletName, scriptType),
            { importXprv: parseResult.xprv, importKeyName: walletName, importKeyScriptType: scriptType },
          );
        } else if (parseResult.privateKeyWIF) {
          await importWithPin(
            (pin) => importPrivateKey(parseResult.privateKeyWIF!, parseResult.compressed ?? true, pin, walletName, scriptType),
            { importKeyWIF: parseResult.privateKeyWIF, importKeyCompressed: parseResult.compressed ? 'true' : 'false', importKeyName: walletName, importKeyScriptType: scriptType },
          );
        } else if (parseResult.keys && parseResult.keys.length > 0) {
          const firstKey = parseResult.keys[0];
          await importWithPin(
            (pin) => importPrivateKey(firstKey.wif, firstKey.compressed ?? true, pin, walletName, scriptType),
            { importKeyWIF: firstKey.wif, importKeyCompressed: firstKey.compressed ? 'true' : 'false', importKeyName: walletName, importKeyScriptType: scriptType },
          );
        } else {
          throw new Error('No importable data found');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsImporting(false);
    }
  }, [category, mnemonicValid, mnemonicWords, parseResult, isImporting, router, importPrivateKey, importFromXprv, importFromSeedBytes, importWithPin, walletName, scriptType, passphrase, derivationConfig]);

  const handleClear = useCallback(() => {
    setInput('');
    setDetection(null);
    setCategory(null);
    setParseResult(null);
    setParseError(null);
    setMnemonicWords([]);
    setMnemonicValid(false);
    setFileName(null);
    setError(null);
    setDuplicateWallet(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, []);

  const handleBack = useCallback(() => {
    setParseResult(null);
    router.back();
  }, [router]);

  // ─── Mnemonic word count display ──────────────────────────────────
  const wordCountDisplay = category === 'mnemonic' && mnemonicWords.length > 0
    ? `${mnemonicWords.length} / ${mnemonicWords.length <= 12 ? 12 : 24}`
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={isDark ? [colors.background, colors.background] : ['#F2F2F7', '#E8E8ED']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowInfoSheet(true); }}
          style={styles.infoButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="information-circle-outline" size={24} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'} />
        </TouchableOpacity>
      </View>

      <View style={styles.scrollWrapper}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <View style={styles.titleSection}>
            <Text style={[styles.title, { color: colors.text }]}>Import Wallet</Text>
            <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}>
              Paste or type your recovery phrase, private key, extended key, seed, or import a file.
            </Text>
          </View>

          {/* Security notice */}
          <View style={[styles.securityNotice, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <View style={[styles.securityAccent, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }]} />
            <View style={styles.securityContent}>
              <Ionicons name="shield-checkmark-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
              <Text style={[styles.securityText, { color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)' }]}>
                Only import keys from a source you trust.{'\n'}
                Never enter a key given by someone else.
              </Text>
            </View>
          </View>

          {/* ── Unified input area ─────────────────────────────────── */}
          <View style={styles.inputSection}>
            {/* Label row with detected badge */}
            <View style={styles.labelRow}>
              <Text style={[styles.inputLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                {category ? categoryLabel(category) : 'Wallet Data'}
              </Text>
              {detection && (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  style={[styles.detectedBadge, {
                    backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)',
                  }]}
                >
                  <Ionicons name={categoryIcon(category) as any} size={14} color="#30D158" />
                  <Text style={styles.detectedBadgeText}>{detection.label}</Text>
                </Animated.View>
              )}
              {wordCountDisplay && !detection && (
                <View style={[styles.countBadge, {
                  backgroundColor: mnemonicValid
                    ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
                }]}>
                  <Text style={[styles.countText, {
                    color: mnemonicValid ? '#30D158' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'),
                  }]}>{wordCountDisplay}</Text>
                </View>
              )}
            </View>

            {/* File name badge */}
            {fileName && (
              <View style={[styles.fileNameRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Ionicons name="document-text-outline" size={16} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'} />
                <Text style={[styles.fileNameText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }]} numberOfLines={1}>
                  {fileName}
                </Text>
                <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'} />
                </TouchableOpacity>
              </View>
            )}

            {/* Main text input */}
            <PremiumInputCard>
              <PremiumInput
                ref={inputRef}
                icon={category ? categoryIcon(category) as any : 'document-text-outline'}
                iconColor={category === 'mnemonic' ? '#30D158' : category === 'key' ? '#FF9F0A' : category === 'extended' ? '#BF5AF2' : category === 'seed' ? '#64D2FF' : '#8E8E93'}
                value={input}
                onChangeText={handleInputChange}
                placeholder="Paste recovery phrase, key, xprv, seed hex, or file content..."
                multiline
                numberOfLines={4}
                monospace={category === 'key' || category === 'extended' || category === 'seed'}
                secureTextEntry={!showKey && input.length > 0 && category !== 'mnemonic' && category !== 'file'}
                showClear={input.length > 0}
                rightElement={
                  input.length > 0 && category !== 'mnemonic' && category !== 'file' ? (
                    <TouchableOpacity
                      onPress={() => setShowKey(!showKey)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name={showKey ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                        color={isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)'}
                      />
                    </TouchableOpacity>
                  ) : undefined
                }
                {...secureProps}
              />
            </PremiumInputCard>

            {/* Parse error */}
            {parseError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" />
                <Text style={styles.errorText}>{parseError}</Text>
              </View>
            )}

            {/* Duplicate wallet warning — blocks import */}
            {duplicateWallet && (
              <Animated.View entering={FadeInDown.duration(250)} style={[styles.duplicateWarning, {
                backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)',
              }]}>
                <Ionicons name="close-circle" size={20} color="#FF453A" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.duplicateTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                    Already Imported
                  </Text>
                  <Text style={[styles.duplicateSubtitle, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
                    This key is already in your wallet "{duplicateWallet.name}". Duplicate imports are not allowed.
                  </Text>
                </View>
              </Animated.View>
            )}

            {/* Action buttons */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                onPress={handlePaste}
                activeOpacity={0.7}
              >
                <Ionicons name="clipboard-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Paste</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                onPress={handleScanQR}
                activeOpacity={0.7}
              >
                <Ionicons name="qr-code-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Scan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                onPress={handlePickFile}
                activeOpacity={0.7}
              >
                <Ionicons name="folder-open-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
                <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>File</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Advanced options (passphrase) ─────────────────────── */}
          {showPassphraseOption && (
            <>
              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={toggleAdvanced}
                activeOpacity={0.7}
              >
                <Text style={[styles.advancedText, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
                  Passphrase (optional)
                </Text>
                <Ionicons
                  name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
                />
              </TouchableOpacity>

              {showAdvanced && (
                <Animated.View entering={FadeInDown.duration(200)} style={styles.advancedContent}>
                  <Text style={[styles.passphraseDesc, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
                    Only enter this if you used a passphrase when creating the wallet.
                  </Text>
                  <PremiumInputCard>
                    <PremiumInput
                      icon="key-outline"
                      iconColor="#FF9F0A"
                      placeholder="Enter passphrase"
                      value={passphrase}
                      onChangeText={setPassphrase}
                      secureTextEntry={!showPassphrase}
                      showClear={passphrase.length > 0}
                      {...secureProps}
                    />
                  </PremiumInputCard>
                </Animated.View>
              )}
            </>
          )}

          {/* ── Watch-only badge ──────────────────────────────────── */}
          {category === 'watch' && parseResult && (
            <Animated.View entering={FadeInDown.duration(250)} style={[styles.watchOnlyBadge, {
              backgroundColor: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(10,132,255,0.08)',
            }]}>
              <Ionicons name="eye" size={20} color="#0A84FF" />
              <View style={styles.watchOnlyContent}>
                <Text style={[styles.watchOnlyTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                  Watch-Only Wallet
                </Text>
                <Text style={[styles.watchOnlySubtitle, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
                  Can only view balances and receive. Cannot send.
                </Text>
              </View>
            </Animated.View>
          )}

          {/* ── Path Discovery Card ──────────────────────────────── */}
          {(discoveryResults.length > 0 || isDiscovering) && (
            <Animated.View entering={FadeInDown.duration(250)} style={styles.discoverySection}>
              <PathDiscoveryCard
                isDark={isDark}
                results={discoveryResults}
                isScanning={isDiscovering}
                hasActivity={discoveryHasActivity}
                totalBalanceSats={discoveryTotalBalance}
                onPathSelect={handlePathSelect}
              />
            </Animated.View>
          )}

          {/* ── Wallet Name ─────────────────────────────────────── */}
          {(parseResult || mnemonicValid) && category !== 'mnemonic' && (
            <Animated.View entering={FadeInDown.duration(250)} style={styles.settingsSection}>
              <Text style={[styles.walletNameLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
                Wallet Name
              </Text>
              <PremiumInputCard>
                <PremiumInput
                  icon="pencil"
                  iconColor="#007AFF"
                  value={walletName}
                  onChangeText={handleNameChange}
                  placeholder="My Wallet"
                  placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
                  maxLength={30}
                />
              </PremiumInputCard>
            </Animated.View>
          )}

          {/* Global error */}
          {error && (
            <View style={styles.globalError}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.globalErrorText}>{error}</Text>
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      </View>

      {/* Bottom CTA */}
      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[
            styles.importButton,
            {
              backgroundColor: (!canImport || isImporting)
                ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
                : (isDark ? THEME.brand.bitcoin : '#0D0D0D'),
            },
          ]}
          onPress={handleImport}
          disabled={!canImport || isImporting}
          activeOpacity={0.85}
        >
          {isImporting ? (
            <ActivityIndicator color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'} size="small" />
          ) : (
            <Text style={[
              styles.importButtonText,
              {
                color: (!canImport || isImporting)
                  ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)')
                  : '#FFFFFF',
              },
            ]}>
              Import Wallet
            </Text>
          )}
        </TouchableOpacity>
      </KeyboardSafeBottomBar>

      {/* Info Sheet */}
      <ImportInfoSheet
        visible={showInfoSheet}
        onClose={() => setShowInfoSheet(false)}
      />

      {/* QR Warning Sheet */}
      <AppBottomSheet
        visible={showQRWarning}
        onClose={() => setShowQRWarning(false)}
        title="Security Notice"
        subtitle="Verify the source before scanning"
      >
        <View style={styles.warningSheetContent}>
          <View style={[styles.warningIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="shield-checkmark" size={32} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'} />
          </View>
          <Text style={[styles.warningDescription, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }]}>
            Only scan recovery phrases from a source you trust.
          </Text>
          <View style={styles.warningButtons}>
            <TouchableOpacity
              style={[styles.warningButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
              onPress={() => setShowQRWarning(false)}
            >
              <Text style={[styles.warningButtonText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.warningButton, { backgroundColor: '#FFFFFF' }]}
              onPress={handleQRWarningConfirm}
            >
              <Text style={[styles.warningButtonText, { color: '#000000' }]}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </AppBottomSheet>

      {/* BIP38 Modal */}
      <AppBottomSheet
        visible={showBIP38Modal}
        onClose={() => { setShowBIP38Modal(false); setBip38Password(''); setBip38Error(null); setBip38Key(''); }}
        title="Encrypted Key"
        sizing="medium"
      >
        <View style={styles.bip38Content}>
          <View style={[styles.bip38Icon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Ionicons name="lock-closed" size={32} color={isDark ? '#FFFFFF' : '#000000'} />
          </View>
          <Text style={[styles.bip38Title, { color: isDark ? '#FFFFFF' : '#000000' }]}>BIP38 Encrypted Key</Text>
          <Text style={[styles.bip38Desc, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }]}>
            Enter the password to decrypt this key.
          </Text>
          <View style={{ width: '100%', marginTop: 8 }}>
            <PremiumInputCard label="Password">
              <PremiumInput
                icon="lock-closed-outline"
                iconColor="#FF9500"
                value={bip38Password}
                onChangeText={setBip38Password}
                placeholder="Enter decryption password"
                secureTextEntry
                autoFocus
              />
            </PremiumInputCard>
          </View>
          {bip38Error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.errorText}>{bip38Error}</Text>
            </View>
          )}
          <SheetSectionFooter text="Decryption may take up to 30 seconds." variant="warning" />
          <View style={{ width: '100%', marginTop: 16 }}>
            <SheetPrimaryButton label={bip38Decrypting ? 'Decrypting...' : 'Decrypt Key'} onPress={handleBIP38Decrypt} disabled={!bip38Password || bip38Decrypting} />
          </View>
          {bip38Decrypting && (
            <View style={styles.bip38Loading}>
              <ActivityIndicator size="large" color={isDark ? '#FFFFFF' : '#000000'} />
              <Text style={[styles.bip38LoadingText, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
                Decrypting key...
              </Text>
            </View>
          )}
        </View>
      </AppBottomSheet>

      {/* QR Scanner */}
      <QRScanner
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={(data) => handleQRScanned({ data })}
        title="Scan Wallet Data"
        subtitle="Position the QR code within the frame"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  infoButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  scrollWrapper: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 16 },
  titleSection: { marginBottom: 20 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, maxWidth: '95%' },
  securityNotice: { flexDirection: 'row', borderRadius: 14, marginBottom: 24, overflow: 'hidden' },
  securityAccent: { width: 3 },
  securityContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingLeft: 12, gap: 12 },
  securityText: { flex: 1, fontSize: 14, lineHeight: 21 },

  // Input section
  inputSection: { marginBottom: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  inputLabel: { fontSize: 15, fontWeight: '600' },
  detectedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  detectedBadgeText: { fontSize: 12, fontWeight: '600', color: '#30D158', maxWidth: 180 },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  countText: { fontSize: 13, fontWeight: '500' },
  fileNameRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, gap: 10, marginBottom: 10,
  },
  fileNameText: { flex: 1, fontSize: 14, fontWeight: '500' },
  // (Raw TextInput styles removed — using PremiumInput)
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500', flex: 1 },
  duplicateWarning: {
    flexDirection: 'row' as const,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.25)',
  },
  duplicateTitle: { fontSize: 15, fontWeight: '600' as const },
  duplicateSubtitle: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', marginTop: 14, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 42, borderRadius: 12, gap: 7,
  },
  actionText: { fontSize: 14, fontWeight: '500' },

  // Advanced
  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, marginTop: 4,
  },
  advancedText: { fontSize: 15, fontWeight: '500' },
  advancedContent: { paddingTop: 4, gap: 6 },
  passphraseDesc: { fontSize: 13, lineHeight: 18 },
  // (Passphrase raw styles removed — using PremiumInput)

  // Watch-only
  watchOnlyBadge: {
    flexDirection: 'row', borderRadius: 14, padding: 16, marginTop: 16, gap: 14,
    borderWidth: 1, borderColor: 'rgba(10,132,255,0.25)',
  },
  watchOnlyContent: { flex: 1, gap: 4 },
  watchOnlyTitle: { fontSize: 15, fontWeight: '600' },
  watchOnlySubtitle: { fontSize: 13, lineHeight: 18 },

  // Discovery & wallet name
  discoverySection: { marginTop: 20 },
  settingsSection: { marginTop: 24 },
  walletNameLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // Global error
  globalError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 16 },
  globalErrorText: { fontSize: 14, color: '#FF453A', fontWeight: '500' },

  // Import button
  importButton: { height: 50, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  importButtonText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },

  // QR warning
  warningSheetContent: { paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center' },
  warningIconContainer: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  warningDescription: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  warningButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  warningButton: { flex: 1, height: 50, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  warningButtonText: { fontSize: 17, fontWeight: '700' },

  // BIP38
  bip38Content: { padding: 20, alignItems: 'center', gap: 12 },
  bip38Icon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  bip38Title: { fontSize: 20, fontWeight: '700' },
  bip38Desc: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16, marginBottom: 8 },
  bip38Loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', borderRadius: 16, gap: 16,
  },
  bip38LoadingText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
