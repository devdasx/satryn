/**
 * WalletCard - Container component for wallet sections
 *
 * Clean card container matching Settings tab design language.
 * borderRadius 20, no border/blur, solid surface background.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks';

interface WalletCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  noPadding?: boolean;
}

export function WalletCard({ children, style, noPadding }: WalletCardProps) {
  const { isDark, colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.04)'
            : colors.surfacePrimary,
        },
        !noPadding && styles.padding,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  padding: {
    padding: 4,
  },
});

export default WalletCard;
