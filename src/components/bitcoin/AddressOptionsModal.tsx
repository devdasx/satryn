import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Share,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCodeSVG from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';
import { useTheme, useHaptics } from '../../hooks';
import { SecureStorage } from '../../services/storage/SecureStorage';
import { SeedGenerator, KeyDerivation } from '../../core/wallet';
import { useWalletStore, useMultiWalletStore, useSettingsStore } from '../../stores';
import { SensitiveSession } from '../../services/auth/SensitiveSession';
import { keyDerivationFromSecureStorage } from '../../services/wallet/KeyDerivationFactory';
import { PinCodeScreen } from '../security';
import { AppBottomSheet } from '../ui';
import type { AddressInfo } from '../../types';

interface AddressOptionsModalProps {
  visible: boolean;
  address: AddressInfo | null;
  onClose: () => void;
  onMarkAsUsed?: (address: string) => void;
}

type ModalView = 'options' | 'qr' | 'wif';

export function AddressOptionsModal({
  visible,
  address,
  onClose,
  onMarkAsUsed,
}: AddressOptionsModalProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const usedAddresses = useWalletStore(s => s.usedAddresses);
  const markAddressAsUsed = useWalletStore(s => s.markAddressAsUsed);
  const { getActiveWallet } = useMultiWalletStore();
  const { biometricsEnabled } = useSettingsStore();
  const activeWallet = getActiveWallet();

  const [view, setView] = useState<ModalView>('options');
  const [showPinModal, setShowPinModal] = useState(false);
  const [wif, setWif] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Determine wallet capabilities
  const isWatchOnly = activeWallet?.type === 'watch_xpub'
    || activeWallet?.type === 'watch_descriptor'
    || activeWallet?.type === 'watch_addresses';
  const isMultisig = activeWallet?.type === 'multisig';
  const canExportWIF = !isWatchOnly && !isMultisig;
  const canSign = !isWatchOnly && !isMultisig;

  // Reset state when closing
  useEffect(() => {
    if (!visible) {
      setView('options');
      setShowPinModal(false);
      setWif(null);
      setCopied(null);
    }
  }, [visible]);

  const handleCopy = async (text: string, type: string) => {
    await Clipboard.setStringAsync(text);
    await haptics.trigger('success');
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleShowQR = async () => {
    await haptics.trigger('selection');
    setView('qr');
  };

  const handleExportWIF = async () => {
    if (!address) return;
    await haptics.trigger('selection');

    // Always require PIN entry for private key export — never skip authentication
    setShowPinModal(true);
  };

  const handleMarkAsUsed = async () => {
    if (!address) return;
    await haptics.trigger('medium');

    const isUsed = usedAddresses.has(address.address);

    Alert.alert(
      isUsed ? 'Already Used' : 'Mark as Used?',
      isUsed
        ? 'This address is already marked as used.'
        : 'This will skip this address when generating new receive addresses. The address will still work normally.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(!isUsed ? [{
          text: 'Mark Used',
          onPress: () => {
            markAddressAsUsed(address.address);
            onMarkAsUsed?.(address.address);
            onClose();
          },
        }] : []),
      ]
    );
  };

  const handleShare = async () => {
    if (!address) return;
    await haptics.trigger('selection');

    try {
      await Share.share({
        message: address.address,
        title: 'Bitcoin Address',
      });
    } catch (err) {
    }
  };

  // PIN verification for WIF export — uses the standard PinCodeScreen component
  const handlePinVerify = useCallback(async (enteredPin: string) => {
    const isValid = await SecureStorage.verifyPin(enteredPin);
    if (!isValid) return { success: false, error: 'Incorrect PIN' };
    return { success: true };
  }, []);

  const handlePinSuccess = useCallback(async (enteredPin: string) => {
    if (!address || !activeWallet) return;

    SensitiveSession.start(enteredPin);

    try {
      const keyDerivation = await keyDerivationFromSecureStorage(
        activeWallet.id, activeWallet.type, network, enteredPin
      );
      const wifKey = keyDerivation.getWIF(address.path);
      keyDerivation.destroy();

      setWif(wifKey);
      setShowPinModal(false);
      setView('wif');
    } catch (err) {
    }
  }, [address, network, activeWallet]);

  const handleBiometricSuccess = useCallback(async () => {
    const pin = SensitiveSession.getPin();
    if (pin) {
      const isValid = await SecureStorage.verifyPin(pin);
      return { success: isValid, pin: isValid ? pin : undefined };
    }
    return { success: false };
  }, []);

  const handleBack = async () => {
    await haptics.trigger('light');
    if (view === 'wif') {
      Alert.alert(
        'Clear Private Key?',
        'Make sure you have saved your private key securely.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Go Back',
            onPress: () => {
              setWif(null);
              setView('options');
            },
          },
        ]
      );
    } else {
      setView('options');
    }
  };

  if (!address) return null;

  const isUsed = usedAddresses.has(address.address);

  // Derived colors
  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const mutedText = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';

  // Get address type label
  const getAddressTypeLabel = () => {
    switch (address.type) {
      case 'native_segwit': return 'Native SegWit';
      case 'wrapped_segwit': return 'Wrapped SegWit';
      case 'taproot': return 'Taproot';
      default: return 'Legacy';
    }
  };

  // Get title and subtitle for the sheet
  const getSheetTitle = () => {
    if (view === 'options') return address.isChange ? 'Change Address' : 'Receiving Address';
    if (view === 'qr') return 'Address QR Code';
    if (view === 'wif') return 'Private Key (WIF)';
    return '';
  };

  const getSheetSubtitle = () => {
    if (view === 'options') return `${getAddressTypeLabel()} · #${address.index}`;
    return undefined;
  };

  // Determine sizing based on view
  const getSizing = () => {
    switch (view) {
      case 'wif': return 'medium';
      default: return 'auto';
    }
  };

  // Option button renderer
  const renderOptionButton = (
    icon: string,
    iconColor: string,
    bgColor: string,
    label: string,
    onPress: () => void,
    isLast: boolean = false
  ) => (
    <TouchableOpacity
      style={[
        styles.optionButton,
        { backgroundColor: chipBg },
        !isLast && { marginBottom: 7 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.optionButtonLeft}>
        <View style={[styles.optionIcon, { backgroundColor: bgColor }]}>
          <Ionicons name={icon as any} size={20} color={iconColor} />
        </View>
        <Text style={[styles.optionButtonText, { color: colors.text }]}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={mutedText} />
    </TouchableOpacity>
  );

  return (
    <AppBottomSheet
      visible={visible}
      onClose={view === 'options' ? onClose : () => {}}
      sizing={getSizing()}
      enablePanDownToClose={view === 'options'}
      title={getSheetTitle()}
      subtitle={getSheetSubtitle()}
      showCloseButton={view === 'options'}
    >
      {/* Options View */}
      {view === 'options' && (
        <View style={styles.optionsContainer}>
          {/* Address Display */}
          <View style={[styles.addressBox, { backgroundColor: chipBg }]}>
            <Text style={[styles.addressText, { color: colors.text }]} numberOfLines={2}>
              {address.address}
            </Text>
            <Text style={[styles.pathText, { color: mutedText }]}>
              {address.path}
            </Text>
            {isUsed && (
              <View style={[styles.usedBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
                <Text style={[styles.usedBadgeText, { color: colors.textSecondary }]}>Used</Text>
              </View>
            )}
          </View>

          {/* Options */}
          <View style={styles.optionsList}>
            {/* Always available */}
            {renderOptionButton(
              copied === 'address' ? 'checkmark' : 'copy-outline',
              colors.success,
              colors.success + '15',
              copied === 'address' ? 'Copied!' : 'Copy Address',
              () => handleCopy(address.address, 'address')
            )}

            {renderOptionButton(
              'qr-code-outline',
              isDark ? '#FFFFFF' : '#0A0A0A',
              isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              'Show QR Code',
              handleShowQR
            )}

            {renderOptionButton(
              copied === 'path' ? 'checkmark' : 'git-branch-outline',
              colors.info,
              colors.info + '15',
              copied === 'path' ? 'Copied!' : 'Copy Derivation Path',
              () => handleCopy(address.path, 'path')
            )}

            {renderOptionButton(
              'share-outline',
              '#5856D6',
              '#5856D6' + '15',
              'Share Address',
              handleShare
            )}

            {/* Single-sig only (not watch-only, not multisig) */}
            {canExportWIF && renderOptionButton(
              'key-outline',
              colors.error,
              colors.error + '15',
              'Export Private Key (WIF)',
              handleExportWIF
            )}

            {canSign && renderOptionButton(
              'pencil-outline',
              colors.info,
              colors.info + '15',
              'Sign Message',
              async () => {
                await haptics.trigger('selection');
                onClose();
                router.push({
                  pathname: '/(auth)/sign-message',
                  params: { address: address?.address }
                });
              }
            )}

            {/* Verify message — available for all wallet types */}
            {renderOptionButton(
              'checkmark-done-outline',
              colors.success,
              colors.success + '15',
              'Verify Message',
              async () => {
                await haptics.trigger('selection');
                onClose();
                router.push('/(auth)/verify-message');
              }
            )}

            {/* Skip address — only for unused receiving addresses */}
            {!isUsed && !address.isChange && renderOptionButton(
              'eye-off-outline',
              colors.warning,
              colors.warning + '15',
              'Skip This Address',
              handleMarkAsUsed,
              true
            )}
          </View>
        </View>
      )}

      {/* QR View */}
      {view === 'qr' && (
        <View style={styles.qrViewContainer}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
            <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          <View style={styles.qrContainer}>
            <View style={styles.qrWrapper}>
              <QRCodeSVG
                value={address.address}
                size={220}
                backgroundColor="#FFFFFF"
                color="#000000"
                ecl="H"
                logo={require('../../../appIcon.png')}
                logoSize={38}
                logoBackgroundColor="#FFFFFF"
                logoMargin={3}
                logoBorderRadius={7}
              />
            </View>
            <Text style={[styles.qrAddress, { color: colors.textSecondary }]} numberOfLines={2}>
              {address.address}
            </Text>
          </View>

          <View style={styles.qrActions}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: isDark ? '#FFFFFF' : '#0A0A0A' }]}
              onPress={() => handleCopy(address.address, 'qr')}
              activeOpacity={0.8}
            >
              <Ionicons name={copied === 'qr' ? 'checkmark' : 'copy-outline'} size={20} color={isDark ? '#000000' : '#FFFFFF'} />
              <Text style={[styles.primaryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
                {copied === 'qr' ? 'Copied!' : 'Copy Address'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: chipBg }]}
              onPress={handleShare}
              activeOpacity={0.7}
            >
              <Ionicons name="share-outline" size={18} color={colors.text} />
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* PIN Modal — uses the standard PinCodeScreen component */}
      <Modal visible={showPinModal} animationType="slide" presentationStyle="fullScreen">
        <PinCodeScreen
          mode="verify"
          title="Export Private Key"
          subtitle="Enter PIN to reveal WIF"
          icon="key-outline"
          iconColor={colors.error}
          onVerify={handlePinVerify}
          onSuccess={handlePinSuccess}
          onCancel={() => setShowPinModal(false)}
          biometricEnabled={biometricsEnabled}
          onBiometricSuccess={handleBiometricSuccess}
        />
      </Modal>

      {/* WIF View */}
      {view === 'wif' && wif && (
        <View style={styles.wifViewContainer}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
            <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>

          <View style={styles.wifContainer}>
            <View style={[styles.wifWarning, { backgroundColor: colors.error + '15' }]}>
              <Ionicons name="warning" size={20} color={colors.error} />
              <Text style={[styles.wifWarningText, { color: colors.error }]}>
                Never share this key! Anyone with it can steal your funds.
              </Text>
            </View>

            <View style={[styles.wifBox, { backgroundColor: chipBg, borderColor: colors.error + '50' }]}>
              <Text style={[styles.wifLabel, { color: colors.error }]}>WIF PRIVATE KEY</Text>
              <Text style={[styles.wifText, { color: colors.text }]} selectable>
                {wif}
              </Text>
            </View>

            <View style={styles.wifActions}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.error }]}
                onPress={() => handleCopy(wif, 'wif')}
                activeOpacity={0.8}
              >
                <Ionicons name={copied === 'wif' ? 'checkmark' : 'copy-outline'} size={20} color="#FFFFFF" />
                <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
                  {copied === 'wif' ? 'Copied!' : 'Copy Private Key'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: chipBg }]}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </AppBottomSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Options View
  optionsContainer: {
    paddingBottom: 20,
  },
  addressBox: {
    marginHorizontal: 28,
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
  },
  addressText: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
    marginBottom: 6,
  },
  pathText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  usedBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 10,
  },
  usedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  optionsList: {
    paddingHorizontal: 28,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 54,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  optionButtonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },

  // Back button
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 4,
  },
  backButtonText: {
    fontSize: 17,
    fontWeight: '500',
  },

  // QR View
  qrViewContainer: {
    paddingBottom: 28,
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 28,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
  },
  qrAddress: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
  },
  qrActions: {
    paddingHorizontal: 28,
    gap: 7,
  },
  wifActions: {
    gap: 7,
  },

  // Primary button
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },

  // Secondary button
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 45,
    borderRadius: 24,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },

  // WIF View
  wifViewContainer: {
    paddingBottom: 28,
  },
  wifContainer: {
    paddingHorizontal: 28,
  },
  wifWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 20,
  },
  wifWarningText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  wifBox: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  wifLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  wifText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    lineHeight: 19,
  },
});
