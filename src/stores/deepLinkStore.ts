/**
 * Deep Link Store (Ephemeral)
 * Holds pending inbound payment request data until the user acts on it
 */

import { create } from 'zustand';
import type { PaymentLinkPayload } from '../types/contacts';

interface DeepLinkState {
  pendingPayload: PaymentLinkPayload | null;
  setPendingPayload: (payload: PaymentLinkPayload | null) => void;
  clearPending: () => void;
}

export const useDeepLinkStore = create<DeepLinkState>()((set) => ({
  pendingPayload: null,

  setPendingPayload: (payload) => {
    set({ pendingPayload: payload });
  },

  clearPending: () => {
    set({ pendingPayload: null });
  },
}));
