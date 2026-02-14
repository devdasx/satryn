import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../stores';
import { THEME, getThemeColors } from '../constants';
import { getColors } from '../constants/colors';
import type { ThemeColors } from '../constants';
import type { ThemeMode } from '../types';

interface UseThemeResult {
  /** true when the resolved theme is any dark variant (dim or midnight) */
  isDark: boolean;
  /** The resolved ThemeMode: 'light' | 'dim' | 'midnight' */
  themeMode: ThemeMode;
  /** Legacy palette from THEME.dark / THEME.dim / THEME.light */
  colors: ThemeColors;
  /** Full THEME constant (for accessing typography, spacing, etc.) */
  theme: typeof THEME;
}

/**
 * Resolves the user's theme preference (including "system") into a concrete ThemeMode.
 * When "system" is selected:
 *   - system dark  → defaults to 'midnight' (matches previous dark behavior)
 *   - system light → 'light'
 */
export function resolveThemeMode(
  preference: string,
  systemDark: boolean | null | undefined,
): ThemeMode {
  if (preference === 'system') {
    return systemDark ? 'midnight' : 'light';
  }
  // Direct theme selection: 'light' | 'dim' | 'midnight'
  if (preference === 'dim' || preference === 'midnight' || preference === 'light') {
    return preference;
  }
  // Fallback for any unexpected value
  return 'midnight';
}

export function useTheme(): UseThemeResult {
  const systemColorScheme = useColorScheme();
  const userTheme = useSettingsStore(s => s.theme);

  // Resolve to a concrete ThemeMode
  const themeMode = resolveThemeMode(userTheme, systemColorScheme === 'dark');

  const isDark = themeMode !== 'light';
  const colors = getThemeColors(themeMode);

  return {
    isDark,
    themeMode,
    colors,
    theme: THEME,
  };
}
