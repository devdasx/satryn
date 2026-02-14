/**
 * ExpoNearbyTransport — Wireless transport using expo-nearby-connections
 *
 * Uses MultipeerConnectivity (iOS) / Google Nearby Connections (Android)
 * for real wireless device discovery + data exchange.
 *
 * Receiver flow:
 *   startAdvertise() → onInvitationReceived → acceptConnection →
 *   onConnected → sendText(serializedPayload) → done
 *
 * Sender flow:
 *   startDiscovery() → onPeerFound → requestConnection →
 *   onConnected → onTextReceived(payload) → done
 */

import {
  startAdvertise,
  stopAdvertise,
  startDiscovery,
  stopDiscovery,
  requestConnection,
  acceptConnection,
  disconnect,
  sendText,
  onPeerFound,
  onPeerLost,
  onInvitationReceived,
  onConnected,
  onDisconnected,
  onTextReceived,
  Strategy,
} from 'expo-nearby-connections';

import type { NearbyTransport, NearbyTransportCallbacks } from './NearbyTransport';
import type { NearbyPayload } from './types';
import { serializePayload, deserializePayload } from './NearbyPayloadCodec';
import { NearbyLogger } from './NearbyLogger';
import { NEARBY_SCAN_TIMEOUT_MS } from './types';

/** Service name prefix — both sides use this for discovery filtering */
const SERVICE_PREFIX = 'SATRYN';

export class ExpoNearbyTransport implements NearbyTransport {
  readonly id = 'expo-nearby';

  private unsubscribers: Array<() => void> = [];
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private connectedPeerId: string | null = null;
  private connectionRequested = false;
  /** Peers that came through onInvitationReceived — used to filter phantom connections */
  private invitedPeerIds: Set<string> = new Set();
  /** Pending invitations from senders (receiver side) — peerId → display name */
  private pendingInvitations: Map<string, string> = new Map();
  /** Stored callbacks for connectToPeer/acceptPeer to use */
  private activeCallbacks: NearbyTransportCallbacks | null = null;

  // ─── Availability ─────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      // Just check if the module is importable and callable.
      // On iOS, MultipeerConnectivity is always available.
      // On Android, check Google Play Services.
      const { Platform } = require('react-native');
      if (Platform.OS === 'android') {
        const { isPlayServicesAvailable } = require('expo-nearby-connections');
        return await isPlayServicesAvailable();
      }
      // iOS — MultipeerConnectivity is always available
      return true;
    } catch {
      return false;
    }
  }

  // ─── Receiver (Advertise) ─────────────────────────────────────

  async startReceiver(
    payload: NearbyPayload,
    callbacks: NearbyTransportCallbacks,
    nickname?: string,
  ): Promise<void> {
    this.stopped = false;
    this.invitedPeerIds = new Set();
    this.pendingInvitations = new Map();
    this.activeCallbacks = callbacks;
    // Include nickname in the advertised name so the sender can identify the receiver
    const serviceName = nickname
      ? `${SERVICE_PREFIX}_${nickname}`
      : `${SERVICE_PREFIX}_${payload.requestId.slice(0, 8)}`;
    const serialized = serializePayload(payload);

    NearbyLogger.nearby('receiver-start', { serviceName, nickname });

    try {
      // Start advertising this device
      await startAdvertise(serviceName);
      NearbyLogger.nearby('advertise-started', { serviceName });
    } catch (err) {
      NearbyLogger.error('CONNECTION_FAILED', 'Failed to start advertising', err);
      callbacks.onError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to start nearby advertising',
      });
      return;
    }

    // Set up timeout
    this.timeoutId = setTimeout(() => {
      if (!this.stopped) {
        NearbyLogger.nearby('receiver-timeout');
        callbacks.onTimeout();
      }
    }, NEARBY_SCAN_TIMEOUT_MS);

    // Listen for incoming connection requests → track as pending, notify UI for manual selection
    const unsubInvitation = onInvitationReceived((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('invitation-received', { peerId: data.peerId, name: data.name });
      // Store as pending invitation (receiver must tap to accept)
      this.pendingInvitations.set(data.peerId, data.name);
      // Notify UI so the peer appears in the selection list
      callbacks.onPeerDiscovered?.({ peerId: data.peerId, displayName: data.name });
    });

    // Listen for successful connection
    const unsubConnected = onConnected((data) => {
      if (this.stopped) return;

      // CRITICAL: Only process connections from peers we actually invited.
      // MCSession can fire phantom onConnected during initialization
      // (self-connection or lingering peers from previous sessions).
      if (!this.invitedPeerIds.has(data.peerId)) {
        NearbyLogger.nearby('connected-ignored-not-invited', {
          peerId: data.peerId,
          name: data.name,
        });
        return;
      }

      this.connectedPeerId = data.peerId;
      this.clearTimeout();
      NearbyLogger.nearby('connected-as-receiver', { peerId: data.peerId, name: data.name });
      callbacks.onPeerConnected(data.name);

      // Send the payload to the connected sender
      sendText(data.peerId, serialized)
        .then(() => {
          if (!this.stopped) {
            NearbyLogger.nearby('payload-sent');
            callbacks.onPayloadRead();
          }
        })
        .catch((err) => {
          NearbyLogger.error('EXCHANGE_FAILED', 'Failed to send payload', err);
          if (!this.stopped) {
            callbacks.onError({
              code: 'EXCHANGE_FAILED',
              message: 'Failed to send payment data',
            });
          }
        });
    });

    // Listen for disconnection
    const unsubDisconnected = onDisconnected((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('disconnected', { peerId: data.peerId });
      this.connectedPeerId = null;
      callbacks.onPeerDisconnected();
    });

    // Listen for incoming text from sender (e.g. acceptance/decline messages)
    const unsubTextReceived = onTextReceived((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('receiver-text-received', { peerId: data.peerId, length: data.text.length });
      callbacks.onTextReceived?.(data.text);
    });

    this.unsubscribers.push(unsubInvitation, unsubConnected, unsubDisconnected, unsubTextReceived);
  }

  // ─── Sender (Discover) ────────────────────────────────────────

  async startSender(callbacks: NearbyTransportCallbacks, nickname?: string): Promise<void> {
    this.stopped = false;
    this.activeCallbacks = callbacks;
    // Use nickname as the sender's display name so the receiver can see who's connecting
    const senderName = nickname || SERVICE_PREFIX;
    const serviceName = SERVICE_PREFIX;

    NearbyLogger.nearby('sender-start', { serviceName, senderName, nickname });

    try {
      await startDiscovery(senderName);
      NearbyLogger.nearby('discovery-started', { serviceName, senderName });
    } catch (err) {
      NearbyLogger.error('CONNECTION_FAILED', 'Failed to start discovery', err);
      callbacks.onError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to start nearby discovery',
      });
      return;
    }

    // Set up timeout
    this.timeoutId = setTimeout(() => {
      if (!this.stopped) {
        NearbyLogger.nearby('sender-timeout');
        callbacks.onTimeout();
      }
    }, NEARBY_SCAN_TIMEOUT_MS);

    // Listen for discovered peers → notify UI for manual selection (no auto-connect)
    this.connectionRequested = false;

    const unsubPeerFound = onPeerFound((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('peer-found', { peerId: data.peerId, name: data.name });

      // Only show SATRYN peers (payment receivers)
      if (!data.name.startsWith(SERVICE_PREFIX)) {
        NearbyLogger.nearby('peer-ignored-wrong-prefix', { name: data.name });
        return;
      }

      // Extract display name from the advertised name (strip SATRYN_ prefix)
      const displayName = data.name.startsWith(`${SERVICE_PREFIX}_`)
        ? data.name.slice(SERVICE_PREFIX.length + 1)
        : data.name;

      // Notify UI so the peer appears in the selection list
      callbacks.onPeerDiscovered?.({ peerId: data.peerId, displayName });
    });

    // Listen for peer lost → notify UI to remove from list
    const unsubPeerLost = onPeerLost((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('peer-lost', { peerId: data.peerId });
      callbacks.onPeerLost?.(data.peerId);
    });

    // Sender must also accept incoming invitations (MultipeerConnectivity requirement)
    const unsubInvitation = onInvitationReceived((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('sender-invitation-received', { peerId: data.peerId, name: data.name });
      acceptConnection(data.peerId).catch((err) => {
        NearbyLogger.error('CONNECTION_FAILED', 'Failed to accept connection as sender', err);
      });
    });

    // Listen for successful connection
    const unsubConnected = onConnected((data) => {
      if (this.stopped) return;
      this.connectedPeerId = data.peerId;
      this.clearTimeout();
      NearbyLogger.nearby('connected-as-sender', { peerId: data.peerId, name: data.name });
      // Extract peer nickname from the advertised name (strip SATRYN_ prefix)
      const peerDisplayName = data.name.startsWith(`${SERVICE_PREFIX}_`)
        ? data.name.slice(SERVICE_PREFIX.length + 1)
        : data.name;
      callbacks.onPeerConnected(peerDisplayName);
    });

    // Listen for incoming text (the payload from the receiver)
    const unsubTextReceived = onTextReceived((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('text-received', { peerId: data.peerId, length: data.text.length });

      const payload = deserializePayload(data.text);
      if (!payload) {
        NearbyLogger.error('PAYLOAD_INVALID', 'Failed to deserialize received payload');
        callbacks.onError({
          code: 'PAYLOAD_INVALID',
          message: 'Received invalid payment data',
        });
        return;
      }

      callbacks.onPayloadReceived(payload);
    });

    // Listen for disconnection
    const unsubDisconnected = onDisconnected((data) => {
      if (this.stopped) return;
      NearbyLogger.nearby('disconnected', { peerId: data.peerId });
      this.connectedPeerId = null;
      callbacks.onPeerDisconnected();
    });

    this.unsubscribers.push(
      unsubPeerFound,
      unsubPeerLost,
      unsubInvitation,
      unsubConnected,
      unsubTextReceived,
      unsubDisconnected,
    );
  }

  // ─── Send Message ────────────────────────────────────────────

  async sendMessage(text: string): Promise<void> {
    if (!this.connectedPeerId) {
      throw new Error('No connected peer to send message to');
    }
    NearbyLogger.nearby('send-message', { peerId: this.connectedPeerId, length: text.length });
    await sendText(this.connectedPeerId, text);
  }

  // ─── Manual Peer Selection ──────────────────────────────────────

  /**
   * Sender: initiate connection to a specific discovered peer.
   * Called when the user taps a receiver in their peer list.
   */
  async connectToPeer(peerId: string): Promise<void> {
    if (this.connectionRequested) {
      NearbyLogger.nearby('connect-blocked-already-connecting', { peerId });
      return;
    }
    this.connectionRequested = true;
    NearbyLogger.nearby('manual-connect-to-peer', { peerId });

    try {
      await requestConnection(peerId);
    } catch (err) {
      this.connectionRequested = false; // Allow retry
      NearbyLogger.error('CONNECTION_FAILED', 'Failed to connect to selected peer', err);
      if (!this.stopped && this.activeCallbacks) {
        this.activeCallbacks.onError({
          code: 'CONNECTION_FAILED',
          message: 'Failed to connect to selected device',
        });
      }
    }
  }

  /**
   * Receiver: accept a connection from a specific pending sender.
   * Called when the receiver taps a sender in their peer list.
   */
  async acceptPeer(peerId: string): Promise<void> {
    const name = this.pendingInvitations.get(peerId);
    if (!name) {
      NearbyLogger.nearby('accept-no-pending-invitation', { peerId });
      return;
    }

    NearbyLogger.nearby('manual-accept-peer', { peerId, name });
    // Track as invited so onConnected validation passes
    this.invitedPeerIds.add(peerId);

    try {
      await acceptConnection(peerId);
    } catch (err) {
      this.invitedPeerIds.delete(peerId);
      NearbyLogger.error('CONNECTION_FAILED', 'Failed to accept selected peer', err);
      if (!this.stopped && this.activeCallbacks) {
        this.activeCallbacks.onError({
          code: 'CONNECTION_FAILED',
          message: 'Failed to accept connection from selected device',
        });
      }
    }
  }

  // ─── Stop / Cleanup ───────────────────────────────────────────

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.connectionRequested = false;
    this.invitedPeerIds.clear();
    this.pendingInvitations.clear();
    this.activeCallbacks = null;

    NearbyLogger.nearby('transport-stop');

    // Clear timeout
    this.clearTimeout();

    // Unsubscribe all event listeners
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore — listener may already be removed
      }
    }
    this.unsubscribers = [];

    // Disconnect if connected
    if (this.connectedPeerId) {
      try {
        await disconnect(this.connectedPeerId);
      } catch {
        // Ignore cleanup errors
      }
      this.connectedPeerId = null;
    }

    // Stop both advertise and discovery (safe even if not started)
    try {
      await stopAdvertise();
    } catch {
      // Ignore
    }
    try {
      await stopDiscovery();
    } catch {
      // Ignore
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
