import '../../shim';
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from '@bitcoinerlab/secp256k1';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme, useHaptics } from '../../src/hooks';
import {
  InfoCard,
  SectionLabel,
  InlineActionButton,
  PrimaryBottomButton,
  ResultCard,
  KeyboardSafeBottomBar,
} from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';

const ECPair = ECPairFactory(ecc);

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

// Parse a Bitcoin Signed Message bundle format
function parseSignedMessageBundle(text: string): {
  address: string;
  message: string;
  signature: string;
} | null {
  try {
    const msgMatch = text.match(
      /-----BEGIN BITCOIN SIGNED MESSAGE-----\n([\s\S]*?)\n-----BEGIN SIGNATURE-----/
    );
    const sigMatch = text.match(
      /-----BEGIN SIGNATURE-----\n([\s\S]*?)\n-----END BITCOIN SIGNED MESSAGE-----/
    );

    if (!msgMatch || !sigMatch) return null;

    const messageContent = msgMatch[1];
    const sigBlock = sigMatch[1].trim().split('\n');

    if (sigBlock.length < 2) return null;

    const addr = sigBlock[0].trim();
    const sig = sigBlock[1].trim();

    if (!addr || !sig) return null;

    return { address: addr, message: messageContent, signature: sig };
  } catch {
    return null;
  }
}

type VerificationResult = 'valid' | 'invalid' | 'none';

export default function VerifyMessageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ address?: string; message?: string; signature?: string }>();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const haptics = useHaptics();

  const [address, setAddress] = useState(params.address || '');
  const [message, setMessage] = useState(params.message || '');
  const [signature, setSignature] = useState(params.signature || '');
  const [verificationResult, setVerificationResult] = useState<VerificationResult>('none');
  const [errorDetail, setErrorDetail] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Reset result when inputs change
  useEffect(() => {
    if (verificationResult !== 'none') {
      setVerificationResult('none');
      setErrorDetail('');
    }
  }, [address, message, signature]);

  // ─── Inline Validation ─────────────────────────────────────────

  const addressFormatError = useMemo(() => {
    if (!address.trim()) return '';
    const validPrefixes = ['bc1', 'tb1', '1', '3', 'm', 'n', '2'];
    if (!validPrefixes.some(p => address.startsWith(p))) {
      return 'Invalid Bitcoin address format';
    }
    // Basic length check
    if (address.length < 25 || address.length > 90) {
      return 'Address length is outside valid range';
    }
    return '';
  }, [address]);

  const signatureFormatError = useMemo(() => {
    if (!signature.trim()) return '';
    try {
      const buf = Buffer.from(signature.trim(), 'base64');
      if (buf.length !== 65) return 'Signature must be exactly 65 bytes';
      const flag = buf[0];
      if (flag < 27 || flag >= 39) return 'Invalid recovery flag in signature';
      return '';
    } catch {
      return 'Invalid base64 encoding';
    }
  }, [signature]);

  // Verify button: disabled when ANY format error exists or fields empty
  const canVerify = address.trim().length > 0
    && message.trim().length > 0
    && signature.trim().length > 0
    && !addressFormatError
    && !signatureFormatError;

  // ─── Handlers ────────────────────────────────────────────────

  const handlePaste = async (field: 'address' | 'message' | 'signature') => {
    try {
      const content = await Clipboard.getStringAsync();
      if (content) {
        // Check if pasting a full bundle into any field
        const bundle = parseSignedMessageBundle(content);
        if (bundle) {
          setAddress(bundle.address);
          setMessage(bundle.message);
          setSignature(bundle.signature);
          await haptics.trigger('success');
          return;
        }

        switch (field) {
          case 'address': setAddress(content.trim()); break;
          case 'message': setMessage(content); break;
          case 'signature': setSignature(content.trim()); break;
        }
        await haptics.trigger('success');
      }
    } catch {}
  };

  const handleClear = async () => {
    await haptics.trigger('selection');
    setAddress('');
    setMessage('');
    setSignature('');
    setVerificationResult('none');
    setErrorDetail('');
  };

  const handleVerify = async () => {
    // Button is already disabled for empty/invalid fields,
    // but guard just in case
    if (!canVerify) return;

    setIsVerifying(true);
    setVerificationResult('none');
    setErrorDetail('');

    try {
      // Decode the signature from base64
      const signatureBuffer = Buffer.from(signature.trim(), 'base64');

      if (signatureBuffer.length !== 65) {
        throw new Error('Invalid signature length. Expected 65 bytes (Base64).');
      }

      // Extract recovery flag and 64-byte signature
      const recoveryFlag = signatureBuffer[0];
      const sigOnly = signatureBuffer.slice(1, 65);

      // Determine compression and recovery ID from flag (BIP-137):
      // 27-30: uncompressed P2PKH
      // 31-34: compressed P2PKH / P2WPKH
      // 35-38: compressed P2SH-P2WPKH
      let compressed: boolean;
      let recoveryId: number;

      if (recoveryFlag >= 39) {
        throw new Error('Unsupported recovery flag in signature.');
      } else if (recoveryFlag >= 35) {
        // P2SH-P2WPKH (compressed)
        compressed = true;
        recoveryId = recoveryFlag - 35;
      } else if (recoveryFlag >= 31) {
        // Compressed P2PKH or P2WPKH
        compressed = true;
        recoveryId = recoveryFlag - 31;
      } else if (recoveryFlag >= 27) {
        // Uncompressed P2PKH
        compressed = false;
        recoveryId = recoveryFlag - 27;
      } else {
        throw new Error('Invalid recovery flag in signature.');
      }

      // Create the message hash (Bitcoin signed message format)
      // Format: varint(len(prefix)) + prefix + varint(len(msg)) + msg
      const messagePrefix = '\x18Bitcoin Signed Message:\n';
      const messageBuffer = Buffer.from(message);
      const messagePrefixBuffer = Buffer.from(messagePrefix);
      const lengthBuffer = encodeVarint(messageBuffer.length);

      const fullMessage = Buffer.concat([messagePrefixBuffer, lengthBuffer, messageBuffer]);
      const messageHash = bitcoin.crypto.hash256(fullMessage);

      // Recover the public key from the signature
      const recoveredPubKey = ecc.recover(
        messageHash,
        sigOnly,
        recoveryId as 0 | 1 | 2 | 3,
        compressed
      );

      if (!recoveredPubKey) {
        throw new Error('Could not recover public key from signature.');
      }

      // Derive address from recovered public key based on address format
      let derivedAddress: string;

      if (address.startsWith('bc1') || address.startsWith('tb1')) {
        const net = address.startsWith('tb1') ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
        const { address: bech32Address } = bitcoin.payments.p2wpkh({
          pubkey: Buffer.from(recoveredPubKey),
          network: net,
        });
        derivedAddress = bech32Address || '';
      } else if (address.startsWith('3') || address.startsWith('2')) {
        const net = address.startsWith('2') ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
        const { address: p2shAddress } = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: Buffer.from(recoveredPubKey),
            network: net,
          }),
          network: net,
        });
        derivedAddress = p2shAddress || '';
      } else {
        const net = address.startsWith('m') || address.startsWith('n')
          ? bitcoin.networks.testnet
          : bitcoin.networks.bitcoin;
        const { address: legacyAddress } = bitcoin.payments.p2pkh({
          pubkey: Buffer.from(recoveredPubKey),
          network: net,
        });
        derivedAddress = legacyAddress || '';
      }

      const isValid = derivedAddress.toLowerCase() === address.trim().toLowerCase();

      setVerificationResult(isValid ? 'valid' : 'invalid');
      if (!isValid) {
        setErrorDetail('The signature does not match the provided address. The message may have been altered or the address is incorrect.');
      }

      if (isValid) {
        await haptics.trigger('success');
      } else {
        await haptics.trigger('error');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setVerificationResult('invalid');
      setErrorDetail(err?.message || 'Invalid signature format.');
      await haptics.trigger('error');
      Alert.alert('Error', 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  // ─── Derived state ───────────────────────────────────────────

  const screenBg = colors.background;
  const mutedText = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';

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
          Verify Message
        </Text>
        <TouchableOpacity
          onPress={handleClear}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear all fields"
        >
          <Text style={[styles.clearText, {
            color: (address || message || signature) ? '#F7931A' : mutedText,
          }]}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.flex1}
        contentContainerStyle={[styles.scrollContent, {
          paddingHorizontal: 16,
          paddingBottom: 120,
        }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
          {/* Paste Bundle hint */}
          <Animated.View entering={FadeIn.delay(40).duration(400)}>
            <InfoCard
              icon="document-text-outline"
              text="Paste a signed message bundle to auto-fill all fields, or enter each field individually."
              variant="info"
              delay={0}
            />
          </Animated.View>

          {/* ── Input Fields ────────────────────────────────────── */}
          <Animated.View entering={FadeIn.delay(80).duration(400)}>
            <View style={styles.inputHeader}>
              <SectionLabel text="Address" first />
              <InlineActionButton icon="clipboard-outline" label="Paste" onPress={() => handlePaste('address')} />
            </View>
            <PremiumInputCard>
              <PremiumInput
                icon="wallet-outline"
                iconColor="#FF9F0A"
                placeholder="Enter Bitcoin address"
                value={address}
                onChangeText={setAddress}
                monospace
              />
            </PremiumInputCard>
            {/* Inline address validation */}
            {addressFormatError.length > 0 && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.fieldError}>
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color="#FF9500"
                />
                <Text style={[styles.fieldErrorText, {
                  color: isDark ? 'rgba(255,150,0,0.85)' : 'rgba(200,120,0,0.85)',
                }]}>
                  {addressFormatError}
                </Text>
              </Animated.View>
            )}
          </Animated.View>

          {/* ── Message ─────────────────────────────────────────── */}
          <Animated.View entering={FadeIn.delay(120).duration(400)}>
            <View style={styles.inputHeader}>
              <SectionLabel text="Message" />
              <InlineActionButton icon="clipboard-outline" label="Paste" onPress={() => handlePaste('message')} />
            </View>
            <PremiumInputCard>
              <PremiumInput
                icon="document-text-outline"
                iconColor="#007AFF"
                placeholder="Enter the signed message"
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={4}
              />
            </PremiumInputCard>
          </Animated.View>

          {/* ── Signature ───────────────────────────────────────── */}
          <Animated.View entering={FadeIn.delay(160).duration(400)}>
            <View style={styles.inputHeader}>
              <SectionLabel text="Signature (Base64)" />
              <InlineActionButton icon="clipboard-outline" label="Paste" onPress={() => handlePaste('signature')} />
            </View>
            <PremiumInputCard>
              <PremiumInput
                icon="key-outline"
                iconColor="#BF5AF2"
                placeholder="Enter Base64 signature"
                value={signature}
                onChangeText={setSignature}
                monospace
                multiline
                numberOfLines={3}
              />
            </PremiumInputCard>
            {/* Inline signature validation */}
            {signatureFormatError.length > 0 && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.fieldError}>
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color="#FF9500"
                />
                <Text style={[styles.fieldErrorText, {
                  color: isDark ? 'rgba(255,150,0,0.85)' : 'rgba(200,120,0,0.85)',
                }]}>
                  {signatureFormatError}
                </Text>
              </Animated.View>
            )}
          </Animated.View>

          {/* ── Verification Result ──────────────────────────────── */}
          {verificationResult !== 'none' && (
            <Animated.View entering={FadeIn.duration(300)}>
              <ResultCard
                variant={verificationResult === 'valid' ? 'success' : 'error'}
                title={verificationResult === 'valid' ? 'Valid Signature' : 'Invalid Signature'}
                description={
                  verificationResult === 'valid'
                    ? 'This message was signed by the owner of the provided address.'
                    : (errorDetail || 'The signature does not match the address or the message has been tampered with.')
                }
              />
            </Animated.View>
          )}
        </ScrollView>

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      <KeyboardSafeBottomBar backgroundColor={screenBg} horizontalPadding={16}>
        <PrimaryBottomButton
          label={isVerifying ? 'Verifying...' : 'Verify Signature'}
          icon="shield-checkmark"
          onPress={handleVerify}
          disabled={!canVerify}
          loading={isVerifying}
        />
      </KeyboardSafeBottomBar>
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
    paddingBottom: 8,
  },
  headerBtn: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  clearText: {
    fontSize: 15,
    fontWeight: '500',
  },
  scrollContent: {
    paddingTop: 8,
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  fieldErrorText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
