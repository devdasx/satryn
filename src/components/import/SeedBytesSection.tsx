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
import { parseSeedBytes } from '../../services/import/parsers/seedBytes';
import { getSecureInputProps } from '../../services/import/security';
import { PathDiscovery } from '../../services/import/PathDiscovery';
import { PreviewCard } from './PreviewCard';
import { WalletSettings } from './WalletSettings';
import { DerivationPathSelector } from './DerivationPathSelector';
import { PathDiscoveryCard } from './PathDiscoveryCard';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import type { ImportResult, SuggestedScriptType, DerivationPathConfig, PathDiscoveryResult, DetectionResult } from '../../services/import/types';

/** Maps detected format to recommended section */
type SuggestedSection = 'phrase' | 'key' | 'extended' | 'seed' | 'file';

interface SeedBytesSectionProps {
  isDark: boolean;
  onSeedReady: (result: ImportResult, walletName: string, scriptType: AddressType) => void;
  onSeedInvalid: () => void;
  /** Called when input is detected as belonging to another section */
  onSwitchSection?: (section: SuggestedSection, content: string) => void;
  /** Initial content to populate the input with (from section switch) */
  initialContent?: string | null;
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

export function SeedBytesSection({ isDark, onSeedReady, onSeedInvalid, onSwitchSection, initialContent }: SeedBytesSectionProps) {
  const [input, setInput] = useState('');
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('Imported Seed');
  const [scriptType, setScriptType] = useState<AddressType>(ADDRESS_TYPES.NATIVE_SEGWIT);
  const [showSeed, setShowSeed] = useState(false);
  const [seedLabel, setSeedLabel] = useState<string | null>(null);
  const [derivationConfig, setDerivationConfig] = useState<DerivationPathConfig>({
    preset: 'hd',
    accountIndex: 0,
    addressIndex: 0,
  });

  // Wrong section detection state
  const [wrongSection, setWrongSection] = useState<{
    suggestedSection: SuggestedSection;
    label: string;
  } | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);

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
      handleDetectAndParse(initialContent, scriptType, derivationConfig);
    }
  }, [initialContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run path discovery when we have valid seed bytes
  useEffect(() => {
    if (!parseResult?.seed) {
      // Clear discovery if seed becomes invalid
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
          { type: 'seed', seed: Buffer.from(parseResult.seed!) },
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
        console.log('[SeedBytesSection] Discovery error:', error);
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
  }, [parseResult?.seed]);

  // Handle switching to the correct section when wrong input is detected
  const handleSwitchToCorrectSection = useCallback(() => {
    if (wrongSection && onSwitchSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSwitchSection(wrongSection.suggestedSection, input);
      // Clear input after switching
      setInput('');
      setParseResult(null);
      setParseError(null);
      setSeedLabel(null);
      setWrongSection(null);
      setDetection(null);
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
      // Also update derivation config to match
      const newConfig: DerivationPathConfig = {
        preset: path,
        accountIndex: derivationConfig.accountIndex,
        addressIndex: derivationConfig.addressIndex,
      };
      setDerivationConfig(newConfig);
      onSeedReady(parseResult, walletName, newType);
    }
  }, [parseResult, walletName, derivationConfig, onSeedReady]);

  const handleDetectAndParse = useCallback((text: string, type: AddressType, derConfig: DerivationPathConfig) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setParseResult(null);
      setParseError(null);
      setSeedLabel(null);
      setWrongSection(null);
      setDetection(null);
      onSeedInvalid();
      return;
    }

    // First, detect if input belongs to another section
    const detected = detectInputType(trimmed);
    setDetection(detected);

    if (detected) {
      // Check if this input belongs to a different section
      let suggestedSection: SuggestedSection | null = null;
      let sectionLabel = '';

      if (detected.format === 'bip39_mnemonic') {
        suggestedSection = 'phrase';
        sectionLabel = 'Phrase';
      } else if (['wif_compressed', 'wif_uncompressed', 'hex_privkey', 'mini_privkey', 'base64_privkey', 'decimal_privkey'].includes(detected.format)) {
        suggestedSection = 'key';
        sectionLabel = 'Key';
      } else if (['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'].includes(detected.format)) {
        suggestedSection = 'extended';
        sectionLabel = 'xprv';
      } else if (['descriptor_set', 'dumpwallet', 'electrum_json'].includes(detected.format)) {
        suggestedSection = 'file';
        sectionLabel = 'File';
      }

      if (suggestedSection) {
        setWrongSection({ suggestedSection, label: sectionLabel });
        setParseResult(null);
        setParseError(null);
        setSeedLabel(null);
        onSeedInvalid();
        return;
      }
    }

    // Valid seed section - clear wrong section state
    setWrongSection(null);

    const trimmedLower = trimmed.toLowerCase();

    // Validate hex format
    if (!/^[0-9a-f]+$/.test(trimmedLower)) {
      setParseResult(null);
      setParseError('Expected hex characters only (0-9, a-f)');
      setSeedLabel(null);
      onSeedInvalid();
      return;
    }

    if (trimmedLower.length % 2 !== 0) {
      setParseResult(null);
      setParseError('Hex string must have even length');
      setSeedLabel(null);
      onSeedInvalid();
      return;
    }

    const byteLen = trimmedLower.length / 2;
    if (byteLen < 16 || byteLen > 64) {
      setParseResult(null);
      setParseError(`Seed must be 16-64 bytes (32-128 hex chars). Got ${byteLen} bytes.`);
      setSeedLabel(null);
      onSeedInvalid();
      return;
    }

    try {
      const result = parseSeedBytes(trimmedLower, addressTypeToSuggested(type), derConfig);
      setParseResult(result);
      setParseError(null);

      // Set label based on length
      if (byteLen === 64) {
        setSeedLabel('BIP39 Seed (64 bytes)');
      } else if (byteLen === 32) {
        setSeedLabel('Master Seed (32 bytes)');
      } else {
        setSeedLabel(`Seed (${byteLen} bytes)`);
      }

      onSeedReady(result, walletName, type);
    } catch (err) {
      setParseResult(null);
      setParseError(err instanceof Error ? err.message : 'Failed to parse seed bytes');
      setSeedLabel(null);
      onSeedInvalid();
    }
  }, [onSeedReady, onSeedInvalid, walletName]);

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    handleDetectAndParse(text, scriptType, derivationConfig);
  }, [handleDetectAndParse, scriptType, derivationConfig]);

  const handleScriptTypeChange = useCallback((type: AddressType) => {
    setScriptType(type);
    if (input.trim()) {
      handleDetectAndParse(input, type, derivationConfig);
    }
  }, [input, handleDetectAndParse, derivationConfig]);

  const handleDerivationConfigChange = useCallback((newConfig: DerivationPathConfig) => {
    setDerivationConfig(newConfig);

    // Auto-set script type when changing to a BIP preset
    const autoType = presetToAddressType(newConfig.preset);
    if (autoType) {
      setScriptType(autoType);
      if (input.trim()) {
        handleDetectAndParse(input, autoType, newConfig);
      }
    } else if (input.trim()) {
      handleDetectAndParse(input, scriptType, newConfig);
    }
  }, [input, handleDetectAndParse, scriptType]);

  const handleNameChange = useCallback((name: string) => {
    setWalletName(name);
    if (parseResult) {
      onSeedReady(parseResult, name, scriptType);
    }
  }, [parseResult, onSeedReady, scriptType]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setInput(text.trim());
        handleDetectAndParse(text.trim(), scriptType, derivationConfig);
      }
    } catch {
      // Silently fail
    }
  }, [handleDetectAndParse, scriptType, derivationConfig]);

  const handleClear = useCallback(() => {
    setInput('');
    setParseResult(null);
    setParseError(null);
    setSeedLabel(null);
    setWrongSection(null);
    setDetection(null);
    onSeedInvalid();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, [onSeedInvalid]);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Seed Bytes (Hex)
        </Text>
        {seedLabel && (
          <View style={[styles.seedBadge, { backgroundColor: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)' }]}>
            <Text style={styles.seedBadgeText}>{seedLabel}</Text>
          </View>
        )}
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
          icon="code-slash"
          iconColor="#BF5AF2"
          monospace
          style={[
            styles.seedInput,
            { color: isDark ? '#FFFFFF' : '#000000' },
          ]}
          value={input}
          onChangeText={handleInputChange}
          placeholder="64 or 128 hex characters..."
          placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
          multiline
          numberOfLines={4}
          secureTextEntry={!showSeed && input.length > 0}
          {...secureProps}
        />
        <View style={styles.inputActions}>
          {input.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setShowSeed(!showSeed)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showSeed ? 'eye-off-outline' : 'eye-outline'}
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

      {/* Byte counter */}
      {input.trim().length > 0 && !parseError && (
        <Text style={[styles.byteCounter, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }]}>
          {input.trim().length} hex chars = {Math.floor(input.trim().length / 2)} bytes
        </Text>
      )}

      {parseError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#FF453A" />
          <Text style={styles.errorText}>{parseError}</Text>
        </View>
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

      {/* Wrong section alert - show when input belongs to another section */}
      {wrongSection && detection && (
        <TouchableOpacity
          style={[
            styles.wrongSectionCard,
            { backgroundColor: isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.1)' },
          ]}
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
          <Ionicons
            name="chevron-forward"
            size={18}
            color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
          />
        </TouchableOpacity>
      )}

      {!input && (
        <View style={[styles.hintCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
          <Text style={[styles.hintTitle, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
            What is this?
          </Text>
          <Text style={[styles.hintText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            Raw seed bytes are the binary output of BIP39 seed derivation or a BIP32 master seed.
          </Text>
          <Text style={[styles.hintText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            {'\u2022'} 128 hex chars (64 bytes) — BIP39 seed{'\n'}
            {'\u2022'} 64 hex chars (32 bytes) — BIP32 master seed{'\n'}
            {'\u2022'} 32-128 hex chars — custom seed
          </Text>
        </View>
      )}

      {/* Derivation Path Selector — visible after valid seed parsed */}
      {parseResult && (
        <View style={styles.derivationSection}>
          <DerivationPathSelector
            isDark={isDark}
            config={derivationConfig}
            onConfigChange={handleDerivationConfigChange}
          />
        </View>
      )}

      {/* Path Discovery Card - shows balance/activity scanning for seed */}
      {parseResult && parseResult.seed && (
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
            scriptType={scriptType}
            isDark={isDark}
          />
          {parseResult.fingerprint && (
            <View style={[styles.fingerprintRow, { backgroundColor: isDark ? '#161618' : '#F5F5F7' }]}>
              <Text style={[styles.fingerprintLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
                Master Fingerprint
              </Text>
              <Text style={[styles.fingerprintValue, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
                {parseResult.fingerprint}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Wallet settings - only show when input is valid (not wrong section) */}
      {input.trim().length > 0 && !wrongSection && (
        <View style={styles.settingsSection}>
          <WalletSettings
            walletName={walletName}
            onNameChange={handleNameChange}
            scriptType={scriptType}
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
  seedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  seedBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#30D158',
    letterSpacing: -0.1,
  },
  inputContainer: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    minHeight: 120,
    position: 'relative',
  },
  seedInput: {
    fontSize: 14,
    lineHeight: 20,
    paddingRight: 32,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputActions: {
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 12,
  },
  byteCounter: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500', flex: 1 },
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
});
