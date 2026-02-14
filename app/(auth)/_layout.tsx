import React from 'react';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../../src/stores';
import { getThemeColors } from '../../src/constants';
import { useBackgroundWalletSync, useRatingPrompt, useAutoBackup, resolveThemeMode } from '../../src/hooks';
import { ErrorBoundary } from '../../src/components/ui/ErrorBoundary';

export default function AuthLayout() {
  const systemColorScheme = useColorScheme();
  const theme = useSettingsStore(s => s.theme);

  // Background sync for all wallets (every 30 seconds)
  useBackgroundWalletSync();

  // Daily auto-backup to iCloud (checks on foreground events)
  useAutoBackup();

  // Track usage time and prompt for rating after 15 minutes
  useRatingPrompt();

  // Resolve theme mode from user preference + system color scheme
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const colors = getThemeColors(themeMode);

  return (
    <ErrorBoundary>
    <>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        // Use default iOS push animation - do not specify custom duration
        // to match native iOS navigation timing (~350ms)
        animation: 'slide_from_right',
        // Enable swipe back gesture - LEFT EDGE ONLY (native iOS behavior)
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        // DO NOT enable fullScreenGestureEnabled - it causes accidental navigation
        // Native iOS behavior: swipe must start from left edge (~20pt)
      }}
    >
      {/* Main tabs screen - no swipe back from here */}
      <Stack.Screen
        name="(tabs)"
        options={{
          animation: 'none',
          gestureEnabled: false,
        }}
      />

      {/* Detail screens - inherit default gesture settings (edge-only swipe) */}
      <Stack.Screen
        name="scan"
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="send"
        options={{
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen name="send-recipient" />
      <Stack.Screen name="send-amount" />
      <Stack.Screen name="send-review" />
      <Stack.Screen name="send-pin" options={{ gestureEnabled: false }} />
      <Stack.Screen name="send-broadcasting" options={{ gestureEnabled: false }} />
      <Stack.Screen name="send-success" options={{ gestureEnabled: false }} />
      <Stack.Screen name="send-psbt" />
      <Stack.Screen name="receive" />
      <Stack.Screen name="transactions" />
      <Stack.Screen name="transaction-details" />
      <Stack.Screen name="addresses" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="change-pin" />
      <Stack.Screen name="verify-pin" />
      <Stack.Screen name="broadcast" />
      <Stack.Screen name="xpub" />
      <Stack.Screen name="descriptors" />
      <Stack.Screen name="utxo-management" />
      <Stack.Screen name="sign-message" />
      <Stack.Screen name="verify-message" />
      <Stack.Screen name="nearby" />

      {/* Wallet Hub */}
      <Stack.Screen name="wallet-hub" />

      {/* Contacts */}
      <Stack.Screen name="contacts" />
      <Stack.Screen name="contact-details" />

      {/* Account Management Screens */}
      <Stack.Screen name="account-create" />

      {/* Watch-Only Import Screens */}
      <Stack.Screen name="import-watch-only" />
      <Stack.Screen name="import-xpub" />
      <Stack.Screen name="import-descriptor" />
      <Stack.Screen name="import-addresses" />

      {/* Multisig Screens - use default navigation (inherited from screenOptions) */}
      <Stack.Screen name="multisig-setup" />
      <Stack.Screen name="multisig-add-cosigner" />
      <Stack.Screen name="multisig-review" />


      {/* Data & Backup Hub */}
      <Stack.Screen name="data-backup" />

      {/* iCloud Backup Screen */}
      <Stack.Screen name="icloud-backup" />

      {/* Backup Flow Screens */}
      <Stack.Screen name="backup-flow" />
      <Stack.Screen name="backup-manual" />
      <Stack.Screen name="backup-icloud" />
      <Stack.Screen name="backup-export" />


      {/* Bitcoin Details Screen */}
      <Stack.Screen name="bitcoin-details" />

      {/* Wallet Mode */}
      <Stack.Screen name="wallet-mode" />

      {/* Electrum Server */}
      <Stack.Screen name="electrum-server" />


      {/* Privacy & Analytics */}
      <Stack.Screen name="privacy" />

      {/* Info Screens */}
      <Stack.Screen name="about" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="bug-bounty" />

      {/* Settings Detail Screens */}
      <Stack.Screen name="appearance" />
      <Stack.Screen name="display-unit" />
      <Stack.Screen name="local-currency" />
      <Stack.Screen name="default-fee" />
      <Stack.Screen name="gap-limit" />
    </Stack>
    </>
    </ErrorBoundary>
  );
}
