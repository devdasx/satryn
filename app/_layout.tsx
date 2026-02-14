import '../shim'; // Import polyfills first
import React, { useEffect, useState, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useColorScheme, AppState, AppStateStatus, View, StyleSheet, Platform, Image } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { useWalletStore, usePriceStore, useSettingsStore, useSyncStore, useContactStore, useRecentRecipientStore, useTransactionLabelStore, useUTXOStore } from '../src/stores';
import { getThemeColors, SECURITY } from '../src/constants';
import { resolveThemeMode } from '../src/hooks';
import { logger } from '../src/utils/logger';
import { ErrorBoundary } from '../src/components/ui/ErrorBoundary';
import { BiometricState } from '../src/utils/biometricState';
import { getDeviceId } from '../src/services/DeviceIdentity';
import { PreserveDataSession } from '../src/services/auth/PreserveDataSession';
import { loadSettingsFromDB } from '../src/stores/settingsStore';
import { loadMultiWalletFromDB } from '../src/stores/multiWalletStore';
import { loadAddressBookFromDB } from '../src/stores/addressBookStore';
import { loadAccountRegistryFromDB } from '../src/stores/accountRegistryStore';
import { WalletSyncManager } from '../src/services/sync/WalletSyncManager';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const initialize = useWalletStore((state) => state.initialize);
  const refreshBalance = useWalletStore((state) => state.refreshBalance);
  const isLocked = useWalletStore((state) => state.isLocked);
  const lock = useWalletStore((state) => state.lock);
  const walletId = useWalletStore((state) => state.walletId);
  const fetchPrice = usePriceStore((state) => state.fetchPrice);
  const initNetworkListener = useSyncStore((state) => state.initNetworkListener);
  const systemColorScheme = useColorScheme();
  const { theme, autoLockTimeout } = useSettingsStore();

  // State for privacy blur when app is in background/app switcher
  const [showPrivacyBlur, setShowPrivacyBlur] = useState(false);

  // Animation values for premium dismiss effect
  const overlayOpacity = useSharedValue(0);
  const overlayScale = useSharedValue(1);

  // Animate overlay in/out based on showPrivacyBlur
  useEffect(() => {
    if (showPrivacyBlur) {
      // Cancel any in-progress dismiss animation
      cancelAnimation(overlayOpacity);
      cancelAnimation(overlayScale);
      // Show instantly (privacy: no delay)
      overlayOpacity.value = 1;
      overlayScale.value = 1;
    } else {
      // Animate out with premium feel
      overlayOpacity.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) });
      overlayScale.value = withTiming(1.04, { duration: 400, easing: Easing.out(Easing.cubic) });
    }
  }, [showPrivacyBlur]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    transform: [{ scale: overlayScale.value }],
  }));

  // Track when app went to background for auto-lock
  const backgroundTimeRef = useRef<number | null>(null);
  const appStateRef = useRef(AppState.currentState);

  // Resolve theme mode from user preference + system color scheme
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  // Global unhandled promise rejection handler — prevents silent crashes
  useEffect(() => {
    try {
      const rejectionTracking = require('promise/setimmediate/rejection-tracking');
      rejectionTracking.enable({
        allRejections: true,
        onUnhandled: (_id: number, error: any) => {
          logger.error('UNHANDLED_REJECTION', error?.message || String(error));
        },
        onHandled: () => {},
      });
      return () => {
        try { rejectionTracking.disable(); } catch {}
      };
    } catch {
      // promise/rejection-tracking not available — skip
      return () => {};
    }
  }, []);

  useEffect(() => {
    logger.perfStart('app-startup-total');
    // Hydrate DB-backed stores synchronously BEFORE wallet init
    // (settings, multiWallet, addressBook, accountRegistry read from SQLite — instant)
    loadSettingsFromDB();
    loadMultiWalletFromDB();
    loadAddressBookFromDB();
    loadAccountRegistryFromDB();
    // Initialize wallet on app start
    logger.perfStart('wallet-initialize');
    initialize().then(() => {
      logger.perfEnd('wallet-initialize');
      logger.perfEnd('app-startup-total');
    }).catch((err) => {
      logger.error('INIT', 'Wallet initialization failed', err);
      logger.perfEnd('wallet-initialize');
      logger.perfEnd('app-startup-total');
    });
    // Initialize DB-backed stores (contacts, recipients, labels, UTXOs)
    logger.perfStart('db-stores-init');
    Promise.all([
      useContactStore.getState().initFromDb(),
      useRecentRecipientStore.getState().initFromDb(),
      useTransactionLabelStore.getState().initFromDb(),
      useUTXOStore.getState().initFromDb(),
    ]).then(() => logger.perfEnd('db-stores-init'))
      .catch((err) => {
        logger.error('INIT', 'DB stores init failed', err);
        logger.perfEnd('db-stores-init');
      });
    // Fetch initial price
    logger.perfStart('initial-price-fetch');
    fetchPrice().then(() => logger.perfEnd('initial-price-fetch'))
      .catch(() => logger.perfEnd('initial-price-fetch'));
    // Pre-warm device identity for iCloud backup filtering
    getDeviceId();
    // Load preserve-data password from Keychain so ContinuousArchivalManager can use it
    PreserveDataSession.loadFromKeychain();
    // Initialize network listener for sync status
    const unsubscribeNetwork = initNetworkListener();

    return () => {
      unsubscribeNetwork();
    };
  }, []);

  // Handle app state changes for privacy blur and auto-lock
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const currentState = appStateRef.current;

      // App going to background or inactive (app switcher)
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Skip privacy blur during Face ID / biometric prompts
        if (!BiometricState.isActive()) {
          setShowPrivacyBlur(true);
        }

        // Only record background time if wallet is NOT already locked.
        // When the wallet is locked and Face ID modal appears, iOS fires
        // active → inactive → active which would cause an infinite lock loop.
        if (currentState === 'active' && backgroundTimeRef.current === null && !isLocked) {
          backgroundTimeRef.current = Date.now();
        }

        // Trigger continuous archival on app background
        if (nextAppState === 'background') {
          try {
            const { ContinuousArchivalManager } = require('../src/services/storage/ContinuousArchivalManager');
            ContinuousArchivalManager.triggerIfNeeded();
          } catch {
            // Non-critical
          }
        }
      }

      // App coming to foreground
      if (nextAppState === 'active') {
        // Hide privacy blur
        setShowPrivacyBlur(false);

        // Check if we should auto-lock
        if (backgroundTimeRef.current !== null && walletId && !isLocked) {
          const timeInBackground = Date.now() - backgroundTimeRef.current;

          // If auto-lock is set to immediate (0) or time exceeded timeout, lock the wallet
          if (autoLockTimeout === 0 || timeInBackground >= autoLockTimeout) {
            lock();
            router.replace('/(lock)');
          }
        }

        backgroundTimeRef.current = null;

        // Refresh balance if unlocked — use unified sync manager
        if (!isLocked && walletId) {
          WalletSyncManager.shared().triggerSync(walletId, 'foreground').catch(() => {});
        }
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isLocked, walletId, autoLockTimeout, lock, refreshBalance, router]);

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="pay" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="(onboarding)" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(lock)" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="(auth)" options={{ animation: 'slide_from_right' }} />
        </Stack>

        {/* Global Feedback Sheet (shake to report — works on every page) */}

        {/* Privacy blur overlay when app is in app switcher/background */}
        {Platform.OS === 'ios' && (
          <Animated.View style={[StyleSheet.absoluteFill, overlayAnimatedStyle]} pointerEvents="none">
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.privacyOverlay, { backgroundColor: colors.background }]} />
            <View style={styles.privacyLogoContainer}>
              <Image
                source={isDark ? require('../darkLogo.png') : require('../appLogo.png')}
                style={styles.privacyLogo}
                resizeMode="contain"
              />
            </View>
          </Animated.View>
        )}
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  privacyOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.85,
  },
  privacyLogoContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyLogo: {
    width: 120,
    height: 120,
    opacity: 0.7,
  },
});
