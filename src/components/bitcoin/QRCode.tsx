import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import QRCodeSVG from 'react-native-qrcode-svg';
import { TransactionBuilder } from '../../core/transaction/TransactionBuilder';
import { useTheme } from '../../hooks/useTheme';
import { getColors } from '../../constants';

interface QRCodeProps {
  address: string;
  amount?: number; // in satoshis
  label?: string;
  message?: string;
  size?: number;
  backgroundColor?: string;
  color?: string;
  showLogo?: boolean;
  /** Callback to receive the SVG ref (for toDataURL export) */
  onRef?: (ref: any) => void;
}

export function QRCode({
  address,
  amount,
  label,
  message,
  size = 200,
  backgroundColor: bgOverride,
  color: colorOverride,
  showLogo = true,
  onRef,
}: QRCodeProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  // QR codes must maintain high contrast for scanability.
  const backgroundColor = bgOverride ?? c.qrCode.bg;
  const color = colorOverride ?? c.qrCode.foreground;

  // Create BIP21 URI
  const uri = TransactionBuilder.createBitcoinUri(address, amount, label, message);

  // Logo size relative to QR code (~20%)
  const logoSize = size * 0.20;

  const handleRef = useCallback((ref: any) => {
    if (onRef) onRef(ref);
  }, [onRef]);

  return (
    <View style={styles.container}>
      <View style={[styles.qrInner, { width: size, height: size, backgroundColor }]}>
        <QRCodeSVG
          value={uri}
          size={size - 24}
          backgroundColor={backgroundColor}
          color={color}
          ecl="H" // High error correction for logo overlay
          quietZone={0}
          getRef={handleRef}
          {...(showLogo ? {
            logo: require('../../../appIcon.png'),
            logoSize: logoSize * 0.85,
            logoBackgroundColor: backgroundColor,
            logoMargin: logoSize * 0.075,
            logoBorderRadius: logoSize * 0.18,
          } : {})}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  qrInner: {
    padding: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
});
