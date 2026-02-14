// iOS 26 Premium Design System for Bitcoin Wallet
// Liquid Glass + Premium Typography + Refined Depth

export const THEME = {
  // Core brand colors
  brand: {
    bitcoin: '#CC4B24',
    /** Original Bitcoin orange — for light-mode or branding outside dark UI */
    bitcoinOriginal: '#F7931A',
    bitcoinLight: '#FFB74D',
    bitcoinDark: '#E65100',
    bitcoinGlow: 'rgba(204, 75, 36, 0.5)',
    bitcoinSoft: 'rgba(204, 75, 36, 0.15)',
    // Light mode brand: black. Dark mode brand: custom accent.
    primary: '#000000',
    primaryLight: '#1C1C1E',
    primaryDark: '#CC4B24',     // Brand accent for dark mode
    primaryDarkLight: '#E06A3E', // Lighter variant
  },

  // Sync status indicator colors
  syncStatus: {
    synced: '#30D158',      // Green - connected and synced
    syncing: '#FFD60A',     // Amber - currently syncing
    notSynced: '#8E8E93',   // Gray - not synced
    offline: '#FF453A',     // Red - no network connection
  },

  // Premium Gradients (iOS 26 style)
  gradients: {
    bitcoin: ['#CC4B24', '#A03A1A'] as const,
    bitcoinSoft: ['rgba(204, 75, 36, 0.2)', 'rgba(160, 58, 26, 0.1)'] as const,
    success: ['#34C759', '#30B350'] as const,
    premium: ['#1A1A1E', '#0D0D0F'] as const,
    premiumLight: ['#FFFFFF', '#F5F5F7'] as const,
    glass: ['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)'] as const,
    glassLight: ['rgba(0, 0, 0, 0.03)', 'rgba(0, 0, 0, 0.01)'] as const,
    shimmer: ['transparent', 'rgba(255, 255, 255, 0.1)', 'transparent'] as const,
  },

  // Z-Index layers
  zIndex: {
    base: 1,
    card: 10,
    sticky: 50,
    modal: 100,
    overlay: 200,
    toast: 300,
  },

  // iOS 26 Liquid Glass System
  liquidGlass: {
    // Blur intensities for different depths
    blur: {
      subtle: 20,
      medium: 40,
      strong: 60,
      intense: 80,
      max: 100,
    },
    // Glass background opacities
    opacity: {
      ultraThin: 0.02,
      thin: 0.04,
      regular: 0.06,
      medium: 0.08,
      thick: 0.12,
      opaque: 0.18,
    },
    // Glass border opacities
    border: {
      subtle: 0.06,
      regular: 0.1,
      prominent: 0.15,
    },
  },

  // Dark theme (primary) - Premium Modern Dark
  dark: {
    // Backgrounds - premium depth hierarchy (no pure black)
    background: '#0D0D0F',
    backgroundSecondary: '#111114',
    backgroundTertiary: '#161618',
    surface: '#1A1A1E',
    surfaceSecondary: '#1F1F24',
    surfaceElevated: '#262630',
    surfaceHighlight: '#2C2C34',
    card: '#1A1A1E',

    // Solid surface tokens (premium cards without glass)
    surfacePrimary: '#131316',
    surfaceSecondaryAlt: '#18181C',
    surfaceAccent: '#1E1E24',

    // Text colors - refined hierarchy
    text: '#F5F5F7',
    textPrimary: '#F5F5F7',
    textSecondary: 'rgba(245, 245, 247, 0.65)',
    textTertiary: 'rgba(245, 245, 247, 0.45)',
    textMuted: 'rgba(245, 245, 247, 0.50)',
    textDisabled: 'rgba(245, 245, 247, 0.20)',

    // Semantic colors - iOS 26 vibrant
    success: '#30D158',
    successLight: '#34C759',
    error: '#FF453A',
    errorLight: '#FF6961',
    warning: '#FFD60A',
    warningLight: '#FF9F0A',
    info: '#0A84FF',
    infoLight: '#64D2FF',

    // Semantic backgrounds
    successMuted: 'rgba(48, 209, 88, 0.15)',
    errorMuted: 'rgba(255, 69, 58, 0.15)',
    warningMuted: 'rgba(255, 214, 10, 0.15)',
    infoMuted: 'rgba(10, 132, 255, 0.15)',

    // Premium borders
    border: 'rgba(255, 255, 255, 0.10)',
    borderLight: 'rgba(255, 255, 255, 0.06)',
    borderStrong: 'rgba(255, 255, 255, 0.18)',
    borderAccent: 'rgba(204, 75, 36, 0.45)',

    // Liquid glass effects
    glass: 'rgba(255, 255, 255, 0.05)',
    glassLight: 'rgba(255, 255, 255, 0.03)',
    glassMedium: 'rgba(255, 255, 255, 0.07)',
    glassStrong: 'rgba(255, 255, 255, 0.11)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.13)',

    // Tinted glass variants
    glassBitcoin: 'rgba(204, 75, 36, 0.10)',
    glassSuccess: 'rgba(48, 209, 88, 0.08)',
    glassError: 'rgba(255, 69, 58, 0.08)',

    // Fill colors (iOS style)
    fill: 'rgba(120, 120, 128, 0.2)',
    fillSecondary: 'rgba(120, 120, 128, 0.16)',
    fillTertiary: 'rgba(120, 120, 128, 0.12)',

    // Tab bar
    tabBar: 'rgba(13, 13, 15, 0.92)',
    tabBarBorder: 'rgba(255, 255, 255, 0.08)',

    // Overlays
    overlay: 'rgba(0, 0, 0, 0.6)',
    overlayLight: 'rgba(0, 0, 0, 0.4)',
    overlayDark: 'rgba(0, 0, 0, 0.8)',

    // Interactive states
    pressed: 'rgba(255, 255, 255, 0.1)',
    focused: 'rgba(204, 75, 36, 0.25)',
    selected: 'rgba(204, 75, 36, 0.18)',
  },

  // Dim theme - Softer dark with warm navy tones (like X/Twitter Dim)
  dim: {
    // Backgrounds - warm navy depth hierarchy
    background: '#15202B',
    backgroundSecondary: '#192734',
    backgroundTertiary: '#1E2D3D',
    surface: '#1C2938',
    surfaceSecondary: '#22303F',
    surfaceElevated: '#283A4B',
    surfaceHighlight: '#2C3E50',
    card: '#1C2938',

    // Solid surface tokens
    surfacePrimary: '#182330',
    surfaceSecondaryAlt: '#1A2836',
    surfaceAccent: '#1F2E3E',

    // Text colors - slightly warmer whites
    text: '#E7E9EA',
    textPrimary: '#E7E9EA',
    textSecondary: 'rgba(231, 233, 234, 0.65)',
    textTertiary: 'rgba(231, 233, 234, 0.45)',
    textMuted: 'rgba(231, 233, 234, 0.50)',
    textDisabled: 'rgba(231, 233, 234, 0.20)',

    // Semantic colors - slightly softer than midnight
    success: '#30D158',
    successLight: '#34C759',
    error: '#FF453A',
    errorLight: '#FF6961',
    warning: '#FFD60A',
    warningLight: '#FF9F0A',
    info: '#1D9BF0',
    infoLight: '#64D2FF',

    // Semantic backgrounds
    successMuted: 'rgba(48, 209, 88, 0.15)',
    errorMuted: 'rgba(255, 69, 58, 0.15)',
    warningMuted: 'rgba(255, 214, 10, 0.15)',
    infoMuted: 'rgba(29, 155, 240, 0.15)',

    // Premium borders - slightly blue-tinted
    border: 'rgba(255, 255, 255, 0.12)',
    borderLight: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.20)',
    borderAccent: 'rgba(204, 75, 36, 0.45)',

    // Liquid glass effects
    glass: 'rgba(255, 255, 255, 0.06)',
    glassLight: 'rgba(255, 255, 255, 0.04)',
    glassMedium: 'rgba(255, 255, 255, 0.08)',
    glassStrong: 'rgba(255, 255, 255, 0.12)',
    glassBorder: 'rgba(255, 255, 255, 0.09)',
    glassHighlight: 'rgba(255, 255, 255, 0.14)',

    // Tinted glass variants
    glassBitcoin: 'rgba(204, 75, 36, 0.10)',
    glassSuccess: 'rgba(48, 209, 88, 0.08)',
    glassError: 'rgba(255, 69, 58, 0.08)',

    // Fill colors (iOS style)
    fill: 'rgba(120, 120, 128, 0.22)',
    fillSecondary: 'rgba(120, 120, 128, 0.18)',
    fillTertiary: 'rgba(120, 120, 128, 0.14)',

    // Tab bar
    tabBar: 'rgba(21, 32, 43, 0.92)',
    tabBarBorder: 'rgba(255, 255, 255, 0.08)',

    // Overlays
    overlay: 'rgba(0, 0, 0, 0.6)',
    overlayLight: 'rgba(0, 0, 0, 0.4)',
    overlayDark: 'rgba(0, 0, 0, 0.8)',

    // Interactive states
    pressed: 'rgba(255, 255, 255, 0.1)',
    focused: 'rgba(204, 75, 36, 0.25)',
    selected: 'rgba(204, 75, 36, 0.18)',
  },

  // Light theme - iOS 26 Inspired
  light: {
    // Backgrounds - clean hierarchy with proper contrast
    background: '#F2F2F7',
    backgroundSecondary: '#E5E5EA',
    backgroundTertiary: '#D1D1D6',
    surface: '#FFFFFF',
    surfaceSecondary: '#F9F9F9',
    surfaceElevated: '#FFFFFF',
    surfaceHighlight: '#F2F2F7',
    card: '#FFFFFF',

    // Solid surface tokens (premium cards without glass)
    surfacePrimary: '#FFFFFF',
    surfaceSecondaryAlt: '#F5F5F7',
    surfaceAccent: '#EFEFEF',

    // Text colors
    text: '#000000',
    textPrimary: '#000000',
    textSecondary: 'rgba(0, 0, 0, 0.6)',
    textTertiary: 'rgba(0, 0, 0, 0.45)',
    textMuted: 'rgba(0, 0, 0, 0.45)',
    textDisabled: 'rgba(0, 0, 0, 0.2)',

    // Semantic colors - iOS 26 vibrant
    success: '#34C759',
    successLight: '#30D158',
    error: '#FF3B30',
    errorLight: '#FF453A',
    warning: '#FF9500',
    warningLight: '#FFD60A',
    info: '#007AFF',
    infoLight: '#0A84FF',

    // Semantic backgrounds
    successMuted: 'rgba(52, 199, 89, 0.12)',
    errorMuted: 'rgba(255, 59, 48, 0.12)',
    warningMuted: 'rgba(255, 149, 0, 0.12)',
    infoMuted: 'rgba(0, 122, 255, 0.12)',

    // Borders
    border: 'rgba(0, 0, 0, 0.12)',
    borderLight: 'rgba(0, 0, 0, 0.06)',
    borderStrong: 'rgba(0, 0, 0, 0.2)',
    borderAccent: 'rgba(247, 147, 26, 0.4)',

    // Liquid glass effects
    glass: 'rgba(0, 0, 0, 0.04)',
    glassLight: 'rgba(0, 0, 0, 0.02)',
    glassMedium: 'rgba(0, 0, 0, 0.06)',
    glassStrong: 'rgba(0, 0, 0, 0.1)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.8)',

    // Tinted glass variants
    glassBitcoin: 'rgba(247, 147, 26, 0.08)',
    glassSuccess: 'rgba(52, 199, 89, 0.08)',
    glassError: 'rgba(255, 59, 48, 0.08)',

    // Fill colors (iOS style)
    fill: 'rgba(120, 120, 128, 0.12)',
    fillSecondary: 'rgba(120, 120, 128, 0.08)',
    fillTertiary: 'rgba(120, 120, 128, 0.04)',

    // Tab bar
    tabBar: 'rgba(255, 255, 255, 0.9)',
    tabBarBorder: 'rgba(0, 0, 0, 0.08)',

    // Overlays
    overlay: 'rgba(0, 0, 0, 0.4)',
    overlayLight: 'rgba(0, 0, 0, 0.2)',
    overlayDark: 'rgba(0, 0, 0, 0.6)',

    // Interactive states
    pressed: 'rgba(0, 0, 0, 0.08)',
    focused: 'rgba(247, 147, 26, 0.15)',
    selected: 'rgba(247, 147, 26, 0.12)',
  },

  // Premium Typography - iOS 26 San Francisco Style
  typography: {
    fontFamily: {
      regular: 'System',
      medium: 'System',
      semibold: 'System',
      bold: 'System',
    },

    // Refined size scale
    size: {
      '2xs': 10,
      xs: 11,
      sm: 13,
      base: 15,
      md: 17,
      lg: 20,
      xl: 24,
      '2xl': 28,
      '3xl': 34,
      '4xl': 40,
      '5xl': 48,
      display: 56,
      hero: 64,
    },

    weight: {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
      heavy: '800' as const,
    },

    lineHeight: {
      none: 1,
      tight: 1.15,
      snug: 1.25,
      normal: 1.4,
      relaxed: 1.6,
      loose: 1.8,
    },

    letterSpacing: {
      tighter: -1,
      tight: -0.5,
      normal: 0,
      wide: 0.5,
      wider: 1,
      widest: 2,
    },
  },

  // Enhanced spacing system (4pt base)
  spacing: {
    '2xs': 2,
    xs: 4,
    sm: 8,
    md: 12,
    base: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
    '4xl': 48,
    '5xl': 56,
    '6xl': 64,
  },

  // Premium border radius - more rounded for iOS 26
  radius: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
    '4xl': 40,
    full: 9999,
  },

  // Enhanced shadows - premium depth system
  shadows: {
    // Subtle shadows for minimal elevation
    xs: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 1,
      elevation: 1,
    },
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 3,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
    },
    xl: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 8,
    },
    '2xl': {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.22,
      shadowRadius: 24,
      elevation: 12,
    },
    // Premium glow effects
    glow: {
      shadowColor: '#CC4B24',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 20,
      elevation: 10,
    },
    glowSubtle: {
      shadowColor: '#CC4B24',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 6,
    },
    glowSoft: {
      shadowColor: '#CC4B24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    // Inner shadow effect (for pressed states)
    inner: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 0,
    },
    // Colored glows
    successGlow: {
      shadowColor: '#30D158',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    errorGlow: {
      shadowColor: '#FF453A',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
  },

  // Animation timing
  animation: {
    // Durations
    instant: 100,
    fast: 150,
    normal: 250,
    slow: 350,
    slower: 500,

    // Spring configs for reanimated
    spring: {
      gentle: { damping: 20, stiffness: 150 },
      bouncy: { damping: 12, stiffness: 180 },
      snappy: { damping: 15, stiffness: 300 },
      smooth: { damping: 25, stiffness: 120 },
    },
  },

  // iOS 26 specific constants
  ios: {
    // Safe area defaults
    safeArea: {
      top: 59,
      bottom: 34,
    },
    // Navigation bar heights
    navBar: {
      compact: 44,
      large: 96,
    },
    // Tab bar
    tabBar: {
      height: 49,
      heightWithSafeArea: 83,
    },
    // Blur view tints
    blurTint: {
      dark: 'dark' as const,
      light: 'light' as const,
      default: 'default' as const,
      extraLight: 'extraLight' as const,
      prominent: 'prominent' as const,
      systemMaterial: 'systemMaterial' as const,
      systemThinMaterial: 'systemThinMaterial' as const,
      systemUltraThinMaterial: 'systemUltraThinMaterial' as const,
    },
  },
} as const;

// Theme color type
type ThemeColorKeys = keyof typeof THEME.dark;
export type ThemeColors = { readonly [K in ThemeColorKeys]: string };

// Theme mode type (matches the type in types/index.ts)
export type ThemeMode = 'light' | 'dim' | 'midnight';

// Helper to get current theme colors by mode
export const getThemeColors = (mode: ThemeMode): ThemeColors => {
  switch (mode) {
    case 'midnight': return THEME.dark;
    case 'dim': return THEME.dim;
    case 'light':
    default: return THEME.light;
  }
};

/** @deprecated Use getThemeColors(mode) instead. Kept for backward-compat during migration. */
export const getThemeColorsByBool = (isDark: boolean): ThemeColors => {
  return isDark ? THEME.dark : THEME.light;
};

// Export commonly used values
export const { typography, spacing, radius, shadows, animation, liquidGlass } = THEME;
