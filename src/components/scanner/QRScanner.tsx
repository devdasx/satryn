import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Linking,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics } from '../../hooks';

export interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  onPasteInstead?: () => void;
  title?: string;
  subtitle?: string;
}

const SCAN_WINDOW_SIZE = 240;
const CORNER_SIZE = 36;
const CORNER_RADIUS = 16;
const CORNER_WIDTH = 4;

export function QRScanner({
  visible,
  onClose,
  onScan,
  onPasteInstead,
  title = 'Scan QR',
  subtitle = 'Align the code within the frame',
}: QRScannerProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const haptics = useHaptics();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [detected, setDetected] = useState(false);

  // Animation values
  const cornerPulse = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const detectedScale = useRef(new Animated.Value(1)).current;
  const detectedOpacity = useRef(new Animated.Value(0)).current;

  // Handle modal visibility with animations
  useEffect(() => {
    if (visible) {
      setIsModalVisible(true);
      setIsClosing(false);
      setHasScanned(false);
      setTorchEnabled(false);
      setDetected(false);
      contentAnim.setValue(0);
      overlayAnim.setValue(0);
      detectedScale.setValue(1);
      detectedOpacity.setValue(0);
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(contentAnim, {
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
      }, 50);
    }
  }, [visible]);

  // Request permission when modal opens
  useEffect(() => {
    if (visible && !permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission]);

  // Corner pulse animation — subtle breathing effect
  useEffect(() => {
    if (visible && permission?.granted && !isClosing && !detected) {
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
  }, [visible, permission?.granted, isClosing, detected]);

  // Animated close with callback
  const animatedClose = useCallback((callback?: () => void) => {
    setIsClosing(true);
    Animated.parallel([
      Animated.timing(contentAnim, {
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
      setIsModalVisible(false);
      callback?.();
    });
  }, [contentAnim, overlayAnim]);

  // QR detected animation
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
    ]).start(() => {
      setTimeout(() => {
        animatedClose(callback);
      }, 500);
    });
  }, [detectedScale, detectedOpacity, animatedClose]);

  const handleClose = useCallback(async () => {
    await haptics.trigger('light');
    animatedClose(onClose);
  }, [haptics, onClose, animatedClose]);

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (hasScanned || isClosing) return;
      setHasScanned(true);
      await haptics.trigger('light');
      playDetectedAnimation(() => onScan(data));
    },
    [hasScanned, isClosing, haptics, onScan, playDetectedAnimation]
  );

  const handleToggleTorch = useCallback(async () => {
    await haptics.trigger('light');
    setTorchEnabled((prev) => !prev);
  }, [haptics]);

  const handlePasteInstead = useCallback(async () => {
    await haptics.trigger('light');
    animatedClose(() => onPasteInstead?.());
  }, [haptics, animatedClose, onPasteInstead]);

  const handleOpenSettings = useCallback(async () => {
    await haptics.trigger('light');
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, [haptics]);

  // Animated styles
  const contentAnimStyle = {
    opacity: contentAnim,
    transform: [
      {
        scale: contentAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      },
    ],
  };

  const overlayAnimStyle = {
    opacity: overlayAnim,
  };

  // Corner pulse opacity
  const cornerOpacity = cornerPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  const cornerColor = detected ? '#30D158' : '#FFFFFF';

  // Permission denied view
  const renderPermissionDenied = () => (
    <Animated.View style={[styles.permissionContainer, { backgroundColor: isDark ? '#000' : '#F5F5F7' }, overlayAnimStyle]}>
      <Animated.View style={[styles.permissionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF' }, contentAnimStyle]}>
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

      <Animated.View style={[styles.closeButton, { top: insets.top + 16 }, contentAnimStyle]}>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeButtonInner}>
            <Ionicons name="close" size={24} color={isDark ? '#FFF' : '#000'} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );

  // Camera not available
  const renderNoCameraAvailable = () => (
    <Animated.View style={[styles.permissionContainer, { backgroundColor: isDark ? '#000' : '#F5F5F7' }, overlayAnimStyle]}>
      <Animated.View style={[styles.permissionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF' }, contentAnimStyle]}>
        <View style={[styles.permissionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
          <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
        </View>
        <Text style={[styles.permissionTitle, { color: colors.text }]}>
          Camera Not Available
        </Text>
        <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
          Use the paste option to enter your data manually.
        </Text>
        {onPasteInstead && (
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: colors.text }]}
            onPress={handlePasteInstead}
            activeOpacity={0.85}
          >
            <Text style={[styles.permissionButtonText, { color: isDark ? '#000' : '#FFF' }]}>
              Paste Instead
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.permissionSecondary}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.permissionSecondaryText, { color: colors.textSecondary }]}>
            Close
          </Text>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View style={[styles.closeButton, { top: insets.top + 16 }, contentAnimStyle]}>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeButtonInner}>
            <Ionicons name="close" size={24} color={isDark ? '#FFF' : '#000'} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );

  return (
    <Modal
      visible={isModalVisible}
      animationType="none"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={handleClose}
    >
      {permission && !permission.granted && !permission.canAskAgain ? (
        renderPermissionDenied()
      ) : !permission ? (
        renderNoCameraAvailable()
      ) : !permission.granted ? (
        <Animated.View style={[styles.permissionContainer, { backgroundColor: isDark ? '#000' : '#F5F5F7' }, overlayAnimStyle]}>
          <Animated.View style={[styles.permissionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF' }, contentAnimStyle]}>
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
          <Animated.View style={[styles.closeButton, { top: insets.top + 16 }, contentAnimStyle]}>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <View style={styles.closeButtonInner}>
                <Ionicons name="close" size={24} color={isDark ? '#FFF' : '#000'} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      ) : (
        <View style={styles.container}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, overlayAnimStyle]} />

          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torchEnabled}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={hasScanned ? undefined : handleBarCodeScanned}
          />

          {/* Animated content overlay */}
          <Animated.View style={[styles.overlay, contentAnimStyle]}>
            {/* Top section with title */}
            <View style={[styles.topSection, { paddingTop: insets.top + 60 }]}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
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

                {/* Corner brackets */}
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

            {/* Bottom section with actions */}
            <View style={styles.bottomSection}>
              {onPasteInstead && (
                <TouchableOpacity
                  style={styles.pasteButton}
                  onPress={handlePasteInstead}
                  activeOpacity={0.7}
                >
                  <Ionicons name="clipboard-outline" size={18} color="#FFF" />
                  <Text style={styles.pasteButtonText}>Paste instead</Text>
                </TouchableOpacity>
              )}
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
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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

  // Rounded border
  scanBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderRadius: CORNER_RADIUS,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  // Corner brackets — Apple style
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
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
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

  // Close button for permission screens
  closeButton: {
    position: 'absolute',
    left: 20,
  },
  closeButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default QRScanner;
