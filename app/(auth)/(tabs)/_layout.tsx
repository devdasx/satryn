import React from 'react';
import { Platform, useColorScheme } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '../../../src/stores';
import { getThemeColors } from '../../../src/constants';
import { getColors } from '../../../src/constants';
import { resolveThemeMode } from '../../../src/hooks';

// Detect if NativeTabs (Liquid Glass) is available
// NativeTabs requires iOS 26+ and expo-router/unstable-native-tabs
let NativeTabs: any = null;
let hasNativeTabs = false;

if (Platform.OS === 'ios') {
  try {
    // NativeTabs is only available on iOS 26+ with Liquid Glass support
    // On earlier iOS versions, this import may fail or render incorrectly
    const nativeTabsModule = require('expo-router/unstable-native-tabs');
    // Check if we're on iOS 26+ (which is where Liquid Glass is supported)
    const iosVersion = parseInt(Platform.Version as string, 10);
    if (iosVersion >= 26 && nativeTabsModule?.NativeTabs) {
      NativeTabs = nativeTabsModule.NativeTabs;
      hasNativeTabs = true;
    }
  } catch {
    // NativeTabs not available — fall back to regular Tabs
  }
}

export default function TabsLayout() {
  const systemColorScheme = useColorScheme();
  const theme = useSettingsStore(s => s.theme);

  // Resolve theme mode from user preference + system color scheme
  const themeMode = resolveThemeMode(theme, systemColorScheme === 'dark');
  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);
  const c = getColors(themeMode);

  // Tab bar colors from centralized tokens
  const tabTintColor = c.tabBar.active;
  const tabInactiveColor = c.tabBar.inactive;

  // Use NativeTabs on iOS 26+ for Liquid Glass tab bar
  if (hasNativeTabs && NativeTabs) {
    return (
      <NativeTabs
        tintColor={tabTintColor}
        iconColor={{
          default: tabInactiveColor,
          selected: tabTintColor,
        }}
        labelStyle={{
          default: { color: tabInactiveColor },
          selected: { color: tabTintColor },
        }}
      >
        <NativeTabs.Trigger
          name="index"
          options={{
            title: 'Portfolio',
            icon: { sf: 'chart.pie' },
            selectedIcon: { sf: 'chart.pie.fill' },
          }}
        />
        <NativeTabs.Trigger
          name="wallet"
          options={{
            title: 'Wallet',
            icon: { sf: 'creditcard' },
            selectedIcon: { sf: 'creditcard.fill' },
          }}
        />
        <NativeTabs.Trigger
          name="contacts"
          options={{
            title: 'Contacts',
            icon: { sf: 'person.2' },
            selectedIcon: { sf: 'person.2.fill' },
          }}
        />
        <NativeTabs.Trigger
          name="settings"
          options={{
            title: 'Settings',
            icon: { sf: 'gear' },
            selectedIcon: { sf: 'gear' },
          }}
        />
      </NativeTabs>
    );
  }

  // Standard Tabs for iOS < 26 and Android
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        // Force initial tab bar color to prevent flash during navigation transitions
        tabBarStyle: {
          backgroundColor: c.tabBar.bg,
          borderTopWidth: 0.5,
          borderTopColor: c.tabBar.border,
          height: 84,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarActiveTintColor: tabTintColor,
        tabBarInactiveTintColor: tabInactiveColor,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        // Freeze inactive tabs to prevent re-renders that cause color flash
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pie-chart-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cog-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
