// Pure subscription-tracker logic shared by the browser tool and the Node
// verification script. No DOM access here. Money is integer cents; dates are
// plain "YYYY-MM-DD" strings compared lexicographically (safe for ISO dates).

import { parseCents, formatMoney } from './invoice-core.ts';
import { newId } from './resume-core.ts';

export const SUBS_SCHEMA_VERSION = 1;
export const SUBS_STORAGE_KEY = 'freekit.subscription-tracker.v1';

export type BillingCycle = 'weekly' | 'monthly' | 'yearly';

export interface Subscription {
  id: string;
  name: string;
  costCents: number;
  cycle: BillingCycle;
  /** First (or any known) billing date, YYYY-MM-DD. Renewals anchor to it. */
  startDate: string;
  category: string;
  /** Paused subscriptions stay in the list but are excluded from totals and renewals. */
  paused: boolean;
}

export interface SubscriptionStore {
  version: number;
  subscriptions: Subscription[];
}

export function isCycle(v: unknown): v is BillingCycle {
  return v === 'weekly' || v === 'monthly' || v === 'yearly';
}

export function blankSubscription(): Subscription {
  return { id: newId(), name: '', costCents: 0, cycle: 'monthly', startDate: '', category: '', paused: false };
}

export function blankStore(): SubscriptionStore {
  return { version: SUBS_SCHEMA_VERSION, subscriptions: [] };
}

/** Sample subscriptions so the dashboard is alive before typing a word. */
export function exampleSubscriptions(): Subscription[] {
  return [
    { id: newId(), name: 'StreamFlix', costCents: 1549, cycle: 'monthly', startDate: '2026-09-05', category: 'Streaming', paused: false },
    { id: newId(), name: 'CloudDrive Pro', costCents: 11999, cycle: 'yearly', startDate: '2026-03-14', category: 'Storage', paused: false },
    { id: newId(), name: 'MealBox', costCents: 2999, cycle: 'weekly', startDate: '2026-09-21', category: 'Food', paused: false },
  ];
}

// ---------- date helpers (pure, calendar-correct) ----------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict ISO date check: shape right AND a real calendar date. */
export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(String(s).trim());
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function parts(iso: string): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(iso)!;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today's date in local time as YYYY-MM-DD. */
export function todayLocalISO(d: Date = new Date()): string {
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Add whole months to an ISO date, clamping the day to the target month.
 * Jan 31 + 1 month = Feb 28 (or 29); Jan 31 + 2 months = Mar 31, because the
 * anchor stays the original day, not the clamped one.
 */
export function addMonthsClamped(iso: string, delta: number): string {
  const { y, m, d } = parts(iso);
  const total = y * 12 + (m - 1) + Math.trunc(delta);
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Add whole years, clamping Feb 29 to Feb 28 in non-leap years. */
export function addYearsClamped(iso: string, delta: number): string {
  const { y, m, d } = parts(iso);
  const ny = y + Math.trunc(delta);
  return toISO(ny, m, Math.min(d, daysInMonth(ny, m)));
}

/** Add whole days (UTC-based, so DST transitions cannot shift the date). */
export function addDays(iso: string, n: number): string {
  const { y, m, d } = parts(iso);
  const t = Date.UTC(y, m - 1, d) + Math.trunc(n) * 86400000;
  const dt = new Date(t);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * The next renewal date on or after `today`, anchored to the start date.
 * Monthly billing keeps the original day-of-month (clamped for short months),
 * so a Jan 31 subscription renews Feb 28 then Mar 31.
 */
export function nextRenewalDate(startISO: string, cycle: BillingCycle, todayISO: string): string {
  if (!isValidISODate(startISO) || !isValidISODate(todayISO)) {
    throw new Error(`Invalid date: ${startISO} / ${todayISO}`);
  }
  if (startISO >= todayISO) return startISO;
  if (cycle === 'weekly') {
    let cur = startISO;
    for (let i = 0; i < 10000 && cur < todayISO; i++) cur = addDays(cur, 7);
    return cur;
  }
  if (cycle === 'monthly') {
    let k = 1;
    for (; k <= 1200; k++) {
      const cand = addMonthsClamped(startISO, k);
      if (cand >= todayISO) return cand;
    }
    throw new Error('Renewal too far in the future');
  }
  let k = 1;
  for (; k <= 200; k++) {
    const cand = addYearsClamped(startISO, k);
    if (cand >= todayISO) return cand;
  }
  throw new Error('Renewal too far in the future');
}

/** Whole days from `from` to `to` (to - from); both YYYY-MM-DD. */
export function daysUntil(fromISO: string, toISODate: string): number {
  const a = parts(fromISO);
  const b = parts(toISODate);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

/** "renews today" / "renews tomorrow" / "renews in N days". */
export function renewalLabel(days: number): string {
  if (days <= 0) return 'renews today';
  if (days === 1) return 'renews tomorrow';
  return `renews in ${days} days`;
}

/** "Sep 23, 2026" for display. Invalid input passes through as-is. */
export function formatISODate(iso: string): string {
  if (!isValidISODate(iso)) return iso;
  const { y, m, d } = parts(iso);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${d}, ${y}`;
}

// ---------- cost math (integer cents) ----------

/**
 * What a subscription costs per month on average. Weekly uses 52/12;
 * yearly is divided by 12. Rounded to the cent.
 */
export function monthlyEquivalentCents(costCents: number, cycle: BillingCycle): number {
  if (cycle === 'weekly') return Math.round((costCents * 52) / 12);
  if (cycle === 'yearly') return Math.round(costCents / 12);
  return costCents;
}

export interface SubscriptionTotals {
  monthlyCents: number;
  yearlyCents: number;
  perDayCents: number;
  count: number;
}

export function totals(subs: Subscription[]): SubscriptionTotals {
  const active = subs.filter((s) => !s.paused);
  const monthlyCents = active.reduce((sum, s) => sum + monthlyEquivalentCents(s.costCents, s.cycle), 0);
  const yearlyCents = Math.round(monthlyCents * 12);
  return {
    monthlyCents,
    yearlyCents,
    perDayCents: Math.round(yearlyCents / 365),
    count: active.length,
  };
}

export interface RenewalInfo {
  sub: Subscription;
  renewal: string; // YYYY-MM-DD
  days: number;
}

/** Subscriptions sorted by next renewal, soonest first. Paused ones are excluded. */
export function sortedByRenewal(subs: Subscription[], todayISO: string): RenewalInfo[] {
  return subs
    .filter((s) => !s.paused)
    .map((sub) => {
      const renewal = nextRenewalDate(sub.startDate, sub.cycle, todayISO);
      return { sub, renewal, days: daysUntil(todayISO, renewal) };
    })
    .sort((a, b) => (a.renewal < b.renewal ? -1 : a.renewal > b.renewal ? 1 : 0));
}

/** Renewals due within the next `withinDays` days (default 7), soonest first. */
export function upcomingRenewals(subs: Subscription[], todayISO: string, withinDays = 7): RenewalInfo[] {
  return sortedByRenewal(subs, todayISO).filter((r) => r.days <= withinDays);
}

// ---------- category breakdown & CSV export ----------

export interface CategoryTotal {
  category: string;
  monthlyCents: number;
  count: number;
}

/** Active subscriptions grouped by category, costliest first. Empty categories land under "Uncategorized". */
export function categoryTotals(subs: Subscription[]): CategoryTotal[] {
  const map = new Map<string, { monthlyCents: number; count: number }>();
  for (const s of subs) {
    if (s.paused) continue;
    const key = s.category.trim() || 'Uncategorized';
    const e = map.get(key) ?? { monthlyCents: 0, count: 0 };
    e.monthlyCents += monthlyEquivalentCents(s.costCents, s.cycle);
    e.count += 1;
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All subscriptions (including paused) as CSV. Amounts in dollars per billing period. */
export function subscriptionsToCsv(subs: Subscription[]): string {
  const lines = ['Name,Cost,Cycle,Billing date,Category,Status'];
  for (const s of subs) {
    lines.push(
      [s.name, (s.costCents / 100).toFixed(2), s.cycle, s.startDate, s.category, s.paused ? 'paused' : 'active']
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export { parseCents, formatMoney };

// ---------- validation ----------

/**
 * Check a subscription for problems. Returns human-readable messages;
 * an empty array means it is fine to save.
 */
export function validateSubscription(s: Subscription): string[] {
  const problems: string[] = [];
  if (!s.name.trim()) problems.push('Give the subscription a name.');
  if (s.costCents <= 0) problems.push('Enter a cost greater than zero.');
  if (!isCycle(s.cycle)) problems.push('Pick a billing cycle: weekly, monthly, or yearly.');
  if (!isValidISODate(s.startDate)) problems.push('Enter a valid billing date (the date picker handles this).');
  return problems;
}

// ---------- pure list ops (never mutate the input) ----------

export function addSubscription(subs: Subscription[], sub: Subscription): Subscription[] {
  return [...subs, sub];
}

export function removeSubscription(subs: Subscription[], id: string): Subscription[] {
  return subs.filter((s) => s.id !== id);
}

export function updateSubscription(subs: Subscription[], sub: Subscription): Subscription[] {
  return subs.map((s) => (s.id === sub.id ? sub : s));
}

// ---------- serialization with schema versioning ----------

export function serializeStore(store: SubscriptionStore): string {
  return JSON.stringify({ version: SUBS_SCHEMA_VERSION, subscriptions: store.subscriptions });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function validId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : newId();
}

/**
 * Parse saved JSON back into a SubscriptionStore. Anything corrupt, foreign,
 * or from a different schema version falls back to an empty store.
 * Entries that fail validation are dropped rather than kept half-broken.
 */
export function deserializeStore(raw: string | null | undefined): SubscriptionStore {
  const blank = blankStore();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== SUBS_SCHEMA_VERSION) {
    return blank; // wrong shape or schema version
  }
  const p = parsed as Record<string, unknown>;
  const list = p.subscriptions;
  if (!Array.isArray(list)) return blank;
  const subscriptions: Subscription[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const sub: Subscription = {
      id: validId(o.id),
      name: asString(o.name),
      costCents: Math.trunc(typeof o.costCents === 'number' && Number.isFinite(o.costCents) ? o.costCents : 0),
      cycle: isCycle(o.cycle) ? o.cycle : 'monthly',
      startDate: asString(o.startDate),
      category: asString(o.category),
      paused: o.paused === true,
    };
    if (validateSubscription(sub).length === 0) subscriptions.push(sub);
  }
  return { version: SUBS_SCHEMA_VERSION, subscriptions };
}
