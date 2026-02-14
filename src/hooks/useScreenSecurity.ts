/**
 * useScreenSecurity — Prevents screenshots and screen recording on sensitive screens.
 *
 * Uses expo-screen-capture to activate native screenshot/recording prevention
 * when the component mounts. Automatically deactivates on unmount.
 *
 * NOTE: Uses requireOptionalNativeModule to safely check if the native module
 * is built into the binary. This avoids crashes when the native module hasn't
 * been compiled (e.g. in Expo Go or before a native rebuild).
 *
 * Usage:
 *   useScreenSecurity();  // call at top of any sensitive screen component
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

let _preventCount = 0;

/**
 * Check if the native ExpoScreenCapture module is available.
 * Cached after first check to avoid repeated lookups.
 */
let _screenCaptureModule: any | null | undefined;
function getScreenCaptureModule(): any | null {
  if (_screenCaptureModule === undefined) {
    _screenCaptureModule = requireOptionalNativeModule('ExpoScreenCapture');
  }
  return _screenCaptureModule;
}

/**
 * Activate screenshot prevention while this component is mounted.
 * Uses a reference-counting pattern so nested screens don't conflict.
 */
export function useScreenSecurity(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

    // Check if native module is available before loading JS wrapper
    const nativeModule = getScreenCaptureModule();
    if (!nativeModule) return;

    let ScreenCapture: typeof import('expo-screen-capture') | null = null;
    try {
      ScreenCapture = require('expo-screen-capture');
    } catch {
      // expo-screen-capture JS module not available — skip silently
      return;
    }
    if (!ScreenCapture) return;

    _preventCount++;
    if (_preventCount === 1) {
      ScreenCapture.preventScreenCaptureAsync('sensitive-screen').catch(() => {});
    }

    return () => {
      _preventCount = Math.max(0, _preventCount - 1);
      if (_preventCount === 0 && ScreenCapture) {
        ScreenCapture.allowScreenCaptureAsync('sensitive-screen').catch(() => {});
      }
    };
  }, []);
}
