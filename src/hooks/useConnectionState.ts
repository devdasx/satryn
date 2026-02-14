/**
 * useConnectionState — Reactive bridge for ElectrumClient FSM
 *
 * Merges the imperative ElectrumClient connection state (6-state FSM)
 * with Zustand's syncStore and serverStore to provide a single,
 * reactive hook for all connection-related UI screens.
 *
 * The ElectrumClient FSM is NOT a Zustand store, so we poll it at a
 * configurable interval (default 2s) and merge with syncStore data.
 *
 * The DB-backed activeServer from serverStore is the source of truth
 * for which server the user selected. The FSM may lag behind during
 * reconnection, so we prefer activeServer for display when available.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSyncStore, type SyncState } from '../stores/syncStore';
import { useServerStore } from '../stores/serverStore';
import { ElectrumAPI } from '../services/electrum/ElectrumAPI';
import { ServerCacheManager } from '../services/electrum/ServerCacheManager';
import type { ConnectionState } from '../services/electrum/types';
import type { ElectrumServerInfo } from '../services/electrum/types';

export interface ConnectionInfo {
  /** Raw ElectrumClient FSM state */
  clientState: ConnectionState;
  /** Whether the client FSM is in 'ready' state */
  isConnected: boolean;

  /** From syncStore (reactive via Zustand) */
  syncState: SyncState;
  lastSyncTime: number | null;
  serverHost: string | null;
  blockHeight: number | null;
  syncError: string | null;

  /** From ElectrumAPI / ElectrumClient (polled) or DB-backed activeServer */
  currentServer: ElectrumServerInfo | null;
  /** Server implementation string, e.g. "Fulcrum 1.9.1" */
  serverImpl: string | null;
  /** Average latency in ms from ServerCacheManager */
  latencyMs: number | null;

  /** Truncated host for display (max 28 chars) */
  displayHost: string;
}

const DEFAULT_POLL_INTERVAL = 2000;

/**
 * Hook that provides unified connection state from ElectrumClient FSM + syncStore + serverStore.
 *
 * @param pollInterval - How often to poll ElectrumClient FSM (ms). Default 2000.
 *                       Use a lower value (e.g. 300) for progress sheets.
 */
export function useConnectionState(pollInterval: number = DEFAULT_POLL_INTERVAL): ConnectionInfo {
  // Reactive Zustand state — use individual selectors to avoid re-renders from unrelated syncStore changes
  const syncState = useSyncStore(s => s.syncState);
  const lastSyncTime = useSyncStore(s => s.lastSyncTime);
  const serverHost = useSyncStore(s => s.serverHost);
  const blockHeight = useSyncStore(s => s.blockHeight);
  const syncError = useSyncStore(s => s.syncError);

  // DB-backed active server (reactive via Zustand)
  const activeServer = useServerStore(s => s.activeServer);

  // Polled state from ElectrumClient FSM
  const [clientState, setClientState] = useState<ConnectionState>('disconnected');
  const [fsmServer, setFsmServer] = useState<ElectrumServerInfo | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => {
      try {
        const api = ElectrumAPI.shared('mainnet');
        const client = api.getClient();
        const state = client.getState();
        const server = client.getCurrentServer();

        // Only trigger re-render when values actually change
        setClientState(prev => prev === state ? prev : state);
        setFsmServer(prev => {
          if (prev?.host === server?.host && prev?.port === server?.port) return prev;
          return server;
        });
      } catch {
        // API not initialized yet — stay disconnected
        setClientState(prev => prev === 'disconnected' ? prev : 'disconnected');
        setFsmServer(prev => prev === null ? prev : null);
      }
    };

    // Poll immediately
    poll();

    // Set up interval
    intervalRef.current = setInterval(poll, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollInterval]);

  // Effective server: prefer DB-backed activeServer, fall back to FSM
  const currentServer: ElectrumServerInfo | null = useMemo(() => {
    if (activeServer) {
      return { host: activeServer.host, port: activeServer.port, ssl: activeServer.ssl };
    }
    return fsmServer;
  }, [activeServer, fsmServer]);

  // Derived values from ServerCacheManager
  const { serverImpl, latencyMs } = useMemo(() => {
    if (!currentServer) {
      return { serverImpl: null, latencyMs: null };
    }
    try {
      const cache = ServerCacheManager.shared();
      const record = cache.getRecord(currentServer.host, currentServer.port);
      if (record) {
        return {
          serverImpl: record.serverImpl || null,
          latencyMs: record.avgLatencyMs > 0 ? Math.round(record.avgLatencyMs) : null,
        };
      }
    } catch {
      // Cache not initialized
    }
    return { serverImpl: null, latencyMs: null };
  }, [currentServer?.host, currentServer?.port]);

  // Truncated host for display
  const displayHost = useMemo(() => {
    const host = currentServer?.host || serverHost || '';
    if (!host) return 'No server';
    if (host.length <= 28) return host;
    return host.substring(0, 25) + '...';
  }, [currentServer?.host, serverHost]);

  const isConnected = clientState === 'ready';

  return {
    clientState,
    isConnected,
    syncState,
    lastSyncTime,
    serverHost,
    blockHeight,
    syncError,
    currentServer,
    serverImpl,
    latencyMs,
    displayHost,
  };
}
