// Budget planner tool: DOM glue. Core logic lives in ../lib/budget-core.ts
import {
  BUDGET_STORAGE_KEY,
  blankMonth,
  blankStore,
  exampleMonth,
  monthKey,
  parseMonthKey,
  currentMonthKey,
  shiftMonth,
  monthLabel,
  totalIncomeCents,
  totalPlannedCents,
  totalActualCents,
  remainingToAssignCents,
  actualLeftCents,
  categoryLeftCents,
  parseCents,
  formatMoney,
  validateBudgetMonth,
  serializeStore,
  deserializeStore,
  addIncomeEntry,
  removeIncomeEntry,
  addCategory,
  removeCategory,
  blankIncomeEntry,
  blankCategory,
  monthSpendingTrend,
  copyPlanFromPrevious,
  monthToCsv,
  type BudgetMonth,
  type BudgetStore,
  type BudgetCategory,
} from '../lib/budget-core.ts';
import { hbarChart, trendSvg, trendLegend, categoryLegend, shortMonthLabel } from '../lib/money-charts.ts';
import { el, showError, hideError, downloadText, copyText, bindSetting } from './common.ts';

/** Best-guess currency from the browser language; the user can change it. */function guessCurrency(): string {
  const lang = (navigator.language || 'en-US').toLowerCase();
  const table: [string, string][] = [
    ['en-gb', 'GBP'], ['en-in', 'INR'], ['hi', 'INR'], ['en-ca', 'CAD'],
    ['en-au', 'AUD'], ['en-nz', 'NZD'], ['en-hk', 'HKD'], ['en-sg', 'SGD'],
    ['ja', 'JPY'], ['de-ch', 'CHF'], ['fr-ch', 'CHF'], ['it-ch', 'CHF'],
    ['es-mx', 'MXN'], ['pt-br', 'BRL'], ['de', 'EUR'], ['fr', 'EUR'],
    ['it', 'EUR'], ['es', 'EUR'], ['nl', 'EUR'], ['pt', 'EUR'],
    ['zh-hk', 'HKD'], ['zh', 'CNY'], ['sv', 'SEK'],
  ];
  for (const [prefix, code] of table) {
    if (lang.startsWith(prefix)) return code;
  }
  return 'USD';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initBudgetPlanner(): void {
  let store: BudgetStore;
  try {
    store = deserializeStore(localStorage.getItem(BUDGET_STORAGE_KEY));
  } catch {
    store = blankStore();
  }
  let key = currentMonthKey();
  let editingIncomeId: string | null = null;
  // Monthly savings goals, keyed by month ("2026-10" -> cents).
  let goals: Record<string, number> = loadGoals();

  function loadGoals(): Record<string, number> {
    try {
      const raw = localStorage.getItem('truepdf.budget-planner.goals.v1');
      if (!raw) return {};
      const p = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
      }
      return out;
    } catch {
      return {};
    }
  }

  function saveGoals(): void {
    try {
      localStorage.setItem('truepdf.budget-planner.goals.v1', JSON.stringify(goals));
    } catch {
      /* ignore */
    }
  }

  // Currency: default from the browser language, remembered per visitor.
  const currencySel = el<HTMLSelectElement>('budget-currency');
  try {
    if (!localStorage.getItem('truepdf:budget-planner:currency')) {
      currencySel.value = guessCurrency();
    }
  } catch {
    currencySel.value = guessCurrency();
  }
  bindSetting('budget-planner', 'currency', currencySel, guessCurrency());
  currencySel.addEventListener('change', render);

  /** Format cents in the chosen currency with the browser's number formatting. */
  function fmt(cents: number): string {
    const code = currencySel.value || 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(cents / 100);
    } catch {
      return formatMoney(cents, 'USD');
    }
  }

  /** Compact axis formatting for the trend chart, currency-aware. */
  function fmtCompact(cents: number): string {
    const code = currencySel.value || 'USD';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
        notation: 'compact',
      }).format(cents / 100);
    } catch {
      return formatMoney(cents, 'USD');
    }
  }

  function save(): void {
    try {
      localStorage.setItem(BUDGET_STORAGE_KEY, serializeStore(store));
    } catch {
      /* storage full or unavailable: the tool still works for the session */
    }
  }

  function month(): BudgetMonth {
    if (!store.months[key]) store.months[key] = blankMonth(key);
    return store.months[key];
  }

  function stat(label: string, cents: number, extra = ''): string {
    const neg = cents < 0 ? ' style="color: var(--danger);"' : '';
    return `<div class="stat"${extra}><div class="k">${label}</div><div class="v"${neg}>${fmt(cents)}</div></div>`;
  }

  /** Savings-goal card appended to the summary: a goal input, a progress bar,
   * and a one-line insight about the biggest planned category. */
  function goalHtml(m: BudgetMonth): string {
    const goalCents = goals[key] ?? 0;
    const saved = totalIncomeCents(m) - totalActualCents(m);
    const pct = goalCents > 0 ? Math.max(0, Math.min(100, (saved / goalCents) * 100)) : 0;
    const biggest =
      m.categories.length > 0
        ? [...m.categories].sort((a, b) => b.plannedCents - a.plannedCents)[0]
        : null;
    const note =
      goalCents <= 0
        ? 'Set a monthly savings goal to track it here.'
        : saved >= goalCents
          ? `Goal met — ${fmt(saved)} kept.`
          : `${fmt(goalCents - saved)} to go to reach ${fmt(goalCents)}.`;
    return `<div class="stat"><div class="k">Savings goal</div>` +
      `<input type="text" inputmode="decimal" id="budget-goal-input" class="money-input" value="${goalCents > 0 ? (goalCents / 100).toFixed(2) : ''}" placeholder="500.00" aria-label="Savings goal for ${escapeHtml(monthLabel(key))}" style="margin:0.3rem 0;" />` +
      `<div style="height:8px;border-radius:4px;background:var(--track,#e4e0d5);overflow:hidden;" role="img" aria-label="${escapeHtml(note)}"><span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:var(--accent,#a63d21);border-radius:4px;"></span></div>` +
      `<div class="stat-sub">${escapeHtml(note)}${biggest ? ` Biggest plan: ${escapeHtml(biggest.name.trim() || 'Untitled')} (${fmt(biggest.plannedCents)}).` : ''}</div></div>`;
  }

  function bindGoalInput(): void {
    const gi = document.getElementById('budget-goal-input') as HTMLInputElement | null;
    if (!gi) return;
    gi.addEventListener('input', () => {
      goals[key] = Math.max(0, parseCents(gi.value));
    });
    gi.addEventListener('change', () => {
      goals[key] = Math.max(0, parseCents(gi.value));
      if (goals[key] <= 0) delete goals[key];
      saveGoals();
      render();
    });
    gi.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        gi.blur();
      }
    });
  }

  function render(): void {
    const m = month();
    el('budget-month-label').textContent = monthLabel(key);

    const remaining = remainingToAssignCents(m);
    const heroClass = remaining === 0 ? ' hero zero' : ' hero';
    const heroNote = remaining === 0
      ? 'Every cent has a job.'
      : remaining > 0
        ? `${fmt(remaining)} still needs a job.`
        : `${fmt(-remaining)} over budget.`;
    el('budget-summary').innerHTML =
      stat('Income', totalIncomeCents(m)) +
      stat('Planned', totalPlannedCents(m)) +
      stat('Spent so far', totalActualCents(m)) +
      `<div class="stat${heroClass}"><div class="k">Remaining to assign</div><div class="v">${fmt(remaining)}</div><div class="stat-sub">${heroNote}</div></div>` +
      stat('Left to spend', actualLeftCents(m)) +
      goalHtml(m);
    bindGoalInput();

    const incomeList = el('budget-income-list');
    incomeList.innerHTML = '';
    if (m.income.length === 0) {
      incomeList.innerHTML = '<p class="empty-state">No income yet. Add your paycheck above.</p>';
    }
    for (const e of m.income) {
      const row = document.createElement('div');
      row.className = 'entry-row';
      row.innerHTML =
        `<span class="grow"><strong>${escapeHtml(e.label.trim() || 'Untitled')}</strong></span>` +
        `<span class="entry-amount">${fmt(e.cents)}</span>` +
        `<button type="button" class="icon-btn" data-act="edit-income" data-id="${e.id}" aria-label="Edit income entry">Edit</button>` +
        `<button type="button" class="icon-btn" data-act="del-income" data-id="${e.id}" aria-label="Remove income entry">×</button>`;
      incomeList.appendChild(row);
    }

    const catList = el('budget-cat-list');
    catList.innerHTML = '';
    if (m.categories.length === 0) {
      catList.innerHTML = '<p class="empty-state">No categories yet. Add one above, like Groceries or Rent.</p>';
    }
    for (const c of m.categories) {
      const left = categoryLeftCents(c);
      const row = document.createElement('div');
      row.className = 'entry-row entry-row-grid';
      row.innerHTML =
        `<span class="grow"><strong>${escapeHtml(c.name.trim() || 'Untitled')}</strong>` +
        `<span class="entry-left ${left < 0 ? 'over' : ''}">${left < 0 ? `${fmt(-left)} over` : `${fmt(left)} left`}</span></span>` +
        `<label class="mini-label">Planned <input type="text" inputmode="decimal" class="money-input" data-act="planned" data-id="${c.id}" value="${(c.plannedCents / 100).toFixed(2)}" aria-label="Planned amount for ${escapeHtml(c.name)}"></label>` +
        `<label class="mini-label">Spent <input type="text" inputmode="decimal" class="money-input" data-act="actual" data-id="${c.id}" value="${(c.actualCents / 100).toFixed(2)}" aria-label="Actual spent for ${escapeHtml(c.name)}"></label>` +
        `<button type="button" class="icon-btn" data-act="del-cat" data-id="${c.id}" aria-label="Remove category">×</button>`;
      catList.appendChild(row);
    }

    renderCharts(m);
  }

  function commit(): void {
    save();
    render();
  }

  function renderCharts(m: BudgetMonth): void {
    const box = el('budget-charts');
    const panels: string[] = [];
    if (m.categories.length > 0) {
      const scale = Math.max(1, ...m.categories.map((c) => Math.max(c.plannedCents, c.actualCents)));
      const rows = m.categories.map((c) => ({
        label: c.name.trim() || 'Untitled',
        caption: `${fmt(c.actualCents)} of ${fmt(c.plannedCents)}`,
        pct: (c.actualCents / scale) * 100,
        markerPct: (c.plannedCents / scale) * 100,
        over: c.actualCents > c.plannedCents,
      }));
      panels.push(
        `<div class="chart-box"><h3 class="chart-title">Planned vs actual</h3>${hbarChart(rows)}${categoryLegend()}</div>`
      );
    }
    const trend = monthSpendingTrend(store, 12);
    if (trend.length >= 2) {
      const pts = trend.map((p) => ({
        label: shortMonthLabel(p.key),
        incomeCents: p.incomeCents,
        spentCents: p.spentCents,
      }));
      panels.push(
        `<div class="chart-box"><h3 class="chart-title">Income vs spending, last ${trend.length} months</h3>` +
          `${trendSvg(pts, fmtCompact)}${trendLegend()}</div>`
      );
    }
    box.innerHTML = panels.length > 0 ? `<div class="charts">${panels.join('')}</div>` : '';
  }

  el('budget-prev').addEventListener('click', () => {
    key = shiftMonth(key, -1);
    clearIncomeForm();
    render();
  });
  el('budget-next').addEventListener('click', () => {
    key = shiftMonth(key, 1);
    clearIncomeForm();
    render();
  });
  el('budget-today').addEventListener('click', () => {
    key = currentMonthKey();
    clearIncomeForm();
    render();
  });

  function clearIncomeForm(): void {
    el<HTMLInputElement>('budget-income-label').value = '';
    el<HTMLInputElement>('budget-income-amount').value = '';
    editingIncomeId = null;
    el<HTMLButtonElement>('budget-add-income').textContent = 'Add income';
    el('budget-cancel-income').hidden = true;
  }

  function addOrSaveIncome(): void {
    hideError('budget-error');
    const labelInput = el<HTMLInputElement>('budget-income-label');
    const amountInput = el<HTMLInputElement>('budget-income-amount');
    const label = labelInput.value.trim();
    const cents = parseCents(amountInput.value);
    if (!label) {
      showError('budget-error', 'Give the income a label, like "Paycheck".');
      labelInput.focus();
      return;
    }
    if (cents <= 0) {
      showError('budget-error', 'Enter an income amount greater than zero.');
      amountInput.focus();
      return;
    }
    const m = month();
    if (editingIncomeId) {
      const e = m.income.find((x) => x.id === editingIncomeId);
      if (e) {
        e.label = label;
        e.cents = cents;
      }
    } else {
      m.income = addIncomeEntry(m.income, { ...blankIncomeEntry(), label, cents });
    }
    clearIncomeForm();
    labelInput.focus();
    commit();
  }

  el('budget-add-income').addEventListener('click', addOrSaveIncome);
  el('budget-cancel-income').addEventListener('click', () => {
    hideError('budget-error');
    clearIncomeForm();
  });

  // Enter adds the entry instead of doing nothing.
  for (const [inputId, action] of [
    ['budget-income-label', addOrSaveIncome],
    ['budget-income-amount', addOrSaveIncome],
    ['budget-cat-name', () => el('budget-add-cat').click()],
    ['budget-cat-planned', () => el('budget-add-cat').click()],
  ] as const) {
    el<HTMLInputElement>(inputId).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        action();
      }
    });
  }

  el('budget-add-cat').addEventListener('click', () => {
    hideError('budget-error');
    const nameInput = el<HTMLInputElement>('budget-cat-name');
    const plannedInput = el<HTMLInputElement>('budget-cat-planned');
    const name = nameInput.value.trim();
    const plannedCents = parseCents(plannedInput.value);
    if (!name) {
      showError('budget-error', 'Give the category a name, like "Groceries".');
      nameInput.focus();
      return;
    }
    if (plannedCents < 0) {
      showError('budget-error', 'The planned amount cannot be negative.');
      plannedInput.focus();
      return;
    }
    const m = month();
    m.categories = addCategory(m.categories, { ...blankCategory(), name, plannedCents });
    nameInput.value = '';
    plannedInput.value = '';
    nameInput.focus();
    commit();
  });

  // delegated: edit and delete buttons on income rows
  el('budget-income-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id') || '';
    const act = btn.getAttribute('data-act');
    const m = month();
    if (act === 'edit-income') {
      const entry = m.income.find((x) => x.id === id);
      if (!entry) return;
      editingIncomeId = id;
      el<HTMLInputElement>('budget-income-label').value = entry.label;
      el<HTMLInputElement>('budget-income-amount').value = (entry.cents / 100).toFixed(2);
      el<HTMLButtonElement>('budget-add-income').textContent = 'Save changes';
      el('budget-cancel-income').hidden = false;
      el<HTMLInputElement>('budget-income-label').focus();
    } else if (act === 'del-income') {
      if (editingIncomeId === id) clearIncomeForm();
      m.income = removeIncomeEntry(m.income, id);
      commit();
    }
  });

  const catList = el('budget-cat-list');
  catList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act="del-cat"]');
    if (!btn) return;
    const m = month();
    m.categories = removeCategory(m.categories, btn.getAttribute('data-id') || '');
    commit();
  });
  catList.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest('input[data-act]') as HTMLInputElement | null;
    if (!input) return;
    const m = month();
    const id = input.getAttribute('data-id') || '';
    const cents = Math.max(0, parseCents(input.value));
    const cat: BudgetCategory | undefined = m.categories.find((c) => c.id === id);
    if (!cat) return;
    if (input.getAttribute('data-act') === 'planned') cat.plannedCents = cents;
    else cat.actualCents = cents;
    commit();
  });

  el('budget-example').addEventListener('click', () => {
    hideError('budget-error');
    if (
      (month().income.length > 0 || month().categories.length > 0) &&
      !window.confirm(`Replace this month's plan with the example budget? This cannot be undone.`)
    ) {
      return;
    }
    store.months[key] = exampleMonth(key);
    commit();
  });

  el('budget-copy-plan').addEventListener('click', () => {
    hideError('budget-error');
    const current = month();
    const { source, month: copied } = copyPlanFromPrevious(store, key);
    if (!source) {
      showError(
        'budget-error',
        "No earlier month has anything to copy. Plan this month by hand, or load the example."
      );
      return;
    }
    if (
      (current.income.length > 0 || current.categories.length > 0) &&
      !window.confirm(`Replace this month's plan with a copy of ${monthLabel(source.monthKey)}? This cannot be undone.`)
    ) {
      return;
    }
    store.months[key] = copied;
    commit();
  });

  el('budget-export').addEventListener('click', () => {
    downloadText(`budget-${key}.csv`, monthToCsv(month()), 'text/csv');
  });

  el('budget-copy-summary').addEventListener('click', () => {
    const m = month();
    const text = [
      `Budget - ${monthLabel(key)}`,
      `Income: ${fmt(totalIncomeCents(m))}`,
      `Planned: ${fmt(totalPlannedCents(m))}`,
      `Spent: ${fmt(totalActualCents(m))}`,
      `Remaining to assign: ${fmt(remainingToAssignCents(m))}`,
      `Left to spend: ${fmt(actualLeftCents(m))}`,
    ].join('\n');
    const btn = el<HTMLButtonElement>('budget-copy-summary');
    void copyText(text).then((ok) => {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => {
        btn.textContent = 'Copy summary';
      }, 1500);
    });
  });

  el('budget-clear').addEventListener('click', () => {
    if (!window.confirm(`Clear everything for ${monthLabel(key)}? This cannot be undone.`)) return;
    store.months[key] = blankMonth(key);
    clearIncomeForm();
    commit();
  });

  // quiet validation hint on load
  const problems = validateBudgetMonth(month());
  if (problems.length > 0 && (month().income.length > 0 || month().categories.length > 0)) {
    showError('budget-error', problems[0]);
  }

  render();
}
