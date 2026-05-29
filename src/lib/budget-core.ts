// Pure budget-planner logic shared by the browser tool and the Node verification script.
// No DOM access here. Money is handled in integer cents throughout; no
// floating-point math touches totals. Cents parsing/formatting is reused from
// invoice-core; entry list ops and id generation from resume-core.

import { parseCents, formatMoney } from './invoice-core.ts';
import { addEntry, removeEntry, newId } from './resume-core.ts';

export const BUDGET_SCHEMA_VERSION = 1;
export const BUDGET_STORAGE_KEY = 'freekit.budget-planner.v1';

export interface IncomeEntry {
  id: string;
  label: string;
  cents: number;
}

export interface BudgetCategory {
  id: string;
  name: string;
  plannedCents: number;
  actualCents: number;
}

/** One month of budgeting. monthKey is "YYYY-MM". */
export interface BudgetMonth {
  version: number;
  monthKey: string;
  income: IncomeEntry[];
  categories: BudgetCategory[];
}

/** All months live under one storage key so the month switcher is instant. */
export interface BudgetStore {
  version: number;
  months: Record<string, BudgetMonth>;
}

export function blankIncomeEntry(): IncomeEntry {
  return { id: newId(), label: '', cents: 0 };
}

export function blankCategory(): BudgetCategory {
  return { id: newId(), name: '', plannedCents: 0, actualCents: 0 };
}

export function blankMonth(monthKey: string): BudgetMonth {
  return { version: BUDGET_SCHEMA_VERSION, monthKey, income: [], categories: [] };
}

export function blankStore(): BudgetStore {
  return { version: BUDGET_SCHEMA_VERSION, months: {} };
}

/** Sample month so people see the planner working before typing a word. */
export function exampleMonth(monthKey: string): BudgetMonth {
  return {
    version: BUDGET_SCHEMA_VERSION,
    monthKey,
    income: [
      { id: newId(), label: 'Paycheck', cents: 320000 },
      { id: newId(), label: 'Freelance', cents: 45000 },
    ],
    categories: [
      { id: newId(), name: 'Rent', plannedCents: 140000, actualCents: 140000 },
      { id: newId(), name: 'Groceries', plannedCents: 40000, actualCents: 23650 },
      { id: newId(), name: 'Transport', plannedCents: 12000, actualCents: 4800 },
      { id: newId(), name: 'Fun money', plannedCents: 15000, actualCents: 6200 },
    ],
  };
}

// ---------- month keys ----------

/** Build a "YYYY-MM" key. month is 1-12. */
export function monthKey(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid year/month: ${year}/${month}`);
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Parse a "YYYY-MM" key; null when malformed. */
export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key).trim());
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

/** The current month as a key, from the local date. */
export function currentMonthKey(d: Date = new Date()): string {
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

/** Shift a month key by delta months (negative goes back). */
export function shiftMonth(key: string, delta: number): string {
  const p = parseMonthKey(key);
  if (!p) throw new Error(`Invalid month key: ${key}`);
  const total = (p.year * 12 + (p.month - 1)) + Math.trunc(delta);
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return monthKey(year, month);
}

/** "September 2026" for display. Invalid keys pass through unchanged. */
export function monthLabel(key: string): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[p.month - 1]} ${p.year}`;
}

// ---------- totals (all integer cents) ----------

export function totalIncomeCents(m: BudgetMonth): number {
  return m.income.reduce((sum, e) => sum + e.cents, 0);
}

export function totalPlannedCents(m: BudgetMonth): number {
  return m.categories.reduce((sum, c) => sum + c.plannedCents, 0);
}

export function totalActualCents(m: BudgetMonth): number {
  return m.categories.reduce((sum, c) => sum + c.actualCents, 0);
}

/**
 * The zero-based budgeting figure: income minus everything you planned to
 * spend. Zero means every dollar has a job. Positive means money is
 * unassigned; negative means you planned more than you earn.
 */
export function remainingToAssignCents(m: BudgetMonth): number {
  return totalIncomeCents(m) - totalPlannedCents(m);
}

/** What is actually left: income minus what you really spent. */
export function actualLeftCents(m: BudgetMonth): number {
  return totalIncomeCents(m) - totalActualCents(m);
}

/** Planned minus actual for one category; negative means overspent. */
export function categoryLeftCents(c: BudgetCategory): number {
  return c.plannedCents - c.actualCents;
}

export { parseCents, formatMoney };

// ---------- validation ----------

/**
 * Check a month for problems worth flagging. Returns human-readable messages;
 * an empty array means the month looks fine.
 */
export function validateBudgetMonth(m: BudgetMonth): string[] {
  const problems: string[] = [];
  if (m.income.length === 0 && m.categories.length === 0) {
    problems.push('Add at least one income entry or expense category to start this month.');
    return problems;
  }
  for (const e of m.income) {
    if (e.cents !== 0 && !e.label.trim()) problems.push('An income entry has an amount but no label.');
    if (e.cents < 0) problems.push(`"${e.label.trim() || 'An income entry'}" is negative; income should be zero or more.`);
  }
  for (const c of m.categories) {
    if ((c.plannedCents !== 0 || c.actualCents !== 0) && !c.name.trim()) {
      problems.push('A category has amounts but no name.');
    }
    if (c.plannedCents < 0 || c.actualCents < 0) {
      problems.push(`"${c.name.trim() || 'A category'}" has a negative amount; use zero or more.`);
    }
  }
  return [...new Set(problems)];
}

// ---------- pure entry list operations (never mutate the input) ----------

export function addIncomeEntry(income: IncomeEntry[], entry: IncomeEntry): IncomeEntry[] {
  return addEntry(income, entry);
}

export function removeIncomeEntry(income: IncomeEntry[], id: string): IncomeEntry[] {
  return removeEntry(income, id);
}

export function addCategory(categories: BudgetCategory[], category: BudgetCategory): BudgetCategory[] {
  return addEntry(categories, category);
}

export function removeCategory(categories: BudgetCategory[], id: string): BudgetCategory[] {
  return removeEntry(categories, id);
}

// ---------- month trend & plan copying ----------

export interface MonthPoint {
  key: string;
  label: string;
  incomeCents: number;
  plannedCents: number;
  spentCents: number;
}

/**
 * Up to `limit` most recent months that have any data, oldest first.
 * Months that were never touched are skipped, so the chart has no gaps.
 */
export function monthSpendingTrend(store: BudgetStore, limit = 12): MonthPoint[] {
  const keys = Object.keys(store.months)
    .filter((k) => parseMonthKey(k) && store.months[k] && (store.months[k].income.length > 0 || store.months[k].categories.length > 0))
    .sort();
  return keys.slice(-Math.max(1, Math.trunc(limit))).map((k) => {
    const m = store.months[k];
    return {
      key: k,
      label: monthLabel(k),
      incomeCents: totalIncomeCents(m),
      plannedCents: totalPlannedCents(m),
      spentCents: totalActualCents(m),
    };
  });
}

/**
 * Copy the nearest earlier month that has data into `targetKey`: income
 * entries and categories come over with planned amounts, actuals reset to
 * zero, all with fresh ids. Returns the source month, or null when there is
 * nothing to copy.
 */
export function copyPlanFromPrevious(
  store: BudgetStore,
  targetKey: string
): { source: BudgetMonth | null; month: BudgetMonth } {
  let source: BudgetMonth | null = null;
  const earlier = Object.keys(store.months)
    .filter((k) => parseMonthKey(k) && k < targetKey)
    .sort();
  for (let i = earlier.length - 1; i >= 0; i--) {
    const m = store.months[earlier[i]];
    if (m.income.length > 0 || m.categories.length > 0) {
      source = m;
      break;
    }
  }
  if (!source) return { source: null, month: blankMonth(targetKey) };
  const month = blankMonth(targetKey);
  month.income = source.income.map((e) => ({ id: newId(), label: e.label, cents: e.cents }));
  month.categories = source.categories.map((c) => ({
    id: newId(),
    name: c.name,
    plannedCents: c.plannedCents,
    actualCents: 0,
  }));
  return { source, month };
}

// ---------- CSV export ----------

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole month as CSV: income rows, then one row per category. Amounts in dollars. */
export function monthToCsv(m: BudgetMonth): string {
  const lines = ['Type,Label,Planned,Actual'];
  for (const e of m.income) {
    const amt = (e.cents / 100).toFixed(2);
    lines.push(['Income', e.label, amt, amt].map(csvCell).join(','));
  }
  for (const c of m.categories) {
    lines.push(
      ['Category', c.name, (c.plannedCents / 100).toFixed(2), (c.actualCents / 100).toFixed(2)]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

// ---------- serialization with schema versioning ----------

export function serializeStore(store: BudgetStore): string {
  return JSON.stringify({ version: BUDGET_SCHEMA_VERSION, months: store.months });
}

function asCents(v: unknown): number {
  const n = typeof v === 'number' ? v : parseCents(v as string);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function validId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : newId();
}

function sanitizeMonth(raw: unknown, key: string): BudgetMonth {
  const m = (raw ?? {}) as Record<string, unknown>;
  const incomeRaw = m.income;
  const income: IncomeEntry[] = Array.isArray(incomeRaw)
    ? (incomeRaw as unknown[])
        .filter((e) => e && typeof e === 'object')
        .map((e) => {
          const o = e as Record<string, unknown>;
          return { id: validId(o.id), label: asString(o.label), cents: asCents(o.cents) };
        })
    : [];
  const catRaw = m.categories;
  const categories: BudgetCategory[] = Array.isArray(catRaw)
    ? (catRaw as unknown[])
        .filter((e) => e && typeof e === 'object')
        .map((e) => {
          const o = e as Record<string, unknown>;
          return {
            id: validId(o.id),
            name: asString(o.name),
            plannedCents: asCents(o.plannedCents),
            actualCents: asCents(o.actualCents),
          };
        })
    : [];
  return { version: BUDGET_SCHEMA_VERSION, monthKey: key, income, categories };
}

/**
 * Parse saved JSON back into a BudgetStore. Anything corrupt, foreign, or from
 * a different schema version falls back to an empty store instead of throwing.
 */
export function deserializeStore(raw: string | null | undefined): BudgetStore {
  const blank = blankStore();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== BUDGET_SCHEMA_VERSION) {
    return blank; // wrong shape or schema version
  }
  const p = parsed as Record<string, unknown>;
  const monthsRaw = p.months;
  if (!monthsRaw || typeof monthsRaw !== 'object') return blank;
  const months: Record<string, BudgetMonth> = {};
  for (const [key, value] of Object.entries(monthsRaw as Record<string, unknown>)) {
    if (parseMonthKey(key)) months[key] = sanitizeMonth(value, key);
  }
  return { version: BUDGET_SCHEMA_VERSION, months };
}
