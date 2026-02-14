/**
 * Simple module-level flag to track whether a biometric prompt is active.
 * Used by _layout.tsx to avoid showing the privacy blur overlay
 * when iOS fires inactive state during Face ID / Touch ID prompts.
 */
let _biometricActive = false;

export const BiometricState = {
  setActive: (active: boolean) => { _biometricActive = active; },
  isActive: () => _biometricActive,
};
