/**
 * useActionFeedback — Inline action feedback hook
 *
 * Provides a temporary status message that auto-clears after a timeout.
 * Used for non-copy actions like "Wallet renamed", "Signed successfully", etc.
 *
 * Usage:
 *   const { message, showFeedback } = useActionFeedback();
 *   showFeedback('Wallet renamed');
 *   // Then in JSX: {message && <Text>{message}</Text>}
 */

import { useState, useCallback, useRef } from 'react';

const DEFAULT_DURATION = 2000; // ms

export function useActionFeedback(duration: number = DEFAULT_DURATION) {
  const [message, setMessage] = useState<string | null>(null);
  const [level, setLevel] = useState<'success' | 'error' | 'info'>('success');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((text: string, feedbackLevel: 'success' | 'error' | 'info' = 'success') => {
    setMessage(text);
    setLevel(feedbackLevel);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), duration);
  }, [duration]);

  const clearFeedback = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(null);
  }, []);

  return { message, level, showFeedback, clearFeedback };
}
