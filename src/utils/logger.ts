/**
 * Centralized Logger — replaces all console.log/warn/error across the app.
 *
 * In __DEV__ mode, logs are printed to the console with category tags.
 * In production, all logging is silenced for performance.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('WalletStore', 'Switched wallet', walletId);
 *   logger.warn('Electrum', 'Connection timeout');
 *   logger.error('Send', 'Transaction failed', error);
 *   logger.perf('Sync', 'Balance refresh', startTime);
 */

const __DEV__ = process.env.NODE_ENV !== 'production';

// Performance tracking
const perfTimers = new Map<string, number>();

export const logger = {
  /** Informational log — only in dev */
  info: (tag: string, ...args: any[]) => {
    if (__DEV__) console.log(`[${tag}]`, ...args);
  },

  /** Warning — only in dev */
  warn: (tag: string, ...args: any[]) => {
    if (__DEV__) console.warn(`[${tag}]`, ...args);
  },

  /** Error — always logged (even in prod, errors matter) */
  error: (tag: string, ...args: any[]) => {
    if (__DEV__) console.error(`[${tag}]`, ...args);
  },

  /** Start a performance timer */
  perfStart: (label: string) => {
    if (__DEV__) perfTimers.set(label, Date.now());
  },

  /** End a performance timer and log the duration */
  perfEnd: (label: string) => {
    if (__DEV__) {
      const start = perfTimers.get(label);
      if (start) {
        const duration = Date.now() - start;
        perfTimers.delete(label);
        const color = duration > 500 ? '🔴' : duration > 100 ? '🟡' : '🟢';
        console.log(`${color} [Perf] ${label}: ${duration}ms`);
      }
    }
  },
};

export default logger;
