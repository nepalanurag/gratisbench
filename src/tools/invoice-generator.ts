// Invoice generator: DOM glue. Pure model logic lives in ../lib/invoice-core.ts
import type { InvoiceData } from '../lib/invoice-core.ts';
import {
  CURRENCIES,
  INVOICE_STORAGE_KEY,
  INVOICE_NUMBER_KEY,
  INVOICE_HISTORY_KEY,
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initInvoiceGenerator(): void {
  let invoice: InvoiceData = loadInvoice();
  let history: InvoiceData[] = loadHistory();
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

  function loadHistory(): InvoiceData[] {
    try {
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

  function persist(): void {
    try {
      localStorage.setItem(INVOICE_STORAGE_KEY, serializeInvoice(invoice));
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

  // ---------- preview ----------

  function renderPreview(): void {
    preview.innerHTML = renderInvoice(invoice);
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
      (c) => `<option value="${c.code}" ${invoice.currency === c.code ? 'selected' : ''}>${c.code} — ${escapeHtml(c.name)}</option>`
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
      <p class="rb-hint">One row per deliverable. Qty can be hours or units; the rate is per unit in your currency.</p>
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
    editor.innerHTML = businessHtml() + clientHtml() + detailsHtml() + itemsHtml() + totalsHtml();
  }

  function renderItemsOnly(): void {
    el('inv-items').innerHTML = invoice.items.map((it, i) => itemRow(it, i, invoice.items.length)).join('');
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
        (invoice.business as Record<string, string>)[fieldName] = value;
      }
      return;
    }
    if (sec === 'client') {
      (invoice.client as Record<string, string>)[fieldName] = value;
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
    setValue(sec, id, fieldName, (input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
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
}
