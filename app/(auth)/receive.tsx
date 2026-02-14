import '../../shim';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Linking,
  Share,
} from 'react-native';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QRCode } from '../../src/components/bitcoin';
import { AppBottomSheet } from '../../src/components/ui/AppBottomSheet';
import { SheetOptionRow } from '../../src/components/ui/SheetComponents';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { useWalletStore, useSettingsStore, usePriceStore, useMultiWalletStore } from '../../src/stores';
import { useTheme, useHaptics, useCopyFeedback } from '../../src/hooks';
import { formatAmount, getUnitSymbol, satsToUnit, unitToSats } from '../../src/utils/formatting';
import { shareQRAsPNG } from '../../src/utils/qrExport';
import { TransactionBuilder } from '../../src/core/transaction/TransactionBuilder';
import { PriceAPI } from '../../src/services/api/PriceAPI';
import { ADDRESS_TYPES, THEME, BITCOIN_UNITS } from '../../src/constants';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import { WalletSyncManager } from '../../src/services/sync/WalletSyncManager';
import type { AddressType, BitcoinUnit } from '../../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const POLL_INTERVAL = 10000; // 10 seconds for active receive screen

const ADDRESS_TYPE_CONFIG: Record<AddressType, {
  short: string;
  full: string;
  prefix: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  recommended?: boolean;
}> = {
  [ADDRESS_TYPES.NATIVE_SEGWIT]: {
    short: 'Native SegWit',
    full: 'Native SegWit',
    prefix: 'bc1q...',
    icon: 'flash',
    description: 'Lowest fees, recommended',
    recommended: true,
  },
  [ADDRESS_TYPES.WRAPPED_SEGWIT]: {
    short: 'SegWit',
    full: 'Wrapped SegWit',
    prefix: '3...',
    icon: 'layers',
    description: 'Wide compatibility',
  },
  [ADDRESS_TYPES.LEGACY]: {
    short: 'Legacy',
    full: 'Legacy',
    prefix: '1...',
    icon: 'time',
    description: 'Universal support',
  },
  [ADDRESS_TYPES.TAPROOT]: {
    short: 'Taproot',
    full: 'Taproot',
    prefix: 'bc1p...',
    icon: 'leaf',
    description: 'Enhanced privacy',
  },
};

// Payment info for the received sheet
interface ReceivedPayment {
  txid: string;
  amount: number; // sats
  address: string;
  confirmations: number;
  status: 'pending' | 'confirmed';
}

export default function ReceiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const { copied, copiedKey, copyWithKey } = useCopyFeedback();
  const addresses = useWalletStore(s => s.addresses);
  const network = useWalletStore(s => s.network);
  const preferredAddressType = useWalletStore(s => s.preferredAddressType);
  const setPreferredAddressType = useWalletStore(s => s.setPreferredAddressType);
  const getFirstUnusedAddress = useWalletStore(s => s.getFirstUnusedAddress);
  const usedAddresses = useWalletStore(s => s.usedAddresses);
  const trackedTransactions = useWalletStore(s => s.trackedTransactions);
  const walletId = useWalletStore(s => s.walletId);
  const isLoading = useWalletStore(s => s.isLoading);
  const lastSync = useWalletStore(s => s.lastSync);
  const extendAddressGap = useWalletStore(s => s.extendAddressGap);
  const addressIndices = useWalletStore(s => s.addressIndices);
  const denomination = useSettingsStore(s => s.denomination);
  const price = usePriceStore(s => s.price);
  const currency = usePriceStore(s => s.currency);
  const { getActiveWallet } = useMultiWalletStore();

  const [selectedType, setSelectedType] = useState<AddressType>(preferredAddressType);

  // Design tokens
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const mutedText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const sectionHeaderColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';

  // Determine which address types are available for this wallet
  const availableAddressTypes = useMemo(() => {
    const activeWallet = getActiveWallet();
    const walletType = activeWallet?.type;

    // For imported single keys, only the imported address type is available
    if (walletType === 'imported_key') {
      const uniqueTypes = [...new Set(addresses.filter(a => !a.isChange).map(a => a.type))];
      return uniqueTypes.length > 0 ? uniqueTypes : [preferredAddressType];
    }

    // For multisig wallets: only show the single address type from scriptType
    // Multisig wallets derive addresses for ONE script type only (P2WSH, P2SH-P2WSH, or P2SH)
    if (walletType === 'multisig') {
      const uniqueTypes = [...new Set(addresses.filter(a => !a.isChange).map(a => a.type))];
      return uniqueTypes.length > 0 ? uniqueTypes : [preferredAddressType];
    }

    // For HD mnemonic wallets (type 'hd'), always show all 4 address types
    // regardless of which types were initially derived. HD mnemonic wallets
    // support all BIP derivation paths (BIP44/49/84/86).
    if (walletType === 'hd') {
      return [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.TAPROOT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.LEGACY];
    }

    // For HD wallets from xprv or seed, also show all 4 types (they support full derivation)
    if (walletType === 'hd_xprv' || walletType === 'hd_seed') {
      return [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.TAPROOT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.LEGACY];
    }

    // For HD descriptor wallets, only show what was imported
    if (walletType === 'hd_descriptor') {
      const uniqueTypes = [...new Set(addresses.filter(a => !a.isChange).map(a => a.type))];
      return uniqueTypes.length > 0 ? uniqueTypes : [preferredAddressType];
    }

    // For watch-only wallets, only show what was imported
    if (walletType === 'watch_xpub' || walletType === 'watch_descriptor' || walletType === 'watch_addresses') {
      const uniqueTypes = [...new Set(addresses.filter(a => !a.isChange).map(a => a.type))];
      return uniqueTypes.length > 0 ? uniqueTypes : [preferredAddressType];
    }

    // Fallback: show all types for any other HD-capable wallet
    return [ADDRESS_TYPES.NATIVE_SEGWIT, ADDRESS_TYPES.TAPROOT, ADDRESS_TYPES.WRAPPED_SEGWIT, ADDRESS_TYPES.LEGACY];
  }, [addresses, getActiveWallet, preferredAddressType]);

  // Can the user switch address types?
  const canSwitchAddressType = availableAddressTypes.length > 1;

  // Auto-derive addresses when switching to a type that has no addresses yet
  // This handles the case where the wallet was imported with a specific BIP preset
  // but the user wants to use a different address type
  const [isDerivingType, setIsDerivingType] = useState(false);
  useEffect(() => {
    const hasAddressesForType = addresses.some(a => a.type === selectedType && !a.isChange);
    if (hasAddressesForType || isDerivingType) return;

    // WIF wallets cannot derive new addresses — skip auto-derivation
    const activeWallet = getActiveWallet();
    if (activeWallet?.type === 'imported_key' || activeWallet?.type === 'imported_keys') return;

    // Multisig wallets only support their chosen script type — skip auto-derivation for other types
    if (activeWallet?.type === 'multisig') return;

    // No addresses for this type — try to derive them
    const pin = SensitiveSession.getPin();
    if (!pin) return; // Can't derive without PIN

    setIsDerivingType(true);
    extendAddressGap(pin, selectedType)
      .then((count) => {
        if (count > 0) {
          console.log(`[Receive] Auto-derived ${count} ${selectedType} addresses`);
        }
      })
      .catch(() => {})
      .finally(() => setIsDerivingType(false));
  }, [selectedType, addresses]);

  // Sync selectedType when preferredAddressType changes or when available types change
  useEffect(() => {
    if (!availableAddressTypes.includes(selectedType)) {
      const newType = availableAddressTypes.includes(preferredAddressType)
        ? preferredAddressType
        : availableAddressTypes[0];
      setSelectedType(newType);
    }
  }, [availableAddressTypes, preferredAddressType, selectedType]);
  const [requestAmount, setRequestAmount] = useState('');
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [showFormatSheet, setShowFormatSheet] = useState(false);
  const [inputUnit, setInputUnit] = useState<BitcoinUnit | 'fiat'>(denomination);

  // Full address sheet
  const [showFullAddressSheet, setShowFullAddressSheet] = useState(false);

  // Share options sheet
  const [showShareSheet, setShowShareSheet] = useState(false);

  // Payment received sheet
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [receivedPayment, setReceivedPayment] = useState<ReceivedPayment | null>(null);
  const [paymentReceivedToType, setPaymentReceivedToType] = useState<AddressType>(preferredAddressType);

  // QR SVG ref for PNG export
  const qrSvgRef = useRef<any>(null);

  // Track known txids to detect NEW ones
  const knownTxidsRef = useRef<Set<string>>(new Set());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animation values
  const qrScale = useSharedValue(1);

  // Get all receiving addresses for this wallet
  const receivingAddresses = useMemo(() => {
    return addresses.filter(a => !a.isChange).map(a => a.address);
  }, [addresses]);

  // Initialize known txids from trackedTransactions.
  // Use trackedTransactions as a dependency so we capture ALL existing txids
  // before the detection effect runs. A hasInitialized ref prevents false
  // "new payment" notifications for txids that existed before the screen opened.
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRef.current) return; // Only run once on first non-empty data
    const known = new Set<string>();
    trackedTransactions.forEach((_, txid) => {
      known.add(txid);
    });
    knownTxidsRef.current = known;
    // Mark initialized once we have actual data (or if store is truly empty)
    if (known.size > 0 || !isLoading) {
      hasInitializedRef.current = true;
    }
  }, [trackedTransactions, isLoading]);

  // Poll for new incoming transactions
  useEffect(() => {
    if (walletId) WalletSyncManager.shared().triggerSync(walletId, 'manual').catch(() => {});

    pollIntervalRef.current = setInterval(() => {
      if (walletId) WalletSyncManager.shared().triggerSync(walletId, 'manual').catch(() => {});
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Detect new incoming transactions by watching trackedTransactions changes
  useEffect(() => {
    // Don't fire detection until initialization is complete
    if (!hasInitializedRef.current) return;

    trackedTransactions.forEach((tx, txid) => {
      if (!knownTxidsRef.current.has(txid) && tx.isIncoming && tx.amount > 0) {
        knownTxidsRef.current.add(txid);

        const payment: ReceivedPayment = {
          txid,
          amount: tx.amount,
          address: tx.address,
          confirmations: tx.confirmations,
          status: tx.confirmations > 0 ? 'confirmed' : 'pending',
        };

        setReceivedPayment(payment);
        setPaymentReceivedToType(selectedType);
        setShowPaymentSheet(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (knownTxidsRef.current.has(txid) && tx.isIncoming) {
        if (receivedPayment?.txid === txid) {
          const newStatus = tx.confirmations > 0 ? 'confirmed' : 'pending';
          if (tx.confirmations !== receivedPayment.confirmations || newStatus !== receivedPayment.status) {
            setReceivedPayment(prev => prev ? {
              ...prev,
              confirmations: tx.confirmations,
              status: newStatus as 'pending' | 'confirmed',
            } : null);
            if (newStatus === 'confirmed' && receivedPayment.status === 'pending') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }
        }
      }
    });
  }, [trackedTransactions]);

  // Get FIRST UNUSED address for selected type
  const currentAddress = useMemo(() => {
    const unusedAddress = getFirstUnusedAddress(selectedType);
    if (unusedAddress) {
      return unusedAddress.address;
    }
    const addressOfType = addresses.find(a => a.type === selectedType && !a.isChange);
    return addressOfType?.address || addresses[0]?.address || '';
  }, [addresses, selectedType, usedAddresses, getFirstUnusedAddress]);

  // Get the address info for display
  const currentAddressInfo = useMemo(() => {
    return getFirstUnusedAddress(selectedType);
  }, [selectedType, getFirstUnusedAddress, usedAddresses]);

  // Calculate amount in satoshis based on input unit
  const amountInSats = useMemo(() => {
    if (!requestAmount || requestAmount === '0') return 0;
    const numValue = parseFloat(requestAmount);
    if (isNaN(numValue)) return 0;

    if (inputUnit === 'fiat') {
      if (!price) return 0;
      return Math.round((numValue / price) * 100000000);
    }
    // Any BitcoinUnit — convert using unitToSats
    return Math.round(unitToSats(numValue, inputUnit));
  }, [requestAmount, inputUnit, price]);

  // Calculate fiat equivalent
  const fiatValue = useMemo(() => {
    if (!amountInSats || !price) return null;
    return (amountInSats / 100000000) * price;
  }, [amountInSats, price]);

  // Fiat formatter — uses PriceAPI for correct currency symbol
  const formatFiat = useCallback((sats: number) => {
    if (!price) return '';
    const val = (sats / 100000000) * price;
    return PriceAPI.formatPrice(val, currency || 'USD');
  }, [price, currency]);

  const handleTypeChange = async (type: AddressType) => {
    if (type === selectedType) {
      setShowFormatSheet(false);
      return;
    }

    await haptics.trigger('selection');

    qrScale.value = withTiming(0.95, { duration: 100 }, () => {
      qrScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });

    setSelectedType(type);
    setPreferredAddressType(type);
    setShowFormatSheet(false);
  };

  const animatedQRStyle = useAnimatedStyle(() => ({
    transform: [{ scale: qrScale.value }],
  }));

  const handleCopy = async () => {
    await copyWithKey('address', currentAddress);
  };

  const handleShare = async () => {
    await haptics.trigger('selection');
    setShowShareSheet(true);
  };

  const handleShareQR = async () => {
    setShowShareSheet(false);
    const uri = TransactionBuilder.createBitcoinUri(
      currentAddress,
      amountInSats || undefined
    );
    await shareQRAsPNG(qrSvgRef.current, uri, 'bitcoin-address');
  };

  const handleShareAddress = async () => {
    setShowShareSheet(false);
    const uri = TransactionBuilder.createBitcoinUri(
      currentAddress,
      amountInSats || undefined
    );
    await Share.share({ message: uri });
  };

  const handleBack = async () => {
    await haptics.trigger('light');
    router.back();
  };

  const toggleAmountInput = async () => {
    await haptics.trigger('selection');
    setShowAmountInput(true);
  };

  const cycleInputUnit = async () => {
    await haptics.trigger('light');
    // Cycle: current denomination → fiat → back to denomination
    if (inputUnit === 'fiat') {
      setInputUnit(denomination);
    } else {
      setInputUnit('fiat');
    }
    setRequestAmount('');
  };

  const getInputUnitLabel = () => {
    if (inputUnit === 'fiat') return currency || 'USD';
    return getUnitSymbol(inputUnit);
  };

  const shortenAddress = (address: string) => {
    if (address.length <= 20) return address;
    return `${address.slice(0, 12)}...${address.slice(-8)}`;
  };

  const handleShowFullAddress = async () => {
    await haptics.trigger('light');
    setShowFullAddressSheet(true);
  };

  const handleCopyFullAddress = async () => {
    await copyWithKey('fullAddress', currentAddress);
  };

  const handleCopyTxId = async () => {
    if (!receivedPayment) return;
    await copyWithKey('txid', receivedPayment.txid);
  };

  const handleCopyReceivedAddress = async () => {
    if (!receivedPayment) return;
    await copyWithKey('receivedAddr', receivedPayment.address);
  };

  const handleViewOnMempool = async () => {
    if (!receivedPayment) return;
    const baseUrl = network === 'mainnet'
      ? 'https://mempool.space/tx/'
      : 'https://mempool.space/testnet/tx/';
    await Linking.openURL(baseUrl + receivedPayment.txid);
  };

  const handleClosePaymentSheet = () => {
    setShowPaymentSheet(false);
  };

  const selectedConfig = ADDRESS_TYPE_CONFIG[selectedType];

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
        {/* Back */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        {/* Title */}
        <Text style={[styles.largeTitle, { color: colors.text }]}>Receive</Text>

        {/* ── QR Code Section ─────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.qrSection}>
          <Animated.View style={[styles.qrArea, animatedQRStyle]}>
            <View style={[styles.qrCard, !isDark && styles.qrCardLight]}>
              {!currentAddress ? (
                <View style={styles.qrLoading}>
                  <ActivityIndicator size="large" color={colors.text} />
                </View>
              ) : (
                <QRCode
                  address={currentAddress}
                  amount={amountInSats || undefined}
                  size={SCREEN_WIDTH - 120}
                  showLogo={true}
                  onRef={(ref) => { qrSvgRef.current = ref; }}
                />
              )}

              {/* Amount display — compact pill inside QR card */}
              {amountInSats > 0 && (
                <View style={styles.amountPillContainer}>
                  <View style={styles.amountPill}>
                    <Text style={styles.amountPillValue}>
                      {formatAmount(amountInSats, denomination)}
                    </Text>
                    {fiatValue != null && (
                      <Text style={styles.amountPillFiat}>
                        ≈ {PriceAPI.formatPrice(fiatValue, currency || 'USD')}
                      </Text>
                    )}
                    <TouchableOpacity
                      onPress={() => setRequestAmount('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.amountPillClear}
                    >
                      <Ionicons name="close-circle-outline" size={15} color="rgba(0,0,0,0.30)" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </Animated.View>

        {/* ── Actions ─────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(80).duration(400)}>
          {/* Primary Action - Copy Address */}
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}
            onPress={handleCopy}
            activeOpacity={0.8}
          >
            <Ionicons name={copiedKey === 'address' ? 'checkmark' : 'copy'} size={18} color="#FFFFFF" />
            <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
              {copiedKey === 'address' ? 'Address Copied' : 'Copy Address'}
            </Text>
          </TouchableOpacity>

          {/* Secondary Actions Row */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: surfaceBg }]}
              onPress={handleShare}
              activeOpacity={0.7}
            >
              <Ionicons name="share-outline" size={18} color={colors.text} />
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: surfaceBg }]}
              onPress={toggleAmountInput}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={18} color={colors.text} />
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Amount</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: surfaceBg }]}
              onPress={() => router.push({ pathname: '/(auth)/nearby', params: { mode: 'receive' } })}
              activeOpacity={0.7}
            >
              <Ionicons name="bluetooth" size={18} color={colors.text} />
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Nearby</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Address Details Card ────────────────────────── */}
        <Animated.View entering={FadeIn.delay(160).duration(400)}>
          <Text style={[styles.sectionHeader, { color: sectionHeaderColor }]}>ADDRESS DETAILS</Text>
          <View style={[styles.detailsCard, { backgroundColor: surfaceBg }]}>
            {/* Address Row */}
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: mutedText }]}>Address</Text>
              <View style={styles.detailValueRow}>
                <TouchableOpacity onPress={handleShowFullAddress} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="eye-outline" size={16} color={mutedText} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCopy} activeOpacity={0.7} style={styles.detailValueRow}>
                  <Text style={[styles.detailValue, { color: colors.text, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
                    {shortenAddress(currentAddress)}
                  </Text>
                  <Ionicons name="copy-outline" size={14} color={mutedText} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

            {/* Format Row */}
            <TouchableOpacity
              style={styles.detailRow}
              onPress={canSwitchAddressType ? () => setShowFormatSheet(true) : undefined}
              activeOpacity={canSwitchAddressType ? 0.7 : 1}
              disabled={!canSwitchAddressType}
            >
              <Text style={[styles.detailLabel, { color: mutedText }]}>Format</Text>
              <View style={styles.detailValueRow}>
                <Ionicons name={selectedConfig.icon} size={14} color={colors.text} style={{ marginRight: 4 }} />
                <Text style={[styles.detailValue, { color: colors.text }]}>{selectedConfig.full}</Text>
                {canSwitchAddressType && (
                  <Ionicons name="chevron-forward" size={14} color={mutedText} />
                )}
              </View>
            </TouchableOpacity>

            <View style={[styles.detailDivider, { backgroundColor: dividerColor }]} />

            {/* Status Row */}
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: mutedText }]}>Status</Text>
              <View style={styles.detailValueRow}>
                <View style={[styles.statusDot, { backgroundColor: isDark ? '#30D158' : '#34C759' }]} />
                <Text style={[styles.detailValue, { color: colors.text }]}>Unused</Text>
                {currentAddressInfo && (
                  <Text style={[styles.addressIndex, { color: mutedText, fontVariant: ['tabular-nums'] }]}>
                    #{currentAddressInfo.index}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Request Amount Sheet */}
      <AppBottomSheet
        visible={showAmountInput}
        onClose={() => {
          setShowAmountInput(false);
          Keyboard.dismiss();
        }}
        title="Request Amount"
        subtitle="Add a specific amount to your QR code"
        sizing="auto"
      >
        <View style={styles.amountSheetContent}>
          <PremiumInputCard>
            <PremiumInput
              icon="cash-outline"
              iconColor="#30D158"
              placeholder="Enter amount"
              value={requestAmount}
              onChangeText={(text) => setRequestAmount(text.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              autoFocus
              centered={true}
              rightElement={
                <TouchableOpacity
                  style={[styles.unitPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
                  onPress={cycleInputUnit}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.unitPillText, { color: colors.text }]}>{getInputUnitLabel()}</Text>
                  <Ionicons name="chevron-down" size={12} color={mutedText} />
                </TouchableOpacity>
              }
            />
          </PremiumInputCard>

          {amountInSats > 0 && (
            <Text style={[styles.amountPreview, { color: mutedText }]}>
              = {formatAmount(amountInSats, denomination)}{fiatValue != null ? ` ≈ ${PriceAPI.formatPrice(fiatValue, currency || 'USD')}` : ''}
            </Text>
          )}

          <View style={styles.amountSheetButtons}>
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}
              onPress={() => setShowAmountInput(false)}
              activeOpacity={0.8}
            >
              <Text style={[styles.sheetPrimaryText, { color: '#FFFFFF' }]}>
                {amountInSats > 0 ? 'Done' : 'Skip'}
              </Text>
            </TouchableOpacity>

            {amountInSats > 0 && (
              <TouchableOpacity
                style={styles.clearAmountButton}
                onPress={() => setRequestAmount('')}
                activeOpacity={0.7}
              >
                <Text style={[styles.clearAmountText, { color: mutedText }]}>Clear amount</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </AppBottomSheet>

      {/* Share Options Sheet */}
      <AppBottomSheet
        visible={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        title="Share"
        sizing="auto"
      >
        <SheetOptionRow
          icon="qr-code"
          label="QR Code"
          description="Share as image"
          onPress={handleShareQR}
          showChevron
        />
        <SheetOptionRow
          icon="text-outline"
          label="Address"
          description="Share as text"
          onPress={handleShareAddress}
          showChevron
          showDivider={false}
        />
      </AppBottomSheet>

      {/* Address Format Selector Sheet */}
      <AppBottomSheet
        visible={showFormatSheet}
        onClose={() => setShowFormatSheet(false)}
        title="Address Format"
        subtitle="Choose your preferred address type"
        sizing="auto"
      >
        <View style={styles.formatSheetContent}>
          {availableAddressTypes.map((type, index) => {
            const config = ADDRESS_TYPE_CONFIG[type];
            const isSelected = selectedType === type;
            const isLast = index === availableAddressTypes.length - 1;

            return (
              <React.Fragment key={type}>
                <TouchableOpacity
                  style={styles.formatOption}
                  onPress={() => handleTypeChange(type)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.formatOptionIcon,
                    { backgroundColor: isSelected ? (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') }
                  ]}>
                    <Ionicons
                      name={config.icon}
                      size={20}
                      color={isSelected ? colors.text : mutedText}
                    />
                  </View>

                  <View style={styles.formatOptionText}>
                    <View style={styles.formatOptionTitleRow}>
                      <Text style={[styles.formatOptionTitle, { color: colors.text }]}>
                        {config.full}
                      </Text>
                      {config.recommended && (
                        <View style={[styles.recommendedChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
                          <Text style={[styles.recommendedChipText, { color: mutedText }]}>Recommended</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.formatOptionDesc, { color: mutedText }]}>
                      {config.description} · {config.prefix}
                    </Text>
                  </View>

                  {isSelected && (
                    <View style={[styles.checkCircle, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}>
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>

                {!isLast && (
                  <View style={[styles.formatDivider, { backgroundColor: dividerColor }]} />
                )}
              </React.Fragment>
            );
          })}
        </View>
      </AppBottomSheet>

      {/* Full Address Sheet */}
      <AppBottomSheet
        visible={showFullAddressSheet}
        onClose={() => setShowFullAddressSheet(false)}
        title="Full Address"
        subtitle={selectedConfig.full}
        sizing="auto"
      >
        <View style={styles.fullAddressSheetContent}>
          <View style={[styles.fullAddressCard, { backgroundColor: surfaceBg }]}>
            <Text
              style={[styles.fullAddressText, { color: colors.text }]}
              selectable
            >
              {currentAddress}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.sheetPrimaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}
            onPress={handleCopyFullAddress}
            activeOpacity={0.8}
          >
            <Ionicons name={copiedKey === 'fullAddress' ? 'checkmark' : 'copy'} size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={[styles.sheetPrimaryText, { color: '#FFFFFF' }]}>
              {copiedKey === 'fullAddress' ? 'Copied \u2713' : 'Copy Address'}
            </Text>
          </TouchableOpacity>
        </View>
      </AppBottomSheet>

      {/* Payment Received Sheet */}
      <AppBottomSheet
        visible={showPaymentSheet}
        onClose={handleClosePaymentSheet}
        showCloseButton={false}
        sizing="auto"
      >
        {receivedPayment && (
          <View style={styles.paymentContent}>
            {/* Header Row */}
            <View style={styles.paymentHeader}>
              <View style={[
                styles.paymentSuccessIcon,
                {
                  backgroundColor: isDark ? 'rgba(48, 209, 88, 0.15)' : 'rgba(48, 209, 88, 0.10)',
                }
              ]}>
                <Ionicons
                  name={receivedPayment.status === 'confirmed' ? 'checkmark-circle' : 'arrow-down-circle'}
                  size={18}
                  color="#30D158"
                />
              </View>
              <View style={styles.paymentHeaderText}>
                <Text style={[styles.paymentHeaderTitle, { color: colors.text }]}>
                  Payment received
                </Text>
                <Text style={[styles.paymentHeaderSubtitle, { color: mutedText }]}>
                  {receivedPayment.status === 'confirmed'
                    ? `Confirmed · ${receivedPayment.confirmations} confirmation${receivedPayment.confirmations !== 1 ? 's' : ''}`
                    : 'Awaiting confirmation'
                  }
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleClosePaymentSheet}
                activeOpacity={0.7}
                style={[
                  styles.paymentCloseButton,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }
                ]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name="close"
                  size={18}
                  color={mutedText}
                />
              </TouchableOpacity>
            </View>

            {/* Hero Amount */}
            <View style={styles.paymentHero}>
              <Text style={[styles.paymentAmountLabel, { color: sectionHeaderColor }]}>
                AMOUNT RECEIVED
              </Text>
              <Text style={[styles.paymentAmount, { color: '#30D158' }]}>
                +{formatAmount(receivedPayment.amount, denomination)}
              </Text>
              {price && (
                <Text style={[styles.paymentFiat, { color: mutedText }]}>
                  ≈ {formatFiat(receivedPayment.amount)}
                </Text>
              )}
            </View>

            {/* Status Pill */}
            <View style={styles.paymentStatusArea}>
              <View style={[
                styles.paymentStatusPill,
                {
                  backgroundColor: receivedPayment.status === 'confirmed'
                    ? (isDark ? 'rgba(48, 209, 88, 0.10)' : 'rgba(48, 209, 88, 0.07)')
                    : (isDark ? 'rgba(180, 160, 120, 0.12)' : 'rgba(140, 120, 80, 0.08)')
                }
              ]}>
                <Ionicons
                  name={receivedPayment.status === 'confirmed' ? 'checkmark-circle' : 'time'}
                  size={14}
                  color={receivedPayment.status === 'confirmed'
                    ? (isDark ? 'rgba(48, 209, 88, 0.8)' : '#2DA44E')
                    : (isDark ? 'rgba(200, 180, 130, 0.7)' : '#8A7A56')
                  }
                />
                <Text style={[
                  styles.paymentStatusPillText,
                  {
                    color: receivedPayment.status === 'confirmed'
                      ? (isDark ? 'rgba(48, 209, 88, 0.8)' : '#2DA44E')
                      : (isDark ? 'rgba(200, 180, 130, 0.7)' : '#8A7A56')
                  }
                ]}>
                  {receivedPayment.status === 'confirmed'
                    ? 'Confirmed'
                    : `Pending (${receivedPayment.confirmations} confirmations)`
                  }
                </Text>
              </View>
              <Text style={[styles.paymentStatusExplainer, { color: mutedText }]}>
                {receivedPayment.status === 'confirmed'
                  ? 'Funds are spendable.'
                  : 'This payment will finalize after confirmations.'
                }
              </Text>
            </View>

            {/* Details Section */}
            <View style={styles.paymentDetailsSection}>
              <Text style={[styles.paymentSectionTitle, { color: sectionHeaderColor }]}>
                DETAILS
              </Text>

              <View style={[styles.paymentDetailsCard, { backgroundColor: surfaceBg }]}>
                {/* To */}
                <TouchableOpacity style={styles.paymentRow} onPress={handleCopyReceivedAddress} activeOpacity={0.7}>
                  <Text style={[styles.paymentLabel, { color: mutedText }]}>To</Text>
                  <View style={styles.paymentValueRow}>
                    <Text style={[styles.paymentValueMono, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                      {shortenAddress(receivedPayment.address)}
                    </Text>
                    <View style={[styles.copyTarget, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Ionicons name={copiedKey === 'receivedAddr' ? 'checkmark' : 'copy-outline'} size={12} color={copiedKey === 'receivedAddr' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={[styles.receiptDivider, { backgroundColor: dividerColor }]} />

                {/* TxID */}
                <TouchableOpacity style={styles.paymentRow} onPress={handleCopyTxId} activeOpacity={0.7}>
                  <Text style={[styles.paymentLabel, { color: mutedText }]}>TxID</Text>
                  <View style={styles.paymentValueRow}>
                    <Text style={[styles.paymentValueMono, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                      {receivedPayment.txid.slice(0, 8)}...{receivedPayment.txid.slice(-8)}
                    </Text>
                    <View style={[styles.copyTarget, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <Ionicons name={copiedKey === 'txid' ? 'checkmark' : 'copy-outline'} size={12} color={copiedKey === 'txid' ? (isDark ? '#30D158' : '#34C759') : mutedText} />
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={[styles.receiptDivider, { backgroundColor: dividerColor }]} />

                {/* Confirmations */}
                <View style={styles.paymentRow}>
                  <Text style={[styles.paymentLabel, { color: mutedText }]}>Confirmations</Text>
                  <Text style={[styles.paymentValue, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                    {receivedPayment.confirmations}
                  </Text>
                </View>

                <View style={[styles.receiptDivider, { backgroundColor: dividerColor }]} />

                {/* Format */}
                <View style={styles.paymentRow}>
                  <Text style={[styles.paymentLabel, { color: mutedText }]}>Format</Text>
                  <Text style={[styles.paymentValue, { color: colors.text }]}>
                    {ADDRESS_TYPE_CONFIG[paymentReceivedToType]?.full || 'Unknown'}
                  </Text>
                </View>
              </View>
            </View>

            {/* CTA Buttons */}
            <View style={styles.paymentButtons}>
              <TouchableOpacity
                style={[styles.sheetPrimaryButton, { backgroundColor: isDark ? THEME.brand.bitcoin : '#000000' }]}
                onPress={handleClosePaymentSheet}
                activeOpacity={0.8}
              >
                <Text style={[styles.sheetPrimaryText, { color: '#FFFFFF' }]}>
                  Done
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetSecondaryButton, { backgroundColor: surfaceBg }]}
                onPress={handleViewOnMempool}
                activeOpacity={0.7}
              >
                <Ionicons name="open-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
                <Text style={[styles.sheetSecondaryText, { color: colors.text }]}>
                  View on Mempool
                </Text>
              </TouchableOpacity>

              <Text style={[styles.paymentMempoolHint, { color: mutedText }]}>
                You can track confirmations on Mempool.
              </Text>
            </View>
          </View>
        )}
      </AppBottomSheet>
    </View>
  );
}

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

  // ── Back + Title ──────────────────────────
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 4,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 24,
  },

  // ── Section Header ────────────────────────
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 22,
    paddingBottom: 10,
    paddingLeft: 4,
  },

  // ── QR Section ────────────────────────────
  qrSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  qrArea: {
    alignItems: 'center',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
  },
  qrCardLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  qrLoading: {
    width: SCREEN_WIDTH - 120,
    height: SCREEN_WIDTH - 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact amount pill inside QR card
  amountPillContainer: {
    marginTop: 12,
    alignItems: 'center',
    width: '100%',
  },
  amountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 6,
  },
  amountPillValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    letterSpacing: -0.2,
  },
  amountPillFiat: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(0,0,0,0.40)',
  },
  amountPillClear: {
    marginLeft: 2,
  },

  // ── Primary Button ────────────────────────
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    gap: 8,
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Secondary Actions ─────────────────────
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 45,
    borderRadius: 24,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Details Card ──────────────────────────
  detailsCard: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '400',
  },
  detailValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  addressIndex: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Amount Sheet ──────────────────────────
  amountSheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 8,
  },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  unitPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  amountPreview: {
    fontSize: 14,
    marginBottom: 20,
  },
  amountSheetButtons: {
    gap: 12,
  },
  clearAmountButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  clearAmountText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Full Address Sheet ────────────────────
  fullAddressSheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 8,
    gap: 16,
  },
  fullAddressCard: {
    borderRadius: 20,
    padding: 20,
  },
  fullAddressText: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  // ── Shared Sheet Buttons ──────────────────
  sheetPrimaryButton: {
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
  },
  sheetSecondaryButton: {
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Format Sheet ──────────────────────────
  formatSheetContent: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  formatOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  formatOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  formatOptionText: {
    flex: 1,
  },
  formatOptionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  formatOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  recommendedChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  recommendedChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  formatOptionDesc: {
    fontSize: 13,
  },
  formatDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 58,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Payment Received Sheet ────────────────
  paymentContent: {
    paddingHorizontal: 24,
  },

  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  paymentSuccessIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  paymentHeaderText: {
    flex: 1,
    marginRight: 12,
  },
  paymentHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  paymentHeaderSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  paymentCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  paymentHero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  paymentAmountLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  paymentAmount: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  paymentFiat: {
    fontSize: 15,
    marginTop: 6,
  },

  paymentStatusArea: {
    alignItems: 'center',
    marginBottom: 24,
  },
  paymentStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  paymentStatusPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  paymentStatusExplainer: {
    fontSize: 12,
    marginTop: 8,
  },

  paymentDetailsSection: {
    marginBottom: 28,
  },
  paymentSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  paymentDetailsCard: {
    borderRadius: 20,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  paymentLabel: {
    fontSize: 14,
    fontWeight: '400',
  },
  paymentValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  paymentValueMono: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  copyTarget: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptDivider: {
    height: StyleSheet.hairlineWidth,
  },

  paymentButtons: {
    gap: 10,
  },
  paymentMempoolHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    paddingBottom: 4,
  },
});
