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
  type BudgetMonth,
  type BudgetStore,
  type BudgetCategory,
} from '../lib/budget-core.ts';
import { el, showError, hideError } from './common.ts';

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
  }

  function commit(): void {
    save();
    render();
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

  el('budget-add-income').addEventListener('click', () => {
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
    m.income = addIncomeEntry(m.income, { ...blankIncomeEntry(), label, cents });
    labelInput.value = '';
    amountInput.value = '';
    labelInput.focus();
    commit();
  });

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

  // delegated: delete buttons and inline amount edits
  el('budget-income-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const m = month();
    m.income = removeIncomeEntry(m.income, btn.getAttribute('data-id') || '');
    commit();
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

  el('budget-clear').addEventListener('click', () => {
    if (!window.confirm(`Clear everything for ${monthLabel(key)}? This cannot be undone.`)) return;
    store.months[key] = blankMonth(key);
    commit();
  });

  // quiet validation hint on load
  const problems = validateBudgetMonth(month());
  if (problems.length > 0 && (month().income.length > 0 || month().categories.length > 0)) {
    showError('budget-error', problems[0]);
  }

  render();
}
