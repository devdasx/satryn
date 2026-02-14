import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  Animated,
  ScrollView,
  Modal,
  Dimensions,
} from 'react-native';
import ReAnimated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { QRScanner } from '../../src/components/scanner';
import { THEME, getThemeColors, ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SecureSessionTransfer } from '../../src/services/auth/SecureSessionTransfer';
import { useSettingsStore } from '../../src/stores';
import { parseDescriptor } from '../../src/utils/descriptor';
import { checkDescriptorDuplicate } from '../../src/services/wallet/DuplicateDetector';
import type { DescriptorInfo, DescriptorKey } from '../../src/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SMALL_SCREEN = SCREEN_HEIGHT < 700;

// Types for various import formats
interface CosignerConfig {
  name: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  isLocal: boolean;
}

interface ImportedConfig {
  descriptor: string;
  parsedInfo: DescriptorInfo;
  cosigners: CosignerConfig[];
  walletName?: string;
  format: 'raw' | 'json-config' | 'specter' | 'caravan' | 'coldcard' | 'bluewallet';
}

// Caravan format types
interface CaravanExtendedPublicKey {
  name?: string;
  bip32Path?: string;
  xpub: string;
  xfp?: string;
  method?: string;
}

interface CaravanFormat {
  name?: string;
  addressType?: string;
  network?: string;
  quorum?: {
    requiredSigners: number;
    totalSigners: number;
  };
  extendedPublicKeys?: CaravanExtendedPublicKey[];
  startingAddressIndex?: number;
}

// Specter Desktop format
interface SpecterFormat {
  label?: string;
  descriptor: string;
  blockheight?: number;
  devices?: string[];
}

// Our app's export format (descriptor + config)
interface AppExportFormat {
  descriptor: string;
  config: {
    m: number;
    n: number;
    scriptType: string;
    walletName?: string;
    cosigners: Array<{
      name: string;
      fingerprint: string;
      xpub: string;
      derivationPath: string;
      isLocal: boolean;
    }>;
  };
}

export default function MultisigImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Theme
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // State
  const [descriptor, setDescriptor] = useState('');
  const [parsedInfo, setParsedInfo] = useState<DescriptorInfo | null>(null);
  const [importedConfig, setImportedConfig] = useState<ImportedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [duplicateWallet, setDuplicateWallet] = useState<{ name: string; walletId: string } | null>(null);

  const styles = createStyles(colors, isDark);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  // Try to parse text as JSON and detect format
  const tryParseJSON = (text: string): { json: any; format: string } | null => {
    try {
      const json = JSON.parse(text);

      // Detect format based on structure
      if (json.descriptor && json.config && json.config.cosigners) {
        return { json, format: 'json-config' }; // Our app's export format
      }
      if (json.extendedPublicKeys && json.quorum) {
        return { json, format: 'caravan' }; // Caravan format
      }
      if (json.descriptor && (json.label || json.blockheight !== undefined)) {
        return { json, format: 'specter' }; // Specter Desktop format
      }
      if (json.descriptor) {
        return { json, format: 'coldcard' }; // Generic/Coldcard format with just descriptor
      }

      return null;
    } catch {
      return null;
    }
  };

  // Convert Caravan format to our format
  const processCaravanFormat = (caravan: CaravanFormat): ImportedConfig | null => {
    if (!caravan.extendedPublicKeys || !caravan.quorum) {
      return null;
    }

    const m = caravan.quorum.requiredSigners;
    const n = caravan.quorum.totalSigners;

    // Map address type to script type
    let scriptType: 'p2wsh' | 'p2sh-p2wsh' | 'p2sh' = 'p2wsh';
    if (caravan.addressType) {
      const addrType = caravan.addressType.toUpperCase();
      if (addrType === 'P2WSH') scriptType = 'p2wsh';
      else if (addrType === 'P2SH-P2WSH') scriptType = 'p2sh-p2wsh';
      else if (addrType === 'P2SH') scriptType = 'p2sh';
    }

    // Build cosigners from extendedPublicKeys
    const cosigners: CosignerConfig[] = caravan.extendedPublicKeys.map((key, idx) => ({
      name: key.name || `Signer ${idx + 1}`,
      fingerprint: (key.xfp || '00000000').toLowerCase(),
      xpub: key.xpub,
      derivationPath: key.bip32Path || `m/48'/0'/0'/2'`,
      isLocal: false,
    }));

    // Build descriptor from Caravan format
    const multiType = 'sortedmulti';
    const keyExprs = cosigners.map(c => {
      const path = c.derivationPath.replace(/^m\//, '').replace(/'/g, 'h');
      return `[${c.fingerprint}/${path}]${c.xpub}`;
    }).join(',');

    let descriptorBase: string;
    if (scriptType === 'p2wsh') {
      descriptorBase = `wsh(${multiType}(${m},${keyExprs}))`;
    } else if (scriptType === 'p2sh-p2wsh') {
      descriptorBase = `sh(wsh(${multiType}(${m},${keyExprs})))`;
    } else {
      descriptorBase = `sh(${multiType}(${m},${keyExprs}))`;
    }

    // Parse the generated descriptor
    try {
      const parsed = parseDescriptor(descriptorBase);
      if (!parsed.isValid || !parsed.isMultisig) {
        return null;
      }

      return {
        descriptor: descriptorBase,
        parsedInfo: parsed,
        cosigners,
        walletName: caravan.name || `${m}-of-${n} Multisig`,
        format: 'caravan',
      };
    } catch {
      return null;
    }
  };

  // Process our app's JSON export format
  const processAppExportFormat = (data: AppExportFormat): ImportedConfig | null => {
    try {
      const parsed = parseDescriptor(data.descriptor);
      if (!parsed.isValid || !parsed.isMultisig) {
        return null;
      }

      const cosigners: CosignerConfig[] = data.config.cosigners.map((c, idx) => ({
        name: c.name || `Signer ${idx + 1}`,
        fingerprint: c.fingerprint.toLowerCase(),
        xpub: c.xpub,
        derivationPath: c.derivationPath || `m/48'/0'/0'/2'`,
        isLocal: false, // Always watch-only on import
      }));

      return {
        descriptor: data.descriptor,
        parsedInfo: parsed,
        cosigners,
        walletName: data.config.walletName || `${data.config.m}-of-${data.config.n} Multisig`,
        format: 'json-config',
      };
    } catch {
      return null;
    }
  };

  // Process Specter Desktop format
  const processSpecterFormat = (specter: SpecterFormat): ImportedConfig | null => {
    try {
      const parsed = parseDescriptor(specter.descriptor);
      if (!parsed.isValid || !parsed.isMultisig) {
        return null;
      }

      // Build cosigners from parsed descriptor keys
      const cosigners: CosignerConfig[] = parsed.keys.map((key, idx) => ({
        name: specter.devices?.[idx] || `Signer ${idx + 1}`,
        fingerprint: (key.fingerprint || '00000000').toLowerCase(),
        xpub: key.key,
        derivationPath: key.derivationPath || `m/48'/0'/0'/2'`,
        isLocal: false,
      }));

      return {
        descriptor: specter.descriptor,
        parsedInfo: parsed,
        cosigners,
        walletName: specter.label || `${parsed.threshold}-of-${parsed.totalKeys} Multisig`,
        format: 'specter',
      };
    } catch {
      return null;
    }
  };

  // Process raw descriptor (with optional cosigner names from parsed keys)
  const processRawDescriptor = (descriptorText: string): ImportedConfig | null => {
    try {
      const parsed = parseDescriptor(descriptorText);
      if (!parsed.isValid) {
        return null;
      }
      if (!parsed.isMultisig) {
        return null;
      }

      // Build cosigners from parsed keys
      const cosigners: CosignerConfig[] = parsed.keys.map((key, idx) => ({
        name: `Signer ${idx + 1}`,
        fingerprint: (key.fingerprint || '00000000').toLowerCase(),
        xpub: key.key,
        derivationPath: key.derivationPath || `m/48'/0'/0'/2'`,
        isLocal: false,
      }));

      return {
        descriptor: descriptorText,
        parsedInfo: parsed,
        cosigners,
        walletName: `${parsed.threshold}-of-${parsed.totalKeys} Multisig`,
        format: 'raw',
      };
    } catch {
      return null;
    }
  };

  // Process descriptor text (from paste or scan) - handles multiple formats
  const processDescriptor = useCallback((text: string) => {
    const trimmedText = text.trim();

    // Reset state
    setDescriptor('');
    setParsedInfo(null);
    setImportedConfig(null);
    setError(null);
    setDuplicateWallet(null);

    // Try to parse as JSON first
    const jsonResult = tryParseJSON(trimmedText);

    if (jsonResult) {
      let config: ImportedConfig | null = null;

      switch (jsonResult.format) {
        case 'json-config':
          config = processAppExportFormat(jsonResult.json as AppExportFormat);
          break;
        case 'caravan':
          config = processCaravanFormat(jsonResult.json as CaravanFormat);
          break;
        case 'specter':
          config = processSpecterFormat(jsonResult.json as SpecterFormat);
          break;
        case 'coldcard':
          // Generic format with just descriptor
          if (jsonResult.json.descriptor) {
            config = processRawDescriptor(jsonResult.json.descriptor);
            if (config) config.format = 'coldcard';
          }
          break;
      }

      if (config) {
        setDescriptor(config.descriptor);
        setParsedInfo(config.parsedInfo);
        setImportedConfig(config);
        // Check for duplicate descriptor wallet
        const dupCheck = checkDescriptorDuplicate(config.descriptor);
        setDuplicateWallet(dupCheck.isDuplicate && dupCheck.existingWallet ? {
          name: dupCheck.existingWallet.name,
          walletId: dupCheck.existingWallet.walletId,
        } : null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      } else {
        setError('Could not parse the JSON configuration. Please check the format.');
        return false;
      }
    }

    // Not JSON, try as raw descriptor
    const config = processRawDescriptor(trimmedText);

    if (config) {
      setDescriptor(config.descriptor);
      setParsedInfo(config.parsedInfo);
      setImportedConfig(config);
      // Check for duplicate descriptor wallet
      const dupCheck = checkDescriptorDuplicate(config.descriptor);
      setDuplicateWallet(dupCheck.isDuplicate && dupCheck.existingWallet ? {
        name: dupCheck.existingWallet.name,
        walletId: dupCheck.existingWallet.walletId,
      } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    }

    // Failed to parse
    // Check if it looks like a descriptor but failed validation
    if (trimmedText.includes('multi(') || trimmedText.includes('wsh(') || trimmedText.includes('sh(')) {
      setError('Invalid descriptor format or checksum. Please verify the descriptor is correct.');
    } else if (trimmedText.startsWith('{')) {
      setError('Could not recognize the JSON format. Supported formats: raw descriptor, Specter Desktop, Caravan, Coldcard, or our app export.');
    } else {
      setError('This is not a valid multisig descriptor or configuration file.');
    }

    return false;
  }, []);

  const handlePaste = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || !text.trim()) {
        setError('Clipboard is empty');
        setParsedInfo(null);
        return;
      }

      processDescriptor(text);
    } catch (err) {
      setError('Failed to read clipboard');
      setParsedInfo(null);
    }
  };

  const handleClear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDescriptor('');
    setParsedInfo(null);
    setImportedConfig(null);
    setError(null);
    setDuplicateWallet(null);
  };

  // QR Scanner handlers
  const handleScanPress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHasScanned(false);
    setShowQRScanner(true);
  }, []);

  const handleQRScanned = useCallback(({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowQRScanner(false);

    processDescriptor(data);
  }, [hasScanned, processDescriptor]);

  const mapScriptType = (scriptType: string): 'p2wsh' | 'p2sh-p2wsh' | 'p2sh' => {
    switch (scriptType) {
      case 'p2wsh':
        return 'p2wsh';
      case 'p2sh-p2wsh':
        return 'p2sh-p2wsh';
      case 'p2sh':
      case 'p2sh-multisig':
        return 'p2sh';
      default:
        return 'p2wsh';
    }
  };

  const getScriptTypeName = (scriptType: string): string => {
    switch (scriptType) {
      case 'p2wsh':
        return 'Native SegWit (P2WSH)';
      case 'p2sh-p2wsh':
        return 'Wrapped SegWit (P2SH-P2WSH)';
      case 'p2sh':
        return 'Legacy (P2SH)';
      default:
        return scriptType;
    }
  };

  const handleImport = async () => {
    if (!parsedInfo || !importedConfig) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Build config from importedConfig (which has proper cosigner names from JSON formats)
    const multisigConfig = {
      m: parsedInfo.threshold!,
      n: parsedInfo.totalKeys!,
      scriptType: mapScriptType(parsedInfo.scriptType),
      cosigners: importedConfig.cosigners,
    };

    const multisigParams = {
      isMultisig: 'true',
      walletName: importedConfig.walletName || `${parsedInfo.threshold}-of-${parsedInfo.totalKeys} Multisig`,
      descriptor: descriptor,
      multisigConfig: JSON.stringify(multisigConfig),
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
  };

  // Get format display name
  const getFormatDisplayName = (format: string): string => {
    switch (format) {
      case 'json-config': return 'App Export';
      case 'specter': return 'Specter Desktop';
      case 'caravan': return 'Caravan';
      case 'coldcard': return 'Coldcard/Generic';
      case 'bluewallet': return 'BlueWallet';
      case 'raw': return 'Raw Descriptor';
      default: return 'Unknown';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <LinearGradient
        colors={isDark ? ['#000000', '#050505'] : ['#FAFAFA', '#F2F2F7']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBackButton}
          activeOpacity={0.7}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Import Watch-Only Multisig</Text>
        <View style={styles.headerBackButton} />
      </View>

      {/* Content */}
      <Animated.View style={[styles.contentWrapper, { opacity: fadeAnim }]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={true}
        >
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name="eye-outline"
              size={26}
              color={colors.textSecondary}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Import Descriptor</Text>

          {/* Instructions */}
          <Text style={styles.instructions}>
            Import a watch-only multisig wallet using an output descriptor. You can add signing keys later.
          </Text>

          {/* Input Method Notice */}
          <View style={styles.inputMethodNotice}>
            <Ionicons
              name="shield-checkmark-outline"
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.inputMethodText}>
              For security, only paste or scan is allowed. Manual typing is disabled.
            </Text>
          </View>

          {/* Action Buttons - Only show when no valid descriptor */}
          {!parsedInfo && (
            <View style={styles.buttonRow}>
              <TouchableOpacity onPress={handlePaste} style={styles.actionButton} activeOpacity={0.7}>
                <Ionicons name="clipboard-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.actionButtonText}>Paste</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleScanPress} style={styles.actionButton} activeOpacity={0.7}>
                <Ionicons name="qr-code-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.actionButtonText}>Scan</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error Message */}
          {error && (
            <ReAnimated.View
              entering={FadeIn.duration(200)}
              style={styles.errorContainer}
            >
              <Ionicons name="alert-circle" size={16} color={colors.error || '#FF3B30'} />
              <Text style={styles.errorText}>{error}</Text>
            </ReAnimated.View>
          )}

          {/* Duplicate wallet warning */}
          {duplicateWallet && parsedInfo && (
            <ReAnimated.View
              entering={FadeIn.duration(200)}
              style={styles.duplicateContainer}
            >
              <Ionicons name="warning" size={16} color={colors.warning || '#FF9500'} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.duplicateTitle}>Wallet Already Imported</Text>
                <Text style={styles.duplicateText}>
                  This descriptor matches "{duplicateWallet.name}". You can still import it as a separate wallet.
                </Text>
              </View>
            </ReAnimated.View>
          )}

          {/* Parsed Info - Signers List with Subtle Animations */}
          {parsedInfo && importedConfig && (
            <ReAnimated.View
              entering={FadeIn.duration(250)}
              style={styles.parsedSection}
            >
              {/* Format Badge */}
              <ReAnimated.View
                entering={FadeInDown.delay(30).duration(300)}
                style={styles.formatBadge}
              >
                <Ionicons name="document-text-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.formatBadgeText}>
                  {getFormatDisplayName(importedConfig.format)}
                </Text>
              </ReAnimated.View>

              {/* Policy Header with Clear Button */}
              <ReAnimated.View
                entering={FadeInDown.delay(60).duration(300)}
                style={styles.policyHeaderRow}
              >
                <View style={styles.policyHeader}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success || '#34C759'} />
                  <Text style={styles.policyText}>
                    {parsedInfo.threshold}-of-{parsedInfo.totalKeys} {getScriptTypeName(parsedInfo.scriptType)}
                  </Text>
                </View>
                <TouchableOpacity onPress={handleClear} style={styles.clearButtonSmall} activeOpacity={0.7}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              </ReAnimated.View>

              {/* Signers List - Use importedConfig for names */}
              <ReAnimated.Text
                entering={FadeInDown.delay(90).duration(300)}
                style={styles.signersTitle}
              >
                SIGNERS
              </ReAnimated.Text>
              <ReAnimated.View
                entering={FadeInDown.delay(120).duration(300)}
                style={styles.signersCard}
              >
                {importedConfig.cosigners.map((cosigner, idx) => (
                  <ReAnimated.View
                    key={idx}
                    entering={FadeIn.delay(150 + idx * 40).duration(250)}
                    style={[styles.signerRow, idx < importedConfig.cosigners.length - 1 && styles.signerRowBorder]}
                  >
                    <View style={styles.signerNumber}>
                      <Text style={styles.signerNumberText}>{idx + 1}</Text>
                    </View>
                    <View style={styles.signerInfo}>
                      <Text style={styles.signerName}>{cosigner.name}</Text>
                      <Text style={styles.signerFingerprint}>
                        Fingerprint: {cosigner.fingerprint.toUpperCase()}
                      </Text>
                      <Text style={styles.signerPath}>
                        {cosigner.derivationPath}
                      </Text>
                    </View>
                    <View style={styles.watchOnlyBadge}>
                      <Ionicons name="eye-outline" size={12} color={colors.warning || '#FF9500'} />
                    </View>
                  </ReAnimated.View>
                ))}
              </ReAnimated.View>

              {/* Watch-Only Note */}
              <ReAnimated.View
                entering={FadeIn.delay(200 + importedConfig.cosigners.length * 40).duration(250)}
                style={styles.watchOnlyNote}
              >
                <Ionicons name="information-circle-outline" size={16} color={colors.warning || '#FF9500'} />
                <Text style={styles.watchOnlyText}>
                  This will be a watch-only wallet. You can add signing keys later in the Manage Keys screen.
                </Text>
              </ReAnimated.View>
            </ReAnimated.View>
          )}

          {/* Supported Formats Section - Only show when no descriptor */}
          {!descriptor && (
            <View style={styles.formatSection}>
              <Text style={styles.formatTitle}>SUPPORTED FORMATS</Text>

              {/* Raw Descriptor */}
              <View style={styles.formatCard}>
                <View style={styles.formatCardHeader}>
                  <Ionicons name="code-slash" size={16} color={colors.textSecondary} />
                  <Text style={styles.formatCardTitle}>Raw Descriptor</Text>
                </View>
                <View style={styles.codeBlock}>
                  <Text style={styles.codeText} selectable>
                    wsh(sortedmulti(2,{'\n'}  [fp/48h/0h/0h/2h]xpub...,{'\n'}  [fp/48h/0h/0h/2h]xpub...{'\n'}))#checksum
                  </Text>
                </View>
              </View>

              {/* JSON Formats */}
              <View style={styles.formatCard}>
                <View style={styles.formatCardHeader}>
                  <Ionicons name="document-text" size={16} color={colors.textSecondary} />
                  <Text style={styles.formatCardTitle}>JSON Configuration</Text>
                </View>
                <Text style={styles.formatCardDesc}>
                  Exports from Specter Desktop, Caravan, Coldcard, BlueWallet, or our app's "Export Config" feature.
                </Text>
              </View>

              {/* Wallet Compatibility */}
              <Text style={[styles.formatTitle, { marginTop: 20 }]}>COMPATIBLE WALLETS</Text>
              <View style={styles.walletGrid}>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>Specter</Text>
                </View>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>Caravan</Text>
                </View>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>Coldcard</Text>
                </View>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>Sparrow</Text>
                </View>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>BlueWallet</Text>
                </View>
                <View style={styles.walletBadge}>
                  <Text style={styles.walletBadgeText}>Electrum</Text>
                </View>
              </View>

              {/* Script Types */}
              <Text style={[styles.formatTitle, { marginTop: 20 }]}>SCRIPT TYPES</Text>
              <View style={styles.formatList}>
                <View style={styles.formatItem}>
                  <Text style={styles.formatCode}>wsh(...)</Text>
                  <Text style={styles.formatDesc}>Native SegWit (P2WSH)</Text>
                </View>
                <View style={styles.formatItem}>
                  <Text style={styles.formatCode}>sh(wsh(...))</Text>
                  <Text style={styles.formatDesc}>Wrapped SegWit</Text>
                </View>
                <View style={styles.formatItem}>
                  <Text style={styles.formatCode}>sh(...)</Text>
                  <Text style={styles.formatDesc}>Legacy (P2SH)</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </Animated.View>

      {/* Import Button - Fixed Footer */}
      {parsedInfo && importedConfig && (
        <ReAnimated.View
          entering={FadeIn.delay(250 + importedConfig.cosigners.length * 40).duration(300)}
          style={[
            styles.footer,
            { paddingBottom: insets.bottom > 0 ? insets.bottom : 24 },
          ]}
        >
          <TouchableOpacity
            onPress={handleImport}
            activeOpacity={0.85}
            style={[
              styles.importButton,
              { backgroundColor: isDark ? THEME.brand.bitcoin : '#0D0D0D' },
            ]}
          >
            <Text style={[styles.importButtonText, { color: '#FFFFFF' }]}>
              Import Wallet
            </Text>
          </TouchableOpacity>
        </ReAnimated.View>
      )}

      {/* QR Scanner */}
      <QRScanner
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={(data) => handleQRScanned({ data })}
        title="Scan Descriptor"
        subtitle="Position the descriptor QR code within the frame"
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
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
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    contentWrapper: {
      flex: 1,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 8,
    },

    // Icon - matches intro screen
    iconContainer: {
      width: 52,
      height: 52,
      borderRadius: 14,
      backgroundColor: colors.glassLight,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },

    // Title
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.4,
      marginBottom: 12,
    },

    // Instructions
    instructions: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginBottom: 20,
    },

    // Input Method Notice
    inputMethodNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      marginBottom: 20,
    },
    inputMethodText: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },

    // Action Buttons
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 20,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 24,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    actionButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textSecondary,
    },

    // Error
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,59,48,0.15)' : 'rgba(255,59,48,0.1)',
      marginBottom: 20,
    },
    errorText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.error || '#FF3B30',
    },

    // Duplicate warning
    duplicateContainer: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: 10,
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.1)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,149,0,0.25)' : 'rgba(255,149,0,0.20)',
      marginBottom: 20,
    },
    duplicateTitle: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.warning || '#FF9500',
    },
    duplicateText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.warning || '#FF9500',
    },

    // Parsed Section
    parsedSection: {
      marginBottom: 24,
    },
    formatBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      marginBottom: 16,
    },
    formatBadgeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    policyHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    policyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    policyText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    clearButtonSmall: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    clearButtonText: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textMuted,
    },

    // Signers
    signersTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.8,
      color: colors.textMuted,
      marginBottom: 12,
    },
    signersCard: {
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
      overflow: 'hidden',
    },
    signerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    signerRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    signerNumber: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    signerNumberText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    signerInfo: {
      flex: 1,
    },
    signerName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    signerFingerprint: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    signerPath: {
      fontSize: 12,
      color: colors.textMuted,
    },
    watchOnlyBadge: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Watch-Only Note
    watchOnlyNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.08)',
      marginTop: 16,
    },
    watchOnlyText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: colors.warning || '#FF9500',
    },

    // Supported Formats Section
    formatSection: {
      marginBottom: 24,
    },
    formatTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.8,
      color: colors.textMuted,
      marginBottom: 12,
    },
    formatCard: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      marginBottom: 12,
    },
    formatCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    formatCardTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    formatCardDesc: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textMuted,
    },
    codeBlock: {
      padding: 14,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    codeText: {
      fontSize: 11,
      lineHeight: 18,
      color: isDark ? '#98C379' : '#50A14F',
    },
    walletGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    walletBadge: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    walletBadgeText: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    formatList: {
      gap: 10,
    },
    formatItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    formatCode: {
      width: 110,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    formatDesc: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
    },

    bottomSpacer: {
      height: 120,
    },

    // Footer - matches onboarding screen
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 24,
      backgroundColor: colors.background,
    },
    importButton: {
      height: 50,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    importButtonText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
    },

  });
