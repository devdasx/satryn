import '../../shim';
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useWalletStore, useSettingsStore, useMultiWalletStore } from '../../src/stores';
import { useTheme, useHaptics, useCopyFeedback } from '../../src/hooks';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SeedGenerator, KeyDerivation } from '../../src/core/wallet';
import { PinCodeScreen } from '../../src/components/security';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';
import {
  InfoCard,
  SettingsCard,
  SettingsRow,
  StatusPill,
  SectionLabel,
  CardTextInput,
  InlineActionButton,
  PrimaryBottomButton,
  MonoSelectableText,
  KeyboardSafeBottomBar,
} from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import {
  StepIndicator,
  AddressPickerSheet,
  SignatureResultCard,
} from '../../src/components/message-signing';

// Bitcoin varint encoding for message length
function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}

const MAX_MESSAGE_LENGTH = 5000;

export default function SignMessageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ address?: string; path?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const addresses = useWalletStore(s => s.addresses);
  const { copiedKey, copyWithKey } = useCopyFeedback();
  const activeWallet = useMultiWalletStore((s) => s.getActiveWallet());

  const [address, setAddress] = useState(params.address || '');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Wallet capability detection
  const isWatchOnly = activeWallet?.type === 'watch_xpub'
    || activeWallet?.type === 'watch_descriptor'
    || activeWallet?.type === 'watch_addresses';
  const isMultisig = activeWallet?.type === 'multisig';
  const canSign = !isWatchOnly && !isMultisig;

  // Find address info if address is from our wallet
  const addressInfo = addresses.find((a) => a.address === address);

  // Available receiving addresses for picker
  const receivingAddresses = useMemo(
    () => addresses.filter((a) => !a.isChange),
    [addresses]
  );

  // Step indicator — derived from state
  const currentStep: 1 | 2 | 3 = useMemo(() => {
    if (signature) return 3;
    if (address && addressInfo) return 2;
    return 1;
  }, [address, addressInfo, signature]);

  const truncateAddress = (addr: string) => {
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
  };

  // ─── Handlers ────────────────────────────────────────────────

  const handleSign = async () => {
    if (!canSign) return;

    // Inline validation — set error instead of Alert.alert
    if (!address.trim() || !addressInfo) {
      await haptics.trigger('error');
      setValidationError('Please select a valid address from your wallet.');
      return;
    }
    if (!message.trim()) {
      await haptics.trigger('error');
      setValidationError('Message is required. Enter a message to sign.');
      return;
    }

    setValidationError('');
    await haptics.trigger('medium');
    setShowPinModal(true);
  };

  const handlePinVerify = async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const isValid = await SecureStorage.verifyPin(pin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    SensitiveSession.start(pin);
    return { success: true };
  };

  const handlePinSuccess = async (pin: string) => {
    setShowPinModal(false);
    try {
      const mnemonic = await SecureStorage.retrieveSeed(pin);
      if (!mnemonic) return;
      await signMessageWithMnemonic(mnemonic);
    } catch (err) {
    }
  };

  const signMessageWithMnemonic = async (mnemonic: string) => {
    setIsLoading(true);
    try {
      if (!addressInfo) throw new Error('Address not found in wallet');

      const seed = await SeedGenerator.toSeed(mnemonic);
      const keyDerivation = new KeyDerivation(seed, network);
      const keyPair = keyDerivation.getSigningKeyPair(addressInfo.path);

      if (!keyPair.privateKey) throw new Error('Could not derive private key');

      // BIP-137 compatible signing
      // Build the message hash: varint(len(prefix)) + prefix + varint(len(msg)) + msg
      const messagePrefix = '\x18Bitcoin Signed Message:\n';
      const messageBuffer = Buffer.from(message);
      const messagePrefixBuffer = Buffer.from(messagePrefix);
      const lengthBuffer = encodeVarint(messageBuffer.length);

      const fullMessage = Buffer.concat([messagePrefixBuffer, lengthBuffer, messageBuffer]);
      const hash = bitcoin.crypto.hash256(fullMessage);

      // Use signRecoverable to get the actual recovery ID
      const { signature: sigBytes, recoveryId } = ecc.signRecoverable(
        hash,
        keyPair.privateKey
      );

      // Recovery flag base depends on address type (BIP-137):
      // 27-30: uncompressed P2PKH
      // 31-34: compressed P2PKH / P2WPKH (bech32)
      // 35-38: compressed P2SH-P2WPKH
      let flagBase: number;
      if (address.startsWith('bc1') || address.startsWith('tb1')) {
        // Native segwit (P2WPKH) — uses compressed keys, flag base 31
        flagBase = 31;
      } else if (address.startsWith('3') || address.startsWith('2')) {
        // Wrapped segwit (P2SH-P2WPKH) — flag base 35
        flagBase = 35;
      } else {
        // Legacy P2PKH — compressed, flag base 31
        flagBase = 31;
      }

      const recoveryFlag = flagBase + recoveryId;

      const fullSignature = Buffer.concat([
        Buffer.from([recoveryFlag]),
        Buffer.from(sigBytes),
      ]);

      keyDerivation.destroy();
      setSignature(fullSignature.toString('base64'));
      setValidationError('');
      await haptics.trigger('success');
    } catch (err: any) {
      await haptics.trigger('error');
      Alert.alert('Error', 'Signing failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySignature = async () => {
    if (!signature) return;
    await copyWithKey('signature', signature);
  };

  const handleShareSignature = async () => {
    if (!signature) return;
    try {
      await Share.share({
        message: `-----BEGIN BITCOIN SIGNED MESSAGE-----\n${message}\n-----BEGIN SIGNATURE-----\n${address}\n${signature}\n-----END BITCOIN SIGNED MESSAGE-----`,
      });
    } catch {}
  };

  const handleCopyBundle = async () => {
    if (!signature) return;
    const bundle = `-----BEGIN BITCOIN SIGNED MESSAGE-----\n${message}\n-----BEGIN SIGNATURE-----\n${address}\n${signature}\n-----END BITCOIN SIGNED MESSAGE-----`;
    await copyWithKey('bundle', bundle);
  };

  const handleVerifySignature = () => {
    router.push({
      pathname: '/(auth)/verify-message',
      params: { address, message, signature },
    });
  };

  const handlePasteAddress = async () => {
    try {
      const content = await Clipboard.getStringAsync();
      if (content) {
        setAddress(content.trim());
        setValidationError('');
        await haptics.trigger('success');
      }
    } catch {}
  };

  const handleSelectAddress = (addr: string) => {
    setAddress(addr);
    setShowAddressPicker(false);
    setValidationError('');
    haptics.trigger('success');
  };

  const handlePasteMessage = async () => {
    try {
      const content = await Clipboard.getStringAsync();
      if (content) {
        setMessage(content.slice(0, MAX_MESSAGE_LENGTH));
        setValidationError('');
        await haptics.trigger('success');
      }
    } catch {}
  };

  // ─── Derived state ───────────────────────────────────────────

  const isReadyToSign = canSign && !!addressInfo && message.trim().length > 0;
  const screenBg = colors.background;
  const mutedColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)';
  const charCountColor = message.length >= MAX_MESSAGE_LENGTH
    ? '#FF453A'
    : (isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)');

  // ─── Render ──────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => { haptics.trigger('light'); router.back(); }}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={isDark ? '#FFFFFF' : '#000000'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Sign Message
        </Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} />

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={[styles.scrollContent, {
          paddingHorizontal: 16,
          paddingBottom: 120,
        }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
          {/* Watch-only / Multisig warning */}
          {!canSign && (
            <InfoCard
              icon="warning-outline"
              text={isWatchOnly
                ? 'Message signing is not available for watch-only wallets. Private keys are required to sign messages.'
                : 'Message signing is only supported for single-sig addresses. Multisig signing is not supported.'}
              variant="warning"
              delay={80}
            />
          )}

          {/* Inline validation error */}
          {validationError.length > 0 && (
            <Animated.View entering={FadeIn.duration(200)}>
              <InfoCard
                icon="alert-circle-outline"
                text={validationError}
                variant="warning"
                delay={0}
              />
            </Animated.View>
          )}

          {/* ── Address Card ────────────────────────────────────── */}
          <SectionLabel text="Address" first />
          <SettingsCard delay={100}>
            <SettingsRow
              icon="location-outline"
              label={address ? truncateAddress(address) : 'Select Address'}
              description={
                address
                  ? (addressInfo
                    ? `${addressInfo.path} · Index ${addressInfo.index}`
                    : 'Not found in wallet')
                  : 'Tap to choose an address'
              }
              onPress={() => {
                haptics.trigger('selection');
                setShowAddressPicker(true);
              }}
              showArrow
              showDivider={false}
              disabled={!canSign}
            >
              {address ? (
                <View style={styles.addressTrailing}>
                  {addressInfo ? (
                    <StatusPill label="Owned" variant="success" icon="checkmark-circle" />
                  ) : (
                    <StatusPill label="Not owned" variant="error" icon="close-circle" />
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}
                  />
                </View>
              ) : undefined}
            </SettingsRow>
          </SettingsCard>

          {/* Paste address action */}
          {canSign && !address && (
            <Animated.View entering={FadeIn.delay(120).duration(300)} style={styles.pasteRow}>
              <InlineActionButton icon="clipboard-outline" label="Paste Address" onPress={handlePasteAddress} />
            </Animated.View>
          )}

          {/* ── Message Card ────────────────────────────────────── */}
          <SectionLabel text="Message" />
          <Animated.View entering={FadeIn.delay(150).duration(300)}>
            <PremiumInputCard>
              <PremiumInput
                icon="document-text-outline"
                iconColor="#007AFF"
                value={message}
                onChangeText={(text) => {
                  setMessage(text.slice(0, MAX_MESSAGE_LENGTH));
                  if (validationError) setValidationError('');
                }}
                placeholder="Enter message to sign"
                multiline
                numberOfLines={4}
                editable={canSign}
                rowStyle={{ minHeight: 100 }}
              />
            </PremiumInputCard>
          </Animated.View>

          {/* Character count + Paste row */}
          <View style={styles.messageFooter}>
            <Text style={[styles.charCount, { color: charCountColor }]}>
              {message.length}/{MAX_MESSAGE_LENGTH}
            </Text>
            {canSign && !message && (
              <Animated.View entering={FadeIn.delay(180).duration(300)}>
                <InlineActionButton icon="clipboard-outline" label="Paste Message" onPress={handlePasteMessage} />
              </Animated.View>
            )}
          </View>

          {/* ── Signature Result ─────────────────────────────────── */}
          {signature.length > 0 && (
            <SignatureResultCard
              signature={signature}
              address={address}
              message={message}
              onCopy={handleCopySignature}
              onShare={handleShareSignature}
              onCopyBundle={handleCopyBundle}
              onVerify={handleVerifySignature}
            />
          )}
        </ScrollView>

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      {!signature && (
        <KeyboardSafeBottomBar backgroundColor={screenBg} horizontalPadding={16}>
          <PrimaryBottomButton
            label={isLoading ? 'Signing...' : 'Sign Message'}
            icon="pencil"
            onPress={handleSign}
            disabled={!isReadyToSign}
            loading={isLoading}
          />
        </KeyboardSafeBottomBar>
      )}

      {/* ── Address Picker Sheet ─────────────────────────────────── */}
      <AddressPickerSheet
        visible={showAddressPicker}
        onClose={() => setShowAddressPicker(false)}
        addresses={receivingAddresses}
        selectedAddress={address}
        onSelect={handleSelectAddress}
      />

      {/* ── PIN Modal ────────────────────────────────────────────── */}
      <Modal visible={showPinModal} animationType="slide" presentationStyle="fullScreen">
        <PinCodeScreen
          mode="verify"
          title="Sign Message"
          subtitle="Enter PIN to sign with your private key"
          icon="pencil"
          iconColor="#F7931A"
          onVerify={handlePinVerify}
          onSuccess={handlePinSuccess}
          onCancel={() => setShowPinModal(false)}
        />
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex1: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollContent: {
    paddingTop: 8,
  },
  addressTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pasteRow: {
    alignItems: 'flex-start',
    marginTop: -4,
    marginBottom: 4,
    marginLeft: 4,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -4,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
});
