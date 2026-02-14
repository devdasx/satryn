/**
 * BinanceWebSocket
 * Real-time Bitcoin price streaming via Binance WebSocket API.
 *
 * Performance: Binance sends ticks multiple times per second. To avoid
 * flooding the UI with re-renders, updates are throttled to fire at most
 * once every 2 seconds (THROTTLE_MS). The last price is always captured
 * instantly so data is never stale when read.
 */

export interface LivePriceData {
  price: number;
  timestamp: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
}

export type PriceUpdateCallback = (data: LivePriceData) => void;

// Binance WebSocket ticker response
interface BinanceTicker {
  e: string; // Event type (24hrTicker)
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price change
  P: string; // Price change percent
  c: string; // Last price
  Q: string; // Last quantity
  v: string; // Total traded base asset volume
}

/** Minimum interval between subscriber notifications (ms) */
const THROTTLE_MS = 2000;

class BinanceWebSocketService {
  private ws: WebSocket | null = null;
  private callbacks: Set<PriceUpdateCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private shouldReconnect = false;
  private lastPrice: LivePriceData | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  // Throttle state
  private lastNotifyTime = 0;
  private pendingNotify: NodeJS.Timeout | null = null;

  // Binance WebSocket endpoint for BTCUSDT ticker
  private readonly WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';

  /**
   * Subscribe to live price updates
   */
  subscribe(callback: PriceUpdateCallback): () => void {
    this.callbacks.add(callback);

    // Send last known price immediately if available
    if (this.lastPrice) {
      callback(this.lastPrice);
    }

    // Connect if not already connected
    if (!this.ws && !this.isConnecting) {
      this.connect();
    }

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
      // Disconnect if no more subscribers
      if (this.callbacks.size === 0) {
        this.disconnect();
      }
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get last known price
   */
  getLastPrice(): LivePriceData | null {
    return this.lastPrice;
  }

  /**
   * Connect to Binance WebSocket
   */
  private connect(): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(this.WS_URL);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: BinanceTicker = JSON.parse(event.data);

          if (data.e === '24hrTicker' && data.s === 'BTCUSDT') {
            const priceData: LivePriceData = {
              price: parseFloat(data.c),
              timestamp: data.E,
              volume24h: parseFloat(data.v),
              priceChange24h: parseFloat(data.p),
              priceChangePercent24h: parseFloat(data.P),
            };

            // Always store latest price (no delay)
            this.lastPrice = priceData;
            // Throttle UI notifications
            this.throttledNotify(priceData);
          }
        } catch {
          // Silently ignore parse errors — they're not actionable
        }
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.stopPing();

        // Attempt reconnect if we should
        if (this.shouldReconnect && this.callbacks.size > 0) {
          this.scheduleReconnect();
        }
      };
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  private disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();

    if (this.pendingNotify) {
      clearTimeout(this.pendingNotify);
      this.pendingNotify = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }

  /**
   * Force disconnect (for cleanup)
   */
  forceDisconnect(): void {
    this.callbacks.clear();
    this.disconnect();
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.shouldReconnect && this.callbacks.size > 0) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.stopPing();
    // WebSocket ping/pong is handled automatically by the RN runtime.
    // No manual ping interval needed — removed no-op timer to avoid wasted CPU wakeups.
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Throttled notification — fires at most once every THROTTLE_MS.
   * If a tick arrives within the throttle window, it's queued and
   * fires at the end of the window with the latest data.
   */
  private throttledNotify(data: LivePriceData): void {
    const now = Date.now();
    const elapsed = now - this.lastNotifyTime;

    if (elapsed >= THROTTLE_MS) {
      // Enough time passed — fire immediately
      this.lastNotifyTime = now;
      this.notifySubscribers(data);
    } else if (!this.pendingNotify) {
      // Schedule a deferred notify at the end of the throttle window
      this.pendingNotify = setTimeout(() => {
        this.pendingNotify = null;
        this.lastNotifyTime = Date.now();
        if (this.lastPrice) {
          this.notifySubscribers(this.lastPrice);
        }
      }, THROTTLE_MS - elapsed);
    }
    // else: a deferred notify is already queued — it will use this.lastPrice (latest)
  }

  /**
   * Notify all subscribers of new price data
   */
  private notifySubscribers(data: LivePriceData): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch {
        // Silently ignore subscriber errors
      }
    });
  }
}

// Export singleton instance
export const BinanceWebSocket = new BinanceWebSocketService();
