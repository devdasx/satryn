/**
 * Electrum Protocol Type Definitions
 */

// Server connection info
export interface ElectrumServerInfo {
  host: string;
  port: number;
  ssl: boolean;
}

// Balance response from blockchain.scripthash.get_balance
export interface ElectrumBalance {
  confirmed: number;
  unconfirmed: number;
}

// UTXO from blockchain.scripthash.listunspent
export interface ElectrumUTXO {
  tx_hash: string;
  tx_pos: number;
  height: number;
  value: number;
}

// History item from blockchain.scripthash.get_history
export interface ElectrumHistoryItem {
  tx_hash: string;
  height: number;
  fee?: number;
}

// Transaction input
export interface ElectrumVin {
  txid: string;
  vout: number;
  scriptSig: {
    asm: string;
    hex: string;
  };
  txinwitness?: string[];
  sequence: number;
  prevout?: {
    scriptpubkey: string;
    scriptpubkey_address: string;
    value: number;
  };
}

// Transaction output
export interface ElectrumVout {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    type: string;
    address?: string;
  };
}

// Full transaction from blockchain.transaction.get (verbose=true)
export interface ElectrumTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: ElectrumVin[];
  vout: ElectrumVout[];
  hex: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

// JSON-RPC request
export interface ElectrumRequest {
  id: number;
  method: string;
  params: any[];
}

// JSON-RPC response
export interface ElectrumResponse<T = any> {
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

// Connection states (6-state machine with validated transitions)
export type ConnectionState =
  | 'disconnected'   // No socket, idle
  | 'connecting'     // TCP/TLS socket being opened
  | 'handshaking'    // Socket open, running server.version()
  | 'ready'          // Fully operational, can accept requests
  | 'draining'       // Graceful shutdown, no new requests, waiting for pending
  | 'error';         // Terminal failure, must disconnect before reconnecting

// Header subscription response
export interface ElectrumHeader {
  height: number;
  hex: string;
}

// Mempool entry from blockchain.scripthash.get_mempool
export interface ElectrumMempoolEntry {
  tx_hash: string;
  height: number;
  fee: number;
}
