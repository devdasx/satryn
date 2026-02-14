/**
 * useCopyFeedback — Inline copy-to-clipboard feedback hook
 *
 * Replaces toast notifications with a simple state toggle.
 * After copying, returns `true` for 1.5 seconds, then resets.
 *
 * Usage:
 *   const { copied, copy } = useCopyFeedback();
 *   <Pressable onPress={() => copy(address)}>
 *     <Text>{copied ? 'Copied!' : 'Copy Address'}</Text>
 *   </Pressable>
 *
 * For multiple copy targets:
 *   const { copiedKey, copyWithKey } = useCopyFeedback();
 *   <Pressable onPress={() => copyWithKey('txid', txid)}>
 *     <Text>{copiedKey === 'txid' ? 'Copied!' : 'Copy TxID'}</Text>
 *   </Pressable>
 *
 * For sensitive data (auto-clears clipboard after 30s):
 *   const { copied, copy } = useCopyFeedback({ autoClearMs: 30_000 });
 */

import { useState, useCallback, useRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

const FEEDBACK_DURATION = 1500; // ms

interface CopyFeedbackOptions {
  /** Auto-clear clipboard after this many ms. Set to enable for sensitive data (e.g. 30000). */
  autoClearMs?: number;
}

export function useCopyFeedback(options?: CopyFeedbackOptions) {
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutoClear = useCallback(() => {
    if (!options?.autoClearMs) return;
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(async () => {
      try { await Clipboard.setStringAsync(''); } catch {}
    }, options.autoClearMs);
  }, [options?.autoClearMs]);

  const copy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setCopiedKey(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), FEEDBACK_DURATION);
    scheduleAutoClear();
  }, [scheduleAutoClear]);

  const copyWithKey = useCallback(async (key: string, text: string) => {
    await Clipboard.setStringAsync(text);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedKey(key);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      setCopiedKey(null);
    }, FEEDBACK_DURATION);
    scheduleAutoClear();
  }, [scheduleAutoClear]);

  return { copied, copiedKey, copy, copyWithKey };
}
