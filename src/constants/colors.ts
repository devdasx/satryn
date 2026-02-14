/**
 * colors.ts — Single Source of Truth for ALL Component Colors
 *
 * Every UI element in the app references this file.
 * Three themes are fully mapped: Light, Dim (warm navy), Midnight (OLED black).
 * To change the app's visual identity, update ONLY this file.
 *
 * Usage: import { getColors } from '../constants/colors';
 *        const c = getColors('midnight');   // or 'dim' or 'light'
 *        <View style={{ backgroundColor: c.card.bg }} />
 */

import { THEME } from './theme';
import type { ThemeMode } from '../types';

// ─── Brand ───────────────────────────────────────────────────────
const BRAND = {
  /** Dark-mode brand accent used as the primary brand color */
  bitcoin: '#CC4B24',
  /** Original Bitcoin orange — for light-mode or branding outside dark UI */
  bitcoinOriginal: '#F7931A',
  bitcoinLight: '#FFB74D',
  bitcoinDark: '#E65100',
} as const;

// ─── Core Palettes ──────────────────────────────────────────────
const MIDNIGHT = THEME.dark;
const DIM = THEME.dim;
const LIGHT = THEME.light;

// ─── Color Map Factory ──────────────────────────────────────────

export function getColors(mode: ThemeMode) {
  const t = mode === 'light' ? LIGHT : mode === 'dim' ? DIM : MIDNIGHT;
  const isDark = mode !== 'light'; // true for both dim and midnight

  return {
    // ── Backgrounds ──────────────────────────────────────────
    background: t.background,
    backgroundSecondary: t.backgroundSecondary,
    backgroundTertiary: t.backgroundTertiary,

    // ── Surfaces ─────────────────────────────────────────────
    surface: t.surface,
    surfaceSecondary: t.surfaceSecondary,
    surfaceElevated: t.surfaceElevated,
    surfaceHighlight: t.surfaceHighlight,

    // ── Text ─────────────────────────────────────────────────
    text: {
      primary: t.textPrimary,
      secondary: t.textSecondary,
      tertiary: t.textTertiary,
      muted: t.textMuted,
      disabled: t.textDisabled,
    },

    // ── Brand / Accent ───────────────────────────────────────
    brand: {
      primary: isDark ? BRAND.bitcoin : '#000000',
      bitcoin: BRAND.bitcoin,
    },

    // ── Semantic ─────────────────────────────────────────────
    semantic: {
      success: t.success,
      successLight: t.successLight,
      successMuted: t.successMuted,
      error: t.error,
      errorLight: t.errorLight,
      errorMuted: t.errorMuted,
      warning: t.warning,
      warningLight: t.warningLight,
      warningMuted: t.warningMuted,
      info: t.info,
      infoLight: t.infoLight,
      infoMuted: t.infoMuted,
    },

    // ── Borders ──────────────────────────────────────────────
    border: {
      default: t.border,
      light: t.borderLight,
      strong: t.borderStrong,
      accent: t.borderAccent,
    },

    // ── Glass / Blur ─────────────────────────────────────────
    glass: {
      default: t.glass,
      light: t.glassLight,
      medium: t.glassMedium,
      strong: t.glassStrong,
      border: t.glassBorder,
      highlight: t.glassHighlight,
      bitcoin: t.glassBitcoin,
      success: t.glassSuccess,
      error: t.glassError,
    },

    // ── Fill (iOS style) ─────────────────────────────────────
    fill: {
      default: t.fill,
      secondary: t.fillSecondary,
      tertiary: t.fillTertiary,
    },

    // ── Interactive States ────────────────────────────────────
    interactive: {
      pressed: t.pressed,
      focused: t.focused,
      selected: t.selected,
    },

    // ── Overlay ──────────────────────────────────────────────
    overlay: {
      default: t.overlay,
      light: t.overlayLight,
      dark: t.overlayDark,
    },

    // ════════════════════════════════════════════════════════════
    // COMPONENT-SPECIFIC TOKENS
    // ════════════════════════════════════════════════════════════

    // ── Primary Button ───────────────────────────────────────
    primaryButton: {
      bg: isDark ? BRAND.bitcoin : '#0D0D0D',
      text: '#FFFFFF',
      bgDisabled: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      textDisabled: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
    },

    // ── Secondary Button ─────────────────────────────────────
    secondaryButton: {
      bg: 'transparent',
      text: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)',
      border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
    },

    // ── Tertiary Button ──────────────────────────────────────
    tertiaryButton: {
      bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      text: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
    },

    // ── Ghost Button ─────────────────────────────────────────
    ghostButton: {
      bg: 'transparent',
      text: t.textSecondary,
    },

    // ── Destructive Button ───────────────────────────────────
    destructiveButton: {
      bg: '#FF453A',
      text: '#FFFFFF',
    },

    // ── Card ─────────────────────────────────────────────────
    card: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      bgElevated: isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF',
      bgSubtle: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    },

    // ── Settings Card ────────────────────────────────────────
    settingsCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },

    // ── Settings Row ─────────────────────────────────────────
    settingsRow: {
      iconBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      iconColor: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)',
      label: t.textPrimary,
      description: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)',
      value: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
      arrow: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
      divider: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      dangerIconBg: isDark ? 'rgba(255,69,58,0.10)' : 'rgba(255,69,58,0.07)',
    },

    // ── Section Label ────────────────────────────────────────
    sectionLabel: {
      text: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)',
    },

    // ── Input ────────────────────────────────────────────────
    input: {
      bg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      text: t.textPrimary,
      placeholder: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)',
      border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      borderFocused: isDark ? 'rgba(204,75,36,0.4)' : 'rgba(204,75,36,0.3)',
    },

    // ── Bottom Sheet ─────────────────────────────────────────
    bottomSheet: {
      bg: isDark ? t.surface : '#FFFFFF',
      handle: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      title: t.textPrimary,
      subtitle: t.textMuted,
      closeButtonBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      closeButtonIcon: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
    },

    // ── Tab Bar ──────────────────────────────────────────────
    tabBar: {
      bg: t.tabBar,
      border: t.tabBarBorder,
      active: isDark ? BRAND.bitcoin : '#000000',
      inactive: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
    },

    // ── Navbar (Collapsible) ─────────────────────────────────
    navbar: {
      bg: isDark ? t.background : '#FFFFFF',
      text: isDark ? t.textPrimary : '#000000',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    },

    // ── Avatar ───────────────────────────────────────────────
    avatar: {
      fallbackBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      fallbackText: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
      badgeBg: isDark ? '#FFD60A' : '#FF9500',
      badgeIcon: isDark ? '#000000' : '#FFFFFF',
    },

    // ── Contact Card ─────────────────────────────────────────
    contactCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      name: t.textPrimary,
      address: t.textTertiary,
      tagBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      tagText: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
      divider: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    },

    // ── Transaction Row ──────────────────────────────────────
    txRow: {
      bg: 'transparent',
      title: t.textPrimary,
      subtitle: t.textTertiary,
      amountReceived: t.success,
      amountSent: t.textPrimary,
      fiatAmount: t.textTertiary,
      iconBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      iconColor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
      divider: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    },

    // ── Sync Status ──────────────────────────────────────────
    sync: {
      synced: '#30D158',
      syncing: '#FFD60A',
      notSynced: '#8E8E93',
      offline: '#FF453A',
    },

    // ── Action Circles (Send/Receive/Scan) ───────────────────
    actionCircle: {
      bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      icon: t.textPrimary,
      label: t.textMuted,
    },

    // ── Capsule / Pill ───────────────────────────────────────
    capsule: {
      bg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      text: t.textTertiary,
      border: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    },

    // ── Chip ─────────────────────────────────────────────────
    chip: {
      bg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      text: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
      icon: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
    },

    // ── Feature Pill ─────────────────────────────────────────
    featurePill: {
      bg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
      text: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)',
      icon: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)',
    },

    // ── Empty State ──────────────────────────────────────────
    emptyState: {
      title: t.textPrimary,
      subtitle: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)',
      iconBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
      iconBgOuter: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
      icon: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
      ringBorder: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
      ringBorderOuter: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
      buttonBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      buttonText: t.textPrimary,
    },

    // ── Onboarding Primary Button ────────────────────────────
    onboardingButton: {
      primaryBg: isDark ? '#FFFFFF' : '#0D0D0D',
      primaryText: isDark ? '#000000' : '#FFFFFF',
      secondaryBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
      secondaryText: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
    },

    // ── Typewriter Tips ──────────────────────────────────────
    typewriterTips: {
      chipBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      chipBorder: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      text: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
      cursor: isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)',
      icon: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)',
    },

    // ── Wallet Switcher ──────────────────────────────────────
    walletSwitcher: {
      activeBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      activeBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      rowBg: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      rowBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      walletIconBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      walletIconColor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
      checkmark: t.success,
    },

    // ── Security Banner ──────────────────────────────────────
    securityBanner: {
      successBg: isDark ? 'rgba(48,209,88,0.08)' : 'rgba(52,199,89,0.06)',
      successBorder: isDark ? 'rgba(48,209,88,0.15)' : 'rgba(52,199,89,0.12)',
      warningBg: isDark ? 'rgba(255,214,10,0.08)' : 'rgba(255,149,0,0.06)',
      warningBorder: isDark ? 'rgba(255,214,10,0.15)' : 'rgba(255,149,0,0.12)',
    },

    // ── Info Card ────────────────────────────────────────────
    infoCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      text: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
      infoIconBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      infoIconColor: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
      warningIconBg: isDark ? 'rgba(255,149,0,0.10)' : 'rgba(255,149,0,0.07)',
      errorIconBg: isDark ? 'rgba(255,69,58,0.10)' : 'rgba(255,69,58,0.07)',
    },

    // ── Status Pill ──────────────────────────────────────────
    statusPill: {
      successBg: 'rgba(48,209,88,0.12)',
      successText: '#30D158',
      warningBg: 'rgba(255,149,0,0.12)',
      warningText: '#FF9500',
      errorBg: 'rgba(255,69,58,0.12)',
      errorText: '#FF453A',
      neutralBg: 'rgba(142,142,147,0.12)',
      neutralText: '#8E8E93',
    },

    // ── Send Flow ────────────────────────────────────────────
    send: {
      headerBg: 'transparent',
      headerTitle: t.textPrimary,
      headerSubtitle: t.textMuted,
      stepDotActive: isDark ? BRAND.bitcoin : '#000000',
      stepDotInactive: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      keypadText: t.textPrimary,
      keypadBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    },

    // ── Receive Screen ───────────────────────────────────────
    receive: {
      qrBg: '#FFFFFF',
      addressBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      addressText: t.textPrimary,
    },

    // ── QR Scanner ───────────────────────────────────────────
    scanner: {
      overlayBg: 'rgba(0,0,0,0.6)',
      frameBorder: isDark ? BRAND.bitcoin : BRAND.bitcoin,
    },

    // ── Toggle / Switch ──────────────────────────────────────
    toggle: {
      trackOn: isDark ? BRAND.bitcoin : '#34C759',
      trackOff: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
      thumb: '#FFFFFF',
    },

    // ── Search Bar ───────────────────────────────────────────
    searchBar: {
      bg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      text: t.textPrimary,
      placeholder: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
      icon: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
    },

    // ── Badge / Count ────────────────────────────────────────
    badge: {
      bg: isDark ? BRAND.bitcoin : BRAND.bitcoin,
      text: '#FFFFFF',
      dotBg: t.success,
    },

    // ── Refresh Control ──────────────────────────────────────
    refreshControl: {
      tint: isDark ? '#FFFFFF' : '#000000',
      progressBg: isDark ? '#1A1A1A' : '#F5F5F5',
    },

    // ── Alert Bar ────────────────────────────────────────────
    alertBar: {
      infoBg: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(0,122,255,0.08)',
      infoText: t.info,
      warningBg: isDark ? 'rgba(255,214,10,0.12)' : 'rgba(255,149,0,0.08)',
      warningText: isDark ? '#FFD60A' : '#FF9500',
      errorBg: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,59,48,0.08)',
      errorText: t.error,
      successBg: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.08)',
      successText: t.success,
    },

    // ── Seed Phrase Grid ─────────────────────────────────────
    seedPhrase: {
      cellBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      cellBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      indexText: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
      wordText: t.textPrimary,
    },

    // ── UTXO Card ────────────────────────────────────────────
    utxoCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      selectedBorder: isDark ? 'rgba(204,75,36,0.4)' : 'rgba(204,75,36,0.3)',
      frozenBg: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,59,48,0.04)',
    },

    // ── Wallet Detail Grid ───────────────────────────────────
    walletDetail: {
      cellBg: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      cellLabel: t.textTertiary,
      cellValue: t.textPrimary,
    },

    // ── Slide To Pay ─────────────────────────────────────────
    slideToPay: {
      trackBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      thumbBg: isDark ? BRAND.bitcoin : '#0D0D0D',
      thumbIcon: '#FFFFFF',
      text: t.textTertiary,
      successTrackBg: t.success,
    },

    // ── Fee Selector ─────────────────────────────────────────
    feeSelector: {
      optionBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      optionBgSelected: isDark ? 'rgba(204,75,36,0.12)' : 'rgba(204,75,36,0.08)',
      optionBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      optionBorderSelected: isDark ? 'rgba(204,75,36,0.4)' : 'rgba(204,75,36,0.3)',
      optionLabel: t.textPrimary,
      optionValue: t.textSecondary,
    },

    // ── Review Card (Send Review Screen) ─────────────────────
    reviewCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      label: t.textTertiary,
      value: t.textPrimary,
      divider: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      totalValue: t.textPrimary,
      fiatSubtext: t.textMuted,
      optionsPillBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      optionsPillText: t.textTertiary,
    },

    // ── Success Screen (Send Success) ──────────────────────
    successScreen: {
      headerBg: isDark ? 'rgba(48,209,88,0.06)' : 'rgba(52,199,89,0.04)',
      headerIcon: isDark ? '#30D158' : '#34C759',
      statusPillBg: isDark ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.08)',
      statusPillText: isDark ? '#FF9F0A' : '#FF9500',
      confirmedPillBg: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(52,199,89,0.08)',
      confirmedPillText: isDark ? '#30D158' : '#34C759',
    },

    // ── Backup Card ──────────────────────────────────────────
    backupCard: {
      bg: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
      border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      iconBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    },

    // ── Multisig ─────────────────────────────────────────────
    multisig: {
      cosignerBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      cosignerBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      signedBorder: isDark ? 'rgba(48,209,88,0.3)' : 'rgba(52,199,89,0.25)',
    },

    // ── Nearby Payment ───────────────────────────────────────
    nearby: {
      peerBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      peerBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      scanningPulse: isDark ? BRAND.bitcoin : BRAND.bitcoin,
    },

    // ── Pin Entry ────────────────────────────────────────────
    pin: {
      dotActive: isDark ? '#FFFFFF' : '#000000',
      dotInactive: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      keyBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      keyText: t.textPrimary,
      errorDot: '#FF453A',
    },

    // ── Entropy Collector ────────────────────────────────────
    entropy: {
      progressBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      progressFill: isDark ? BRAND.bitcoin : BRAND.bitcoin,
      cellBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    },

    // ── Market / Price Chart ─────────────────────────────────
    priceChart: {
      lineUp: t.success,
      lineDown: t.error,
      gridLine: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      labelText: t.textTertiary,
    },

    // ── Toast ────────────────────────────────────────────────
    toast: {
      bg: isDark
        ? (mode === 'dim' ? 'rgba(30, 45, 60, 0.90)' : 'rgba(40, 40, 40, 0.85)')
        : 'rgba(255, 255, 255, 0.9)',
      border: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
      title: t.textPrimary,
      message: t.textSecondary,
      minimalBg: isDark
        ? (mode === 'dim' ? 'rgba(30, 45, 60, 0.95)' : 'rgba(50, 50, 50, 0.95)')
        : 'rgba(0, 0, 0, 0.8)',
      minimalText: '#FFFFFF',
      successIcon: '#30D158',
      errorIcon: '#FF453A',
      infoIcon: isDark && mode === 'dim' ? '#1D9BF0' : '#0A84FF',
    },

    // ── Glass Card ─────────────────────────────────────────
    glassCard: {
      successBorder: isDark ? 'rgba(48, 209, 88, 0.2)' : 'rgba(52, 199, 89, 0.2)',
      errorBorder: isDark ? 'rgba(255, 69, 58, 0.2)' : 'rgba(255, 59, 48, 0.2)',
      warningBorder: isDark ? 'rgba(255, 214, 10, 0.2)' : 'rgba(255, 149, 0, 0.2)',
      shine: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.5)',
    },

    // ── Glass Tab Bar ──────────────────────────────────────
    glassTabBar: {
      bg: isDark ? 'transparent' : 'rgba(255,255,255,0.50)',
      androidBg: isDark ? t.tabBar : '#F8F8F8',
      border: isDark ? t.tabBarBorder : 'rgba(0,0,0,0.08)',
      activeIconBg: 'rgba(204, 75, 36, 0.15)',
      activeText: BRAND.bitcoin,
      inactiveText: isDark ? t.textSecondary : 'rgba(0,0,0,0.40)',
    },

    // ── Premium Input ──────────────────────────────────────
    premiumInput: {
      cardBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
      label: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)',
      divider: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      text: t.textPrimary,
      placeholder: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
      eyeIcon: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)',
      clearIcon: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)',
      iconBgAlpha: isDark ? '1F' : '14',
    },

    // ── Premium Text ───────────────────────────────────────
    premiumText: {
      primary: t.textPrimary,
      secondary: t.textSecondary,
      tertiary: t.textTertiary,
      muted: t.textMuted,
      accent: isDark ? BRAND.bitcoin : BRAND.bitcoin,
      success: t.success,
      error: t.error,
    },

    // ── Transaction Row (extended) ─────────────────────────
    txRowExtended: {
      pendingIconBg: isDark ? 'rgba(255,214,10,0.12)' : 'rgba(255,149,0,0.1)',
      selfIconBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      receiveIconBg: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
      sendIconBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      pendingReceiveAmount: isDark ? 'rgba(48,209,88,0.6)' : 'rgba(48,209,88,0.7)',
      pendingBadgeBg: isDark ? 'rgba(255,214,10,0.15)' : 'rgba(255,149,0,0.12)',
      noteText: isDark ? 'rgba(204,75,36,0.7)' : 'rgba(204,75,36,0.9)',
      tagBadgeBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      tagMoreText: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
      chevron: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
      divider: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    },

    // ── Wallet Header ──────────────────────────────────────
    walletHeader: {
      avatarBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      iconColor: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.50)',
      switchBg: isDark
        ? (mode === 'dim' ? '#1C2938' : '#1C1C1E')
        : '#FFFFFF',
      chevron: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
      name: t.textPrimary,
      editIcon: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
      typeText: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
    },

    // ── QR Code ────────────────────────────────────────────
    qrCode: {
      bg: isDark
        ? (mode === 'dim' ? '#1C2938' : '#1C1C1E')
        : '#FFFFFF',
      foreground: isDark ? '#FFFFFF' : '#000000',
    },

    // ── Pin Code Screen ────────────────────────────────────
    pinScreen: {
      bg: t.background,
      textPrimary: t.textPrimary,
      textSecondary: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)',
      iconCircleBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      dotBorder: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
      dotFilled: isDark ? '#FFFFFF' : '#000000',
      keypadBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      keypadText: t.textPrimary,
    },

    // ── Feedback Sheet ───────────────────────────────────────
    feedbackSheet: {
      bg: isDark ? t.surface : '#FFFFFF',
      inputBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    },
  } as const;
}

// Type export
export type AppColors = ReturnType<typeof getColors>;
