/**
 * ToastProvider — DEPRECATED (no-op stub)
 *
 * All toast notifications have been replaced with inline feedback
 * (useCopyFeedback, useActionFeedback) and native Alert.alert.
 * This file is kept as a no-op stub for safety.
 * See Fix #29 in changelog/022-send-v4-redesign.md.
 */

import React, { ReactNode } from 'react';

type AlertLevel = 'success' | 'error' | 'info';

const noop = () => {};

interface ToastContextValue {
  showToast: (...args: any[]) => void;
  showSuccess: (...args: any[]) => void;
  showError: (...args: any[]) => void;
  showInfo: (...args: any[]) => void;
  showMinimal: (...args: any[]) => void;
  showAlertBar: (title: string, level?: AlertLevel) => void;
  showBitcoinReceived: (amount: number, message?: string) => void;
  showBitcoinSent: (amount: number, message?: string) => void;
  hideToast: (id: string) => void;
  hideAllToasts: () => void;
}

/** @deprecated Use useCopyFeedback or useActionFeedback instead */
export function useToast(): ToastContextValue {
  return {
    showToast: noop,
    showSuccess: noop,
    showError: noop,
    showInfo: noop,
    showMinimal: noop,
    showAlertBar: noop,
    showBitcoinReceived: noop,
    showBitcoinSent: noop,
    hideToast: noop,
    hideAllToasts: noop,
  };
}

/** @deprecated No longer needed — renders children directly */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
