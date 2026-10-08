// Invoice extras: PO number, custom tax name, tax-inclusive pricing, shipping,
// and amount paid -> balance due. Kept separate from the core invoice model so
// templates and history (which use the core serializer) keep working unchanged.

import {
  computeTotals,
  parseCents,
  parsePct,
  formatMoney,
  type InvoiceData,
} from './invoice-core.ts';

export const INVOICE_EXTRAS_KEY = 'truepdf.invoice-generator.extras.v1';

export interface InvoiceExtras {
  /** Purchase-order number shown next to the invoice number. */
  poNumber: string;
  /** Label for the tax row, e.g. "VAT" or "GST". Blank falls back to "Tax". */
  taxName: string;
  /** When true, line-item prices already include tax (tax is backed out). */
  taxInclusive: boolean;
  /** Shipping / delivery charge, as typed. */
  shipping: string;
  /** Amount the client already paid, as typed. */
  paid: string;
}

export function blankInvoiceExtras(): InvoiceExtras {
  return { poNumber: '', taxName: '', taxInclusive: false, shipping: '', paid: '' };
}

export function serializeExtras(e: InvoiceExtras): string {
  return JSON.stringify({
    poNumber: e.poNumber.slice(0, 60),
    taxName: e.taxName.slice(0, 24),
    taxInclusive: e.taxInclusive === true,
    shipping: e.shipping.slice(0, 32),
    paid: e.paid.slice(0, 32),
  });
}

export function deserializeExtras(raw: string | null | undefined): InvoiceExtras {
  const blank = blankInvoiceExtras();
  if (!raw) return blank;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object') return blank;
    return {
      poNumber: typeof p.poNumber === 'string' ? p.poNumber.slice(0, 60) : '',
      taxName: typeof p.taxName === 'string' ? p.taxName.slice(0, 24) : '',
      taxInclusive: p.taxInclusive === true,
      shipping: typeof p.shipping === 'string' ? p.shipping.slice(0, 32) : '',
      paid: typeof p.paid === 'string' ? p.paid.slice(0, 32) : '',
    };
  } catch {
    return blank;
  }
}

export interface ExtrasTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxLabel: string;
  taxInclusive: boolean;
  shippingCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
}

/** Full totals with the extras folded in. All money stays in integer cents. */
export function computeExtrasTotals(inv: InvoiceData, ex: InvoiceExtras): ExtrasTotals {
  const base = computeTotals({ ...inv, taxPct: '0' });
  const rate = parsePct(inv.taxPct);
  let taxCents = 0;
  if (rate > 0) {
    if (ex.taxInclusive) {
      // Prices already include tax: back the tax out of the discounted total.
      const gross = base.taxableCents;
      taxCents = gross - Math.round(gross / (1 + rate / 100));
    } else {
      taxCents = Math.round((base.taxableCents * rate) / 100);
    }
  }
  const shippingCents = Math.max(0, parseCents(ex.shipping));
  // Tax-inclusive: the line total already contains the tax, so it is only
  // backed out for display — never added on top again.
  const totalCents = ex.taxInclusive
    ? base.taxableCents + shippingCents
    : base.taxableCents + taxCents + shippingCents;
  const paidCents = Math.min(Math.max(0, parseCents(ex.paid)), totalCents);
  return {
    subtotalCents: base.subtotalCents,
    discountCents: base.discountCents,
    taxCents,
    taxLabel: ex.taxName.trim() || 'Tax',
    taxInclusive: ex.taxInclusive,
    shippingCents,
    totalCents,
    paidCents,
    balanceCents: totalCents - paidCents,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Replace the core-rendered totals block with one that includes the extras.
 * Finds <div class="inv-totals"> and swaps everything up to its matching
 * closing tag using a balanced div scan, so core markup changes to the rows
 * inside do not break the splice.
 */
export function applyExtrasToPreview(html: string, inv: InvoiceData, ex: InvoiceExtras): string {
  let out = html;

  // PO number: insert a row right after the invoice-number meta row.
  const po = ex.poNumber.trim();
  if (po) {
    const anchor = '<span class="inv-meta-k">Invoice number</span>';
    const ai = out.indexOf(anchor);
    if (ai >= 0) {
      const rowEnd = out.indexOf('</div>', ai);
      if (rowEnd >= 0) {
        const insertAt = rowEnd + '</div>'.length;
        out =
          out.slice(0, insertAt) +
          `<div class="inv-meta-row"><span class="inv-meta-k">PO number</span><span class="inv-meta-v">${esc(po)}</span></div>` +
          out.slice(insertAt);
      }
    }
  }

  const t = computeExtrasTotals(inv, ex);
  const cur = inv.currency;
  const rows: string[] = [
    `<div class="inv-trow"><span>Subtotal</span><span>${formatMoney(t.subtotalCents, cur)}</span></div>`,
  ];
  if (t.discountCents > 0) {
    const label = inv.discountType === 'percent' ? `Discount (${esc(inv.discountValue.trim())}%)` : 'Discount';
    rows.push(`<div class="inv-trow"><span>${label}</span><span>−${formatMoney(t.discountCents, cur)}</span></div>`);
  }
  if (t.taxCents > 0 || inv.taxPct.trim() !== '') {
    const pct = inv.taxPct.trim() !== '' ? ` (${esc(inv.taxPct.trim())}%)` : '';
    const incl = t.taxInclusive ? ' <span class="inv-empty-line">incl.</span>' : '';
    rows.push(
      `<div class="inv-trow"><span>${esc(t.taxLabel)}${pct}${incl}</span><span>${formatMoney(t.taxCents, cur)}</span></div>`
    );
  }
  if (t.shippingCents > 0) {
    rows.push(`<div class="inv-trow"><span>Shipping</span><span>${formatMoney(t.shippingCents, cur)}</span></div>`);
  }
  rows.push(`<div class="inv-trow inv-total"><span>Amount due</span><span>${formatMoney(t.totalCents, cur)}</span></div>`);
  if (t.paidCents > 0) {
    rows.push(`<div class="inv-trow"><span>Paid</span><span>−${formatMoney(t.paidCents, cur)}</span></div>`);
    rows.push(
      `<div class="inv-trow inv-total"><span>Balance due</span><span>${formatMoney(t.balanceCents, cur)}</span></div>`
    );
  }

  const open = '<div class="inv-totals">';
  const start = out.indexOf(open);
  if (start < 0) return out;
  const tagRe = /<\/?div\b[^>]*>/g;
  tagRe.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(out)) !== null) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      const end = m.index + m[0].length;
      return out.slice(0, start) + open + rows.join('') + out.slice(end);
    }
  }
  return out;
}
