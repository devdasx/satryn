import React, { memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '../../constants/theme';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

interface TabItem {
  key: string;
  label: string;
  icon: (props: { focused: boolean; color: string }) => React.ReactNode;
}

interface GlassTabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabPress: (key: string) => void;
}

export const GlassTabBar = memo(function GlassTabBar({ tabs, activeTab, onTabPress }: GlassTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const content = (
    <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        const color = isActive ? c.glassTabBar.activeText : c.glassTabBar.inactiveText;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconContainer, isActive && { backgroundColor: c.glassTabBar.activeIconBg }]}>
              {tab.icon({ focused: isActive, color })}
            </View>
            <Text
              style={[
                styles.label,
                { color },
                isActive && styles.labelActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.container, { backgroundColor: c.glassTabBar.bg }]}>
        <BlurView
          intensity={isDark ? 90 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.border, {
          backgroundColor: c.glassTabBar.border,
        }]} />
        {content}
      </View>
    );
  }

  return (
    <View style={[styles.container, {
      backgroundColor: c.glassTabBar.androidBg,
    }]}>
      <View style={[styles.border, {
        backgroundColor: c.glassTabBar.border,
      }]} />
      {content}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: THEME.zIndex.card,
  },
  border: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  content: {
    flexDirection: 'row',
    paddingTop: THEME.spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: THEME.spacing.xs,
  },
  iconContainer: {
    width: 48,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: THEME.radius.md,
  },
  iconContainerActive: {},
  label: {
    fontSize: THEME.typography.size.xs,
    marginTop: THEME.spacing.xs,
    fontWeight: THEME.typography.weight.medium,
  },
  labelActive: {
    fontWeight: THEME.typography.weight.semibold,
  },
});
