/**
 * SendStore — Zustand store for the send flow.
 *
 * Navigation is handled by expo-router (real stack routes).
 * This store manages transaction data, recipients, fees, and error state.
 *
 * Wallet capability detection:
 *  - watch_xpub / watch_descriptor / watch_addresses → watch_only → unsigned PSBT
 *  - multisig → partial sign → PSBT export
 *  - all others (hd, hd_xprv, hd_seed, hd_descriptor, hd_electrum, imported_key, imported_keys) → full sign + broadcast
 */

import { create } from 'zustand';
import * as bitcoin from 'bitcoinjs-lib';
import { TransactionBuilder } from '../core/transaction/TransactionBuilder';
import { UTXOSelector } from '../core/transaction/UTXOSelector';
import { KeyDerivation, SeedGenerator, MultisigWallet } from '../core/wallet';
import { ImportedKeySigner } from '../core/wallet/ImportedKeySigner';
import { PSBTService } from '../services/psbt/PSBTService';
import type { MultisigSignatureStatus, MultisigAddressPathInfo } from '../services/psbt/PSBTService';
import { MempoolFeeService } from '../services/api/MempoolFeeService';
import { ElectrumAPI } from '../services/electrum';
import { SecureStorage } from '../services/storage/SecureStorage';
import { WalletSyncManager } from '../services/sync/WalletSyncManager';
import { keyDerivationFromSecureStorage } from '../services/wallet/KeyDerivationFactory';
import { SyncLogger } from '../services/SyncLogger';
import { useWalletStore } from './walletStore';
import { useSettingsStore } from './settingsStore';
import { useMultiWalletStore } from './multiWalletStore';
import { usePriceStore } from './priceStore';
import { useUTXOStore } from './utxoStore';
import { unitToSats } from '../utils/formatting';
import type { WalletType } from './multiWalletStore';
import type { UTXO, FeeRecommendation, AddressType, BitcoinUnit, PreparedTransaction, MultisigScriptType, CosignerInfo } from '../types';

// ─── Types ──────────────────────────────────────────────────────────

/** Used by SendHeader to know which step is active (passed as prop from route) */
export type SendStep = 'recipient' | 'amount' | 'review' | 'broadcasting' | 'success' | 'psbt';

export type FeeOption = 'fast' | 'normal' | 'slow' | 'custom';

export type ErrorLevel = 'error' | 'warning';

export type WalletCapability = 'full_sign' | 'watch_only' | 'multisig';

/** Controls whether PIN verification leads to sign+broadcast or sign-only */
export type SignMode = 'sign_and_broadcast' | 'sign_only';

export type InputUnit = BitcoinUnit | 'fiat';

export interface SendRecipient {
  address: string;
  amountSats: number;
  label?: string;
}

interface SignedTxResult {
  hex: string;
  txid: string;
  fee: number;
}

// ─── State ──────────────────────────────────────────────────────────

interface SendState {
  // Recipients
  recipients: SendRecipient[];
  activeRecipientIndex: number;

  // Amount — tracks per-recipient when multi-recipient
  amountInput: string;
  inputUnit: InputUnit;
  isSendMax: boolean;
  /** Index of the recipient currently being edited in the Amount step */
  amountRecipientIndex: number;

  // Fees
  feeOption: FeeOption;
  feeRate: number;
  customFeeRate: number | null;
  feeEstimates: FeeRecommendation | null;
  isFetchingFees: boolean;

  // Advanced
  selectedUtxos: UTXO[] | null; // null = auto coin selection
  enableRBF: boolean;
  memo: string;

  // Wallet capability
  walletCapability: WalletCapability;

  // Transaction result
  preparedFee: number | null;
  preparedSize: number | null;
  /** Unsigned PSBT base64 — built during prepareTx, updates reactively with fee/utxo/RBF changes */
  preparedPsbtBase64: string | null;
  signedTx: SignedTxResult | null;
  psbtBase64: string | null;
  psbtObject: bitcoin.Psbt | null;
  broadcastTxid: string | null;

  // Multisig signature tracking
  signatureStatus: MultisigSignatureStatus | null;

  // Sign mode and signed hex (sign-only flow from review screen)
  signMode: SignMode;
  /** Raw signed transaction hex — available after sign-only flow */
  signedRawHex: string | null;

  // Status
  isBroadcasting: boolean;
  error: string | null;
  errorLevel: ErrorLevel | null;
}

interface SendActions {
  // Recipients
  addRecipient: (recipient?: Partial<SendRecipient>) => void;
  removeRecipient: (index: number) => void;
  updateRecipient: (index: number, update: Partial<SendRecipient>) => void;
  setActiveRecipientIndex: (index: number) => void;

  // Amount
  setAmountInput: (input: string) => void;
  setInputUnit: (unit: InputUnit) => void;
  cycleUnit: () => void;
  setSendMax: (enabled: boolean) => void;
  /** Advance to next recipient's amount. Returns 'review' if all done, 'next_recipient' if more. */
  nextAmountRecipient: () => 'next_recipient' | 'review';
  /** Go to previous recipient's amount. Returns 'back_to_recipient' if at first, 'prev_recipient' if more. */
  prevAmountRecipient: () => 'prev_recipient' | 'back_to_recipient';
  /** Set which recipient index we're editing in the amount step */
  setAmountRecipientIndex: (index: number) => void;

  // Fees
  setFeeOption: (option: FeeOption) => void;
  setCustomFeeRate: (rate: number) => void;
  fetchFees: () => Promise<void>;
  getEffectiveFeeRate: () => number;

  // Advanced
  setSelectedUtxos: (utxos: UTXO[] | null) => void;
  toggleRBF: () => void;
  setMemo: (memo: string) => void;

  // Wallet capability
  detectWalletCapability: () => WalletCapability;

  // Transaction
  prepareTx: () => Promise<{ fee: number; size: number } | null>;
  signAndBroadcast: (pin: string) => Promise<string>;
  /** Sign only — builds + signs the PSBT, stores raw hex, does NOT broadcast */
  signOnly: (pin: string) => Promise<string>;
  setSignMode: (mode: SignMode) => void;
  exportPSBT: (pin?: string) => Promise<string>;

  // Multisig PSBT actions
  updateSignatureStatus: () => void;
  signWithLocalKeys: (pin: string) => Promise<number>;
  signWithSpecificCosigner: (pin: string, fingerprint: string) => Promise<boolean>;
  importSignedPSBT: (base64: string) => Promise<{ success: boolean; newSignatures: number; error?: string }>;
  finalizeAndBroadcast: () => Promise<string>;

  // Prefill from route params
  prefillFromParams: (params: {
    address?: string;
    amount?: string;
    memo?: string;
    bip21?: string;
  }) => void;

  // Reset
  reset: () => void;
}

export type SendStore = SendState & SendActions;

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULT_STATE: SendState = {
  recipients: [{ address: '', amountSats: 0 }],
  activeRecipientIndex: 0,
  amountInput: '',
  inputUnit: 'sat',
  isSendMax: false,
  amountRecipientIndex: 0,
  feeOption: 'normal',
  feeRate: 1,
  customFeeRate: null,
  feeEstimates: null,
  isFetchingFees: false,
  selectedUtxos: null,
  enableRBF: true,
  memo: '',
  walletCapability: 'full_sign',
  preparedFee: null,
  preparedSize: null,
  preparedPsbtBase64: null,
  signedTx: null,
  psbtBase64: null,
  psbtObject: null,
  broadcastTxid: null,
  signatureStatus: null,
  signMode: 'sign_and_broadcast' as SignMode,
  signedRawHex: null,
  isBroadcasting: false,
  error: null,
  errorLevel: null,
};

// ─── Helpers ────────────────────────────────────────────────────────

const WATCH_TYPES: WalletType[] = ['watch_xpub', 'watch_descriptor', 'watch_addresses'];

function resolveCapability(walletType: WalletType | undefined): WalletCapability {
  if (!walletType) return 'full_sign';
  if (WATCH_TYPES.includes(walletType)) return 'watch_only';
  if (walletType === 'multisig') return 'multisig';
  return 'full_sign';
}

function feeOptionToRate(option: FeeOption, estimates: FeeRecommendation | null): number {
  if (!estimates) return 1;
  switch (option) {
    case 'fast': return estimates.fastest;
    case 'normal': return estimates.halfHour;
    case 'slow': return estimates.hour;
    case 'custom': return 1; // caller should use customFeeRate
  }
}

/** Get KeyDerivation instance based on wallet type — delegates to shared factory */
async function getKeyDerivation(
  walletId: string,
  walletType: WalletType,
  network: 'mainnet' | 'testnet',
  pin: string,
): Promise<KeyDerivation> {
  return keyDerivationFromSecureStorage(walletId, walletType, network, pin);
}

/**
 * In-memory LRU cache for raw transaction hex (keyed by txid).
 * Raw transactions are immutable, so caching is safe for the lifetime of the send flow.
 * Cleared on sendStore.reset(). Capped at 200 entries to prevent unbounded growth.
 */
const RAW_TX_CACHE_MAX = 200;
const rawTxHexCache = new Map<string, string>();
function rawTxCacheSet(txid: string, hex: string): void {
  if (rawTxHexCache.size >= RAW_TX_CACHE_MAX) {
    // Evict oldest entry (first key in Map insertion order)
    const firstKey = rawTxHexCache.keys().next().value;
    if (firstKey !== undefined) rawTxHexCache.delete(firstKey);
  }
  rawTxHexCache.set(txid, hex);
}

/**
 * Fee fetching debounce timer — prevents redundant network calls during rapid input changes.
 * Each fetchFees() call cancels any pending fetch and waits 300ms before executing.
 */
let fetchFeesTimer: ReturnType<typeof setTimeout> | null = null;
const FETCH_FEES_DEBOUNCE_MS = 300;

/**
 * Enrich legacy (P2PKH) UTXOs with rawTxHex required for signing.
 * Legacy inputs use nonWitnessUtxo which needs the full previous transaction.
 * Uses an in-memory cache to avoid redundant Electrum fetches across
 * prepareTx → signAndBroadcast → exportPSBT calls within the same send flow.
 */
async function enrichLegacyUtxos(utxos: UTXO[], network: 'mainnet' | 'testnet'): Promise<UTXO[]> {
  // Legacy addresses: start with '1' (mainnet) or 'm'/'n' (testnet)
  const isLegacy = (addr: string) => {
    if (network === 'mainnet') return addr.startsWith('1');
    return addr.startsWith('m') || addr.startsWith('n');
  };

  const needsRawHex = utxos.filter((u) => {
    if (u.rawTxHex) return false; // already has it from UTXO object
    if (rawTxHexCache.has(u.txid)) return false; // already cached
    return isLegacy(u.address);
  });

  // Apply cache hits even if no network fetch needed
  if (needsRawHex.length === 0) {
    return utxos.map((u) => {
      if (u.rawTxHex) return u;
      const cached = rawTxHexCache.get(u.txid);
      return cached ? { ...u, rawTxHex: cached } : u;
    });
  }

  // Fetch only uncached raw tx hex in batch
  const txids = [...new Set(needsRawHex.map((u) => u.txid))];
  const electrum = new ElectrumAPI();
  const rawMap = await electrum.getRawTransactionHexBatch(txids);

  // Populate cache with fetched results (uses LRU-capped setter)
  for (const [txid, hex] of rawMap) {
    rawTxCacheSet(txid, hex);
  }

  // Attach rawTxHex to matching UTXOs (from network fetch or cache)
  return utxos.map((u) => {
    if (u.rawTxHex) return u;
    const hex = rawMap.get(u.txid) || rawTxHexCache.get(u.txid);
    if (hex) return { ...u, rawTxHex: hex };
    return u;
  });
}

/**
 * Filter UTXOs for multisig wallets to only include UTXOs at actual multisig addresses.
 * Multisig wallets can have non-multisig addresses in their address list (from HD gap
 * discovery or mixed wallet history). These UTXOs can't be signed by the multisig
 * cosigners and would cause finalization to fail.
 *
 * This filters UTXOs by checking if their address belongs to the multisig derivation
 * (uses MultisigWallet.findAddress() which caches results for performance).
 */
function filterMultisigUtxos(
  utxos: UTXO[],
  multisigConfig: any,
  network: 'mainnet' | 'testnet',
): UTXO[] {
  if (!multisigConfig) return utxos;

  try {
    const msWalletConfig = {
      m: multisigConfig.m,
      n: multisigConfig.n,
      scriptType: multisigConfig.scriptType as MultisigScriptType,
      cosigners: multisigConfig.cosigners.map((c: any, idx: number) => ({
        id: `cosigner_${idx}`,
        name: c.name,
        fingerprint: c.fingerprint,
        xpub: c.xpub,
        derivationPath: c.derivationPath,
        isLocal: c.isLocal,
      } as CosignerInfo)),
      derivationPath: multisigConfig.cosigners[0]?.derivationPath || `m/48'/0'/0'/2'`,
      sortedKeys: true,
    };

    const msWallet = MultisigWallet.fromConfig(msWalletConfig, network);

    // Collect unique addresses from UTXOs
    const uniqueAddresses = new Set(utxos.map(u => u.address));
    const multisigAddresses = new Set<string>();

    for (const addr of uniqueAddresses) {
      try {
        const msAddrInfo = msWallet.findAddress(addr);
        if (msAddrInfo) {
          multisigAddresses.add(addr);
        }
      } catch {
        // Not a multisig address
      }
    }

    const filtered = utxos.filter(u => multisigAddresses.has(u.address));
    const removed = utxos.length - filtered.length;
    if (removed > 0) {
      if (__DEV__) console.log(`[filterMultisigUtxos] Removed ${removed} non-multisig UTXOs (${utxos.length} → ${filtered.length})`);
    }
    return filtered;
  } catch (err: any) {
    if (__DEV__) console.log(`[filterMultisigUtxos] WARNING: Failed to filter UTXOs: ${err.message}, using all UTXOs`);
    return utxos;
  }
}

/** Classify error severity: 'error' blocks the send button, 'warning' allows retry */
function classifyErrorLevel(message: string): ErrorLevel {
  const lower = message.toLowerCase();
  // Warnings — user may be able to fix and retry
  if (lower.includes('dust') || lower.includes('too small')) return 'warning';
  if (lower.includes('derivation path') || lower.includes('no derivation')) return 'warning';
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('connection')) return 'warning';
  if (lower.includes('circuit breaker') || lower.includes('retry')) return 'warning';
  if (lower.includes('fetch failed')) return 'warning';
  if (lower.includes('insufficient fee') || lower.includes('rejecting replacement')) return 'warning';
  // Default: error (blocks send)
  return 'error';
}

/**
 * Humanize broadcast error messages.
 * Bitcoin Core RPC errors are cryptic — translate to user-friendly text.
 */
function humanizeBroadcastError(raw: string): string {
  const lower = raw.toLowerCase();

  // RBF rejection: new tx fee is too low to replace an existing unconfirmed tx
  if (lower.includes('insufficient fee') && lower.includes('rejecting replacement')) {
    return 'A previous transaction is still pending. Please increase the fee rate or wait for it to confirm.';
  }

  // Mempool conflict: spending already-spent outputs
  if (lower.includes('txn-mempool-conflict') || lower.includes('missing inputs') || lower.includes('bad-txns-inputs-missingorspent')) {
    return 'One or more inputs are already spent by a pending transaction. Please wait for confirmation or refresh your wallet.';
  }

  // Min relay fee
  if (lower.includes('min relay fee not met')) {
    return 'Fee rate is below the network minimum. Please increase the fee.';
  }

  // Dust output
  if (lower.includes('dust')) {
    return 'Transaction output is too small (dust). Please increase the amount.';
  }

  return raw;
}

/**
 * Enforce minimum fee rate for RBF safety.
 *
 * When spending unconfirmed UTXOs (change from a recent send), Bitcoin nodes
 * treat the new transaction as an RBF replacement of the original. BIP 125
 * requires the replacement fee rate to be strictly higher than the original.
 *
 * Since we don't track individual mempool tx fee rates, we use a safe floor:
 * if ANY input is unconfirmed, bump the effective fee rate by +1 sat/vB above
 * the user-chosen rate (minimum 2 sat/vB) to ensure the replacement is accepted.
 */
function enforceRBFFeeFloor(utxos: UTXO[], chosenFeeRate: number): number {
  const hasUnconfirmed = utxos.some(u => u.confirmations === 0);
  if (!hasUnconfirmed) return chosenFeeRate;

  // Ensure fee rate is at least 2 sat/vB when spending unconfirmed outputs.
  // This gives a buffer above the minimum relay fee (1 sat/vB).
  const MIN_RBF_RATE = 2;
  if (chosenFeeRate < MIN_RBF_RATE) {
    SyncLogger.log('send', `[RBF] Unconfirmed inputs detected — bumping fee rate from ${chosenFeeRate} to ${MIN_RBF_RATE} sat/vB`);
    return MIN_RBF_RATE;
  }

  return chosenFeeRate;
}

// ─── Store ──────────────────────────────────────────────────────────

export const useSendStore = create<SendStore>()((set, get) => ({
  ...DEFAULT_STATE,

  // ── Recipients ──────────────────────────────────────────────────

  addRecipient: (recipient) => {
    const { recipients } = get();
    set({
      recipients: [...recipients, { address: '', amountSats: 0, ...recipient }],
      activeRecipientIndex: recipients.length,
    });
  },

  removeRecipient: (index) => {
    const { recipients, activeRecipientIndex } = get();
    if (recipients.length <= 1) return;
    const updated = recipients.filter((_, i) => i !== index);
    set({
      recipients: updated,
      activeRecipientIndex: Math.min(activeRecipientIndex, updated.length - 1),
    });
  },

  updateRecipient: (index, update) => {
    const { recipients } = get();
    const updated = [...recipients];
    updated[index] = { ...updated[index], ...update };
    set({ recipients: updated });
  },

  setActiveRecipientIndex: (index) => set({ activeRecipientIndex: index }),

  // ── Amount ──────────────────────────────────────────────────────

  setAmountInput: (input) => set({ amountInput: input, isSendMax: false }),

  setInputUnit: (unit) => set({ inputUnit: unit }),

  cycleUnit: () => {
    const { inputUnit } = get();
    const denomination = useSettingsStore.getState().denomination;
    set({
      inputUnit: inputUnit === denomination ? 'fiat' : denomination,
      amountInput: '',
      isSendMax: false,
    });
  },

  setSendMax: (enabled) => set({ isSendMax: enabled, amountInput: enabled ? 'MAX' : '' }),

  setAmountRecipientIndex: (index) => set({ amountRecipientIndex: index }),

  nextAmountRecipient: () => {
    const { recipients, amountRecipientIndex, amountInput, inputUnit, isSendMax } = get();
    const price = usePriceStore.getState().price;

    // Save the current amount to the current recipient
    if (!isSendMax && amountInput && amountInput !== '0') {
      const num = parseFloat(amountInput);
      if (!isNaN(num) && num > 0) {
        let sats: number;
        if (inputUnit === 'fiat') {
          sats = price ? Math.round((num / price) * 100_000_000) : 0;
        } else {
          sats = unitToSats(num, inputUnit);
        }
        const updated = [...recipients];
        updated[amountRecipientIndex] = { ...updated[amountRecipientIndex], amountSats: sats };
        set({ recipients: updated });
      }
    }

    const validRecipients = recipients.filter((r) => r.address);
    const nextIndex = amountRecipientIndex + 1;

    if (nextIndex >= validRecipients.length) {
      // All recipients have amounts — caller should navigate to review
      set({ error: null, errorLevel: null });
      return 'review' as const;
    } else {
      // Move to next recipient
      set({ amountRecipientIndex: nextIndex, amountInput: '', isSendMax: false });
      return 'next_recipient' as const;
    }
  },

  prevAmountRecipient: () => {
    const { amountRecipientIndex } = get();
    if (amountRecipientIndex > 0) {
      set({ amountRecipientIndex: amountRecipientIndex - 1, amountInput: '', isSendMax: false });
      return 'prev_recipient' as const;
    } else {
      set({ error: null, errorLevel: null });
      return 'back_to_recipient' as const;
    }
  },

  // ── Fees ────────────────────────────────────────────────────────

  setFeeOption: (option) => {
    const { feeEstimates, customFeeRate } = get();
    const rate = option === 'custom' && customFeeRate
      ? customFeeRate
      : feeOptionToRate(option, feeEstimates);
    set({ feeOption: option, feeRate: Math.max(rate, 1) });
  },

  setCustomFeeRate: (rate) => {
    set({ customFeeRate: rate, feeOption: 'custom', feeRate: Math.max(rate, 1) });
  },

  fetchFees: async () => {
    // Cancel any pending debounced fetch
    if (fetchFeesTimer) {
      clearTimeout(fetchFeesTimer);
      fetchFeesTimer = null;
    }

    return new Promise<void>((resolve) => {
      fetchFeesTimer = setTimeout(async () => {
        fetchFeesTimer = null;
        set({ isFetchingFees: true });
        try {
          const network = useWalletStore.getState().network;
          // MempoolFeeService already has a 30s internal cache (CACHE_TTL),
          // so this won't always hit the network
          const estimates = await MempoolFeeService.fetchFees(network);
          const { feeOption, customFeeRate } = get();
          const rate = feeOption === 'custom' && customFeeRate
            ? customFeeRate
            : feeOptionToRate(feeOption, estimates);
          set({ feeEstimates: estimates, feeRate: Math.max(rate, 1), isFetchingFees: false });
        } catch {
          set({ isFetchingFees: false });
        }
        resolve();
      }, FETCH_FEES_DEBOUNCE_MS);
    });
  },

  getEffectiveFeeRate: () => {
    const { feeOption, customFeeRate, feeRate } = get();
    if (feeOption === 'custom' && customFeeRate) return Math.max(customFeeRate, 1);
    return Math.max(feeRate, 1);
  },

  // ── Advanced ────────────────────────────────────────────────────

  setSelectedUtxos: (utxos) => set({ selectedUtxos: utxos }),

  toggleRBF: () => set((s) => ({ enableRBF: !s.enableRBF })),

  setMemo: (memo) => set({ memo }),

  // ── Wallet Capability ───────────────────────────────────────────

  detectWalletCapability: () => {
    const activeWallet = useMultiWalletStore.getState().getActiveWallet();
    const capability = resolveCapability(activeWallet?.type);
    set({ walletCapability: capability });
    return capability;
  },

  // ── Transaction Building ────────────────────────────────────────

  prepareTx: async () => {
    const {
      recipients,
      feeRate,
      selectedUtxos,
      enableRBF,
      isSendMax,
      walletCapability,
    } = get();

    const { network, addresses, utxos: storeUtxos, multisigConfig } = useWalletStore.getState();

    try {
      set({ error: null, errorLevel: null });

      // When auto-selecting, exclude frozen/locked UTXOs
      let availableUtxos = selectedUtxos
        ?? useUTXOStore.getState().getAvailableUtxos(storeUtxos);

      // For multisig wallets, filter out UTXOs from non-multisig addresses
      // These addresses can't be signed by multisig cosigners and would cause finalization failure
      if (walletCapability === 'multisig' && multisigConfig) {
        availableUtxos = filterMultisigUtxos(availableUtxos, multisigConfig, network);
      }

      if (availableUtxos.length === 0) {
        throw new Error('No UTXOs available');
      }

      // Enrich legacy UTXOs with rawTxHex for signing
      availableUtxos = await enrichLegacyUtxos(availableUtxos, network);

      // Enforce minimum fee rate when spending unconfirmed UTXOs (RBF safety)
      const effectiveFeeRate = enforceRBFFeeFloor(availableUtxos, feeRate);

      // Build address → derivation path map
      const inputPaths = new Map<string, string>();
      for (const addr of addresses) {
        if (addr.path) inputPaths.set(addr.address, addr.path);
      }

      const builder = new TransactionBuilder(network);

      const validRecipients = recipients.filter((r) => r.address && r.amountSats > 0);

      if (validRecipients.length === 0 && !isSendMax) {
        throw new Error('No valid recipients');
      }

      // Change address for PSBT building
      const changeAddr = addresses.find((a) => a.path?.includes('/1/'))?.address
        || addresses[0]?.address || '';

      // For send-max, calculate how much we can send
      if (isSendMax && recipients.length === 1 && recipients[0].address) {
        const maxSendable = UTXOSelector.calculateMaxSendable(availableUtxos, effectiveFeeRate);
        if (maxSendable <= 0) throw new Error('Insufficient funds after fees');

        const result = builder.buildSendMax({
          recipientAddress: recipients[0].address,
          amount: 0,
          utxos: availableUtxos,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });

        // Store unsigned PSBT base64 for review screen
        let psbtB64: string | null = null;
        try {
          psbtB64 = result.psbt.toBase64();
        } catch { /* non-critical */ }

        set({
          preparedFee: result.info.fee,
          preparedSize: Math.ceil(result.info.fee / effectiveFeeRate),
          preparedPsbtBase64: psbtB64,
        });

        // Update the recipient amount with actual send amount
        const updated = [...recipients];
        updated[0] = { ...updated[0], amountSats: result.sendAmount };
        set({ recipients: updated });

        return { fee: result.info.fee, size: Math.ceil(result.info.fee / effectiveFeeRate) };
      }

      // Single or multi-recipient build — build full PSBT for fee + hex display
      let fee: number;
      let size: number;
      let psbtB64: string | null = null;

      if (validRecipients.length === 1) {
        const result = builder.build({
          recipientAddress: validRecipients[0].address,
          amount: validRecipients[0].amountSats,
          utxos: availableUtxos,
          changeAddress: changeAddr,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });

        fee = result.info.fee;
        size = Math.ceil(fee / effectiveFeeRate);
        try {
          psbtB64 = result.psbt.toBase64();
        } catch { /* non-critical */ }
      } else {
        const result = builder.buildMultiRecipient({
          recipients: validRecipients.map(r => ({ address: r.address, amount: r.amountSats })),
          utxos: availableUtxos,
          changeAddress: changeAddr,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });

        fee = result.info.fee;
        size = Math.ceil(fee / effectiveFeeRate);
        try {
          psbtB64 = result.psbt.toBase64();
        } catch { /* non-critical */ }
      }

      set({ preparedFee: fee, preparedSize: size, preparedPsbtBase64: psbtB64 });
      return { fee, size };
    } catch (err: any) {
      const msg = err.message || 'Transaction preparation failed';
      set({ error: msg, errorLevel: classifyErrorLevel(msg), preparedPsbtBase64: null });
      return null;
    }
  },

  // ── Sign & Broadcast ────────────────────────────────────────────

  signAndBroadcast: async (pin: string) => {
    const {
      recipients,
      feeRate,
      selectedUtxos,
      enableRBF,
      isSendMax,
    } = get();

    const walletState = useWalletStore.getState();
    // Ensure addresses are loaded (may be empty if store hasn't rehydrated from DB yet)
    if (walletState.addresses.length === 0 && walletState.walletId) {
      walletState.reloadFromDB();
    }
    const { network, addresses, utxos: storeUtxos, walletId } = useWalletStore.getState();
    const activeWallet = useMultiWalletStore.getState().getActiveWallet();

    set({ isBroadcasting: true, error: null, errorLevel: null });

    try {
      if (!walletId) throw new Error('No active wallet');

      const walletType = activeWallet?.type || 'hd';
      SyncLogger.log('send', `signAndBroadcast: walletId=${walletId}, walletType=${walletType}, network=${network}`);
      SyncLogger.log('send', `signAndBroadcast: addresses=${addresses.length}, storeUtxos=${storeUtxos.length}, selectedUtxos=${selectedUtxos?.length ?? 'auto'}`);
      SyncLogger.log('send', `signAndBroadcast: recipients=${recipients.length}, feeRate=${feeRate}, isSendMax=${isSendMax}`);

      // When auto-selecting, exclude frozen/locked UTXOs
      let availableUtxos = selectedUtxos
        ?? useUTXOStore.getState().getAvailableUtxos(storeUtxos);

      // Enrich legacy UTXOs with rawTxHex for signing
      availableUtxos = await enrichLegacyUtxos(availableUtxos, network);
      SyncLogger.log('send', `signAndBroadcast: enriched UTXOs count=${availableUtxos.length}`);

      // Enforce minimum fee rate when spending unconfirmed UTXOs (RBF safety)
      const effectiveFeeRate = enforceRBFFeeFloor(availableUtxos, feeRate);
      if (effectiveFeeRate !== feeRate) {
        SyncLogger.log('send', `signAndBroadcast: fee rate bumped for RBF safety: ${feeRate} → ${effectiveFeeRate} sat/vB`);
      }

      const builder = new TransactionBuilder(network);

      // Build address → derivation path map
      const inputPaths = new Map<string, string>();
      for (const addr of addresses) {
        if (addr.path) inputPaths.set(addr.address, addr.path);
      }
      SyncLogger.log('send', `signAndBroadcast: inputPaths map size=${inputPaths.size}`);

      // Get change address
      SyncLogger.log('send', 'signAndBroadcast: getting change address...');
      const changeAddrInfo = await walletState.getChangeAddress(pin);
      const changeAddress = changeAddrInfo?.address || addresses[0]?.address || '';
      SyncLogger.log('send', `signAndBroadcast: changeAddress=${changeAddress ? changeAddress.slice(0, 12) + '...' : 'EMPTY'}`);
      if (!changeAddress) throw new Error('No change address available');

      const validRecipients = recipients.filter((r) => r.address && r.amountSats > 0);
      SyncLogger.log('send', `signAndBroadcast: validRecipients=${validRecipients.length}, amounts=${validRecipients.map(r => r.amountSats).join(',')}`);

      let signedTx: SignedTxResult;

      if (walletType === 'imported_key' || walletType === 'imported_keys') {
        // Imported key signing
        const { SecureVault } = await import('../services/vault/SecureVault');
        const wif = await SecureVault.retrieve(walletId, 'wif', pin);
        if (!wif || typeof wif !== 'string') throw new Error('Failed to retrieve private key');

        const preferredType = walletState.preferredAddressType;
        const signer = new ImportedKeySigner(wif, preferredType, network);

        let result;
        if (isSendMax && validRecipients.length <= 1) {
          result = builder.buildSendMax({
            recipientAddress: validRecipients[0]?.address || recipients[0].address,
            amount: 0,
            utxos: availableUtxos,
            feeRate: effectiveFeeRate,
            inputPaths,
            enableRBF,
          });
        } else if (validRecipients.length === 1) {
          result = builder.build({
            recipientAddress: validRecipients[0].address,
            amount: validRecipients[0].amountSats,
            utxos: availableUtxos,
            changeAddress,
            feeRate: effectiveFeeRate,
            inputPaths,
            enableRBF,
          });
        } else {
          result = builder.buildMultiRecipient({
            recipients: validRecipients.map((r) => ({ address: r.address, amount: r.amountSats })),
            utxos: availableUtxos,
            changeAddress,
            feeRate: effectiveFeeRate,
            inputPaths,
            enableRBF,
          });
        }

        signedTx = builder.signWithImportedKey(result.psbt, signer);
      } else {
        // HD wallet signing
        SyncLogger.log('send', `signAndBroadcast: getting KeyDerivation for walletType=${walletType}...`);
        const keyDerivation = await getKeyDerivation(walletId, walletType, network, pin);
        SyncLogger.log('send', 'signAndBroadcast: KeyDerivation obtained successfully');

        try {
          let result;
          if (isSendMax && validRecipients.length <= 1) {
            SyncLogger.log('send', 'signAndBroadcast: building send-max transaction...');
            result = builder.buildSendMax({
              recipientAddress: validRecipients[0]?.address || recipients[0].address,
              amount: 0,
              utxos: availableUtxos,
              feeRate: effectiveFeeRate,
              inputPaths,
              enableRBF,
            });
          } else if (validRecipients.length === 1) {
            SyncLogger.log('send', `signAndBroadcast: building single-recipient tx, amount=${validRecipients[0].amountSats}...`);
            result = builder.build({
              recipientAddress: validRecipients[0].address,
              amount: validRecipients[0].amountSats,
              utxos: availableUtxos,
              changeAddress,
              feeRate: effectiveFeeRate,
              inputPaths,
              enableRBF,
            });
          } else {
            SyncLogger.log('send', `signAndBroadcast: building multi-recipient tx, count=${validRecipients.length}...`);
            result = builder.buildMultiRecipient({
              recipients: validRecipients.map((r) => ({ address: r.address, amount: r.amountSats })),
              utxos: availableUtxos,
              changeAddress,
              feeRate: effectiveFeeRate,
              inputPaths,
              enableRBF,
            });
          }
          SyncLogger.log('send', `signAndBroadcast: PSBT built, inputs=${result.psbt.data.inputs.length}`);

          // Collect input derivation paths — use Map for O(1) UTXO lookup
          const utxoKey = (txid: string, vout: number) => `${txid}:${vout}`;
          const utxoMap = new Map<string, UTXO>();
          for (const u of availableUtxos) {
            utxoMap.set(utxoKey(u.txid, u.vout), u);
          }

          const selectedInputs = result.psbt.data.inputs;
          const pathsList: string[] = [];
          for (let i = 0; i < selectedInputs.length; i++) {
            const txInput = result.psbt.txInputs[i];
            const txid = txInput ? Buffer.from(txInput.hash).reverse().toString('hex') : '';
            const inputUtxo = txInput ? utxoMap.get(utxoKey(txid, txInput.index)) : undefined;
            const path = inputUtxo ? inputPaths.get(inputUtxo.address) : undefined;
            pathsList.push(path || "m/84'/0'/0'/0/0");
          }
          SyncLogger.log('send', `signAndBroadcast: signing with paths=[${pathsList.join(', ')}]`);

          signedTx = await builder.signAsync(result.psbt, keyDerivation, pathsList);
          SyncLogger.log('send', `signAndBroadcast: signed OK, txid=${signedTx.txid}, hex=${signedTx.hex.length} chars`);
        } finally {
          keyDerivation.destroy();
        }
      }

      // Broadcast via mempool.space API
      SyncLogger.log('send', 'signAndBroadcast: broadcasting via mempool.space...');
      const txid = await MempoolFeeService.broadcastTransaction(signedTx.hex, network);
      SyncLogger.log('send', `signAndBroadcast: broadcast SUCCESS, txid=${txid}`);

      set({
        signedTx,
        broadcastTxid: txid,
        isBroadcasting: false,
      });

      // Trigger Electrum sync so the transaction gets saved to the database
      if (walletId) {
        WalletSyncManager.shared().onTransactionBroadcasted(walletId).catch(() => {});
      }

      return txid;
    } catch (err: any) {
      const raw = err.message || 'Transaction failed';
      const msg = humanizeBroadcastError(raw);
      SyncLogger.error('send', `signAndBroadcast FAILED: ${raw}`);
      SyncLogger.error('send', `signAndBroadcast stack: ${err?.stack?.slice(0, 500) || 'no stack'}`);
      set({
        error: msg,
        errorLevel: classifyErrorLevel(raw),
        isBroadcasting: false,
      });
      throw new Error(msg);
    }
  },

  // ── Sign Mode ──────────────────────────────────────────────────

  setSignMode: (mode: SignMode) => set({ signMode: mode }),

  // ── Sign Only (no broadcast) ─────────────────────────────────

  signOnly: async (pin: string) => {
    const {
      recipients,
      feeRate,
      selectedUtxos,
      enableRBF,
      isSendMax,
    } = get();

    const walletState = useWalletStore.getState();
    if (walletState.addresses.length === 0 && walletState.walletId) {
      walletState.reloadFromDB();
    }
    const { network, addresses, utxos: storeUtxos, walletId } = useWalletStore.getState();
    const activeWallet = useMultiWalletStore.getState().getActiveWallet();

    set({ error: null, errorLevel: null });

    try {
      if (!walletId) throw new Error('No active wallet');

      const walletType = activeWallet?.type || 'hd';
      // When auto-selecting, exclude frozen/locked UTXOs
      let availableUtxos = selectedUtxos
        ?? useUTXOStore.getState().getAvailableUtxos(storeUtxos);
      availableUtxos = await enrichLegacyUtxos(availableUtxos, network);

      // Enforce minimum fee rate when spending unconfirmed UTXOs (RBF safety)
      const effectiveFeeRate = enforceRBFFeeFloor(availableUtxos, feeRate);

      const builder = new TransactionBuilder(network);

      const inputPaths = new Map<string, string>();
      for (const addr of addresses) {
        if (addr.path) inputPaths.set(addr.address, addr.path);
      }

      const changeAddrInfo = await walletState.getChangeAddress(pin);
      const changeAddress = changeAddrInfo?.address || addresses[0]?.address || '';
      if (!changeAddress) throw new Error('No change address available');

      const validRecipients = recipients.filter((r) => r.address && r.amountSats > 0);

      let signedResult: SignedTxResult;

      if (walletType === 'imported_key' || walletType === 'imported_keys') {
        const { SecureVault } = await import('../services/vault/SecureVault');
        const wif = await SecureVault.retrieve(walletId, 'wif', pin);
        if (!wif || typeof wif !== 'string') throw new Error('Failed to retrieve private key');

        const preferredType = walletState.preferredAddressType;
        const signer = new ImportedKeySigner(wif, preferredType, network);

        let result;
        if (isSendMax && validRecipients.length <= 1) {
          result = builder.buildSendMax({ recipientAddress: validRecipients[0]?.address || recipients[0].address, amount: 0, utxos: availableUtxos, feeRate: effectiveFeeRate, inputPaths, enableRBF });
        } else if (validRecipients.length === 1) {
          result = builder.build({ recipientAddress: validRecipients[0].address, amount: validRecipients[0].amountSats, utxos: availableUtxos, changeAddress, feeRate: effectiveFeeRate, inputPaths, enableRBF });
        } else {
          result = builder.buildMultiRecipient({ recipients: validRecipients.map(r => ({ address: r.address, amount: r.amountSats })), utxos: availableUtxos, changeAddress, feeRate: effectiveFeeRate, inputPaths, enableRBF });
        }

        signedResult = builder.signWithImportedKey(result.psbt, signer);
      } else {
        const keyDerivation = await getKeyDerivation(walletId, walletType, network, pin);
        try {
          let result;
          if (isSendMax && validRecipients.length <= 1) {
            result = builder.buildSendMax({ recipientAddress: validRecipients[0]?.address || recipients[0].address, amount: 0, utxos: availableUtxos, feeRate: effectiveFeeRate, inputPaths, enableRBF });
          } else if (validRecipients.length === 1) {
            result = builder.build({ recipientAddress: validRecipients[0].address, amount: validRecipients[0].amountSats, utxos: availableUtxos, changeAddress, feeRate: effectiveFeeRate, inputPaths, enableRBF });
          } else {
            result = builder.buildMultiRecipient({ recipients: validRecipients.map(r => ({ address: r.address, amount: r.amountSats })), utxos: availableUtxos, changeAddress, feeRate: effectiveFeeRate, inputPaths, enableRBF });
          }

          const utxoKey = (txid: string, vout: number) => `${txid}:${vout}`;
          const utxoMap = new Map<string, UTXO>();
          for (const u of availableUtxos) utxoMap.set(utxoKey(u.txid, u.vout), u);

          const pathsList: string[] = [];
          for (let i = 0; i < result.psbt.data.inputs.length; i++) {
            const txInput = result.psbt.txInputs[i];
            const txid = txInput ? Buffer.from(txInput.hash).reverse().toString('hex') : '';
            const inputUtxo = txInput ? utxoMap.get(utxoKey(txid, txInput.index)) : undefined;
            const path = inputUtxo ? inputPaths.get(inputUtxo.address) : undefined;
            pathsList.push(path || "m/84'/0'/0'/0/0");
          }

          signedResult = await builder.signAsync(result.psbt, keyDerivation, pathsList);
        } finally {
          keyDerivation.destroy();
        }
      }

      // Store signed hex WITHOUT broadcasting
      set({ signedTx: signedResult, signedRawHex: signedResult.hex });
      return signedResult.hex;
    } catch (err: any) {
      const msg = err.message || 'Signing failed';
      set({ error: msg, errorLevel: classifyErrorLevel(msg) });
      throw err;
    }
  },

  // ── PSBT Export (watch-only / multisig) ─────────────────────────

  exportPSBT: async (pin?: string) => {
    const {
      recipients,
      feeRate,
      selectedUtxos,
      enableRBF,
      isSendMax,
      walletCapability,
    } = get();

    const walletState = useWalletStore.getState();
    const { network, addresses, utxos: storeUtxos, walletId, multisigConfig } = walletState;
    const activeWallet = useMultiWalletStore.getState().getActiveWallet();

    try {
      set({ error: null, errorLevel: null });
      if (__DEV__) console.log(`[exportPSBT] START — walletCapability=${walletCapability}, hasPin=${!!pin}`);
      const t0 = Date.now();

      // When auto-selecting, exclude frozen/locked UTXOs
      let availableUtxos = selectedUtxos
        ?? useUTXOStore.getState().getAvailableUtxos(storeUtxos);

      // For multisig wallets, filter out UTXOs from non-multisig addresses
      // These addresses can't be signed by multisig cosigners and would cause finalization failure
      if (walletCapability === 'multisig' && multisigConfig) {
        availableUtxos = filterMultisigUtxos(availableUtxos, multisigConfig, network);
        if (__DEV__) console.log(`[exportPSBT] After multisig UTXO filter: ${availableUtxos.length} UTXOs`);
      }

      if (availableUtxos.length === 0) {
        throw new Error('No spendable multisig UTXOs available');
      }

      // Start seed retrieval in parallel with UTXO enrichment (don't await yet)
      // This saves ~200-500ms by overlapping I/O operations
      let seedsPromise: Promise<{ index: number; seed: string }[]> | undefined;
      let globalSeedPromise: Promise<string | null> | undefined;
      if (walletCapability === 'multisig' && pin && multisigConfig) {
        seedsPromise = SecureStorage.retrieveAllLocalCosignerSeeds(pin).catch(() => []);
        globalSeedPromise = SecureStorage.retrieveSeed(pin).catch(() => null);
      }

      // Enrich legacy UTXOs with rawTxHex for signing (runs in parallel with seed retrieval)
      availableUtxos = await enrichLegacyUtxos(availableUtxos, network);
      if (__DEV__) console.log(`[exportPSBT] enrichLegacyUtxos done: ${Date.now() - t0}ms`);

      // Enforce minimum fee rate when spending unconfirmed UTXOs (RBF safety)
      const effectiveFeeRate = enforceRBFFeeFloor(availableUtxos, feeRate);

      const builder = new TransactionBuilder(network);
      const psbtService = new PSBTService(network);

      const inputPaths = new Map<string, string>();
      for (const addr of addresses) {
        if (addr.path) inputPaths.set(addr.address, addr.path);
      }

      const changeAddr = addresses.find((a) => a.path?.includes('/1/'))?.address
        || addresses[0]?.address || '';

      const validRecipients = recipients.filter((r) => r.address && r.amountSats > 0);

      let result;
      if (isSendMax && validRecipients.length <= 1) {
        result = builder.buildSendMax({
          recipientAddress: validRecipients[0]?.address || recipients[0].address,
          amount: 0,
          utxos: availableUtxos,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });
      } else if (validRecipients.length === 1) {
        result = builder.build({
          recipientAddress: validRecipients[0].address,
          amount: validRecipients[0].amountSats,
          utxos: availableUtxos,
          changeAddress: changeAddr,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });
      } else {
        result = builder.buildMultiRecipient({
          recipients: validRecipients.map((r) => ({ address: r.address, amount: r.amountSats })),
          utxos: availableUtxos,
          changeAddress: changeAddr,
          feeRate: effectiveFeeRate,
          inputPaths,
          enableRBF,
        });
      }

      // For multisig: post-process PSBT to add bip32Derivation + witnessScript metadata
      // TransactionBuilder doesn't know about multisig, so we reconstruct MultisigWallet
      // and add the required metadata to each input for proper signing.
      if (walletCapability === 'multisig' && multisigConfig) {
        try {
          // Build MultisigConfig (types/index.ts) from walletStore's MultisigConfig (walletStore.ts)
          const msWalletConfig = {
            m: multisigConfig.m,
            n: multisigConfig.n,
            scriptType: multisigConfig.scriptType as MultisigScriptType,
            cosigners: multisigConfig.cosigners.map((c, idx) => ({
              id: `cosigner_${idx}`,
              name: c.name,
              fingerprint: c.fingerprint,
              xpub: c.xpub,
              derivationPath: c.derivationPath,
              isLocal: c.isLocal,
            } as CosignerInfo)),
            derivationPath: multisigConfig.cosigners[0]?.derivationPath || `m/48'/0'/0'/2'`,
            sortedKeys: true,
          };

          const msWallet = MultisigWallet.fromConfig(msWalletConfig, network);

          const btcNetwork = network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

          // Step 1: Collect only the addresses used in PSBT inputs (typically 1-3, NOT all 190)
          // Handles both witnessUtxo (segwit) and nonWitnessUtxo (legacy/P2SH) inputs
          const inputAddresses = new Set<string>();
          for (let i = 0; i < result.psbt.inputCount; i++) {
            const input = result.psbt.data.inputs[i];
            try {
              if (input.witnessUtxo) {
                const addr = bitcoin.address.fromOutputScript(input.witnessUtxo.script, btcNetwork);
                inputAddresses.add(addr);
              } else if (input.nonWitnessUtxo) {
                const txInput = result.psbt.txInputs[i];
                const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
                const output = prevTx.outs[txInput.index];
                if (output) {
                  const addr = bitcoin.address.fromOutputScript(output.script, btcNetwork);
                  inputAddresses.add(addr);
                }
              }
            } catch {
              // Not a standard address
            }
          }
          if (__DEV__) console.log(`[exportPSBT] Multisig metadata: PSBT has ${inputAddresses.size} unique input address(es)`);

          // Step 2: For each input address, find matching multisig derivation
          // Strategy: derive multisig addresses and check if they match input addresses
          // This handles cases where walletStore has HD addresses (1.../bc1p...) mixed with
          // multisig addresses — we only add metadata for actual multisig addresses.
          const addressToMultisigInfo = new Map<string, any>();
          for (const inputAddr of inputAddresses) {
            // Use MultisigWallet.findAddress() to search for this address in multisig derivations
            // This correctly matches regardless of what path the walletStore has
            try {
              const msAddrInfo = msWallet.findAddress(inputAddr);
              if (msAddrInfo) {
                addressToMultisigInfo.set(inputAddr, msAddrInfo);
                if (__DEV__) console.log(`[exportPSBT] Multisig metadata: ${inputAddr.slice(0, 15)}... → multisig match at ${msAddrInfo.path}`);
              } else {
                if (__DEV__) console.log(`[exportPSBT] Multisig metadata: ${inputAddr.slice(0, 15)}... → NOT a multisig address (skipping metadata)`);
              }
            } catch {
              // Address not in multisig derivation range
            }
          }

          if (__DEV__) console.log(`[exportPSBT] Multisig metadata: derived ${addressToMultisigInfo.size} of ${inputAddresses.size} input address infos`);
          for (let i = 0; i < result.psbt.inputCount; i++) {
            const input = result.psbt.data.inputs[i];

            // Get the address from witnessUtxo or nonWitnessUtxo
            let inputAddress: string;
            try {
              if (input.witnessUtxo) {
                inputAddress = bitcoin.address.fromOutputScript(input.witnessUtxo.script, btcNetwork);
              } else if (input.nonWitnessUtxo) {
                const txInput = result.psbt.txInputs[i];
                const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
                const output = prevTx.outs[txInput.index];
                if (!output) continue;
                inputAddress = bitcoin.address.fromOutputScript(output.script, btcNetwork);
              } else {
                continue;
              }
            } catch {
              continue;
            }

            const msInfo = addressToMultisigInfo.get(inputAddress);
            if (!msInfo) {
              if (__DEV__) console.log(`[exportPSBT] Input ${i}: address ${inputAddress.slice(0, 20)}... not in multisig address map`);
              continue;
            }

            // Add witnessScript if present and not already set
            if (msInfo.witnessScript && !input.witnessScript) {
              result.psbt.updateInput(i, { witnessScript: msInfo.witnessScript });
              if (__DEV__) console.log(`[exportPSBT] Input ${i}: added witnessScript`);
            }

            // Add redeemScript if present and not already set
            if (msInfo.redeemScript && !input.redeemScript) {
              result.psbt.updateInput(i, { redeemScript: msInfo.redeemScript });
              if (__DEV__) console.log(`[exportPSBT] Input ${i}: added redeemScript`);
            }

            // Build and add bip32Derivation if not already present
            if (!input.bip32Derivation && msInfo.publicKeys && msInfo.pubkeyToFingerprint) {
              const bip32Derivation: Array<{ masterFingerprint: Buffer; pubkey: Buffer; path: string }> = [];
              for (const pubkey of msInfo.publicKeys) {
                const pubkeyHex = pubkey.toString('hex');
                const fp = msInfo.pubkeyToFingerprint.get(pubkeyHex);
                if (fp) {
                  bip32Derivation.push({
                    masterFingerprint: Buffer.from(fp, 'hex'),
                    pubkey: Buffer.from(pubkey),
                    path: msInfo.path,
                  });
                }
              }
              if (bip32Derivation.length > 0) {
                result.psbt.updateInput(i, { bip32Derivation });
                if (__DEV__) console.log(`[exportPSBT] Input ${i}: added bip32Derivation with ${bip32Derivation.length} entries (fingerprints: ${bip32Derivation.map(d => Buffer.from(d.masterFingerprint).toString('hex')).join(', ')})`);
              }
            }
          }
        } catch (err: any) {
          if (__DEV__) console.log(`[exportPSBT] WARNING: Failed to add multisig metadata to PSBT: ${err.message}`);
          // Non-fatal: continue without metadata (signing will still work if bip32Derivation fallback is in place)
        }
      }

      // For multisig with PIN, sign with ALL available local cosigner keys
      // Seeds were pre-fetched in parallel with UTXO enrichment above
      if (walletCapability === 'multisig' && pin && walletId && multisigConfig && seedsPromise) {
        const tSign = Date.now();
        let autoSignCount = 0;
        const signedFingerprints = new Set<string>();

        // Await both seed sources in parallel (already started above)
        const [localSeeds, globalSeed] = await Promise.all([
          seedsPromise,
          globalSeedPromise ?? Promise.resolve(null),
        ]);
        if (__DEV__) console.log(`[exportPSBT] Seeds fetched: ${localSeeds.length} local + globalSeed=${!!globalSeed} (${Date.now() - tSign}ms)`);

        // Strategy 1: Sign with local cosigner seeds
        for (const { index, seed } of localSeeds) {
          try {
            const cosignerSeed = await SeedGenerator.toSeed(seed);
            const kd = new KeyDerivation(cosignerSeed, network);
            try {
              const fp = kd.getMasterFingerprint();
              const cosigner = multisigConfig.cosigners.find(
                (c) => c.fingerprint.toUpperCase() === fp.toUpperCase()
              );
              if (cosigner) {
                psbtService.signMultisigPSBT(
                  result.psbt,
                  kd,
                  { fingerprint: fp, derivationPath: cosigner.derivationPath },
                  inputPaths as any,
                );
                autoSignCount++;
                signedFingerprints.add(fp.toUpperCase());
                if (__DEV__) console.log(`[exportPSBT] auto-signed with cosigner seed[${index}] (${fp})`);
              }
            } finally {
              kd.destroy();
            }
          } catch (err: any) {
            if (__DEV__) console.log(`[exportPSBT] cosigner seed[${index}] failed: ${err.message}`);
          }
        }

        // Strategy 2: Try global seed (already fetched in parallel)
        if (globalSeed && autoSignCount < multisigConfig.n) {
          try {
            const globalSeedBuf = await SeedGenerator.toSeed(globalSeed);
            const kd = new KeyDerivation(globalSeedBuf, network);
            try {
              const fp = kd.getMasterFingerprint();
              if (!signedFingerprints.has(fp.toUpperCase())) {
                const cosigner = multisigConfig.cosigners.find(
                  (c) => c.fingerprint.toUpperCase() === fp.toUpperCase()
                );
                if (cosigner) {
                  psbtService.signMultisigPSBT(
                    result.psbt,
                    kd,
                    { fingerprint: fp, derivationPath: cosigner.derivationPath },
                    inputPaths as any,
                  );
                  autoSignCount++;
                  if (__DEV__) console.log(`[exportPSBT] auto-signed with global seed (${fp})`);
                }
              }
            } finally {
              kd.destroy();
            }
          } catch (err: any) {
            if (__DEV__) console.log(`[exportPSBT] global seed fallback failed: ${err.message}`);
          }
        }

        if (__DEV__) console.log(`[exportPSBT] Signing done: ${autoSignCount} local keys (${Date.now() - tSign}ms)`);
      }

      const base64 = psbtService.toBase64(result.psbt);
      set({ psbtBase64: base64, psbtObject: result.psbt });

      // Update signature status for multisig wallets
      if (walletCapability === 'multisig' && multisigConfig) {
        get().updateSignatureStatus();
      }

      if (__DEV__) console.log(`[exportPSBT] DONE — total ${Date.now() - t0}ms`);
      return base64;
    } catch (err: any) {
      const msg = err.message || 'Failed to create PSBT';
      set({ error: msg, errorLevel: classifyErrorLevel(msg) });
      throw err;
    }
  },

  // ── Multisig PSBT Actions ──────────────────────────────────────

  updateSignatureStatus: () => {
    const { psbtObject } = get();
    if (!psbtObject) return;

    const { multisigConfig } = useWalletStore.getState();
    if (!multisigConfig) return;

    const network = useWalletStore.getState().network;
    const psbtService = new PSBTService(network);

    const status = psbtService.getMultisigSignatureStatus(psbtObject, {
      m: multisigConfig.m,
      n: multisigConfig.n,
      cosigners: multisigConfig.cosigners.map((c) => ({
        fingerprint: c.fingerprint,
        name: c.name,
        isLocal: c.isLocal,
      })),
    });

    set({ signatureStatus: status });
  },

  signWithLocalKeys: async (pin: string) => {
    const t0 = Date.now();
    if (__DEV__) console.log(`[signWithLocalKeys] START`);

    const { psbtObject, psbtBase64 } = get();
    if (!psbtObject) throw new Error('No PSBT available');

    const walletState = useWalletStore.getState();
    const { multisigConfig, network, addresses, walletId } = walletState;
    if (!multisigConfig || !walletId) throw new Error('No multisig config');

    const psbtService = new PSBTService(network);
    let signaturesAdded = 0;
    const signedFingerprints = new Set<string>();

    // Build address → path info map for signing
    const addressToPathMap = new Map<string, MultisigAddressPathInfo>();
    for (const addr of addresses) {
      if (addr.path) {
        addressToPathMap.set(addr.address, {
          path: addr.path,
          witnessScript: (addr as any).witnessScript ? Buffer.from((addr as any).witnessScript, 'hex') : undefined,
          redeemScript: (addr as any).redeemScript ? Buffer.from((addr as any).redeemScript, 'hex') : undefined,
        });
      }
    }

    // Fetch all seed sources in parallel (saves ~300-600ms)
    const [walletKeyResult, localSeeds, globalSeed] = await Promise.all([
      keyDerivationFromSecureStorage(walletId, 'multisig', network, pin)
        .then(kd => ({ kd, error: null as string | null }))
        .catch((err: any) => ({ kd: null as KeyDerivation | null, error: err.message as string })),
      SecureStorage.retrieveAllLocalCosignerSeeds(pin).catch(() => [] as { index: number; seed: string }[]),
      SecureStorage.retrieveSeed(pin).catch(() => null as string | null),
    ]);
    if (__DEV__) console.log(`[signWithLocalKeys] Seeds fetched: walletKey=${!!walletKeyResult.kd}, local=${localSeeds.length}, global=${!!globalSeed} (${Date.now() - t0}ms)`);

    // Strategy 1: Try the wallet's own key material from DB
    if (walletKeyResult.kd) {
      try {
        const fingerprint = walletKeyResult.kd.getMasterFingerprint();
        const cosignerConfig = multisigConfig.cosigners.find(
          (c) => c.fingerprint.toUpperCase() === fingerprint.toUpperCase()
        );
        if (cosignerConfig) {
          psbtService.signMultisigPSBT(
            psbtObject,
            walletKeyResult.kd,
            { fingerprint, derivationPath: cosignerConfig.derivationPath },
            addressToPathMap as any,
          );
          signaturesAdded++;
          signedFingerprints.add(fingerprint.toUpperCase());
          if (__DEV__) console.log(`[signWithLocalKeys] signed with wallet key (${fingerprint})`);
        }
      } finally {
        walletKeyResult.kd.destroy();
      }
    }

    // Strategy 2: Try local cosigner seeds (already fetched in parallel)
    for (const { index, seed } of localSeeds) {
      try {
        const cosignerSeed = await SeedGenerator.toSeed(seed);
        const kd = new KeyDerivation(cosignerSeed, network);
        try {
          const fingerprint = kd.getMasterFingerprint();
          if (!signedFingerprints.has(fingerprint.toUpperCase())) {
            const cosignerConfig = multisigConfig.cosigners.find(
              (c) => c.fingerprint.toUpperCase() === fingerprint.toUpperCase()
            );
            if (cosignerConfig) {
              psbtService.signMultisigPSBT(
                psbtObject,
                kd,
                { fingerprint, derivationPath: cosignerConfig.derivationPath },
                addressToPathMap as any,
              );
              signaturesAdded++;
              signedFingerprints.add(fingerprint.toUpperCase());
              if (__DEV__) console.log(`[signWithLocalKeys] signed with cosigner seed[${index}] (${fingerprint})`);
            }
          }
        } finally {
          kd.destroy();
        }
      } catch (err: any) {
        if (__DEV__) console.log(`[signWithLocalKeys] cosigner seed[${index}] failed: ${err.message}`);
      }
    }

    // Strategy 3: Try the global seed (already fetched in parallel)
    if (globalSeed) {
      try {
        const globalSeedBuf = await SeedGenerator.toSeed(globalSeed);
        const kd = new KeyDerivation(globalSeedBuf, network);
        try {
          const fingerprint = kd.getMasterFingerprint();
          if (!signedFingerprints.has(fingerprint.toUpperCase())) {
            const cosignerConfig = multisigConfig.cosigners.find(
              (c) => c.fingerprint.toUpperCase() === fingerprint.toUpperCase()
            );
            if (cosignerConfig) {
              psbtService.signMultisigPSBT(
                psbtObject,
                kd,
                { fingerprint, derivationPath: cosignerConfig.derivationPath },
                addressToPathMap as any,
              );
              signaturesAdded++;
              signedFingerprints.add(fingerprint.toUpperCase());
              if (__DEV__) console.log(`[signWithLocalKeys] signed with global seed (${fingerprint})`);
            }
          }
        } finally {
          kd.destroy();
        }
      } catch (err: any) {
        if (__DEV__) console.log(`[signWithLocalKeys] global seed failed: ${err.message}`);
      }
    }

    // Update store with new PSBT state
    if (signaturesAdded > 0) {
      const updatedBase64 = psbtService.toBase64(psbtObject);
      set({ psbtBase64: updatedBase64 });
      get().updateSignatureStatus();
    }
    if (__DEV__) console.log(`[signWithLocalKeys] DONE — ${signaturesAdded} signatures added (${Date.now() - t0}ms)`);

    SyncLogger.log('multisig', `signWithLocalKeys: total signatures added=${signaturesAdded}`);
    return signaturesAdded;
  },

  signWithSpecificCosigner: async (pin: string, targetFingerprint: string) => {
    const t0 = Date.now();
    if (__DEV__) console.log(`[signWithSpecificCosigner] START — target=${targetFingerprint}`);

    const { psbtObject } = get();
    if (!psbtObject) throw new Error('No PSBT available');

    const walletState = useWalletStore.getState();
    const { multisigConfig, network, addresses } = walletState;
    if (!multisigConfig) throw new Error('No multisig config');

    const psbtService = new PSBTService(network);

    // Build address → path info map
    const addressToPathMap = new Map<string, MultisigAddressPathInfo>();
    for (const addr of addresses) {
      if (addr.path) {
        addressToPathMap.set(addr.address, {
          path: addr.path,
          witnessScript: (addr as any).witnessScript ? Buffer.from((addr as any).witnessScript, 'hex') : undefined,
          redeemScript: (addr as any).redeemScript ? Buffer.from((addr as any).redeemScript, 'hex') : undefined,
        });
      }
    }

    // Find the cosigner config for the target fingerprint
    const cosignerConfig = multisigConfig.cosigners.find(
      (c) => c.fingerprint.toUpperCase() === targetFingerprint.toUpperCase()
    );
    if (!cosignerConfig) throw new Error(`Cosigner with fingerprint ${targetFingerprint} not found`);

    // Fetch both seed sources in parallel (saves ~200-500ms)
    const [localSeeds, globalSeed] = await Promise.all([
      SecureStorage.retrieveAllLocalCosignerSeeds(pin).catch(() => [] as { index: number; seed: string }[]),
      SecureStorage.retrieveSeed(pin).catch(() => null as string | null),
    ]);
    if (__DEV__) console.log(`[signWithSpecificCosigner] Seeds fetched: ${localSeeds.length} local + global=${!!globalSeed} (${Date.now() - t0}ms)`);

    // Helper: sign and update store
    const signAndUpdate = (kd: KeyDerivation, fp: string, source: string): boolean => {
      psbtService.signMultisigPSBT(
        psbtObject,
        kd,
        { fingerprint: fp, derivationPath: cosignerConfig.derivationPath },
        addressToPathMap as any,
      );
      const updatedBase64 = psbtService.toBase64(psbtObject);
      set({ psbtBase64: updatedBase64 });
      get().updateSignatureStatus();
      const newStatus = get().signatureStatus;
      if (__DEV__) console.log(`[signWithSpecificCosigner] ✓ SIGNED via ${source} — presentSigs=${newStatus?.presentSigs} (${Date.now() - t0}ms)`);
      return true;
    };

    // Strategy 1: Match from local cosigner seeds
    for (const { index, seed } of localSeeds) {
      try {
        const cosignerSeed = await SeedGenerator.toSeed(seed);
        const kd = new KeyDerivation(cosignerSeed, network);
        try {
          const fp = kd.getMasterFingerprint();
          if (fp.toUpperCase() === targetFingerprint.toUpperCase()) {
            return signAndUpdate(kd, fp, `seed[${index}]`);
          }
        } finally {
          kd.destroy();
        }
      } catch (err: any) {
        if (__DEV__) console.log(`[signWithSpecificCosigner] seed[${index}] failed: ${err.message}`);
      }
    }

    // Strategy 2: Try global seed (already fetched in parallel)
    if (globalSeed) {
      try {
        const globalSeedBuf = await SeedGenerator.toSeed(globalSeed);
        const kd = new KeyDerivation(globalSeedBuf, network);
        try {
          const fp = kd.getMasterFingerprint();
          if (fp.toUpperCase() === targetFingerprint.toUpperCase()) {
            return signAndUpdate(kd, fp, 'globalSeed');
          }
        } finally {
          kd.destroy();
        }
      } catch (err: any) {
        if (__DEV__) console.log(`[signWithSpecificCosigner] globalSeed failed: ${err.message}`);
      }
    }

    if (__DEV__) console.log(`[signWithSpecificCosigner] FAILED — no key for ${targetFingerprint} (${Date.now() - t0}ms)`);
    throw new Error(`No local key found for cosigner ${targetFingerprint.slice(0, 8).toUpperCase()}`);
  },

  importSignedPSBT: async (base64: string) => {
    const { psbtObject } = get();
    if (!psbtObject) return { success: false, newSignatures: 0, error: 'No PSBT available' };

    const { network, multisigConfig } = useWalletStore.getState();
    if (!multisigConfig) return { success: false, newSignatures: 0, error: 'No multisig config' };

    try {
      const psbtService = new PSBTService(network);
      const importedPsbt = psbtService.fromBase64(base64);

      // Validate: same number of inputs
      if (psbtObject.inputCount !== importedPsbt.inputCount) {
        return { success: false, newSignatures: 0, error: 'Input count mismatch — this PSBT does not match the current transaction.' };
      }

      // Validate: same txids for all inputs
      for (let i = 0; i < psbtObject.inputCount; i++) {
        const targetHash = Buffer.from(psbtObject.txInputs[i].hash);
        const sourceHash = Buffer.from(importedPsbt.txInputs[i].hash);
        if (!targetHash.equals(sourceHash)) {
          return { success: false, newSignatures: 0, error: `Input ${i} transaction ID mismatch — this PSBT is for a different transaction.` };
        }
      }

      // Merge partial signatures from imported PSBT into current
      let newSignatures = 0;
      for (let i = 0; i < importedPsbt.inputCount; i++) {
        const sourceInput = importedPsbt.data.inputs[i];
        const targetInput = psbtObject.data.inputs[i];

        if (sourceInput.partialSig) {
          for (const sig of sourceInput.partialSig) {
            const pubkeyHex = Buffer.from(sig.pubkey).toString('hex');
            const alreadyExists = targetInput.partialSig?.some(
              (s) => Buffer.from(s.pubkey).toString('hex') === pubkeyHex
            );
            if (!alreadyExists) {
              psbtObject.updateInput(i, {
                partialSig: [{ pubkey: Buffer.from(sig.pubkey), signature: Buffer.from(sig.signature) }],
              });
              newSignatures++;
            }
          }
        }

        // Also copy bip32Derivation if missing in target
        if (sourceInput.bip32Derivation && !targetInput.bip32Derivation) {
          psbtObject.updateInput(i, { bip32Derivation: sourceInput.bip32Derivation });
        }
      }

      // Update store
      const updatedBase64 = psbtService.toBase64(psbtObject);
      set({ psbtBase64: updatedBase64 });
      get().updateSignatureStatus();

      SyncLogger.log('multisig', `importSignedPSBT: merged ${newSignatures} new signatures`);
      return { success: true, newSignatures };
    } catch (err: any) {
      const msg = err.message || 'Failed to import PSBT';
      SyncLogger.error('multisig', `importSignedPSBT failed: ${msg}`);
      return { success: false, newSignatures: 0, error: msg };
    }
  },

  finalizeAndBroadcast: async () => {
    const t0 = Date.now();
    if (__DEV__) console.log(`[finalizeAndBroadcast] START`);

    const { psbtObject } = get();
    if (!psbtObject) throw new Error('No PSBT available');

    const { network, multisigConfig, walletId } = useWalletStore.getState();
    if (!multisigConfig) throw new Error('No multisig config');

    set({ isBroadcasting: true, error: null, errorLevel: null });

    try {
      const psbtService = new PSBTService(network);

      // Log detailed PSBT state before finalization
      if (__DEV__) console.log(`[finalizeAndBroadcast] PSBT: inputCount=${psbtObject.inputCount}, m=${multisigConfig.m}`);
      for (let i = 0; i < psbtObject.inputCount; i++) {
        const input = psbtObject.data.inputs[i];
        const sigs = input.partialSig?.map(s => Buffer.from(s.pubkey).toString('hex').slice(0, 8)) ?? [];
        if (__DEV__) console.log(`[finalizeAndBroadcast] Input ${i}: partialSigs=${input.partialSig?.length ?? 0} [${sigs.join(', ')}], hasWitnessScript=${!!input.witnessScript}, wsLength=${input.witnessScript?.length ?? 0}, hasRedeemScript=${!!input.redeemScript}, hasFinalWitness=${!!input.finalScriptWitness}, hasFinalScriptSig=${!!input.finalScriptSig}`);
      }

      // Verify we have enough signatures
      if (!psbtService.canFinalizeMultisig(psbtObject, multisigConfig.m)) {
        throw new Error(`Need at least ${multisigConfig.m} signatures to finalize.`);
      }
      if (__DEV__) console.log(`[finalizeAndBroadcast] canFinalize=true (${Date.now() - t0}ms)`);

      // Finalize
      const finalizeResult = psbtService.finalizeMultisig(psbtObject);
      if (__DEV__) console.log(`[finalizeAndBroadcast] finalizeResult: success=${finalizeResult.success}, error=${finalizeResult.error || 'none'} (${Date.now() - t0}ms)`);
      if (!finalizeResult.success) {
        throw new Error(finalizeResult.error || 'Failed to finalize PSBT');
      }

      // Log finalized state
      for (let i = 0; i < psbtObject.inputCount; i++) {
        const input = psbtObject.data.inputs[i];
        if (__DEV__) console.log(`[finalizeAndBroadcast] Input ${i} AFTER finalize: hasFinalWitness=${!!input.finalScriptWitness}, witnessLen=${input.finalScriptWitness?.length ?? 0}, hasFinalScriptSig=${!!input.finalScriptSig}, sigLen=${input.finalScriptSig?.length ?? 0}`);
      }

      // Extract raw transaction hex
      let tx;
      let hex: string;
      let txid: string;
      try {
        tx = psbtObject.extractTransaction();
        hex = tx.toHex();
        txid = tx.getId();
        if (__DEV__) console.log(`[finalizeAndBroadcast] extractTransaction OK: txid=${txid}, hexLen=${hex.length} (${Date.now() - t0}ms)`);
      } catch (extractErr: any) {
        if (__DEV__) console.log(`[finalizeAndBroadcast] extractTransaction FAILED: ${extractErr.message}`);
        throw new Error(`Failed to extract transaction: ${extractErr.message}`);
      }

      // Log raw hex for debugging (first/last 100 chars)
      if (__DEV__) console.log(`[finalizeAndBroadcast] rawHex start: ${hex.slice(0, 100)}...`);
      if (__DEV__) console.log(`[finalizeAndBroadcast] rawHex end: ...${hex.slice(-100)}`);

      // Broadcast via mempool.space API
      if (__DEV__) console.log(`[finalizeAndBroadcast] Broadcasting via mempool.space... (${Date.now() - t0}ms)`);
      const broadcastTxid = await MempoolFeeService.broadcastTransaction(hex, network);
      if (__DEV__) console.log(`[finalizeAndBroadcast] ✓ BROADCAST SUCCESS — txid=${broadcastTxid} (${Date.now() - t0}ms)`);

      set({
        signedTx: { hex, txid: broadcastTxid, fee: get().preparedFee || 0 },
        broadcastTxid,
        isBroadcasting: false,
      });

      // Trigger post-broadcast sync (non-blocking)
      if (walletId) {
        WalletSyncManager.shared().onTransactionBroadcasted(walletId).catch(() => {});
      }

      return broadcastTxid;
    } catch (err: any) {
      const raw = err.message || 'Finalize and broadcast failed';
      const msg = humanizeBroadcastError(raw);
      if (__DEV__) console.log(`[finalizeAndBroadcast] FAILED: ${raw} (${Date.now() - t0}ms)`);
      if (__DEV__) console.log(`[finalizeAndBroadcast] Error stack: ${err?.stack?.slice(0, 500) || 'no stack'}`);
      set({
        error: msg,
        errorLevel: classifyErrorLevel(raw),
        isBroadcasting: false,
      });
      throw new Error(msg);
    }
  },

  // ── Prefill ─────────────────────────────────────────────────────

  prefillFromParams: (params) => {
    const network = useWalletStore.getState().network;

    if (params.bip21) {
      const parsed = TransactionBuilder.parseBitcoinUri(params.bip21);
      const recipients = [{ address: parsed.address, amountSats: 0, label: parsed.label }];
      if (parsed.amount) {
        recipients[0].amountSats = Math.round(parsed.amount * 100_000_000);
      }
      set({
        recipients,
        memo: parsed.message || params.memo || '',
      });
      return;
    }

    if (params.address) {
      set({
        recipients: [{
          address: params.address,
          amountSats: params.amount ? parseInt(params.amount, 10) : 0,
        }],
        memo: params.memo || '',
      });
    }
  },

  // ── Reset ───────────────────────────────────────────────────────

  reset: () => {
    rawTxHexCache.clear(); // Clear cached raw tx hex from previous send flow
    const settings = useSettingsStore.getState();
    const lastUnit = settings.lastInputUnit as InputUnit | null;
    set({ ...DEFAULT_STATE, inputUnit: lastUnit || settings.denomination });
  },
}));
