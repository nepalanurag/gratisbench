// Subscription tracker tool: DOM glue. Core logic lives in ../lib/subs-core.ts
import {
  SUBS_STORAGE_KEY,
  blankStore,
  exampleSubscriptions,
  blankSubscription,
  todayLocalISO,
  renewalLabel,
  formatISODate,
  monthlyEquivalentCents,
  totals,
  sortedByRenewal,
  upcomingRenewals,
  categoryTotals,
  subscriptionsToCsv,
  parseCents,
  formatMoney,
  validateSubscription,
  serializeStore,
  deserializeStore,
  addSubscription,
  removeSubscription,
  updateSubscription,
  isCycle,
  type Subscription,
  type SubscriptionStore,
} from '../lib/subs-core.ts';
import { hbarChart } from '../lib/money-charts.ts';
import { el, showError, hideError, downloadText } from './common.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const CYCLE_LABEL: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function initSubscriptionTracker(): void {
  let store: SubscriptionStore;
  try {
    store = deserializeStore(localStorage.getItem(SUBS_STORAGE_KEY));
  } catch {
    store = blankStore();
  }
  let editingId: string | null = null;
  let sortMode: 'renewal' | 'cost' = 'renewal';
  const today = todayLocalISO();

  function save(): void {
    try {
      localStorage.setItem(SUBS_STORAGE_KEY, serializeStore(store));
    } catch {
      /* storage full or unavailable: the tool still works for the session */
    }
  }

  function stat(label: string, value: string, extra = ''): string {
    return `<div class="stat"${extra}><div class="k">${label}</div><div class="v">${value}</div></div>`;
  }

  function render(): void {
    const t = totals(store.subscriptions);
    el('subs-summary').innerHTML =
      stat('Per month', formatMoney(t.monthlyCents, 'USD')) +
      stat('Per year', formatMoney(t.yearlyCents, 'USD')) +
      stat('Cost per day', formatMoney(t.perDayCents, 'USD')) +
      stat('Subscriptions', String(t.count));

    // Upcoming renewals: computed from the saved dates, shown on the page.
    const upcoming = upcomingRenewals(store.subscriptions, today, 7);
    const upBox = el('subs-upcoming');
    if (store.subscriptions.length === 0) {
      upBox.innerHTML = '<p class="empty-state">Nothing here yet. Add a subscription below.</p>';
    } else if (upcoming.length === 0) {
      upBox.innerHTML = '<p class="empty-state">Nothing renews in the next 7 days.</p>';
    } else {
      upBox.innerHTML = upcoming
        .map((r) => {
          const cls = r.days <= 1 ? 'chip soon' : 'chip';
          return `<div class="entry-row"><span class="grow"><strong>${escapeHtml(r.sub.name)}</strong>` +
            `<span class="entry-meta">${formatMoney(r.sub.costCents, 'USD')} · ${formatISODate(r.renewal)}</span></span>` +
            `<span class="${cls}">${renewalLabel(r.days)}</span></div>`;
        })
        .join('');
    }

    const list = el('subs-list');
    if (store.subscriptions.length === 0) {
      list.innerHTML = '<p class="empty-state">No subscriptions tracked. Add your first one above.</p>';
      renderCharts();
      return;
    }
    list.innerHTML = '';
    let infos = sortedByRenewal(store.subscriptions, today);
    if (sortMode === 'cost') {
      infos = [...infos].sort(
        (a, b) => monthlyEquivalentCents(b.sub.costCents, b.sub.cycle) - monthlyEquivalentCents(a.sub.costCents, a.sub.cycle)
      );
    }
    for (const r of infos) {
      const s = r.sub;
      const row = document.createElement('div');
      row.className = 'entry-row';
      const cat = s.category.trim() ? ` · ${escapeHtml(s.category.trim())}` : '';
      const monthly = monthlyEquivalentCents(s.costCents, s.cycle);
      const share = t.monthlyCents > 0 ? (monthly / t.monthlyCents) * 100 : 0;
      row.innerHTML =
        `<span class="grow"><strong>${escapeHtml(s.name)}</strong>` +
        `<span class="entry-meta">${formatMoney(s.costCents, 'USD')} ${CYCLE_LABEL[s.cycle].toLowerCase()} (~${formatMoney(monthly, 'USD')}/mo)${cat}</span>` +
        `<span class="share-bar" role="img" aria-label="${escapeHtml(s.name)} is ${share.toFixed(0)} percent of monthly total"><span style="width:${share.toFixed(1)}%"></span></span></span>` +
        `<span class="chip${r.days <= 1 ? ' soon' : ''}" title="Next billing date">${renewalLabel(r.days)} · ${formatISODate(r.renewal)}</span>` +
        `<span class="file-actions">` +
        `<button type="button" class="icon-btn" data-act="edit" data-id="${s.id}" aria-label="Edit ${escapeHtml(s.name)}">Edit</button>` +
        `<button type="button" class="icon-btn" data-act="pause" data-id="${s.id}" aria-label="Pause ${escapeHtml(s.name)}">Pause</button>` +
        `<button type="button" class="icon-btn" data-act="del" data-id="${s.id}" aria-label="Delete ${escapeHtml(s.name)}">×</button>` +
        `</span>`;
      list.appendChild(row);
    }
    const paused = store.subscriptions.filter((s) => s.paused);
    for (const s of paused) {
      const row = document.createElement('div');
      row.className = 'entry-row paused';
      const cat = s.category.trim() ? ` · ${escapeHtml(s.category.trim())}` : '';
      row.innerHTML =
        `<span class="grow"><strong>${escapeHtml(s.name)}</strong>` +
        `<span class="entry-meta">${formatMoney(s.costCents, 'USD')} ${CYCLE_LABEL[s.cycle].toLowerCase()}${cat}</span></span>` +
        `<span class="chip" title="Paused subscriptions are excluded from totals">Paused</span>` +
        `<span class="file-actions">` +
        `<button type="button" class="icon-btn" data-act="resume" data-id="${s.id}" aria-label="Resume ${escapeHtml(s.name)}">Resume</button>` +
        `<button type="button" class="icon-btn" data-act="del" data-id="${s.id}" aria-label="Delete ${escapeHtml(s.name)}">×</button>` +
        `</span>`;
      list.appendChild(row);
    }
    renderCharts();
  }

  function renderCharts(): void {
    const box = el('subs-charts');
    const cats = categoryTotals(store.subscriptions);
    if (cats.length === 0) {
      box.innerHTML = '';
      return;
    }
    const scale = Math.max(1, ...cats.map((c) => c.monthlyCents));
    const rows = cats.map((c) => ({
      label: c.category,
      caption: `${formatMoney(c.monthlyCents, 'USD')}/mo · ${c.count} sub${c.count === 1 ? '' : 's'}`,
      pct: (c.monthlyCents / scale) * 100,
    }));
    box.innerHTML =
      `<div class="charts"><div class="chart-box"><h3 class="chart-title">Monthly cost by category</h3>${hbarChart(rows)}</div></div>`;
  }

  function readForm(): Subscription {
    const sel = el<HTMLSelectElement>('subs-cycle');
    const cycle = isCycle(sel.value) ? sel.value : 'monthly';
    const existing = editingId ? store.subscriptions.find((s) => s.id === editingId) : undefined;
    return {
      id: editingId ?? blankSubscription().id,
      name: el<HTMLInputElement>('subs-name').value.trim(),
      costCents: parseCents(el<HTMLInputElement>('subs-cost').value),
      cycle,
      startDate: el<HTMLInputElement>('subs-date').value,
      category: el<HTMLInputElement>('subs-category').value.trim(),
      paused: existing?.paused ?? false,
    };
  }

  function fillForm(s: Subscription): void {
    el<HTMLInputElement>('subs-name').value = s.name;
    el<HTMLInputElement>('subs-cost').value = (s.costCents / 100).toFixed(2);
    el<HTMLSelectElement>('subs-cycle').value = s.cycle;
    el<HTMLInputElement>('subs-date').value = s.startDate;
    el<HTMLInputElement>('subs-category').value = s.category;
  }

  function clearForm(): void {
    el<HTMLInputElement>('subs-name').value = '';
    el<HTMLInputElement>('subs-cost').value = '';
    el<HTMLSelectElement>('subs-cycle').value = 'monthly';
    el<HTMLInputElement>('subs-date').value = today;
    el<HTMLInputElement>('subs-category').value = '';
    editingId = null;
    el<HTMLButtonElement>('subs-add').textContent = 'Add subscription';
    el('subs-cancel-edit').hidden = true;
  }

  function commit(): void {
    save();
    render();
  }

  el('subs-add').addEventListener('click', () => {
    hideError('subs-error');
    const sub = readForm();
    const problems = validateSubscription(sub);
    if (problems.length > 0) {
      showError('subs-error', problems[0]);
      return;
    }
    if (editingId) {
      store.subscriptions = updateSubscription(store.subscriptions, sub);
    } else {
      store.subscriptions = addSubscription(store.subscriptions, sub);
    }
    clearForm();
    commit();
    el('subs-list').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  el('subs-cancel-edit').addEventListener('click', () => {
    hideError('subs-error');
    clearForm();
  });

  el('subs-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id') || '';
    const act = btn.getAttribute('data-act');
    if (act === 'del') {
      const s = store.subscriptions.find((x) => x.id === id);
      if (s && window.confirm(`Delete "${s.name}"? This cannot be undone.`)) {
        store.subscriptions = removeSubscription(store.subscriptions, id);
        if (editingId === id) clearForm();
        commit();
      }
    } else if (act === 'edit') {
      const s = store.subscriptions.find((x) => x.id === id);
      if (!s) return;
      editingId = id;
      fillForm(s);
      el<HTMLButtonElement>('subs-add').textContent = 'Save changes';
      el('subs-cancel-edit').hidden = false;
      el('subs-name').focus();
      el('subs-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (act === 'pause' || act === 'resume') {
      const s = store.subscriptions.find((x) => x.id === id);
      if (!s) return;
      store.subscriptions = updateSubscription(store.subscriptions, { ...s, paused: act === 'pause' });
      if (editingId === id) clearForm();
      commit();
    }
  });

  el<HTMLSelectElement>('subs-sort').addEventListener('change', (e) => {
    sortMode = (e.target as HTMLSelectElement).value === 'cost' ? 'cost' : 'renewal';
    render();
  });

  el('subs-export').addEventListener('click', () => {
    downloadText('subscriptions.csv', subscriptionsToCsv(store.subscriptions), 'text/csv');
  });

  // Enter in the name or cost field adds the subscription.
  for (const inputId of ['subs-name', 'subs-cost', 'subs-category']) {
    el<HTMLInputElement>(inputId).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el('subs-add').click();
      }
    });
  }

  el('subs-example').addEventListener('click', () => {
    hideError('subs-error');
    store.subscriptions = exampleSubscriptions();
    clearForm();
    commit();
  });

  el('subs-clear').addEventListener('click', () => {
    if (store.subscriptions.length === 0) return;
    if (!window.confirm('Delete all tracked subscriptions? This cannot be undone.')) return;
    store.subscriptions = [];
    clearForm();
    commit();
  });

  el<HTMLInputElement>('subs-date').value = today;
  render();
}
