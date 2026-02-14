import '../../shim';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { PinCodeScreen } from '../../src/components/security';
import { useWalletStore, useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { useTheme, useHaptics, useScreenSecurity } from '../../src/hooks';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SeedGenerator } from '../../src/core/wallet/SeedGenerator';
import { KeyDerivation } from '../../src/core/wallet/KeyDerivation';
import { createMultisigDescriptor } from '../../src/utils/descriptor';
import { WalletDatabase } from '../../src/services/database';

// ─── Types ──────────────────────────────────────────────────────

type ViewState = 'verify' | 'display';
type DescriptorType = 'nativeSegwit' | 'wrappedSegwit' | 'legacy';

interface DescriptorData {
  receive: string;
  change: string;
}

// ─── Constants ──────────────────────────────────────────────────

const TYPE_LABELS: Record<DescriptorType, { label: string; format: string }> = {
  nativeSegwit: { label: 'Native SegWit', format: 'wpkh()' },
  wrappedSegwit: { label: 'Wrapped SegWit', format: 'sh(wpkh())' },
  legacy: { label: 'Legacy', format: 'pkh()' },
};

const FORMAT_INFO = [
  { code: 'wpkh()', desc: 'Native SegWit (P2WPKH) — bc1q addresses' },
  { code: 'sh(wpkh())', desc: 'Wrapped SegWit (P2SH-P2WPKH) — 3... addresses' },
  { code: 'pkh()', desc: 'Legacy (P2PKH) — 1... addresses' },
];

const MULTISIG_FORMAT_INFO = [
  { code: 'wsh(sortedmulti())', desc: 'Native SegWit Multisig (P2WSH) — bc1q addresses' },
  { code: 'sh(wsh(sortedmulti()))', desc: 'Wrapped SegWit Multisig (P2SH-P2WSH) — 3... addresses' },
  { code: 'sh(sortedmulti())', desc: 'Legacy Multisig (P2SH) — 3... addresses' },
];

// ─── Component ──────────────────────────────────────────────────

export default function DescriptorsScreen() {
  useScreenSecurity(); // Prevent screenshots/recording while descriptors are displayed
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const isMultisig = useWalletStore(s => s.isMultisig);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const getMultisigScriptTypeLabel = useWalletStore(s => s.getMultisigScriptTypeLabel);
  const biometricsEnabled = useSettingsStore(s => s.biometricsEnabled);
  const activeWallet = useMultiWalletStore((s) => s.getActiveWallet());
  const isWatchOnly = activeWallet?.type === 'watch_xpub' || activeWallet?.type === 'watch_descriptor' || activeWallet?.type === 'watch_addresses';

  // ─── Auth State ──────────────────────
  const sessionPin = SensitiveSession.getPin();
  const [viewState, setViewState] = useState<ViewState>(
    isMultisig || isWatchOnly || sessionPin ? 'display' : 'verify',
  );
  const autoAuthAttempted = useRef(false);

  // ─── Data State ──────────────────────
  const [selectedType, setSelectedType] = useState<DescriptorType>('nativeSegwit');
  const [descriptors, setDescriptors] = useState<{
    nativeSegwit: DescriptorData;
    wrappedSegwit: DescriptorData;
    legacy: DescriptorData;
  } | null>(null);
  const [masterFingerprint, setMasterFingerprint] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedReceive, setExpandedReceive] = useState(false);
  const [expandedChange, setExpandedChange] = useState(false);

  // ─── Derived design tokens ──────────────────────
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const codeBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Multisig descriptors generated from config cosigner data
  const multisigDescriptors = isMultisig && multisigConfig && multisigConfig.cosigners.length > 0
    ? (() => {
        const keys = multisigConfig.cosigners.map(c => ({
          fingerprint: c.fingerprint,
          derivationPath: c.derivationPath,
          xpub: c.xpub,
        }));
        const scriptType = multisigConfig.scriptType as 'p2sh' | 'p2wsh' | 'p2sh-p2wsh';
        return {
          receive: createMultisigDescriptor(multisigConfig.m, keys, scriptType, true, 0),
          change: createMultisigDescriptor(multisigConfig.m, keys, scriptType, true, 1),
        };
      })()
    : null;

  // ─── Load cached descriptors from database ──────────────────────
  useEffect(() => {
    if (isMultisig) return;
    const walletId = activeWallet?.id;
    if (!walletId) return;

    // Try DB cache first — no PIN needed
    try {
      const db = WalletDatabase.shared();
      const dbDescriptors = db.getDescriptors(walletId);
      if (dbDescriptors && dbDescriptors.length >= 6) {
        const entries = dbDescriptors.map(d => ({
          descriptor: d.descriptor,
          internal: d.internal === 1,
          scriptType: undefined as string | undefined,
        }));
        const cached = descriptorEntriesToDescriptorData(entries);
        if (cached) {
          setDescriptors(cached.descriptors);
          const wallet = db.getWallet(walletId);
          setMasterFingerprint(wallet?.fingerprint || '');
          return; // Cache hit — skip derivation
        }
      }
    } catch {}

    // No cache — derive from seed if PIN available
    if (autoAuthAttempted.current) return;
    if (!sessionPin) {
      setViewState('verify');
      return;
    }
    autoAuthAttempted.current = true;
    (async () => {
      const result = await deriveDescriptors(sessionPin, walletId);
      if (result) {
        setDescriptors(result.descriptors);
        setMasterFingerprint(result.fingerprint);
      }
    })();
  }, []);

  // ─── Convert V2 DescriptorEntry[] to screen DescriptorData ──────────────────────
  const descriptorEntriesToDescriptorData = (entries: { descriptor: string; internal: boolean; scriptType?: string }[]): {
    descriptors: { nativeSegwit: DescriptorData; wrappedSegwit: DescriptorData; legacy: DescriptorData };
  } | null => {
    const grouped: Record<string, { receive?: string; change?: string }> = {};
    for (const e of entries) {
      let scriptKey: string | null = null;
      if (e.descriptor.startsWith('wpkh(')) scriptKey = 'nativeSegwit';
      else if (e.descriptor.startsWith('sh(wpkh(')) scriptKey = 'wrappedSegwit';
      else if (e.descriptor.startsWith('pkh(')) scriptKey = 'legacy';
      else if (e.descriptor.startsWith('tr(')) scriptKey = 'taproot';
      if (!scriptKey || scriptKey === 'taproot') continue;
      if (!grouped[scriptKey]) grouped[scriptKey] = {};
      if (e.internal) grouped[scriptKey].change = e.descriptor;
      else grouped[scriptKey].receive = e.descriptor;
    }
    const ns = grouped['nativeSegwit'];
    const ws = grouped['wrappedSegwit'];
    const lg = grouped['legacy'];
    if (!ns?.receive || !ns?.change || !ws?.receive || !ws?.change || !lg?.receive || !lg?.change) return null;
    return {
      descriptors: {
        nativeSegwit: { receive: ns.receive, change: ns.change },
        wrappedSegwit: { receive: ws.receive, change: ws.change },
        legacy: { receive: lg.receive, change: lg.change },
      },
    };
  };

  // ─── Key Derivation (+ persist to DB) ──────────────────────
  const deriveDescriptors = async (pin: string, walletId?: string) => {
    const mnemonic = await SecureStorage.retrieveSeed(pin);
    if (!mnemonic) return null;
    const seed = await SeedGenerator.toSeed(mnemonic);
    const keyDerivation = new KeyDerivation(seed, network);
    const allDescriptors = keyDerivation.getAllOutputDescriptors(0);
    const fingerprint = keyDerivation.getMasterFingerprint();
    keyDerivation.destroy();

    if (walletId) {
      try {
        const db = WalletDatabase.shared();
        const descriptorRows = [
          { walletId, descriptor: allDescriptors.nativeSegwit.receive, isRange: 1 as const, checksum: null, internal: 0 as const },
          { walletId, descriptor: allDescriptors.nativeSegwit.change, isRange: 1 as const, checksum: null, internal: 1 as const },
          { walletId, descriptor: allDescriptors.wrappedSegwit.receive, isRange: 1 as const, checksum: null, internal: 0 as const },
          { walletId, descriptor: allDescriptors.wrappedSegwit.change, isRange: 1 as const, checksum: null, internal: 1 as const },
          { walletId, descriptor: allDescriptors.legacy.receive, isRange: 1 as const, checksum: null, internal: 0 as const },
          { walletId, descriptor: allDescriptors.legacy.change, isRange: 1 as const, checksum: null, internal: 1 as const },
        ];
        db.insertDescriptors(descriptorRows);
      } catch (e) {
        // DB persist error
      }
    }

    return { descriptors: allDescriptors, fingerprint };
  };

  const handleVerify = async (pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const isValid = await SecureStorage.verifyPin(pin);
      if (isValid) {
        SensitiveSession.start(pin);
        return { success: true };
      }
      return { success: false, error: 'Incorrect PIN' };
    } catch (err) {
      return { success: false, error: 'Failed to verify PIN' };
    }
  };

  const handleBiometricSuccess = async (): Promise<{ success: boolean; pin?: string }> => {
    try {
      const pin = await SecureStorage.getPinForBiometrics();
      if (!pin) return { success: false };
      const isValid = await SecureStorage.verifyPin(pin);
      if (isValid) {
        SensitiveSession.start(pin);
        return { success: true, pin };
      }
      return { success: false };
    } catch (err) {
      // Biometric auth failed
      return { success: false };
    }
  };

  const handleVerifySuccess = async (pin: string) => {
    const result = await deriveDescriptors(pin, activeWallet?.id);
    if (result) {
      setDescriptors(result.descriptors);
      setMasterFingerprint(result.fingerprint);
    }
    setViewState('display');
  };

  // ─── Clipboard / Share ──────────────────────
  const handleCopy = useCallback(async (text: string, key: string) => {
    await haptics.trigger('selection');
    await Clipboard.setStringAsync(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    // Auto-clear sensitive descriptor data from clipboard after 30s
    setTimeout(async () => { try { await Clipboard.setStringAsync(''); } catch {} }, 30_000);
  }, [haptics]);

  const handleShare = useCallback(async (text: string, label: string) => {
    await haptics.trigger('selection');
    try {
      await Share.share({ message: text, title: label });
    } catch {
      // Share failed
    }
  }, [haptics]);

  const handleExportAll = useCallback(async () => {
    await haptics.trigger('selection');

    let text: string;
    if (isMultisig && multisigDescriptors && multisigConfig) {
      text = `# Bitcoin Multisig Wallet Output Descriptors\n# Network: ${network}\n# Policy: ${multisigConfig.m}-of-${multisigConfig.n} Multisig\n# Script Type: ${getMultisigScriptTypeLabel()}\n\n## Receive Descriptor (External Chain)\n${multisigDescriptors.receive}\n\n## Change Descriptor (Internal Chain)\n${multisigDescriptors.change}\n\n## Cosigners\n${multisigConfig.cosigners.map((c: any, i: number) => `# ${i + 1}. ${c.name} [${c.fingerprint.toUpperCase()}]`).join('\n')}\n`;
    } else if (descriptors) {
      text = `# Bitcoin Wallet Output Descriptors\n# Network: ${network}\n# Master Fingerprint: ${masterFingerprint}\n\n## Native SegWit (BIP84)\n# Receive:\n${descriptors.nativeSegwit.receive}\n\n# Change:\n${descriptors.nativeSegwit.change}\n\n## Wrapped SegWit (BIP49)\n# Receive:\n${descriptors.wrappedSegwit.receive}\n\n# Change:\n${descriptors.wrappedSegwit.change}\n\n## Legacy (BIP44)\n# Receive:\n${descriptors.legacy.receive}\n\n# Change:\n${descriptors.legacy.change}\n`;
    } else {
      return;
    }

    try {
      await Share.share({ message: text, title: 'Output Descriptors' });
    } catch {
      // Share failed
    }
  }, [isMultisig, multisigDescriptors, multisigConfig, descriptors, masterFingerprint, network, getMultisigScriptTypeLabel, haptics]);

  // ─── Current Descriptor ──────────────────────
  const currentDescriptor = descriptors ? descriptors[selectedType] : null;

  // ─── PIN Screen ──────────────────────
  if (viewState === 'verify') {
    return (
      <PinCodeScreen
        mode="verify"
        title="View Output Descriptors"
        subtitle="Enter PIN to access your output descriptors"
        icon="code"
        iconColor={mutedText}
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── LOADING STATE ──────────────────────
  if (!descriptors && !isMultisig) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Back + Title */}
          <View style={[styles.titleRow, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.largeTitle, { color: colors.text }]}>Descriptors</Text>
          </View>

          <View style={styles.loadingContainer}>
            <View style={[styles.loadingCircle, { backgroundColor: mutedBg }]}>
              <ActivityIndicator size="small" color={mutedText} />
            </View>
            <Text style={[styles.loadingTitle, { color: colors.text }]}>Generating Descriptors</Text>
            <Text style={[styles.loadingSubtitle, { color: mutedText }]}>Deriving keys from your seed...</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ─── Render: Descriptor Block ──────────────────────
  const renderDescriptorBlock = (
    label: string,
    chainSubtitle: string,
    text: string,
    copyKey: string,
    shareLabel: string,
    expanded: boolean,
    setExpanded: (v: boolean) => void,
  ) => {
    const MAX_LINES = 5;
    const needsExpand = text.length > 160;

    return (
      <View style={[styles.card, { backgroundColor: surfaceBg }]}>
        {/* Header row */}
        <View style={styles.descriptorHead}>
          <View style={styles.descriptorHeadLeft}>
            <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
              <Ionicons name="code-slash-outline" size={15} color={mutedText} />
            </View>
            <View>
              <Text style={[styles.descriptorLabel, { color: colors.text }]}>{label}</Text>
              <Text style={[styles.descriptorChainLabel, { color: mutedText }]}>{chainSubtitle}</Text>
            </View>
          </View>
        </View>

        {/* Code block */}
        <View style={[styles.codeBlock, { backgroundColor: codeBg }]}>
          <Text
            style={[styles.codeText, { color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)' }]}
            numberOfLines={expanded ? undefined : MAX_LINES}
            selectable
          >
            {text}
          </Text>
        </View>

        {needsExpand && (
          <TouchableOpacity
            style={styles.expandTouchable}
            onPress={() => setExpanded(!expanded)}
            activeOpacity={0.6}
          >
            <Text style={[styles.expandLabel, { color: mutedText }]}>
              {expanded ? 'Collapse' : 'Show full descriptor'}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={mutedText} />
          </TouchableOpacity>
        )}

        {/* Muted capsule actions */}
        <View style={styles.capsuleRow}>
          <TouchableOpacity
            style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
            onPress={() => handleCopy(text, copyKey)}
            activeOpacity={0.6}
          >
            <Ionicons
              name={copiedKey === copyKey ? 'checkmark' : 'copy-outline'}
              size={14}
              color={mutedText}
            />
            <Text style={[styles.capsuleBtnText, { color: mutedText }]}>
              {copiedKey === copyKey ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
            onPress={() => handleShare(text, shareLabel)}
            activeOpacity={0.6}
          >
            <Ionicons name="share-outline" size={14} color={mutedText} />
            <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Render: Segmented Control ──────────────────────
  const renderSegmentedControl = () => {
    const types: DescriptorType[] = ['nativeSegwit', 'wrappedSegwit', 'legacy'];
    return (
      <View style={[styles.segmentedOuter, { backgroundColor: mutedBg }]}>
        {types.map((type) => {
          const active = type === selectedType;
          return (
            <TouchableOpacity
              key={type}
              style={[
                styles.segmentPill,
                active && [
                  styles.segmentPillActive,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : '#FFFFFF',
                    ...(isDark ? {} : {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.06,
                      shadowRadius: 4,
                      elevation: 2,
                    }),
                  },
                ],
              ]}
              onPress={() => {
                haptics.trigger('selection');
                setSelectedType(type);
                setExpandedReceive(false);
                setExpandedChange(false);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? colors.text : mutedText },
                  active && { fontWeight: '600' },
                ]}
                numberOfLines={1}
              >
                {TYPE_LABELS[type].label}
              </Text>
              <Text
                style={[
                  styles.segmentSubtext,
                  { color: active ? (isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)') : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)') },
                ]}
                numberOfLines={1}
              >
                {TYPE_LABELS[type].format}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ─── Render: Format Reference ──────────────────────
  const renderFormatReference = (formats: typeof FORMAT_INFO) => (
    <View style={[styles.card, { backgroundColor: surfaceBg }]}>
      <View style={styles.formatHeaderRow}>
        <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
          <Ionicons name="book-outline" size={15} color={mutedText} />
        </View>
        <Text style={[styles.formatTitle, { color: colors.text }]}>Format Reference</Text>
      </View>
      {formats.map((f, i) => (
        <View key={f.code} style={[styles.formatEntry, i < formats.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: dividerColor }]}>
          <View style={[styles.formatCodeBadge, { backgroundColor: mutedBg }]}>
            <Text style={[styles.formatCodeText, { color: mutedText }]}>{f.code}</Text>
          </View>
          <Text style={[styles.formatDescText, { color: mutedText }]}>{f.desc}</Text>
        </View>
      ))}
    </View>
  );

  // ─── MULTISIG VIEW ──────────────────────
  if (isMultisig && multisigConfig && multisigDescriptors) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Back + Title */}
          <View style={[styles.titleRow, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.largeTitle, { color: colors.text }]}>Descriptors</Text>
          </View>

          {/* Multisig Policy Card */}
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            <View style={styles.policyRow}>
              <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                <Ionicons name="people" size={16} color={mutedText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.policyTitle, { color: colors.text }]}>
                  {multisigConfig.m}-of-{multisigConfig.n} Multisig
                </Text>
                <Text style={[styles.policySubtitle, { color: mutedText }]}>
                  {getMultisigScriptTypeLabel()}
                </Text>
              </View>
              <View style={[styles.policyBadge, { backgroundColor: mutedBg }]}>
                <Text style={[styles.policyBadgeText, { color: mutedText }]}>
                  {multisigConfig.m}/{multisigConfig.n}
                </Text>
              </View>
            </View>
          </View>

          {/* Export All */}
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
              onPress={handleExportAll}
              activeOpacity={0.6}
            >
              <Ionicons name="download-outline" size={14} color={mutedText} />
              <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Export All</Text>
            </TouchableOpacity>
          </View>

          {/* Receive Descriptor */}
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>RECEIVE DESCRIPTOR</Text>
          {renderDescriptorBlock(
            'Receive',
            'External Chain (0)',
            multisigDescriptors.receive,
            'receive',
            'Receive Descriptor',
            expandedReceive,
            setExpandedReceive,
          )}

          {/* Change Descriptor */}
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>CHANGE DESCRIPTOR</Text>
          {renderDescriptorBlock(
            'Change',
            'Internal Chain (1)',
            multisigDescriptors.change,
            'change',
            'Change Descriptor',
            expandedChange,
            setExpandedChange,
          )}

          {/* Cosigners */}
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>
            {`COSIGNERS (${multisigConfig.n})`}
          </Text>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {multisigConfig.cosigners.map((cosigner: any, index: number) => (
              <View
                key={`${cosigner.fingerprint}-${index}`}
                style={[
                  styles.cosignerRow,
                  index < multisigConfig.cosigners.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: dividerColor,
                  },
                ]}
              >
                <View style={[styles.cosignerIndex, { backgroundColor: mutedBg }]}>
                  <Text style={[styles.cosignerIndexText, { color: mutedText }]}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.cosignerNameLine}>
                    <Text style={[styles.cosignerName, { color: colors.text }]}>
                      {cosigner.name}
                    </Text>
                    {cosigner.isLocal && (
                      <View style={[styles.localTag, { backgroundColor: mutedBg }]}>
                        <Ionicons name="key" size={9} color={mutedText} />
                        <Text style={[styles.localTagText, { color: mutedText }]}>Local</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.cosignerFp, { color: mutedText }]}>
                    [{cosigner.fingerprint.toUpperCase()}]
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.circleAction, { backgroundColor: mutedBg }]}
                  onPress={() => handleCopy(cosigner.xpub, `xpub-${index}`)}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={copiedKey === `xpub-${index}` ? 'checkmark' : 'copy-outline'}
                    size={15}
                    color={mutedText}
                  />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Format Reference */}
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>DESCRIPTOR FORMATS</Text>
          {renderFormatReference(MULTISIG_FORMAT_INFO)}
        </ScrollView>
      </View>
    );
  }

  // ─── SINGLE-SIG VIEW ──────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back + Title */}
        <View style={[styles.titleRow, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.largeTitle, { color: colors.text }]}>Descriptors</Text>
        </View>

        {/* Master Fingerprint */}
        <View style={[styles.card, { backgroundColor: surfaceBg }]}>
          <View style={styles.fingerprintRow}>
            <View style={styles.fingerprintLeft}>
              <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                <Ionicons name="finger-print" size={16} color={mutedText} />
              </View>
              <View>
                <Text style={[styles.fingerprintLabel, { color: mutedText }]}>Master Fingerprint</Text>
                <Text style={[styles.fingerprintValue, { color: colors.text }]}>
                  {masterFingerprint.toUpperCase()}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.circleAction, { backgroundColor: mutedBg }]}
              onPress={() => handleCopy(masterFingerprint.toUpperCase(), 'fingerprint')}
              activeOpacity={0.6}
            >
              <Ionicons
                name={copiedKey === 'fingerprint' ? 'checkmark' : 'copy-outline'}
                size={15}
                color={mutedText}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Export All */}
        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
            onPress={handleExportAll}
            activeOpacity={0.6}
          >
            <Ionicons name="download-outline" size={14} color={mutedText} />
            <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Export All</Text>
          </TouchableOpacity>
        </View>

        {/* Segmented Control */}
        <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>SCRIPT TYPE</Text>
        {renderSegmentedControl()}

        {currentDescriptor && (
          <>
            {/* Receive Descriptor */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>RECEIVE DESCRIPTOR</Text>
            {renderDescriptorBlock(
              'Receive',
              'External Chain (0)',
              currentDescriptor.receive,
              'receive',
              'Receive Descriptor',
              expandedReceive,
              setExpandedReceive,
            )}

            {/* Change Descriptor */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>CHANGE DESCRIPTOR</Text>
            {renderDescriptorBlock(
              'Change',
              'Internal Chain (1)',
              currentDescriptor.change,
              'change',
              'Change Descriptor',
              expandedChange,
              setExpandedChange,
            )}

            {/* Watch-only notice */}
            {isWatchOnly && (
              <View style={[styles.warningCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                  <Ionicons name="eye-outline" size={15} color={mutedText} />
                </View>
                <Text style={[styles.warningText, { color: mutedText }]}>
                  Watch-only wallet: no private keys stored on this device.
                </Text>
              </View>
            )}

            {/* Format Reference */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>DESCRIPTOR FORMATS</Text>
            {renderFormatReference(FORMAT_INFO)}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── Scroll ──────────────────────
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },

  // ── Title ──────────────────────
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  backButton: {
    marginLeft: -6,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  // ── Loading ──────────────────────
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  loadingCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  loadingSubtitle: {
    fontSize: 14,
    fontWeight: '400',
  },

  // ── Card ──────────────────────
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
  },

  // ── Section Label ──────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    paddingTop: 22,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  // ── Export row ──────────────────────
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },

  // ── Capsule Buttons ──────────────────────
  capsuleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  capsuleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  capsuleBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Segmented Control ──────────────────────
  segmentedOuter: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 4,
    marginBottom: 2,
  },
  segmentPill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: 'center',
  },
  segmentPillActive: {},
  segmentText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  segmentSubtext: {
    fontSize: 9,
    fontWeight: '400',
    marginTop: 2,
  },

  // ── Fingerprint Card ──────────────────────
  fingerprintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fingerprintLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  fingerprintLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginBottom: 3,
  },
  fingerprintValue: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
  },

  // ── Icon Circle ──────────────────────
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Descriptor Block ──────────────────────
  descriptorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  descriptorHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  descriptorLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  descriptorChainLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },

  // ── Code Block ──────────────────────
  codeBlock: {
    borderRadius: 12,
    padding: 14,
  },
  codeText: {
    fontSize: 13,
    lineHeight: 21,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },

  // ── Expand ──────────────────────
  expandTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
    paddingVertical: 4,
  },
  expandLabel: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Format Reference ──────────────────────
  formatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  formatTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  formatEntry: {
    paddingVertical: 12,
  },
  formatCodeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 5,
  },
  formatCodeText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  formatDescText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },

  // ── Warning ──────────────────────
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    padding: 18,
    marginTop: 20,
    marginBottom: 14,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },

  // ── Multisig Policy ──────────────────────
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  policyTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  policySubtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  policyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  policyBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Cosigners ──────────────────────
  cosignerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  cosignerIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cosignerIndexText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cosignerNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cosignerName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  localTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    gap: 3,
  },
  localTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  cosignerFp: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
    letterSpacing: 0.3,
  },
});
