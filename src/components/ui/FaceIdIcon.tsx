/**
 * FaceIdIcon — Apple-style Face ID icon using SVG
 * Used on the PIN screen biometric button when device supports Face ID
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface FaceIdIconProps {
  size?: number;
  color?: string;
}

export function FaceIdIcon({ size = 28, color = '#FFFFFF' }: FaceIdIconProps) {
  // Scale factor based on 24x24 viewBox
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top-left corner bracket */}
      <Path
        d="M3 8V6a3 3 0 0 1 3-3h2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top-right corner bracket */}
      <Path
        d="M16 3h2a3 3 0 0 1 3 3v2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-left corner bracket */}
      <Path
        d="M3 16v2a3 3 0 0 0 3 3h2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-right corner bracket */}
      <Path
        d="M16 21h2a3 3 0 0 0 3-3v-2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left eye */}
      <Path
        d="M8.5 8.5v2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      {/* Right eye */}
      <Path
        d="M15.5 8.5v2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      {/* Nose */}
      <Path
        d="M12 8.5v4.5h-1"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Mouth / smile */}
      <Path
        d="M9 15.5a3.5 3.5 0 0 0 6 0"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}
