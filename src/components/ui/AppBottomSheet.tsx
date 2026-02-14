/**
 * AppBottomSheet
 * Premium bottom sheet component using react-native-true-sheet
 * Design: Apple Wallet / premium banking style with 55px corner radius
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  InteractionManager,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet, TrueSheetProps } from '@lodev09/react-native-true-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

const DEBUG = false;
const log = (...args: any[]) => DEBUG && console.log('[AppBottomSheet]', ...args);

export interface AppBottomSheetProps {
  /** Whether the sheet is visible */
  visible: boolean;

  /** Called when the sheet should close */
  onClose: () => void;

  /** Sheet content */
  children: React.ReactNode;

  /** Optional header title */
  title?: string;

  /** Optional header subtitle */
  subtitle?: string;

  /** Show close button in header (default: true when title is provided) */
  showCloseButton?: boolean;

  /** Footer content (rendered with safe area padding) */
  footer?: React.ReactNode;

  /**
   * Sizing behavior:
   * - 'auto': Fits content (default)
   * - 'medium': 50% screen height
   * - 'large': 75% screen height
   * - 'full': 90% screen height
   * - number[]: Custom detent values (0-1 for percentages)
   * - ('auto' | 'medium' | 'large' | 'full' | number)[]: Mixed array for multiple stops
   */
  sizing?: 'auto' | 'medium' | 'large' | 'full' | number[] | ('auto' | 'medium' | 'large' | 'full' | number)[];

  /** Enable scrollable content */
  scrollable?: boolean;

  /** Allow swipe down to close (default: true) */
  dismissible?: boolean;

  /**
   * Change this value to force TrueSheet to re-measure content height.
   * Useful when children change size while the sheet is already presented.
   */
  contentKey?: number | string;

  /** Called when the sheet has fully presented (animation complete) */
  onDidPresent?: () => void;

  /** @deprecated Use dismissible instead - kept for backwards compatibility */
  enablePanDownToClose?: boolean;

  /** Show native iOS grabber handle (default: false) */
  grabber?: boolean;

  /** @deprecated Keyboard handling is now native and automatic */
  keyboardAware?: boolean;
}

export function AppBottomSheet({
  visible,
  onClose,
  children,
  title,
  subtitle,
  showCloseButton,
  footer,
  sizing = 'auto',
  scrollable = false,
  dismissible = true,
  grabber: showGrabber = false,
  contentKey,
  onDidPresent,
  enablePanDownToClose,
}: AppBottomSheetProps) {
  // Support deprecated enablePanDownToClose prop
  const isDismissible = enablePanDownToClose !== undefined ? enablePanDownToClose : dismissible;
  const sheetRef = useRef<TrueSheet>(null);
  const insets = useSafeAreaInsets();
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);
  const wasVisible = useRef(false);
  const lastContentHeight = useRef<number>(0);

  // Determine if close button should show
  const shouldShowCloseButton = showCloseButton !== undefined ? showCloseButton : !!title;

  // Convert sizing to detents - supports mixed arrays like ['auto', 'large']
  const getDetents = useCallback((): TrueSheetProps['detents'] => {
    // Helper to convert a single size value
    const convertSize = (size: 'auto' | 'medium' | 'large' | 'full' | number): 'auto' | number => {
      if (typeof size === 'number') return size;
      switch (size) {
        case 'medium': return 0.5;
        case 'large': return 0.75;
        case 'full': return 0.9;
        case 'auto':
        default: return 'auto';
      }
    };

    if (Array.isArray(sizing)) {
      // Check if it's a mixed array (contains strings like 'auto', 'large')
      const hasMixedTypes = sizing.some(s => typeof s === 'string');
      if (hasMixedTypes) {
        return sizing.map(s => convertSize(s as any)) as TrueSheetProps['detents'];
      }
      // Pure number array
      return sizing as TrueSheetProps['detents'];
    }

    // Single string value
    return [convertSize(sizing)];
  }, [sizing]);

  // Handle visibility changes
  useEffect(() => {
    let cancelled = false;
    const presentSheet = async () => {
      if (visible && !wasVisible.current) {
        wasVisible.current = true;
        log(`visible → true, contentKey=${contentKey}, waiting 50ms before present...`);
        // Wait 50ms for React to render children and native layout to settle
        await new Promise(r => setTimeout(r, 50));
        if (cancelled) return;
        try {
          log('calling present(0)');
          await sheetRef.current?.present(0);
          log('present(0) resolved');
        } catch (error) {
          log('present(0) failed:', error);
        }
      } else if (!visible && wasVisible.current) {
        wasVisible.current = false;
        log('visible → false, dismissing');
        try {
          await sheetRef.current?.dismiss();
        } catch (error) {
          // Sheet may already be dismissed
        }
      }
    };

    presentSheet();
    return () => { cancelled = true; };
  }, [visible]);

  // Re-measure content when contentKey changes while the sheet is already presented.
  // 4-tier cascade: 50ms quick, InteractionManager, 300ms delayed, 600ms safety net.
  useEffect(() => {
    if (!wasVisible.current || contentKey === undefined) return;
    log(`contentKey changed to: ${contentKey} — scheduling resize cascade`);
    let cancelled = false;

    const doResize = async (label: string) => {
      if (cancelled || !wasVisible.current) return;
      try {
        log(`resize(0) [${label}] for contentKey=${contentKey}`);
        await sheetRef.current?.resize(0);
        log(`resize(0) [${label}] completed`);
      } catch {
        // Sheet may not be presented — suppress warning
      }
    };

    // Tier 1: Quick resize
    const t1 = setTimeout(() => doResize('50ms'), 50);
    // Tier 2: After all animations complete
    const interaction = InteractionManager.runAfterInteractions(() => {
      doResize('afterInteractions');
    });
    // Tier 3: Delayed resize
    const t2 = setTimeout(() => doResize('300ms'), 300);
    // Tier 4: Safety net for slow devices
    const t3 = setTimeout(() => doResize('600ms'), 600);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      interaction.cancel();
    };
  }, [contentKey]);

  // Dismiss sheet programmatically (used by close button)
  const handleClosePress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await sheetRef.current?.dismiss();
    } catch {
      // Sheet may already be dismissed — call onClose directly as fallback
      wasVisible.current = false;
      onClose();
    }
  }, [onClose]);

  const handleDismiss = useCallback(() => {
    // Sheet was dismissed natively (swipe down or programmatic dismiss) — sync our tracking ref
    wasVisible.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const handleDidPresent = useCallback(() => {
    log(`onDidPresent fired, contentKey=${contentKey}`);
    // After present animation completes, resize to pick up any content
    // that rendered during the animation
    setTimeout(async () => {
      if (!wasVisible.current) return;
      try {
        log('resize(0) [postPresent] triggered');
        await sheetRef.current?.resize(0);
        log('resize(0) [postPresent] completed');
      } catch {}
    }, 50);
    onDidPresent?.();
  }, [onDidPresent, contentKey]);

  // Track content height changes and trigger resize when content actually changes size.
  // This is the most reliable approach — reacts to actual native layout, not guessed timeouts.
  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    const prev = lastContentHeight.current;
    log(`onLayout: height=${Math.round(height)}, prev=${Math.round(prev)}, contentKey=${contentKey}, visible=${wasVisible.current}`);

    // If height changed meaningfully (>5px to avoid float noise), trigger resize
    if (wasVisible.current && Math.abs(height - prev) > 5) {
      lastContentHeight.current = height;
      log(`height changed by ${Math.round(height - prev)}px — scheduling layout-triggered resize`);
      // One frame delay to let native side process the layout change
      setTimeout(async () => {
        try {
          log('resize(0) [onLayout] triggered');
          await sheetRef.current?.resize(0);
          log('resize(0) [onLayout] completed');
        } catch {}
      }, 16);
    } else {
      lastContentHeight.current = height;
    }
  }, [contentKey]);

  // Render header if title provided
  const renderHeader = () => {
    if (!title && !shouldShowCloseButton) return null;

    return (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {title && (
            <Text style={[styles.headerTitle, { color: c.bottomSheet.title }]}>
              {title}
            </Text>
          )}
          {subtitle && (
            <Text style={[styles.headerSubtitle, { color: c.bottomSheet.subtitle }]}>
              {subtitle}
            </Text>
          )}
        </View>
        {shouldShowCloseButton && (
          <TouchableOpacity
            onPress={handleClosePress}
            activeOpacity={0.7}
            style={[
              styles.closeButton,
              { backgroundColor: c.bottomSheet.closeButtonBg }
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="close"
              size={20}
              color={c.bottomSheet.closeButtonIcon}
            />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Render the full sheet content
  // Key fix: When using 'auto' sizing, we DON'T use flex:1 anywhere
  // This allows content to determine the sheet height naturally
  const isAutoSizing = sizing === 'auto' ||
    (Array.isArray(sizing) && (sizing as readonly (string | number)[]).includes('auto'));

  return (
    <TrueSheet
      ref={sheetRef}
      detents={getDetents()}
      cornerRadius={55}
      grabber={showGrabber}
      dismissible={isDismissible}
      backgroundColor={c.bottomSheet.bg}
      scrollable={scrollable}
      onDidDismiss={handleDismiss}
      onDidPresent={handleDidPresent}
    >
      <View
        style={[styles.container, scrollable && !isAutoSizing && { flex: 1 }]}
        onLayout={handleContentLayout}
      >
        {/* Header */}
        {renderHeader()}

        {/* Content - use ScrollView when scrollable so TrueSheet can coordinate gestures */}
        {scrollable ? (
          <ScrollView
            style={!isAutoSizing ? { flex: 1 } : undefined}
            contentContainerStyle={{ paddingBottom: footer && isAutoSizing ? 0 : Math.max(insets.bottom, 34) }}
            showsVerticalScrollIndicator={false}
            bounces={true}
            keyboardShouldPersistTaps="handled"
          >
            {children}
            {/* When auto-sizing + scrollable, render footer inside ScrollView so TrueSheet measures full height */}
            {footer && isAutoSizing && (
              <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 34) }]}>
                {footer}
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.content}>
            {children}
          </View>
        )}

        {/* Footer - rendered outside ScrollView for fixed-size sheets */}
        {footer && !isAutoSizing && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 34) }]}>
            {footer}
          </View>
        )}
        {/* Footer - rendered outside ScrollView for non-scrollable auto sheets */}
        {footer && isAutoSizing && !scrollable && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 34) }]}>
            {footer}
          </View>
        )}
      </View>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 28,
  },

  // Header - Premium banking style
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 28,
    marginBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 15,
    fontWeight: '400',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  // Content - no horizontal padding, let children control their own padding
  content: {
    // No flex, no padding - content determines height
  },

  // Footer - with horizontal padding, vertical handled dynamically
  footer: {
    paddingHorizontal: 28,
    paddingTop: 16,
  },
});

export default AppBottomSheet;
