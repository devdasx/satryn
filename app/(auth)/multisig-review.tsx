import '../../shim';
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  useColorScheme,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { THEME, getThemeColors, ThemeColors } from '../../src/constants';
import { resolveThemeMode } from '../../src/hooks';
import { useSettingsStore } from '../../src/stores';
import { addDescriptorChecksum } from '../../src/utils/descriptor';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { SensitiveSession } from '../../src/services/auth/SensitiveSession';

interface Cosigner {
  id: string;
  name: string;
  xpub: string;
  fingerprint: string;
  isLocal: boolean;
  localIndex?: number;
}

export default function MultisigReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    name: string;
    m: string;
    n: string;
    scriptType: string;
    cosigners: string;
  }>();
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  // Get theme setting from store to respect app's theme preference
  const themeSetting = useSettingsStore((state) => state.theme);
  const themeMode = resolveThemeMode(themeSetting, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  // Parse configuration
  const config = useMemo(() => ({
    name: params.name || 'Multisig Wallet',
    m: parseInt(params.m || '2', 10),
    n: parseInt(params.n || '3', 10),
    scriptType: params.scriptType || 'p2wsh',
    cosigners: params.cosigners ? JSON.parse(params.cosigners) as Cosigner[] : [],
  }), [params]);

  // Generate descriptor with real BIP380 checksum
  const descriptor = useMemo(() => {
    if (config.cosigners.length === 0) return '';
    const xpubs = config.cosigners.map((c: Cosigner) =>
      `[${c.fingerprint}/48h/0h/0h/2h]${c.xpub}`
    ).join(',');
    const baseDescriptor = `wsh(sortedmulti(${config.m},${xpubs}))`;
    return addDescriptorChecksum(baseDescriptor);
  }, [config]);

  // Generate mock first receive address
  const firstAddress = useMemo(() => {
    // In real app, derive from descriptor
    return 'bc1q' + 'multisig'.repeat(4) + '...xyz';
  }, []);

  // Create dynamic styles
  const styles = createStyles(colors, isDark);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleCopyAddress = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(firstAddress);
  }, [firstAddress]);

  const handleCopyDescriptor = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(descriptor);
  }, [descriptor]);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const shareContent = [
        `Multisig Wallet Configuration`,
        ``,
        `Name: ${config.name}`,
        `Type: ${config.m}-of-${config.n}`,
        `Address Format: ${config.scriptType.toUpperCase()}`,
        ``,
        `Signers:`,
        ...config.cosigners.map((c, i) => `${i + 1}. ${c.name} (${c.fingerprint})`),
        ``,
        `Wallet Descriptor:`,
        descriptor,
      ].join('\n');

      await Share.share({
        message: shareContent,
        title: 'Multisig Configuration',
      });
    } catch (err) {
      console.error('Share error:', err);
    }
  }, [config, descriptor]);

  const handleCreate = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const multisigParams = {
      mnemonic: 'multisig_descriptor_based',
      isMultisig: 'true',
      walletName: config.name,
      descriptor: descriptor,
    };

    // Try to get PIN without asking: session cache → biometrics
    const cachedPin = await SensitiveSession.ensureAuth();
    if (cachedPin) {
      // PIN available — skip PIN screen entirely
      router.replace({
        pathname: '/(onboarding)/setup',
        params: { ...multisigParams, pin: cachedPin },
      });
    } else {
      const hasPinSet = await SecureStorage.hasPinSet();
      if (hasPinSet) {
        // PIN exists but can't retrieve silently — verify
        router.push({
          pathname: '/(onboarding)/pin',
          params: { ...multisigParams, verifyOnly: 'true' },
        });
      } else {
        // No PIN yet — full PIN creation flow
        router.push({
          pathname: '/(onboarding)/pin',
          params: multisigParams,
        });
      }
    }
  }, [router, config, descriptor]);

  // Get script type display name
  const getScriptTypeLabel = (type: string) => {
    switch (type) {
      case 'p2wsh': return 'Native SegWit';
      case 'p2sh-p2wsh': return 'Wrapped SegWit';
      case 'p2sh': return 'Legacy';
      default: return type.toUpperCase();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header - matches Create Wallet pattern */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBackButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.stepIndicatorText}>Step 3 of 3</Text>
        <View style={styles.headerBackButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Wallet Summary Card */}
        <View style={styles.summaryCard}>
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.summaryIconContainer}>
            <View style={styles.summaryIconGlow} />
            <Ionicons
              name="shield-checkmark"
              size={32}
              color={isDark ? '#FFFFFF' : THEME.brand.bitcoin}
            />
          </View>
          <Text style={styles.summaryTitle}>{config.name}</Text>
          <View style={styles.summaryBadges}>
            <View style={styles.badgePrimary}>
              <Text style={styles.badgePrimaryText}>
                {config.m} of {config.n}
              </Text>
            </View>
            <View style={styles.badgeSecondary}>
              <Text style={styles.badgeSecondaryText}>
                {getScriptTypeLabel(config.scriptType)}
              </Text>
            </View>
          </View>
        </View>

        {/* Signers Section */}
        <Text style={styles.sectionTitle}>SIGNERS</Text>
        <View style={styles.cosignersCard}>
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          {config.cosigners.map((cosigner: Cosigner, index: number) => (
            <View
              key={cosigner.id}
              style={[
                styles.cosignerRow,
                index < config.cosigners.length - 1 && styles.cosignerRowBorder,
              ]}
            >
              <View style={styles.cosignerNumber}>
                <Text style={styles.cosignerNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.cosignerInfo}>
                <Text style={styles.cosignerName}>{cosigner.name}</Text>
                <Text style={styles.cosignerFingerprint}>{cosigner.fingerprint}</Text>
              </View>
              {cosigner.isLocal ? (
                <View style={styles.youBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.youBadgeText}>You</Text>
                </View>
              ) : (
                <View style={styles.externalBadge}>
                  <Text style={styles.externalBadgeText}>External</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* First Receive Address */}
        <Text style={styles.sectionTitle}>FIRST RECEIVE ADDRESS</Text>
        <TouchableOpacity
          style={styles.addressCard}
          onPress={handleCopyAddress}
          activeOpacity={0.7}
        >
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
            {firstAddress}
          </Text>
          <View style={styles.copyIconContainer}>
            <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        {/* Wallet Descriptor */}
        <Text style={styles.sectionTitle}>WALLET DESCRIPTOR</Text>
        <TouchableOpacity
          style={styles.descriptorCard}
          onPress={handleCopyDescriptor}
          activeOpacity={0.7}
        >
          {Platform.OS === 'ios' && (
            <BlurView intensity={isDark ? 30 : 60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.descriptorScroll}
          >
            <Text style={styles.descriptorText}>{descriptor}</Text>
          </ScrollView>
          <View style={styles.tapToCopyHint}>
            <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
            <Text style={styles.tapToCopyText}>Tap to copy</Text>
          </View>
        </TouchableOpacity>

        {/* Share Configuration Button */}
        <TouchableOpacity
          style={styles.shareButton}
          onPress={handleShare}
          activeOpacity={0.7}
        >
          <Ionicons name="share-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.shareButtonText}>Share Configuration</Text>
        </TouchableOpacity>

        {/* Safe to share notice */}
        <View style={styles.safeShareNotice}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
          <Text style={styles.safeShareText}>
            Safe to share: contains no private keys
          </Text>
        </View>

        {/* Bottom Spacer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={handleCreate}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
          <Text style={styles.createButtonText}>Create Multisig Wallet</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header - matches Create Wallet pattern exactly
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicatorText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  // Summary Card
  summaryCard: {
    alignItems: 'center',
    padding: 28,
    borderRadius: 20,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 32,
    overflow: 'hidden' as const,
  },
  summaryIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: isDark ? colors.glassMedium : THEME.brand.bitcoinSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  summaryIconGlow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(247,147,26,0.1)',
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  summaryBadges: {
    flexDirection: 'row',
    gap: 10,
  },
  badgePrimary: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: isDark ? colors.glassStrong : THEME.brand.bitcoinSoft,
  },
  badgePrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: isDark ? '#FFFFFF' : THEME.brand.bitcoin,
  },
  badgeSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.glassMedium,
  },
  badgeSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Section Title
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 12,
  },

  // Cosigners Card
  cosignersCard: {
    borderRadius: 16,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 28,
    overflow: 'hidden' as const,
  },
  cosignerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  cosignerRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  cosignerNumber: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: isDark ? colors.glassStrong : THEME.brand.bitcoinSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cosignerNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: isDark ? '#FFFFFF' : THEME.brand.bitcoin,
  },
  cosignerInfo: {
    flex: 1,
  },
  cosignerName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  cosignerFingerprint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  youBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.1)',
  },
  youBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  externalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  externalBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },

  // Address Card
  addressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 28,
    overflow: 'hidden' as const,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  copyIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  // Descriptor Card
  descriptorCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: isDark ? colors.glass : 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: isDark ? colors.glassBorder : 'rgba(0,0,0,0.10)',
    marginBottom: 20,
    overflow: 'hidden' as const,
  },
  descriptorScroll: {
    marginBottom: 12,
  },
  descriptorText: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
  },
  tapToCopyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.glassMedium,
  },
  tapToCopyText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },

  // Share Button
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: 10,
    marginBottom: 16,
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Safe to share notice
  safeShareNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 20,
  },
  safeShareText: {
    fontSize: 13,
    color: colors.success,
  },

  // Info Container
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 4,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },

  bottomSpacer: {
    height: 120,
  },

  // Footer CTA
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: colors.background,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 24,
    backgroundColor: isDark ? THEME.brand.bitcoin : colors.text,
    gap: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },

});
