import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics, useScreenSecurity } from '../../src/hooks';
import { useMultiWalletStore } from '../../src/stores';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';

interface ExportData {
  xpubs?: Record<string, string>;
  descriptor?: string;
  watchAddresses?: string[];
  multisigConfig?: any;
  multisigDescriptor?: string;
}

export default function BackupExportScreen() {
  useScreenSecurity(); // Prevent screenshots/recording while export data is displayed
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const { activeWalletId } = useMultiWalletStore();
  const wallets = useMultiWalletStore((s: any) => s.wallets);
  const activeWallet = wallets.find((w: any) => w.id === activeWalletId);
  const walletType = activeWallet?.type || 'hd';

  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Load wallet data on mount
  useEffect(() => {
    (async () => {
      if (!activeWalletId) return;

      const index = wallets.findIndex((w: any) => w.id === activeWalletId);
      const accountId = index >= 0 ? index : 0;
      const pin = SensitiveSession.getPin();

      const result: ExportData = {};

      switch (walletType) {
        case 'watch_xpub': {
          const xpubs = await SecureStorage.getWatchOnlyXpubs(accountId);
          if (xpubs) result.xpubs = xpubs;
          break;
        }
        case 'watch_descriptor': {
          const descriptor = await SecureStorage.getWatchOnlyDescriptor(accountId);
          if (descriptor) result.descriptor = descriptor;
          break;
        }
        case 'watch_addresses': {
          const addresses = await SecureStorage.getWatchAddresses(accountId);
          if (addresses) result.watchAddresses = addresses;
          break;
        }
        case 'multisig': {
          const [config, descriptor] = await Promise.all([
            SecureStorage.getMultisigConfig(accountId),
            pin ? SecureStorage.retrieveWalletDescriptor(activeWalletId, pin) : Promise.resolve(null),
          ]);
          if (config) result.multisigConfig = config;
          if (descriptor) result.multisigDescriptor = descriptor;
          break;
        }
      }

      setData(result);
      setLoading(false);
    })();
  }, [activeWalletId, walletType]);

  // ─── Copy / Share helpers ─────────────────────────────────

  const handleCopy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    haptics.trigger('selection');
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
    // Auto-clear sensitive backup data from clipboard after 30s
    setTimeout(async () => { try { await Clipboard.setStringAsync(''); } catch {} }, 30_000);
  };

  const handleShare = async (text: string, title: string) => {
    haptics.trigger('selection');
    try {
      await Share.share({ message: text, title });
    } catch {
      // User cancelled
    }
  };

  // ─── Render helpers ───────────────────────────────────────

  const renderDataCard = (label: string, value: string, delay: number) => {
    const isCopied = copiedField === label;

    return (
      <Animated.View
        key={label}
        entering={FadeInDown.delay(delay).duration(500)}
        style={[styles.dataCard, { backgroundColor: colors.surface }]}
      >
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={isDark ? 30 : 60}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Text style={[styles.dataLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text
          style={[styles.dataValue, { color: colors.text }]}
          selectable
          numberOfLines={6}
        >
          {value}
        </Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
            onPress={() => handleCopy(value, label)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isCopied ? 'checkmark' : 'copy-outline'}
              size={16}
              color={isCopied ? '#30D158' : colors.textSecondary}
            />
            <Text style={[styles.actionButtonText, { color: isCopied ? '#30D158' : colors.textSecondary }]}>
              {isCopied ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
            onPress={() => handleShare(value, label)}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>Share</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  // ─── Render ───────────────────────────────────────────────

  const title = walletType === 'multisig' ? 'Export keys' : 'Export config';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Loading wallet data...
            </Text>
          </Animated.View>
        ) : !data || Object.keys(data).length === 0 ? (
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.emptyState}>
            <View style={styles.emptyRings}>
              <View style={[styles.emptyRing3, {
                borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }]} />
              <View style={[styles.emptyRing2, {
                borderColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
              }]} />
              <View style={[styles.emptyIconCircle, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
              }]}>
                <Ionicons name="alert-circle-outline" size={30} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
              </View>
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No data found</Text>
            <Text style={[styles.emptySubtitle, { color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }]}>
              This wallet doesn't have exportable configuration data.
            </Text>
          </Animated.View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {walletType === 'multisig'
                  ? 'Your multisig wallet data. Share carefully.'
                  : 'Your wallet configuration. This does not contain private keys.'}
              </Text>
            </Animated.View>

            {/* xpubs */}
            {data.xpubs && Object.entries(data.xpubs).map(([key, value], i) =>
              renderDataCard(`xpub (${key})`, value, 200 + i * 100)
            )}

            {/* Descriptor */}
            {data.descriptor && renderDataCard('Descriptor', data.descriptor, 200)}

            {/* Watch addresses */}
            {data.watchAddresses && data.watchAddresses.length > 0 &&
              renderDataCard(
                `Addresses (${data.watchAddresses.length})`,
                data.watchAddresses.join('\n'),
                200,
              )
            }

            {/* Multisig descriptor */}
            {data.multisigDescriptor && renderDataCard('Multisig Descriptor', data.multisigDescriptor, 200)}

            {/* Multisig config */}
            {data.multisigConfig && renderDataCard(
              'Multisig Config',
              JSON.stringify(data.multisigConfig, null, 2),
              300,
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 60,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyRings: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  emptyRing3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  emptyRing2: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Data card
  dataCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    overflow: 'hidden' as const,
  },
  dataLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  dataValue: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
