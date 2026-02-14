/**
 * ElectrumServerListSheet — Premium Server Management Dashboard
 *
 * Features:
 * - Connected server status with health score
 * - Favorites section for quick access
 * - Full server list with health indicators
 * - Add custom servers with host/port/SSL/notes
 * - Favorite toggling, notes editing, server deletion
 * - Mixed detent sizing: auto → large
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../hooks';
import { AppBottomSheet } from './ui/AppBottomSheet';
import { FastSwitch } from './ui';
import { ServerCacheManager } from '../services/electrum/ServerCacheManager';
import { ElectrumAPI } from '../services/electrum/ElectrumAPI';
import { useSettingsStore, useServerStore } from '../stores';
import type { SavedServer } from '../stores';
import type { ServerHealthRecord } from '../services/sync/types';

// ============================================
// TYPES
// ============================================

interface ElectrumServerListSheetProps {
  visible: boolean;
  onClose: () => void;
  network: 'mainnet' | 'testnet';
  onServerSwitch?: (server: { host: string; port: number; ssl: boolean }) => void;
}

interface ServerDisplayInfo {
  server: SavedServer;
  record: ServerHealthRecord | null;
  isConnected: boolean;
}

// ============================================
// HELPERS
// ============================================

function formatLatency(ms: number): string {
  if (ms <= 0) return '\u2014';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getScoreColor(score: number, isDark: boolean): string {
  if (score >= 70) return isDark ? '#30D158' : '#248A3D';
  if (score >= 40) return isDark ? '#FFD60A' : '#B89400';
  if (score > 0) return isDark ? '#FF9500' : '#C97F00';
  return isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)';
}

function getScoreBg(score: number, isDark: boolean): string {
  if (score >= 70) return isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.08)';
  if (score >= 40) return isDark ? 'rgba(255,214,10,0.10)' : 'rgba(255,214,10,0.08)';
  if (score > 0) return isDark ? 'rgba(255,149,0,0.10)' : 'rgba(255,149,0,0.08)';
  return isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
}

// ============================================
// COMPONENT
// ============================================

export function ElectrumServerListSheet({
  visible,
  onClose,
  network,
  onServerSwitch,
}: ElectrumServerListSheetProps) {
  const { isDark } = useTheme();

  // Stores
  const {
    servers: savedServers,
    loadServers,
    addServer,
    removeServer,
    toggleFavorite,
    updateNotes,
    setActiveServer,
    activeServer,
    _initialized,
  } = useServerStore();

  // Server switching state
  const [connectingServerKey, setConnectingServerKey] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add server form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('50002');
  const [newSSL, setNewSSL] = useState(true);
  const [newNotes, setNewNotes] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Notes editing
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesText, setEditingNotesText] = useState('');

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!connectionError) return;
    const timer = setTimeout(() => setConnectionError(null), 5000);
    return () => clearTimeout(timer);
  }, [connectionError]);

  // Load servers and reset state when sheet opens
  useEffect(() => {
    if (visible) {
      if (!_initialized) loadServers();
      setConnectingServerKey(null);
      setConnectionError(null);
      setShowAddForm(false);
      setEditingNotesId(null);
      setRefreshKey(k => k + 1);
    }
    return () => {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    };
  }, [visible, _initialized, loadServers]);

  // Colors
  const textPrimary = isDark ? '#FFFFFF' : '#000000';
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)';
  const textMuted = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const surfaceBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const sectionLabelColor = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const success = isDark ? '#30D158' : '#248A3D';
  const errorColor = isDark ? '#FF453A' : '#D70015';
  const accent = '#5AC8FA';

  // Build display list with health records
  const { connectedServer, favoriteServers, allServers, totalStats } = useMemo(() => {
    const ccache = ServerCacheManager.shared();
    const api = ElectrumAPI.shared(network);
    const fsmServer = api.getCurrentServer();
    const fsmConnected = api.isClientConnected();

    // Use activeServer from DB as primary source; fall back to FSM
    const effectiveHost = activeServer?.host ?? fsmServer?.host;
    const effectivePort = activeServer?.port ?? fsmServer?.port;
    const hasActiveServer = effectiveHost != null && effectivePort != null;

    const displayList: ServerDisplayInfo[] = savedServers.map(server => {
      const record = ccache.getRecord(server.host, server.port);
      const connected = hasActiveServer
        ? (server.host === effectiveHost && server.port === effectivePort)
        : (fsmConnected && fsmServer
            ? (fsmServer.host === server.host && fsmServer.port === server.port)
            : false);
      return { server, record, isConnected: connected };
    });

    // Sort: connected first, then favorites, then by score (desc)
    displayList.sort((a, b) => {
      if (a.isConnected && !b.isConnected) return -1;
      if (!a.isConnected && b.isConnected) return 1;
      if (a.server.isFavorite && !b.server.isFavorite) return -1;
      if (!a.server.isFavorite && b.server.isFavorite) return 1;
      if (a.server.isUserAdded && !b.server.isUserAdded) return -1;
      if (!a.server.isUserAdded && b.server.isUserAdded) return 1;
      const scoreA = a.record?.score ?? -1;
      const scoreB = b.record?.score ?? -1;
      return scoreB - scoreA;
    });

    let totalSuccess = 0;
    let totalFail = 0;
    let knownCount = 0;
    displayList.forEach(s => {
      if (s.record) {
        totalSuccess += s.record.successCount;
        totalFail += s.record.failureCount;
        knownCount++;
      }
    });

    const connected = displayList.find(s => s.isConnected) || null;
    const favorites = displayList.filter(s => s.server.isFavorite && !s.isConnected);
    const all = displayList.filter(s => !s.isConnected);

    return {
      connectedServer: connected,
      favoriteServers: favorites,
      allServers: all,
      totalStats: { totalSuccess, totalFail, knownCount, totalServers: displayList.length },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, network, refreshKey, savedServers, activeServer]);

  // ── Server switching handler ──────────────────────────────────
  const handleServerTap = useCallback(async (info: ServerDisplayInfo) => {
    if (info.isConnected || connectingServerKey !== null) return;

    const key = `${info.server.host}:${info.server.port}`;
    setConnectingServerKey(key);
    setConnectionError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    connectTimeoutRef.current = setTimeout(() => {
      setConnectingServerKey(prev => {
        if (prev === key) {
          setConnectionError(`Connection to ${info.server.host} timed out`);
          return null;
        }
        return prev;
      });
    }, 15000);

    try {
      const { ElectrumClient } = require('../services/electrum/ElectrumClient');
      const testClient = new ElectrumClient(network);
      (testClient as any).serverList = [{
        host: info.server.host,
        port: info.server.port,
        ssl: info.server.ssl,
      }];
      (testClient as any).currentServerIndex = 0;

      await Promise.race([
        testClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);

      testClient.disconnect();

      const ssl = info.server.ssl;
      const settingsState = useSettingsStore.getState();
      settingsState.setCustomElectrumServer({
        host: info.server.host,
        port: info.server.port,
        ssl,
        enabled: true,
      });
      settingsState.setUseCustomElectrum(true);

      // Persist active server to DB (single source of truth)
      setActiveServer({ host: info.server.host, port: info.server.port, ssl });

      const api = ElectrumAPI.shared(network);
      api.disconnect();
      api.connect().catch(() => {});

      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConnectingServerKey(null);
      onServerSwitch?.({ host: info.server.host, port: info.server.port, ssl });

      setTimeout(() => onClose(), 300);
    } catch (err: any) {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err?.message === 'timeout'
        ? `Connection to ${info.server.host} timed out`
        : `Failed to connect to ${info.server.host}`;
      setConnectionError(msg);
      setConnectingServerKey(null);
    }
  }, [connectingServerKey, network, onClose, onServerSwitch]);

  // ── Add server handler ──────────────────────────────────
  const handleAddServer = useCallback(() => {
    setAddError(null);
    const host = newHost.trim();
    if (!host) {
      setAddError('Host is required');
      return;
    }
    const port = parseInt(newPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setAddError('Port must be between 1 and 65535');
      return;
    }

    // Check for duplicates
    const existing = savedServers.find(s => s.host === host && s.port === port);
    if (existing) {
      setAddError('This server already exists');
      return;
    }

    addServer(host, port, newSSL, undefined, newNotes.trim() || undefined);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Reset form
    setNewHost('');
    setNewPort('50002');
    setNewSSL(true);
    setNewNotes('');
    setShowAddForm(false);
    setRefreshKey(k => k + 1);
  }, [newHost, newPort, newSSL, newNotes, savedServers, addServer]);

  // ── Delete server handler ──────────────────────────────────
  const handleDeleteServer = useCallback((info: ServerDisplayInfo) => {
    if (info.server.isBuiltIn) return;
    Alert.alert(
      'Remove Server',
      `Remove ${info.server.host}:${info.server.port}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeServer(info.server.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setRefreshKey(k => k + 1);
          },
        },
      ]
    );
  }, [removeServer]);

  // ── Save notes handler ──────────────────────────────────
  const handleSaveNotes = useCallback(() => {
    if (!editingNotesId) return;
    updateNotes(editingNotesId, editingNotesText.trim() || null);
    setEditingNotesId(null);
    setEditingNotesText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [editingNotesId, editingNotesText, updateNotes]);

  // ── Render server row ──────────────────────────────────
  const renderServerRow = (info: ServerDisplayInfo, isLast: boolean) => {
    const { server, record } = info;
    const score = record?.score ?? 0;
    const hasData = record !== null;
    const isBlacklisted = (record?.blacklistUntil ?? 0) > Date.now();
    const isConnecting = connectingServerKey === `${server.host}:${server.port}`;
    const isDisabled = connectingServerKey !== null;
    const isEditingNotes = editingNotesId === server.id;

    const rowIconColor = info.isConnected
      ? success
      : isBlacklisted
      ? errorColor
      : hasData && score > 0
      ? getScoreColor(score, isDark)
      : textMuted;

    return (
      <View key={`${server.host}:${server.port}`}>
        <Pressable
          onPress={() => handleServerTap(info)}
          onLongPress={() => {
            if (server.isUserAdded) handleDeleteServer(info);
          }}
          disabled={info.isConnected || isDisabled}
          style={({ pressed }) => [
            styles.serverRow,
            {
              backgroundColor: pressed
                ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                : 'transparent',
              opacity: isDisabled && !isConnecting && !info.isConnected ? 0.5 : 1,
            },
          ]}
        >
          {/* Server icon */}
          <View style={[styles.serverIcon, {
            backgroundColor: isDark ? `${rowIconColor}1F` : `${rowIconColor}14`,
          }]}>
            <Ionicons
              name={info.isConnected ? 'shield-checkmark' : 'server-outline'}
              size={16}
              color={rowIconColor}
            />
          </View>

          {/* Server info */}
          <View style={styles.serverInfo}>
            <Text style={[styles.serverHost, { color: textPrimary }]} numberOfLines={1}>
              {server.label || server.host}
            </Text>
            <View style={styles.serverMeta}>
              <Text style={[styles.serverMetaText, { color: textSecondary }]}>
                {server.label ? server.host : ''}:{server.port}
              </Text>
              {record?.serverImpl && (
                <Text style={[styles.serverMetaText, { color: textSecondary }]}>
                  {record.serverImpl}
                </Text>
              )}
              {server.notes && (
                <Text style={[styles.serverMetaText, { color: accent }]} numberOfLines={1}>
                  {server.notes}
                </Text>
              )}
              {isBlacklisted && (
                <Text style={[styles.serverMetaText, { color: errorColor }]}>blocked</Text>
              )}
              {server.isUserAdded && (
                <Text style={[styles.serverMetaText, { color: accent }]}>custom</Text>
              )}
            </View>
          </View>

          {/* Favorite star */}
          <TouchableOpacity
            onPress={() => {
              toggleFavorite(server.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setRefreshKey(k => k + 1);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.starBtn}
          >
            <Ionicons
              name={server.isFavorite ? 'star' : 'star-outline'}
              size={16}
              color={server.isFavorite ? '#FFD60A' : textMuted}
            />
          </TouchableOpacity>

          {/* Right: score / connecting / connected */}
          {isConnecting ? (
            <View style={styles.miniScoreBadge}>
              <ActivityIndicator size={14} color={textSecondary} />
            </View>
          ) : info.isConnected ? (
            <View style={[styles.miniConnectedBadge, {
              backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.08)',
            }]}>
              <Ionicons name="checkmark" size={12} color={success} />
            </View>
          ) : (
            <View style={styles.scoreChevron}>
              <View style={[styles.miniScoreBadge, {
                backgroundColor: hasData ? getScoreBg(score, isDark) : 'transparent',
              }]}>
                <Text style={[styles.miniScoreText, {
                  color: hasData ? getScoreColor(score, isDark) : textMuted,
                  fontVariant: ['tabular-nums'],
                }]}>
                  {hasData ? score : '\u2014'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={12} color={textMuted} />
            </View>
          )}
        </Pressable>

        {/* Notes editing inline */}
        {isEditingNotes && (
          <View style={[styles.notesEditRow, { backgroundColor: surfaceBg }]}>
            <TextInput
              style={[styles.notesInput, { color: textPrimary }]}
              value={editingNotesText}
              onChangeText={setEditingNotesText}
              placeholder="Add a note..."
              placeholderTextColor={textMuted}
              autoFocus
              onSubmitEditing={handleSaveNotes}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={handleSaveNotes}>
              <Ionicons name="checkmark-circle" size={22} color={success} />
            </TouchableOpacity>
          </View>
        )}

        {/* Divider */}
        {!isLast && (
          <View style={[styles.serverDivider, { backgroundColor: dividerColor }]} />
        )}
      </View>
    );
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Server Network"
      subtitle={`${totalStats.totalServers} servers \u00B7 ${totalStats.knownCount} with health data`}
      sizing={['auto', 'large']}
      scrollable
    >
      <View style={styles.scrollContent}>
        {/* ── Error Banner ── */}
        {connectionError && (
          <View style={[styles.errorBanner, {
            backgroundColor: isDark ? 'rgba(255,69,58,0.06)' : 'rgba(255,69,58,0.04)',
          }]}>
            <View style={[styles.errorIconCircle, {
              backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : 'rgba(255,69,58,0.08)',
            }]}>
              <Ionicons name="alert-circle" size={14} color={errorColor} />
            </View>
            <Text style={[styles.errorBannerText, { color: errorColor }]}>
              {connectionError}
            </Text>
          </View>
        )}

        {/* ── Connected Server Card ── */}
        <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>CONNECTED</Text>
        <View style={[styles.connectedCard, { backgroundColor: surfaceBg }]}>
          {connectedServer ? (
            <>
              <View style={styles.connectedRow}>
                <View style={[styles.connectedIconCircle, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)',
                }]}>
                  <Ionicons name="shield-checkmark" size={17} color={success} />
                </View>
                <View style={styles.connectedInfo}>
                  <Text style={[styles.connectedHost, { color: textPrimary }]} numberOfLines={1}>
                    {connectedServer.server.label || connectedServer.server.host}
                  </Text>
                  <Text style={[styles.connectedMeta, { color: textSecondary }]}>
                    :{connectedServer.server.port}
                    {connectedServer.record?.serverImpl ? ` \u00B7 ${connectedServer.record.serverImpl}` : ''}
                  </Text>
                </View>
                <View style={[styles.connectedBadge, {
                  backgroundColor: isDark ? 'rgba(48,209,88,0.10)' : 'rgba(48,209,88,0.08)',
                }]}>
                  <Text style={[styles.connectedBadgeText, { color: success }]}>Active</Text>
                </View>
              </View>
              {connectedServer.record && (
                <View style={styles.connectedStats}>
                  <StatPill icon="checkmark-circle" value={String(connectedServer.record.successCount)} color={success} isDark={isDark} />
                  <StatPill icon="close-circle" value={String(connectedServer.record.failureCount)} color={errorColor} isDark={isDark} />
                  <StatPill icon="speedometer" value={formatLatency(connectedServer.record.avgLatencyMs)} color={textSecondary} isDark={isDark} />
                  <View style={[styles.scoreBadge, {
                    backgroundColor: getScoreBg(connectedServer.record.score, isDark),
                  }]}>
                    <Text style={[styles.scoreText, {
                      color: getScoreColor(connectedServer.record.score, isDark),
                    }]}>
                      {connectedServer.record.score}
                    </Text>
                  </View>
                </View>
              )}
            </>
          ) : (
            <View style={styles.connectedRow}>
              <View style={[styles.connectedIconCircle, {
                backgroundColor: isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)',
              }]}>
                <Ionicons name="globe-outline" size={17} color="#8E8E93" />
              </View>
              <Text style={[styles.connectedHost, { color: textMuted }]}>
                Not connected
              </Text>
            </View>
          )}
        </View>

        {/* ── Quick Stats ── */}
        <View style={[styles.summaryRow, { backgroundColor: surfaceBg }]}>
          <SummaryItem label="Total" value={String(totalStats.totalServers)} color={textPrimary} secondaryColor={sectionLabelColor} />
          <SummaryItem label="Known" value={String(totalStats.knownCount)} color={textPrimary} secondaryColor={sectionLabelColor} />
          <SummaryItem label="Success" value={String(totalStats.totalSuccess)} color={success} secondaryColor={sectionLabelColor} />
          <SummaryItem label="Errors" value={String(totalStats.totalFail)} color={errorColor} secondaryColor={sectionLabelColor} />
        </View>

        {/* ── Favorites Section ── */}
        {favoriteServers.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 20 }]}>
              FAVORITES
            </Text>
            <View style={[styles.serverListCard, { backgroundColor: surfaceBg }]}>
              {favoriteServers.map((info, idx) =>
                renderServerRow(info, idx === favoriteServers.length - 1)
              )}
            </View>
          </>
        )}

        {/* ── Add Server Form ── */}
        {showAddForm && (
          <>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 20 }]}>
              ADD CUSTOM SERVER
            </Text>
            <View style={[styles.addFormCard, { backgroundColor: surfaceBg }]}>
              {/* Host */}
              <View style={styles.addFormRow}>
                <View style={[styles.addFormIconCircle, {
                  backgroundColor: isDark ? 'rgba(90,200,250,0.12)' : 'rgba(90,200,250,0.08)',
                }]}>
                  <Ionicons name="server-outline" size={14} color={accent} />
                </View>
                <TextInput
                  style={[styles.addFormInput, { color: textPrimary }]}
                  value={newHost}
                  onChangeText={setNewHost}
                  placeholder="electrum.example.com"
                  placeholderTextColor={textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
              <View style={[styles.addFormDivider, { backgroundColor: dividerColor }]} />

              {/* Port */}
              <View style={styles.addFormRow}>
                <View style={[styles.addFormIconCircle, {
                  backgroundColor: isDark ? 'rgba(175,130,255,0.12)' : 'rgba(175,130,255,0.08)',
                }]}>
                  <Ionicons name="keypad-outline" size={14} color="#AF82FF" />
                </View>
                <TextInput
                  style={[styles.addFormInput, { color: textPrimary }]}
                  value={newPort}
                  onChangeText={setNewPort}
                  placeholder="50002"
                  placeholderTextColor={textMuted}
                  keyboardType="number-pad"
                />
              </View>
              <View style={[styles.addFormDivider, { backgroundColor: dividerColor }]} />

              {/* SSL Toggle */}
              <View style={styles.addFormRow}>
                <View style={[styles.addFormIconCircle, {
                  backgroundColor: newSSL
                    ? (isDark ? 'rgba(48,209,88,0.12)' : 'rgba(48,209,88,0.08)')
                    : (isDark ? 'rgba(142,142,147,0.12)' : 'rgba(142,142,147,0.08)'),
                }]}>
                  <Ionicons name="lock-closed" size={14} color={newSSL ? '#30D158' : '#8E8E93'} />
                </View>
                <Text style={[styles.addFormLabel, { color: textPrimary }]}>SSL / TLS</Text>
                <FastSwitch
                  value={newSSL}
                  onValueChange={setNewSSL}
                />
              </View>
              <View style={[styles.addFormDivider, { backgroundColor: dividerColor }]} />

              {/* Notes */}
              <View style={styles.addFormRow}>
                <View style={[styles.addFormIconCircle, {
                  backgroundColor: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
                }]}>
                  <Ionicons name="document-text-outline" size={14} color="#FF9F0A" />
                </View>
                <TextInput
                  style={[styles.addFormInput, { color: textPrimary }]}
                  value={newNotes}
                  onChangeText={setNewNotes}
                  placeholder="Notes (optional)"
                  placeholderTextColor={textMuted}
                />
              </View>

              {addError && (
                <Text style={[styles.addFormError, { color: errorColor }]}>{addError}</Text>
              )}

              {/* Action buttons */}
              <View style={styles.addFormActions}>
                <TouchableOpacity
                  style={[styles.addFormBtn, styles.addFormBtnCancel, {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }]}
                  onPress={() => {
                    setShowAddForm(false);
                    setAddError(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.addFormBtnText, { color: textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addFormBtn, {
                    backgroundColor: isDark ? '#FFFFFF' : '#0D0D0D',
                  }]}
                  onPress={handleAddServer}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.addFormBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
                    Add Server
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* ── All Servers Section ── */}
        <View style={styles.allServersHeader}>
          <View>
            <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 20, marginBottom: 4 }]}>
              ALL SERVERS
            </Text>
            <Text style={[styles.sectionHint, { color: textMuted }]}>Tap to connect \u00B7 Long press to remove custom</Text>
          </View>
        </View>

        <View style={[styles.serverListCard, { backgroundColor: surfaceBg }]}>
          {allServers.map((info, idx) =>
            renderServerRow(info, idx === allServers.length - 1)
          )}
        </View>

        {/* ── Add Server CTA ── */}
        {!showAddForm && (
          <TouchableOpacity
            style={[styles.addServerCta, {
              backgroundColor: isDark ? 'rgba(90,200,250,0.08)' : 'rgba(90,200,250,0.06)',
            }]}
            onPress={() => {
              setShowAddForm(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.addServerCtaIcon, {
              backgroundColor: isDark ? 'rgba(90,200,250,0.15)' : 'rgba(90,200,250,0.12)',
            }]}>
              <Ionicons name="add" size={18} color={accent} />
            </View>
            <Text style={[styles.addServerCtaText, { color: accent }]}>Add Custom Server</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 24 }} />
      </View>
    </AppBottomSheet>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StatPill({ icon, value, color, isDark }: {
  icon: string;
  value: string;
  color: string;
  isDark: boolean;
}) {
  return (
    <View style={[styles.statPill, {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    }]}>
      <Ionicons name={icon as any} size={12} color={color} />
      <Text style={[styles.statPillText, { color }]}>{value}</Text>
    </View>
  );
}

function SummaryItem({ label, value, color, secondaryColor }: {
  label: string;
  value: string;
  color: string;
  secondaryColor: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color, fontVariant: ['tabular-nums'] }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: secondaryColor }]}>{label}</Text>
    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
    paddingLeft: 2,
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '400',
    marginBottom: 8,
    paddingLeft: 2,
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  errorIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '400',
    flex: 1,
    lineHeight: 19,
  },

  // Connected card
  connectedCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  connectedIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectedInfo: {
    flex: 1,
  },
  connectedHost: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  connectedMeta: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  connectedStats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  connectedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  connectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Stat pill
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statPillText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // Score badge
  scoreBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  // Summary row
  summaryRow: {
    flexDirection: 'row',
    borderRadius: 20,
    paddingVertical: 14,
    marginBottom: 4,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },

  // All servers header
  allServersHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  // Server list card
  serverListCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },

  // Server row
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  serverIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverInfo: {
    flex: 1,
  },
  serverHost: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  serverMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  serverMetaText: {
    fontSize: 12,
    fontWeight: '400',
  },
  starBtn: {
    padding: 4,
  },
  scoreChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniScoreBadge: {
    width: 32,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniScoreText: {
    fontSize: 12,
    fontWeight: '700',
  },
  miniConnectedBadge: {
    width: 32,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 64,
    marginRight: 14,
  },

  // Notes editing
  notesEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  notesInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    padding: 8,
    borderRadius: 10,
  },

  // Add server form
  addFormCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  addFormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  addFormIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFormInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    paddingVertical: 0,
  },
  addFormLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  addFormDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 58,
    marginRight: 14,
  },
  addFormError: {
    fontSize: 12,
    fontWeight: '400',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  addFormActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    paddingTop: 12,
  },
  addFormBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFormBtnCancel: {},
  addFormBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Add server CTA
  addServerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    marginTop: 12,
  },
  addServerCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addServerCtaText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
