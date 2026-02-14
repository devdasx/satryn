import '../../shim';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  useColorScheme,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { QRScanner } from '../../src/components/scanner';
import { AppBottomSheet, KeyboardSafeBottomBar } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME, getThemeColors, ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';

interface Cosigner {
  id: string;
  name: string;
  xpub: string;
  fingerprint: string;
  isLocal: boolean;
  localIndex?: number; // For tracking multiple local signers
  seedHash?: string; // Hash of seed phrase for duplicate detection (not the actual seed)
}

const DEFAULT_WALLET_NAME = 'Multisig Wallet';

// Simple xpub validation (basic format check)
const isValidXpub = (xpub: string): boolean => {
  const trimmed = xpub.trim();
  // Check for common xpub prefixes and minimum length
  const validPrefixes = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub', 'tpub', 'upub', 'vpub'];
  const hasValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));
  return hasValidPrefix && trimmed.length >= 100;
};

// Generate a unique fingerprint for local signers (in real app, this would be derived from actual keys)
const generateLocalFingerprint = (index: number): string => {
  const chars = 'ABCDEF0123456789';
  let fingerprint = '';
  // Use index as seed for reproducible but unique fingerprints
  const seed = (index + 1) * 7919; // Prime number for better distribution
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

export default function MultisigAddCosignerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name: string; m: string; n: string; scriptType: string }>();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Get theme setting from store to respect app's theme preference
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  const requiredSigners = parseInt(params.n || '3', 10);
  const requiredSigs = parseInt(params.m || '2', 10);
  const walletName = params.name || DEFAULT_WALLET_NAME;

  const [cosigners, setCosigners] = useState<Cosigner[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sheetMode, setSheetMode] = useState<'default' | 'import-seed'>('default');
  const [xpubInput, setXpubInput] = useState('');
  const [cosignerName, setCosignerName] = useState('');
  const [xpubError, setXpubError] = useState<string | null>(null);
  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [importSignerName, setImportSignerName] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [detailCosigner, setDetailCosigner] = useState<Cosigner | null>(null);

  // Derive local signer count from actual cosigners (not a separate counter)
  const localSignerCount = useMemo(() =>
    cosigners.filter(c => c.isLocal).length,
    [cosigners]
  );

  // Create dynamic styles
  const styles = createStyles(colors, isDark);


  // Validate xpub on change - check format and duplicates
  useEffect(() => {
    if (xpubInput.trim().length > 0) {
      if (!isValidXpub(xpubInput)) {
        setXpubError('Invalid xpub format');
      } else {
        // Check for duplicate xpub
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

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleAddThisDevice = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Find the next available index by looking at max existing localIndex + 1
    const existingLocalIndices = cosigners
      .filter(c => c.isLocal && c.localIndex !== undefined)
      .map(c => c.localIndex as number);
    const nextIndex = existingLocalIndices.length > 0
      ? Math.max(...existingLocalIndices) + 1
      : 1;

    const fingerprint = generateLocalFingerprint(nextIndex);

    // Check for duplicate fingerprint (shouldn't happen with proper generation, but safety check)
    if (cosigners.some(c => c.fingerprint === fingerprint)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Could not generate unique signer. Please try again.');
      return;
    }

    const newCosigner: Cosigner = {
      id: `local-${Date.now()}-${nextIndex}`,
      name: `Local Signer ${nextIndex}`,
      xpub: `xpub_local_${nextIndex}...`, // Would be derived from actual wallet with different derivation path
      fingerprint: fingerprint,
      isLocal: true,
      localIndex: nextIndex,
    };

    setCosigners([...cosigners, newCosigner]);
    setShowAddModal(false);
  }, [cosigners]);

  const handleAddFromXpub = useCallback(() => {
    if (!xpubInput.trim() || !cosignerName.trim() || xpubError) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newCosigner: Cosigner = {
      id: `ext-${Date.now()}`,
      name: cosignerName.trim(),
      xpub: xpubInput.trim().substring(0, 20) + '...',
      fingerprint: xpubInput.trim().substring(4, 12).toUpperCase(),
      isLocal: false,
    };
    setCosigners([...cosigners, newCosigner]);
    setXpubInput('');
    setCosignerName('');
    setXpubError(null);
    setShowAddModal(false);
  }, [xpubInput, cosignerName, xpubError, cosigners]);

  // Validate seed phrase (basic word count check)
  const isValidSeedPhrase = useCallback((phrase: string): boolean => {
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return words.length === 12 || words.length === 24;
  }, []);

  // Handle adding local signer from imported seed
  const handleAddFromSeed = useCallback(() => {
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

    // Check for duplicate seed phrase
    const seedHash = generateSeedHash(seedPhraseInput);
    const isDuplicateSeed = cosigners.some(c => c.seedHash === seedHash);
    if (isDuplicateSeed) {
      setSeedError('This seed phrase has already been added');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Find next available index
    const existingLocalIndices = cosigners
      .filter(c => c.isLocal && c.localIndex !== undefined)
      .map(c => c.localIndex as number);
    const nextIndex = existingLocalIndices.length > 0
      ? Math.max(...existingLocalIndices) + 1
      : 1;

    // Generate fingerprint (in real app, derive from actual seed's master key)
    // Use a different seed for imported keys to differentiate from created keys
    const fingerprint = generateLocalFingerprint(nextIndex + 100);

    const signerName = importSignerName.trim() || `Imported Key ${nextIndex}`;

    const newCosigner: Cosigner = {
      id: `imported-${Date.now()}-${nextIndex}`,
      name: signerName,
      xpub: `xpub_imported_${nextIndex}...`, // Would be derived from seed
      fingerprint: fingerprint,
      isLocal: true,
      localIndex: nextIndex,
      seedHash: seedHash, // Store hash for duplicate detection
    };

    setCosigners([...cosigners, newCosigner]);
    setSeedPhraseInput('');
    setImportSignerName('');
    setSeedError(null);
    setSheetMode('default');
    setShowAddModal(false);
  }, [seedPhraseInput, importSignerName, cosigners, isValidSeedPhrase]);

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

  const handleOpenScanner = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Close the sheet first, then open scanner to avoid nested modal issues
    setShowAddModal(false);
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
      // Try to extract xpub from various formats
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

  const handleOpenModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowAddModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowAddModal(false);
    setSheetMode('default');
    setXpubInput('');
    setCosignerName('');
    setXpubError(null);
    setSeedPhraseInput('');
    setImportSignerName('');
    setSeedError(null);
  }, []);

  const handleNext = useCallback(() => {
    if (cosigners.length !== requiredSigners) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/(auth)/multisig-review',
      params: {
        ...params,
        cosigners: JSON.stringify(cosigners),
      },
    });
  }, [cosigners, requiredSigners, params, router]);

  const canAddMore = cosigners.length < requiredSigners;
  const isXpubFormValid = cosignerName.trim().length > 0 && xpubInput.trim().length > 0 && !xpubError;

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header - matches Create Wallet pattern */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBackButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.stepIndicatorText}>Step 2 of 3</Text>
        <View style={styles.headerBackButton} />
      </View>

      <View style={styles.scrollWrapper}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Status Card */}
          <View style={styles.statusCard}>
            {Platform.OS === 'ios' && (
              <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.statusIconContainer}>
              <Ionicons name="people" size={22} color={isDark ? '#FFFFFF' : THEME.brand.bitcoin} />
            </View>
            <View style={styles.statusInfo}>
              <Text style={styles.statusText}>
                <Text style={styles.statusHighlight}>{cosigners.length}</Text>
                {' of '}
                <Text style={styles.statusHighlight}>{requiredSigners}</Text>
                {' signers added'}
              </Text>
              <Text style={styles.walletNameText}>{walletName} • {requiredSigs}-of-{requiredSigners} policy</Text>
            </View>
          </View>

          {/* Signers Section */}
          <Text style={styles.sectionTitle}>SIGNERS</Text>

          {cosigners.length === 0 ? (
            <View style={styles.emptyState}>
              {Platform.OS === 'ios' && (
                <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              )}
              <View style={styles.emptyRings}>
                <View style={[styles.emptyRing3, {
                  borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
                }]} />
                <View style={[styles.emptyRing2, {
                  borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                }]} />
                <View style={[styles.emptyIconCircle, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
                }]}>
                  <Ionicons name="people-outline" size={24} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
                </View>
              </View>
              <Text style={styles.emptyStateTitle}>No signers yet</Text>
              <Text style={styles.emptyStateText}>
                Tap below to add your first signer.
              </Text>
            </View>
          ) : (
            <View style={styles.cosignersList}>
              {cosigners.map((cosigner) => (
                <TouchableOpacity
                  key={cosigner.id}
                  style={styles.cosignerCard}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setDetailCosigner(cosigner);
                  }}
                  activeOpacity={0.7}
                >
                  {Platform.OS === 'ios' && (
                    <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                  )}
                  <View style={[
                    styles.cosignerIconContainer,
                    cosigner.isLocal && styles.cosignerIconLocal,
                  ]}>
                    <Ionicons
                      name={cosigner.isLocal ? 'phone-portrait' : 'person'}
                      size={18}
                      color={isDark ? '#FFFFFF' : (cosigner.isLocal ? THEME.brand.bitcoin : colors.text)}
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
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Add Button */}
          {canAddMore && (
            <View style={styles.addSection}>
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleOpenModal}
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

          {/* Spacer for fixed footer */}
          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>

      {/* CTA - Keyboard Safe Footer */}
      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            cosigners.length !== requiredSigners && styles.primaryButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={cosigners.length !== requiredSigners}
          activeOpacity={0.85}
        >
          <Text style={[
            styles.primaryButtonText,
            cosigners.length !== requiredSigners && styles.primaryButtonTextDisabled,
          ]}>
            Continue
          </Text>
        </TouchableOpacity>
      </KeyboardSafeBottomBar>

      {/* Add Cosigner Sheet */}
      <AppBottomSheet
        visible={showAddModal}
        onClose={handleCloseModal}
        title="Add Signer"
        subtitle="Choose how to add a new signing key"
        showCloseButton={true}
        sizing="large"
        scrollable={true}
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
                    {Platform.OS === 'ios' && (
                      <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                    )}
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
                    {Platform.OS === 'ios' && (
                      <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                    )}
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

      {/* QR Scanner */}
      <QRScanner
        visible={showScanner}
        onClose={handleCloseScanner}
        onScan={(data) => handleBarCodeScanned({ data })}
        title="Scan xpub"
        subtitle="Point camera at an extended public key QR code"
      />

      {/* Signer Detail Sheet */}
      <AppBottomSheet
        visible={!!detailCosigner}
        onClose={() => setDetailCosigner(null)}
        title={detailCosigner?.name || 'Signer Details'}
        subtitle={detailCosigner?.isLocal ? 'Local signer on this device' : 'External signer'}
        sizing="auto"
      >
        {detailCosigner && (
          <View style={styles.detailSheetContent}>
            {/* Fingerprint */}
            <View style={styles.detailRow}>
              <View style={styles.detailIconWrap}>
                <Ionicons name="finger-print" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.detailInfo}>
                <Text style={styles.detailLabel}>Fingerprint</Text>
                <Text style={styles.detailValue}>{detailCosigner.fingerprint}</Text>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  await Clipboard.setStringAsync(detailCosigner.fingerprint);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
                style={styles.detailCopyBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="copy-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Extended Public Key */}
            <View style={styles.detailRow}>
              <View style={styles.detailIconWrap}>
                <Ionicons name="key-outline" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.detailInfo}>
                <Text style={styles.detailLabel}>Extended Public Key</Text>
                <Text style={styles.detailValue} numberOfLines={2} ellipsizeMode="middle">
                  {detailCosigner.xpub}
                </Text>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  await Clipboard.setStringAsync(detailCosigner.xpub);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
                style={styles.detailCopyBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="copy-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Type */}
            <View style={styles.detailRow}>
              <View style={styles.detailIconWrap}>
                <Ionicons name={detailCosigner.isLocal ? 'phone-portrait-outline' : 'hardware-chip-outline'} size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.detailInfo}>
                <Text style={styles.detailLabel}>Type</Text>
                <Text style={styles.detailValue}>
                  {detailCosigner.isLocal ? 'Local Key (this device)' : 'External Signer'}
                </Text>
              </View>
            </View>

            {/* Seed Hash indicator for imported keys */}
            {detailCosigner.isLocal && detailCosigner.seedHash && (
              <View style={styles.detailRow}>
                <View style={styles.detailIconWrap}>
                  <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Origin</Text>
                  <Text style={styles.detailValue}>Imported from seed phrase</Text>
                </View>
              </View>
            )}

            {detailCosigner.isLocal && !detailCosigner.seedHash && (
              <View style={styles.detailRow}>
                <View style={styles.detailIconWrap}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Origin</Text>
                  <Text style={styles.detailValue}>Generated on this device</Text>
                </View>
              </View>
            )}

            {/* Remove button */}
            <TouchableOpacity
              style={styles.detailRemoveBtn}
              onPress={() => {
                const cosigner = detailCosigner;
                setDetailCosigner(null);
                setTimeout(() => handleRemoveCosigner(cosigner), 300);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color="#FF453A" />
              <Text style={styles.detailRemoveText}>Remove Signer</Text>
            </TouchableOpacity>
          </View>
        )}
      </AppBottomSheet>
    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header - matches Create Wallet pattern exactly
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

  // Scroll
  scrollWrapper: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  // Status Card
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 28,
    overflow: 'hidden' as const,
  },
  statusIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: isDark ? colors.glassMedium : THEME.brand.bitcoinSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  statusInfo: {
    flex: 1,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  statusHighlight: {
    fontWeight: '700',
    color: colors.text,
  },
  walletNameText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
  },

  // Section
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 16,
  },

  // Empty State
  emptyState: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: isDark ? colors.glassLight : 'rgba(255,255,255,0.45)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: isDark ? colors.borderLight : 'rgba(0,0,0,0.10)',
    marginBottom: 16,
    overflow: 'hidden' as const,
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
  },
  emptyRing2: {
    position: 'absolute' as const,
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
    padding: 16,
    borderRadius: 14,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.borderLight : 'rgba(0,0,0,0.10)',
    overflow: 'hidden' as const,
  },
  cosignerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cosignerIconLocal: {
    backgroundColor: isDark ? colors.glassStrong : THEME.brand.bitcoinSoft,
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
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  cosignerBadgeLocal: {
    backgroundColor: isDark ? colors.glassStrong : THEME.brand.bitcoinSoft,
  },
  cosignerBadgeExternal: {
    backgroundColor: colors.glassMedium,
  },
  cosignerBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
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

  bottomSpacer: {
    height: 120,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    backgroundColor: isDark ? THEME.brand.bitcoin : colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: colors.glassMedium,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  primaryButtonTextDisabled: {
    color: colors.textMuted,
  },

  // Sheet Content Styles
  sheetScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },

  // Device Row (This Device)
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderRadius: 12,
    marginBottom: 20,
  },
  deviceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  deviceSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  deviceAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Divider
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    marginBottom: 20,
  },

  // Section Label
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
  sheetBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  sheetBackText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  seedInput: {
    minHeight: 100,
  },
  seedWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
  },
  seedWarningText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Input Group
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

  // Sheet Footer
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    backgroundColor: colors.background,
  },
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

  // ===== PREMIUM SHEET STYLES =====

  // Section Blocks
  sectionBlock: {
    marginBottom: 32,
  },
  sectionBlockExternal: {
    paddingTop: 28,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: -10,
    marginBottom: 18,
    lineHeight: 20,
  },

  // Action Cards
  actionCardsContainer: {
    gap: 12,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(247,147,26,0.12)' : 'rgba(255,255,255,0.45)',
    borderWidth: 1.5,
    borderColor: isDark ? 'rgba(247,147,26,0.25)' : 'rgba(0,0,0,0.10)',
    overflow: 'hidden' as const,
  },
  actionCardSecondary: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
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
    marginBottom: 2,
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
    gap: 6,
    marginTop: 12,
    justifyContent: 'center',
  },
  localKeysStatusText: {
    fontSize: 13,
    color: colors.success,
    fontWeight: '500',
  },

  // External Form
  inputError: {
    borderColor: colors.error,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
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
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
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
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalCtaDisabled: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  externalCtaText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  externalCtaTextDisabled: {
    color: colors.textMuted,
  },

  // Import Sheet - Back Button
  sheetBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 8,
    paddingVertical: 4,
    paddingRight: 8,
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
    gap: 8,
    justifyContent: 'center',
    marginBottom: 20,
  },
  securityNoticeText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // Import CTA
  importCta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: isDark ? THEME.brand.bitcoin : colors.text,
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
  },
  importCtaTextDisabled: {
    color: colors.textMuted,
  },

  // Signer Detail Sheet
  detailSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  detailIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailInfo: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  detailCopyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.05)',
  },
  detailRemoveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF453A',
  },

});
