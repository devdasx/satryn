import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native';
import QRCodeSVG from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { captureQRToBase64, shareQRAsPNG } from '../../utils/qrExport';

// ─── Types ──────────────────────────────────────────────────────

interface ExportableQRProps {
  /** The string value to encode in the QR code */
  value: string;
  /** Size of the QR code (default 220) */
  size?: number;
  /** Error correction level (default 'M') */
  ecl?: 'L' | 'M' | 'Q' | 'H';
  /** Optional pill label below QR (e.g., "ZPUB", "wpkh()") */
  pillLabel?: string;
  /** Color for the pill label text + background tint */
  pillColor?: string;
  /** Filename for exports (without extension) */
  exportFilename?: string;
  /** Whether to show action buttons (default true) */
  showActions?: boolean;
  /** Text color for action icons */
  iconColor?: string;
  /** Background color for action icon containers */
  iconBgColor?: string;
  /** Callback when copy is triggered */
  onCopy?: () => void;
  /** Theme colors */
  colors: {
    text: string;
    background: string;
    textSecondary?: string;
  };
}

// ─── Component ──────────────────────────────────────────────────

export function ExportableQR({
  value,
  size = 220,
  ecl = 'M',
  pillLabel,
  pillColor = '#F7931A',
  exportFilename = 'qr-code',
  showActions = true,
  iconColor,
  iconBgColor,
  colors,
}: ExportableQRProps) {
  const svgRef = useRef<any>(null);
  const actionIconColor = iconColor || colors.textSecondary || '#8E8E93';
  const actionBgColor = iconBgColor || colors.background;

  // ─── Actions ──────────────────────
  const handleCopy = useCallback(async () => {
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(value);
  }, [value]);

  const handleSharePNG = useCallback(async () => {
    await Haptics.selectionAsync();
    if (svgRef.current) {
      await shareQRAsPNG(svgRef.current, value, exportFilename);
    } else {
      // Fallback to text share
      await Share.share({ message: value });
    }
  }, [value, exportFilename]);

  const handleShareText = useCallback(async () => {
    await Haptics.selectionAsync();
    try {
      await Share.share({ message: value });
    } catch (err) {
      console.error('Share failed:', err);
    }
  }, [value]);

  const handleRef = useCallback((ref: any) => {
    svgRef.current = ref;
  }, []);

  // ─── Long Press Context Menu ──────────────────────
  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'QR Code',
      undefined,
      [
        { text: 'Copy Text', onPress: handleCopy },
        { text: 'Share as Image', onPress: handleSharePNG },
        { text: 'Share as Text', onPress: handleShareText },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [handleCopy, handleSharePNG, handleShareText]);

  return (
    <View style={styles.container}>
      {/* Actions row (top-right of card, above QR) */}
      {showActions && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: actionBgColor }]}
            onPress={handleCopy}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="copy-outline" size={17} color={actionIconColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: actionBgColor }]}
            onPress={handleSharePNG}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="image-outline" size={17} color={actionIconColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: actionBgColor }]}
            onPress={handleShareText}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="share-outline" size={17} color={actionIconColor} />
          </TouchableOpacity>
        </View>
      )}

      {/* QR Code */}
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={handleLongPress}
        delayLongPress={400}
        style={styles.qrTouchable}
      >
        <View style={[styles.qrContainer, { width: size + 32, height: size + 32 }]}>
          <QRCodeSVG
            value={value}
            size={size}
            backgroundColor="#FFFFFF"
            color="#000000"
            ecl="H"
            quietZone={0}
            getRef={handleRef}
            logo={require('../../../appIcon.png')}
            logoSize={size * 0.17}
            logoBackgroundColor="#FFFFFF"
            logoMargin={3}
            logoBorderRadius={size * 0.03}
          />
        </View>
      </TouchableOpacity>

      {/* Pill label */}
      {pillLabel && (
        <View style={[styles.pill, { backgroundColor: pillColor + '15' }]}>
          <Text style={[styles.pillText, { color: pillColor }]}>{pillLabel}</Text>
        </View>
      )}

    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    position: 'relative',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    alignSelf: 'flex-end',
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrTouchable: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 8,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
