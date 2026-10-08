// Invoice generator: DOM glue. Pure model logic lives in ../lib/invoice-core.ts
import type { InvoiceData } from '../lib/invoice-core.ts';
import {
  CURRENCIES,
  INVOICE_STORAGE_KEY,
  INVOICE_NUMBER_KEY,
  INVOICE_HISTORY_KEY,
  INVOICE_TEMPLATES_KEY,
  MAX_TEMPLATES,
  blankInvoice,
  blankLineItem,
  exampleInvoice,
  addItem,
  removeItem,
  moveItem,
  validateInvoice,
  nextInvoiceNumber,
  parseQty,
  formatMoney,
  computeTotals,
  serializeInvoice,
  deserializeInvoice,
  upsertHistory,
  removeFromHistory,
  renderInvoice,
} from '../lib/invoice-core.ts';
import { el, showError, hideError, ICONS, downscaleImageFile } from './common.ts';
import { loadBusinessProfile, saveBusinessProfile, profileIsEmpty } from '../lib/business-profile.ts';
import {
  INVOICE_EXTRAS_KEY,
  blankInvoiceExtras,
  serializeExtras,
  deserializeExtras,
  applyExtrasToPreview,
  type InvoiceExtras,
} from '../lib/invoice-extras.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initInvoiceGenerator(): void {
  let invoice: InvoiceData = loadInvoice();
  let extras: InvoiceExtras = loadExtras();
  syncBusinessProfile();
  let history: InvoiceData[] = loadHistory();
  let templates: InvoiceTemplate[] = loadTemplates();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const editor = el('inv-editor');
  const preview = el('inv-preview');
  const originalTitle = document.title;

  function loadInvoice(): InvoiceData {
    let inv: InvoiceData;
    try {
      inv = deserializeInvoice(localStorage.getItem(INVOICE_STORAGE_KEY));
    } catch {
      inv = blankInvoice(); // storage blocked or unavailable
    }
    if (!inv.number.trim()) {
      try {
        const last = localStorage.getItem(INVOICE_NUMBER_KEY);
        inv.number = last ? nextInvoiceNumber(last) : 'INV-0001';
      } catch {
        inv.number = 'INV-0001';
      }
    }
    return inv;
  }

  function loadExtras(): InvoiceExtras {
    try {
      return deserializeExtras(localStorage.getItem(INVOICE_EXTRAS_KEY));
    } catch {
      return blankInvoiceExtras(); // storage blocked or unavailable
    }
  }

  function loadHistory(): InvoiceData[] {    try {
      const raw = localStorage.getItem(INVOICE_HISTORY_KEY);
      if (!raw) return [];
      const arr: unknown = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((e) => deserializeInvoice(typeof e === 'string' ? e : JSON.stringify(e)))
        .filter((i) => i.number.trim());
    } catch {
      return [];
    }
  }

  // ---------- business profile sync ----------
  //
  // The shared business profile fills empty business fields, and a one-time
  // migration copies details already saved here into the profile. Anything the
  // user typed in this tool always wins: prefill only touches empty fields and
  // migration never runs once a profile exists.

  function syncBusinessProfile(): void {
    const b = invoice.business;
    const hasDetails = [b.name, b.address, b.email, b.phone, b.logoDataUrl].some((v) => v.trim() !== '');
    const profile = loadBusinessProfile();
    if (!profileIsEmpty(profile)) {
      if (!hasDetails) {
        b.name = profile.name;
        b.address = profile.address;
        b.email = profile.email;
        b.phone = profile.phone;
        b.logoDataUrl = profile.logoDataUrl;
      }
      return;
    }
    // Profile is empty: migrate this tool's own saved details once, but never
    // the shipped example content.
    if (hasDetails && b.name.trim() !== 'Rivera Design Studio') {
      saveBusinessProfile({
        name: b.name,
        tagline: '',
        address: b.address,
        email: b.email,
        phone: b.phone,
        website: '',
        color: '',
        logoDataUrl: b.logoDataUrl,
      });
    }
  }

  function persist(): void {
    try {
      localStorage.setItem(INVOICE_STORAGE_KEY, serializeInvoice(invoice));
      localStorage.setItem(INVOICE_EXTRAS_KEY, serializeExtras(extras));
    } catch {
      // Storage full or blocked: the tool still works for this session.
    }
  }

  function persistHistory(): void {
    try {
      localStorage.setItem(INVOICE_HISTORY_KEY, JSON.stringify(history.map(serializeInvoice)));
    } catch {
      // ignore
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  /** Write immediately, dropping any pending debounced save. */
  function flushSave(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persist();
  }

  // The 400 ms debounce can lose the tail of what was typed if the tab closes
  // inside the window. Flush on both events: pagehide covers tab close and
  // bfcache navigation, beforeunload covers the rest. persist() is idempotent.
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);

  // ---------- preview ----------

  function renderPreview(): void {
    preview.innerHTML = applyExtrasToPreview(renderInvoice(invoice), invoice, extras);
  }

  // ---------- editor ----------

  function field(sec: string, f: string, label: string, value: string, ph = '', span = false): string {
    return `<label class="rb-field${span ? ' rb-span2' : ''}"><span>${escapeHtml(label)}</span><input type="text" data-sec="${sec}" data-field="${f}" value="${escapeHtml(value)}" placeholder="${escapeHtml(ph)}" /></label>`;
  }

  function businessHtml(): string {
    const b = invoice.business;
    const logo = b.logoDataUrl
      ? `<div class="logo-pick"><img class="thumb" src="${escapeHtml(b.logoDataUrl)}" alt="Logo" /><span class="file-name-label">Logo added</span><button type="button" class="link-btn" id="inv-logo-clear">Remove</button></div>`
      : `<div class="logo-pick"><label class="btn btn-secondary btn-small" for="inv-logo-input" style="cursor:pointer;">Upload logo</label><input type="file" id="inv-logo-input" accept="image/*" hidden /><span class="file-name-label">Optional. JPG or PNG, shows on the invoice.</span></div>`;
    return `<section class="rb-section" aria-label="Your business">
      <div class="rb-section-head"><h3>Your business</h3></div>
      <div class="rb-grid">
        ${field('business', 'name', 'Business name', b.name, 'Rivera Design Studio', true)}
        ${field('business', 'email', 'Email', b.email, 'billing@example.com')}
        ${field('business', 'phone', 'Phone', b.phone, '(415) 555-0132')}
      </div>
      <label class="rb-field" style="margin-top:0.65rem;"><span>Address</span><textarea data-sec="business" data-field="address" rows="2" placeholder="418 Harbor Ave, Suite 12&#10;San Francisco, CA 94123">${escapeHtml(b.address)}</textarea></label>
      <div style="margin-top:0.65rem;">${logo}</div>
    </section>`;
  }

  function clientHtml(): string {
    const c = invoice.client;
    return `<section class="rb-section" aria-label="Client">
      <div class="rb-section-head"><h3>Client</h3></div>
      <div class="rb-grid">
        ${field('client', 'name', 'Client name', c.name, 'Northwind Mobile, Inc.', true)}
        ${field('client', 'email', 'Client email', c.email, 'accounts@client.com')}
      </div>
      <label class="rb-field" style="margin-top:0.65rem;"><span>Client address</span><textarea data-sec="client" data-field="address" rows="2" placeholder="900 Market Street&#10;San Francisco, CA 94103">${escapeHtml(c.address)}</textarea></label>
    </section>`;
  }

  function detailsHtml(): string {
    const opts = CURRENCIES.map(
      (c) => `<option value="${c.code}" ${invoice.currency === c.code ? 'selected' : ''}>${c.code}: ${escapeHtml(c.name)}</option>`
    ).join('');
    return `<section class="rb-section" aria-label="Invoice details">
      <div class="rb-section-head"><h3>Invoice details</h3></div>
      <div class="rb-grid">
        <label class="rb-field"><span>Invoice number</span><input type="text" data-sec="meta" data-field="number" value="${escapeHtml(invoice.number)}" /></label>
        <label class="rb-field"><span>Currency</span><select data-sec="meta" data-field="currency">${opts}</select></label>
        <label class="rb-field"><span>Issue date</span><input type="date" data-sec="meta" data-field="issueDate" value="${escapeHtml(invoice.issueDate)}" /></label>
        <label class="rb-field"><span>Due date</span><input type="date" data-sec="meta" data-field="dueDate" value="${escapeHtml(invoice.dueDate)}" /></label>
      </div>
    </section>`;
  }

  function itemRow(item: { id: string; description: string; qty: number; rate: string }, index: number, total: number): string {
    return `<div class="rb-entry">
      <div class="rb-entry-bar">
        <span class="rb-entry-title">${escapeHtml(item.description || `Line item ${index + 1}`)}</span>
        <button type="button" class="icon-btn" data-act="up" data-id="${item.id}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
        <button type="button" class="icon-btn" data-act="down" data-id="${item.id}" ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
        <button type="button" class="icon-btn" data-act="remove" data-id="${item.id}" aria-label="Remove">${ICONS.x}</button>
      </div>
      <div class="inv-item-grid">
        <label class="rb-field rb-span2"><span>Description</span><input type="text" data-sec="item" data-id="${item.id}" data-field="description" value="${escapeHtml(item.description)}" placeholder="What was delivered" /></label>
        <label class="rb-field"><span>Qty</span><input type="number" min="0" step="any" data-sec="item" data-id="${item.id}" data-field="qty" value="${item.qty}" /></label>
        <label class="rb-field"><span>Rate</span><input type="text" inputmode="decimal" data-sec="item" data-id="${item.id}" data-field="rate" value="${escapeHtml(item.rate)}" placeholder="95.00" /></label>
      </div>
    </div>`;
  }

  function itemsHtml(): string {
    return `<section class="rb-section" aria-label="Line items">
      <div class="rb-section-head"><h3>Line items</h3><button type="button" class="btn btn-secondary btn-small" id="inv-add-item">Add line item</button></div>
      <p class="hint">One row per deliverable. Qty can be hours or units; the rate is per unit in your currency.</p>
      <div id="inv-items">${invoice.items.map((it, i) => itemRow(it, i, invoice.items.length)).join('')}</div>
    </section>`;
  }

  function totalsHtml(): string {
    return `<section class="rb-section" aria-label="Tax, discount, and notes">
      <div class="rb-section-head"><h3>Tax, discount, notes</h3></div>
      <div class="rb-grid">
        <label class="rb-field"><span>Tax %</span><input type="text" inputmode="decimal" data-sec="meta" data-field="taxPct" value="${escapeHtml(invoice.taxPct)}" placeholder="8.5" /></label>
        <label class="rb-field"><span>Discount type</span><select data-sec="meta" data-field="discountType">
          <option value="percent" ${invoice.discountType === 'percent' ? 'selected' : ''}>Percent (%)</option>
          <option value="flat" ${invoice.discountType === 'flat' ? 'selected' : ''}>Flat amount</option>
        </select></label>
      </div>
      <label class="rb-field" style="margin-top:0.65rem;"><span>Discount value${invoice.discountType === 'percent' ? ' (%)' : ' (in your currency)'}</span><input type="text" inputmode="decimal" data-sec="meta" data-field="discountValue" value="${escapeHtml(invoice.discountValue)}" placeholder="${invoice.discountType === 'percent' ? '10' : '50.00'}" /></label>
      <label class="rb-field" style="margin-top:0.65rem;"><span>Notes (payment terms, thanks, bank details)</span><textarea data-sec="meta" data-field="notes" rows="3" placeholder="Payment due within 14 days.">${escapeHtml(invoice.notes)}</textarea></label>
    </section>`;
  }

  function renderEditor(): void {
    editor.innerHTML = businessHtml() + clientHtml() + detailsHtml() + itemsHtml() + totalsHtml() + extrasHtml();
  }

  function renderItemsOnly(): void {
    el('inv-items').innerHTML = invoice.items.map((it, i) => itemRow(it, i, invoice.items.length)).join('');
  }

  function extrasHtml(): string {
    const ex = extras;
    return `<section class="rb-section" aria-label="More invoice options">
      <div class="rb-section-head"><h3>More options</h3></div>
      <div class="rb-grid">
        <label class="rb-field"><span>PO number</span><input type="text" data-sec="extras" data-field="poNumber" value="${escapeHtml(ex.poNumber)}" placeholder="Optional" /></label>
        <label class="rb-field"><span>Tax name</span><input type="text" data-sec="extras" data-field="taxName" value="${escapeHtml(ex.taxName)}" placeholder="Tax (e.g. VAT, GST)" /></label>
        <label class="rb-field"><span>Shipping</span><input type="text" inputmode="decimal" data-sec="extras" data-field="shipping" value="${escapeHtml(ex.shipping)}" placeholder="0.00" /></label>
        <label class="rb-field"><span>Amount paid</span><input type="text" inputmode="decimal" data-sec="extras" data-field="paid" value="${escapeHtml(ex.paid)}" placeholder="0.00" /></label>
      </div>
      <label class="checkline" style="margin-top:0.65rem;"><input type="checkbox" data-sec="extras" data-field="taxInclusive" ${ex.taxInclusive ? 'checked' : ''} /> Line prices already include tax</label>
      <p class="hint">For VAT/GST regions: the tax is backed out of the totals instead of added on top. Amount paid shows a balance-due line on the invoice.</p>
    </section>`;
  }

  // ---------- templates (reusable starting points for recurring billing) ----------

  interface InvoiceTemplate {
    name: string;
    invoice: InvoiceData;
  }

  function loadTemplates(): InvoiceTemplate[] {
    try {
      const raw = localStorage.getItem(INVOICE_TEMPLATES_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as Array<{ name: string; invoice: string }>;
      return arr
        .filter((t) => t && typeof t.name === 'string' && typeof t.invoice === 'string')
        .map((t) => ({ name: t.name, invoice: deserializeInvoice(t.invoice) }))
        .slice(0, MAX_TEMPLATES);
    } catch {
      return [];
    }
  }

  function persistTemplates(): void {
    try {
      localStorage.setItem(
        INVOICE_TEMPLATES_KEY,
        JSON.stringify(templates.map((t) => ({ name: t.name, invoice: serializeInvoice(t.invoice) }))),
      );
    } catch {
      // storage blocked — templates just won't persist
    }
  }

  function renderTemplates(): void {
    const box = el('inv-templates');
    if (templates.length === 0) {
      box.innerHTML =
        '<p class="empty-state">No templates yet. Set up an invoice once, save it as a template, and reuse it every billing cycle.</p>';
      return;
    }
    box.innerHTML = templates
      .map((t, i) => {
        const client = t.invoice.client.name.trim() || 'Unnamed client';
        return `<div class="file-row">
          <span class="file-name">${escapeHtml(t.name)}</span>
          <span class="file-meta">${escapeHtml(client)} · ${formatMoney(computeTotals(t.invoice).totalCents, t.invoice.currency)}</span>
          <span class="file-actions">
            <button type="button" class="btn btn-secondary btn-small" data-tact="use" data-idx="${i}">New invoice</button>
            <button type="button" class="icon-btn" data-tact="delete" data-idx="${i}" aria-label="Delete template">${ICONS.x}</button>
          </span>
        </div>`;
      })
      .join('');
  }

  function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function plusDaysISO(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Start a fresh invoice from a template: new number, today's dates. */
  function invoiceFromTemplate(t: InvoiceTemplate): InvoiceData {
    const fresh = deserializeInvoice(serializeInvoice(t.invoice));
    let last: string | null = null;
    try {
      last = localStorage.getItem(INVOICE_NUMBER_KEY);
    } catch {
      // ignore
    }
    fresh.number = last ? nextInvoiceNumber(last) : 'INV-0001';
    fresh.issueDate = todayISO();
    fresh.dueDate = plusDaysISO(30);
    return fresh;
  }

  // ---------- history ----------

  function renderHistory(): void {
    const box = el('inv-history');
    if (history.length === 0) {
      box.innerHTML = '<p class="empty-state">No saved invoices yet. Click "Save to history" to keep a copy here.</p>';
      return;
    }
    box.innerHTML = history
      .map((h) => {
        const t = computeTotals(h);
        const client = h.client.name.trim() || 'Unnamed client';
        return `<div class="file-row">
          <span class="file-name">${escapeHtml(h.number)} · ${escapeHtml(client)}</span>
          <span class="file-meta">${formatMoney(t.totalCents, h.currency)}</span>
          <span class="file-actions">
            <button type="button" class="btn btn-secondary btn-small" data-hact="open" data-num="${escapeHtml(h.number)}">Open</button>
            <button type="button" class="icon-btn" data-hact="delete" data-num="${escapeHtml(h.number)}" aria-label="Delete">${ICONS.x}</button>
          </span>
        </div>`;
      })
      .join('');
  }

  // ---------- model updates ----------

  function setValue(sec: string, id: string, fieldName: string, value: string): void {
    if (sec === 'business') {
      if (fieldName === 'logoDataUrl') {
        invoice.business.logoDataUrl = value;
      } else {
        (invoice.business as unknown as Record<string, string>)[fieldName] = value;
      }
      return;
    }
    if (sec === 'client') {
      (invoice.client as unknown as Record<string, string>)[fieldName] = value;
      return;
    }
    if (sec === 'meta') {
      if (fieldName === 'discountType') {
        invoice.discountType = value === 'flat' ? 'flat' : 'percent';
      } else {
        (invoice as unknown as Record<string, string>)[fieldName] = value;
      }
      return;
    }
    if (sec === 'extras') {
      if (fieldName === 'taxInclusive') {
        extras.taxInclusive = value === 'true';
      } else if (fieldName === 'poNumber' || fieldName === 'taxName' || fieldName === 'shipping' || fieldName === 'paid') {
        extras[fieldName] = value;
      }
      return;
    }
    if (sec === 'item') {
      const item = invoice.items.find((i) => i.id === id);
      if (!item) return;
      if (fieldName === 'qty') item.qty = parseQty(value);
      else if (fieldName === 'description' || fieldName === 'rate') item[fieldName] = value;
    }
  }

  editor.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    const input = t.closest('[data-sec]') as HTMLElement | null;
    if (!input) return;
    const sec = input.getAttribute('data-sec')!;
    const id = input.getAttribute('data-id') ?? '';
    const fieldName = input.getAttribute('data-field');
    if (!fieldName) return;
    const rawValue =
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? String(input.checked)
        : (input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    setValue(sec, id, fieldName, rawValue);
    scheduleSave();
    renderPreview();
  });

  editor.addEventListener('change', (e) => {
    // select/date inputs fire change; the input handler already covered them, but
    // date pickers in some browsers only fire change, so re-render to be safe.
    const t = e.target as HTMLElement;
    const input = t.closest('select[data-sec], input[type="date"][data-sec]') as HTMLElement | null;
    if (!input) return;
    scheduleSave();
    renderPreview();
    if (input.getAttribute('data-field') === 'discountType') renderEditor();
  });

  editor.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#inv-logo-clear')) {
      invoice.business.logoDataUrl = '';
      scheduleSave();
      renderEditor();
      renderPreview();
      return;
    }
    if (t.closest('#inv-add-item')) {
      invoice.items = addItem(invoice.items, blankLineItem());
      scheduleSave();
      renderItemsOnly();
      renderPreview();
      return;
    }
    const btn = t.closest('button[data-act]') as HTMLElement | null;
    if (!btn || btn.hasAttribute('disabled')) return;
    const act = btn.getAttribute('data-act')!;
    const id = btn.getAttribute('data-id') ?? '';
    if (act === 'remove') invoice.items = removeItem(invoice.items, id);
    else if (act === 'up') invoice.items = moveItem(invoice.items, id, -1);
    else if (act === 'down') invoice.items = moveItem(invoice.items, id, 1);
    scheduleSave();
    renderItemsOnly();
    renderPreview();
  });

  editor.addEventListener('change', async (e) => {
    const input = (e.target as HTMLElement).closest('#inv-logo-input') as HTMLInputElement | null;
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      showError('inv-error', 'That file is not an image. Choose a JPG or PNG logo.');
      return;
    }
    hideError('inv-error');
    try {
      const dataUrl = await downscaleImageFile(file);
      invoice.business.logoDataUrl = dataUrl;
      scheduleSave();
      renderEditor();
      renderPreview();
    } catch {
      showError('inv-error', 'Could not read that image. Try a different file.');
    }
  });

  // ---------- toolbar ----------

  el('inv-print').addEventListener('click', () => {
    hideError('inv-error');
    const problems = validateInvoice(invoice);
    if (problems.length > 0) {
      showError('inv-error', 'Before downloading: ' + problems.join(' '));
      el('inv-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    document.title = `Invoice ${invoice.number.trim()}`;
    document.body.classList.add('invoice-print');
    window.print();
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('invoice-print');
    document.title = originalTitle;
  });

  el('inv-save').addEventListener('click', () => {
    hideError('inv-error');
    const problems = validateInvoice(invoice);
    if (problems.length > 0) {
      showError('inv-error', 'Before saving: ' + problems.join(' '));
      el('inv-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    history = upsertHistory(history, invoice);
    try {
      localStorage.setItem(INVOICE_NUMBER_KEY, invoice.number.trim());
    } catch {
      // ignore
    }
    persistHistory();
    renderHistory();
    el('inv-saved-note').hidden = false;
    window.setTimeout(() => {
      el('inv-saved-note').hidden = true;
    }, 2500);
  });

  el('inv-template-save').addEventListener('click', () => {
    hideError('inv-error');
    const problems = validateInvoice(invoice);
    if (problems.length > 0) {
      showError('inv-error', 'Before saving as a template: ' + problems.join(' '));
      el('inv-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const def = `${invoice.client.name.trim() || 'Untitled'} template`;
    const name = window.prompt('Name this template:', def);
    if (name === null) return; // cancelled
    const clean = name.trim() || def;
    templates.unshift({ name: clean, invoice: deserializeInvoice(serializeInvoice(invoice)) });
    templates = templates.slice(0, MAX_TEMPLATES);
    persistTemplates();
    renderTemplates();
    el('inv-saved-note').textContent = `Template "${clean}" saved. Reuse it for the next billing cycle.`;
    el('inv-saved-note').hidden = false;
    window.setTimeout(() => {
      el('inv-saved-note').hidden = true;
    }, 2500);
  });

  el('inv-templates').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-tact]') as HTMLElement | null;
    if (!btn) return;
    const idx = parseInt(btn.getAttribute('data-idx') ?? '-1', 10);
    const t = templates[idx];
    if (!t) return;
    if (btn.getAttribute('data-tact') === 'use') {
      invoice = invoiceFromTemplate(t);
      scheduleSave();
      renderEditor();
      renderPreview();
      el('inv-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (btn.getAttribute('data-tact') === 'delete') {
      if (!window.confirm(`Delete template "${t.name}"?`)) return;
      templates.splice(idx, 1);
      persistTemplates();
      renderTemplates();
    }
  });

  el('inv-example').addEventListener('click', () => {
    if (!window.confirm('Replace your current invoice with the example content?')) return;
    invoice = exampleInvoice();
    scheduleSave();
    renderEditor();
    renderPreview();
  });

  el('inv-clear').addEventListener('click', () => {
    if (!window.confirm('Clear everything and start over? This cannot be undone.')) return;
    invoice = blankInvoice();
    scheduleSave();
    renderEditor();
    renderPreview();
  });

  el('inv-history').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-hact]') as HTMLElement | null;
    if (!btn) return;
    const num = btn.getAttribute('data-num') ?? '';
    if (btn.getAttribute('data-hact') === 'open') {
      const found = history.find((h) => h.number === num);
      if (found) {
        invoice = deserializeInvoice(serializeInvoice(found));
        scheduleSave();
        renderEditor();
        renderPreview();
        el('inv-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (btn.getAttribute('data-hact') === 'delete') {
      if (!window.confirm(`Delete saved invoice ${num}?`)) return;
      history = removeFromHistory(history, num);
      persistHistory();
      renderHistory();
    }
  });

  // ---------- mobile tabs ----------

  el('inv-tab-edit').addEventListener('click', () => {
    el('inv-workspace').classList.remove('show-preview');
    el('inv-tab-edit').classList.add('tab-active');
    el('inv-tab-preview').classList.remove('tab-active');
  });
  el('inv-tab-preview').addEventListener('click', () => {
    el('inv-workspace').classList.add('show-preview');
    el('inv-tab-preview').classList.add('tab-active');
    el('inv-tab-edit').classList.remove('tab-active');
  });

  renderEditor();
  renderPreview();
  renderHistory();
  renderTemplates();
}
