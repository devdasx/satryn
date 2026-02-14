/**
 * NearbyProvider — Context provider for Nearby Payments (receive-only)
 *
 * Wraps the nearby screen and provides:
 * - Wireless discovery via expo-nearby-connections (primary)
 * - QR-based payload exchange (fallback)
 * - Session store access
 * - Convenience methods for starting/stopping sessions
 */

import React, { createContext, useContext, useCallback, useEffect, useRef } from 'react';
import { useWalletStore } from '../../stores';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNearbySessionStore } from '../../stores/nearbySessionStore';
import {
  createSignedPayload,
  deriveConfirmationCode,
} from '../../services/nearby/NearbyPayloadCodec';
import { NearbyLogger } from '../../services/nearby/NearbyLogger';
import { ExpoNearbyTransport } from '../../services/nearby/ExpoNearbyTransport';
import type { NearbyTransport } from '../../services/nearby/NearbyTransport';

interface NearbyContextValue {
  /** Start a receiver session (advertise wirelessly + show QR fallback) */
  startReceive: (params: {
    address: string;
    amountSats?: number;
    memo?: string;
    displayDenomination?: string;
    displayAmount?: number;
    displayCurrency?: string;
  }) => void;
  /** Receiver: accept a discovered sender by tapping them in the list */
  selectAndAccept: (peerId: string) => void;
  /** Cancel the current session */
  cancel: () => void;
  /** Retry from error/timeout state */
  retry: () => void;
}

const NearbyContext = createContext<NearbyContextValue | null>(null);

export function useNearby(): NearbyContextValue {
  const ctx = useContext(NearbyContext);
  if (!ctx) throw new Error('useNearby must be used within NearbyProvider');
  return ctx;
}

interface NearbyProviderProps {
  mode: 'send' | 'receive';
  children: React.ReactNode;
}

export function NearbyProvider({ children }: NearbyProviderProps) {
  const network = useWalletStore((s) => s.network);
  const nearbyNickname = useSettingsStore((s) => s.nearbyNickname);
  const store = useNearbySessionStore;
  const transportRef = useRef<NearbyTransport | null>(null);

  // Stop transport helper
  const stopTransport = useCallback(async () => {
    if (transportRef.current) {
      try {
        await transportRef.current.stop();
      } catch {
        // Ignore cleanup errors
      }
      transportRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTransport();
      store.getState().reset();
    };
  }, []);

  // ─── Receiver: Advertise wirelessly ─────────────────────────

  const startReceive = useCallback((params: {
    address: string;
    amountSats?: number;
    memo?: string;
    displayDenomination?: string;
    displayAmount?: number;
    displayCurrency?: string;
  }) => {
    const { startSession, transition, setPayload } = store.getState();
    startSession('receive');

    // Create signed payload
    const { payload } = createSignedPayload({
      address: params.address,
      network,
      amountSats: params.amountSats,
      memo: params.memo,
      displayDenomination: params.displayDenomination,
      displayAmount: params.displayAmount,
      displayCurrency: params.displayCurrency,
    });

    setPayload(payload);

    // Transition to advertising — UI shows pulse + QR fallback
    transition('advertising');

    // Start the wireless transport (async, don't block)
    (async () => {
      try {
        await stopTransport();

        const transport = new ExpoNearbyTransport();
        transportRef.current = transport;

        const available = await transport.isAvailable();
        if (!available) {
          NearbyLogger.nearby('transport-unavailable');
          return;
        }

        await transport.startReceiver(payload, {
          onPeerConnected: (peerName) => {
            NearbyLogger.nearby('receiver-peer-connected', { peerName });
            store.getState().setPeerName(peerName ?? null);
            const { state } = store.getState();
            if (state === 'advertising') {
              store.getState().transition('exchanging');
            }
          },
          onPeerDisconnected: () => {
            NearbyLogger.nearby('receiver-peer-disconnected');
          },
          onPayloadReceived: () => {
            // Receiver doesn't receive payload — it sends it
          },
          onPayloadRead: () => {
            NearbyLogger.nearby('receiver-payload-read-by-sender');
            const { state } = store.getState();
            if (state === 'exchanging') {
              store.getState().transition('pending_acceptance');
            }
          },
          onTextReceived: (text) => {
            NearbyLogger.nearby('receiver-acceptance-received', { length: text.length });
            try {
              const msg = JSON.parse(text);
              if (msg.type === 'acceptance' && msg.accepted === true) {
                const { payload: currentPayload } = store.getState();
                if (currentPayload && msg.confirmationCode) {
                  const expected = deriveConfirmationCode(currentPayload.requestId);
                  if (msg.confirmationCode !== expected) {
                    NearbyLogger.nearby('confirmation-code-mismatch');
                    store.getState().setError('EXCHANGE_FAILED', 'Confirmation code mismatch');
                    return;
                  }
                }
                store.getState().setSenderAccepted(true);
                if (msg.senderNickname) {
                  store.getState().setPeerName(msg.senderNickname);
                }
                store.getState().transition('completed');
              } else if (msg.type === 'acceptance' && msg.accepted === false) {
                store.getState().setError('EXCHANGE_FAILED', 'The sender declined the payment request');
              }
            } catch {
              NearbyLogger.debug('Failed to parse acceptance message');
            }
          },
          onError: (error) => {
            NearbyLogger.error(error.code, error.message);
          },
          onTimeout: () => {
            NearbyLogger.nearby('receiver-timeout');
          },
          onPeerDiscovered: (peer) => {
            NearbyLogger.nearby('receiver-peer-discovered', { peerId: peer.peerId, name: peer.displayName });
            store.getState().addDiscoveredPeer({
              peerId: peer.peerId,
              displayName: peer.displayName,
              discoveredAt: Date.now(),
            });
          },
          onPeerLost: (peerId) => {
            NearbyLogger.nearby('receiver-peer-lost', { peerId });
            store.getState().removeDiscoveredPeer(peerId);
          },
        }, nearbyNickname || undefined);

        NearbyLogger.nearby('receiver-transport-started');
      } catch (err) {
        NearbyLogger.error('CONNECTION_FAILED', 'Failed to start receiver transport', err);
      }
    })();
  }, [network, nearbyNickname, stopTransport]);

  // ─── Manual Peer Selection ──────────────────────────────────

  const selectAndAccept = useCallback((peerId: string) => {
    store.getState().selectPeer(peerId);
    if (!transportRef.current) return;

    NearbyLogger.nearby('receiver-select-and-accept', { peerId });
    transportRef.current.acceptPeer(peerId).catch((err) => {
      NearbyLogger.error('CONNECTION_FAILED', 'Failed to accept selected peer', err);
      store.getState().setError('CONNECTION_FAILED', 'Failed to accept connection from selected device');
    });
  }, []);

  // ─── Cancel / Retry ─────────────────────────────────────────

  const cancel = useCallback(() => {
    stopTransport();
    const { state } = store.getState();
    if (state !== 'idle' && state !== 'completed') {
      store.getState().transition('cancelled');
    }
    store.getState().reset();
  }, [stopTransport]);

  const retry = useCallback(() => {
    stopTransport();
    store.getState().reset();
  }, [stopTransport]);

  return (
    <NearbyContext.Provider value={{ startReceive, selectAndAccept, cancel, retry }}>
      {children}
    </NearbyContext.Provider>
  );
}
