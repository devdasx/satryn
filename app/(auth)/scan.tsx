import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Linking,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/hooks';
import { isValidBitcoinAddress, isBitcoinUri } from '../../src/utils/validation';
import { TransactionBuilder } from '../../src/core/transaction/TransactionBuilder';
import { useWalletStore } from '../../src/stores';

const SCAN_WINDOW_SIZE = 240;
const CORNER_SIZE = 36;
const CORNER_RADIUS = 16;
const CORNER_WIDTH = 4;

export default function ScanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const network = useWalletStore(s => s.network);
  const isContactSource = params.source === 'contact';

  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);

  // Animation values
  const cornerPulse = useRef(new Animated.Value(0)).current;
  const screenAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const detectedScale = useRef(new Animated.Value(1)).current;
  const detectedOpacity = useRef(new Animated.Value(0)).current;
  const cornerGlow = useRef(new Animated.Value(0)).current;

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // Corner pulse animation — subtle breathing effect
  useEffect(() => {
    if (permission?.granted && !isClosing && !detected) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(cornerPulse, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(cornerPulse, {
            toValue: 0,
            duration: 1800,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [permission?.granted, isClosing, detected]);

  // Animated close with callback
  const animatedClose = useCallback((callback?: () => void) => {
    setIsClosing(true);
    Animated.parallel([
      Animated.timing(screenAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback?.();
    });
  }, [screenAnim, overlayAnim]);

  // QR detected animation — shrink corners + glow + checkmark
  const playDetectedAnimation = useCallback((callback: () => void) => {
    setDetected(true);
    Animated.parallel([
      Animated.spring(detectedScale, {
        toValue: 0.88,
        friction: 8,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(detectedOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(cornerGlow, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Brief hold, then close
      setTimeout(() => {
        animatedClose(callback);
      }, 500);
    });
  }, [detectedScale, detectedOpacity, cornerGlow, animatedClose]);

  const handleClose = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animatedClose(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(auth)');
      }
    });
  }, [router, animatedClose]);

  const handleToggleTorch = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTorchEnabled((prev) => !prev);
  }, []);

  const handlePasteInstead = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        handleBarCodeScanned({ data: text.trim() });
      }
    } catch {
      // Clipboard read failed
    }
  }, []);

  const handleOpenSettings = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  const handleBarCodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (hasScanned || isClosing) return;
    setHasScanned(true);
    setScanError(null);

    try {
      // ── Contact source: only accept valid Bitcoin addresses ──
      if (isContactSource) {
        let address = data;
        if (isBitcoinUri(data)) {
          const parsed = TransactionBuilder.parseBitcoinUri(data);
          address = parsed.address;
        } else {
          address = data.replace(/^bitcoin:/i, '').split('?')[0];
        }

        if (isValidBitcoinAddress(address, network)) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await Clipboard.setStringAsync(address);
          playDetectedAnimation(() => {
            if (router.canGoBack()) router.back();
          });
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setScanError('Not a valid Bitcoin address');
          setTimeout(() => {
            setHasScanned(false);
            setScanError(null);
          }, 3000);
        }
        return;
      }

      // ── Default scan flow: parse address/URI and navigate to send screen ──

      let address = data;
      let parsedAmount: number | undefined;
      let parsedMessage: string | undefined;

      if (isBitcoinUri(data)) {
        const parsed = TransactionBuilder.parseBitcoinUri(data);
        address = parsed.address;
        parsedAmount = parsed.amount ? Math.round(parsed.amount * 100_000_000) : undefined;
        parsedMessage = parsed.message;
      } else {
        address = data.replace(/^bitcoin:/i, '').split('?')[0];
      }

      if (isValidBitcoinAddress(address, network)) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Build route params for the send screen
        const sendParams: Record<string, string> = { address };
        if (parsedAmount) sendParams.amount = String(parsedAmount);
        if (parsedMessage) sendParams.memo = parsedMessage;

        playDetectedAnimation(() => {
          router.replace({ pathname: '/(auth)/send', params: sendParams });
        });
        return;
      }

      // Invalid QR code
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanError('Not a valid Bitcoin address or QR code');
      setTimeout(() => {
        setHasScanned(false);
        setScanError(null);
      }, 3000);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanError('Failed to read QR code');
      setTimeout(() => {
        setHasScanned(false);
        setScanError(null);
      }, 3000);
    }
  }, [hasScanned, isClosing, isContactSource, network, router, playDetectedAnimation, animatedClose]);

  // Animated styles
  const containerAnimStyle = {
    opacity: overlayAnim,
    transform: [
      {
        scale: screenAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1.05, 1],
        }),
      },
    ],
  };

  const contentAnimStyle = {
    opacity: screenAnim,
    transform: [
      {
        scale: screenAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      },
    ],
  };

  // Corner pulse opacity
  const cornerOpacity = cornerPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  // Corner glow color for detected state
  const cornerColor = detected ? '#30D158' : '#FFFFFF';

  // Permission denied view
  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <Animated.View style={[styles.container, { backgroundColor: colors.background }, containerAnimStyle]}>
        <TouchableOpacity
          style={[styles.closeButtonAbsolute, { top: insets.top + 16 }]}
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeButtonInner}>
            <Ionicons name="close" size={24} color={isDark ? '#FFF' : '#000'} />
          </View>
        </TouchableOpacity>

        <Animated.View style={[styles.permissionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)' }, contentAnimStyle]}>
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={isDark ? 30 : 60}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          )}
          <View style={[styles.permissionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <Ionicons name="camera-outline" size={32} color={colors.text} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.text }]}>
            Camera Access Needed
          </Text>
          <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
            Enable camera access to scan QR codes.
          </Text>
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: colors.text }]}
            onPress={handleOpenSettings}
            activeOpacity={0.85}
          >
            <Text style={[styles.permissionButtonText, { color: isDark ? '#000' : '#FFF' }]}>
              Open Settings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.permissionSecondary}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.permissionSecondaryText, { color: colors.textSecondary }]}>
              Not Now
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    );
  }

  // Loading permission state
  if (!permission || !permission.granted) {
    return (
      <Animated.View style={[styles.container, { backgroundColor: colors.background }, containerAnimStyle]}>
        <TouchableOpacity
          style={[styles.closeButtonAbsolute, { top: insets.top + 16 }]}
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeButtonInner}>
            <Ionicons name="close" size={24} color={isDark ? '#FFF' : '#000'} />
          </View>
        </TouchableOpacity>
        <Animated.View style={[styles.permissionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)' }, contentAnimStyle]}>
          <View style={[styles.permissionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <Ionicons name="camera-outline" size={32} color={colors.text} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.text }]}>
            Camera Permission
          </Text>
          <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
            Allow camera access to scan QR codes.
          </Text>
        </Animated.View>
      </Animated.View>
    );
  }

  // Camera view with Apple-style scanner
  return (
    <View style={styles.container}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: overlayAnim }]} />

      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchEnabled}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={hasScanned ? undefined : handleBarCodeScanned}
      />

      {/* Animated content overlay */}
      <Animated.View style={[styles.overlay, contentAnimStyle]}>
        {/* Top section */}
        <View style={[styles.topSection, { paddingTop: insets.top + 60 }]}>
          <Text style={styles.title}>Scan QR Code</Text>
          <Text style={styles.subtitle}>
            {isContactSource ? 'Scan a Bitcoin address' : 'Align the code within the frame'}
          </Text>
        </View>

        {/* Middle section with scan window */}
        <View style={styles.middleSection}>
          <View style={styles.sideDark} />
          <Animated.View style={[
            styles.scanWindow,
            { transform: [{ scale: detectedScale }] },
          ]}>
            {/* Rounded border */}
            <Animated.View style={[
              styles.scanBorder,
              { borderColor: cornerColor, opacity: detected ? 1 : cornerOpacity },
            ]} />

            {/* Corner brackets — Apple style */}
            <Animated.View style={[styles.cornerTL, { borderColor: cornerColor, opacity: detected ? 1 : cornerOpacity }]} />
            <Animated.View style={[styles.cornerTR, { borderColor: cornerColor, opacity: detected ? 1 : cornerOpacity }]} />
            <Animated.View style={[styles.cornerBL, { borderColor: cornerColor, opacity: detected ? 1 : cornerOpacity }]} />
            <Animated.View style={[styles.cornerBR, { borderColor: cornerColor, opacity: detected ? 1 : cornerOpacity }]} />

            {/* Detection success overlay */}
            <Animated.View style={[styles.detectedOverlay, { opacity: detectedOpacity }]}>
              <View style={styles.detectedCircle}>
                <Ionicons name="checkmark" size={32} color="#FFF" />
              </View>
            </Animated.View>
          </Animated.View>
          <View style={styles.sideDark} />
        </View>

        {/* Error banner */}
        {scanError && (
          <View style={styles.errorBanner}>
            <View style={styles.errorBannerInner}>
              <Ionicons name="alert-circle" size={18} color="#FF453A" />
              <Text style={styles.errorBannerText}>{scanError}</Text>
            </View>
          </View>
        )}

        {/* Bottom section with actions */}
        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={styles.pasteButton}
            onPress={handlePasteInstead}
            activeOpacity={0.7}
          >
            <Ionicons name="clipboard-outline" size={18} color="#FFF" />
            <Text style={styles.pasteButtonText}>Paste instead</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Header buttons */}
      <Animated.View style={[styles.headerButtons, { top: insets.top + 16 }, contentAnimStyle]}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.headerButtonInner}>
            <Ionicons name="close" size={24} color="#FFF" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleToggleTorch}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={[styles.headerButtonInner, torchEnabled && styles.headerButtonActive]}>
            <Ionicons
              name={torchEnabled ? 'flashlight' : 'flashlight-outline'}
              size={22}
              color="#FFF"
            />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  topSection: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '400',
  },
  middleSection: {
    flexDirection: 'row',
    height: SCAN_WINDOW_SIZE,
  },
  sideDark: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scanWindow: {
    width: SCAN_WINDOW_SIZE,
    height: SCAN_WINDOW_SIZE,
  },
  bottomSection: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    paddingTop: 32,
  },

  // Rounded border — subtle outline of scan area
  scanBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderRadius: CORNER_RADIUS,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  // Corner brackets — Apple-style thick corners
  cornerTL: {
    position: 'absolute',
    top: -1,
    left: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: CORNER_RADIUS,
  },
  cornerTR: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: CORNER_RADIUS,
  },
  cornerBL: {
    position: 'absolute',
    bottom: -1,
    left: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: CORNER_RADIUS,
  },
  cornerBR: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: CORNER_RADIUS,
  },

  // Detection success overlay
  detectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CORNER_RADIUS,
    backgroundColor: 'rgba(48,209,88,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detectedCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#30D158',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Error banner
  errorBanner: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  errorBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,69,58,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.25)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  errorBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF453A',
  },

  // Header buttons
  headerButtons: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerButton: {},
  headerButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.4)',
  },

  // Paste button
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  pasteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },

  // Permission screens
  closeButtonAbsolute: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
  },
  closeButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginHorizontal: 24,
    overflow: 'hidden' as const,
  },
  permissionIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionBody: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  permissionButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  permissionButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  permissionSecondary: {
    paddingVertical: 12,
  },
  permissionSecondaryText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
