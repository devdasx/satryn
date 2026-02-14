import '../../shim';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Keyboard,
  Share,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as DocPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as bitcoin from 'bitcoinjs-lib';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useWalletStore } from '../../src/stores';
import { useTheme, useHaptics, useCopyFeedback } from '../../src/hooks';
import { ElectrumAPI } from '../../src/services/electrum';
import { WalletSyncManager } from '../../src/services/sync/WalletSyncManager';
import { QRScanner } from '../../src/components/scanner';
import {
  AppBottomSheet,
  SheetPrimaryButton,
} from '../../src/components/ui';
import {
  InfoCard,
  SettingsCard,
  PrimaryBottomButton,
  StatusPill,
  KeyboardSafeBottomBar,
} from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';

// ─── Transaction parsing ────────────────────────────────────────

interface TxPreview {
  txid: string;
  version: number;
  inputCount: number;
  outputCount: number;
  vsize: number;
  weight: number;
  locktime: number;
  hasWitness: boolean;
  totalOutputSats: number;
  feeRateEstimate: number | null;
  outputs: { address: string; valueSats: number; index: number }[];
  scriptTypes: string[];
}

function parseTxHex(hex: string, networkType: string): TxPreview | null {
  try {
    const buf = Buffer.from(hex, 'hex');
    const tx = bitcoin.Transaction.fromBuffer(buf);

    const net = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    const hasWitness = tx.hasWitnesses();
    const baseSize = tx.byteLength(false);
    const totalSize = buf.length;
    const weight = hasWitness ? baseSize * 3 + totalSize : totalSize * 4;
    const vsize = Math.ceil(weight / 4);

    // Parse outputs
    let totalOutputSats = 0;
    const scriptTypesSet = new Set<string>();
    const outputs = tx.outs.map((out, index) => {
      const value = typeof out.value === 'bigint' ? Number(out.value) : out.value;
      totalOutputSats += value;
      let address = '';
      try {
        address = bitcoin.address.fromOutputScript(Buffer.from(out.script), net);
        // Detect script type from address
        if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
          scriptTypesSet.add('Taproot');
        } else if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
          scriptTypesSet.add('SegWit');
        } else if (address.startsWith('3') || address.startsWith('2')) {
          scriptTypesSet.add('P2SH');
        } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
          scriptTypesSet.add('Legacy');
        }
      } catch {
        address = 'Non-standard output';
        scriptTypesSet.add('Non-standard');
      }
      return { address, valueSats: value, index };
    });

    // Detect witness type from inputs
    if (hasWitness) {
      for (const inp of tx.ins) {
        if (inp.witness && inp.witness.length > 0) {
          const lastWitness = inp.witness[inp.witness.length - 1];
          if (lastWitness && lastWitness.length === 32) {
            scriptTypesSet.add('Taproot');
          }
        }
      }
    }

    const txid = tx.getId();

    return {
      txid,
      version: tx.version,
      inputCount: tx.ins.length,
      outputCount: tx.outs.length,
      vsize,
      weight,
      locktime: tx.locktime,
      hasWitness,
      totalOutputSats,
      feeRateEstimate: null, // Can't determine without input values
      outputs,
      scriptTypes: Array.from(scriptTypesSet),
    };
  } catch {
    return null;
  }
}

function isPSBT(hex: string): boolean {
  return hex.toLowerCase().startsWith('70736274ff');
}

function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0 && str.length >= 20;
}

function detectNetworkFromTx(hex: string, networkType: string): 'match' | 'mismatch' | 'unknown' {
  try {
    const buf = Buffer.from(hex, 'hex');
    const tx = bitcoin.Transaction.fromBuffer(buf);
    const net = networkType === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    for (const out of tx.outs) {
      try {
        const addr = bitcoin.address.fromOutputScript(Buffer.from(out.script), net);
        if (addr) return 'match';
      } catch {
        const otherNet = networkType === 'mainnet'
          ? bitcoin.networks.testnet
          : bitcoin.networks.bitcoin;
        try {
          const addr = bitcoin.address.fromOutputScript(Buffer.from(out.script), otherNet);
          if (addr) return 'mismatch';
        } catch {
          // Non-standard script
        }
      }
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatSats(sats: number): string {
  if (sats >= 100_000_000) {
    return `${(sats / 100_000_000).toFixed(8)} BTC`;
  }
  return `${sats.toLocaleString()} sats`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 20) return addr;
  return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
}

// ─── Types ──────────────────────────────────────────────────────

type BroadcastState = 'idle' | 'broadcasting' | 'success' | 'error';
type SheetPhase = 'confirm' | 'broadcasting' | 'success' | 'error' | 'already-broadcast';

function isAlreadyBroadcastError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('already in block chain') ||
    lower.includes('already known') ||
    lower.includes('txn-already-in-mempool') ||
    lower.includes('transaction already in block chain') ||
    lower.includes('already exists') ||
    lower.includes('conflict') ||
    lower.includes('missing inputs');
}

// ─── Component ──────────────────────────────────────────────────

export default function BroadcastScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const { copiedKey, copyWithKey } = useCopyFeedback();

  const [rawTx, setRawTx] = useState('');
  const [broadcastState, setBroadcastState] = useState<BroadcastState>('idle');
  const [resultTxid, setResultTxid] = useState('');
  const [resultTotalOutput, setResultTotalOutput] = useState(0);
  const [resultVsize, setResultVsize] = useState(0);
  const [resultOutputs, setResultOutputs] = useState<{ address: string; valueSats: number; index: number }[]>([]);
  const [resultFee, setResultFee] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);

  // Unified broadcast sheet
  const [showBroadcastSheet, setShowBroadcastSheet] = useState(false);
  const [sheetPhase, setSheetPhase] = useState<SheetPhase>('confirm');
  const [sheetContentKey, setSheetContentKey] = useState(0);

  // Derived state
  const cleanHex = rawTx.trim().replace(/\s/g, '');
  const hexValid = cleanHex.length > 0 && isValidHex(cleanHex);
  const psbtDetected = cleanHex.length > 0 && isPSBT(cleanHex);
  const txPreview = hexValid && !psbtDetected ? parseTxHex(cleanHex, network) : null;
  const networkCheck = hexValid && !psbtDetected ? detectNetworkFromTx(cleanHex, network) : 'unknown';

  const canBroadcast = hexValid && !psbtDetected && broadcastState !== 'broadcasting';

  // Design tokens
  const mutedBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const networkLabel = network === 'mainnet' ? 'Mainnet' : 'Testnet';

  // Reset results when user manually edits input (not when we clear it on success)
  useEffect(() => {
    if (broadcastState === 'idle') return;
    // Don't reset if we're in a result state (success/error) — the rawTx
    // was cleared programmatically, not by the user editing the field.
    if (broadcastState === 'success' || broadcastState === 'broadcasting') return;
    setBroadcastState('idle');
    setResultTxid('');
    setErrorMessage('');
  }, [rawTx]);

  // ─── Handlers ────────────────────────────────────────────────

  const handlePaste = useCallback(async () => {
    try {
      const content = await Clipboard.getStringAsync();
      if (content) {
        setRawTx(content.trim());
        await haptics.trigger('success');
      }
    } catch {}
  }, [haptics]);

  const handleClear = useCallback(async () => {
    await haptics.trigger('selection');
    setRawTx('');
    setBroadcastState('idle');
    setResultTxid('');
    setErrorMessage('');
    setShowOutputs(false);
  }, [haptics]);

  const handleScanResult = useCallback((data: string) => {
    setShowScanner(false);
    const cleaned = data.trim().replace(/\s/g, '');
    if (cleaned.length > 0) {
      setRawTx(cleaned);
      haptics.trigger('success');
    }
  }, [haptics]);

  const handleFileImport = useCallback(async () => {
    try {
      await haptics.trigger('selection');
      const result = await DocPicker.getDocumentAsync({
        type: ['text/plain', 'application/octet-stream', 'application/json'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri);
      const cleaned = content.trim().replace(/\s/g, '');

      if (cleaned.length > 0) {
        setRawTx(cleaned);
        await haptics.trigger('success');
      }
    } catch (err) {
      console.error('File import failed:', err);
    }
  }, [haptics]);

  const handleCopyHex = useCallback(async () => {
    if (cleanHex) {
      await copyWithKey('hex', cleanHex);
    }
  }, [cleanHex, copyWithKey]);

  const handleShareHex = useCallback(async () => {
    if (cleanHex) {
      await haptics.trigger('selection');
      await Share.share({ message: cleanHex, title: 'Raw Transaction Hex' });
    }
  }, [cleanHex, haptics]);

  const handleBroadcastPress = useCallback(async () => {
    if (!canBroadcast) return;
    await haptics.trigger('medium');
    Keyboard.dismiss();
    setSheetPhase('confirm');
    setShowBroadcastSheet(true);
    setSheetContentKey(k => k + 1);
  }, [canBroadcast, haptics]);

  const handleConfirmBroadcast = useCallback(async () => {
    // Transition to broadcasting state in same sheet
    setSheetPhase('broadcasting');
    setSheetContentKey(k => k + 1);
    setBroadcastState('broadcasting');
    setResultTxid('');
    setErrorMessage('');

    // Capture tx info before clearing
    const currentPreview = txPreview;
    const currentHex = cleanHex;
    const api = ElectrumAPI.shared(network);

    try {
      const txid = await api.broadcastTransaction(currentHex);
      setResultTxid(txid);
      setResultTotalOutput(currentPreview?.totalOutputSats ?? 0);
      setResultVsize(currentPreview?.vsize ?? 0);
      setResultOutputs(currentPreview?.outputs ?? []);
      setResultFee(null); // Fee can't be determined without input values
      setBroadcastState('success');
      await haptics.trigger('success');

      // Clear the hex input on success
      setRawTx('');
      setShowOutputs(false);

      // Transition to success in same sheet
      setSheetPhase('success');
      setSheetContentKey(k => k + 1);

      const walletId = useWalletStore.getState().walletId;
      if (walletId) {
        WalletSyncManager.shared().onTransactionBroadcasted(walletId).catch(() => {});
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to broadcast transaction';
      setErrorMessage(msg);
      setBroadcastState('error');
      await haptics.trigger('error');

      // Detect already-broadcast and use the parsed TXID
      if (isAlreadyBroadcastError(msg)) {
        setResultTxid(currentPreview?.txid ?? '');
        setResultTotalOutput(currentPreview?.totalOutputSats ?? 0);
        setResultVsize(currentPreview?.vsize ?? 0);
        setResultOutputs(currentPreview?.outputs ?? []);
        setResultFee(null);
        setSheetPhase('already-broadcast');
      } else {
        setSheetPhase('error');
      }
      setSheetContentKey(k => k + 1);
    }
  }, [cleanHex, network, haptics, txPreview]);

  const handleCopyTxid = useCallback(async () => {
    if (resultTxid) {
      await copyWithKey('txid', resultTxid);
    }
  }, [resultTxid, copyWithKey]);

  const handleShareTxid = useCallback(async () => {
    if (resultTxid) {
      await haptics.trigger('selection');
      await Share.share({ message: resultTxid });
    }
  }, [resultTxid, haptics]);

  const handleNewBroadcast = useCallback(async () => {
    await haptics.trigger('selection');
    setShowBroadcastSheet(false);
    setRawTx('');
    setBroadcastState('idle');
    setResultTxid('');
    setResultTotalOutput(0);
    setResultVsize(0);
    setResultOutputs([]);
    setResultFee(null);
    setErrorMessage('');
    setShowOutputs(false);
  }, [haptics]);

  const handleCloseBroadcastSheet = useCallback(() => {
    setShowBroadcastSheet(false);
  }, []);

  // Mempool URL helpers
  const getMempoolBaseUrl = useCallback(() => {
    return network === 'mainnet'
      ? 'https://mempool.space'
      : 'https://mempool.space/testnet';
  }, [network]);

  const getMempoolTxUrl = useCallback(() => {
    return `${getMempoolBaseUrl()}/tx/${resultTxid}`;
  }, [getMempoolBaseUrl, resultTxid]);

  const handleViewOnExplorer = useCallback(async () => {
    await haptics.trigger('selection');
    const url = getMempoolTxUrl();
    Linking.openURL(url).catch(() => {});
  }, [haptics, getMempoolTxUrl]);

  const handleCopyMempoolLink = useCallback(async () => {
    const url = getMempoolTxUrl();
    await copyWithKey('mempool', url);
  }, [getMempoolTxUrl, copyWithKey]);

  // ─── Render ──────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, {
          paddingTop: insets.top + 16,
          paddingBottom: 120,
        }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        {/* Title + Clear */}
        <View style={styles.titleRow}>
          <Text style={[styles.largeTitle, { color: colors.text }]}>
            Broadcast
          </Text>
          {rawTx.length > 0 && (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.clearText, { color: mutedText }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Network Pill */}
        <Animated.View entering={FadeIn.delay(60).duration(400)} style={styles.networkRow}>
          <View style={[styles.networkPill, { backgroundColor: mutedBg }]}>
            <Ionicons
              name={network === 'mainnet' ? 'globe-outline' : 'flask-outline'}
              size={13}
              color={mutedText}
            />
            <Text style={[styles.networkPillText, { color: mutedText }]}>{networkLabel}</Text>
          </View>
        </Animated.View>

        {/* ── Import Actions ────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(70).duration(400)}>
          <View style={styles.importRow}>
            <TouchableOpacity
              style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
              onPress={handlePaste}
              activeOpacity={0.6}
            >
              <Ionicons name="clipboard-outline" size={13} color={mutedText} />
              <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
              onPress={() => { haptics.trigger('selection'); setShowScanner(true); }}
              activeOpacity={0.6}
            >
              <Ionicons name="qr-code-outline" size={13} color={mutedText} />
              <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
              onPress={handleFileImport}
              activeOpacity={0.6}
            >
              <Ionicons name="document-outline" size={13} color={mutedText} />
              <Text style={[styles.capsuleBtnText, { color: mutedText }]}>File</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Raw Hex Input ────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(80).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>RAW TRANSACTION HEX</Text>
          <PremiumInputCard>
            <PremiumInput
              icon="code-slash-outline"
              iconColor="#BF5AF2"
              value={rawTx}
              onChangeText={setRawTx}
              placeholder="Enter signed transaction hex..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              showClear
            />
          </PremiumInputCard>
        </Animated.View>

        {/* ── Validation Status ────────────────────────────────── */}
        {cleanHex.length > 0 && (
          <Animated.View entering={FadeIn.duration(300)}>
            <View style={styles.validationRow}>
              <Text style={[styles.charCount, { color: mutedText }]}>
                {cleanHex.length} chars ({Math.floor(cleanHex.length / 2)} bytes)
              </Text>
              <View style={styles.validationRight}>
                {psbtDetected ? (
                  <StatusPill label="PSBT Detected" variant="error" icon="alert-circle-outline" />
                ) : hexValid ? (
                  <StatusPill label="Valid Hex" variant="success" />
                ) : (
                  <StatusPill label="Invalid Hex" variant="error" />
                )}
              </View>
            </View>

            {/* Copy/Share hex row */}
            {hexValid && (
              <View style={styles.hexActionsRow}>
                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                  onPress={handleCopyHex}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={copiedKey === 'hex' ? 'checkmark' : 'copy-outline'}
                    size={13}
                    color={mutedText}
                  />
                  <Text style={[styles.capsuleBtnText, { color: mutedText }]}>
                    {copiedKey === 'hex' ? 'Copied' : 'Copy Hex'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: mutedBg }]}
                  onPress={handleShareHex}
                  activeOpacity={0.6}
                >
                  <Ionicons name="share-outline" size={13} color={mutedText} />
                  <Text style={[styles.capsuleBtnText, { color: mutedText }]}>Share Hex</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        )}

        {/* ── PSBT Warning ────────────────────────────────────── */}
        {psbtDetected && (
          <Animated.View entering={FadeIn.duration(300)}>
            <InfoCard
              icon="alert-circle-outline"
              text="This appears to be a PSBT (Partially Signed Bitcoin Transaction), not a finalized transaction. PSBTs must be finalized before broadcasting."
              variant="error"
            />
          </Animated.View>
        )}

        {/* ── Network Mismatch Warning ────────────────────────── */}
        {networkCheck === 'mismatch' && (
          <Animated.View entering={FadeIn.duration(300)}>
            <InfoCard
              icon="warning-outline"
              text={`This transaction appears to be for a different network. You are currently on ${networkLabel}.`}
              variant="warning"
            />
          </Animated.View>
        )}

        {/* ── Transaction Preview ─────────────────────────────── */}
        {txPreview && (
          <Animated.View entering={FadeIn.delay(100).duration(400)}>
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>TRANSACTION PREVIEW</Text>
            <View style={[styles.card, { backgroundColor: surfaceBg }]}>
              {/* TXID */}
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: mutedText }]}>TXID</Text>
                <Text
                  style={[styles.previewValueMono, { color: isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.50)' }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  selectable
                >
                  {txPreview.txid}
                </Text>
              </View>
              <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />

              {/* Size / Weight */}
              <View style={styles.previewGridRow}>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Virtual Size</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.vsize} vB
                  </Text>
                </View>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Weight</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.weight} WU
                  </Text>
                </View>
              </View>
              <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />

              {/* Inputs / Outputs */}
              <View style={styles.previewGridRow}>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Inputs</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.inputCount}
                  </Text>
                </View>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Outputs</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.outputCount}
                  </Text>
                </View>
              </View>
              <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />

              {/* Version / SegWit */}
              <View style={styles.previewGridRow}>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Version</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.version}
                  </Text>
                </View>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>SegWit</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.hasWitness ? 'Yes' : 'No'}
                  </Text>
                </View>
              </View>
              <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />

              {/* Locktime / Script Types */}
              <View style={styles.previewGridRow}>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Locktime</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.locktime}
                  </Text>
                </View>
                <View style={styles.previewGridCell}>
                  <Text style={[styles.previewLabel, { color: mutedText }]}>Script Types</Text>
                  <Text style={[styles.previewValue, { color: colors.text }]}>
                    {txPreview.scriptTypes.length > 0 ? txPreview.scriptTypes.join(', ') : 'Unknown'}
                  </Text>
                </View>
              </View>
              <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />

              {/* Total Output */}
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: mutedText }]}>Total Output</Text>
                <Text style={[styles.previewValue, { color: colors.text }]}>
                  {formatSats(txPreview.totalOutputSats)}
                </Text>
              </View>
            </View>

            {/* ── Output Details ─────────────────────────────── */}
            {txPreview.outputs.length > 0 && (
              <>
                <TouchableOpacity
                  style={styles.outputsToggle}
                  onPress={() => { haptics.trigger('selection'); setShowOutputs(!showOutputs); }}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.sectionLabel, { color: sectionHeaderColor, paddingTop: 14 }]}>
                    {`OUTPUTS (${txPreview.outputs.length})`}
                  </Text>
                  <Ionicons
                    name={showOutputs ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={mutedText}
                  />
                </TouchableOpacity>

                {showOutputs && (
                  <Animated.View entering={FadeIn.duration(250)}>
                    <View style={[styles.card, { backgroundColor: surfaceBg }]}>
                      {txPreview.outputs.map((out, i) => (
                        <View key={i}>
                          {i > 0 && (
                            <View style={[styles.previewDivider, { backgroundColor: dividerColor }]} />
                          )}
                          <View style={styles.outputRow}>
                            <View style={styles.outputLeft}>
                              <View style={[styles.outputIndex, { backgroundColor: mutedBg }]}>
                                <Text style={[styles.outputIndexText, { color: mutedText }]}>{i}</Text>
                              </View>
                              <Text
                                style={[styles.outputAddress, { color: isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.60)' }]}
                                numberOfLines={1}
                                selectable
                              >
                                {truncateAddress(out.address)}
                              </Text>
                            </View>
                            <Text style={[styles.outputAmount, { color: colors.text }]}>
                              {formatSats(out.valueSats)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </Animated.View>
                )}
              </>
            )}
          </Animated.View>
        )}

        {/* ── Safety Warning ──────────────────────────────────── */}
        {hexValid && !psbtDetected && broadcastState === 'idle' && (
          <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.warningGap}>
            <InfoCard
              icon="information-circle-outline"
              text="Broadcasting is irreversible. Make sure the transaction is properly signed and sends to the correct addresses."
              variant="warning"
            />
          </Animated.View>
        )}

        {/* Success/Error results are shown in bottom sheets */}
      </ScrollView>

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      <KeyboardSafeBottomBar backgroundColor={colors.background} horizontalPadding={24}>
        <PrimaryBottomButton
          label={broadcastState === 'broadcasting' ? 'Broadcasting...' : 'Broadcast Transaction'}
          onPress={handleBroadcastPress}
          disabled={!canBroadcast}
          loading={broadcastState === 'broadcasting'}
        />
      </KeyboardSafeBottomBar>

      {/* ── QR Scanner ──────────────────────────────────────────── */}
      <QRScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScanResult}
        onPasteInstead={() => { setShowScanner(false); handlePaste(); }}
        title="Scan Transaction"
        subtitle="Scan a QR code containing raw transaction hex"
      />

      {/* ── Unified Broadcast Sheet ──────────────────────────────── */}
      <AppBottomSheet
        visible={showBroadcastSheet}
        onClose={handleCloseBroadcastSheet}
        dismissible={sheetPhase !== 'broadcasting'}
        contentKey={sheetContentKey}
      >
        <View style={styles.sheetContent}>
          {/* ── Confirm Phase ──────────────────────── */}
          {sheetPhase === 'confirm' && (
            <>
              <View style={[styles.sheetIconCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Ionicons name="radio-outline" size={32} color={mutedText} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Confirm Broadcast</Text>
              <Text style={[styles.sheetSubtitle, { color: mutedText }]}>
                This action is irreversible. Verify the details below.
              </Text>

              {txPreview && (
                <>
                  {/* Amount hero */}
                  <View style={styles.sheetAmountHero}>
                    <Text style={[styles.sheetAmountValue, { color: colors.text }]}>
                      {formatSats(txPreview.totalOutputSats)}
                    </Text>
                  </View>

                  {/* Details card */}
                  <View style={[styles.sheetCard, { backgroundColor: surfaceBg }]}>
                    {/* Recipients */}
                    {txPreview.outputs.map((out, idx) => (
                      <React.Fragment key={idx}>
                        {idx > 0 && <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />}
                        <View style={styles.sheetCardRow}>
                          <Text style={[styles.sheetCardLabel, { color: mutedText }]}>
                            {txPreview.outputs.length === 1 ? 'Recipient' : `Recipient ${idx + 1}`}
                          </Text>
                          <Text style={[styles.sheetCardValueMono, { color: colors.text }]} numberOfLines={1}>
                            {truncateAddress(out.address)}
                          </Text>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>
                </>
              )}

              <View style={styles.sheetButtons}>
                <SheetPrimaryButton label="Broadcast Now" onPress={handleConfirmBroadcast} />
                <View style={{ height: 8 }} />
                <SheetPrimaryButton label="Cancel" onPress={handleCloseBroadcastSheet} variant="destructive" />
              </View>
            </>
          )}

          {/* ── Broadcasting Phase ─────────────────── */}
          {sheetPhase === 'broadcasting' && (
            <>
              <View style={[styles.sheetIconCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Ionicons name="pulse-outline" size={32} color={mutedText} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Broadcasting...</Text>
              <Text style={[styles.sheetSubtitle, { color: mutedText }]}>
                Submitting your transaction to the network.
              </Text>
              <View style={styles.sheetSpinner} />
            </>
          )}

          {/* ── Success Phase ──────────────────────── */}
          {sheetPhase === 'success' && (
            <>
              <View style={[styles.sheetIconCircle, { backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.10)' }]}>
                <Ionicons name="checkmark-circle" size={36} color={isDark ? '#30D158' : '#34C759'} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Transaction Broadcast</Text>
              <Text style={[styles.sheetSubtitle, { color: mutedText }]}>
                Submitted to the network and awaiting confirmation.
              </Text>

              {/* Amount hero */}
              {resultTotalOutput > 0 && (
                <View style={styles.sheetAmountHero}>
                  <Text style={[styles.sheetAmountValue, { color: colors.text }]}>
                    {formatSats(resultTotalOutput)}
                  </Text>
                </View>
              )}

              {/* Details card */}
              <View style={[styles.sheetCard, { backgroundColor: surfaceBg }]}>
                {/* Recipients */}
                {resultOutputs.map((out, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />}
                    <View style={styles.sheetCardRow}>
                      <Text style={[styles.sheetCardLabel, { color: mutedText }]}>
                        {resultOutputs.length === 1 ? 'Recipient' : `Recipient ${idx + 1}`}
                      </Text>
                      <Text style={[styles.sheetCardValueMono, { color: colors.text }]} numberOfLines={1}>
                        {truncateAddress(out.address)}
                      </Text>
                    </View>
                  </React.Fragment>
                ))}
                {resultOutputs.length > 0 && <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />}
                <View style={styles.sheetCardRow}>
                  <Text style={[styles.sheetCardLabel, { color: mutedText }]}>Fee</Text>
                  <Text style={[styles.sheetCardValue, { color: resultFee != null ? colors.text : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)') }]}>
                    {resultFee != null ? formatSats(resultFee) : 'Unable to determine'}
                  </Text>
                </View>
                <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />
                <View style={styles.sheetCardRowVertical}>
                  <Text style={[styles.sheetCardLabel, { color: mutedText }]}>Transaction ID</Text>
                  <Text
                    style={[styles.sheetCardMono, { color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }]}
                    selectable
                  >
                    {resultTxid}
                  </Text>
                </View>
              </View>

              {/* Action grid */}
              <View style={styles.sheetActionsGrid}>
                <TouchableOpacity style={[styles.sheetActionBtn, { backgroundColor: mutedBg }]} onPress={handleCopyTxid} activeOpacity={0.6}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Ionicons name={copiedKey === 'txid' ? 'checkmark' : 'copy-outline'} size={18} color={copiedKey === 'txid' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                  </View>
                  <Text style={[styles.sheetActionLabel, { color: copiedKey === 'txid' ? (isDark ? '#30D158' : '#34C759') : mutedText }]}>
                    {copiedKey === 'txid' ? 'Copied' : 'Copy TXID'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.sheetActionBtn, { backgroundColor: mutedBg }]} onPress={handleShareTxid} activeOpacity={0.6}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Ionicons name="share-outline" size={18} color={mutedText} />
                  </View>
                  <Text style={[styles.sheetActionLabel, { color: mutedText }]}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.sheetActionBtn, { backgroundColor: mutedBg }]} onPress={handleCopyMempoolLink} activeOpacity={0.6}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Ionicons name={copiedKey === 'mempool' ? 'checkmark' : 'link-outline'} size={18} color={copiedKey === 'mempool' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                  </View>
                  <Text style={[styles.sheetActionLabel, { color: copiedKey === 'mempool' ? (isDark ? '#30D158' : '#34C759') : mutedText }]}>
                    {copiedKey === 'mempool' ? 'Copied' : 'Copy Link'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sheetButtons}>
                <SheetPrimaryButton label="View on Explorer" onPress={handleViewOnExplorer} />
                <View style={{ height: 8 }} />
                <SheetPrimaryButton label="Done" onPress={handleCloseBroadcastSheet} variant="destructive" />
              </View>
            </>
          )}

          {/* ── Already Broadcast Phase ────────────── */}
          {sheetPhase === 'already-broadcast' && (
            <>
              <View style={[styles.sheetIconCircle, { backgroundColor: isDark ? 'rgba(255,214,10,0.12)' : 'rgba(255,149,0,0.10)' }]}>
                <Ionicons name="information-circle" size={36} color={isDark ? '#FFD60A' : '#FF9500'} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Already Broadcast</Text>
              <Text style={[styles.sheetSubtitle, { color: mutedText }]}>
                This transaction has already been submitted to the network.
              </Text>

              {/* Amount hero */}
              {resultTotalOutput > 0 && (
                <View style={styles.sheetAmountHero}>
                  <Text style={[styles.sheetAmountValue, { color: colors.text }]}>
                    {formatSats(resultTotalOutput)}
                  </Text>
                </View>
              )}

              {/* Details card */}
              <View style={[styles.sheetCard, { backgroundColor: surfaceBg }]}>
                {/* Recipients */}
                {resultOutputs.map((out, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />}
                    <View style={styles.sheetCardRow}>
                      <Text style={[styles.sheetCardLabel, { color: mutedText }]}>
                        {resultOutputs.length === 1 ? 'Recipient' : `Recipient ${idx + 1}`}
                      </Text>
                      <Text style={[styles.sheetCardValueMono, { color: colors.text }]} numberOfLines={1}>
                        {truncateAddress(out.address)}
                      </Text>
                    </View>
                  </React.Fragment>
                ))}
                {resultOutputs.length > 0 && <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />}
                <View style={styles.sheetCardRow}>
                  <Text style={[styles.sheetCardLabel, { color: mutedText }]}>Fee</Text>
                  <Text style={[styles.sheetCardValue, { color: resultFee != null ? colors.text : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)') }]}>
                    {resultFee != null ? formatSats(resultFee) : 'Unable to determine'}
                  </Text>
                </View>
                {resultTxid.length > 0 && (
                  <>
                    <View style={[styles.sheetCardDivider, { backgroundColor: dividerColor }]} />
                    <View style={styles.sheetCardRowVertical}>
                      <Text style={[styles.sheetCardLabel, { color: mutedText }]}>Transaction ID</Text>
                      <Text
                        style={[styles.sheetCardMono, { color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }]}
                        selectable
                      >
                        {resultTxid}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {/* Action grid */}
              {resultTxid.length > 0 && (
                <View style={styles.sheetActionsGrid}>
                  <TouchableOpacity style={[styles.sheetActionBtn, { backgroundColor: mutedBg }]} onPress={handleCopyTxid} activeOpacity={0.6}>
                    <View style={[styles.sheetActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Ionicons name={copiedKey === 'txid' ? 'checkmark' : 'copy-outline'} size={18} color={copiedKey === 'txid' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                    </View>
                    <Text style={[styles.sheetActionLabel, { color: copiedKey === 'txid' ? (isDark ? '#30D158' : '#34C759') : mutedText }]}>
                      {copiedKey === 'txid' ? 'Copied' : 'Copy TXID'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.sheetActionBtn, { backgroundColor: mutedBg }]} onPress={handleCopyMempoolLink} activeOpacity={0.6}>
                    <View style={[styles.sheetActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Ionicons name={copiedKey === 'mempool' ? 'checkmark' : 'link-outline'} size={18} color={copiedKey === 'mempool' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                    </View>
                    <Text style={[styles.sheetActionLabel, { color: copiedKey === 'mempool' ? (isDark ? '#30D158' : '#34C759') : mutedText }]}>
                      {copiedKey === 'mempool' ? 'Copied' : 'Copy Link'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.sheetButtons}>
                {resultTxid.length > 0 && (
                  <>
                    <SheetPrimaryButton label="View on Explorer" onPress={handleViewOnExplorer} />
                    <View style={{ height: 8 }} />
                  </>
                )}
                <SheetPrimaryButton label="Done" onPress={handleCloseBroadcastSheet} variant="destructive" />
              </View>
            </>
          )}

          {/* ── Error Phase ────────────────────────── */}
          {sheetPhase === 'error' && (
            <>
              <View style={[styles.sheetIconCircle, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,59,48,0.10)' }]}>
                <Ionicons name="close-circle" size={36} color={isDark ? '#FF453A' : '#FF3B30'} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Broadcast Failed</Text>
              <Text style={[styles.sheetSubtitle, { color: mutedText }]}>
                The transaction was rejected by the network.
              </Text>

              {errorMessage.length > 0 && (
                <View style={[styles.sheetCard, { backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,59,48,0.04)' }]}>
                  <View style={styles.sheetCardRowVertical}>
                    <Text style={[styles.sheetCardLabel, { color: isDark ? 'rgba(255,69,58,0.60)' : 'rgba(255,59,48,0.60)' }]}>Error</Text>
                    <Text
                      style={[styles.sheetCardMono, { color: isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.50)' }]}
                      numberOfLines={4}
                      selectable
                    >
                      {errorMessage}
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.sheetButtons}>
                <SheetPrimaryButton label="Try Again" onPress={handleCloseBroadcastSheet} />
                <View style={{ height: 8 }} />
                <SheetPrimaryButton label="Copy Raw Hex" onPress={() => { handleCopyHex(); handleCloseBroadcastSheet(); }} variant="destructive" />
              </View>
            </>
          )}
        </View>
      </AppBottomSheet>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // ── Back + Title ──────────────────────
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  clearText: {
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Network ──────────────────────
  networkRow: {
    marginBottom: 16,
  },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  networkPillText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Import Row ──────────────────────
  importRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
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

  // ── Validation ──────────────────────
  validationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  validationRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  charCount: {
    fontSize: 13,
    fontWeight: '400',
  },
  hexActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },

  // ── Card ──────────────────────
  card: {
    borderRadius: 20,
    overflow: 'hidden' as const,
    marginBottom: 14,
  },

  // ── Transaction Preview ──────────────────────
  previewRow: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  previewGridRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  previewGridCell: {
    flex: 1,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  previewValue: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  previewValueMono: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  previewDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
  },

  // ── Outputs ──────────────────────
  outputsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  outputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  outputLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 12,
  },
  outputIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputIndexText: {
    fontSize: 11,
    fontWeight: '600',
  },
  outputAddress: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  outputAmount: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },

  // ── Warning gap ──────────────────────
  warningGap: {
    marginTop: 6,
  },

  // ── Unified Broadcast Sheet ──────────────────────
  sheetContent: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
    alignItems: 'center',
  },
  sheetIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  sheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  sheetAmountHero: {
    marginBottom: 20,
    alignItems: 'center',
  },
  sheetAmountValue: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  sheetSpinner: {
    height: 32,
    marginBottom: 16,
  },
  sheetCard: {
    borderRadius: 16,
    width: '100%',
    marginBottom: 20,
    overflow: 'hidden' as const,
  },
  sheetCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  sheetCardRowVertical: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  sheetCardLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  sheetCardValue: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  sheetCardValueMono: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  sheetCardMono: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
    marginTop: 6,
  },
  sheetCardDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  sheetActionsGrid: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 24,
  },
  sheetActionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
  },
  sheetActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  sheetButtons: {
    width: '100%',
  },
});
