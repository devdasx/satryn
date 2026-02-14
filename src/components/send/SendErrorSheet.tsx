/**
 * SendErrorSheet — Premium error detail bottom sheet for the send flow.
 * Shows the error, a human-readable explanation, suggested fixes, and contact support.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { AppButton } from '../ui/AppButton';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';

const SUPPORT_EMAIL = 'support@satryn.com';

// ─── Error Catalog ──────────────────────────────────────────────

interface ErrorInfo {
  title: string;
  description: string;
  suggestions: string[];
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

function classifyError(message: string): ErrorInfo {
  const lower = message.toLowerCase();

  // ── Insufficient funds ──
  if (lower.includes('insufficient funds')) {
    return {
      title: 'Insufficient Funds',
      description: 'Your wallet does not have enough Bitcoin to cover this transaction plus the network fee.',
      suggestions: [
        'Try sending a smaller amount',
        'Lower the network fee rate',
        'Use "Send Max" to send your entire balance',
        'Wait for pending transactions to confirm',
      ],
      icon: 'wallet-outline',
      color: '#FF6B6B',
    };
  }

  // ── No UTXOs ──
  if (lower.includes('no utxos available')) {
    return {
      title: 'No Spendable Coins',
      description: 'Your wallet has no unspent transaction outputs (UTXOs) available for spending.',
      suggestions: [
        'Wait for incoming transactions to confirm',
        'Sync your wallet to fetch the latest data',
        'Verify your wallet has received funds',
      ],
      icon: 'cube-outline',
      color: '#FF9F0A',
    };
  }

  // ── No valid recipients ──
  if (lower.includes('no valid recipients')) {
    return {
      title: 'No Valid Recipients',
      description: 'No recipients with a valid Bitcoin address and amount were found.',
      suggestions: [
        'Go back and verify the recipient address',
        'Make sure you entered an amount greater than zero',
        'Check that the address format is correct',
      ],
      icon: 'person-outline',
      color: '#BF5AF2',
    };
  }

  // ── Invalid address ──
  if (lower.includes('invalid') && (lower.includes('address') || lower.includes('recipient'))) {
    return {
      title: 'Invalid Address',
      description: 'The Bitcoin address entered is not valid or not recognized on this network.',
      suggestions: [
        'Double-check the address for typos',
        'Make sure you are using the correct network (mainnet vs testnet)',
        'Ask the recipient to provide a new address',
        'Try scanning the QR code again',
      ],
      icon: 'location-outline',
      color: '#FF453A',
    };
  }

  // ── Legacy rawTxHex missing ──
  if (lower.includes('rawtxhex') || lower.includes('nonwitnessutxo')) {
    return {
      title: 'Legacy Transaction Data Missing',
      description: 'Legacy (P2PKH) inputs require the full raw transaction data for signing, but it could not be fetched.',
      suggestions: [
        'Check your internet connection and try again',
        'The Electrum server may be temporarily unavailable',
        'Try switching to a different server in settings',
      ],
      icon: 'document-text-outline',
      color: '#FF9F0A',
    };
  }

  // ── Change address ──
  if (lower.includes('no change address')) {
    return {
      title: 'No Change Address',
      description: 'Could not generate a change address for this transaction. Your wallet may need to derive new addresses.',
      suggestions: [
        'Try syncing your wallet',
        'Check that your wallet has available address slots',
        'Contact support if this persists',
      ],
      icon: 'swap-horizontal-outline',
      color: '#FF9F0A',
    };
  }

  // ── No active wallet ──
  if (lower.includes('no active wallet')) {
    return {
      title: 'No Active Wallet',
      description: 'No wallet is currently selected or unlocked.',
      suggestions: [
        'Go to wallet settings and select a wallet',
        'Create or import a wallet first',
        'Restart the app and try again',
      ],
      icon: 'key-outline',
      color: '#FF453A',
    };
  }

  // ── Key/mnemonic retrieval ──
  if (lower.includes('failed to retrieve') && (lower.includes('key') || lower.includes('seed') || lower.includes('mnemonic') || lower.includes('private'))) {
    return {
      title: 'Key Access Failed',
      description: 'Could not access the signing keys for this wallet. The PIN may be incorrect or the secure storage may be locked.',
      suggestions: [
        'Verify your PIN is correct',
        'Close and reopen the app',
        'Make sure biometric authentication is set up if required',
        'Contact support if the problem persists',
      ],
      icon: 'lock-closed-outline',
      color: '#FF453A',
    };
  }

  // ── Derivation path ──
  if (lower.includes('derivation path') || lower.includes('no derivation')) {
    return {
      title: 'Derivation Path Error',
      description: 'Could not find the derivation path for one of the input addresses. The wallet data may be incomplete.',
      suggestions: [
        'Try syncing your wallet',
        'If using coin control, deselect the problematic UTXO',
        'Contact support with your wallet type details',
      ],
      icon: 'git-branch-outline',
      color: '#FF9F0A',
    };
  }

  // ── Taproot / key tweaking ──
  if (lower.includes('tweak') || lower.includes('taproot')) {
    return {
      title: 'Taproot Signing Error',
      description: 'An error occurred while preparing Taproot (P2TR) inputs for signing.',
      suggestions: [
        'Try the transaction again',
        'If using coin control, avoid Taproot UTXOs',
        'Contact support with the error details',
      ],
      icon: 'flash-outline',
      color: '#BF5AF2',
    };
  }

  // ── Circuit breaker / server ──
  if (lower.includes('circuit breaker') || lower.includes('retry')) {
    return {
      title: 'Server Temporarily Unavailable',
      description: 'The network server has experienced repeated failures and is temporarily paused to prevent further issues.',
      suggestions: [
        'Wait a few minutes and try again',
        'Check your internet connection',
        'Switch to a different Electrum server in settings',
      ],
      icon: 'cloud-offline-outline',
      color: '#FF6B6B',
    };
  }

  // ── Broadcast failure ──
  if (lower.includes('broadcast') || lower.includes('mempool') || lower.includes('tx-')) {
    return {
      title: 'Broadcast Failed',
      description: 'The Bitcoin network rejected this transaction. This can happen for various protocol-level reasons.',
      suggestions: [
        'The fee rate may be too low for the current mempool',
        'An input may have already been spent (double-spend)',
        'Increase the fee rate and try again',
        'Wait for pending transactions to confirm first',
      ],
      icon: 'radio-outline',
      color: '#FF453A',
    };
  }

  // ── Network / fetch errors ──
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('timeout') || lower.includes('connection')) {
    return {
      title: 'Network Error',
      description: 'Could not communicate with the Bitcoin network. This is usually a temporary connectivity issue.',
      suggestions: [
        'Check your internet connection',
        'Try again in a few moments',
        'Switch to a different Electrum server in settings',
      ],
      icon: 'wifi-outline',
      color: '#FF9F0A',
    };
  }

  // ── Multisig / PSBT ──
  if (lower.includes('multisig') || lower.includes('partial sig') || lower.includes('cosigner') || lower.includes('witnessscript')) {
    return {
      title: 'Multisig Signing Error',
      description: 'An error occurred during the multisig signing process. Required signatures may be missing or invalid.',
      suggestions: [
        'Ensure you are using the correct cosigner key',
        'Verify the PSBT has not been tampered with',
        'Collect all required signatures before finalizing',
        'Contact your cosigners to verify their signing setup',
      ],
      icon: 'shield-checkmark-outline',
      color: '#BF5AF2',
    };
  }

  // ── PSBT creation ──
  if (lower.includes('psbt') || lower.includes('failed to create')) {
    return {
      title: 'PSBT Creation Failed',
      description: 'Could not create the Partially Signed Bitcoin Transaction.',
      suggestions: [
        'Verify all recipient addresses are valid',
        'Ensure you have sufficient funds',
        'Try reducing the number of recipients',
        'Contact support if the issue persists',
      ],
      icon: 'document-outline',
      color: '#FF9F0A',
    };
  }

  // ── Signing key mismatch ──
  if (lower.includes('can not sign') || lower.includes('cannot sign') || lower.includes('wrong key')) {
    return {
      title: 'Signing Key Mismatch',
      description: 'The wallet\'s signing key does not match the key expected by the input being spent. This usually means the wallet key material is out of sync.',
      suggestions: [
        'Try syncing your wallet to refresh key data',
        'Restart the app and try the transaction again',
        'If using multiple wallets, make sure the correct wallet is selected',
        'Contact support if this persists — include the debug log below',
      ],
      icon: 'key-outline',
      color: '#FF453A',
    };
  }

  // ── Pending transaction / RBF rejection ──
  if (lower.includes('previous transaction') && lower.includes('pending')) {
    return {
      title: 'Pending Transaction Conflict',
      description: 'You have an unconfirmed transaction using the same coins. The new transaction fee must be higher than the pending one.',
      suggestions: [
        'Increase the fee rate and try again',
        'Wait for your pending transaction to confirm',
        'Use "Speed Up" (RBF) on the pending transaction instead',
      ],
      icon: 'time-outline',
      color: '#FF9F0A',
    };
  }

  // ── Inputs already spent ──
  if (lower.includes('already spent') || lower.includes('pending transaction')) {
    return {
      title: 'Inputs Already Spent',
      description: 'One or more coins you are trying to spend are already used by a pending transaction in the mempool.',
      suggestions: [
        'Wait for the pending transaction to confirm',
        'Pull down to refresh your wallet balance',
        'Select different coins using coin control',
      ],
      icon: 'swap-horizontal-outline',
      color: '#FF9F0A',
    };
  }

  // ── Dust amount ──
  if (lower.includes('dust') || lower.includes('too small')) {
    return {
      title: 'Amount Too Small',
      description: 'The transaction output is below the dust threshold (546 sats). Bitcoin nodes reject outputs this small because they cost more in fees to spend than they are worth.',
      suggestions: [
        'Increase the sending amount to at least 546 sats',
        'Use "Send Max" to send your entire balance instead',
        'If this is change, try a slightly different amount',
      ],
      icon: 'resize-outline',
      color: '#FF9F0A',
    };
  }

  // ── Fee too low ──
  if (lower.includes('fee rate is below') || lower.includes('min relay fee')) {
    return {
      title: 'Fee Rate Too Low',
      description: 'The fee rate you selected is below the network minimum required for this transaction to be accepted.',
      suggestions: [
        'Increase the fee rate',
        'Use the "Normal" or "Fast" fee preset',
        'The network may be congested — try a higher fee',
      ],
      icon: 'trending-up-outline',
      color: '#FF9F0A',
    };
  }

  // ── Default fallback ──
  return {
    title: 'Transaction Error',
    description: 'An unexpected error occurred while processing your transaction.',
    suggestions: [
      'Try the transaction again',
      'Check your internet connection',
      'Restart the app and try again',
      'Contact support if the issue persists',
    ],
    icon: 'alert-circle-outline',
    color: '#FF453A',
  };
}

// ─── Props ──────────────────────────────────────────────────────

interface SendErrorSheetProps {
  visible: boolean;
  onClose: () => void;
  error: string | null;
  errorLevel?: 'error' | 'warning' | null;
}

// ─── Component ──────────────────────────────────────────────────

export function SendErrorSheet({ visible, onClose, error, errorLevel }: SendErrorSheetProps) {
  const { isDark, colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const errorInfo = useMemo(() => {
    if (!error) return null;
    return classifyError(error);
  }, [error]);

  if (!errorInfo) return null;

  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';
  const textMuted = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const handleContactSupport = () => {
    const subject = encodeURIComponent(`Send Error: ${errorInfo.title}`);
    const body = encodeURIComponent(
      `Hi Satryn Support,\n\nI encountered an error while sending Bitcoin:\n\n` +
      `Error: ${error}\n\n` +
      `Please help me resolve this issue.\n\nThank you.`,
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={errorLevel === 'warning' ? 'Transaction Warning' : 'Transaction Error'}
      sizing="auto"
      scrollable
    >
      <View style={styles.content}>
        {/* Error Icon + Title */}
        <View style={styles.heroSection}>
          <View style={[styles.iconCircle, {
            backgroundColor: isDark ? `${errorInfo.color}1A` : `${errorInfo.color}10`,
          }]}>
            <Ionicons name={errorInfo.icon} size={32} color={errorInfo.color} />
          </View>
          <Text style={[styles.errorTitle, { color: textPrimary }]}>
            {errorInfo.title}
          </Text>
          <Text style={[styles.errorDescription, { color: textSecondary }]}>
            {errorInfo.description}
          </Text>
        </View>

        {/* Raw error message + copy debug log */}
        <View style={[styles.rawErrorCard, { backgroundColor: surfaceBg }]}>
          <View style={styles.rawErrorHeader}>
            <Ionicons name="code-outline" size={14} color={textMuted} />
            <Text style={[styles.rawErrorLabel, { color: textMuted }]}>DEBUG LOG</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.copyBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
              onPress={async () => {
                if (!error) return;
                const debugLog = `[Satryn Send Error]\nType: ${errorInfo.title}\nTimestamp: ${new Date().toISOString()}\nError: ${error}`;
                await Clipboard.setStringAsync(debugLog);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={12}
                color={copied ? '#30D158' : textMuted}
              />
              <Text style={[styles.copyBtnText, { color: copied ? '#30D158' : textMuted }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text
            style={[styles.rawErrorText, { color: textSecondary }]}
            selectable
            numberOfLines={6}
          >
            {error}
          </Text>
        </View>

        {/* Suggestions */}
        <View style={styles.suggestionsSection}>
          <Text style={[styles.suggestionsTitle, { color: textPrimary }]}>
            What you can try
          </Text>
          {errorInfo.suggestions.map((suggestion, i) => (
            <View key={i} style={styles.suggestionRow}>
              <View style={[styles.suggestionBullet, { backgroundColor: errorInfo.color }]} />
              <Text style={[styles.suggestionText, { color: textSecondary }]}>
                {suggestion}
              </Text>
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        {/* Contact Support */}
        <TouchableOpacity
          style={[styles.supportCard, { backgroundColor: surfaceBg }]}
          onPress={handleContactSupport}
          activeOpacity={0.7}
        >
          <View style={[styles.supportIconCircle, {
            backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : 'rgba(0,122,255,0.08)',
          }]}>
            <Ionicons name="mail-outline" size={20} color="#007AFF" />
          </View>
          <View style={styles.supportContent}>
            <Text style={[styles.supportTitle, { color: textPrimary }]}>
              Contact Support
            </Text>
            <Text style={[styles.supportEmail, { color: textSecondary }]}>
              {SUPPORT_EMAIL}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={textMuted} />
        </TouchableOpacity>

        {/* Dismiss */}
        <AppButton
          title="Dismiss"
          onPress={onClose}
          variant="secondary"
        />
      </View>
    </AppBottomSheet>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 16,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  errorDescription: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  // Raw error
  rawErrorCard: {
    padding: 14,
    borderRadius: 12,
    gap: 8,
  },
  rawErrorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rawErrorLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  rawErrorText: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Suggestions
  suggestionsSection: {
    gap: 10,
  },
  suggestionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  suggestionBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
  },

  // Support
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 12,
  },
  supportIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportContent: {
    flex: 1,
    gap: 2,
  },
  supportTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  supportEmail: {
    fontSize: 13,
    fontWeight: '400',
  },
});
