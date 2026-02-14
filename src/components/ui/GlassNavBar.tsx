import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '../../constants/theme';
import { getColors } from '../../constants';
import { useTheme } from '../../hooks';

interface NavButton {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}

interface GlassNavBarProps {
  title?: string;
  subtitle?: string;
  leftButton?: NavButton;
  rightButton?: NavButton;
  rightButtons?: NavButton[];
  transparent?: boolean;
  large?: boolean;
}

export function GlassNavBar({
  title,
  subtitle,
  leftButton,
  rightButton,
  rightButtons,
  transparent = false,
  large = false,
}: GlassNavBarProps) {
  const insets = useSafeAreaInsets();
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const content = (
    <View style={[styles.content, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {leftButton && (
            <TouchableOpacity
              onPress={leftButton.onPress}
              style={styles.button}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={leftButton.accessibilityLabel || 'Back'}
            >
              {leftButton.icon}
            </TouchableOpacity>
          )}
        </View>

        {!large && title && (
          <View style={styles.center}>
            <Text style={[styles.title, { color: c.navbar.text }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle && (
              <Text style={[styles.subtitle, { color: c.text.secondary }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        )}

        <View style={styles.right}>
          {rightButton && (
            <TouchableOpacity
              onPress={rightButton.onPress}
              style={styles.button}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={rightButton.accessibilityLabel || 'Action'}
            >
              {rightButton.icon}
            </TouchableOpacity>
          )}
          {rightButtons?.map((btn, index) => (
            <TouchableOpacity
              key={index}
              onPress={btn.onPress}
              style={[styles.button, index > 0 && styles.buttonSpaced]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={btn.accessibilityLabel || 'Action'}
            >
              {btn.icon}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {large && title && (
        <View style={styles.largeTitle}>
          <Text style={[styles.largeTitleText, { color: c.navbar.text }]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.largeSubtitle, { color: c.text.secondary }]}>{subtitle}</Text>
          )}
        </View>
      )}
    </View>
  );

  if (transparent) {
    return <View style={styles.container}>{content}</View>;
  }

  // Glass blur on iOS
  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? 'transparent' : 'rgba(255,255,255,0.50)' }]}>
        <BlurView
          intensity={isDark ? 80 : 70}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.border, {
          backgroundColor: c.navbar.border,
        }]} />
        {content}
      </View>
    );
  }

  // Android fallback
  return (
    <View style={[styles.container, {
      backgroundColor: c.tabBar.bg,
    }]}>
      <View style={[styles.border, {
        backgroundColor: c.navbar.border,
      }]} />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: THEME.zIndex.card,
  },
  content: {
    paddingHorizontal: THEME.spacing.base,
    paddingBottom: THEME.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  center: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  button: {
    padding: THEME.spacing.xs,
  },
  buttonSpaced: {
    marginLeft: THEME.spacing.sm,
  },
  title: {
    fontSize: THEME.typography.size.md,
    fontWeight: THEME.typography.weight.semibold,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: THEME.typography.size.xs,
    marginTop: 2,
  },
  largeTitle: {
    paddingTop: THEME.spacing.sm,
    paddingBottom: THEME.spacing.xs,
  },
  largeTitleText: {
    fontSize: THEME.typography.size['3xl'],
    fontWeight: THEME.typography.weight.bold,
    letterSpacing: THEME.typography.letterSpacing.tight,
  },
  largeSubtitle: {
    fontSize: THEME.typography.size.base,
    marginTop: THEME.spacing.xs,
  },
  border: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});
