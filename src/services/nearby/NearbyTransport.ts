/**
 * NearbyTransport — Abstract transport interface
 *
 * Defines the contract for nearby payment transports (BLE, QR).
 * Each transport implements start/stop for receiver (peripheral)
 * and sender (central) modes, plus payload exchange.
 */

import type { NearbyPayload, NearbyError } from './types';

export interface NearbyTransportCallbacks {
  /** Called when a peer device has connected (peerName is the remote device's advertised name) */
  onPeerConnected: (peerName?: string) => void;
  /** Called when a peer device has disconnected */
  onPeerDisconnected: () => void;
  /** Called when payload data has been received from the peer */
  onPayloadReceived: (payload: NearbyPayload) => void;
  /** Called when the payload has been read by the peer (receiver mode) */
  onPayloadRead: () => void;
  /** Called on transport error */
  onError: (error: NearbyError) => void;
  /** Called when scan/connection times out */
  onTimeout: () => void;
  /** Called when a text message is received from the peer (e.g. acceptance) */
  onTextReceived?: (text: string) => void;
  /** Called when a nearby peer is discovered (but not yet connected) */
  onPeerDiscovered?: (peer: { peerId: string; displayName: string }) => void;
  /** Called when a previously discovered peer is no longer available */
  onPeerLost?: (peerId: string) => void;
}

export interface NearbyTransport {
  /** Unique transport identifier */
  readonly id: string;

  /** Whether this transport is available on the current platform */
  isAvailable(): Promise<boolean>;

  /**
   * Start as receiver (peripheral / advertiser).
   * Advertises the given payload for a sender to read.
   * @param nickname — Optional user nickname included in the advertised name
   */
  startReceiver(payload: NearbyPayload, callbacks: NearbyTransportCallbacks, nickname?: string): Promise<void>;

  /**
   * Start as sender (central / scanner).
   * Scans for a receiver, connects, and reads the payload.
   * @param nickname — Optional user nickname used as the sender's display name
   */
  startSender(callbacks: NearbyTransportCallbacks, nickname?: string): Promise<void>;

  /**
   * Send a text message to the connected peer.
   * Used for acceptance/decline messages.
   */
  sendMessage(text: string): Promise<void>;

  /**
   * Sender: initiate connection to a specific discovered peer.
   * Called when the user taps a peer in the list.
   */
  connectToPeer(peerId: string): Promise<void>;

  /**
   * Receiver: accept a connection from a specific peer.
   * Called when the receiver taps a sender in their list.
   */
  acceptPeer(peerId: string): Promise<void>;

  /**
   * Stop the transport and clean up all resources.
   * Safe to call multiple times.
   */
  stop(): Promise<void>;
}
