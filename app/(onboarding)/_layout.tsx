import React from 'react';
import { Stack } from 'expo-router';
import { Platform, useColorScheme } from 'react-native';
import { THEME, getThemeColors } from '../../src/constants';
import { useSettingsStore } from '../../src/stores';
import { resolveThemeMode } from '../../src/hooks';

export default function OnboardingLayout() {
  const systemColorScheme = useColorScheme();
  const { theme } = useSettingsStore();

  // Resolve theme mode from user preference + system color scheme
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const colors = getThemeColors(themeMode);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Use default iOS push animation - do not specify custom duration
        // to match native iOS navigation timing (~350ms)
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
        // Enable swipe back gesture - LEFT EDGE ONLY (native iOS behavior)
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        // DO NOT enable fullScreenGestureEnabled - it causes accidental navigation
        // Native iOS behavior: swipe must start from left edge (~20pt)
      }}
    >
      {/* Welcome screen - no back gesture from here */}
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      {/* Flow screens - inherit default navigation */}
      <Stack.Screen name="create" />
      <Stack.Screen name="import" />
      <Stack.Screen name="multisig-intro" />
      <Stack.Screen name="multisig-create" />
      <Stack.Screen name="pin" />
      <Stack.Screen name="recover-icloud" />
      <Stack.Screen name="setup" options={{
        animation: 'fade',
        gestureEnabled: false,
        fullScreenGestureEnabled: false,
        headerLeft: () => null,
        headerBackVisible: false,
      }} />
    </Stack>
  );
}
