import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Redirect } from 'expo-router';
import { useWalletStore, useSettingsStore } from '../src/stores';
import { getThemeColors } from '../src/constants';
import { resolveThemeMode } from '../src/hooks';

export default function Index() {
  const isInitialized = useWalletStore(s => s.isInitialized);
  const isLocked = useWalletStore(s => s.isLocked);
  const walletId = useWalletStore(s => s.walletId);
  const hasPinSet = useWalletStore(s => s.hasPinSet);
  const systemColorScheme = useColorScheme();
  const theme = useSettingsStore(s => s.theme);

  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const colors = getThemeColors(themeMode);

  // Blank screen while initializing — native splash still visible
  if (!isInitialized) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  // Once initialized, redirect based on wallet state
  if (!walletId) {
    // User has a PIN but no wallet (skip mode or last wallet removed with "stay")
    // → go to auth with empty states instead of onboarding
    if (hasPinSet) {
      return <Redirect href="/(auth)" />;
    }
    return <Redirect href="/(onboarding)" />;
  }

  if (isLocked) {
    return <Redirect href="/(lock)" />;
  }

  return <Redirect href="/(auth)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
