/**
 * NearbyAdvertising — Premium "Ready to Receive" with gradient pulse
 *
 * Shows a layered gradient pulse animation while the device is
 * advertising wirelessly. QR code is available as a collapsible fallback.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import QRCodeSVG from 'react-native-qrcode-svg';
import { useTheme } from '../../hooks';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import { encodeNearbyQR } from '../../services/nearby/QRTransport';
import { formatNearbyAmount } from '../../services/nearby/formatNearbyAmount';
import { NearbyPeerList } from './NearbyPeerList';
import { AppButton } from '../ui/AppButton';

export function NearbyAdvertising() {
  const { colors, isDark } = useTheme();
  const nearbyNickname = useSettingsStore((s) => s.nearbyNickname);
  const payload = useNearbySessionStore((s) => s.payload);
  const sessionState = useNearbySessionStore((s) => s.state);
  const [showQR, setShowQR] = useState(false);

  // Pulse ring animations — staggered, smoother
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const ring3 = useSharedValue(0);

  useEffect(() => {
    const duration = 2400;
    const easing = Easing.out(Easing.cubic);
    ring1.value = withRepeat(withTiming(1, { duration, easing }), -1, false);
    ring2.value = withRepeat(withDelay(500, withTiming(1, { duration, easing })), -1, false);
    ring3.value = withRepeat(withDelay(1000, withTiming(1, { duration, easing })), -1, false);
  }, []);

  const makeRingStyle = (value: SharedValue<number>, baseOpacity: number) =>
    useAnimatedStyle(() => ({
      opacity: baseOpacity * (1 - value.value),
      transform: [{ scale: 1 + value.value * 2 }],
    }));

  const ring1Style = makeRingStyle(ring1, 0.5);
  const ring2Style = makeRingStyle(ring2, 0.35);
  const ring3Style = makeRingStyle(ring3, 0.2);

  const qrData = payload ? encodeNearbyQR(payload) : '';

  const successGreen = isDark
    ? 'rgba(48, 209, 88, 0.15)'
    : 'rgba(52, 199, 89, 0.12)';

  const isConnecting = sessionState === 'exchanging';

  return (
    <View style={styles.container}>
      {/* Compact pulse animation area */}
      <Animated.View
        entering={FadeIn.duration(600)}
        style={styles.pulseSection}
      >
        <View style={styles.pulseContainer}>
          {/* Gradient rings */}
          <Animated.View style={[styles.ring, ring3Style]}>
            <LinearGradient
              colors={isDark
                ? ['rgba(48, 209, 88, 0.08)', 'rgba(48, 209, 88, 0.02)']
                : ['rgba(52, 199, 89, 0.1)', 'rgba(52, 199, 89, 0.02)']}
              style={styles.ringGradient}
            />
          </Animated.View>
          <Animated.View style={[styles.ring, ring2Style]}>
            <LinearGradient
              colors={isDark
                ? ['rgba(48, 209, 88, 0.12)', 'rgba(48, 209, 88, 0.03)']
                : ['rgba(52, 199, 89, 0.14)', 'rgba(52, 199, 89, 0.03)']}
              style={styles.ringGradient}
            />
          </Animated.View>
          <Animated.View style={[styles.ring, ring1Style]}>
            <LinearGradient
              colors={isDark
                ? ['rgba(48, 209, 88, 0.18)', 'rgba(48, 209, 88, 0.04)']
                : ['rgba(52, 199, 89, 0.2)', 'rgba(52, 199, 89, 0.04)']}
              style={styles.ringGradient}
            />
          </Animated.View>

          {/* Center icon */}
          <View style={[styles.centerDot, { backgroundColor: successGreen }]}>
            <View style={[styles.centerDotInner, {
              backgroundColor: isDark
                ? 'rgba(48, 209, 88, 0.25)'
                : 'rgba(52, 199, 89, 0.2)',
            }]}>
              <Ionicons name="radio" size={26} color={colors.success} />
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Title + nickname */}
      <View style={styles.titleSection}>
        <Animated.Text
          entering={FadeInDown.delay(200).duration(400)}
          style={[styles.title, { color: colors.textPrimary }]}
        >
          Ready to Receive
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(300).duration(400)}
          style={[styles.subtitle, { color: colors.textSecondary }]}
        >
          Tap a sender to accept their connection
        </Animated.Text>

        {/* Broadcasting as nickname badge */}
        {nearbyNickname ? (
          <Animated.View
            entering={FadeInDown.delay(350).duration(400)}
            style={[styles.nicknameBadge, {
              backgroundColor: isDark ? 'rgba(48, 209, 88, 0.1)' : 'rgba(52, 199, 89, 0.08)',
            }]}
          >
            <Ionicons name="person" size={12} color={colors.success} />
            <Text style={[styles.nicknameText, { color: colors.success }]}>
              Broadcasting as {nearbyNickname}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      {/* Peer list — takes remaining space */}
      <NearbyPeerList connecting={isConnecting} />

      {/* Bottom section — summary + QR */}
      <View style={styles.bottomSection}>
        {/* Amount/memo summary — glass card */}
        {payload && (payload.amountSats || payload.memo) && (
          <Animated.View
            entering={FadeInDown.delay(400).duration(400)}
            style={{ width: '100%', marginBottom: 12 }}
          >
            <View style={[styles.summaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.surfacePrimary }]}>
              <View style={styles.summaryContent}>
                {payload.amountSats != null && (
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>Amount</Text>
                    <Text style={[styles.summaryAmount, { color: colors.textPrimary }]}>
                      {formatNearbyAmount(payload)}
                    </Text>
                  </View>
                )}
                {payload.memo && (
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>Memo</Text>
                    <Text style={[styles.summaryMemo, { color: colors.textPrimary }]}>
                      {payload.memo}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Animated.View>
        )}

        {/* QR fallback toggle */}
        {qrData ? (
          showQR ? (
            <Animated.View
              entering={FadeInUp.duration(300)}
              style={styles.qrSection}
            >
              <Text style={[styles.qrLabel, { color: colors.textTertiary }]}>
                Or scan this QR code
              </Text>
              <View style={[styles.qrContainer, {
                backgroundColor: '#FFFFFF',
                ...Platform.select({
                  ios: {
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: isDark ? 0.4 : 0.1,
                    shadowRadius: 12,
                  },
                }),
              }]}>
                <QRCodeSVG
                  value={qrData}
                  size={150}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  ecl="H"
                  logo={require('../../../appIcon.png')}
                  logoSize={26}
                  logoBackgroundColor="#FFFFFF"
                  logoMargin={2}
                  logoBorderRadius={5}
                />
              </View>
              <TouchableOpacity
                onPress={() => setShowQR(false)}
                activeOpacity={0.7}
                style={styles.qrToggleLink}
              >
                <Text style={[styles.qrToggleText, { color: colors.textTertiary }]}>
                  Hide QR Code
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <Animated.View
              entering={FadeInDown.delay(500).duration(400)}
              style={{ width: '100%' }}
            >
              <AppButton
                title="Show QR Code"
                onPress={() => setShowQR(true)}
                variant="secondary"
                icon="qr-code-outline"
                haptic="light"
              />
            </Animated.View>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pulseSection: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseContainer: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
  },
  ringGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  centerDot: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDotInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  bottomSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  contentSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  nicknameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  nicknameText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 8,
  },
  summaryContent: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  summaryAmount: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  summaryMemo: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  qrSection: {
    alignItems: 'center',
    width: '100%',
    marginTop: 16,
  },
  qrLabel: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    marginBottom: 12,
  },
  qrContainer: {
    padding: 16,
    borderRadius: 20,
    marginBottom: 8,
  },
  qrToggleLink: {
    paddingVertical: 10,
  },
  qrToggleText: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
});
