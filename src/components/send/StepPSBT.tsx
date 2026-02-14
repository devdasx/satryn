/**
 * StepPSBT — Multisig Signature Manager.
 *
 * Full-featured scrollable screen:
 * 1. Shows real-time signature progress (which cosigners have signed, how many remain)
 * 2. Per-cosigner interactive rows: "Sign" for local keys, "Import" for external cosigners
 * 3. Can import signed PSBTs from external cosigners (QR scan, clipboard paste, file picker)
 * 4. Shows a "Finalize & Broadcast" button when m-of-n signatures are collected
 * 5. Collapsible share/export section for external signing
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import QRCodeSVG from 'react-native-qrcode-svg';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';
import { useSendStore } from '../../stores/sendStore';
import { useWalletStore } from '../../stores/walletStore';
import { AppButton } from '../ui/AppButton';
import { CosignerSignatureRow } from './CosignerSignatureRow';
import { PSBTImportSheet } from './PSBTImportSheet';

interface StepPSBTProps {
  onDone: () => void;
  onBroadcastSuccess?: () => void;
}

export function StepPSBT({ onDone, onBroadcastSuccess }: StepPSBTProps) {
  const { colors } = useTheme();

  // Store selectors
  const psbtBase64 = useSendStore((s) => s.psbtBase64);
  const signatureStatus = useSendStore((s) => s.signatureStatus);
  const walletCapability = useSendStore((s) => s.walletCapability);
  const isBroadcasting = useSendStore((s) => s.isBroadcasting);

  const multisigConfig = useWalletStore((s) => s.multisigConfig);

  // Local state
  const [signingFingerprint, setSigningFingerprint] = useState<string | null>(null);
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [showShareSection, setShowShareSection] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const qrRef = useRef<any>(null);

  // Determine if this is a multisig flow
  const isMultisig = walletCapability === 'multisig' && multisigConfig !== null;

  // Signature info
  const requiredSigs = signatureStatus?.requiredSigs ?? multisigConfig?.m ?? 0;
  const presentSigs = signatureStatus?.presentSigs ?? 0;
  const signers = signatureStatus?.signers ?? [];
  const canFinalize = signatureStatus?.canFinalize ?? false;
  const progressPercent = requiredSigs > 0 ? Math.min((presentSigs / requiredSigs) * 100, 100) : 0;

  // Check for any external unsigned cosigners (to know whether to show Import in share section)
  const hasExternalUnsigned = signers.some((s) => !s.isLocal && !s.hasSigned);

  // ── Per-cosigner signing ────────────────────────────────
  const handleSignCosigner = useCallback(async (fingerprint: string) => {
    if (__DEV__) console.log(`[StepPSBT.handleSignCosigner] CALLED — fingerprint=${fingerprint}`);

    const { SensitiveSession } = await import('../../services/auth/SensitiveSession');
    const pin = SensitiveSession.getPin();

    if (!pin) {
      Alert.alert(
        'Session Expired',
        'Your PIN session has expired. Please go back and re-enter your PIN.',
      );
      return;
    }

    setSigningFingerprint(fingerprint);
    try {
      await useSendStore.getState().signWithSpecificCosigner(pin, fingerprint);
      if (__DEV__) console.log(`[StepPSBT.handleSignCosigner] SUCCESS`);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      if (__DEV__) console.log(`[StepPSBT.handleSignCosigner] ERROR — ${err.message}`);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Signing Failed', err.message || 'Could not sign with this key.');
    } finally {
      setSigningFingerprint(null);
    }
  }, []);

  // ── Import signed PSBT ────────────────────────────────
  const handleImport = useCallback(async (base64: string) => {
    return useSendStore.getState().importSignedPSBT(base64);
  }, []);

  // ── Finalize & Broadcast ────────────────────────────────
  const handleFinalizeAndBroadcast = useCallback(() => {
    Alert.alert(
      'Finalize & Broadcast',
      `All ${requiredSigs} required signatures have been collected. Broadcast this transaction to the Bitcoin network?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Broadcast',
          style: 'default',
          onPress: async () => {
            try {
              await useSendStore.getState().finalizeAndBroadcast();
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              if (onBroadcastSuccess) {
                onBroadcastSuccess();
              }
            } catch (err: any) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Broadcast Failed', err.message || 'Transaction could not be broadcast.');
            }
          },
        },
      ],
    );
  }, [requiredSigs, onBroadcastSuccess]);

  // ── Copy PSBT ────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!psbtBase64) return;
    await Clipboard.setStringAsync(psbtBase64);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [psbtBase64]);

  // ── Share PSBT ────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!psbtBase64) return;
    try {
      await Share.share({
        message: psbtBase64,
        ...(Platform.OS === 'ios' ? { url: `data:application/octet-stream;base64,${psbtBase64}` } : {}),
      });
    } catch {
      // User cancelled
    }
  }, [psbtBase64]);

  // ─── Watch-only / non-multisig fallback ──────────────────────────
  if (!isMultisig) {
    return (
      <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: colors.fillSecondary }]}>
              <Ionicons name="document-text-outline" size={32} color={THEME.brand.bitcoin} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Unsigned Transaction</Text>
            <Text style={[styles.description, { color: colors.textTertiary }]}>
              This unsigned PSBT needs to be signed by the wallet that holds the private keys.
            </Text>
          </View>

          {psbtBase64 && (
            <View style={styles.qrSection}>
              <View style={styles.qrWrapper}>
                <QRCodeSVG
                  value={psbtBase64}
                  size={180}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  ecl="L"
                  getRef={(ref: any) => { qrRef.current = ref; }}
                />
              </View>
              <Text style={[styles.qrHint, { color: colors.textMuted }]}>Scan with a signing device</Text>
            </View>
          )}

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.copyButton, { backgroundColor: colors.fillSecondary }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Ionicons name={isCopied ? 'checkmark' : 'copy-outline'} size={18} color={colors.text} />
              <Text style={[styles.copyText, { color: colors.text }]}>
                {isCopied ? 'Copied!' : 'Copy PSBT'}
              </Text>
            </TouchableOpacity>
            <AppButton title="Share PSBT" onPress={handleShare} variant="primary" icon="share-outline" />
          </View>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.7}>
            <Text style={[styles.doneText, { color: colors.textTertiary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // ─── Multisig Signature Manager ──────────────────────────────

  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ─── Signature Progress Hero ──────────────────────────── */}
        <Animated.View entering={FadeInUp.delay(100).duration(300)} style={styles.hero}>
          <View style={[styles.progressRing, { borderColor: `${THEME.brand.bitcoin}30` }]}>
            <View style={[
              styles.progressRingInner,
              {
                backgroundColor: canFinalize ? `${THEME.brand.bitcoin}10` : colors.fillSecondary,
                borderColor: canFinalize ? THEME.brand.bitcoin : 'transparent',
                borderWidth: canFinalize ? 2 : 0,
              },
            ]}>
              <Text style={[styles.progressNum, { color: canFinalize ? THEME.brand.bitcoin : colors.text }]}>
                {presentSigs}
              </Text>
              <View style={styles.progressDivider}>
                <Text style={[styles.progressOf, { color: colors.textMuted }]}>of {requiredSigs}</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.heroTitle, { color: colors.text }]}>
            {canFinalize
              ? 'Ready to Broadcast'
              : `${requiredSigs - presentSigs} more signature${requiredSigs - presentSigs !== 1 ? 's' : ''} needed`}
          </Text>

          {/* Progress bar */}
          <View style={[styles.progressBar, { backgroundColor: colors.fillTertiary }]}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  backgroundColor: THEME.brand.bitcoin,
                  width: `${progressPercent}%`,
                },
              ]}
            />
          </View>
        </Animated.View>

        {/* ─── Cosigner Rows (interactive) ──────────────────────── */}
        <Animated.View entering={FadeInUp.delay(200).duration(300)} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>COSIGNERS</Text>
          <View style={styles.cosignerList}>
            {signers.map((signer, index) => (
              <CosignerSignatureRow
                key={`${signer.fingerprint}-${index}`}
                name={signer.name}
                fingerprint={signer.fingerprint}
                hasSigned={signer.hasSigned}
                isLocal={signer.isLocal}
                onSign={
                  signer.isLocal && !signer.hasSigned
                    ? () => handleSignCosigner(signer.fingerprint)
                    : undefined
                }
                onImport={
                  !signer.isLocal && !signer.hasSigned
                    ? () => setShowImportSheet(true)
                    : undefined
                }
                isSigning={signingFingerprint === signer.fingerprint}
              />
            ))}
          </View>
        </Animated.View>

        {/* ─── Finalize & Broadcast ──────────────────────────────── */}
        {canFinalize && (
          <Animated.View entering={FadeInUp.delay(300).duration(300)} style={styles.section}>
            <View style={[styles.broadcastCard, { backgroundColor: `${THEME.brand.bitcoin}08` }]}>
              <View style={[styles.broadcastIconWrap, { backgroundColor: `${THEME.brand.bitcoin}15` }]}>
                <Ionicons name="rocket-outline" size={24} color={THEME.brand.bitcoin} />
              </View>
              <Text style={[styles.broadcastLabel, { color: colors.text }]}>
                All signatures collected
              </Text>
              <AppButton
                title={isBroadcasting ? 'Broadcasting...' : 'Finalize & Broadcast'}
                onPress={handleFinalizeAndBroadcast}
                variant="primary"
                icon="rocket-outline"
                loading={isBroadcasting}
                disabled={isBroadcasting}
              />
            </View>
          </Animated.View>
        )}

        {/* ─── Share / Export PSBT ──────────────────────────────── */}
        <Animated.View entering={FadeInUp.delay(400).duration(300)} style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeaderRow}
            onPress={() => setShowShareSection(!showShareSection)}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="share-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                SHARE FOR EXTERNAL SIGNING
              </Text>
            </View>
            <Ionicons
              name={showShareSection ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {showShareSection && psbtBase64 && (
            <View style={styles.shareContent}>
              <View style={styles.qrSection}>
                <View style={styles.qrWrapper}>
                  <QRCodeSVG
                    value={psbtBase64}
                    size={150}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                    ecl="L"
                    getRef={(ref: any) => { qrRef.current = ref; }}
                  />
                </View>
                <Text style={[styles.qrHint, { color: colors.textMuted }]}>
                  Scan with cosigner device
                </Text>
              </View>

              <View style={styles.shareButtons}>
                <TouchableOpacity
                  style={[styles.shareButton, { backgroundColor: colors.fillSecondary }]}
                  onPress={handleCopy}
                  activeOpacity={0.7}
                >
                  <Ionicons name={isCopied ? 'checkmark' : 'copy-outline'} size={16} color={colors.text} />
                  <Text style={[styles.shareButtonText, { color: colors.text }]}>
                    {isCopied ? 'Copied!' : 'Copy'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.shareButton, { backgroundColor: colors.fillSecondary }]}
                  onPress={handleShare}
                  activeOpacity={0.7}
                >
                  <Ionicons name="share-outline" size={16} color={colors.text} />
                  <Text style={[styles.shareButtonText, { color: colors.text }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>

        {/* Extra bottom padding */}
        <View style={{ height: 20 }} />

      </ScrollView>

      {/* ─── Bottom Done Button ──────────────────────────────── */}
      <View style={[styles.bottomBar, { borderTopColor: colors.fillTertiary }]}>
        <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.7}>
          <Text style={[styles.doneText, { color: colors.textTertiary }]}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* ─── Import Sheet ──────────────────────────────── */}
      <PSBTImportSheet
        visible={showImportSheet}
        onClose={() => setShowImportSheet(false)}
        onImport={handleImport}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },

  // ─── Header (watch-only fallback) ─────────
  header: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },

  // ─── Hero (signature progress) ─────────
  hero: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  progressRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingInner: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressNum: {
    fontSize: 32,
    fontWeight: '800',
  },
  progressDivider: {
    marginTop: -2,
  },
  progressOf: {
    fontSize: 13,
    fontWeight: '500',
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressBar: {
    width: '80%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // ─── Sections ─────────
  section: {
    marginBottom: 20,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // ─── Cosigner list ─────────
  cosignerList: {
    gap: 8,
  },

  // ─── Broadcast card ─────────
  broadcastCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  broadcastIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  broadcastLabel: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ─── QR ─────────
  qrSection: {
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 16,
  },
  qrHint: {
    fontSize: 12,
  },

  // ─── Share section ─────────
  shareContent: {
    gap: 12,
  },
  shareButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // ─── Buttons ─────────
  actionButtons: {
    gap: 10,
    marginTop: 16,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  copyText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ─── Bottom bar ─────────
  bottomBar: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
