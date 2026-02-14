import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { detectInputType } from '../../services/import/detector';
import { parsePrivateKey } from '../../services/import/parsers/privateKey';
import { isBIP38, decryptBIP38 } from '../../services/import/parsers/bip38';
import { parseBrainwallet } from '../../services/import/parsers/brainwallet';
import { getSecureInputProps } from '../../services/import/security';
import { PathDiscovery } from '../../services/import/PathDiscovery';
import { AppBottomSheet, SheetPrimaryButton, SheetSectionFooter } from '../ui';
import { DetectedBadge } from './DetectedBadge';
import { PreviewCard } from './PreviewCard';
import { WalletSettings } from './WalletSettings';
import { PathDiscoveryCard } from './PathDiscoveryCard';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import type { DetectionResult, ImportResult, PathDiscoveryResult, SuggestedScriptType } from '../../services/import/types';

/** Maps detected format to recommended section */
type SuggestedSection = 'phrase' | 'key' | 'extended' | 'seed' | 'file';

interface KeySectionProps {
  isDark: boolean;
  onKeyReady: (result: ImportResult, walletName: string, scriptType: AddressType) => void;
  onKeyInvalid: () => void;
  /** Called when input is detected as belonging to another section */
  onSwitchSection?: (section: SuggestedSection, content: string) => void;
  /** Initial content to populate the input with (from section switch) */
  initialContent?: string | null;
}

export function KeySection({ isDark, onKeyReady, onKeyInvalid, onSwitchSection, initialContent }: KeySectionProps) {
  const [input, setInput] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('Imported Key');
  const [scriptType, setScriptType] = useState<AddressType>(ADDRESS_TYPES.NATIVE_SEGWIT);
  const [showKey, setShowKey] = useState(false);

  // Wrong section detection state
  const [wrongSection, setWrongSection] = useState<{
    suggestedSection: SuggestedSection;
    label: string;
  } | null>(null);

  // BIP38 encrypted key state
  const [showBIP38Modal, setShowBIP38Modal] = useState(false);
  const [bip38Key, setBip38Key] = useState('');
  const [bip38Password, setBip38Password] = useState('');
  const [bip38Decrypting, setBip38Decrypting] = useState(false);
  const [bip38Error, setBip38Error] = useState<string | null>(null);

  // Brainwallet state
  const [brainwalletMode, setBrainwalletMode] = useState(false);
  const [brainwalletPassphrase, setBrainwalletPassphrase] = useState('');
  const [showBrainwalletPassphrase, setShowBrainwalletPassphrase] = useState(false);

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
      handleDetectAndParse(initialContent, scriptType);
    }
  }, [initialContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run path discovery when we have a valid WIF
  useEffect(() => {
    if (!parseResult?.privateKeyWIF) {
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
        const compressed = parseResult.compressed !== false;
        const result = await PathDiscovery.discoverWIF(
          parseResult.privateKeyWIF!,
          compressed,
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
        console.log('[KeySection] Discovery error:', error);
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
  }, [parseResult?.privateKeyWIF, parseResult?.compressed]);

  // Handle path selection from discovery card - update script type
  const handlePathSelect = useCallback((path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => {
    const pathToType: Record<string, AddressType> = {
      bip44: ADDRESS_TYPES.LEGACY,
      bip49: ADDRESS_TYPES.WRAPPED_SEGWIT,
      bip84: ADDRESS_TYPES.NATIVE_SEGWIT,
      bip86: ADDRESS_TYPES.TAPROOT,
    };
    const newType = pathToType[path];
    if (newType && parseResult) {
      // Check if the type is allowed for this key
      if (parseResult.compressed === false && newType !== ADDRESS_TYPES.LEGACY) {
        return; // Can't select non-legacy for uncompressed keys
      }
      setScriptType(newType);
      onKeyReady(parseResult, walletName, newType);
    }
  }, [parseResult, walletName, onKeyReady]);

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

  const handleDetectAndParse = useCallback((text: string, type: AddressType) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setDetection(null);
      setParseResult(null);
      setParseError(null);
      setWrongSection(null);
      onKeyInvalid();
      return;
    }

    // Detect format
    const detected = detectInputType(trimmed);
    setDetection(detected);

    if (!detected) {
      setParseResult(null);
      setParseError(null);
      setWrongSection(null);
      onKeyInvalid();
      return;
    }

    if (!detected.isMainnet) {
      setParseResult(null);
      setParseError('Testnet keys are not supported. This app is mainnet only.');
      setWrongSection(null);
      onKeyInvalid();
      return;
    }

    // Only parse key-type formats
    const keyFormats = [
      'wif_compressed', 'wif_uncompressed',
      'hex_privkey', 'decimal_privkey',
      'base64_privkey', 'mini_privkey',
    ];
    if (!keyFormats.includes(detected.format)) {
      // Check if this input belongs to a different section
      let suggestedSection: SuggestedSection | null = null;
      let sectionLabel = '';

      if (detected.format === 'bip39_mnemonic') {
        suggestedSection = 'phrase';
        sectionLabel = 'Phrase';
      } else if (['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'].includes(detected.format)) {
        suggestedSection = 'extended';
        sectionLabel = 'xprv';
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
      onKeyInvalid();
      return;
    }

    // Valid key format - clear wrong section state
    setWrongSection(null);

    // Try to parse
    try {
      // For uncompressed keys, force Legacy address type
      const effectiveType = (detected.format === 'wif_uncompressed')
        ? ADDRESS_TYPES.LEGACY
        : type;
      const result = parsePrivateKey(trimmed, effectiveType);
      setParseResult(result);
      setParseError(null);

      // If uncompressed, force script type to Legacy
      if (result.compressed === false) {
        setScriptType(ADDRESS_TYPES.LEGACY);
        onKeyReady(result, walletName, ADDRESS_TYPES.LEGACY);
      } else {
        onKeyReady(result, walletName, effectiveType);
      }
    } catch (err) {
      setParseResult(null);
      setParseError(err instanceof Error ? err.message : 'Failed to parse key');
      onKeyInvalid();
    }
  }, [onKeyReady, onKeyInvalid, walletName]);

  const handleInputChange = useCallback((text: string) => {
    setInput(text);

    // Check if it's a BIP38 encrypted key
    const trimmed = text.trim();
    if (trimmed && isBIP38(trimmed)) {
      setBip38Key(trimmed);
      setShowBIP38Modal(true);
      setInput('');
      return;
    }

    handleDetectAndParse(text, scriptType);
  }, [handleDetectAndParse, scriptType]);

  const handleScriptTypeChange = useCallback((type: AddressType) => {
    setScriptType(type);
    if (input.trim()) {
      handleDetectAndParse(input, type);
    }
  }, [input, handleDetectAndParse]);

  const handleNameChange = useCallback((name: string) => {
    setWalletName(name);
    // Re-notify parent with new name
    if (parseResult) {
      onKeyReady(parseResult, name, scriptType);
    }
  }, [parseResult, onKeyReady, scriptType]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const trimmed = text.trim();

        // Check if it's a BIP38 encrypted key
        if (isBIP38(trimmed)) {
          setBip38Key(trimmed);
          setShowBIP38Modal(true);
          return;
        }

        setInput(trimmed);
        handleDetectAndParse(trimmed, scriptType);
      }
    } catch (err) {
      // Silently fail
    }
  }, [handleDetectAndParse, scriptType]);

  // Handle BIP38 decryption
  const handleBIP38Decrypt = useCallback(async () => {
    if (!bip38Key || !bip38Password) return;

    setBip38Decrypting(true);
    setBip38Error(null);

    try {
      const result = await decryptBIP38(bip38Key, bip38Password, scriptType);

      if (!result.privateKeyWIF) {
        throw new Error('Decryption failed');
      }

      // Successfully decrypted - use the WIF
      setInput(result.privateKeyWIF);
      setParseResult(result);
      setParseError(null);
      setShowBIP38Modal(false);
      setBip38Password('');
      setBip38Key('');
      setWalletName('BIP38 Imported');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onKeyReady(result, 'BIP38 Imported', scriptType);
    } catch (err) {
      setBip38Error(err instanceof Error ? err.message : 'Decryption failed. Check password.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBip38Decrypting(false);
    }
  }, [bip38Key, bip38Password, scriptType, onKeyReady]);

  // Handle brainwallet derivation
  const handleBrainwalletDerive = useCallback(async () => {
    if (!brainwalletPassphrase.trim()) return;

    try {
      const result = parseBrainwallet(brainwalletPassphrase, scriptType);

      if (!result.privateKeyWIF) {
        throw new Error('Derivation failed');
      }

      setParseResult(result);
      setParseError(null);
      setWalletName('Brainwallet Import');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onKeyReady(result, 'Brainwallet Import', scriptType);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to derive key from passphrase');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [brainwalletPassphrase, scriptType, onKeyReady]);

  const handleClear = useCallback(() => {
    setInput('');
    setDetection(null);
    setParseResult(null);
    setParseError(null);
    setWrongSection(null);
    onKeyInvalid();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, [onKeyInvalid]);

  return (
    <View style={styles.container}>
      {/* Input label */}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Private Key
        </Text>
        {detection && <DetectedBadge detection={detection} isDark={isDark} />}
      </View>

      {/* Key input */}
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
          icon="key"
          iconColor="#FF9F0A"
          monospace
          style={[
            styles.keyInput,
            { color: isDark ? '#FFFFFF' : '#000000' },
          ]}
          value={input}
          onChangeText={handleInputChange}
          placeholder="WIF, hex, mini key, or base64..."
          placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
          multiline
          numberOfLines={3}
          secureTextEntry={!showKey && input.length > 0}
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

      {/* Parse error */}
      {parseError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#FF453A" />
          <Text style={styles.errorText}>{parseError}</Text>
        </View>
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
          style={[
            styles.actionBtn,
            {
              backgroundColor: brainwalletMode
                ? (isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.12)')
                : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            },
          ]}
          onPress={() => {
            setBrainwalletMode(!brainwalletMode);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (!brainwalletMode) {
              // Entering brainwallet mode - clear key input
              setInput('');
              setDetection(null);
              setParseResult(null);
              setParseError(null);
            } else {
              // Exiting brainwallet mode - clear passphrase
              setBrainwalletPassphrase('');
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="bulb-outline"
            size={18}
            color={brainwalletMode ? '#FF9500' : (isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)')}
          />
          <Text
            style={[
              styles.actionText,
              { color: brainwalletMode ? '#FF9500' : (isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)') },
            ]}
          >
            Brainwallet
          </Text>
        </TouchableOpacity>
      </View>

      {/* Brainwallet input section */}
      {brainwalletMode && (
        <View style={styles.brainwalletSection}>
          {/* Security Warning */}
          <View style={[styles.warningCard, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)' }]}>
            <Ionicons name="warning" size={20} color="#FF453A" />
            <View style={styles.warningContent}>
              <Text style={[styles.warningTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                Security Warning
              </Text>
              <Text style={[styles.warningText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }]}>
                Brainwallets are extremely insecure. Anyone who guesses your passphrase can steal your funds.
                Only use this to recover an existing brainwallet.
              </Text>
            </View>
          </View>

          {/* Passphrase input */}
          <View style={styles.brainwalletInputGroup}>
            <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
              Passphrase
            </Text>
            <View style={[
              styles.inputContainer,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
                borderColor: brainwalletPassphrase.trim()
                  ? (isDark ? 'rgba(255,149,0,0.4)' : 'rgba(255,149,0,0.35)')
                  : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
                minHeight: 56,
              },
            ]}>
              <PremiumInput
                icon="key"
                iconColor="#FF9F0A"
                rowStyle={{ minHeight: 32 }}
                value={brainwalletPassphrase}
                onChangeText={setBrainwalletPassphrase}
                placeholder="Enter your brainwallet passphrase..."
                placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
                secureTextEntry={!showBrainwalletPassphrase}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.inputActions}>
                {brainwalletPassphrase.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setShowBrainwalletPassphrase(!showBrainwalletPassphrase)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showBrainwalletPassphrase ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {/* Derive button */}
          <TouchableOpacity
            style={[
              styles.deriveBtn,
              {
                backgroundColor: brainwalletPassphrase.trim()
                  ? '#FF9500'
                  : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
              },
            ]}
            onPress={handleBrainwalletDerive}
            disabled={!brainwalletPassphrase.trim()}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.deriveBtnText,
              {
                color: brainwalletPassphrase.trim()
                  ? '#FFFFFF'
                  : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'),
              },
            ]}>
              Derive Key
            </Text>
          </TouchableOpacity>
        </View>
      )}

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

      {/* Supported formats hint */}
      {!input && (
        <View style={[styles.hintCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
          <Text style={[styles.hintTitle, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
            Supported Formats
          </Text>
          <Text style={[styles.hintText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            {'\u2022'} WIF (starts with K, L, or 5){'\n'}
            {'\u2022'} Hex (64 characters){'\n'}
            {'\u2022'} Mini key (starts with S){'\n'}
            {'\u2022'} Base64 (44 characters){'\n'}
            {'\u2022'} Decimal (large integer)
          </Text>
        </View>
      )}

      {/* Preview and settings when key is valid */}
      {parseResult && parseResult.previewAddress && (
        <View style={styles.resultSection}>
          <PreviewCard
            address={parseResult.previewAddress}
            scriptType={scriptType}
            isDark={isDark}
          />
        </View>
      )}

      {/* Path Discovery Card - shows balance/activity scanning for WIF */}
      {parseResult && parseResult.privateKeyWIF && (
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

      {/* Wallet settings (only visible when input is valid key format, not wrong section) */}
      {input.trim().length > 0 && !wrongSection && (
        <View style={styles.settingsSection}>
          <WalletSettings
            walletName={walletName}
            onNameChange={handleNameChange}
            scriptType={scriptType}
            onScriptTypeChange={handleScriptTypeChange}
            isDark={isDark}
            disabledScriptTypes={
              parseResult?.compressed === false
                ? [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.TAPROOT]
                : undefined
            }
            disabledReason={
              parseResult?.compressed === false
                ? 'Uncompressed keys only support Legacy addresses'
                : undefined
            }
          />
        </View>
      )}

      {/* Also show wallet settings for brainwallet when derived */}
      {brainwalletMode && parseResult && (
        <View style={styles.settingsSection}>
          <WalletSettings
            walletName={walletName}
            onNameChange={handleNameChange}
            scriptType={scriptType}
            onScriptTypeChange={(type) => {
              setScriptType(type);
              // Re-derive with new script type
              if (brainwalletPassphrase.trim()) {
                const result = parseBrainwallet(brainwalletPassphrase, type);
                setParseResult(result);
                if (result.privateKeyWIF) {
                  onKeyReady(result, walletName, type);
                }
              }
            }}
            isDark={isDark}
          />
        </View>
      )}

      {/* BIP38 Password Modal */}
      <AppBottomSheet
        visible={showBIP38Modal}
        onClose={() => {
          setShowBIP38Modal(false);
          setBip38Password('');
          setBip38Error(null);
          setBip38Key('');
        }}
        title="Encrypted Key"
        sizing="medium"
      >
        <View style={styles.bip38ModalContent}>
          <View style={[styles.bip38IconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Ionicons name="lock-closed" size={32} color={isDark ? '#FFFFFF' : '#000000'} />
          </View>

          <Text style={[styles.bip38Title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
            BIP38 Encrypted Key
          </Text>

          <Text style={[styles.bip38Description, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }]}>
            This key is BIP38 encrypted. Enter the password to decrypt it.
          </Text>

          {/* Password Input */}
          <View style={styles.bip38InputGroup}>
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

          {/* Error message */}
          {bip38Error && (
            <View style={styles.bip38ErrorRow}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.bip38ErrorText}>{bip38Error}</Text>
            </View>
          )}

          {/* Warning about time */}
          <SheetSectionFooter
            text="⚠️ Decryption may take up to 30 seconds on mobile devices."
            variant="warning"
          />

          {/* Decrypt Button */}
          <View style={styles.bip38ButtonContainer}>
            <SheetPrimaryButton
              label={bip38Decrypting ? 'Decrypting...' : 'Decrypt Key'}
              onPress={handleBIP38Decrypt}
              disabled={!bip38Password || bip38Decrypting}
            />
          </View>

          {/* Loading indicator */}
          {bip38Decrypting && (
            <View style={styles.bip38LoadingOverlay}>
              <ActivityIndicator size="large" color={isDark ? '#FFFFFF' : '#000000'} />
              <Text style={[styles.bip38LoadingText, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
                Decrypting key...{'\n'}This may take a while.
              </Text>
            </View>
          )}
        </View>
      </AppBottomSheet>
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
  resultSection: { marginTop: 20 },
  discoverySection: { marginTop: 20 },
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
  // Brainwallet styles
  brainwalletSection: {
    marginTop: 20,
    gap: 16,
  },
  warningCard: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.25)',
  },
  warningContent: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
  },
  brainwalletInputGroup: {
    gap: 10,
  },
  deriveBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deriveBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // BIP38 Modal styles
  bip38ModalContent: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  bip38IconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bip38Title: {
    fontSize: 20,
    fontWeight: '700',
  },
  bip38Description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  bip38InputGroup: {
    width: '100%',
    marginTop: 8,
  },
  bip38ErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  bip38ErrorText: {
    fontSize: 14,
    color: '#FF453A',
    fontWeight: '500',
  },
  bip38ButtonContainer: {
    width: '100%',
    marginTop: 16,
  },
  bip38LoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    gap: 16,
  },
  bip38LoadingText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
