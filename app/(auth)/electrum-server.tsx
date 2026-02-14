import '../../shim';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  cancelAnimation,
  FadeIn,
} from 'react-native-reanimated';
import { useTheme, useHaptics, useConnectionState } from '../../src/hooks';
import { useSettingsStore, useWalletStore, useServerStore } from '../../src/stores';
import { ElectrumAPI } from '../../src/services/electrum/ElectrumAPI';
import { ElectrumServerListSheet } from '../../src/components/ElectrumServerListSheet';
import { FastSwitch } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';
import { THEME } from '../../src/constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Data ──────────────────────────────────────────────────────

const BENEFITS = [
  {
    icon: 'shield-checkmark-outline' as const,
    color: '#30D158',
    title: 'Full Privacy',
    desc: 'Your addresses and balances are never exposed to third parties.',
  },
  {
    icon: 'git-network-outline' as const,
    color: '#007AFF',
    title: 'Direct Connection',
    desc: 'Verify transactions directly against your own copy of the blockchain.',
  },
  {
    icon: 'flash-outline' as const,
    color: '#FF9F0A',
    title: 'No Downtime',
    desc: 'Your personal node is always available — no reliance on public infrastructure.',
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function ElectrumServerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const network = useWalletStore(s => s.network);
  const connection = useConnectionState();
  const customElectrumServer = useSettingsStore(s => s.customElectrumServer);
  const setCustomElectrumServer = useSettingsStore(s => s.setCustomElectrumServer);
  const useCustomElectrum = useSettingsStore(s => s.useCustomElectrum);
  const setUseCustomElectrum = useSettingsStore(s => s.setUseCustomElectrum);
  const { setActiveServer, clearActiveServer } = useServerStore();

  // Local state
  const [electrumHost, setElectrumHost] = useState(customElectrumServer?.host || '');
  const [electrumPort, setElectrumPort] = useState(customElectrumServer?.port?.toString() || '50002');
  const [electrumSSL, setElectrumSSL] = useState(customElectrumServer?.ssl ?? true);
  const [electrumConnecting, setElectrumConnecting] = useState(false);
  const [electrumConnected, setElectrumConnected] = useState<boolean | null>(null);
  const [showServerList, setShowServerList] = useState(false);

  // Inline error/success states
  const [portError, setPortError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionSuccess, setConnectionSuccess] = useState(false);

  // Animated status dot for connecting state
  const statusPulse = useSharedValue(1);
  const animatedStatusDot = useAnimatedStyle(() => ({
    opacity: statusPulse.value,
  }));

  // Design tokens
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary;
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Button press animation
  const connectScale = useSharedValue(1);
  const connectAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: connectScale.value }],
  }));

  // ─── Save / Connect ─────────────────────────────────────────────
  const handleSaveElectrumServer = useCallback(async () => {
    setPortError(null);
    setConnectionError(null);
    setConnectionSuccess(false);

    if (!electrumHost.trim()) {
      setCustomElectrumServer(null);
      setUseCustomElectrum(false);
      clearActiveServer();
      setElectrumConnected(null);
      await haptics.trigger('success');
      // Reconnect to public servers
      try {
        const api = ElectrumAPI.shared(network || 'mainnet');
        api.disconnect();
        api.connect().catch(() => {});
      } catch {}
      router.back();
      return;
    }
    const port = parseInt(electrumPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setPortError('Port must be between 1 and 65535');
      await haptics.trigger('error');
      return;
    }

    setElectrumConnecting(true);
    statusPulse.value = withRepeat(
      withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    try {
      const { ElectrumClient } = require('../../src/services/electrum/ElectrumClient');
      const testClient = new ElectrumClient('mainnet');
      (testClient as any).serverList = [{ host: electrumHost.trim(), port, ssl: electrumSSL }];
      (testClient as any).currentServerIndex = 0;

      await Promise.race([
        testClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);

      testClient.disconnect();

      setElectrumConnected(true);
      setConnectionSuccess(true);
      setConnectionError(null);
      setCustomElectrumServer({ host: electrumHost.trim(), port, ssl: electrumSSL, enabled: true });
      setUseCustomElectrum(true);

      // Persist active server to DB (single source of truth)
      setActiveServer({ host: electrumHost.trim(), port, ssl: electrumSSL });

      // Reconnect ElectrumAPI to the new server
      try {
        const api = ElectrumAPI.shared(network || 'mainnet');
        api.disconnect();
        api.connect().catch(() => {});
      } catch {}

      await haptics.trigger('success');
    } catch {
      setElectrumConnected(false);
      setConnectionSuccess(false);
      setConnectionError(
        `Could not connect to ${electrumHost.trim()}:${port}. Check the server address and try again.`
      );
      await haptics.trigger('error');
    } finally {
      setElectrumConnecting(false);
      cancelAnimation(statusPulse);
      statusPulse.value = withTiming(1, { duration: 200 });
    }
  }, [electrumHost, electrumPort, electrumSSL, haptics, router, setCustomElectrumServer, setUseCustomElectrum, setActiveServer, clearActiveServer, network, statusPulse]);

  // ─── Reset ──────────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    setCustomElectrumServer(null);
    setUseCustomElectrum(false);
    clearActiveServer();
    setElectrumConnected(null);
    setElectrumHost('');
    setElectrumPort('50002');
    setElectrumSSL(true);
    setPortError(null);
    setConnectionError(null);
    setConnectionSuccess(false);
    // Reconnect to public servers
    try {
      const api = ElectrumAPI.shared(network || 'mainnet');
      api.disconnect();
      api.connect().catch(() => {});
    } catch {}
    await haptics.trigger('success');
  }, [haptics, setCustomElectrumServer, setUseCustomElectrum, clearActiveServer, network]);

  // ─── Server switch callback from list sheet ───────────────────
  const handleServerSwitch = useCallback((server: { host: string; port: number; ssl: boolean }) => {
    setElectrumHost(server.host);
    setElectrumPort(String(server.port));
    setElectrumSSL(server.ssl);
    setElectrumConnected(true);
    setConnectionError(null);
    setConnectionSuccess(true);
    setPortError(null);
  }, []);

  // ─── Status computations ───────────────────────────────────────
  const isConnected = useCustomElectrum && electrumConnected !== false;
  const isFailed = electrumConnected === false;

  const statusBadgeLabel = electrumConnecting
    ? 'Testing...'
    : isFailed
    ? 'Connection Failed'
    : isConnected
    ? 'Connected'
    : 'Public Servers';

  const statusBadgeColor = isFailed
    ? '#FF453A'
    : isConnected
    ? '#30D158'
    : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)');

  const statusBadgeBg = isFailed
    ? (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)')
    : isConnected
    ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');

  const heroAccent = '#5AC8FA';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Animated.Text
          entering={FadeIn.duration(300)}
          style={[styles.largeTitle, { color: textPrimary }]}
        >
          Electrum Server
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Hero ───────────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(50).duration(400)} style={styles.heroSection}>
          <View style={[styles.heroRingOuter, {
            backgroundColor: isDark ? 'rgba(90,200,250,0.06)' : 'rgba(90,200,250,0.05)',
          }]}>
            <View style={[styles.heroRingInner, {
              backgroundColor: isDark ? 'rgba(90,200,250,0.12)' : 'rgba(90,200,250,0.10)',
            }]}>
              <Ionicons name="server" size={28} color={heroAccent} />
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: textPrimary }]}>
            Your Node, Your Rules
          </Text>
          <Text style={[styles.heroSubtitle, { color: textSecondary }]}>
            Connect to a personal Electrum server for{'\n'}full privacy and trustless verification.
          </Text>

          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: statusBadgeBg }]}>
            {electrumConnecting ? (
              <ActivityIndicator size={10} color={statusBadgeColor} />
            ) : (
              <Animated.View style={[
                styles.statusDot,
                { backgroundColor: statusBadgeColor },
                electrumConnecting && animatedStatusDot,
              ]} />
            )}
            <Text style={[styles.statusText, { color: statusBadgeColor }]}>
              {statusBadgeLabel}
            </Text>
          </View>
        </Animated.View>

        {/* ── Connection Mode Card ─────────────────────── */}
        <Animated.View entering={FadeIn.delay(100).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>CONNECTION</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(120).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {/* Current connection row */}
          <View style={styles.connectionRow}>
            <View style={[styles.connectionIcon, {
              backgroundColor: isConnected
                ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
                : (isDark ? 'rgba(90,200,250,0.12)' : 'rgba(90,200,250,0.08)'),
            }]}>
              <Ionicons
                name={isConnected ? 'shield-checkmark' : 'globe-outline'}
                size={17}
                color={isConnected ? '#30D158' : heroAccent}
              />
            </View>
            <View style={styles.connectionContent}>
              <Text style={[styles.connectionTitle, { color: textPrimary }]}>
                {isConnected ? 'Custom Server' : 'Public Servers'}
              </Text>
              <Text style={[styles.connectionDesc, { color: textSecondary }]}>
                {isConnected && customElectrumServer
                  ? `${customElectrumServer.host}:${customElectrumServer.port}`
                  : 'Auto-selects the fastest available public node'}
              </Text>
            </View>
          </View>

          <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />

          {/* View all servers row */}
          <TouchableOpacity
            style={styles.connectionRow}
            onPress={() => setShowServerList(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.connectionIcon, {
              backgroundColor: isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)',
            }]}>
              <Ionicons name="list-outline" size={17} color="#8E8E93" />
            </View>
            <View style={styles.connectionContent}>
              <Text style={[styles.connectionTitle, { color: textPrimary }]}>
                View All Servers
              </Text>
              <Text style={[styles.connectionDesc, { color: textSecondary }]}>
                Browse and switch between available nodes
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)'}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* ── Custom Server Form ──────────────────────── */}
        <Animated.View entering={FadeIn.delay(150).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>CUSTOM SERVER</Text>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(170).duration(300)}>
          <View style={[styles.card, { backgroundColor: surfaceBg }]}>
            {/* Host */}
            <PremiumInputCard label="HOST">
              <PremiumInput
                icon="server"
                iconColor="#5AC8FA"
                monospace
                value={electrumHost}
                onChangeText={(text) => {
                  setElectrumHost(text);
                  setConnectionError(null);
                  setConnectionSuccess(false);
                }}
                placeholder="electrum.example.com"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </PremiumInputCard>

            {/* Port */}
            <PremiumInputCard label="PORT">
              <PremiumInput
                icon="keypad"
                iconColor="#AF82FF"
                monospace
                value={electrumPort}
                onChangeText={(text) => {
                  setElectrumPort(text);
                  setPortError(null);
                }}
                placeholder="50002"
                keyboardType="number-pad"
                error={!!portError}
              />
            </PremiumInputCard>
            {portError && (
              <Text style={[styles.errorText, { color: isDark ? '#FF453A' : '#D70015' }]}>
                {portError}
              </Text>
            )}

            {/* SSL / TLS Toggle */}
            <View style={[styles.protocolRow, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            }]}>
              <View style={[styles.protocolIconCircle, {
                backgroundColor: electrumSSL
                  ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
                  : (isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)'),
              }]}>
                <Ionicons
                  name="lock-closed"
                  size={15}
                  color={electrumSSL ? '#30D158' : '#8E8E93'}
                />
              </View>
              <View style={styles.protocolContent}>
                <Text style={[styles.protocolTitle, { color: textPrimary }]}>SSL / TLS</Text>
                <Text style={[styles.protocolDesc, { color: textSecondary }]}>Encrypted connection</Text>
              </View>
              <FastSwitch
                value={electrumSSL}
                onValueChange={setElectrumSSL}
              />
            </View>

            {/* Footer note */}
            <Text style={[styles.footerNote, { color: textMuted }]}>
              Leave host empty to use public servers. Falls back to public servers if your node is unreachable.
            </Text>
          </View>
        </Animated.View>

        {/* ── Connect Button ────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <AnimatedPressable
            style={[styles.connectBtn, connectAnimStyle, {
              backgroundColor: electrumConnecting
                ? (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)')
                : (isDark ? THEME.brand.bitcoin : '#0D0D0D'),
            }]}
            onPress={handleSaveElectrumServer}
            onPressIn={() => { connectScale.value = withSpring(0.97, { damping: 15, stiffness: 400 }); }}
            onPressOut={() => { connectScale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
            disabled={electrumConnecting}
          >
            {electrumConnecting ? (
              <View style={styles.connectingContent}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={[styles.connectText, { color: '#FFFFFF' }]}>
                  Connecting...
                </Text>
              </View>
            ) : (
              <>
                <Ionicons
                  name={electrumHost.trim() ? 'flash' : 'globe-outline'}
                  size={17}
                  color="#FFFFFF"
                />
                <Text style={[styles.connectText, { color: '#FFFFFF' }]}>
                  {electrumHost.trim() ? 'Connect' : 'Use Default Servers'}
                </Text>
              </>
            )}
          </AnimatedPressable>
        </Animated.View>

        {/* ── Inline Connection Error ──────────────────── */}
        {connectionError && !electrumConnecting && (
          <Animated.View entering={FadeIn.duration(250)}>
            <View style={[styles.feedbackCard, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,69,58,0.04)',
            }]}>
              <View style={[styles.feedbackIconCircle, {
                backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)',
              }]}>
                <Ionicons name="alert-circle" size={16} color={isDark ? '#FF453A' : '#D70015'} />
              </View>
              <Text style={[styles.feedbackText, { color: isDark ? '#FF453A' : '#D70015' }]}>
                {connectionError}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* ── Inline Connection Success ────────────────── */}
        {connectionSuccess && !electrumConnecting && !connectionError && (
          <Animated.View entering={FadeIn.duration(250)}>
            <View style={[styles.feedbackCard, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.04)',
            }]}>
              <View style={[styles.feedbackIconCircle, {
                backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
              }]}>
                <Ionicons name="checkmark-circle" size={16} color={isDark ? '#30D158' : '#248A3D'} />
              </View>
              <Text style={[styles.feedbackText, { color: isDark ? '#30D158' : '#248A3D' }]}>
                Connected successfully to {electrumHost.trim()}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* ── Reset Button ─────────────────────────────── */}
        {useCustomElectrum && customElectrumServer && !electrumConnecting && (
          <Animated.View entering={FadeIn.duration(200)}>
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={14} color="#8E8E93" />
              <Text style={styles.resetText}>Reset to Default</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── Why Run Your Own Node ──────────────────── */}
        <Animated.View entering={FadeIn.delay(250).duration(300)}>
          <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>WHY YOUR OWN NODE</Text>
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(270).duration(300)}
          style={[styles.card, { backgroundColor: surfaceBg, paddingHorizontal: 0 }]}
        >
          {BENEFITS.map((item, index) => (
            <View key={item.title}>
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, {
                  backgroundColor: isDark ? `${item.color}1F` : `${item.color}14`,
                }]}>
                  <Ionicons name={item.icon} size={17} color={item.color} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoTitle, { color: textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.infoDesc, { color: textSecondary }]}>{item.desc}</Text>
                </View>
              </View>
              {index < BENEFITS.length - 1 && (
                <View style={[styles.infoDivider, { backgroundColor: dividerColor }]} />
              )}
            </View>
          ))}
        </Animated.View>

        {/* ── Footer ─────────────────────────────────── */}
        <Animated.View entering={FadeIn.delay(300).duration(300)} style={styles.footer}>
          <Ionicons name="lock-closed" size={16} color={textMuted} />
          <Text style={[styles.footerText, { color: textMuted }]}>
            All connections use end-to-end encryption.{'\n'}Your data never leaves your device.
          </Text>
        </Animated.View>
      </ScrollView>

      {/* ── Server List Sheet ────────────────────────────── */}
      <ElectrumServerListSheet
        visible={showServerList}
        onClose={() => setShowServerList(false)}
        network={network || 'mainnet'}
        onServerSwitch={handleServerSwitch}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 8 },
  backButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    marginLeft: -8, marginBottom: 4,
  },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginBottom: 12 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  // Hero
  heroSection: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  heroRingOuter: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  heroRingInner: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginBottom: 8 },
  heroSubtitle: {
    fontSize: 15, fontWeight: '400', lineHeight: 22,
    textAlign: 'center', maxWidth: '88%', marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 13, fontWeight: '600' },

  // Section
  sectionLabel: {
    fontSize: 13, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 10, paddingLeft: 2,
  },

  // Cards
  card: { borderRadius: 20, padding: 18, marginBottom: 4 },

  // Connection card rows
  connectionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 18, gap: 14,
  },
  connectionIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  connectionContent: { flex: 1 },
  connectionTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginBottom: 3 },
  connectionDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },

  // Info rows
  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 14, paddingHorizontal: 18, gap: 14,
  },
  infoIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  infoContent: { flex: 1 },
  infoTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginBottom: 3 },
  infoDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  infoDivider: { height: StyleSheet.hairlineWidth, marginLeft: 70, marginRight: 18 },

  // Form
  protocolRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 20,
    gap: 12, marginTop: 8,
  },
  protocolIconCircle: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  protocolContent: { flex: 1 },
  protocolTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  protocolDesc: { fontSize: 13, fontWeight: '400', marginTop: 1 },
  errorText: { fontSize: 12, fontWeight: '400', marginTop: 4, paddingLeft: 2 },
  footerNote: {
    fontSize: 13, fontWeight: '400', lineHeight: 19, marginTop: 14,
  },

  // Connect button
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 16, gap: 8, marginTop: 16,
  },
  connectText: { fontSize: 16, fontWeight: '600' },
  connectingContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // Feedback cards
  feedbackCard: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 14, borderRadius: 16, marginTop: 12,
  },
  feedbackIconCircle: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  feedbackText: { fontSize: 13, fontWeight: '400', flex: 1, lineHeight: 19 },

  // Reset
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, marginTop: 8,
  },
  resetText: { fontSize: 14, fontWeight: '500', color: '#8E8E93' },

  // Footer
  footer: { alignItems: 'center', paddingTop: 24, paddingBottom: 8, gap: 8 },
  footerText: { fontSize: 13, fontWeight: '400', lineHeight: 19, textAlign: 'center' },
});
