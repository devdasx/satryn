import React from 'react';
import {
  View,
  ViewStyle,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../hooks';
import { getColors } from '../../constants';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'small' | 'medium' | 'large';
  onPress?: () => void;
  style?: ViewStyle | (ViewStyle | undefined)[];
}

export function Card({
  children,
  variant = 'default',
  padding = 'medium',
  onPress,
  style,
}: CardProps) {
  const { isDark, themeMode } = useTheme();
  const c = getColors(themeMode);

  const paddingValue = {
    none: 0,
    small: 12,
    medium: 16,
    large: 24,
  }[padding];

  const variantStyle: ViewStyle = (() => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: c.card.bgElevated,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 4,
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: c.border.default,
        };
      default:
        return {
          backgroundColor: c.card.bg,
        };
    }
  })();

  const cardStyles: (ViewStyle | undefined)[] = [
    { borderRadius: 16, overflow: 'hidden' as const },
    variantStyle,
    { padding: paddingValue },
    ...(Array.isArray(style) ? style : [style]),
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyles}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyles}>{children}</View>;
}
