import '../../shim';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
} from 'react-native-reanimated';
import { useSettingsStore } from '../../src/stores';
import { useTheme, useHaptics } from '../../src/hooks';
import {
  AppBottomSheet,
  SheetSectionFooter,
  SheetPrimaryButton,
  PremiumInput,
  PremiumInputCard,
} from '../../src/components/ui';
import { FastSwitch } from '../../src/components/ui/FastSwitch';
import { PreserveDataSession } from '../../src/services/auth/PreserveDataSession';
import { PreservedArchiveService } from '../../src/services/storage/PreservedArchiveService';
import { PreserveSetupSheet, PasswordChangeSheet, ArchivalProgressSheet } from '../../src/components/preserve';

// ── Main Screen ──────────────────────────────────────────────────

export default function DataBackupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();

  const preserveDataOnDelete = useSettingsStore(s => s.preserveDataOnDelete);
  const setPreserveDataOnDelete = useSettingsStore(s => s.setPreserveDataOnDelete);
  const iCloudBackupEnabled = useSettingsStore(s => s.iCloudBackupEnabled);
  const setICloudBackupEnabled = useSettingsStore(s => s.setICloudBackupEnabled);
  const iCloudBackupHistory = useSettingsStore(s => s.iCloudBackupHistory);

  // Unified preserve setup sheet (warning → password → archival in one sheet)
  const [showPreserveSetupSheet, setShowPreserveSetupSheet] = useState(false);
  // Unified change password sheet (verify → create → archival in one sheet)
  const [showPasswordChangeSheet, setShowPasswordChangeSheet] = useState(false);
  // Preserve disable: password verification sheet
  const [showDisablePreserveSheet, setShowDisablePreserveSheet] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disablePasswordError, setDisablePasswordError] = useState<string | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);
  // Manual preserve now: archival progress sheet
  const [showArchivalSheet, setShowArchivalSheet] = useState(false);
  const [archivalPin, setArchivalPin] = useState('');

  const handleBack = async () => {
    await haptics.trigger('light');
    router.back();
  };

  // ─── Preserve Data Flow ──────────────────────────────────────
  const handlePreserveToggle = async (value: boolean) => {
    if (value) {
      // Open unified setup sheet — toggle only turns ON when onComplete fires
      setShowPreserveSetupSheet(true);
    } else {
      // Require password verification to disable preserve
      setDisablePassword('');
      setDisablePasswordError(null);
      setShowDisablePreserveSheet(true);
    }
  };

  const handleConfirmDisablePreserve = useCallback(async () => {
    if (!disablePassword) {
      setDisablePasswordError('Enter your preserve password');
      return;
    }

    setIsDisabling(true);
    try {
      // Verify password against stored hash
      const isValid = await PreservedArchiveService.verifyPassword(disablePassword);
      if (!isValid) {
        setDisablePasswordError('Incorrect password');
        await haptics.trigger('error');
        setIsDisabling(false);
        return;
      }

      // Password correct — disable and wipe all preserved data
      setPreserveDataOnDelete(false);
      await PreservedArchiveService.deleteAllPreservedData();
      await PreserveDataSession.clear();
      await haptics.trigger('success');
      setShowDisablePreserveSheet(false);
    } catch {
      setDisablePasswordError('Failed to disable. Please try again.');
      await haptics.trigger('error');
    }
    setIsDisabling(false);
  }, [disablePassword, setPreserveDataOnDelete, haptics]);

  const handlePreserveSetupComplete = useCallback(() => {
    setShowPreserveSetupSheet(false);
    // Toggle ON only after the entire flow (info → password → archival) completes
    if (!preserveDataOnDelete) setPreserveDataOnDelete(true);
  }, [preserveDataOnDelete, setPreserveDataOnDelete]);

  // ─── Manual Preserve Now Flow ────────────────────────────────
  const handlePreserveNowPress = async () => {
    await haptics.trigger('selection');
    const password = PreserveDataSession.getPassword();
    if (password) {
      setArchivalPin(password);
      setShowArchivalSheet(true);
    }
  };

  const handleArchivalComplete = useCallback(() => {
    setShowArchivalSheet(false);
    // Delay clearing archivalPin so the sheet can animate out before unmounting
    setTimeout(() => setArchivalPin(''), 500);
  }, []);

  // ─── Change Password Flow ───────────────────────────────────
  const handleChangePasswordPress = async () => {
    await haptics.trigger('selection');
    setShowPasswordChangeSheet(true);
  };

  const handlePasswordChangeComplete = useCallback(() => {
    setShowPasswordChangeSheet(false);
  }, []);

  // ─── iCloud Backup Flow ──────────────────────────────────────
  const handleICloudCardPress = async () => {
    await haptics.trigger('selection');
    // Always navigate directly — iCloud backup is always available
    if (!iCloudBackupEnabled) setICloudBackupEnabled(true);
    router.push('/(auth)/icloud-backup');
  };


  // ─── Helpers ─────────────────────────────────────────────────
  const lastBackup = iCloudBackupHistory.length > 0 ? iCloudBackupHistory[0] : null;
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // ─── Design Tokens ────────────────────────────────────────────
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Protection status (iCloud backup always available)
  const isFullyProtected = preserveDataOnDelete;
  const isPartiallyProtected = true; // iCloud is always available
  const statusLabel = isFullyProtected ? 'Fully Protected' : isPartiallyProtected ? 'Partially Protected' : 'Not Protected';
  const statusDotColor = isFullyProtected ? '#30D158' : isPartiallyProtected ? '#FF9F0A' : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)');
  const statusBadgeBg = isFullyProtected
    ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
    : isPartiallyProtected
      ? (isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)')
      : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
  const statusTextColor = isFullyProtected
    ? (isDark ? 'rgba(48,209,88,0.90)' : 'rgba(48,209,88,0.80)')
    : isPartiallyProtected
      ? (isDark ? 'rgba(255,159,10,0.90)' : 'rgba(255,159,10,0.80)')
      : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Animated.Text entering={FadeIn.duration(300)} style={[styles.largeTitle, { color: textPrimary }]}>
          Data & Backup
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Section ──────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(50).duration(400)} style={styles.heroSection}>
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.10)',
            }]}>
              <Ionicons name="shield-checkmark" size={28} color="#30D158" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>Protect Your Data</Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Keep your wallet safe with local preservation and encrypted iCloud backups
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusBadgeBg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
            <Text style={[styles.statusText, { color: statusTextColor }]}>{statusLabel}</Text>
          </View>
        </Animated.View>

        {/* ── Features Section ──────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>FEATURES</Text>
            <Text style={[styles.sectionCount, { color: textMuted }]}>2</Text>
          </View>

          {/* Preserve Data on Delete — separate card */}
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            <View style={styles.featureRow}>
              <View style={[styles.featureIcon, {
                backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
              }]}>
                <Ionicons name="phone-portrait" size={17} color="#FF9F0A" />
              </View>
              <View style={styles.featureInfo}>
                <Text style={[styles.featureTitle, { color: textPrimary }]}>Preserve Data on Delete</Text>
                <Text style={[styles.featureDesc, { color: textSecondary }]}>
                  Keep wallet data in Keychain if the app is removed
                </Text>
              </View>
              <FastSwitch
                value={preserveDataOnDelete}
                onValueChange={handlePreserveToggle}
              />
            </View>

            {/* Preserve sub-content (when enabled) */}
            {preserveDataOnDelete && (
              <>
                <View style={[styles.preserveStatus, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.04)',
                }]}>
                  <Ionicons name="checkmark-circle" size={16} color="#30D158" />
                  <Text style={[styles.preserveStatusText, { color: isDark ? 'rgba(48,209,88,0.80)' : '#248A3D' }]}>
                    Data preserved in iOS Keychain
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handlePreserveNowPress}
                  activeOpacity={0.7}
                  style={[styles.changePasswordRow, {
                    borderTopColor: dividerColor,
                  }]}
                >
                  <View style={[styles.changePasswordIcon, {
                    backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
                  }]}>
                    <Ionicons name="refresh" size={14} color="#30D158" />
                  </View>
                  <Text style={[styles.changePasswordText, { color: textSecondary }]}>
                    Preserve Now
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleChangePasswordPress}
                  activeOpacity={0.7}
                  style={[styles.changePasswordRow, {
                    borderTopColor: dividerColor,
                  }]}
                >
                  <View style={[styles.changePasswordIcon, {
                    backgroundColor: isDark ? 'rgba(94,92,230,0.12)' : 'rgba(94,92,230,0.08)',
                  }]}>
                    <Ionicons name="key" size={14} color="#5E5CE6" />
                  </View>
                  <Text style={[styles.changePasswordText, { color: textSecondary }]}>
                    Change Password
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={textMuted} />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* iCloud Backup + Restore — separate card */}
          <View style={[styles.card, { backgroundColor: surfaceBg, marginTop: 12 }]}>
            {/* iCloud Backup */}
            <TouchableOpacity onPress={handleICloudCardPress} activeOpacity={0.7} style={styles.featureRow}>
              <View style={[styles.featureIcon, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
              }]}>
                <Ionicons name="cloud" size={17} color="#007AFF" />
              </View>
              <View style={styles.featureInfo}>
                <Text style={[styles.featureTitle, { color: textPrimary }]}>iCloud Backup</Text>
                <Text style={[styles.featureDesc, { color: textSecondary }]}>
                  Create encrypted snapshots of your wallets
                </Text>
                {lastBackup ? (
                  <View style={styles.lastBackupRow}>
                    <Ionicons name="time-outline" size={12} color={textMuted} />
                    <Text style={[styles.lastBackupText, { color: textMuted }]}>
                      Last: {formatDate(lastBackup.timestamp)} · {lastBackup.walletCount} wallet{lastBackup.walletCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.lastBackupRow}>
                    <Ionicons name="information-circle-outline" size={12} color={textMuted} />
                    <Text style={[styles.lastBackupText, { color: textMuted }]}>
                      No backups yet — tap to create one
                    </Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={textMuted} />
            </TouchableOpacity>

          </View>
        </Animated.View>

        {/* ── How It Works ─────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>HOW IT WORKS</Text>
            <Text style={[styles.sectionCount, { color: textMuted }]}>3</Text>
          </View>

          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {/* Keychain Storage */}
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
              }]}>
                <Ionicons name="key" size={17} color="#30D158" />
              </View>
              <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: textPrimary }]}>Keychain Storage</Text>
                <Text style={[styles.infoDesc, { color: textSecondary }]}>
                  Wallet data is stored in the iOS Keychain, surviving app deletion when enabled
                </Text>
              </View>
            </View>

            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />

            {/* End-to-End Encryption */}
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, {
                backgroundColor: isDark ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.08)',
              }]}>
                <Ionicons name="lock-closed" size={17} color="#007AFF" />
              </View>
              <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: textPrimary }]}>End-to-End Encryption</Text>
                <Text style={[styles.infoDesc, { color: textSecondary }]}>
                  iCloud backups are encrypted with your password before upload
                </Text>
              </View>
            </View>

            <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />

            {/* Password Protected */}
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, {
                backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
              }]}>
                <Ionicons name="finger-print" size={17} color="#FF9F0A" />
              </View>
              <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: textPrimary }]}>Password Protected</Text>
                <Text style={[styles.infoDesc, { color: textSecondary }]}>
                  A password is needed to encrypt preserved data and restore backups
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(250).duration(300)} style={styles.footer}>
          <Ionicons name="warning" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            If you sell or give away your device, disable Preserve Data on Delete first, or the next owner could access your wallet data.
          </Text>
        </Animated.View>
      </ScrollView>

      {/* ── Unified Preserve Setup Sheet (warning → password → archival) ── */}
      <PreserveSetupSheet
        visible={showPreserveSetupSheet}
        onClose={() => setShowPreserveSetupSheet(false)}
        onComplete={handlePreserveSetupComplete}
      />

      {/* ── Disable Preserve Password Sheet ────────────────── */}
      <AppBottomSheet
        visible={showDisablePreserveSheet}
        onClose={() => { setShowDisablePreserveSheet(false); setDisablePassword(''); setDisablePasswordError(null); }}
        title="Disable Preservation"
        subtitle="Enter your preserve password to continue"
        sizing="auto"
        footer={
          <View style={styles.sheetFooter}>
            <SheetPrimaryButton
              label={isDisabling ? 'Disabling...' : 'Disable & Remove Data'}
              onPress={handleConfirmDisablePreserve}
              variant="destructive"
              disabled={isDisabling}
            />
          </View>
        }
      >
        <View style={styles.sheetContent}>
          <View style={[styles.sheetInfoRow, {
            backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,69,58,0.04)',
          }]}>
            <Ionicons name="warning" size={20} color="#FF453A" />
            <Text style={[styles.sheetInfoText, { color: textSecondary }]}>
              This will remove all preserved wallet data from the iOS Keychain. If you uninstall the app, your data will be lost.
            </Text>
          </View>
          <PremiumInputCard label="Preserve Password">
            <PremiumInput
              icon="lock-closed"
              iconColor="#FF453A"
              placeholder="Enter your password"
              value={disablePassword}
              onChangeText={(text: string) => { setDisablePassword(text); setDisablePasswordError(null); }}
              secureTextEntry
              autoFocus
              error={!!disablePasswordError}
            />
          </PremiumInputCard>
          {disablePasswordError ? (
            <Text style={{ color: '#FF453A', fontSize: 13, fontWeight: '500', paddingHorizontal: 4, marginTop: 4 }}>
              {disablePasswordError}
            </Text>
          ) : null}
        </View>
      </AppBottomSheet>


      {/* ── Unified Change Password Sheet (verify → create → archival) ── */}
      <PasswordChangeSheet
        visible={showPasswordChangeSheet}
        onClose={() => setShowPasswordChangeSheet(false)}
        onComplete={handlePasswordChangeComplete}
      />

      {/* ── Manual Preserve Now — Archival Progress Sheet ── */}
      {archivalPin ? (
        <ArchivalProgressSheet
          visible={showArchivalSheet}
          onClose={() => { setShowArchivalSheet(false); setArchivalPin(''); }}
          onComplete={handleArchivalComplete}
          pin={archivalPin}
        />
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── Header (privacy.tsx pattern) ─────────────────────────────
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
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
    marginBottom: 12,
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // ── Hero Section ─────────────────────────────────────────────
  heroSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  heroRingOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroRingInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: '88%',
    marginBottom: 16,
  },

  // ── Status Badge ─────────────────────────────────────────────
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Section Labels ───────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
    paddingLeft: 2,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingRight: 2,
  },

  // ── Cards ─────────────────────────────────────────────────────
  card: {
    borderRadius: 20,
    marginBottom: 4,
    overflow: 'hidden',
  },

  // ── Feature Rows (inside card) ───────────────────────────────
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 14,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureInfo: {
    flex: 1,
  },
  featureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  featureDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },

  // (inline badge styles removed — iCloud badges no longer shown)

  // ── Last Backup Row ───────────────────────────────────────────
  lastBackupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  lastBackupText: {
    fontSize: 12,
    fontWeight: '400',
  },

  // ── Preserve Status (when enabled) ───────────────────────────
  preserveStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 4,
    padding: 10,
    borderRadius: 10,
  },
  preserveStatusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },

  // ── Change Password Row ───────────────────────────────────────
  changePasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  changePasswordIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePasswordText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Dividers ──────────────────────────────────────────────────
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
    marginRight: 18,
  },

  // ── Info Rows (How It Works) ──────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 14,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  infoDesc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },

  // ── Footer ────────────────────────────────────────────────────
  footer: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
    gap: 8,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  // ── Sheet Styles ──────────────────────────────────────────────
  sheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  sheetFooter: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  sheetInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sheetInfoText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },

});
