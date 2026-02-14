/**
 * useContactStats
 * Hook that computes and returns contact stats for the active wallet.
 * Triggers recomputation when contacts or transactions change.
 *
 * Heavy computation is deferred via InteractionManager so it never
 * blocks animations or touch handling on screen mount.
 */

import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useContactStore } from '../stores/contactStore';
import { useContactStatsStore } from '../stores/contactStatsStore';
import { useWalletStore } from '../stores/walletStore';
import type { ContactStats } from '../types/contacts';

/**
 * Compute stats for all contacts based on current wallet transactions.
 * Call this once per screen mount (e.g., contact details or contacts list).
 */
export function useContactStats(): {
  getStats: (contactId: string) => ContactStats | null;
  isComputing: boolean;
} {
  const contacts = useContactStore((s) => s.contacts);
  const transactions = useWalletStore((s) => s.transactions);
  const computeAllStats = useContactStatsStore((s) => s.computeAllStats);
  const getStatsForContact = useContactStatsStore((s) => s.getStatsForContact);
  const isComputing = useContactStatsStore((s) => s.isComputing);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (contacts.length === 0 || transactions.length === 0) return;

    // Debounce: wait 300ms after last change before computing.
    // This prevents rapid re-computation when contacts and transactions
    // both update in quick succession during initial load.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      // Defer heavy work until after animations/interactions settle
      InteractionManager.runAfterInteractions(() => {
        computeAllStats(contacts, transactions);
      });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [contacts, transactions, computeAllStats]);

  return {
    getStats: getStatsForContact,
    isComputing,
  };
}
