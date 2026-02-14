/**
 * SyncLogger — In-memory ring buffer for sync/connection diagnostics.
 *
 * Captures timestamped log entries from the sync pipeline so they
 * can be displayed in a Debug Logs screen. Keeps the last MAX_ENTRIES
 * entries and notifies subscribers on each new log.
 *
 * Usage:
 *   SyncLogger.log('refreshBalance', 'Starting sync for 42 addresses');
 *   SyncLogger.error('electrum', 'Connection timeout after 10s');
 *   SyncLogger.subscribe(entries => setLogs(entries));
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  tag: string;
  message: string;
}

type Listener = (entries: LogEntry[]) => void;

const MAX_ENTRIES = 500;

let nextId = 1;
const entries: LogEntry[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = [...entries];
  for (const fn of listeners) {
    try { fn(snapshot); } catch {}
  }
}

function push(level: LogLevel, tag: string, message: string): void {
  const entry: LogEntry = {
    id: nextId++,
    timestamp: Date.now(),
    level,
    tag,
    message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  emit();
}

export const SyncLogger = {
  log(tag: string, message: string): void {
    push('info', tag, message);
  },

  warn(tag: string, message: string): void {
    push('warn', tag, message);
  },

  error(tag: string, message: string): void {
    push('error', tag, message);
  },

  /** Get current snapshot of all entries */
  getEntries(): LogEntry[] {
    return [...entries];
  },

  /** Clear all entries */
  clear(): void {
    entries.length = 0;
    nextId = 1;
    emit();
  },

  /** Subscribe to log updates. Returns unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
