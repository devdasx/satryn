import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Animated,
  LayoutAnimation,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { PathDiscoveryResult } from '../../services/import/types';
import { formatUnitAmount } from '../../utils/formatting';
import type { BitcoinUnit } from '../../types';

interface PathDiscoveryCardProps {
  isDark: boolean;
  results: PathDiscoveryResult[];
  isScanning: boolean;
  hasActivity: boolean;
  totalBalanceSats: number;
  onPathSelect?: (path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => void;
  denomination?: BitcoinUnit;
}

/** Format satoshis to BTC string */
function formatBTC(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, '') || '0';
}

/** Format satoshis to sats string with thousands separator */
function formatSats(sats: number): string {
  return sats.toLocaleString();
}

/** Get status icon for a result */
function getStatusIcon(status: PathDiscoveryResult['status'], hasBalance: boolean, hasUsed: boolean): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  switch (status) {
    case 'pending':
      return { name: 'ellipse-outline', color: 'rgba(255,255,255,0.25)' };
    case 'scanning':
      return { name: 'sync', color: '#007AFF' };
    case 'complete':
      if (hasBalance) {
        return { name: 'checkmark-circle', color: '#30D158' };
      }
      if (hasUsed) {
        return { name: 'checkmark-circle-outline', color: '#FFD60A' };
      }
      return { name: 'ellipse-outline', color: 'rgba(255,255,255,0.25)' };
    case 'error':
      return { name: 'alert-circle', color: '#FF453A' };
    default:
      return { name: 'ellipse-outline', color: 'rgba(255,255,255,0.25)' };
  }
}

export function PathDiscoveryCard({
  isDark,
  results,
  isScanning,
  hasActivity,
  totalBalanceSats,
  onPathSelect,
  denomination = 'btc',
}: PathDiscoveryCardProps) {
  // Animate pulse for scanning header
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isScanning) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isScanning, pulseAnim]);

  // Layout animation when results change
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [results]);

  // Count completed paths
  const completedCount = results.filter(r => r.status === 'complete' || r.status === 'error').length;

  const handlePathPress = (path: 'bip44' | 'bip49' | 'bip84' | 'bip86') => {
    if (onPathSelect) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPathSelect(path);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {isScanning ? (
            <>
              <Animated.View style={{ opacity: pulseAnim }}>
                <ActivityIndicator size="small" color="#007AFF" />
              </Animated.View>
              <Animated.Text
                style={[
                  styles.headerTitle,
                  { color: isDark ? '#FFFFFF' : '#000000', opacity: pulseAnim },
                ]}
              >
                Checking Paths...
              </Animated.Text>
            </>
          ) : (
            <>
              <Ionicons
                name={hasActivity ? 'wallet' : 'wallet-outline'}
                size={18}
                color={hasActivity ? '#30D158' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')}
              />
              <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                Path Discovery
              </Text>
            </>
          )}
        </View>
        {!isScanning && hasActivity && totalBalanceSats > 0 && (
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>
              {formatUnitAmount(totalBalanceSats, denomination || 'sat')}
            </Text>
          </View>
        )}
      </View>

      {/* Path Rows */}
      <View style={styles.pathList}>
        {results.map((result, index) => {
          const hasBalance = result.balanceSats > 0;
          const hasUsed = result.usedAddressCount > 0;
          const statusIcon = getStatusIcon(result.status, hasBalance, hasUsed);

          return (
            <TouchableOpacity
              key={result.path}
              style={[
                styles.pathRow,
                index < results.length - 1 && styles.pathRowBorder,
                { borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
              ]}
              onPress={() => handlePathPress(result.path)}
              disabled={!onPathSelect || result.status !== 'complete'}
              activeOpacity={0.7}
            >
              {/* Left side: Icon + Path info */}
              <View style={styles.pathLeft}>
                {result.status === 'scanning' ? (
                  <ActivityIndicator size="small" color="#007AFF" style={styles.pathIcon} />
                ) : (
                  <Ionicons
                    name={statusIcon.name}
                    size={18}
                    color={statusIcon.color}
                    style={styles.pathIcon}
                  />
                )}
                <View style={styles.pathInfo}>
                  <Text style={[styles.pathLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                    {result.path.toUpperCase()}
                  </Text>
                  <Text style={[styles.pathDesc, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)' }]}>
                    {result.addressPrefix}
                  </Text>
                </View>
              </View>

              {/* Right side: Status/Balance */}
              <View style={styles.pathRight}>
                {result.status === 'pending' && (
                  <Text style={[styles.statusText, { color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)' }]}>
                    Waiting...
                  </Text>
                )}
                {result.status === 'scanning' && (
                  <Text style={[styles.statusText, { color: '#007AFF' }]}>
                    Scanning...
                  </Text>
                )}
                {result.status === 'complete' && hasBalance && (
                  <View style={styles.balanceInfo}>
                    <Text style={styles.balanceText}>
                      {formatUnitAmount(result.balanceSats, denomination || 'sat')}
                    </Text>
                    <Text style={[styles.usedText, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)' }]}>
                      {result.usedAddressCount} used
                    </Text>
                  </View>
                )}
                {result.status === 'complete' && !hasBalance && hasUsed && (
                  <View style={styles.balanceInfo}>
                    <Text style={[styles.spentText, { color: '#FFD60A' }]}>
                      {result.usedAddressCount} used
                    </Text>
                    <Text style={[styles.usedText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
                      (spent)
                    </Text>
                  </View>
                )}
                {result.status === 'complete' && !hasBalance && !hasUsed && (
                  <Text style={[styles.statusText, { color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)' }]}>
                    No activity
                  </Text>
                )}
                {result.status === 'error' && (
                  <Text style={[styles.statusText, { color: '#FF453A' }]}>
                    Error
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Summary Footer */}
      <View style={[styles.footer, { borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
        {isScanning ? (
          <Text style={[styles.footerText, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)' }]}>
            Scanning {completedCount} of {results.length} paths...
          </Text>
        ) : hasActivity ? (
          <View style={styles.footerSuccess}>
            <Ionicons name="checkmark-circle" size={16} color="#30D158" />
            <Text style={styles.footerSuccessText}>
              {totalBalanceSats > 0
                ? `Balance found!`
                : `Activity detected on ${results.filter(r => r.usedAddressCount > 0).length} path(s)`}
            </Text>
          </View>
        ) : (
          <Text style={[styles.footerText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }]}>
            No activity found on any path
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  totalBadge: {
    backgroundColor: 'rgba(48,209,88,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  totalBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#30D158',
  },
  pathList: {
    paddingHorizontal: 16,
  },
  pathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  pathRowBorder: {
    borderBottomWidth: 1,
  },
  pathLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pathIcon: {
    width: 20,
  },
  pathInfo: {
    gap: 2,
  },
  pathLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  pathDesc: {
    fontSize: 12,
  },
  pathRight: {
    alignItems: 'flex-end',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  balanceInfo: {
    alignItems: 'flex-end',
    gap: 2,
  },
  balanceText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#30D158',
  },
  spentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  usedText: {
    fontSize: 11,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 4,
    borderTopWidth: 1,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  footerSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerSuccessText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#30D158',
  },
});
