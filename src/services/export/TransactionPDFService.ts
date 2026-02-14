/**
 * TransactionPDFService — Generates PDF exports for transactions and addresses
 *
 * Uses expo-print (HTML → PDF) + expo-sharing to share the generated file.
 * Requires a development/production build — expo-print native module is not available in Expo Go.
 */

/**
 * Generate PDF from HTML and share it.
 * Uses lazy require() so expo-print/expo-sharing are only loaded when PDF export
 * is actually attempted — not at module load time. This prevents the app from
 * crashing if the native ExpoPrint module is not linked.
 */
async function generateAndSharePDF(html: string): Promise<void> {
  let Print: any;
  let Sharing: any;
  try {
    Print = require('expo-print');
    Sharing = require('expo-sharing');
  } catch {
    throw new Error('PDF export requires a development build. It is not available in Expo Go.');
  }
  try {
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('native module') || msg.includes('ExpoPrint') || msg.includes('not found')) {
      throw new Error('PDF export requires a development build. It is not available in Expo Go.');
    }
    throw error;
  }
}
import { FORMATTING } from '../../constants';
import type { DetailedTransactionInfo, AddressInfo } from '../../types';

const satsToBtc = (sats: number): string =>
  (sats / FORMATTING.SATS_PER_BTC).toFixed(FORMATTING.BTC_DECIMALS);

const formatDate = (timestamp: number): string => {
  if (!timestamp) return 'Pending';
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const baseStyles = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 40px; color: #1a1a1a; font-size: 12px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #f5f5f5; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e0e0e0; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; font-size: 11px; word-break: break-all; }
  tr:nth-child(even) { background: #fafafa; }
  .amount-in { color: #4CAF50; }
  .amount-out { color: #F44336; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .badge-confirmed { background: #e8f5e9; color: #2e7d32; }
  .badge-pending { background: #fff3e0; color: #e65100; }
  .badge-used { background: #e3f2fd; color: #1565c0; }
  .badge-unused { background: #f3e5f5; color: #7b1fa2; }
  .badge-change { background: #fce4ec; color: #c62828; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; color: #999; font-size: 10px; }
  .mono { font-family: 'Courier New', monospace; font-size: 10px; }
`;

/**
 * Export a single transaction as a PDF and share it
 */
export async function exportTransactionPDF(
  tx: DetailedTransactionInfo,
  walletName: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  label?: string,
): Promise<void> {
  const mempoolBase = network === 'testnet' ? 'https://mempool.space/testnet' : 'https://mempool.space';
  const txUrl = `${mempoolBase}/tx/${tx.txid}`;

  const inputRows = tx.inputs.map(inp => `
    <tr>
      <td class="mono">${escapeHtml(inp.address || 'Unknown')}</td>
      <td>${satsToBtc(inp.value)} BTC</td>
    </tr>
  `).join('');

  const outputRows = tx.outputs.map(out => `
    <tr>
      <td class="mono">${escapeHtml(out.address || 'OP_RETURN')}</td>
      <td>${satsToBtc(out.value)} BTC</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
    <h1>Transaction Details</h1>
    <p class="subtitle">${walletName} &mdash; ${network}</p>

    <table>
      <tr><td style="width:120px;font-weight:600">TXID</td><td class="mono">${tx.txid}</td></tr>
      <tr><td style="font-weight:600">Date</td><td>${formatDate(tx.blockTime)}</td></tr>
      <tr><td style="font-weight:600">Type</td><td>${tx.type === 'incoming' ? 'Received' : 'Sent'}</td></tr>
      <tr><td style="font-weight:600">Amount</td><td class="${tx.balanceDiff >= 0 ? 'amount-in' : 'amount-out'}">${tx.balanceDiff >= 0 ? '+' : ''}${satsToBtc(tx.balanceDiff)} BTC (${Math.abs(tx.balanceDiff).toLocaleString()} SATS)</td></tr>
      <tr><td style="font-weight:600">Status</td><td><span class="badge ${tx.confirmed ? 'badge-confirmed' : 'badge-pending'}">${tx.confirmed ? `Confirmed (${tx.confirmations})` : 'Pending'}</span></td></tr>
      <tr><td style="font-weight:600">Fee</td><td>${tx.fee.toLocaleString()} SATS (${tx.feeRate.toFixed(1)} sat/vB)</td></tr>
      <tr><td style="font-weight:600">Size</td><td>${tx.vsize} vBytes</td></tr>
      ${tx.height > 0 ? `<tr><td style="font-weight:600">Block</td><td>#${tx.height.toLocaleString()}</td></tr>` : ''}
      ${label ? `<tr><td style="font-weight:600">Note</td><td>${escapeHtml(label)}</td></tr>` : ''}
      <tr><td style="font-weight:600">Mempool</td><td><a href="${txUrl}">${txUrl}</a></td></tr>
    </table>

    <h2 style="margin-top:24px;font-size:14px">Inputs (${tx.inputs.length})</h2>
    <table><tr><th>Address</th><th>Amount</th></tr>${inputRows}</table>

    <h2 style="margin-top:24px;font-size:14px">Outputs (${tx.outputs.length})</h2>
    <table><tr><th>Address</th><th>Amount</th></tr>${outputRows}</table>

    <div class="footer">Generated by Bitcoin Wallet &mdash; ${new Date().toLocaleString()}</div>
  </body></html>`;

  await generateAndSharePDF(html);
}

/**
 * Export all transactions as a PDF table and share it
 */
export async function exportAllTransactionsPDF(
  transactions: DetailedTransactionInfo[],
  walletName: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  labels?: Record<string, { label?: string; note?: string }>,
): Promise<void> {
  const sorted = [...transactions].sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

  const rows = sorted.map(tx => {
    const txLabel = labels?.[tx.txid];
    const note = txLabel?.note || txLabel?.label || '';
    return `
      <tr>
        <td>${formatDate(tx.blockTime)}</td>
        <td>${tx.type === 'incoming' ? 'Received' : 'Sent'}</td>
        <td class="${tx.balanceDiff >= 0 ? 'amount-in' : 'amount-out'}">${tx.balanceDiff >= 0 ? '+' : ''}${satsToBtc(tx.balanceDiff)}</td>
        <td>${tx.fee.toLocaleString()}</td>
        <td><span class="badge ${tx.confirmed ? 'badge-confirmed' : 'badge-pending'}">${tx.confirmed ? 'Confirmed' : 'Pending'}</span></td>
        <td class="mono" style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${tx.txid.slice(0, 16)}...</td>
        <td>${escapeHtml(note)}</td>
      </tr>
    `;
  }).join('');

  const totalIn = sorted.filter(t => t.balanceDiff > 0).reduce((s, t) => s + t.balanceDiff, 0);
  const totalOut = sorted.filter(t => t.balanceDiff < 0).reduce((s, t) => s + Math.abs(t.balanceDiff), 0);
  const totalFees = sorted.reduce((s, t) => s + t.fee, 0);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
    <h1>Transaction History</h1>
    <p class="subtitle">${walletName} &mdash; ${network} &mdash; ${sorted.length} transactions</p>

    <div style="display:flex;gap:24px;margin-bottom:16px">
      <div><strong>Total Received:</strong> <span class="amount-in">${satsToBtc(totalIn)} BTC</span></div>
      <div><strong>Total Sent:</strong> <span class="amount-out">${satsToBtc(totalOut)} BTC</span></div>
      <div><strong>Total Fees:</strong> ${totalFees.toLocaleString()} SATS</div>
    </div>

    <table>
      <tr><th>Date</th><th>Type</th><th>Amount (BTC)</th><th>Fee (SATS)</th><th>Status</th><th>TXID</th><th>Note</th></tr>
      ${rows}
    </table>

    <div class="footer">Generated by Bitcoin Wallet &mdash; ${new Date().toLocaleString()}</div>
  </body></html>`;

  await generateAndSharePDF(html);
}

/**
 * Export all addresses as a PDF table and share it
 */
export async function exportAllAddressesPDF(
  addresses: AddressInfo[],
  usedAddresses: Set<string>,
  walletName: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<void> {
  // Separate receiving from change, sort by type then index
  const receiving = addresses.filter(a => !a.isChange).sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index);
  const change = addresses.filter(a => a.isChange).sort((a, b) => a.type.localeCompare(b.type) || a.index - b.index);

  const makeRows = (addrs: AddressInfo[]) => addrs.map(a => {
    const used = usedAddresses.has(a.address);
    return `
      <tr>
        <td class="mono">${escapeHtml(a.address)}</td>
        <td>${a.type}</td>
        <td class="mono">${escapeHtml(a.path)}</td>
        <td>${a.index}</td>
        <td><span class="badge ${used ? 'badge-used' : 'badge-unused'}">${used ? 'Used' : 'Unused'}</span></td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}
    @page { size: landscape; }
  </style></head><body>
    <h1>Address List</h1>
    <p class="subtitle">${walletName} &mdash; ${network} &mdash; ${addresses.length} addresses</p>

    <h2 style="font-size:14px;margin-top:16px">Receiving Addresses (${receiving.length})</h2>
    <table>
      <tr><th>Address</th><th>Type</th><th>Derivation Path</th><th>Index</th><th>Status</th></tr>
      ${makeRows(receiving)}
    </table>

    <h2 style="font-size:14px;margin-top:24px">Change Addresses (${change.length})</h2>
    <table>
      <tr><th>Address</th><th>Type</th><th>Derivation Path</th><th>Index</th><th>Status</th></tr>
      ${makeRows(change)}
    </table>

    <div class="footer">Generated by Bitcoin Wallet &mdash; ${new Date().toLocaleString()}</div>
  </body></html>`;

  await generateAndSharePDF(html);
}
