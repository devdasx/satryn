import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumInput, PremiumInputCard } from '../ui/PremiumInput';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
// Check if native module is available (for Expo Go compatibility)
function isNativeModuleError(error: any): boolean {
  const msg = error?.message || String(error) || '';
  return msg.includes('native module') ||
         msg.includes('ExpoDocumentPicker') ||
         msg.includes('Cannot read property') ||
         msg.includes('null is not an object') ||
         msg.includes('Cannot find native module');
}

// Lazy-loaded: native modules may not be in Expo Go
// We don't cache the result because the require might succeed but methods fail
function getDocumentPicker(): typeof import('expo-document-picker') | null {
  try {
    return require('expo-document-picker');
  } catch {
    return null;
  }
}

function getExpoFile(): typeof import('expo-file-system').File | null {
  try {
    return require('expo-file-system').File;
  } catch {
    return null;
  }
}
import { detectFileType, detectInputType } from '../../services/import/detector';
import { parseDescriptorExport } from '../../services/import/parsers/descriptor';
import { parseDumpwallet } from '../../services/import/parsers/dumpwallet';
import { parseElectrumFile } from '../../services/import/parsers/electrumFile';
import { getSecureInputProps } from '../../services/import/security';
import { PathDiscovery } from '../../services/import/PathDiscovery';
import { DetectedBadge } from './DetectedBadge';
import { WalletSettings } from './WalletSettings';
import { PathDiscoveryCard } from './PathDiscoveryCard';
import { ADDRESS_TYPES } from '../../constants';
import type { AddressType } from '../../types';
import type { DetectionResult, ImportResult, PathDiscoveryResult } from '../../services/import/types';

/** Maps detected format to recommended section */
type SuggestedSection = 'phrase' | 'key' | 'extended' | 'seed' | 'file';

interface FileSectionProps {
  isDark: boolean;
  onFileReady: (result: ImportResult, walletName: string, scriptType: AddressType) => void;
  onFileInvalid: () => void;
  /** Called when input is detected as belonging to another section */
  onSwitchSection?: (section: SuggestedSection, content: string) => void;
  /** Initial content to populate the input with (from section switch) */
  initialContent?: string | null;
}

export function FileSection({ isDark, onFileReady, onFileInvalid, onSwitchSection, initialContent }: FileSectionProps) {
  const [input, setInput] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('Imported Wallet');
  const [scriptType, setScriptType] = useState<AddressType>(ADDRESS_TYPES.NATIVE_SEGWIT);
  const [fileName, setFileName] = useState<string | null>(null);

  // Wrong section detection state
  const [wrongSection, setWrongSection] = useState<{
    suggestedSection: SuggestedSection;
    label: string;
  } | null>(null);
  const [wrongSectionDetection, setWrongSectionDetection] = useState<DetectionResult | null>(null);

  // Path discovery state
  const [discoveryResults, setDiscoveryResults] = useState<PathDiscoveryResult[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryHasActivity, setDiscoveryHasActivity] = useState(false);
  const [discoveryTotalBalance, setDiscoveryTotalBalance] = useState(0);

  const secureProps = getSecureInputProps();

  // Populate input from initialContent when switching from another section
  useEffect(() => {
    if (initialContent && initialContent.trim()) {
      setInput(initialContent);
      setFileName(null);
      tryParse(initialContent, null);
    }
  }, [initialContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run path discovery based on parsed file content type
  useEffect(() => {
    // Clear discovery if no parse result
    if (!parseResult) {
      setDiscoveryResults([]);
      setIsDiscovering(false);
      setDiscoveryHasActivity(false);
      setDiscoveryTotalBalance(0);
      return;
    }

    // Determine if we can run discovery based on the parse result
    // Only run for HD-capable material (mnemonic, xprv, WIF keys)
    const canDiscover = parseResult.mnemonic || parseResult.xprv ||
      (parseResult.keys && parseResult.keys.length > 0 && parseResult.keys[0].wif);

    if (!canDiscover || parseResult.type === 'watch_only') {
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
        let result;

        if (parseResult.mnemonic) {
          // Mnemonic-based discovery
          result = await PathDiscovery.discoverHD(
            { type: 'mnemonic', mnemonic: parseResult.mnemonic, passphrase: parseResult.passphrase },
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
        } else if (parseResult.xprv) {
          // xprv-based discovery
          result = await PathDiscovery.discoverHD(
            { type: 'xprv', xprv: parseResult.xprv },
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
        } else if (parseResult.keys && parseResult.keys.length > 0) {
          // For WIF keys, only discover the first one (files with many keys won't benefit from discovery)
          const firstKey = parseResult.keys[0];
          result = await PathDiscovery.discoverWIF(
            firstKey.wif,
            firstKey.compressed,
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
        }

        if (result && !cancelRef.current) {
          setDiscoveryHasActivity(result.hasActivity);
          setDiscoveryTotalBalance(result.totalBalanceSats);
          if (result.hasActivity && result.totalBalanceSats > 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch (error) {
        // Silently handle discovery errors
        console.log('[FileSection] Discovery error:', error);
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
  }, [parseResult]);

  // Handle switching to the correct section when wrong input is detected
  const handleSwitchToCorrectSection = useCallback(() => {
    if (wrongSection && onSwitchSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSwitchSection(wrongSection.suggestedSection, input);
      // Clear input after switching
      setInput('');
      setDetection(null);
      setParseResult(null);
      setParseError(null);
      setFileName(null);
      setWrongSection(null);
      setWrongSectionDetection(null);
    }
  }, [wrongSection, onSwitchSection, input]);

  // Handle path selection from discovery card
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
      onFileReady(parseResult, walletName, newType);
    }
  }, [parseResult, walletName, onFileReady]);

  const tryParse = useCallback((text: string, name: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setDetection(null);
      setParseResult(null);
      setParseError(null);
      setWrongSection(null);
      setWrongSectionDetection(null);
      onFileInvalid();
      return;
    }

    // First, detect file type
    const detected = detectFileType(trimmed, name || undefined);
    setDetection(detected);

    // If not a valid file format, check if it belongs to another section
    if (!detected) {
      const inputDetected = detectInputType(trimmed);
      setWrongSectionDetection(inputDetected);

      if (inputDetected) {
        // Check if this input belongs to a different section
        let suggestedSection: SuggestedSection | null = null;
        let sectionLabel = '';

        if (inputDetected.format === 'bip39_mnemonic') {
          suggestedSection = 'phrase';
          sectionLabel = 'Phrase';
        } else if (['wif_compressed', 'wif_uncompressed', 'hex_privkey', 'mini_privkey', 'base64_privkey', 'decimal_privkey'].includes(inputDetected.format)) {
          suggestedSection = 'key';
          sectionLabel = 'Key';
        } else if (['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'].includes(inputDetected.format)) {
          suggestedSection = 'extended';
          sectionLabel = 'xprv';
        } else if (['seed_bytes_hex'].includes(inputDetected.format)) {
          suggestedSection = 'seed';
          sectionLabel = 'Seed';
        }

        if (suggestedSection) {
          setWrongSection({ suggestedSection, label: sectionLabel });
          setParseResult(null);
          setParseError(null);
          onFileInvalid();
          return;
        }
      }

      // Not detected as belonging to another section either
      setWrongSection(null);
      setParseResult(null);
      setParseError('Could not detect file format. Supported: descriptors, dumpwallet, Electrum JSON.');
      onFileInvalid();
      return;
    }

    // Valid file format - clear wrong section state
    setWrongSection(null);
    setWrongSectionDetection(null);

    if (!detected.isMainnet) {
      setParseResult(null);
      setParseError('Testnet files are not supported. This app is mainnet only.');
      onFileInvalid();
      return;
    }

    try {
      let result: ImportResult;

      switch (detected.format) {
        case 'descriptor_set':
          result = parseDescriptorExport(trimmed);
          break;
        case 'dumpwallet':
          result = parseDumpwallet(trimmed);
          break;
        case 'electrum_json':
          result = parseElectrumFile(trimmed);
          break;
        default:
          throw new Error(`Unsupported format: ${detected.format}`);
      }

      setParseResult(result);
      setParseError(null);

      const autoName = result.suggestedName || 'Imported Wallet';
      setWalletName(autoName);

      onFileReady(result, autoName, scriptType);
    } catch (err) {
      setParseResult(null);
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
      onFileInvalid();
    }
  }, [onFileReady, onFileInvalid, scriptType]);

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setFileName(null);
    tryParse(text, null);
  }, [tryParse]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setInput(text.trim());
        setFileName(null);
        tryParse(text.trim(), null);
      }
    } catch {
      // Silently fail
    }
  }, [tryParse]);

  const handlePickFile = useCallback(async () => {
    // Wrap everything in try-catch because even require() can throw in Expo Go
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

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

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
      tryParse(content, asset.name);
    } catch (err: any) {
      // Check for native module error (Expo Go limitation)
      if (isNativeModuleError(err)) {
        Alert.alert('Not Available', 'File picker requires a development build. Use paste instead.');
      } else {
        setParseError('Failed to read file');
        onFileInvalid();
      }
    }
  }, [tryParse, onFileInvalid]);

  const handleClear = useCallback(() => {
    setInput('');
    setDetection(null);
    setParseResult(null);
    setParseError(null);
    setFileName(null);
    setWrongSection(null);
    setWrongSectionDetection(null);
    onFileInvalid();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [onFileInvalid]);

  const handleNameChange = useCallback((name: string) => {
    setWalletName(name);
    if (parseResult) {
      onFileReady(parseResult, name, scriptType);
    }
  }, [parseResult, onFileReady, scriptType]);

  const handleScriptTypeChange = useCallback((type: AddressType) => {
    setScriptType(type);
    if (parseResult) {
      onFileReady(parseResult, walletName, type);
    }
  }, [parseResult, onFileReady, walletName]);

  // Summary card for parsed results
  const renderSummary = () => {
    if (!parseResult) return null;

    const items: { label: string; value: string }[] = [];

    if (parseResult.sourceFormat === 'dumpwallet' && parseResult.keys) {
      items.push({ label: 'Keys Found', value: `${parseResult.keys.length}` });
      if (parseResult.xprv) {
        items.push({ label: 'HD Master Key', value: 'Present' });
      }
    }

    if (parseResult.sourceFormat === 'descriptor_set' && parseResult.descriptors) {
      items.push({ label: 'Descriptors', value: `${parseResult.descriptors.length}` });
      if (parseResult.fingerprint) {
        items.push({ label: 'Fingerprint', value: parseResult.fingerprint });
      }
    }

    if (parseResult.sourceFormat === 'electrum_json') {
      if (parseResult.type === 'watch_only') {
        items.push({ label: 'Type', value: 'Watch-Only' });
        if (parseResult.xpub) {
          const truncated = parseResult.xpub.slice(0, 8) + '...' + parseResult.xpub.slice(-8);
          items.push({ label: 'Extended Public Key', value: truncated });
        }
      } else if (parseResult.mnemonic) {
        items.push({ label: 'Type', value: 'Seed-based' });
      } else if (parseResult.xprv) {
        items.push({ label: 'Type', value: 'Extended key' });
      } else if (parseResult.keys) {
        items.push({ label: 'Type', value: `${parseResult.keys.length} imported keys` });
      }
    }

    if (parseResult.previewAddress) {
      items.push({ label: 'Preview Address', value: parseResult.previewAddress });
    }

    if (items.length === 0) return null;

    return (
      <View style={[styles.summaryCard, { backgroundColor: isDark ? '#161618' : '#F5F5F7' }]}>
        <Text style={[styles.summaryTitle, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }]}>
          Parsed Summary
        </Text>
        {items.map((item, i) => (
          <View key={i}>
            {i > 0 && (
              <View style={[styles.divider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]} />
            )}
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }]}>
                {item.label}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  {
                    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                  },
                ]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {item.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          File Import
        </Text>
        {detection && <DetectedBadge detection={detection} isDark={isDark} />}
      </View>

      {/* File name indicator */}
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

      {/* Text input (for paste) */}
      {!fileName && (
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
            icon="document"
            iconColor="#FF9F0A"
            monospace
            multiline
            style={[
              styles.fileInput,
              { color: isDark ? '#FFFFFF' : '#000000' },
            ]}
            value={input}
            onChangeText={handleInputChange}
            placeholder="Paste descriptors, dumpwallet output, or Electrum JSON..."
            placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
            numberOfLines={6}
            {...secureProps}
          />
          {input.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="close-circle"
                size={20}
                color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

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
          onPress={handlePickFile}
          activeOpacity={0.7}
        >
          <Ionicons name="folder-open-outline" size={18} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} />
          <Text style={[styles.actionText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>Choose File</Text>
        </TouchableOpacity>
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

      {/* Hints */}
      {!input && !fileName && (
        <View style={[styles.hintCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
          <Text style={[styles.hintTitle, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }]}>
            Supported File Formats
          </Text>
          <Text style={[styles.hintText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            {'\u2022'} Bitcoin Core descriptors (listdescriptors true){'\n'}
            {'\u2022'} Bitcoin Core dumpwallet output{'\n'}
            {'\u2022'} Electrum wallet JSON file
          </Text>
          <Text style={[styles.hintNote, { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)' }]}>
            Choose a file or paste the content directly.
          </Text>
        </View>
      )}

      {/* Summary */}
      {renderSummary()}

      {/* Path Discovery Card - shows balance/activity scanning for HD material from files */}
      {parseResult && parseResult.type !== 'watch_only' && (parseResult.mnemonic || parseResult.xprv || parseResult.keys) && (
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

      {/* Settings - only show when file is valid (not wrong section) */}
      {parseResult && !wrongSection && (
        <View style={styles.settingsSection}>
          <WalletSettings
            walletName={walletName}
            onNameChange={handleNameChange}
            scriptType={scriptType}
            onScriptTypeChange={handleScriptTypeChange}
            isDark={isDark}
            showScriptType={parseResult.type === 'hd'}
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
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
  },
  fileNameText: { flex: 1, fontSize: 14, fontWeight: '500' },
  inputContainer: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    minHeight: 140,
    position: 'relative',
  },
  fileInput: {
    fontSize: 13,
    lineHeight: 18,
    paddingRight: 32,
    minHeight: 116,
    textAlignVertical: 'top',
  },
  clearBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
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
    flex: 1,
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
  summaryCard: {
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
    gap: 0,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryRow: {
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
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
});
