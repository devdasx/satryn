import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  LayoutAnimation,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SeedGenerator } from '../../core/wallet';
import { detectInputType } from '../../services/import/detector';
import { getSecureInputProps } from '../../services/import/security';
import { PathDiscovery } from '../../services/import/PathDiscovery';
import { PathDiscoveryCard } from './PathDiscoveryCard';
import { DerivationPathSelector } from './DerivationPathSelector';
import type { DerivationPathConfig, PathDiscoveryResult, DetectionResult } from '../../services/import/types';

/** Maps detected format to recommended section */
type SuggestedSection = 'phrase' | 'key' | 'extended' | 'seed' | 'file';

interface PhraseSectionProps {
  isDark: boolean;
  onPhraseValid: (mnemonic: string, derivationConfig?: DerivationPathConfig) => void;
  onPhraseInvalid: () => void;
  onScanQR: () => void;
  /** Called when input is detected as belonging to another section */
  onSwitchSection?: (section: SuggestedSection, content: string) => void;
}

export function PhraseSection({ isDark, onPhraseValid, onPhraseInvalid, onScanQR, onSwitchSection }: PhraseSectionProps) {
  const [confirmedWords, setConfirmedWords] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [invalidWord, setInvalidWord] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wrong section detection state
  const [wrongSection, setWrongSection] = useState<{
    suggestedSection: SuggestedSection;
    label: string;
    content: string;
  } | null>(null);
  const [wrongSectionDetection, setWrongSectionDetection] = useState<DetectionResult | null>(null);

  // Derivation path config (default to HD = all paths)
  const [derivationConfig, setDerivationConfig] = useState<DerivationPathConfig>({
    preset: 'hd',
    accountIndex: 0,
    addressIndex: 0,
  });

  // Path discovery state
  const [discoveryResults, setDiscoveryResults] = useState<PathDiscoveryResult[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryComplete, setDiscoveryComplete] = useState(false);
  // Simple object for cancellation (not a React ref, just a mutable object)
  const cancelDiscoveryRef = useRef<{ current: boolean }>({ current: false });

  const inputRef = useRef<TextInput>(null);
  const wasValidRef = useRef(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const wordCount = confirmedWords.length;
  const isValidWordCount = wordCount === 12 || wordCount === 24;
  const fullPhrase = confirmedWords.join(' ');
  const isValidPhrase = isValidWordCount && SeedGenerator.validate(fullPhrase);

  // Run path discovery when phrase becomes valid
  const runDiscovery = useCallback(async (mnemonic: string, passphraseValue: string) => {
    // Cancel any previous discovery
    cancelDiscoveryRef.current.current = true;

    // Small delay to allow previous discovery to stop
    await new Promise(resolve => setTimeout(resolve, 50));
    cancelDiscoveryRef.current.current = false;

    setIsDiscovering(true);
    setDiscoveryComplete(false);
    setDiscoveryResults([]);

    try {
      const result = await PathDiscovery.discoverHD(
        { type: 'mnemonic', mnemonic, passphrase: passphraseValue },
        {
          gapLimit: 20,
          onPathResult: (pathResult) => {
            if (!cancelDiscoveryRef.current.current) {
              setDiscoveryResults(prev => {
                const idx = prev.findIndex(r => r.path === pathResult.path);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = pathResult;
                  return updated;
                }
                return [...prev, pathResult];
              });
            }
          },
          cancelRef: cancelDiscoveryRef.current,
        }
      );

      if (!cancelDiscoveryRef.current.current) {
        setDiscoveryComplete(result.isComplete);
        if (result.hasActivity && result.totalBalanceSats > 0) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (err) {
      console.error('Path discovery failed:', err);
    } finally {
      if (!cancelDiscoveryRef.current.current) {
        setIsDiscovering(false);
      }
    }
  }, []);

  // Notify parent when phrase validity changes
  useEffect(() => {
    if (isValidPhrase && !wasValidRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onPhraseValid(fullPhrase, derivationConfig);
      // Start path discovery
      runDiscovery(fullPhrase, passphrase);
    } else if (!isValidPhrase && wasValidRef.current) {
      onPhraseInvalid();
      // Cancel discovery
      cancelDiscoveryRef.current.current = true;
      setDiscoveryResults([]);
      setIsDiscovering(false);
      setDiscoveryComplete(false);
    }
    wasValidRef.current = isValidPhrase;
  }, [isValidPhrase, fullPhrase, passphrase, derivationConfig, onPhraseValid, onPhraseInvalid, runDiscovery]);

  // Re-run discovery when passphrase changes (if phrase is valid)
  useEffect(() => {
    if (isValidPhrase) {
      runDiscovery(fullPhrase, passphrase);
    }
  }, [passphrase, isValidPhrase, fullPhrase, runDiscovery]);

  // Notify parent when derivation config changes (if phrase is valid)
  const handleDerivationConfigChange = useCallback((newConfig: DerivationPathConfig) => {
    setDerivationConfig(newConfig);
    if (isValidPhrase) {
      onPhraseValid(fullPhrase, newConfig);
    }
  }, [isValidPhrase, fullPhrase, onPhraseValid]);

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Handle switching to the correct section when wrong input is detected
  const handleSwitchToCorrectSection = useCallback(() => {
    if (wrongSection && onSwitchSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSwitchSection(wrongSection.suggestedSection, wrongSection.content);
      // Clear all state after switching
      setConfirmedWords([]);
      setCurrentInput('');
      setInvalidWord(null);
      setError(null);
      setWrongSection(null);
      setWrongSectionDetection(null);
    }
  }, [wrongSection, onSwitchSection]);

  // Check pasted content for wrong section
  const checkForWrongSection = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    const detected = detectInputType(trimmed);

    if (detected) {
      let suggestedSection: SuggestedSection | null = null;
      let sectionLabel = '';

      // Check if it's a non-mnemonic format
      if (['wif_compressed', 'wif_uncompressed', 'hex_privkey', 'mini_privkey', 'base64_privkey', 'decimal_privkey'].includes(detected.format)) {
        suggestedSection = 'key';
        sectionLabel = 'Key';
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
        setWrongSection({ suggestedSection, label: sectionLabel, content: trimmed });
        setWrongSectionDetection(detected);
        return true;
      }
    }

    return false;
  }, []);

  const getWordCountDisplay = () => {
    if (wordCount === 0) return '0 / 12 or 24';
    if (wordCount === 12) return '12 words';
    if (wordCount === 24) return '24 words';
    if (wordCount > 24) return 'Too many';
    if (wordCount < 12) return `${wordCount} / 12`;
    return `${wordCount} / 24`;
  };

  const tryConfirmWord = useCallback((word: string) => {
    const cleaned = word.toLowerCase().trim();
    if (!cleaned) return false;

    if (SeedGenerator.isValidWord(cleaned)) {
      if (confirmedWords.length >= 24) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return false;
      }
      setConfirmedWords(prev => [...prev, cleaned]);
      setCurrentInput('');
      setInvalidWord(null);
      setError(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return true;
    } else {
      setInvalidWord(cleaned);
      triggerShake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  }, [confirmedWords.length, triggerShake]);

  const processMultipleWords = useCallback((text: string, replaceExisting: boolean = true) => {
    // First, check if this text belongs to another section (not a mnemonic)
    // Only check if replaceExisting is true (i.e., pasted content, not incremental typing)
    if (replaceExisting && checkForWrongSection(text)) {
      return;
    }

    // Clear wrong section state if processing valid mnemonic words
    setWrongSection(null);
    setWrongSectionDetection(null);

    const words = text.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    const validWords: string[] = [];
    let firstInvalidWord: string | null = null;

    for (const word of words) {
      if (SeedGenerator.isValidWord(word)) {
        if (validWords.length < 24) validWords.push(word);
      } else if (!firstInvalidWord) {
        firstInvalidWord = word;
      }
    }

    if (validWords.length > 0) {
      if (replaceExisting) {
        setConfirmedWords(validWords);
      } else {
        setConfirmedWords(prev => [...prev, ...validWords].slice(0, 24));
      }
      setCurrentInput('');
      setInvalidWord(null);
      setError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (firstInvalidWord) {
      setInvalidWord(firstInvalidWord);
      setCurrentInput(firstInvalidWord);
      triggerShake();
    }
  }, [triggerShake, checkForWrongSection]);

  const handleInputChange = useCallback((text: string) => {
    if (invalidWord) setInvalidWord(null);

    if (text.includes(' ') || text.includes('\n')) {
      const words = text.split(/[\s\n]+/).filter(w => w.length > 0);
      if (words.length > 1) {
        processMultipleWords(text, false);
      } else if (words.length === 1) {
        tryConfirmWord(words[0]);
      } else {
        setCurrentInput('');
      }
    } else {
      setCurrentInput(text.toLowerCase());
    }
  }, [invalidWord, processMultipleWords, tryConfirmWord]);

  const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Backspace' && currentInput === '' && confirmedWords.length > 0) {
      setConfirmedWords(prev => prev.slice(0, -1));
      setInvalidWord(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [currentInput, confirmedWords.length]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        processMultipleWords(text, true);
        inputRef.current?.focus();
        // Prompt clipboard clear for security
      }
    } catch (err) {
      // Silently fail
    }
  }, [processMultipleWords]);

  const handleClear = useCallback(() => {
    setConfirmedWords([]);
    setCurrentInput('');
    setInvalidWord(null);
    setError(null);
    setWrongSection(null);
    setWrongSectionDetection(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, []);

  const removeWord = useCallback((index: number) => {
    setConfirmedWords(prev => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  }, []);

  const toggleAdvanced = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAdvanced(!showAdvanced);
  }, [showAdvanced]);

  // Handle path selection from discovery card
  const handlePathSelect = useCallback((path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => {
    const newConfig: DerivationPathConfig = {
      preset: path,
      accountIndex: 0,
      addressIndex: 0,
    };
    setDerivationConfig(newConfig);
    if (isValidPhrase) {
      onPhraseValid(fullPhrase, newConfig);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [isValidPhrase, fullPhrase, onPhraseValid]);

  const secureProps = getSecureInputProps();

  // Calculate discovery summary
  const hasActivity = discoveryResults.some(r => r.balanceSats > 0 || r.usedAddressCount > 0);
  const totalBalanceSats = discoveryResults.reduce((sum, r) => sum + r.balanceSats, 0);

  return (
    <View style={styles.container}>
      {/* Label row */}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Recovery Phrase
        </Text>
        <View style={[
          styles.countBadge,
          isValidPhrase && styles.countBadgeValid,
          wordCount > 24 && styles.countBadgeWarning,
          {
            backgroundColor: isValidPhrase
              ? (isDark ? 'rgba(48,209,88,0.15)' : 'rgba(48,209,88,0.12)')
              : wordCount > 24
                ? (isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.10)')
                : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
          },
        ]}>
          <Text style={[
            styles.countText,
            {
              color: isValidPhrase ? '#30D158'
                : wordCount > 24 ? '#FF9F0A'
                  : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'),
            },
          ]}>
            {getWordCountDisplay()}
          </Text>
        </View>
      </View>

      {/* Chip container */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => inputRef.current?.focus()}
        style={[
          styles.chipContainer,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
            borderColor: isValidPhrase
              ? (isDark ? 'rgba(48,209,88,0.4)' : 'rgba(48,209,88,0.35)')
              : (error || invalidWord)
                ? (isDark ? 'rgba(255,107,107,0.4)' : 'rgba(220,53,69,0.35)')
                : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
          },
        ]}
      >
        <View style={styles.chipsWrapper}>
          {confirmedWords.map((word, index) => (
            <TouchableOpacity
              key={`${word}-${index}`}
              style={[styles.chip, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
              onPress={() => removeWord(index)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipIndex, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
                {index + 1}.
              </Text>
              <Text style={[styles.chipText, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                {word}
              </Text>
            </TouchableOpacity>
          ))}

          {wordCount < 24 && (
            <Animated.View style={[styles.inputWrapper, { transform: [{ translateX: shakeAnim }] }]}>
              <PremiumInput
                ref={inputRef}
                icon="text"
                iconColor="#007AFF"
                monospace
                style={[
                  styles.textInput,
                  { color: invalidWord ? '#FF453A' : (isDark ? '#FFFFFF' : '#000000') },
                ]}
                value={currentInput}
                onChangeText={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={wordCount === 0 ? 'Type or paste words...' : ''}
                placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => {
                  if (currentInput.trim()) tryConfirmWord(currentInput);
                }}
                {...secureProps}
              />
            </Animated.View>
          )}
        </View>

        {wordCount > 0 && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="close-circle"
              size={20}
              color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Error feedback */}
      {error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#FF453A" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {invalidWord && !error && !wrongSection && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#FF453A" />
          <Text style={styles.errorText}>"{invalidWord}" is not a valid BIP39 word</Text>
        </View>
      )}

      {/* Wrong section alert - show when pasted content belongs to another section */}
      {wrongSection && wrongSectionDetection && (
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
                This looks like a {wrongSectionDetection.label}
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
          onPress={onScanQR}
          activeOpacity={0.7}
        >
          <Ionicons name="qr-code-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
          <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Scan QR</Text>
        </TouchableOpacity>
      </View>

      {/* Advanced options */}
      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={toggleAdvanced}
        activeOpacity={0.7}
      >
        <Text style={[styles.advancedText, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>
          Advanced options (optional)
        </Text>
        <Ionicons
          name={showAdvanced ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
        />
      </TouchableOpacity>

      {showAdvanced && (
        <View style={styles.advancedContent}>
          <Text style={[styles.passphraseLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
            Optional Passphrase
          </Text>
          <Text style={[styles.passphraseDesc, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
            Only enter this if you used a passphrase when creating the wallet.
          </Text>
          <PremiumInputCard>
            <PremiumInput
              icon="key"
              iconColor="#FF9F0A"
              secureTextEntry
              placeholder="Enter passphrase"
              value={passphrase}
              onChangeText={setPassphrase}
              {...secureProps}
            />
          </PremiumInputCard>
        </View>
      )}

      {/* Path Discovery Card - shown when phrase is valid */}
      {isValidPhrase && discoveryResults.length > 0 && (
        <View style={styles.discoverySection}>
          <PathDiscoveryCard
            isDark={isDark}
            results={discoveryResults}
            isScanning={isDiscovering}
            hasActivity={hasActivity}
            totalBalanceSats={totalBalanceSats}
            onPathSelect={handlePathSelect}
          />
        </View>
      )}

      {/* Derivation Path Selector - shown when phrase is valid */}
      {isValidPhrase && (
        <View style={styles.derivationSection}>
          <DerivationPathSelector
            isDark={isDark}
            config={derivationConfig}
            onConfigChange={handleDerivationConfigChange}
          />
        </View>
      )}
    </View>
  );
}

export function getPassphrase(): string {
  return '';
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
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  countBadgeValid: {},
  countBadgeWarning: {},
  countText: { fontSize: 13, fontWeight: '500' },
  chipContainer: {
    borderRadius: 16,
    borderWidth: 1.5,
    minHeight: 140,
    padding: 12,
    position: 'relative',
  },
  chipsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingRight: 24,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  chipIndex: { fontSize: 12, fontWeight: '500' },
  chipText: { fontSize: 14, fontWeight: '500' },
  inputWrapper: { minWidth: 100, flexGrow: 1 },
  textInput: { fontSize: 14, padding: 6, minHeight: 32 },
  clearBtn: { position: 'absolute', top: 12, right: 12, padding: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  errorText: { fontSize: 14, color: '#FF453A', fontWeight: '500' },
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
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    marginTop: 10,
  },
  advancedText: { fontSize: 15, fontWeight: '500' },
  advancedContent: { paddingTop: 4, gap: 6 },
  passphraseLabel: { fontSize: 15, fontWeight: '600' },
  passphraseDesc: { fontSize: 13, lineHeight: 18 },
  passphraseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 8,
  },
  passphraseInput: { flex: 1, padding: 14, fontSize: 16 },
  eyeBtn: { padding: 14 },
  discoverySection: {
    marginTop: 20,
  },
  derivationSection: {
    marginTop: 20,
  },
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
