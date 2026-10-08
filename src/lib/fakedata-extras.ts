// Extra fake-data column types, extra export formats, and larger bulk
// generation. The core model only knows its own column types and three
// formats; everything extra lives here so the core stays untouched.

import {
  COLUMN_TYPES,
  generateRows,
  makeRng,
  type Cell,
  type ColumnDef,
} from './fakedata-core.ts';

export const FAKEDATA_EXTRAS_KEY = 'truepdf.fakedata-generator.extras.v1';
export const EXTRA_MAX_ROWS = 50000;

export interface ExtraColumnTypeDef {
  type: string;
  label: string;
  hint: string;
}

export const EXTRA_COLUMN_TYPES: ExtraColumnTypeDef[] = [
  { type: 'username', label: 'Username', hint: 'handle_42 style' },
  { type: 'password', label: 'Password', hint: 'random 12-char' },
  { type: 'domain', label: 'Domain', hint: 'example.com style' },
  { type: 'url', label: 'URL', hint: 'full https link' },
  { type: 'hexColor', label: 'Hex color', hint: '#a63d21 style' },
  { type: 'colorName', label: 'Color name', hint: 'Brick, Navy…' },
  { type: 'currencyCode', label: 'Currency code', hint: 'USD, EUR…' },
  { type: 'language', label: 'Language', hint: 'English, Spanish…' },
  { type: 'timezone', label: 'Timezone', hint: 'Region/City' },
  { type: 'latitude', label: 'Latitude', hint: '-90 to 90' },
  { type: 'longitude', label: 'Longitude', hint: '-180 to 180' },
  { type: 'ipv4', label: 'IP address', hint: '192.168.x.x style' },
  { type: 'macAddress', label: 'MAC address', hint: 'AA:BB:CC:…' },
  { type: 'timeOfDay', label: 'Time of day', hint: '14:30 style' },
  { type: 'gender', label: 'Gender', hint: 'for forms testing' },
];

export function isExtraColumnType(t: unknown): t is string {
  return typeof t === 'string' && EXTRA_COLUMN_TYPES.some((e) => e.type === t);
}

/** Every type the picker can offer: core types first, extras after. */
export function allColumnTypes(): { type: string; label: string; hint: string }[] {
  return [...COLUMN_TYPES.map((c) => ({ type: c.type as string, label: c.label, hint: c.hint })), ...EXTRA_COLUMN_TYPES];
}

export function isKnownColumnType(t: unknown): boolean {
  if (typeof t !== 'string') return false;
  return COLUMN_TYPES.some((c) => c.type === t) || isExtraColumnType(t);
}

// ---------- value pools ----------

const USER_ADJ = ['quiet', 'bright', 'swift', 'bold', 'calm', 'clever', 'happy', 'lucky', 'nimble', 'prime', 'rapid', 'sunny'];
const USER_NOUN = ['fox', 'tiger', 'hawk', 'wolf', 'otter', 'raven', 'panda', 'koala', 'lynx', 'badger', 'falcon', 'bison'];
const DOMAINS = ['example.com', 'mailbox.org', 'fastmail.net', 'inbox.dev', 'postbox.io', 'letterbox.co', 'dispatch.app', 'courier.site'];
const URL_PATHS = ['about', 'pricing', 'blog', 'docs', 'signup', 'contact', 'features', 'help', 'status', 'changelog'];
const COLOR_NAMES = ['Brick', 'Navy', 'Forest', 'Plum', 'Gold', 'Slate', 'Teal', 'Crimson', 'Olive', 'Indigo', 'Rust', 'Mauve'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'INR', 'BRL', 'MXN', 'SGD', 'NZD', 'SEK', 'ZAR', 'AED'];
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Hindi', 'Arabic', 'Korean', 'Turkish'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/Sao_Paulo'];
const GENDERS = ['Female', 'Male', 'Non-binary'];
const PW_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';

type Rng = () => number;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function intBetween(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Generate one cell for an extra column type. */
export function generateExtraCell(rng: Rng, type: string): Cell {
  switch (type) {
    case 'username':
      return `${pick(rng, USER_ADJ)}_${pick(rng, USER_NOUN)}${intBetween(rng, 1, 99)}`;
    case 'password':
      return Array.from({ length: 12 }, () => PW_CHARS[Math.floor(rng() * PW_CHARS.length)]).join('');
    case 'domain':
      return pick(rng, DOMAINS);
    case 'url':
      return `https://${pick(rng, DOMAINS)}/${pick(rng, URL_PATHS)}`;
    case 'hexColor': {
      const n = intBetween(rng, 0, 0xffffff);
      return `#${n.toString(16).padStart(6, '0')}`;
    }
    case 'colorName':
      return pick(rng, COLOR_NAMES);
    case 'currencyCode':
      return pick(rng, CURRENCIES);
    case 'language':
      return pick(rng, LANGUAGES);
    case 'timezone':
      return pick(rng, TIMEZONES);
    case 'latitude':
      return Number((rng() * 180 - 90).toFixed(6));
    case 'longitude':
      return Number((rng() * 360 - 180).toFixed(6));
    case 'ipv4':
      return `${intBetween(rng, 1, 254)}.${intBetween(rng, 0, 254)}.${intBetween(rng, 0, 254)}.${intBetween(rng, 1, 254)}`;
    case 'macAddress':
      return Array.from({ length: 6 }, () => intBetween(rng, 0, 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
    case 'timeOfDay':
      return `${String(intBetween(rng, 0, 23)).padStart(2, '0')}:${String(intBetween(rng, 0, 59)).padStart(2, '0')}`;
    case 'gender':
      return pick(rng, GENDERS);
    default:
      return '';
  }
}

/** Rows for the extra-typed columns only, in column order. */
export function generateExtraRows(seed: number | string, columns: ColumnDef[], rowCount: number): Cell[][] {
  const n = Math.max(0, Math.min(EXTRA_MAX_ROWS, Math.round(rowCount)));
  const rng = makeRng(`extra:${seed}`);
  const rows: Cell[][] = [];
  for (let r = 0; r < n; r++) {
    rows.push(columns.map((c) => generateExtraCell(rng, c.type as string)));
  }
  return rows;
}

/** Interleave core-generated rows and extra-generated rows into column order. */
export function mergeRows(coreRows: Cell[][], extraRows: Cell[][], columns: ColumnDef[]): Cell[][] {
  const isExtra = columns.map((c) => isExtraColumnType(c.type));
  return coreRows.map((cr, r) => {
    const er = extraRows[r] ?? [];
    const row: Cell[] = new Array(columns.length);
    let ci = 0;
    let ei = 0;
    for (let i = 0; i < columns.length; i++) {
      row[i] = isExtra[i] ? (er[ei++] ?? '') : (cr[ci++] ?? '');
    }
    return row;
  });
}

function splitColumns(columns: ColumnDef[]): { core: ColumnDef[]; extra: ColumnDef[] } {
  return {
    core: columns.filter((c) => !isExtraColumnType(c.type)),
    extra: columns.filter((c) => isExtraColumnType(c.type)),
  };
}

const CHUNK = 10000; // core clamps to 10k rows per call; chunk for bigger sets

/**
 * Generate every row for a mixed column list. Above 10k rows the core call is
 * chunked with a derived seed per chunk so bulk exports stay deterministic.
 */
export function generateAllRows(seed: number | string, columns: ColumnDef[], rowCount: number): Cell[][] {
  const n = Math.max(1, Math.min(EXTRA_MAX_ROWS, Math.round(rowCount)));
  const { core, extra } = splitColumns(columns);
  const out: Cell[][] = [];
  let made = 0;
  let i = 0;
  while (made < n) {
    const m = Math.min(CHUNK, n - made);
    const s = `${seed}:${i}`;
    out.push(...mergeRows(generateRows(s, core, m), generateExtraRows(s, extra, m), columns));
    made += m;
    i++;
  }
  // The core clamps each chunk to a minimum of 10 rows, so a short final
  // chunk can overshoot: trim back to exactly what was asked for.
  return out.slice(0, n);
}

export function clampRowCountExtended(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(10, Math.min(EXTRA_MAX_ROWS, Math.round(n)));
}

// ---------- extra export formats ----------

export type ExtraFormat = 'tsv' | 'md' | 'html' | 'xml';

export function isExtraFormat(v: unknown): v is ExtraFormat {
  return v === 'tsv' || v === 'md' || v === 'html' || v === 'xml';
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function flat(v: Cell): string {
  return String(v);
}

export function extraOutputFileName(format: ExtraFormat): string {
  return `fake-data.${format === 'md' ? 'md' : format}`;
}

export function extraOutputMime(format: ExtraFormat): string {
  return format === 'html' ? 'text/html' : format === 'xml' ? 'application/xml' : format === 'md' ? 'text/markdown' : 'text/tab-separated-values';
}

export function formatOutputExtended(format: ExtraFormat, columns: ColumnDef[], rows: Cell[][]): string {
  const heads = columns.map((c) => c.label || String(c.type));
  if (format === 'tsv') {
    const cell = (v: Cell): string => flat(v).replace(/[\t\n\r]+/g, ' ');
    return [heads.map(cell).join('\t'), ...rows.map((r) => r.map(cell).join('\t'))].join('\n') + '\n';
  }
  if (format === 'md') {
    const cell = (v: Cell): string => flat(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    const head = `| ${heads.map(cell).join(' | ')} |`;
    const sep = `| ${heads.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
    return [head, sep, ...body].join('\n') + '\n';
  }
  if (format === 'html') {
    const th = heads.map((h) => `<th>${escHtml(h)}</th>`).join('');
    const tr = rows.map((r) => `<tr>${r.map((v) => `<td>${escHtml(flat(v))}</td>`).join('')}</tr>`).join('\n');
    return `<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tr}\n</tbody>\n</table>\n`;
  }
  // xml
  const tag = (s: string): string => {
    const t = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
    return /^[a-z]/.test(t) ? t : `f_${t}`;
  };
  const tags = heads.map(tag);
  const items = rows.map(
    (r) => `  <row>\n${r.map((v, i) => `    <${tags[i]}>${escHtml(flat(v))}</${tags[i]}>`).join('\n')}\n  </row>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n${items.join('\n')}\n</rows>\n`;
}

// ---------- persistence for the parts the core serializer drops ----------

export interface FakeDataExtrasPersist {
  columns: { id: string; type: string; label: string }[];
  format: string;
  rowCount: number;
}

export function loadFakeDataExtras(): FakeDataExtrasPersist | null {
  try {
    const raw = localStorage.getItem(FAKEDATA_EXTRAS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object' || !Array.isArray(p.columns)) return null;
    const columns = (p.columns as unknown[])
      .filter((c): c is { id: string; type: string; label: string } => {
        if (!c || typeof c !== 'object') return false;
        const o = c as Record<string, unknown>;
        return typeof o.id === 'string' && isKnownColumnType(o.type) && typeof o.label === 'string';
      })
      .map((c) => ({ id: c.id, type: c.type, label: c.label.slice(0, 64) }));
    if (columns.length === 0) return null;
    return {
      columns,
      format: typeof p.format === 'string' ? p.format : 'csv',
      rowCount: typeof p.rowCount === 'number' && Number.isFinite(p.rowCount) ? p.rowCount : 100,
    };
  } catch {
    return null;
  }
}

export function saveFakeDataExtras(columns: ColumnDef[], format: string, rowCount: number): void {
  try {
    localStorage.setItem(
      FAKEDATA_EXTRAS_KEY,
      JSON.stringify({
        columns: columns.map((c) => ({ id: c.id, type: c.type as string, label: c.label })),
        format,
        rowCount,
      })
    );
  } catch {
    // ignore
  }
}
