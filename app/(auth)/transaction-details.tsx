import '../../shim';
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Share,
  Alert,
  Modal,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useWalletStore, useSettingsStore, usePriceStore, useMultiWalletStore } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import { PinCodeScreen } from '../../src/components/security';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { KeyDerivation, SeedGenerator, ImportedKeySigner } from '../../src/core/wallet';
import { TransactionBuilder } from '../../src/core/transaction/TransactionBuilder';
import { ElectrumAPI } from '../../src/services/electrum';
import { WalletSyncManager } from '../../src/services/sync/WalletSyncManager';
import { BITCOIN_NETWORKS, FORMATTING } from '../../src/constants';
import { formatAmount, formatUnitAmount, truncateAddress } from '../../src/utils/formatting';
import { PriceAPI } from '../../src/services/api/PriceAPI';
import { TxNoteEditor } from '../../src/components/bitcoin/TxNoteEditor';
import { FeeBumper } from '../../src/core/transaction/FeeBumper';
import type { DetailedTransactionInfo } from '../../src/types';

const bumpOverlayStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    paddingHorizontal: 32,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

// ─── Main Screen ────────────────────────────────────────────────────

export default function TransactionDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ txData: string }>();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();
  const addresses = useWalletStore(s => s.addresses);
  const network = useWalletStore(s => s.network);
  const activeWalletId = useWalletStore(s => s.walletId);
  const refreshBalance = useWalletStore(s => s.refreshBalance);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);

  const [showInputs, setShowInputs] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);
  const [showFeeBumpSheet, setShowFeeBumpSheet] = useState(false); // TODO: rebuild fee bump UI
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingBumpParams, setPendingBumpParams] = useState<{ rate: number; method: 'rbf' | 'cpfp' } | null>(null);
  const [bumpStatus, setBumpStatus] = useState<string | null>(null);
  const { getActiveWallet } = useMultiWalletStore();

  const tx: DetailedTransactionInfo = useMemo(
    () => params.txData ? JSON.parse(params.txData) : null,
    [params.txData],
  );

  // Pre-build Set for O(1) address lookups instead of O(n) .some() per call
  // Must be defined before any code that calls isOwnAddress (e.g. isSelfTransfer)
  const ownAddressSet = useMemo(() => new Set(addresses.map(a => a.address)), [addresses]);

  function isOwnAddress(address: string | null): boolean {
    if (!address) return false;
    return ownAddressSet.has(address);
  }

  if (!tx) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, marginTop: 12, fontSize: 16 }}>Transaction not found</Text>
      </View>
    );
  }

  const isIncoming = tx.type === 'incoming';
  const isSelfTransfer = tx.type === 'self-transfer' ||
    (!isIncoming && tx.outputs.every(o => isOwnAddress(o.address)));
  const amountSats = Math.abs(tx.balanceDiff);
  const amountBtc = amountSats / FORMATTING.SATS_PER_BTC;
  const fiatValue = price ? amountBtc * price : null;
  const explorerUrl = `${BITCOIN_NETWORKS[network].explorerUrl}/tx/${tx.txid}`;

  // Design tokens
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const mutedText = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)';
  const subtleText = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    await haptics.trigger('success');
  };

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return 'Pending';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const handleShare = async () => {
    await haptics.trigger('selection');
    Share.share({ message: `Bitcoin Transaction: ${explorerUrl}`, url: explorerUrl });
  };

  const handleViewOnExplorer = async () => {
    await haptics.trigger('selection');
    Linking.openURL(explorerUrl);
  };

  const getDirectionLabel = () => {
    if (isSelfTransfer) return 'Self Transfer';
    return isIncoming ? 'Received Bitcoin' : 'Sent Bitcoin';
  };

  const getDirectionIcon = (): keyof typeof Ionicons.glyphMap => {
    if (isSelfTransfer) return 'swap-horizontal';
    return isIncoming ? 'arrow-down' : 'arrow-up';
  };

  const getOutputLabel = (output: { address: string | null; value: number }, index: number): string => {
    if (!output.address) return 'OP_RETURN';
    if (!isIncoming && isOwnAddress(output.address)) return 'Change';
    if (isIncoming && isOwnAddress(output.address)) return 'Recipient';
    if (!isIncoming && !isOwnAddress(output.address)) return 'Recipient';
    return `Output ${index + 1}`;
  };

  // Fee bump eligibility: unconfirmed + RBF-enabled outgoing txs
  const canBumpFee = !tx.confirmed && tx.isRBF && tx.type === 'outgoing';

  const handleBumpFee = (newRate: number, method: 'rbf' | 'cpfp') => {
    try {
      const bumper = new FeeBumper(network === 'mainnet' ? 'mainnet' : 'testnet');

      if (method === 'rbf') {
        const analysis = bumper.analyzeRBF(tx, newRate);
        if (!analysis.canBump) {
          setShowFeeBumpSheet(false);
          Alert.alert('RBF Not Available', analysis.reason || 'Cannot bump this transaction');
          return;
        }
        setShowFeeBumpSheet(false);
        Alert.alert(
          'Confirm Fee Bump',
          `Increase fee from ${tx.feeRate.toFixed(1)} to ${newRate} sat/vB?\n\nNew fee: ~${formatUnitAmount(analysis.estimatedNewFee, denomination)}`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm',
              onPress: () => {
                setPendingBumpParams({ rate: newRate, method: 'rbf' });
                setShowPinModal(true);
              },
            },
          ]
        );
      } else {
        const ownOutputIndex = tx.outputs.findIndex(o => isOwnAddress(o.address));
        if (ownOutputIndex === -1) {
          setShowFeeBumpSheet(false);
          Alert.alert('CPFP Not Available', 'No spendable output found in your wallet');
          return;
        }
        const analysis = bumper.analyzeCPFP(tx, ownOutputIndex, newRate);
        if (!analysis.canBump) {
          setShowFeeBumpSheet(false);
          Alert.alert('CPFP Not Available', analysis.reason || 'Cannot create CPFP for this transaction');
          return;
        }
        setShowFeeBumpSheet(false);
        Alert.alert(
          'Confirm CPFP',
          `Create child transaction at ${newRate} sat/vB effective rate?\n\nChild fee: ~${formatUnitAmount(analysis.requiredChildFee, denomination)}`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm',
              onPress: () => {
                setPendingBumpParams({ rate: newRate, method: 'cpfp' });
                setShowPinModal(true);
              },
            },
          ]
        );
      }
    } catch (error: any) {
      setShowFeeBumpSheet(false);
      Alert.alert('Error', error?.message || 'Fee bump failed');
    }
  };

  const handleBumpPinVerify = async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    SensitiveSession.start(pin);
    return { success: true };
  };

  const handleBumpPinSuccess = async (pin: string) => {
    setShowPinModal(false);
    if (!pendingBumpParams) return;

    const { rate, method } = pendingBumpParams;
    setBumpStatus('Building transaction...');

    try {
      const bumper = new FeeBumper(network === 'mainnet' ? 'mainnet' : 'testnet');
      const txBuilder = new TransactionBuilder(network === 'mainnet' ? 'mainnet' : 'testnet');

      const activeWallet = getActiveWallet();
      const walletType = activeWallet?.type || 'hd';
      const currentWalletId = activeWalletId || activeWallet?.id || '';

      let keyDerivation: any = null;
      let importedKeySigner: any = null;
      let signerType: 'hd' | 'imported_key' = 'hd';

      switch (walletType) {
        case 'hd':
        case 'hd_electrum': {
          let mnemonic = await SecureStorage.retrieveWalletSeed(currentWalletId, pin);
          if (!mnemonic) mnemonic = await SecureStorage.retrieveSeed(pin);
          if (!mnemonic) throw new Error('Could not retrieve wallet seed');
          const seed = await SeedGenerator.toSeed(mnemonic);
          keyDerivation = new KeyDerivation(seed, network);
          break;
        }
        case 'hd_xprv': {
          const xprv = await SecureStorage.retrieveWalletXprv(currentWalletId, pin);
          if (!xprv) throw new Error('Could not retrieve extended private key');
          keyDerivation = KeyDerivation.fromXprv(xprv, network);
          break;
        }
        case 'hd_seed': {
          const seedHex = await SecureStorage.retrieveWalletSeedHex(currentWalletId, pin);
          if (!seedHex) throw new Error('Could not retrieve seed');
          keyDerivation = KeyDerivation.fromSeedHex(seedHex, network);
          break;
        }
        case 'hd_descriptor': {
          const xprv = await SecureStorage.retrieveWalletXprv(currentWalletId, pin);
          if (xprv) {
            keyDerivation = KeyDerivation.fromXprv(xprv, network);
          } else {
            const mnemonic = await SecureStorage.retrieveWalletSeed(currentWalletId, pin);
            if (!mnemonic) throw new Error('Could not retrieve wallet keys');
            const seed = await SeedGenerator.toSeed(mnemonic);
            keyDerivation = new KeyDerivation(seed, network);
          }
          break;
        }
        case 'imported_key': {
          const wif = await SecureStorage.retrieveWalletPrivateKey(currentWalletId, pin);
          if (!wif) throw new Error('Could not retrieve private key');
          const walletAddress = addresses[0]?.address;
          let addrType: any = 'native_segwit';
          if (walletAddress) {
            if (walletAddress.startsWith('bc1p') || walletAddress.startsWith('tb1p')) addrType = 'taproot';
            else if (walletAddress.startsWith('bc1q') || walletAddress.startsWith('tb1q')) addrType = 'native_segwit';
            else if (walletAddress.startsWith('3') || walletAddress.startsWith('2')) addrType = 'wrapped_segwit';
            else addrType = 'legacy';
          }
          importedKeySigner = new ImportedKeySigner(wif, addrType, network);
          signerType = 'imported_key';
          break;
        }
        default:
          throw new Error('Watch-only wallets cannot sign transactions');
      }

      const inputPaths = new Map<string, string>();
      for (const addr of addresses) inputPaths.set(addr.address, addr.path);

      let psbt: any;

      if (method === 'rbf') {
        const changeAddr = tx.outputs.find(o => isOwnAddress(o.address))?.address;
        if (!changeAddr) throw new Error('No change output found for RBF');

        setBumpStatus('Creating RBF replacement...');
        const rbfResult = bumper.createRBFReplacement(tx, inputPaths, {
          newFeeRate: rate,
          changeAddress: changeAddr,
          enableRBF: true,
        });
        psbt = rbfResult.psbt;
      } else {
        const ownOutputIndex = tx.outputs.findIndex(o => isOwnAddress(o.address));
        const ownOutput = tx.outputs[ownOutputIndex];

        setBumpStatus('Creating CPFP child...');
        const cpfpResult = bumper.createCPFPChild(tx, {
          outputIndex: ownOutputIndex,
          targetFeeRate: rate,
          outputAddress: ownOutput.address!,
          enableRBF: true,
        });
        psbt = cpfpResult.psbt;
      }

      setBumpStatus('Signing...');
      let signedHex: string;

      if (signerType === 'hd' && keyDerivation) {
        const inputPathsList: string[] = [];
        for (let i = 0; i < psbt.inputCount; i++) {
          const input = psbt.data.inputs[i];
          if (input.witnessUtxo) {
            const addr = require('bitcoinjs-lib').address.fromOutputScript(
              input.witnessUtxo.script,
              keyDerivation.network || (network === 'mainnet' ? require('bitcoinjs-lib').networks.bitcoin : require('bitcoinjs-lib').networks.testnet)
            );
            const path = inputPaths.get(addr);
            if (path) inputPathsList.push(path);
          }
        }
        const signed = txBuilder.sign(psbt, keyDerivation, inputPathsList);
        signedHex = signed.hex;
        keyDerivation.destroy();
      } else if (importedKeySigner) {
        const signed = txBuilder.signWithImportedKey(psbt, importedKeySigner);
        signedHex = signed.hex;
        importedKeySigner.destroy();
      } else {
        throw new Error('No valid signer available');
      }

      setBumpStatus('Broadcasting...');
      const api = ElectrumAPI.shared(network);
      const broadcastTxid = await api.broadcastTransaction(signedHex);

      setBumpStatus(null);
      setPendingBumpParams(null);

      const walletId = useWalletStore.getState().walletId;
      if (walletId) {
        WalletSyncManager.shared().onTransactionBroadcasted(walletId).catch(() => {});
      }

      setTimeout(() => router.back(), 2000);

    } catch (error: any) {
      setBumpStatus(null);
      setPendingBumpParams(null);
      Alert.alert('Fee Bump Failed', error?.message || 'Could not complete fee bump');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Back + Share ──────────────────────────────── */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="share-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* ── Title ────────────────────────────────────── */}
        <Text style={[styles.largeTitle, { color: colors.text }]}>Transaction Details</Text>

        {/* ── Hero Section ─────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.heroSection}>
          {/* Status row */}
          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              { backgroundColor: tx.confirmed ? '#30D158' : '#FFD60A' },
            ]} />
            <Text style={[styles.statusText, { color: tx.confirmed ? '#30D158' : '#FFD60A' }]}>
              {tx.confirmed
                ? `Confirmed \u00B7 ${tx.confirmations} confirmation${tx.confirmations !== 1 ? 's' : ''}`
                : 'Pending \u00B7 0 confirmations'}
            </Text>
            {tx.isRBF && !tx.confirmed && (
              <View style={[styles.rbfBadge, { backgroundColor: isDark ? 'rgba(255,214,10,0.12)' : 'rgba(255,149,0,0.10)' }]}>
                <Text style={[styles.rbfBadgeText, { color: isDark ? '#FFD60A' : '#FF9500' }]}>RBF</Text>
              </View>
            )}
          </View>

          {/* Direction */}
          <View style={styles.directionRow}>
            <View style={[
              styles.directionIcon,
              {
                backgroundColor: isSelfTransfer
                  ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
                  : isIncoming
                    ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.10)')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
              },
            ]}>
              <Ionicons
                name={getDirectionIcon()}
                size={16}
                color={isSelfTransfer
                  ? mutedText
                  : isIncoming ? '#30D158' : (isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.50)')}
              />
            </View>
            <Text style={[styles.directionLabel, { color: mutedText }]}>
              {getDirectionLabel()}
            </Text>
          </View>

          {/* Amount */}
          <Text style={[styles.heroAmount, { color: colors.text }]}>
            {isIncoming ? '+' : '-'}{formatAmount(amountSats, denomination, true)}
          </Text>

          {/* Fiat */}
          {fiatValue != null && (
            <Text style={[styles.heroFiat, { color: mutedText }]}>
              ≈ {PriceAPI.formatPrice(fiatValue, currency)}
            </Text>
          )}

          {/* Timestamp */}
          <Text style={[styles.heroTimestamp, { color: subtleText }]}>
            {formatTimestamp(tx.blockTime)}
          </Text>
        </Animated.View>

        {/* ── Key Metrics Row ──────────────────────────── */}
        <Animated.View entering={FadeIn.delay(60).duration(400)}>
          <View style={[styles.metricsCard, { backgroundColor: surfaceBg }]}>
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.text }]}>{tx.fee.toLocaleString()}</Text>
              <Text style={[styles.metricLabel, { color: mutedText }]}>Fee</Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: dividerColor }]} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.text }]}>{tx.feeRate}</Text>
              <Text style={[styles.metricLabel, { color: mutedText }]}>sat/vB</Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: dividerColor }]} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: colors.text }]}>{tx.vsize}</Text>
              <Text style={[styles.metricLabel, { color: mutedText }]}>vBytes</Text>
            </View>
          </View>
        </Animated.View>

        {/* ── Fee Bump (if eligible) ───────────────────── */}
        {canBumpFee && (
          <Animated.View entering={FadeIn.delay(100).duration(400)}>
            <TouchableOpacity
              style={[styles.feeBumpButton, { backgroundColor: isDark ? 'rgba(255,214,10,0.10)' : 'rgba(255,149,0,0.08)' }]}
              onPress={async () => { await haptics.trigger('selection'); setShowFeeBumpSheet(true); }}
              activeOpacity={0.7}
            >
              <Ionicons name="trending-up" size={18} color={isDark ? '#FFD60A' : '#FF9500'} />
              <Text style={[styles.feeBumpText, { color: isDark ? '#FFD60A' : '#FF9500' }]}>Increase Fee</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── Details ──────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(120).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>DETAILS</Text>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            <DetailRow
              label="Confirmations"
              value={tx.confirmed ? tx.confirmations.toLocaleString() : '0'}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="Block Height"
              value={tx.height > 0 ? tx.height.toLocaleString() : 'Mempool'}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
              onCopy={tx.height > 0 ? () => copyToClipboard(tx.height.toString(), 'block height') : undefined}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="Status"
              value={tx.confirmed ? 'Confirmed' : 'Pending'}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
              valueBadge
              valueBadgeColor={tx.confirmed ? '#30D158' : '#FFD60A'}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="RBF"
              value={tx.isRBF ? 'Enabled' : 'Disabled'}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="Network Fee"
              value={formatUnitAmount(tx.fee, denomination)}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="Fee Rate"
              value={`${tx.feeRate} sat/vB`}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
            />
            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
            <DetailRow
              label="Size"
              value={`${tx.vsize} vB (${tx.size} bytes)`}
              isDark={isDark}
              colors={colors}
              mutedText={mutedText}
            />
          </View>
        </Animated.View>

        {/* ── Notes & Tags ─────────────────────────────── */}
        {activeWalletId && (
          <Animated.View entering={FadeIn.delay(180).duration(400)}>
            <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>NOTES & TAGS</Text>
            <View style={styles.notesTagsWrapper}>
              <TxNoteEditor
                walletId={activeWalletId}
                txid={tx.txid}
                colors={{
                  text: colors.text,
                  textMuted: mutedText,
                  background: colors.background,
                  surface: surfaceBg,
                  surfaceBorder: 'transparent',
                  primary: '#FF9500',
                }}
                isDark={isDark}
              />
            </View>
          </Animated.View>
        )}

        {/* ── Inputs ───────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(240).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>INPUTS & OUTPUTS</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={async () => { await haptics.trigger('selection'); setShowInputs(!showInputs); }}
          >
            <View style={[styles.card, { backgroundColor: surfaceBg }]}>
              <View style={styles.collapsibleHeader}>
                <View style={styles.collapsibleLeft}>
                  <Text style={[styles.collapsibleTitle, { color: colors.text }]}>Inputs</Text>
                  <View style={[styles.countChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
                    <Text style={[styles.countChipText, { color: mutedText }]}>{tx.inputs.length}</Text>
                  </View>
                </View>
                <Ionicons
                  name={showInputs ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={mutedText}
                />
              </View>

              {showInputs && (
                <View style={styles.ioList}>
                  {tx.inputs.map((input, index) => {
                    const isOwn = isOwnAddress(input.address);
                    return (
                      <View key={index}>
                        {index > 0 && <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />}
                        <TouchableOpacity
                          style={styles.ioItem}
                          activeOpacity={0.7}
                          onPress={() => input.address && copyToClipboard(input.address, 'address')}
                        >
                          <View style={styles.ioItemLeft}>
                            <View style={[
                              styles.ioIcon,
                              { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
                            ]}>
                              <Ionicons name="enter-outline" size={16} color={mutedText} />
                            </View>
                            <View style={styles.ioItemInfo}>
                              <Text style={[styles.ioAddress, { color: colors.text }]} numberOfLines={1}>
                                {truncateAddress(input.address, 10, 8)}
                              </Text>
                              {isOwn && (
                                <Text style={[styles.ioLabel, { color: subtleText }]}>
                                  Your wallet
                                </Text>
                              )}
                            </View>
                          </View>
                          <Text style={[styles.ioAmount, { color: colors.text }]}>
                            {formatAmount(input.value, denomination, true)}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Outputs ──────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(280).duration(400)}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={async () => { await haptics.trigger('selection'); setShowOutputs(!showOutputs); }}
          >
            <View style={[styles.card, { backgroundColor: surfaceBg }]}>
              <View style={styles.collapsibleHeader}>
                <View style={styles.collapsibleLeft}>
                  <Text style={[styles.collapsibleTitle, { color: colors.text }]}>Outputs</Text>
                  <View style={[styles.countChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
                    <Text style={[styles.countChipText, { color: mutedText }]}>{tx.outputs.length}</Text>
                  </View>
                </View>
                <Ionicons
                  name={showOutputs ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={mutedText}
                />
              </View>

              {showOutputs && (
                <View style={styles.ioList}>
                  {tx.outputs.map((output, index) => {
                    const isOwn = isOwnAddress(output.address);
                    const label = getOutputLabel(output, index);
                    const isChange = label === 'Change';
                    return (
                      <View key={index}>
                        {index > 0 && <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />}
                        <TouchableOpacity
                          style={styles.ioItem}
                          activeOpacity={0.7}
                          onPress={() => output.address && copyToClipboard(output.address, 'address')}
                        >
                          <View style={styles.ioItemLeft}>
                            <View style={[
                              styles.ioIcon,
                              { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
                            ]}>
                              <Ionicons name="exit-outline" size={16} color={mutedText} />
                            </View>
                            <View style={styles.ioItemInfo}>
                              <View style={styles.ioLabelRow}>
                                <Text style={[styles.ioAddress, { color: colors.text }]} numberOfLines={1}>
                                  {output.address ? truncateAddress(output.address, 10, 8) : 'OP_RETURN'}
                                </Text>
                                {(label === 'Recipient' || isChange) && (
                                  <View style={[
                                    styles.ioTag,
                                    {
                                      backgroundColor: isChange
                                        ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                                        : (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.10)'),
                                    },
                                  ]}>
                                    <Text style={[
                                      styles.ioTagText,
                                      {
                                        color: isChange
                                          ? mutedText
                                          : (isDark ? '#30D158' : '#34C759'),
                                      },
                                    ]}>
                                      {label}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              {isOwn && !isChange && (
                                <Text style={[styles.ioLabel, { color: subtleText }]}>
                                  Your wallet
                                </Text>
                              )}
                            </View>
                          </View>
                          <Text style={[styles.ioAmount, { color: colors.text }]}>
                            {formatAmount(output.value, denomination, true)}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Transaction ID ───────────────────────────── */}
        <Animated.View entering={FadeIn.delay(320).duration(400)}>
          <Text style={[styles.sectionLabel, { color: sectionHeaderColor }]}>TRANSACTION ID</Text>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            <View style={styles.txidRow}>
              <Text
                style={[styles.txidText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)' }]}
                selectable
              >
                {tx.txid}
              </Text>
            </View>

            {/* Capsule action buttons */}
            <View style={styles.txidActions}>
              <TouchableOpacity
                style={[styles.capsuleButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                onPress={() => copyToClipboard(tx.txid, 'TXID')}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={14} color={mutedText} />
                <Text style={[styles.capsuleText, { color: mutedText }]}>Copy ID</Text>
              </TouchableOpacity>

              {tx.rawHex ? (
                <TouchableOpacity
                  style={[styles.capsuleButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                  onPress={() => copyToClipboard(tx.rawHex, 'raw transaction')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="code-outline" size={14} color={mutedText} />
                  <Text style={[styles.capsuleText, { color: mutedText }]}>Copy Raw</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[styles.capsuleButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                onPress={handleViewOnExplorer}
                activeOpacity={0.7}
              >
                <Ionicons name="open-outline" size={14} color={mutedText} />
                <Text style={[styles.capsuleText, { color: mutedText }]}>Explorer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Fee Bump PIN Modal */}
      <Modal visible={showPinModal} animationType="slide" presentationStyle="fullScreen">
        <PinCodeScreen
          mode="verify"
          title="Authorize Fee Bump"
          subtitle="Enter your PIN to sign the transaction"
          icon="trending-up"
          iconColor="#F7931A"
          onVerify={handleBumpPinVerify}
          onSuccess={handleBumpPinSuccess}
          onCancel={() => {
            setShowPinModal(false);
            setPendingBumpParams(null);
          }}
        />
      </Modal>

      {/* Fee Bump Status Overlay */}
      {bumpStatus && (
        <View style={bumpOverlayStyles.overlay}>
          <View style={bumpOverlayStyles.card}>
            <Ionicons name="hourglass-outline" size={28} color="#F7931A" />
            <Text style={bumpOverlayStyles.text}>{bumpStatus}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Detail Row Component ───────────────────────────────────────────

function DetailRow({
  label,
  value,
  isDark,
  colors,
  mutedText,
  onCopy,
  valueBadge,
  valueBadgeColor,
}: {
  label: string;
  value: string;
  isDark: boolean;
  colors: any;
  mutedText: string;
  onCopy?: () => void;
  valueBadge?: boolean;
  valueBadgeColor?: string;
}) {
  const content = (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: mutedText }]}>
        {label}
      </Text>
      <View style={styles.detailRight}>
        {valueBadge ? (
          <View style={[styles.statusBadge, { backgroundColor: `${valueBadgeColor}18` }]}>
            <View style={[styles.statusBadgeDot, { backgroundColor: valueBadgeColor }]} />
            <Text style={[styles.detailValue, { color: valueBadgeColor }]}>{value}</Text>
          </View>
        ) : (
          <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
        )}
        {onCopy && (
          <View style={[styles.copyIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Ionicons
              name="copy-outline"
              size={12}
              color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)'}
            />
          </View>
        )}
      </View>
    </View>
  );

  if (onCopy) {
    return (
      <TouchableOpacity onPress={onCopy} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

// ─── Styles ─────────────────────────────────────────────────────────

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

  // ── Back + Share ──────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  shareButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },

  // ── Hero ──────────────────────────────────
  heroSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  rbfBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  rbfBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  directionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  heroAmount: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginBottom: 4,
  },
  heroFiat: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 12,
  },
  heroTimestamp: {
    fontSize: 13,
    fontWeight: '400',
  },

  // ── Metrics ───────────────────────────────
  metricsCard: {
    flexDirection: 'row',
    borderRadius: 20,
    paddingVertical: 16,
    marginBottom: 12,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  metricDivider: {
    width: 1,
    height: '60%' as any,
    alignSelf: 'center',
  },

  // ── Fee Bump ──────────────────────────────
  feeBumpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    marginBottom: 12,
  },
  feeBumpText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Section label ─────────────────────────
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 14,
    marginBottom: 10,
    paddingLeft: 4,
  },

  // ── Notes & Tags wrapper ─────────────────
  notesTagsWrapper: {
    marginBottom: 4,
  },

  // ── Card ──────────────────────────────────
  card: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 12,
  },

  // ── Detail rows ───────────────────────────
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    minHeight: 48,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '400',
  },
  detailRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  copyIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
  },

  // ── Collapsible (Inputs/Outputs) ──────────
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  collapsibleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapsibleTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  countChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countChipText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // ── IO Items ──────────────────────────────
  ioList: {
    paddingBottom: 4,
  },
  ioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  ioItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
    marginRight: 12,
  },
  ioIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ioItemInfo: {
    flex: 1,
  },
  ioLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ioAddress: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  ioTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ioTagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  ioLabel: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  ioAmount: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // ── TXID ──────────────────────────────────
  txidRow: {
    paddingTop: 14,
    paddingBottom: 10,
  },
  txidText: {
    fontSize: 12,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  txidActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 14,
  },
  capsuleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  capsuleText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
