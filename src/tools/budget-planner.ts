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
import { el, showError, hideError, downloadText, copyText } from './common.ts';

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
    return `<div class="stat"${extra}><div class="k">${label}</div><div class="v"${neg}>${formatMoney(cents, 'USD')}</div></div>`;
  }

  function render(): void {
    const m = month();
    el('budget-month-label').textContent = monthLabel(key);

    const remaining = remainingToAssignCents(m);
    const heroClass = remaining === 0 ? ' hero zero' : ' hero';
    const heroNote = remaining === 0
      ? 'Every dollar has a job.'
      : remaining > 0
        ? `${formatMoney(remaining, 'USD')} still needs a job.`
        : `${formatMoney(-remaining, 'USD')} over budget.`;
    el('budget-summary').innerHTML =
      stat('Income', totalIncomeCents(m)) +
      stat('Planned', totalPlannedCents(m)) +
      stat('Spent so far', totalActualCents(m)) +
      `<div class="stat${heroClass}"><div class="k">Remaining to assign</div><div class="v">${formatMoney(remaining, 'USD')}</div><div class="stat-sub">${heroNote}</div></div>` +
      stat('Left to spend', actualLeftCents(m));

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
        `<span class="entry-amount">${formatMoney(e.cents, 'USD')}</span>` +
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
        `<span class="entry-left ${left < 0 ? 'over' : ''}">${left < 0 ? `${formatMoney(-left, 'USD')} over` : `${formatMoney(left, 'USD')} left`}</span></span>` +
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
        caption: `${formatMoney(c.actualCents, 'USD')} of ${formatMoney(c.plannedCents, 'USD')}`,
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
      const compact = (cents: number) =>
        cents >= 100000 ? `$${(cents / 100000).toFixed(1)}k` : formatMoney(cents, 'USD');
      panels.push(
        `<div class="chart-box"><h3 class="chart-title">Income vs spending, last ${trend.length} months</h3>` +
          `${trendSvg(pts, compact)}${trendLegend()}</div>`
      );
    }
    box.innerHTML = panels.length > 0 ? `<div class="charts">${panels.join('')}</div>` : '';
  }

  el('budget-prev').addEventListener('click', () => {
    key = shiftMonth(key, -1);
    render();
  });
  el('budget-next').addEventListener('click', () => {
    key = shiftMonth(key, 1);
    render();
  });
  el('budget-today').addEventListener('click', () => {
    key = currentMonthKey();
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
    store.months[key] = exampleMonth(key);
    commit();
  });

  el('budget-copy-plan').addEventListener('click', () => {
    hideError('budget-error');
    const { source, month } = copyPlanFromPrevious(store, key);
    if (!source) {
      showError(
        'budget-error',
        "No earlier month has anything to copy. Plan this month by hand, or load the example."
      );
      return;
    }
    const current = month();
    if (
      (current.income.length > 0 || current.categories.length > 0) &&
      !window.confirm(`Replace this month's plan with a copy of ${monthLabel(source.monthKey)}? This cannot be undone.`)
    ) {
      return;
    }
    store.months[key] = month;
    commit();
  });

  el('budget-export').addEventListener('click', () => {
    downloadText(`budget-${key}.csv`, monthToCsv(month()), 'text/csv');
  });

  el('budget-copy-summary').addEventListener('click', () => {
    const m = month();
    const text = [
      `Budget - ${monthLabel(key)}`,
      `Income: ${formatMoney(totalIncomeCents(m), 'USD')}`,
      `Planned: ${formatMoney(totalPlannedCents(m), 'USD')}`,
      `Spent: ${formatMoney(totalActualCents(m), 'USD')}`,
      `Remaining to assign: ${formatMoney(remainingToAssignCents(m), 'USD')}`,
      `Left to spend: ${formatMoney(actualLeftCents(m), 'USD')}`,
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
