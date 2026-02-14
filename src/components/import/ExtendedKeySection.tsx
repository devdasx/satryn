import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { detectInputType } from '../../services/import/detector';
import { parseExtendedKey } from '../../services/import/parsers/extendedKey';
import { getSecureInputProps } from '../../services/import/security';
import { PathDiscovery } from '../../services/import/PathDiscovery';
import { DetectedBadge } from './DetectedBadge';
import { PreviewCard } from './PreviewCard';
import { WalletSettings } from './WalletSettings';
import { DerivationPathSelector } from './DerivationPathSelector';
import { PathDiscoveryCard } from './PathDiscoveryCard';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import type { DetectionResult, ImportResult, SuggestedScriptType, DerivationPathConfig, PathDiscoveryResult } from '../../services/import/types';

/** Maps detected format to recommended section */
type SuggestedSection = 'phrase' | 'key' | 'extended' | 'seed' | 'file';

interface ExtendedKeySectionProps {
  isDark: boolean;
  onKeyReady: (result: ImportResult, walletName: string, scriptType: AddressType) => void;
  onKeyInvalid: () => void;
  /** Called when input is detected as belonging to another section */
  onSwitchSection?: (section: SuggestedSection, content: string) => void;
  /** Initial content to populate the input with (from section switch) */
  initialContent?: string | null;
}

function suggestedToAddressType(s: SuggestedScriptType): AddressType {
  switch (s) {
    case 'native_segwit': return ADDRESS_TYPES.NATIVE_SEGWIT;
    case 'wrapped_segwit': return ADDRESS_TYPES.WRAPPED_SEGWIT;
    case 'legacy': return ADDRESS_TYPES.LEGACY;
    case 'taproot': return ADDRESS_TYPES.TAPROOT;
    default: return ADDRESS_TYPES.NATIVE_SEGWIT;
  }
}

function addressTypeToSuggested(t: AddressType): SuggestedScriptType {
  switch (t) {
    case ADDRESS_TYPES.NATIVE_SEGWIT: return 'native_segwit';
    case ADDRESS_TYPES.WRAPPED_SEGWIT: return 'wrapped_segwit';
    case ADDRESS_TYPES.LEGACY: return 'legacy';
    case ADDRESS_TYPES.TAPROOT: return 'taproot';
    default: return 'native_segwit';
  }
}

/** Map a derivation preset to the corresponding address type */
function presetToAddressType(preset: string): AddressType | null {
  switch (preset) {
    case 'bip44': return ADDRESS_TYPES.LEGACY;
    case 'bip49': return ADDRESS_TYPES.WRAPPED_SEGWIT;
    case 'bip84': return ADDRESS_TYPES.NATIVE_SEGWIT;
    case 'bip86': return ADDRESS_TYPES.TAPROOT;
    default: return null;
  }
}

export function ExtendedKeySection({ isDark, onKeyReady, onKeyInvalid, onSwitchSection, initialContent }: ExtendedKeySectionProps) {
  const [input, setInput] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('Imported xprv');
  // scriptType can be null before auto-detection determines it from version bytes
  const [scriptType, setScriptType] = useState<AddressType | null>(null);
  // Track whether user explicitly changed script type (vs auto-detected from key prefix)
  const [userOverrodeScriptType, setUserOverrodeScriptType] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [derivationConfig, setDerivationConfig] = useState<DerivationPathConfig>({
    preset: 'hd',
    accountIndex: 0,
    addressIndex: 0,
  });

  // Watch-only (xpub) detection state
  const [isWatchOnly, setIsWatchOnly] = useState(false);

  // Wrong section detection state
  const [wrongSection, setWrongSection] = useState<{
    suggestedSection: SuggestedSection;
    label: string;
  } | null>(null);

  // Path discovery state
  const [discoveryResults, setDiscoveryResults] = useState<PathDiscoveryResult[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryHasActivity, setDiscoveryHasActivity] = useState(false);
  const [discoveryTotalBalance, setDiscoveryTotalBalance] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const secureProps = getSecureInputProps();

  // Populate input from initialContent when switching from another section
  useEffect(() => {
    if (initialContent && initialContent.trim()) {
      setInput(initialContent);
      // Initial content should use auto-detection, not override
      setUserOverrodeScriptType(false);
      handleDetectAndParse(initialContent, null, derivationConfig, false);
    }
  }, [initialContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run path discovery when we have a valid xprv
  useEffect(() => {
    if (!parseResult?.xprv) {
      // Clear discovery if key becomes invalid
      setDiscoveryResults([]);
      setIsDiscovering(false);
      setDiscoveryHasActivity(false);
      setDiscoveryTotalBalance(0);
      return;
    }

    // Create cancel ref for this discovery run
    const cancelRef = { current: false };

    const runDiscovery = async () => {
      setIsDiscovering(true);
      setDiscoveryResults([]);
      setDiscoveryHasActivity(false);
      setDiscoveryTotalBalance(0);

      try {
        const result = await PathDiscovery.discoverHD(
          { type: 'xprv', xprv: parseResult.xprv! },
          {
            onPathResult: (pathResult) => {
              if (cancelRef.current) return;
              setDiscoveryResults(prev => {
                const idx = prev.findIndex(r => r.path === pathResult.path);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = pathResult;
                  return updated;
                }
                return [...prev, pathResult];
              });
            },
            cancelRef,
          }
        );

        if (!cancelRef.current) {
          setDiscoveryHasActivity(result.hasActivity);
          setDiscoveryTotalBalance(result.totalBalanceSats);
          if (result.hasActivity && result.totalBalanceSats > 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch (error) {
        // Silently handle discovery errors
        console.log('[ExtendedKeySection] Discovery error:', error);
      } finally {
        if (!cancelRef.current) {
          setIsDiscovering(false);
        }
      }
    };

    runDiscovery();

    return () => {
      cancelRef.current = true;
    };
  }, [parseResult?.xprv]);

  // Handle switching to the correct section when wrong input is detected
  const handleSwitchToCorrectSection = useCallback(() => {
    if (wrongSection && onSwitchSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSwitchSection(wrongSection.suggestedSection, input);
      // Clear input after switching
      setInput('');
      setDetection(null);
      setWrongSection(null);
    }
  }, [wrongSection, onSwitchSection, input]);

  // Handle path selection from discovery card - update both derivation config and script type
  const handlePathSelect = useCallback((path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => {
    const pathToType: Record<string, AddressType> = {
      bip44: ADDRESS_TYPES.LEGACY,
      bip49: ADDRESS_TYPES.WRAPPED_SEGWIT,
      bip84: ADDRESS_TYPES.NATIVE_SEGWIT,
      bip86: ADDRESS_TYPES.TAPROOT,
    };
    const newType = pathToType[path];
    if (newType && parseResult) {
      setScriptType(newType);
      // User selected a specific path - mark as override
      setUserOverrodeScriptType(true);
      // Also update derivation config to match
      const newConfig: DerivationPathConfig = {
        preset: path,
        accountIndex: derivationConfig.accountIndex,
        addressIndex: derivationConfig.addressIndex,
      };
      setDerivationConfig(newConfig);
      onKeyReady(parseResult, walletName, newType);
    }
  }, [parseResult, walletName, derivationConfig, onKeyReady]);

  const handleDetectAndParse = useCallback((text: string, type: AddressType | null, derConfig: DerivationPathConfig, isUserOverride: boolean = false) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setDetection(null);
      setParseResult(null);
      setParseError(null);
      setWrongSection(null);
      setIsWatchOnly(false);
      onKeyInvalid();
      return;
    }

    const detected = detectInputType(trimmed);
    setDetection(detected);

    if (!detected) {
      // Check for xpub patterns manually if detector doesn't recognize
      const xpubMatch = trimmed.match(/^(xpub|ypub|zpub|Ypub|Zpub)[1-9A-HJ-NP-Za-km-z]{100,112}$/);
      if (xpubMatch) {
        // Handle xpub for watch-only wallet
        handleXpubInput(trimmed, type);
        return;
      }

      setParseResult(null);
      setParseError(null);
      setWrongSection(null);
      setIsWatchOnly(false);
      onKeyInvalid();
      return;
    }

    if (!detected.isMainnet) {
      setParseResult(null);
      setParseError('Testnet extended keys are not supported. This app is mainnet only.');
      setWrongSection(null);
      setIsWatchOnly(false);
      onKeyInvalid();
      return;
    }

    // Check for xpub formats (watch-only)
    const xpubFormats = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub'];
    if (xpubFormats.includes(detected.format)) {
      handleXpubInput(trimmed, type);
      return;
    }

    // Check if this input belongs to a different section
    const xprvFormats = ['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'];
    if (!xprvFormats.includes(detected.format)) {
      // Determine which section this belongs to
      let suggestedSection: SuggestedSection | null = null;
      let sectionLabel = '';

      if (detected.format === 'bip39_mnemonic') {
        suggestedSection = 'phrase';
        sectionLabel = 'Phrase';
      } else if (['wif_compressed', 'wif_uncompressed', 'hex_privkey', 'mini_privkey', 'base64_privkey'].includes(detected.format)) {
        suggestedSection = 'key';
        sectionLabel = 'Key';
      } else if (['seed_bytes_hex'].includes(detected.format)) {
        suggestedSection = 'seed';
        sectionLabel = 'Seed';
      } else if (['descriptor_set', 'dumpwallet', 'electrum_json'].includes(detected.format)) {
        suggestedSection = 'file';
        sectionLabel = 'File';
      }

      if (suggestedSection) {
        setWrongSection({ suggestedSection, label: sectionLabel });
      } else {
        setWrongSection(null);
      }

      setParseResult(null);
      setParseError(null);
      setIsWatchOnly(false);
      onKeyInvalid();
      return;
    }

    // Valid xprv format - clear wrong section state and watch-only flag
    setWrongSection(null);
    setIsWatchOnly(false);

    try {
      // Only pass override when user explicitly changed the script type
      // Otherwise, let the parser auto-detect from version bytes (xprv/yprv/zprv)
      const overrideType = isUserOverride && type ? addressTypeToSuggested(type) : undefined;
      const result = parseExtendedKey(trimmed, overrideType, derConfig);
      setParseResult(result);
      setParseError(null);

      // Determine the final script type to use
      let finalType: AddressType;
      if (isUserOverride && type) {
        // User explicitly chose a type - use their choice
        finalType = type;
      } else if (result.suggestedScriptType) {
        // Auto-detect from version bytes (xprv→legacy, yprv→wrapped, zprv→native)
        finalType = suggestedToAddressType(result.suggestedScriptType);
        setScriptType(finalType);
      } else {
        // Fallback to native segwit if no detection
        finalType = type ?? ADDRESS_TYPES.NATIVE_SEGWIT;
        setScriptType(finalType);
      }

      onKeyReady(result, walletName, finalType);
    } catch (err) {
      setParseResult(null);
      setParseError(err instanceof Error ? err.message : 'Failed to parse extended key');
      onKeyInvalid();
    }
  }, [onKeyReady, onKeyInvalid, walletName]);

  // Handle xpub input for watch-only wallet creation
  const handleXpubInput = useCallback((xpub: string, _type: AddressType | null) => {
    setIsWatchOnly(true);
    setWrongSection(null);

    // Determine script type from xpub prefix (always auto-detect, ignore passed type)
    let autoScriptType: AddressType = ADDRESS_TYPES.NATIVE_SEGWIT;
    let suggestedScript: SuggestedScriptType = 'native_segwit';

    if (xpub.startsWith('xpub')) {
      autoScriptType = ADDRESS_TYPES.LEGACY;
      suggestedScript = 'legacy';
    } else if (xpub.startsWith('ypub') || xpub.startsWith('Ypub')) {
      autoScriptType = ADDRESS_TYPES.WRAPPED_SEGWIT;
      suggestedScript = 'wrapped_segwit';
    } else if (xpub.startsWith('zpub') || xpub.startsWith('Zpub')) {
      autoScriptType = ADDRESS_TYPES.NATIVE_SEGWIT;
      suggestedScript = 'native_segwit';
    }

    setScriptType(autoScriptType);
    setWalletName('Watch-Only Wallet');

    // Determine source format from xpub prefix
    let sourceFormat: 'xpub' | 'ypub' | 'zpub' | 'Ypub' | 'Zpub' = 'xpub';
    if (xpub.startsWith('ypub')) sourceFormat = 'ypub';
    else if (xpub.startsWith('Ypub')) sourceFormat = 'Ypub';
    else if (xpub.startsWith('zpub')) sourceFormat = 'zpub';
    else if (xpub.startsWith('Zpub')) sourceFormat = 'Zpub';

    // Create a watch-only import result
    const result: ImportResult = {
      type: 'watch_xpub',
      sourceFormat,
      xpub,
      suggestedScriptType: suggestedScript,
      previewAddress: '', // Will be derived by WalletManager
      fingerprint: undefined,
    };

    setParseResult(result);
    setParseError(null);
    onKeyReady(result, 'Watch-Only Wallet', autoScriptType);
  }, [onKeyReady]);

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    // Reset override flag when entering new input - let auto-detection work
    setUserOverrodeScriptType(false);
    handleDetectAndParse(text, null, derivationConfig, false);
  }, [handleDetectAndParse, derivationConfig]);

  const handleScriptTypeChange = useCallback((type: AddressType) => {
    setScriptType(type);
    // User explicitly changed the type - mark as override
    setUserOverrodeScriptType(true);
    if (input.trim()) {
      handleDetectAndParse(input, type, derivationConfig, true);
    }
  }, [input, handleDetectAndParse, derivationConfig]);

  const handleDerivationConfigChange = useCallback((newConfig: DerivationPathConfig) => {
    setDerivationConfig(newConfig);

    // Auto-set script type when changing to a BIP preset
    const autoType = presetToAddressType(newConfig.preset);
    if (autoType) {
      setScriptType(autoType);
      // User chose a specific derivation path - mark as override
      setUserOverrodeScriptType(true);
      if (input.trim()) {
        handleDetectAndParse(input, autoType, newConfig, true);
      }
    } else if (input.trim()) {
      // Custom path - keep existing override state
      handleDetectAndParse(input, scriptType, newConfig, userOverrodeScriptType);
    }
  }, [input, handleDetectAndParse, scriptType, userOverrodeScriptType]);

  const handleNameChange = useCallback((name: string) => {
    setWalletName(name);
    if (parseResult && scriptType) {
      onKeyReady(parseResult, name, scriptType);
    }
  }, [parseResult, onKeyReady, scriptType]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setInput(text.trim());
        // New paste resets override - let auto-detection determine type
        setUserOverrodeScriptType(false);
        handleDetectAndParse(text.trim(), null, derivationConfig, false);
      }
    } catch {
      // Silently fail
    }
  }, [handleDetectAndParse, derivationConfig]);

  const handleClear = useCallback(() => {
    setInput('');
    setDetection(null);
    setParseResult(null);
    setParseError(null);
    setWrongSection(null);
    setScriptType(null);
    setUserOverrodeScriptType(false);
    onKeyInvalid();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, [onKeyInvalid]);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Extended Private Key
        </Text>
        {detection && <DetectedBadge detection={detection} isDark={isDark} />}
      </View>

      <View style={[
        styles.inputContainer,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
          borderColor: parseResult
            ? (isDark ? 'rgba(48,209,88,0.4)' : 'rgba(48,209,88,0.35)')
            : parseError
              ? (isDark ? 'rgba(255,69,58,0.4)' : 'rgba(220,53,69,0.35)')
              : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
        },
      ]}>
        <PremiumInput
          ref={inputRef}
          icon="link"
          iconColor="#007AFF"
          monospace
          style={[
            styles.keyInput,
            { color: isDark ? '#FFFFFF' : '#000000' },
          ]}
          value={input}
          onChangeText={handleInputChange}
          placeholder="xprv, yprv, zprv, or xpub..."
          placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
          multiline
          numberOfLines={3}
          secureTextEntry={!showKey && input.length > 0 && !isWatchOnly}
          {...secureProps}
        />
        <View style={styles.inputActions}>
          {input.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setShowKey(!showKey)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showKey ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClear}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
                />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {parseError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#FF453A" />
          <Text style={styles.errorText}>{parseError}</Text>
        </View>
      )}

      {/* Wrong section alert - when input belongs to another section */}
      {wrongSection && detection && (
        <TouchableOpacity
          style={[styles.wrongSectionCard, { backgroundColor: isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.1)' }]}
          onPress={handleSwitchToCorrectSection}
          activeOpacity={0.7}
        >
          <View style={styles.wrongSectionContent}>
            <Ionicons name="swap-horizontal" size={20} color="#FF9500" />
            <View style={styles.wrongSectionText}>
              <Text style={[styles.wrongSectionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                This looks like a {detection.label}
              </Text>
              <Text style={[styles.wrongSectionSubtitle, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
                Tap to switch to the {wrongSection.label} tab
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'} />
        </TouchableOpacity>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
          onPress={handlePaste}
          activeOpacity={0.7}
        >
          <Ionicons name="clipboard-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
          <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Paste</Text>
        </TouchableOpacity>
      </View>

      {!input && (
        <View style={[styles.hintCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
          <Text style={[styles.hintTitle, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
            Supported Formats
          </Text>
          <Text style={[styles.hintText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            {'\u2022'} xprv / xpub (BIP44 — legacy){'\n'}
            {'\u2022'} yprv / ypub (BIP49 — wrapped segwit){'\n'}
            {'\u2022'} zprv / zpub (BIP84 — native segwit){'\n'}
            {'\u2022'} Yprv / Zprv (multisig variants)
          </Text>
          <Text style={[styles.hintNote, { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)' }]}>
            Address format is auto-detected from the key prefix.{'\n'}
            Public keys (xpub) create watch-only wallets.
          </Text>
        </View>
      )}

      {/* Watch-Only Badge - shows when xpub detected */}
      {isWatchOnly && parseResult && (
        <View style={[styles.watchOnlyBadge, { backgroundColor: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(10,132,255,0.08)' }]}>
          <Ionicons name="eye" size={20} color="#0A84FF" />
          <View style={styles.watchOnlyContent}>
            <Text style={[styles.watchOnlyTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              Watch-Only Wallet
            </Text>
            <Text style={[styles.watchOnlySubtitle, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
              This wallet can only view balances and receive funds. It cannot send transactions.
            </Text>
          </View>
        </View>
      )}

      {/* Derivation Path Selector — visible after valid xprv detected (not for xpub) */}
      {parseResult && !isWatchOnly && (
        <View style={styles.derivationSection}>
          <DerivationPathSelector
            isDark={isDark}
            config={derivationConfig}
            onConfigChange={handleDerivationConfigChange}
          />
        </View>
      )}

      {/* Path Discovery Card - shows balance/activity scanning for xprv only (not xpub) */}
      {parseResult && parseResult.xprv && !isWatchOnly && (
        <View style={styles.discoverySection}>
          <PathDiscoveryCard
            isDark={isDark}
            results={discoveryResults}
            isScanning={isDiscovering}
            hasActivity={discoveryHasActivity}
            totalBalanceSats={discoveryTotalBalance}
            onPathSelect={handlePathSelect}
          />
        </View>
      )}

      {parseResult && parseResult.previewAddress && (
        <View style={styles.resultSection}>
          <PreviewCard
            address={parseResult.previewAddress}
            scriptType={scriptType ?? ADDRESS_TYPES.NATIVE_SEGWIT}
            isDark={isDark}
          />
          {parseResult.fingerprint && (
            <View style={[styles.fingerprintRow, { backgroundColor: isDark ? '#161618' : '#F5F5F7' }]}>
              <Text style={[styles.fingerprintLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
                Fingerprint
              </Text>
              <Text style={[styles.fingerprintValue, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
                {parseResult.fingerprint}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Only show wallet settings when we have a valid xprv (not wrong section) */}
      {input.trim().length > 0 && !wrongSection && (
        <View style={styles.settingsSection}>
          <WalletSettings
            walletName={walletName}
            onNameChange={handleNameChange}
            scriptType={scriptType ?? ADDRESS_TYPES.NATIVE_SEGWIT}
            onScriptTypeChange={handleScriptTypeChange}
            isDark={isDark}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 0 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  label: { fontSize: 15, fontWeight: '600' },
  inputContainer: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    minHeight: 100,
    position: 'relative',
  },
  keyInput: {
    fontSize: 14,
    lineHeight: 20,
    paddingRight: 32,
    minHeight: 76,
    textAlignVertical: 'top',
  },
  inputActions: {
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 12,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500', flex: 1 },
  wrongSectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,149,0,0.3)',
  },
  wrongSectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  wrongSectionText: {
    flex: 1,
    gap: 2,
  },
  wrongSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  wrongSectionSubtitle: {
    fontSize: 12,
  },
  actions: { flexDirection: 'row', marginTop: 14, gap: 12 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 8,
  },
  actionText: { fontSize: 14, fontWeight: '500' },
  hintCard: {
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    gap: 8,
  },
  hintTitle: { fontSize: 14, fontWeight: '600' },
  hintText: { fontSize: 13, lineHeight: 22 },
  hintNote: { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  derivationSection: { marginTop: 20 },
  discoverySection: { marginTop: 20 },
  resultSection: { marginTop: 20, gap: 0 },
  fingerprintRow: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fingerprintLabel: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fingerprintValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  settingsSection: { marginTop: 24 },
  // Watch-only badge styles
  watchOnlyBadge: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.25)',
  },
  watchOnlyContent: {
    flex: 1,
    gap: 4,
  },
  watchOnlyTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  watchOnlySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
});
