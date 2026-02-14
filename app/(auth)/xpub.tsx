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
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCodeSVG from 'react-native-qrcode-svg';
import { PinCodeScreen } from '../../src/components/security';
import { useWalletStore, useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { useTheme, useHaptics, useScreenSecurity } from '../../src/hooks';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { SeedGenerator } from '../../src/core/wallet/SeedGenerator';
import { KeyDerivation } from '../../src/core/wallet/KeyDerivation';
import { WalletDatabase } from '../../src/services/database';

// ─── Types ──────────────────────────────────────────────────────

type ViewState = 'verify' | 'display';
type XpubType = 'nativeSegwit' | 'wrappedSegwit' | 'legacy';

interface XpubData {
  xpub: string;
  format: string;
  path: string;
}

interface CosignerXpubData {
  id: string;
  name: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  isLocal: boolean;
}

// ─── Constants ──────────────────────────────────────────────────

const TYPE_LABELS: Record<XpubType, { label: string; shortFormat: string }> = {
  nativeSegwit: { label: 'Native SegWit', shortFormat: 'zpub' },
  wrappedSegwit: { label: 'Wrapped SegWit', shortFormat: 'ypub' },
  legacy: { label: 'Legacy', shortFormat: 'xpub' },
};

const TESTNET_FORMATS: Record<XpubType, string> = {
  nativeSegwit: 'vpub',
  wrappedSegwit: 'upub',
  legacy: 'tpub',
};

const BIP_LABELS: Record<XpubType, string> = {
  nativeSegwit: 'BIP84',
  wrappedSegwit: 'BIP49',
  legacy: 'BIP44',
};

const SUCCESS = '#30D158';

// ─── Component ──────────────────────────────────────────────────

export default function XpubScreen() {
  useScreenSecurity(); // Prevent screenshots/recording while keys are displayed
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const isMultisig = useWalletStore(s => s.isMultisig);
  const multisigConfig = useWalletStore(s => s.multisigConfig);
  const getMultisigScriptTypeLabel = useWalletStore(s => s.getMultisigScriptTypeLabel);
  const { biometricsEnabled } = useSettingsStore();
  const activeWallet = useMultiWalletStore((s) => s.getActiveWallet());
  const isWatchOnly = activeWallet?.type === 'watch_xpub' || activeWallet?.type === 'watch_descriptor' || activeWallet?.type === 'watch_addresses';

  // ─── Auth State ──────────────────────
  const sessionPin = SensitiveSession.getPin();
  const [viewState, setViewState] = useState<ViewState>(
    isMultisig || isWatchOnly || sessionPin ? 'display' : 'verify',
  );
  const autoAuthAttempted = useRef(false);

  // ─── Data State ──────────────────────
  const [selectedType, setSelectedType] = useState<XpubType>('nativeSegwit');
  const [xpubData, setXpubData] = useState<{
    nativeSegwit: XpubData;
    wrappedSegwit: XpubData;
    legacy: XpubData;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedCosignerIndex, setSelectedCosignerIndex] = useState(0);

  // ─── Derived design tokens ──────────────────────
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const warningColor = isDark ? 'rgba(255,159,10,0.80)' : '#FF9500';
  const warningBg = isDark ? 'rgba(255,159,10,0.10)' : 'rgba(255,149,0,0.08)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const isMainnet = network === 'mainnet';

  const cosignerXpubs: CosignerXpubData[] = isMultisig && multisigConfig
    ? multisigConfig.cosigners.map((c: any, index: number) => ({
        id: `cosigner-${index}-${c.fingerprint}`,
        name: c.name,
        fingerprint: c.fingerprint,
        xpub: c.xpub,
        derivationPath: c.derivationPath,
        isLocal: c.isLocal,
      }))
    : [];

  const getMultisigXpubFormat = (): string => {
    if (!multisigConfig) return 'XPUB';
    const scriptType = multisigConfig.scriptType;
    switch (scriptType) {
      case 'p2wsh': return isMainnet ? 'Zpub' : 'Vpub';
      case 'p2sh-p2wsh': return isMainnet ? 'Ypub' : 'Upub';
      case 'p2sh': default: return isMainnet ? 'xpub' : 'tpub';
    }
  };

  const getFormatLabel = (type: XpubType): string => {
    if (isMainnet) return TYPE_LABELS[type].shortFormat;
    return TESTNET_FORMATS[type];
  };

  // ─── Load cached xpubs from database ──────────────────────
  useEffect(() => {
    if (isMultisig) return;
    const walletId = activeWallet?.id;
    if (!walletId) return;

    try {
      const db = WalletDatabase.shared();
      const dbXpubs = db.getXpubs(walletId);
      if (dbXpubs && dbXpubs.length >= 3) {
        const entries = dbXpubs.map(x => ({
          xpub: x.xpub,
          derivationPath: x.derivationPath,
          scriptType: x.scriptType,
        }));
        const cached = xpubEntriestoXpubData(entries);
        if (cached) {
          setXpubData(cached);
          return;
        }
      }
    } catch {}

    if (autoAuthAttempted.current) return;
    if (!sessionPin) {
      setViewState('verify');
      return;
    }
    autoAuthAttempted.current = true;
    (async () => {
      const allXpubs = await deriveXpubKeys(sessionPin, walletId);
      if (allXpubs) setXpubData(allXpubs);
    })();
  }, []);

  // ─── Convert V2 XpubEntry[] to screen XpubData ──────────────────────
  const xpubEntriestoXpubData = (entries: { xpub: string; derivationPath: string; scriptType: string }[]): {
    nativeSegwit: XpubData;
    wrappedSegwit: XpubData;
    legacy: XpubData;
  } | null => {
    const native = entries.find(e => e.scriptType === 'p2wpkh');
    const wrapped = entries.find(e => e.scriptType === 'p2sh-p2wpkh');
    const legacy = entries.find(e => e.scriptType === 'p2pkh');
    if (!native || !wrapped || !legacy) return null;
    return {
      nativeSegwit: { xpub: native.xpub, format: isMainnet ? 'zpub' : 'vpub', path: native.derivationPath },
      wrappedSegwit: { xpub: wrapped.xpub, format: isMainnet ? 'ypub' : 'upub', path: wrapped.derivationPath },
      legacy: { xpub: legacy.xpub, format: isMainnet ? 'xpub' : 'tpub', path: legacy.derivationPath },
    };
  };

  // ─── Key Derivation (+ persist to DB) ──────────────────────
  const deriveXpubKeys = async (pin: string, walletId?: string) => {
    const mnemonic = await SecureStorage.retrieveSeed(pin);
    if (!mnemonic) return null;
    const seed = await SeedGenerator.toSeed(mnemonic);
    const keyDerivation = new KeyDerivation(seed, network);
    const allXpubs = keyDerivation.getAllExtendedPublicKeys(0);
    const fingerprint = keyDerivation.getMasterFingerprint();
    keyDerivation.destroy();

    if (walletId) {
      try {
        const db = WalletDatabase.shared();
        const xpubRows = [
          { walletId, xpub: allXpubs.nativeSegwit.xpub, derivationPath: allXpubs.nativeSegwit.path, scriptType: 'p2wpkh', fingerprint },
          { walletId, xpub: allXpubs.wrappedSegwit.xpub, derivationPath: allXpubs.wrappedSegwit.path, scriptType: 'p2sh-p2wpkh', fingerprint },
          { walletId, xpub: allXpubs.legacy.xpub, derivationPath: allXpubs.legacy.path, scriptType: 'p2pkh', fingerprint },
        ];
        db.insertXpubs(xpubRows);
      } catch (e) {
        // DB persist error
      }
    }

    return allXpubs;
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
    const allXpubs = await deriveXpubKeys(pin, activeWallet?.id);
    if (allXpubs) setXpubData(allXpubs);
    setViewState('display');
  };

  // ─── Clipboard ──────────────────────
  const handleCopy = useCallback(async (text: string, key: string) => {
    await haptics.trigger('selection');
    await Clipboard.setStringAsync(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    // Auto-clear sensitive xpub data from clipboard after 30s
    setTimeout(async () => { try { await Clipboard.setStringAsync(''); } catch {} }, 30_000);
  }, [haptics]);

  const handleShare = useCallback(async (text: string, label: string) => {
    await haptics.trigger('selection');
    try {
      await Share.share({ message: text, title: label });
    } catch (error) {
      // Share failed
    }
  }, [haptics]);

  // ─── Current xpub ──────────────────────
  const currentXpub = xpubData ? xpubData[selectedType] : null;

  // ─── Render: Segmented Control (matches Descriptors) ──────────────────────
  const renderSegmentedControl = () => {
    const types: XpubType[] = ['nativeSegwit', 'wrappedSegwit', 'legacy'];
    return (
      <View style={[styles.segmentedOuter, { backgroundColor: mutedBg }]}>
        {types.map((type) => {
          const active = type === selectedType;
          const format = getFormatLabel(type);
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
                {format} · {BIP_LABELS[type]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ─── PIN Screen ──────────────────────
  if (viewState === 'verify') {
    return (
      <PinCodeScreen
        mode="verify"
        title="View Extended Public Keys"
        subtitle="Enter PIN to access your xpub keys"
        icon="key"
        iconColor="#007AFF"
        onVerify={handleVerify}
        onSuccess={handleVerifySuccess}
        onCancel={() => router.back()}
        biometricEnabled={biometricsEnabled}
        onBiometricSuccess={handleBiometricSuccess}
      />
    );
  }

  // ─── MULTISIG VIEW ──────────────────────
  if (isMultisig && multisigConfig) {
    const selectedCosigner = cosignerXpubs[selectedCosignerIndex];

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
            <Text style={[styles.largeTitle, { color: colors.text }]}>Cosigner Keys</Text>
          </View>

          {/* Multisig Configuration */}
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

          {/* Cosigner Tabs */}
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>COSIGNERS</Text>
          <View style={[styles.segmentedOuter, { backgroundColor: mutedBg }]}>
            {cosignerXpubs.map((c, i) => {
              const active = i === selectedCosignerIndex;
              return (
                <TouchableOpacity
                  key={c.id}
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
                    setSelectedCosignerIndex(i);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.cosignerTabContent}>
                    <Text style={[styles.segmentText, { color: active ? colors.text : mutedText }, active && { fontWeight: '600' }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.isLocal && (
                      <View style={[styles.localDot, { backgroundColor: SUCCESS }]} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedCosigner && (
            <>
              {/* Cosigner Details */}
              <View style={[styles.card, { backgroundColor: surfaceBg }]}>
                <View style={styles.fingerprintRow}>
                  <View style={styles.fingerprintLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                      <Ionicons name="finger-print" size={16} color={mutedText} />
                    </View>
                    <View>
                      <Text style={[styles.fingerprintLabel, { color: mutedText }]}>Fingerprint</Text>
                      <Text style={[styles.fingerprintValue, { color: colors.text }]}>
                        {selectedCosigner.fingerprint.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  {selectedCosigner.isLocal && (
                    <View style={[styles.localTag, { backgroundColor: mutedBg }]}>
                      <Ionicons name="key" size={9} color={mutedText} />
                      <Text style={[styles.localTagText, { color: mutedText }]}>Local</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* QR Code */}
              <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>QR CODE</Text>
              <View style={[styles.card, { backgroundColor: surfaceBg, alignItems: 'center', paddingVertical: 28 }]}>
                <View style={styles.qrFrame}>
                  <QRCodeSVG
                    value={selectedCosigner.xpub}
                    size={200}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                    ecl="H"
                    quietZone={0}
                    logo={require('../../appIcon.png')}
                    logoSize={34}
                    logoBackgroundColor="#FFFFFF"
                    logoMargin={3}
                    logoBorderRadius={7}
                  />
                </View>
                <View style={[styles.formatPill, { backgroundColor: mutedBg }]}>
                  <Text style={[styles.formatPillText, { color: mutedText }]}>
                    {getMultisigXpubFormat().toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Extended Public Key */}
              <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>EXTENDED PUBLIC KEY</Text>
              <View style={[styles.card, { backgroundColor: surfaceBg }]}>
                <View style={[styles.codeBlock, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)' }]}>
                  <Text style={[styles.codeText, { color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)' }]} selectable>
                    {selectedCosigner.xpub}
                  </Text>
                </View>
                <View style={styles.capsuleRow}>
                  <TouchableOpacity
                    style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                    onPress={() => handleCopy(selectedCosigner.xpub, 'xpub')}
                    activeOpacity={0.6}
                  >
                    <Ionicons
                      name={copiedKey === 'xpub' ? 'checkmark' : 'copy-outline'}
                      size={14}
                      color={copiedKey === 'xpub' ? SUCCESS : mutedText}
                    />
                    <Text style={[styles.capsuleBtnText, {
                      color: copiedKey === 'xpub' ? SUCCESS : mutedText,
                    }]}>
                      {copiedKey === 'xpub' ? 'Copied' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                    onPress={() => handleShare(selectedCosigner.xpub, `${selectedCosigner.name} Xpub`)}
                    activeOpacity={0.6}
                  >
                    <Ionicons name="share-outline" size={14} color={mutedText} />
                    <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Derivation Path */}
              <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>DERIVATION</Text>
              <View style={[styles.card, { backgroundColor: surfaceBg }]}>
                <View style={styles.fingerprintRow}>
                  <View style={styles.fingerprintLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                      <Ionicons name="git-branch-outline" size={16} color={mutedText} />
                    </View>
                    <View>
                      <Text style={[styles.fingerprintLabel, { color: mutedText }]}>Path</Text>
                      <Text style={[styles.fingerprintValue, { color: colors.text, fontSize: 15 }]}>
                        {selectedCosigner.derivationPath}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.circleAction, { backgroundColor: mutedBg }]}
                    onPress={() => handleCopy(selectedCosigner.derivationPath, 'path')}
                    activeOpacity={0.6}
                  >
                    <Ionicons
                      name={copiedKey === 'path' ? 'checkmark' : 'copy-outline'}
                      size={15}
                      color={copiedKey === 'path' ? SUCCESS : mutedText}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Warning */}
              <View style={[styles.warningCard, { backgroundColor: warningBg }]}>
                <View style={[styles.iconCircle, { backgroundColor: 'transparent' }]}>
                  <Ionicons name="information-circle-outline" size={18} color={warningColor} />
                </View>
                <Text style={[styles.warningText, { color: warningColor }]}>
                  Sharing cosigner xpubs reveals the multisig configuration. All cosigners' xpubs are needed to spend funds.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ─── LOADING STATE ──────────────────────
  if (!xpubData) {
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
            <Text style={[styles.largeTitle, { color: colors.text }]}>Extended Public Keys</Text>
          </View>

          <View style={styles.loadingContainer}>
            <View style={[styles.loadingCircle, { backgroundColor: mutedBg }]}>
              <ActivityIndicator size="small" color={mutedText} />
            </View>
            <Text style={[styles.loadingTitle, { color: colors.text }]}>Generating Keys</Text>
            <Text style={[styles.loadingSubtitle, { color: mutedText }]}>Deriving extended public keys...</Text>
          </View>
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
          <Text style={[styles.largeTitle, { color: colors.text }]}>Extended Public Keys</Text>
        </View>

        {/* Segmented Control (matches Descriptors screen) */}
        <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>ADDRESS TYPE</Text>
        {renderSegmentedControl()}

        {currentXpub && (
          <>
            {/* QR Code */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>QR CODE</Text>
            <View style={[styles.card, { backgroundColor: surfaceBg, alignItems: 'center', paddingVertical: 28 }]}>
              <View style={styles.qrFrame}>
                <QRCodeSVG
                  value={currentXpub.xpub}
                  size={200}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  ecl="H"
                  quietZone={0}
                  logo={require('../../appIcon.png')}
                  logoSize={34}
                  logoBackgroundColor="#FFFFFF"
                  logoMargin={3}
                  logoBorderRadius={7}
                />
              </View>
              <View style={[styles.formatPill, { backgroundColor: mutedBg }]}>
                <Text style={[styles.formatPillText, { color: mutedText }]}>
                  {currentXpub.format.toUpperCase()} · {BIP_LABELS[selectedType]}
                </Text>
              </View>
            </View>

            {/* Extended Public Key */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>EXTENDED PUBLIC KEY</Text>
            <View style={[styles.card, { backgroundColor: surfaceBg }]}>
              <View style={[styles.codeBlock, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)' }]}>
                <Text style={[styles.codeText, { color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)' }]} selectable>
                  {currentXpub.xpub}
                </Text>
              </View>
              <View style={styles.capsuleRow}>
                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                  onPress={() => handleCopy(currentXpub.xpub, 'xpub')}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={copiedKey === 'xpub' ? 'checkmark' : 'copy-outline'}
                    size={14}
                    color={copiedKey === 'xpub' ? SUCCESS : mutedText}
                  />
                  <Text style={[styles.capsuleBtnText, {
                    color: copiedKey === 'xpub' ? SUCCESS : mutedText,
                  }]}>
                    {copiedKey === 'xpub' ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                  onPress={() => handleShare(currentXpub.xpub, `${currentXpub.format} Key`)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="share-outline" size={14} color={mutedText} />
                  <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Derivation Path */}
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>DERIVATION</Text>
            <View style={[styles.card, { backgroundColor: surfaceBg }]}>
              <View style={styles.fingerprintRow}>
                <View style={styles.fingerprintLeft}>
                  <View style={[styles.iconCircle, { backgroundColor: mutedBg }]}>
                    <Ionicons name="git-branch-outline" size={16} color={mutedText} />
                  </View>
                  <View>
                    <Text style={[styles.fingerprintLabel, { color: mutedText }]}>Path</Text>
                    <Text style={[styles.fingerprintValue, { color: colors.text, fontSize: 15 }]}>
                      {currentXpub.path}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.circleAction, { backgroundColor: mutedBg }]}
                  onPress={() => handleCopy(currentXpub.path, 'path')}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={copiedKey === 'path' ? 'checkmark' : 'copy-outline'}
                    size={15}
                    color={copiedKey === 'path' ? SUCCESS : mutedText}
                  />
                </TouchableOpacity>
              </View>
            </View>

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

            {/* Warning */}
            <View style={[styles.warningCard, { backgroundColor: warningBg }]}>
              <View style={[styles.iconCircle, { backgroundColor: 'transparent' }]}>
                <Ionicons name="information-circle-outline" size={18} color={warningColor} />
              </View>
              <Text style={[styles.warningText, { color: warningColor }]}>
                Sharing your xpub reveals your entire transaction history and all addresses. Only share with trusted services.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles (matches Descriptors screen) ──────────────────────────────────────

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

  // ── QR Code ──────────────────────
  qrFrame: {
    borderRadius: 16,
    overflow: 'hidden',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  formatPill: {
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 8,
  },
  formatPillText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
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

  // ── Fingerprint / Path ──────────────────────
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

  // ── Cosigner tab content ──────────────────────
  cosignerTabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  localDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
});
