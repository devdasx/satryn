/**
 * Nearby Session Store — State Machine
 *
 * Zustand store managing the nearby payment session lifecycle.
 * Enforces valid state transitions and stores session data.
 * Accessible from both React components and BLE callbacks.
 */

import { create } from 'zustand';
import type {
  NearbySessionState,
  NearbyMode,
  NearbyError,
  NearbyErrorCode,
  NearbyPayload,
  DiscoveredPeer,
} from '../services/nearby/types';
import { VALID_TRANSITIONS, ERROR_MESSAGES } from '../services/nearby/types';
import { NearbyLogger } from '../services/nearby/NearbyLogger';

interface NearbySessionStore {
  // --- State machine ---
  state: NearbySessionState;
  mode: NearbyMode | null;
  error: NearbyError | null;

  // --- Session data ---
  /** The payload being advertised (receiver) or received (sender) */
  payload: NearbyPayload | null;
  /** Connected peer device name (if available from BLE) */
  peerName: string | null;
  /** Memo to auto-label the transaction after broadcast */
  memoForLabeling: string | null;
  /** Amount received (detected by polling the receiver's address) */
  receivedAmountSats: number | null;
  /** Txid of the received payment */
  receivedTxid: string | null;
  /** Whether the sender accepted or declined the payment request */
  senderAccepted: boolean | null;
  /** Discovered nearby peers (peerId → DiscoveredPeer) — for manual selection */
  discoveredPeers: Map<string, DiscoveredPeer>;
  /** The peer the user has selected from the list (before connection is established) */
  selectedPeerId: string | null;

  // --- Actions ---
  /** Transition to a new state (validates transition) */
  transition: (to: NearbySessionState) => boolean;
  /** Start a new session */
  startSession: (mode: NearbyMode) => void;
  /** Set error and transition to error state */
  setError: (code: NearbyErrorCode, message?: string) => void;
  /** Set the payload (received or created) */
  setPayload: (payload: NearbyPayload) => void;
  /** Set peer name from BLE discovery */
  setPeerName: (name: string | null) => void;
  /** Set memo for post-broadcast labeling */
  setMemoForLabeling: (memo: string | null) => void;
  /** Set received payment details (from address polling) */
  setReceivedPayment: (amountSats: number, txid: string) => void;
  /** Set sender acceptance status */
  setSenderAccepted: (accepted: boolean) => void;
  /** Add a discovered peer to the list */
  addDiscoveredPeer: (peer: DiscoveredPeer) => void;
  /** Remove a peer from the discovered list (lost) */
  removeDiscoveredPeer: (peerId: string) => void;
  /** Clear all discovered peers */
  clearDiscoveredPeers: () => void;
  /** Set the user-selected peer */
  selectPeer: (peerId: string | null) => void;
  /** Reset to idle state, clear all session data */
  reset: () => void;
}

export const useNearbySessionStore = create<NearbySessionStore>()((set, get) => ({
  // Initial state
  state: 'idle',
  mode: null,
  error: null,
  payload: null,
  peerName: null,
  memoForLabeling: null,
  receivedAmountSats: null,
  receivedTxid: null,
  senderAccepted: null,
  discoveredPeers: new Map(),
  selectedPeerId: null,

  transition: (to) => {
    const { state: from } = get();
    const validTargets = VALID_TRANSITIONS[from];

    if (!validTargets || !validTargets.includes(to)) {
      NearbyLogger.debug(`Invalid transition blocked: ${from} → ${to}`);
      return false;
    }

    NearbyLogger.transition(from, to);
    set({ state: to });

    // Clear error when leaving error state
    if (from === 'error' || from === 'timeout') {
      set({ error: null });
    }

    return true;
  },

  startSession: (mode) => {
    const { state } = get();
    if (state !== 'idle') {
      NearbyLogger.debug(`Cannot start session in state: ${state}`);
      return;
    }

    NearbyLogger.sessionStart(mode);
    set({
      mode,
      error: null,
      payload: null,
      peerName: null,
      memoForLabeling: null,
      receivedAmountSats: null,
      receivedTxid: null,
      senderAccepted: null,
      discoveredPeers: new Map(),
      selectedPeerId: null,
    });

    get().transition('initializing');
  },

  setError: (code, message) => {
    const errorObj: NearbyError = {
      code,
      message: message ?? ERROR_MESSAGES[code] ?? 'Unknown error',
    };

    NearbyLogger.error(code, errorObj.message);
    set({ error: errorObj });

    // Transition to error state (timeout has its own state)
    const targetState: NearbySessionState =
      code === 'SCAN_TIMEOUT' || code === 'CONNECTION_TIMEOUT' ? 'timeout' : 'error';

    get().transition(targetState);
  },

  setPayload: (payload) => {
    NearbyLogger.payload('set', { requestId: payload.requestId, address: payload.address?.slice(0, 10) + '...' });
    set({ payload });
  },

  setPeerName: (name) => {
    set({ peerName: name });
  },

  setMemoForLabeling: (memo) => {
    set({ memoForLabeling: memo });
  },

  setReceivedPayment: (amountSats, txid) => {
    NearbyLogger.debug(`Payment detected: ${amountSats} sats, txid: ${txid.slice(0, 10)}...`);
    set({ receivedAmountSats: amountSats, receivedTxid: txid });
  },

  setSenderAccepted: (accepted) => {
    NearbyLogger.debug(`Sender ${accepted ? 'accepted' : 'declined'} the payment request`);
    set({ senderAccepted: accepted });
  },

  addDiscoveredPeer: (peer) => {
    const { discoveredPeers } = get();
    const updated = new Map(discoveredPeers);
    updated.set(peer.peerId, peer);
    set({ discoveredPeers: updated });
  },

  removeDiscoveredPeer: (peerId) => {
    const { discoveredPeers, selectedPeerId } = get();
    const updated = new Map(discoveredPeers);
    updated.delete(peerId);
    const patch: Partial<NearbySessionStore> = { discoveredPeers: updated };
    // If the removed peer was the selected one, clear selection
    if (selectedPeerId === peerId) {
      patch.selectedPeerId = null;
    }
    set(patch);
  },

  clearDiscoveredPeers: () => {
    set({ discoveredPeers: new Map(), selectedPeerId: null });
  },

  selectPeer: (peerId) => {
    set({ selectedPeerId: peerId });
  },

  reset: () => {
    const { state } = get();
    if (state !== 'idle') {
      NearbyLogger.sessionEnd(
        state === 'completed' ? 'completed' :
        state === 'error' ? 'error' :
        state === 'timeout' ? 'timeout' : 'cancelled'
      );
    }

    set({
      state: 'idle',
      mode: null,
      error: null,
      payload: null,
      peerName: null,
      memoForLabeling: null,
      receivedAmountSats: null,
      receivedTxid: null,
      senderAccepted: null,
      discoveredPeers: new Map(),
      selectedPeerId: null,
    });
  },
}));
