/**
 * Contact Stats Store (Ephemeral)
 * Computes relationship analytics from transaction history
 * Not persisted -- recomputed each session
 */

import { create } from 'zustand';
import type { Contact, ContactStats, MonthlyActivity } from '../types/contacts';
import type { DetailedTransactionInfo } from '../types';

interface ContactStatsState {
  statsMap: Record<string, ContactStats>;
  isComputing: boolean;
  lastComputedAt: number | null;

  computeAllStats: (
    contacts: Contact[],
    transactions: DetailedTransactionInfo[]
  ) => void;

  getStatsForContact: (contactId: string) => ContactStats | null;
  clearStats: () => void;
}

function getMonthKey(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getLast6Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export const useContactStatsStore = create<ContactStatsState>()((set, get) => ({
  statsMap: {},
  isComputing: false,
  lastComputedAt: null,

  computeAllStats: (contacts, transactions) => {
    set({ isComputing: true });

    // Build address -> contactId lookup
    const addressToContact = new Map<string, string>();
    for (const contact of contacts) {
      for (const addr of contact.addresses) {
        addressToContact.set(addr.address, contact.id);
      }
    }

    // Initialize stats
    const last6 = getLast6Months();
    const stats: Record<string, ContactStats> = {};
    for (const contact of contacts) {
      const monthlyActivity: MonthlyActivity[] = last6.map((m) => ({
        month: m,
        sentSats: 0,
        receivedSats: 0,
        txCount: 0,
      }));
      stats[contact.id] = {
        contactId: contact.id,
        outgoingTxCount: 0,
        incomingTxCount: 0,
        totalSentSats: 0,
        totalReceivedSats: 0,
        lastActivityTimestamp: null,
        monthlyActivity,
      };
    }

    // Process transactions
    for (const tx of transactions) {
      const timestamp = tx.blockTime || tx.firstSeen || 0;
      const monthKey = timestamp > 0 ? getMonthKey(timestamp) : null;

      if (tx.type === 'outgoing') {
        // Check if any output belongs to a contact
        const matched = new Set<string>();
        for (const output of tx.outputs) {
          if (output.address && addressToContact.has(output.address)) {
            const contactId = addressToContact.get(output.address)!;
            if (!matched.has(contactId)) {
              matched.add(contactId);
              stats[contactId].outgoingTxCount++;
            }
            stats[contactId].totalSentSats += output.value;

            // Update last activity
            if (timestamp > 0) {
              const current = stats[contactId].lastActivityTimestamp;
              if (!current || timestamp > current) {
                stats[contactId].lastActivityTimestamp = timestamp;
              }
            }

            // Update monthly aggregates
            if (monthKey) {
              const monthEntry = stats[contactId].monthlyActivity.find(
                (m) => m.month === monthKey
              );
              if (monthEntry) {
                monthEntry.sentSats += output.value;
                if (!matched.has(`${contactId}_month`)) {
                  matched.add(`${contactId}_month`);
                  monthEntry.txCount++;
                }
              }
            }
          }
        }
      }

      if (tx.type === 'incoming') {
        // Check if any input address belongs to a contact (best-effort)
        for (const input of tx.inputs) {
          if (input.address && addressToContact.has(input.address)) {
            const contactId = addressToContact.get(input.address)!;
            stats[contactId].incomingTxCount++;
            stats[contactId].totalReceivedSats += Math.abs(tx.balanceDiff);

            // Update last activity
            if (timestamp > 0) {
              const current = stats[contactId].lastActivityTimestamp;
              if (!current || timestamp > current) {
                stats[contactId].lastActivityTimestamp = timestamp;
              }
            }

            // Update monthly aggregates
            if (monthKey) {
              const monthEntry = stats[contactId].monthlyActivity.find(
                (m) => m.month === monthKey
              );
              if (monthEntry) {
                monthEntry.receivedSats += Math.abs(tx.balanceDiff);
                monthEntry.txCount++;
              }
            }
            break; // Count once per tx for incoming
          }
        }
      }
    }

    set({ statsMap: stats, isComputing: false, lastComputedAt: Date.now() });
  },

  getStatsForContact: (contactId) => {
    return get().statsMap[contactId] || null;
  },

  clearStats: () => {
    set({ statsMap: {}, lastComputedAt: null });
  },
}));
