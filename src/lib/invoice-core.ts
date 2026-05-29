// Pure invoice-builder logic shared by the browser tool and the Node verification script.
// No DOM access here — everything is data in, data/HTML strings out.
// Money is handled in integer cents throughout; no floating-point math touches totals.

export const INVOICE_SCHEMA_VERSION = 1;
export const INVOICE_STORAGE_KEY = 'freekit.invoice-generator.v1';
export const INVOICE_NUMBER_KEY = 'freekit.invoice-generator.number';
export const INVOICE_HISTORY_KEY = 'freekit.invoice-generator.history.v1';
export const MAX_HISTORY = 50;

export interface InvoiceLineItem {
  id: string;
  description: string;
  qty: number;
  rate: string; // dollars as typed, e.g. "19.99"
}

export interface BusinessInfo {
  name: string;
  address: string;
  email: string;
  phone: string;
  logoDataUrl: string; // data:image/... or empty
}

export interface ClientInfo {
  name: string;
  address: string;
  email: string;
}

export type DiscountType = 'percent' | 'flat';

export interface InvoiceData {
  version: number;
  business: BusinessInfo;
  client: ClientInfo;
  number: string;
  issueDate: string; // YYYY-MM-DD or empty
  dueDate: string; // YYYY-MM-DD or empty
  items: InvoiceLineItem[];
  taxPct: string; // e.g. "8.5"
  discountType: DiscountType;
  discountValue: string; // percent or dollars as typed
  currency: string; // ISO 4217 code, e.g. "USD"
  notes: string;
  updatedAt: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
}

let idCounter = 0;
/** Unique-enough id for a new entry. Not a UUID; collisions across sessions don't matter here. */
export function newId(): string {
  idCounter += 1;
  return `i${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function blankBusiness(): BusinessInfo {
  return { name: '', address: '', email: '', phone: '', logoDataUrl: '' };
}

export function blankClient(): ClientInfo {
  return { name: '', address: '', email: '' };
}

export function blankLineItem(): InvoiceLineItem {
  return { id: newId(), description: '', qty: 1, rate: '' };
}

/** A fresh, empty invoice. */
export function blankInvoice(): InvoiceData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    version: INVOICE_SCHEMA_VERSION,
    business: blankBusiness(),
    client: blankClient(),
    number: '',
    issueDate: today,
    dueDate: '',
    items: [blankLineItem()],
    taxPct: '',
    discountType: 'percent',
    discountValue: '',
    currency: 'USD',
    notes: '',
    updatedAt: Date.now(),
  };
}

/** Sample content so people can see the invoice before typing a word. */
export function exampleInvoice(): InvoiceData {
  return {
    version: INVOICE_SCHEMA_VERSION,
    business: {
      name: 'Rivera Design Studio',
      address: '418 Harbor Ave, Suite 12\nSan Francisco, CA 94123',
      email: 'billing@riveradesign.example',
      phone: '(415) 555-0132',
      logoDataUrl: '',
    },
    client: {
      name: 'Northwind Mobile, Inc.',
      address: '900 Market Street\nSan Francisco, CA 94103',
      email: 'accounts@northwind.example',
    },
    number: 'INV-0007',
    issueDate: '2026-09-23',
    dueDate: '2026-10-07',
    items: [
      { id: newId(), description: 'Onboarding flow redesign (38 hrs)', qty: 38, rate: '95.00' },
      { id: newId(), description: 'Design system components', qty: 1, rate: '1200.00' },
      { id: newId(), description: 'Usability testing sessions', qty: 6, rate: '150.00' },
    ],
    taxPct: '8.5',
    discountType: 'percent',
    discountValue: '5',
    currency: 'USD',
    notes: 'Payment due within 14 days. Late payments incur a 1.5% monthly fee.',
    updatedAt: Date.now(),
  };
}

// ---------- money math (integer cents) ----------

/**
 * Parse a typed money string to integer cents. Tolerates currency symbols,
 * thousands separators, and both "1,234.56" and "1.234,56" styles.
 * Garbage or empties parse to 0. Rounds to the cent.
 */
export function parseCents(input: string | number | null | undefined): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : 0;
  }
  if (input === null || input === undefined) return 0;
  let s = String(input).trim();
  if (s === '') return 0;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.,]/g, '');
  if (s === '') return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart = s;
  let fracRaw = '';
  if (lastDot > lastComma) {
    intPart = s.slice(0, lastDot).replace(/[.,]/g, '');
    fracRaw = s.slice(lastDot + 1).replace(/[.,]/g, '');
  } else if (lastComma > lastDot) {
    intPart = s.slice(0, lastComma).replace(/[.,]/g, '');
    fracRaw = s.slice(lastComma + 1).replace(/[.,]/g, '');
  } else {
    intPart = s.replace(/[.,]/g, '');
  }
  const intCents = (intPart === '' ? 0 : parseInt(intPart, 10) || 0) * 100;
  const fracCents = Math.round((parseInt((fracRaw + '000').slice(0, 3), 10) || 0) / 10);
  return neg ? -(intCents + fracCents) : intCents + fracCents;
}

/** Parse a quantity; non-numeric or negative input becomes 0. */
export function parseQty(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : 0;
  if (input === null || input === undefined) return 0;
  const n = parseFloat(String(input).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Line amount in cents: round(qty * rateCents). */
export function lineTotalCents(qty: number, rateCents: number): number {
  return Math.round(qty * rateCents);
}

/** Parse a percent string like "8.5" or "8.5%"; garbage becomes 0. */
export function parsePct(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input === null || input === undefined) return 0;
  const n = parseFloat(String(input).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Full invoice totals, all in integer cents.
 * Discount (percent or flat) applies to the subtotal first; tax applies to the
 * discounted amount. Discount is clamped so it can never push totals negative.
 */
export function computeTotals(inv: InvoiceData): InvoiceTotals {
  const subtotalCents = inv.items.reduce(
    (sum, item) => sum + lineTotalCents(parseQty(item.qty), parseCents(item.rate)),
    0
  );
  let discountCents = 0;
  if (inv.discountType === 'percent') {
    const pct = parsePct(inv.discountValue);
    if (pct > 0) discountCents = Math.round((subtotalCents * pct) / 100);
  } else {
    discountCents = parseCents(inv.discountValue);
  }
  if (discountCents < 0) discountCents = 0;
  if (discountCents > subtotalCents) discountCents = subtotalCents;
  const taxableCents = subtotalCents - discountCents;
  const taxPct = parsePct(inv.taxPct);
  const taxCents = taxPct > 0 ? Math.round((taxableCents * taxPct) / 100) : 0;
  return {
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

// ---------- currencies ----------

export interface CurrencyOption {
  code: string;
  name: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
];

export function isCurrencyCode(v: unknown): v is string {
  return typeof v === 'string' && CURRENCIES.some((c) => c.code === v.toUpperCase());
}

/**
 * Format integer cents as a money string. Uses Intl so JPY-style zero-decimal
 * currencies render correctly. Falls back to USD for unknown codes.
 */
export function formatMoney(cents: number, currency: string): string {
  const code = isCurrencyCode(currency) ? currency.toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }
}

/** Format a YYYY-MM-DD date for the invoice document. Invalid input passes through as-is. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso.trim();
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

// ---------- invoice-number sequencing ----------

/**
 * Suggest the next invoice number after `last`. Preserves any prefix and
 * zero-padding: "INV-0042" -> "INV-0043", "100" -> "101".
 * Empty or non-numeric input starts a fresh sequence.
 */
export function nextInvoiceNumber(last: string | null | undefined): string {
  const m = /^(.*?)(\d+)([^\d]*)$/.exec(String(last ?? '').trim());
  if (!m) return 'INV-0001';
  const prefix = m[1];
  const digits = m[2];
  const suffix = m[3];
  const n = parseInt(digits, 10) + 1;
  return `${prefix}${String(n).padStart(digits.length, '0')}${suffix}`;
}

// ---------- validation: the minimum an invoice needs before export ----------

/**
 * Check the fields an exported invoice needs. Returns human-readable messages;
 * an empty array means the invoice is ready to export.
 */
export function validateInvoice(inv: InvoiceData): string[] {
  const problems: string[] = [];
  if (!inv.business.name.trim()) {
    problems.push('Add your business name so the invoice says who it is from.');
  }
  if (!inv.number.trim()) {
    problems.push('Add an invoice number.');
  }
  const usable = inv.items.filter((i) => i.description.trim() && parseQty(i.qty) > 0 && parseCents(i.rate) > 0);
  if (usable.length === 0) {
    problems.push('Add at least one line item with a description, quantity, and rate.');
  }
  const taxRaw = inv.taxPct.trim();
  if (taxRaw !== '' && !/^-?\d+(\.\d+)?%?$/.test(taxRaw)) {
    problems.push('The tax rate must be a plain number like 8.5.');
  }
  const discRaw = inv.discountValue.trim();
  if (discRaw !== '') {
    if (inv.discountType === 'percent' && !/^-?\d+(\.\d+)?%?$/.test(discRaw)) {
      problems.push('The discount must be a plain number like 10.');
    } else if (inv.discountType === 'flat' && parseCents(discRaw) <= 0) {
      problems.push('The discount amount must be a money value greater than zero.');
    }
  }
  if (inv.issueDate.trim() && inv.dueDate.trim() && inv.dueDate < inv.issueDate) {
    problems.push('The due date is before the issue date.');
  }
  return problems;
}

// ---------- pure entry list operations (never mutate the input) ----------

export function addItem(items: InvoiceLineItem[], item: InvoiceLineItem): InvoiceLineItem[] {
  return [...items, item];
}

export function removeItem(items: InvoiceLineItem[], id: string): InvoiceLineItem[] {
  return items.filter((e) => e.id !== id);
}

/** Move the item with the given id one step up (-1) or down (+1). Out-of-range moves are no-ops. */
export function moveItem(items: InvoiceLineItem[], id: string, direction: -1 | 1): InvoiceLineItem[] {
  const i = items.findIndex((e) => e.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  next[i] = items[j];
  next[j] = items[i];
  return next;
}

// ---------- serialization with schema versioning ----------

export function serializeInvoice(inv: InvoiceData): string {
  return JSON.stringify({ ...inv, version: INVOICE_SCHEMA_VERSION });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asQty(v: unknown): number {
  return parseQty(v as string | number);
}

function validId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : newId();
}

function validDataUrl(v: unknown): string {
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

/**
 * Parse saved JSON back into an InvoiceData. Anything corrupt, foreign, or from a
 * different schema version falls back to a blank invoice instead of throwing.
 */
export function deserializeInvoice(raw: string | null | undefined): InvoiceData {
  const blank = blankInvoice();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== INVOICE_SCHEMA_VERSION) {
    return blank; // wrong shape or schema version
  }
  const p = parsed as Record<string, unknown>;
  const business = (p.business ?? {}) as Record<string, unknown>;
  const client = (p.client ?? {}) as Record<string, unknown>;
  const itemsRaw = p.items;
  const items: InvoiceLineItem[] = Array.isArray(itemsRaw)
    ? (itemsRaw as unknown[])
        .filter((e) => e && typeof e === 'object')
        .map((e) => {
          const o = e as Record<string, unknown>;
          return {
            id: validId(o.id),
            description: asString(o.description),
            qty: asQty(o.qty),
            rate: asString(o.rate),
          };
        })
    : [];
  const discountType = p.discountType === 'flat' ? 'flat' : 'percent';
  const currency = isCurrencyCode(p.currency) ? String(p.currency).toUpperCase() : 'USD';
  return {
    version: INVOICE_SCHEMA_VERSION,
    business: {
      name: asString(business.name),
      address: asString(business.address),
      email: asString(business.email),
      phone: asString(business.phone),
      logoDataUrl: validDataUrl(business.logoDataUrl),
    },
    client: {
      name: asString(client.name),
      address: asString(client.address),
      email: asString(client.email),
    },
    number: asString(p.number),
    issueDate: asString(p.issueDate),
    dueDate: asString(p.dueDate),
    items: items.length > 0 ? items : [blankLineItem()],
    taxPct: asString(p.taxPct),
    discountType,
    discountValue: asString(p.discountValue),
    currency,
    notes: asString(p.notes),
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
  };
}

/** History list operations: newest first, capped, replaced by invoice number. */
export function upsertHistory(history: InvoiceData[], inv: InvoiceData): InvoiceData[] {
  const without = history.filter((h) => h.number !== inv.number);
  return [{ ...inv, updatedAt: Date.now() }, ...without].slice(0, MAX_HISTORY);
}

export function removeFromHistory(history: InvoiceData[], number: string): InvoiceData[] {
  return history.filter((h) => h.number !== number);
}

// ---------- document HTML rendering (pure string building; the page supplies the CSS) ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function multiline(s: string): string {
  return esc(s.trim()).replace(/\n/g, '<br>');
}

/**
 * Render the whole invoice as an HTML string. Empty sections are skipped.
 * All user content is escaped; the logo is embedded only if it is an image data URL.
 */
export function renderInvoice(inv: InvoiceData): string {
  const t = computeTotals(inv);
  const cur = inv.currency;
  const b = inv.business;
  const c = inv.client;

  const logo = validDataUrl(b.logoDataUrl)
    ? `<img class="inv-logo" src="${esc(b.logoDataUrl)}" alt="Business logo" />`
    : '';
  const bizMeta = [b.address.trim(), b.email.trim(), b.phone.trim()]
    .filter((s) => s.length > 0)
    .map((s) => (s.includes('\n') ? multiline(s) : esc(s)))
    .join('<br>');
  const clientMeta = [c.address.trim(), c.email.trim()].filter((s) => s.length > 0);
  const clientBlock = [
    c.name.trim() ? `<div class="inv-client-name">${esc(c.name.trim())}</div>` : '',
    ...clientMeta.map((s) => `<div class="inv-client-line">${s.includes('\n') ? multiline(s) : esc(s)}</div>`),
  ].join('');

  const metaRows = [
    ['Invoice number', inv.number.trim() || '—'],
    ['Issue date', inv.issueDate.trim() ? formatDate(inv.issueDate) : '—'],
    ['Due date', inv.dueDate.trim() ? formatDate(inv.dueDate) : '—'],
  ];
  const metaRowsHtml = metaRows
    .map(([k, v]) => `<div class="inv-meta-row"><span class="inv-meta-k">${esc(k)}</span><span class="inv-meta-v">${esc(v)}</span></div>`)
    .join('');

  const itemRows = inv.items
    .map((item, i) => {
      const qty = parseQty(item.qty);
      const rateCents = parseCents(item.rate);
      const amount = lineTotalCents(qty, rateCents);
      const desc = item.description.trim()
        ? esc(item.description.trim())
        : `<span class="inv-empty-line">Line item ${i + 1}</span>`;
      return `<tr class="inv-row">
        <td class="inv-desc">${desc}</td>
        <td class="inv-num">${qty || ''}</td>
        <td class="inv-num">${rateCents ? formatMoney(rateCents, cur) : ''}</td>
        <td class="inv-num inv-amount">${formatMoney(amount, cur)}</td>
      </tr>`;
    })
    .join('');

  const totalRows: string[] = [
    `<div class="inv-trow"><span>Subtotal</span><span>${formatMoney(t.subtotalCents, cur)}</span></div>`,
  ];
  if (t.discountCents > 0) {
    const label = inv.discountType === 'percent' ? `Discount (${esc(inv.discountValue.trim())}%)` : 'Discount';
    totalRows.push(`<div class="inv-trow"><span>${label}</span><span>−${formatMoney(t.discountCents, cur)}</span></div>`);
  }
  if (t.taxCents > 0 || inv.taxPct.trim() !== '') {
    const label = inv.taxPct.trim() !== '' ? `Tax (${esc(inv.taxPct.trim())}%)` : 'Tax';
    totalRows.push(`<div class="inv-trow"><span>${label}</span><span>${formatMoney(t.taxCents, cur)}</span></div>`);
  }
  totalRows.push(
    `<div class="inv-trow inv-total"><span>Amount due</span><span>${formatMoney(t.totalCents, cur)}</span></div>`
  );

  return `<div class="inv-doc-inner">
    <div class="inv-header">
      <div class="inv-biz">
        ${logo}
        <div class="inv-biz-name">${b.name.trim() ? esc(b.name.trim()) : '<span class="inv-empty-line">Your business name</span>'}</div>
        ${bizMeta ? `<div class="inv-biz-meta">${bizMeta}</div>` : ''}
      </div>
      <div class="inv-title-block">
        <div class="inv-title">Invoice</div>
        ${inv.number.trim() ? `<div class="inv-docnum"># ${esc(inv.number.trim())}</div>` : ''}
      </div>
    </div>
    <div class="inv-parties">
      <div class="inv-party">
        <div class="inv-party-label">Billed to</div>
        ${clientBlock || '<span class="inv-empty-line">Client name</span>'}
      </div>
      <div class="inv-meta">${metaRowsHtml}</div>
    </div>
    <table class="inv-table">
      <thead><tr><th class="inv-desc">Description</th><th class="inv-num">Qty</th><th class="inv-num">Rate</th><th class="inv-num inv-amount">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="inv-totals-wrap"><div class="inv-totals">${totalRows.join('')}</div></div>
    ${inv.notes.trim() ? `<div class="inv-notes"><div class="inv-party-label">Notes</div><p>${multiline(inv.notes)}</p></div>` : ''}
  </div>`;
}
