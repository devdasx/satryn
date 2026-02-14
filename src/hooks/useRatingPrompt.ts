import { useEffect, useRef, useCallback } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useSettingsStore } from '../stores';

// Rating prompt appears ONCE. After any dismissal the user is never prompted again
// unless they reinstall the app (persisted via settingsStore).
const FIRST_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of usage before first prompt

const APP_STORE_REVIEW_URL = 'https://apps.apple.com/app/id6758677225?action=write-review';
const CONTACT_EMAIL = 'support@satryn.com';

// Module-level flag to prevent duplicate prompts across remounts within the same
// JS session. Survives component remounts but resets on full app restart.
let _hasPromptedThisSession = false;

/**
 * Hook that tracks app usage time and shows a rating prompt ONCE after 5 minutes.
 * After any interaction (Rate Now, Not Now, Contact Us, No Thanks) the prompt
 * never appears again — the decision is persisted.
 */
export function useRatingPrompt() {
  const sessionStartRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    ratingDismissedForever,
    ratingCompleted,
    totalUsageMs,
    addUsageTime,
    setRatingDismissedForever,
    setRatingCompleted,
    ratingDismissCount,
    setRatingDismissCount,
    setLastRatingDismissDate,
  } = useSettingsStore();

  // Skip if user already interacted with the prompt (persisted) or already
  // shown this session (module-level ref survives remounts)
  const shouldSkip = ratingDismissedForever || ratingCompleted || ratingDismissCount > 0;

  const showFeedbackPrompt = useCallback(() => {
    Alert.alert(
      'We\'d love your feedback',
      'Is there anything we can improve? Let us know and we\'ll work on it.',
      [
        {
          text: 'Contact Us',
          onPress: () => {
            setRatingDismissedForever(true);
            Linking.openURL(
              `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Satryn Feedback')}`
            ).catch(() => {});
          },
        },
        {
          text: 'No Thanks',
          style: 'cancel',
          onPress: () => setRatingDismissedForever(true),
        },
      ]
    );
  }, [setRatingDismissedForever]);

  const showRatingPrompt = useCallback(() => {
    // Double-check: module-level guard + persisted state
    if (_hasPromptedThisSession) return;
    const store = useSettingsStore.getState();
    if (store.ratingDismissedForever || store.ratingCompleted || (store.ratingDismissCount || 0) > 0) return;

    _hasPromptedThisSession = true;

    Alert.alert(
      'Enjoying Satryn?',
      'If you\'re finding the app useful, a quick rating on the App Store would help us a lot.',
      [
        {
          text: 'Rate Now',
          onPress: () => {
            setRatingCompleted(true);
            Linking.openURL(APP_STORE_REVIEW_URL).catch(() => {});
          },
        },
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: () => {
            // Mark as dismissed so it never shows again
            setRatingDismissCount(1);
            setLastRatingDismissDate(Date.now());
            setRatingDismissedForever(true);
          },
        },
      ]
    );
  }, [setRatingCompleted, setRatingDismissCount, setLastRatingDismissDate, setRatingDismissedForever]);

  // Track active usage time
  useEffect(() => {
    if (shouldSkip) return;

    sessionStartRef.current = Date.now();

    // Check every 30 seconds
    intervalRef.current = setInterval(() => {
      if (_hasPromptedThisSession) return;

      const sessionTime = Date.now() - sessionStartRef.current;
      const totalTime = totalUsageMs + sessionTime;

      // Prompt once after 5 minutes of total usage
      if (totalTime >= FIRST_THRESHOLD_MS) {
        showRatingPrompt();
      }
    }, 30_000);

    // Save usage time when app goes to background
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        const sessionTime = Date.now() - sessionStartRef.current;
        addUsageTime(sessionTime);
        sessionStartRef.current = Date.now();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Save accumulated time on unmount
      const sessionTime = Date.now() - sessionStartRef.current;
      addUsageTime(sessionTime);
      subscription.remove();
    };
  }, [shouldSkip]); // eslint-disable-line react-hooks/exhaustive-deps
}
