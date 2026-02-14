/**
 * AppSheet - Bottom Sheet Component
 *
 * Two modes:
 * 1. fitContent=false (default): Uses native iOS pageSheet for full-height sheets
 * 2. fitContent=true: Uses custom animated sheet that sizes to content
 *
 * Features:
 * - No gray flash before opening
 * - Smooth animations
 * - Proper swipe-to-dismiss (native mode)
 * - Rounded top corners
 * - Correct safe area handling
 *
 * Usage:
 * <AppSheet visible={show} onClose={handleClose}>
 *   <YourContent />
 * </AppSheet>
 */

import React, { useCallback } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface AppSheetProps {
  /**
   * Whether the sheet is visible
   */
  visible: boolean;
  /**
   * Called when the sheet should close
   */
  onClose: () => void;
  /**
   * Sheet content
   */
  children: React.ReactNode;
  /**
   * Whether to show the handle bar at the top
   * @default true
   */
  showHandle?: boolean;
  /**
   * Whether to show close button in top-right
   * @default false (use swipe-to-dismiss by default)
   */
  showCloseButton?: boolean;
  /**
   * Title for the sheet header (optional)
   */
  title?: string;
  /**
   * Height hint for the sheet: 'auto' | 'medium' | 'large' | 'full'
   * Note: iOS pageSheet ignores this and uses system default
   * @default 'large'
   */
  size?: 'auto' | 'medium' | 'large' | 'full';
  /**
   * Whether to allow tapping backdrop to close
   * Note: Native pageSheet handles this automatically
   * @default true
   */
  closeOnBackdropPress?: boolean;
  /**
   * Whether the sheet should fit its content height
   * When true, uses formSheet on iOS which is smaller
   * @default false
   */
  fitContent?: boolean;
}

export function AppSheet({
  visible,
  onClose,
  children,
  showHandle = true,
  showCloseButton = false,
  title,
  size = 'large',
  closeOnBackdropPress = true,
  fitContent = false,
}: AppSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const handleRequestClose = useCallback(() => {
    if (closeOnBackdropPress) {
      onClose();
    }
  }, [closeOnBackdropPress, onClose]);

  const handleClosePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  // For fitContent mode, use a simple transparent modal that sizes to content
  if (fitContent) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
        onRequestClose={handleRequestClose}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.fitContentWrapper}
        >
          {/* Backdrop */}
          <TouchableWithoutFeedback onPress={closeOnBackdropPress ? onClose : undefined}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          {/* Sheet */}
          <View
            style={[
              styles.fitContentSheet,
              {
                backgroundColor: colors.background,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            {/* Handle bar */}
            {showHandle && (
              <View style={styles.handleContainer}>
                <View
                  style={[
                    styles.handle,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' },
                  ]}
                />
              </View>
            )}

            {/* Header with optional title and close button */}
            {(title || showCloseButton) && (
              <View style={styles.header}>
                <View style={styles.headerSpacer} />
                {title && (
                  <View style={styles.titleContainer}>
                    {/* Title would go here if needed */}
                  </View>
                )}
                {showCloseButton ? (
                  <TouchableOpacity
                    onPress={handleClosePress}
                    style={styles.closeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name="close"
                      size={22}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.headerSpacer} />
                )}
              </View>
            )}

            {/* Content */}
            {children}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  // Default mode: Use native pageSheet on iOS
  const presentationStyle = Platform.OS === 'ios' ? 'pageSheet' as const : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={presentationStyle}
      onRequestClose={handleRequestClose}
      transparent={Platform.OS === 'android'}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: Platform.OS === 'android'
              ? 'rgba(0,0,0,0.5)'
              : colors.background,
          },
        ]}
      >
        {/* Android backdrop (iOS uses native dimming) */}
        {Platform.OS === 'android' && (
          <TouchableOpacity
            style={styles.androidBackdrop}
            activeOpacity={1}
            onPress={closeOnBackdropPress ? onClose : undefined}
          />
        )}

        {/* Sheet content */}
        <View
          style={[
            styles.sheet,
            Platform.OS === 'android' && styles.androidSheet,
            {
              backgroundColor: colors.background,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          {/* Handle bar */}
          {showHandle && (
            <View style={styles.handleContainer}>
              <View
                style={[
                  styles.handle,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' },
                ]}
              />
            </View>
          )}

          {/* Header with optional title and close button */}
          {(title || showCloseButton) && (
            <View style={styles.header}>
              <View style={styles.headerSpacer} />
              {title && (
                <View style={styles.titleContainer}>
                  {/* Title would go here if needed */}
                </View>
              )}
              {showCloseButton ? (
                <TouchableOpacity
                  onPress={handleClosePress}
                  style={styles.closeButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name="close"
                    size={22}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              ) : (
                <View style={styles.headerSpacer} />
              )}
            </View>
          )}

          {/* Content */}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Default pageSheet mode
  container: {
    flex: 1,
  },
  androidBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    flex: 1,
    // iOS pageSheet already has rounded corners via native presentation
    // Android needs manual styling
    ...Platform.select({
      android: {
        marginTop: 50,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
      },
    }),
  },
  androidSheet: {
    // Additional Android-specific sheet styling
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },

  // FitContent mode - custom animated sheet
  fitContentWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  fitContentSheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: SCREEN_HEIGHT * 0.85,
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },

  // Common styles
  handleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerSpacer: {
    width: 40,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AppSheet;
