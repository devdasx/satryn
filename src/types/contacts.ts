/**
 * Contact & Address Book Types
 * Premium beneficiary manager data model
 */

// === Contact Address (one contact can have many) ===
export interface ContactAddress {
  id: string;
  label?: string;
  address: string;
  network?: 'mainnet' | 'testnet';
  isDefault: boolean;
  createdAt: number;
  updatedAt?: number;
}

// === Contact (replaces legacy AddressBookEntry) ===
export interface Contact {
  id: string;
  name: string;
  tags: string[];
  notes?: string;
  isFavorite: boolean;
  color?: string;
  addresses: ContactAddress[];
  createdAt: number;
  updatedAt: number;
}

// === Computed Stats (ephemeral, not persisted) ===
export interface ContactStats {
  contactId: string;
  outgoingTxCount: number;
  incomingTxCount: number;
  totalSentSats: number;
  totalReceivedSats: number;
  lastActivityTimestamp: number | null;
  monthlyActivity: MonthlyActivity[];
}

export interface MonthlyActivity {
  month: string; // "2026-01"
  sentSats: number;
  receivedSats: number;
  txCount: number;
}

// === Deep Link Payload ===
export interface PaymentLinkPayload {
  v: 1;
  action: 'send';
  recipients: PaymentLinkRecipient[];
  memo?: string;
  createdAt: number;
  contactName?: string; // Display hint only, never trusted
}

export interface PaymentLinkRecipient {
  address: string;
  amountSats?: number;
}

// === Send Prefill Data ===
export interface SendPrefillData {
  recipients: Array<{
    address: string;
    amountSats?: number;
  }>;
  memo?: string;
  source: 'contact' | 'deeplink' | 'nearby';
}
