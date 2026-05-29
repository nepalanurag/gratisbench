// Pure fake-data logic shared by the browser tool and the Node verification script.
// No DOM access here. All randomness flows through a seeded PRNG (mulberry32),
// so the same seed + columns + row count always produces the same dataset.
//
// The data is deliberately, obviously fake: plausible-looking test rows for
// developers, not identities. Not for fraud, full stop.

export const FAKEDATA_STORAGE_KEY = 'freekit.fake-data-generator.v1';
export const MIN_ROWS = 10;
export const MAX_ROWS = 10000;

/** xmur3 string hash -> 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the run's RNG from a numeric seed (re-roll) or a seed string. */
export function makeRng(seed: number | string): () => number {
  return mulberry32(typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed)));
}

type Rng = () => number;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function intBetween(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------- datasets ----------

const FIRST_NAMES = (
  'Aarav Abbie Abdul Abigail Adam Adeline Adrian Aisha Alan Albert Alex Alexander Alice Alicia Alison Amara Amanda Amber Amelia Amy Andre Andrea Angela Anika Anita Anna April Arjun Arthur Arya Asha Ashley Audrey Austin Ava Ayaan Babar Barbara Beatrice Bella Benjamin Bethany Bianca Bill Blake Bonnie Boris Brandon Brenda Brian Bridget Brooke Bruno Bryan Caleb Calvin Camila Carlos Carmen Caroline Carrie Casey Catherine Celia Charles Charlotte Chloe Chris Christina Claire Clara Claudia Colin Connor Courtney Craig Crystal Curtis Cynthia Daisy Daniel Dante Daphne David Dean Deborah Dev Diana Diego Divya Dominic Donna Dorothy Douglas Dylan Edward Elena Eli Elias Elijah Elise Elizabeth Ella Elliot Emily Emma Eric Erica Erik Erin Ethan Eva Evan Evelyn Fabian Fatima Felix Fiona Florence Frances Frank Fred Gabriel Gail Gary Gavin George Georgia Gina Glen Gloria Grace Graham Grant Greg Hailey Hannah Harish Henry Holly Howard Hugh Hugo Ian Ida Ingrid Irene Iris Isaac Isabel Isabella Ivan Ivy Jack Jackson Jacob Jade James Jane Jasmine Jason Jay Jeffrey Jennifer Jenny Jeremy Jerry Jessica Jill Joan Joe Joel John Johnny Jonah Jonas Jonathan Jorge Jose Joseph Josh Juan Julia Julian Julie Kabir Karen Karl Kate Katherine Katie Kayla Keith Kelly Ken Kevin Kim Kiran Kris Kyle Laila Lance Laura Lauren Leah Leo Liam Lily Linda Lisa Logan Louis Lucas Lucy Luis Luke Lydia Madison Maha Malik Manuel Marco Marcus Margaret Maria Marie Marina Mark Martin Mary Mason Matt Maya Megan Meera Mia Michael Michelle Miguel Mira Miriam Molly Mona Monica Morgan Nadia Nancy Naomi Natalie Nathan Neha Neil Nelson Nick Nicole Nina Noah Nora Norman Oliver Olivia Omar Oscar Owen Pablo Paige Pamela Parker Pat Paul Paula Penny Peter Phil Philip Pia Pierre Priya Quinn Rachel Rafael Raj Ralph Randy Ravi Ray Rebecca Rhea Richard Rita Robert Robin Roger Rohan Rosa Rose Ruby Ryan Sahil Sam Samuel Sandra Sara Sarah Scott Sean Seth Shane Sharon Sheila Shirley Sia Simon Sofia Sonia Sophie Stella Stephanie Steve Stuart Sudha Suman Sunil Susan Tanya Tara Teresa Tess Theo Thomas Tina Todd Tom Tony Tracy Travis Troy Uma Umar Ursula Valerie Vera Victor Victoria Vijay Vikram Vince Violet Vivian Walter Wanda Wayne Wendy Will William Xander Xavier Yara Yash Yuki Yusuf Zara Zoe'
).split(' ');

const LAST_NAMES = (
  'Abbott Adams Agarwal Ahmed Ahuja Ali Allen Anderson Bailey Baker Banerjee Barnes Bell Bennett Bhatt Brooks Brown Bryant Burke Butler Campbell Carter Castillo Castro Chavez Chen Choudhary Clark Cohen Cole Collins Cook Cooper Cox Cruz Curry Davis Dawson Delgado Diaz Dixon Douglas Doyle Duncan Dunn Edwards Ellis Evans Farmer Ferguson Fisher Fleming Foster Fox Freeman Frost Garcia Garg Garner Gates George Gibson Gill Gomez Gonzalez Gordon Graham Grant Gray Green Gupta Hall Hamilton Harris Harrison Hart Harvey Hayes Henderson Hernandez Hicks Hill Hodges Hoffman Holmes Howard Howell Hubbard Hughes Hunt Hussain Ibarra Ingram Iyer Jackson Jacobs James Jenkins Jensen Johnson Jones Jordan Joseph Joshi Kane Kapoor Kaufman Keller Kelly Kennedy Khan Kim King Klein Knight Koch Kohli Kumar Lane Larson Lawson Lee Leonard Lewis Lopez Lowe Lucas Luna Lynch Mahajan Malik Malone Mann Marshall Martin Martinez Mason Mathews Mathur May Mayer McCarthy McDonald Mehta Menon Meyer Miller Mishra Mitchell Moore Morales Morgan Morris Murphy Myers Nair Naylor Nelson Newman Nguyen Nolan Norris North Norton Novak Oakes Oliver Olson Ortiz Osborn Owen Owens Pace Padilla Page Palmer Pandey Parker Patel Pathak Patterson Payne Pearson Pena Perez Perry Peterson Phillips Pierce Pittman Pope Porter Powell Prasad Price Quinn Rahman Rao Ray Reddy Reed Reeves Reid Reyes Reynolds Rhodes Rice Richardson Riley Rivera Roberts Rogers Ross Rowe Roy Ruiz Russell Ryan Sanders Schmidt Schneider Scott Shah Sharma Shaw Shelton Sherman Silva Simmons Simon Singh Smith Snyder Spencer Stafford Stanley Steele Stephens Stevens Stewart Stone Strong Stuart Sullivan Sutton Swami Taylor Thomas Thompson Tiwari Todd Torres Tran Trivedi Tucker Turner Tyler Vance Vang Vargas Vaughn Vazquez Verma Vickers Wade Wagner Wallace Walsh Walters Wang Ward Warner Warren Washington Waters Watkins Watson Watts Weaver Webb Weber Webster Weeks Wells West Wheeler White Whitfield Wiley Wilkins Williams Willis Wilson Wolfe Wood Woods Wright Yadav Yates Young Zimmerman'
).split(' ');

const CITIES = [
  'Springfield', 'Riverside', 'Franklin', 'Greenville', 'Bristol', 'Clinton', 'Fairview', 'Salem',
  'Ashland', 'Milford', 'Georgetown', 'Clayton', 'Jackson', 'Dayton', 'Florence', 'Newport',
  'Oxford', 'Burlington', 'Milton', 'Auburn', 'Claremont', 'Dover', 'Elgin', 'Fulton',
  'Gainesville', 'Hudson', 'Irving', 'Joliet', 'Kingston', 'Lexington', 'Marion', 'Norwalk',
  'Oakland', 'Portland', 'Quincy', 'Redmond', 'Shelby', 'Troy', 'Union', 'Vernon',
  'Warren', 'York', 'Bedford', 'Camden', 'Denton', 'Eldridge', 'Fremont', 'Granite',
];

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY',
];

const STREET_NAMES = [
  'Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington', 'Lake', 'Hill', 'Park',
  'Sunset', 'River', 'Meadow', 'Willow', 'Chestnut', 'Walnut', 'Lincoln', 'Jefferson',
  'Madison', 'Monroe', 'Adams', 'Harbor', 'Mill', 'Church', 'School', 'Depot', 'Railroad',
  'Summit', 'Vista', 'Grove', 'Forest', 'Brook', 'Valley', 'Ridge', 'Highland', 'Spring',
];
const STREET_SUFFIXES = ['St', 'Ave', 'Blvd', 'Rd', 'Ln', 'Dr', 'Ct', 'Way', 'Pl', 'Ter'];

const COMPANY_PREFIXES = [
  'Northwind', 'Brightline', 'Bluepeak', 'Redwood', 'Ironclad', 'Silverline', 'Copperfield',
  'Stonebridge', 'Clearwater', 'Highfield', 'Eastgate', 'Westbrook', 'Summit', 'Harbor',
  'Pinnacle', 'Foxglove', 'Ember', 'Quartz', 'Juniper', 'Alder', 'Beacon', 'Cinder',
  'Driftwood', 'Fern', 'Gale', 'Hearth', 'Ivy', 'Jolt', 'Kestrel', 'Lark',
];
const COMPANY_SUFFIXES = ['Labs', 'Co', 'Studio', 'Works', 'Group', 'Partners', 'Systems', 'Supply', 'Goods', 'Collective'];

const JOB_TITLES = [
  'Software Engineer', 'Product Manager', 'Designer', 'Data Analyst', 'Marketing Manager',
  'Sales Representative', 'Customer Support Lead', 'Operations Manager', 'HR Coordinator',
  'Financial Analyst', 'QA Engineer', 'DevOps Engineer', 'Content Writer', 'Accountant',
  'Project Coordinator', 'UX Researcher', 'Business Analyst', 'Recruiter', 'Office Manager',
  'Technical Writer', 'Nurse Practitioner', 'Teacher', 'Electrician', 'Chef', 'Paralegal',
];

const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.test', 'sample.test', 'demo.test'];

const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum perspiciatis unde omnis iste natus error voluptatem accusantium doloremque laudantium totam rem aperiam eaque abillo inventore veritatis quasi architecto beatae vitae dicta explicabo aspernatur odit aut fugit consequuntur magni dolores eos qui ratione sequi nesciunt neque porro quisquam dolorem numquam eius modi tempora incidunt magnam quaerat'
).split(' ');

const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'India',
  'Japan', 'Brazil', 'Mexico', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Ireland',
];

// ---------- column model ----------

export type ColumnType =
  | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone'
  | 'street' | 'city' | 'state' | 'zip' | 'country' | 'address'
  | 'company' | 'jobTitle'
  | 'lorem' | 'sentence' | 'paragraph'
  | 'integer' | 'decimal' | 'date' | 'uuid' | 'boolean';

export interface ColumnDef {
  id: string;
  type: ColumnType;
  label: string;
  words?: number; // lorem
  intMin?: number;
  intMax?: number; // integer
  decMin?: number;
  decMax?: number;
  decPlaces?: number; // decimal
  dateFrom?: string;
  dateTo?: string; // date, YYYY-MM-DD
}

export type Cell = string | number | boolean;

export const COLUMN_TYPES: { type: ColumnType; label: string; hint: string }[] = [
  { type: 'firstName', label: 'First name', hint: 'Given name' },
  { type: 'lastName', label: 'Last name', hint: 'Family name' },
  { type: 'fullName', label: 'Full name', hint: 'First + last' },
  { type: 'email', label: 'Email', hint: 'name@example.com style' },
  { type: 'phone', label: 'Phone', hint: 'US (555) format' },
  { type: 'street', label: 'Street address', hint: 'Number + street' },
  { type: 'city', label: 'City', hint: '' },
  { type: 'state', label: 'State', hint: '2-letter code' },
  { type: 'zip', label: 'ZIP code', hint: '5 digits' },
  { type: 'country', label: 'Country', hint: '' },
  { type: 'address', label: 'Full address', hint: 'Street, city, state, ZIP' },
  { type: 'company', label: 'Company', hint: 'Fictional company' },
  { type: 'jobTitle', label: 'Job title', hint: '' },
  { type: 'lorem', label: 'Lorem text', hint: 'N words of lorem ipsum' },
  { type: 'sentence', label: 'Sentence', hint: 'One lorem sentence' },
  { type: 'paragraph', label: 'Paragraph', hint: 'Several lorem sentences' },
  { type: 'integer', label: 'Integer', hint: 'Whole number in range' },
  { type: 'decimal', label: 'Decimal', hint: 'Number with decimals' },
  { type: 'date', label: 'Date', hint: 'YYYY-MM-DD in range' },
  { type: 'uuid', label: 'UUID', hint: 'Random v4 UUID' },
  { type: 'boolean', label: 'Yes / No', hint: 'true or false' },
];

export function columnTypeLabel(type: ColumnType): string {
  return COLUMN_TYPES.find((c) => c.type === type)?.label ?? type;
}

let colCounter = 0;
export function newColumnId(): string {
  colCounter += 1;
  return `col${Date.now().toString(36)}${colCounter.toString(36)}`;
}

export function defaultColumns(): ColumnDef[] {
  return [
    { id: newColumnId(), type: 'fullName', label: 'name' },
    { id: newColumnId(), type: 'email', label: 'email' },
    { id: newColumnId(), type: 'phone', label: 'phone' },
    { id: newColumnId(), type: 'address', label: 'address' },
    { id: newColumnId(), type: 'company', label: 'company' },
    { id: newColumnId(), type: 'jobTitle', label: 'job_title' },
    { id: newColumnId(), type: 'date', label: 'signup_date', dateFrom: '2022-01-01', dateTo: '2026-09-23' },
  ];
}

// ---------- generators ----------

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function words(rng: Rng, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pick(rng, LOREM_WORDS));
  return out;
}

function sentence(rng: Rng): string {
  const w = words(rng, intBetween(rng, 8, 16));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
}

function genUuid(rng: Rng): string {
  const hex = '0123456789abcdef';
  const h = (n: number) => Array.from({ length: n }, () => hex[Math.floor(rng() * 16)]).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-${pick(rng, ['8', '9', 'a', 'b'])}${h(3)}-${h(12)}`;
}

function parseDay(s: string | undefined, fallback: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim());
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  return Number.isNaN(t) ? Date.parse(fallback) : t;
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Generate one cell value for a column. */
export function generateCell(rng: Rng, col: ColumnDef): Cell {
  switch (col.type) {
    case 'firstName':
      return pick(rng, FIRST_NAMES);
    case 'lastName':
      return pick(rng, LAST_NAMES);
    case 'fullName':
      return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    case 'email': {
      const f = slug(pick(rng, FIRST_NAMES));
      const l = slug(pick(rng, LAST_NAMES));
      const num = rng() < 0.4 ? String(intBetween(rng, 1, 99)) : '';
      return `${f}.${l}${num}@${pick(rng, EMAIL_DOMAINS)}`;
    }
    case 'phone':
      // 555 central-office codes are reserved as fictional in North America,
      // and the 0100-0199 line block is the fictional range. Area code stays
      // plausible so formatted output looks like a real US number.
      return `(${intBetween(rng, 200, 989)}) 555-${String(intBetween(rng, 100, 199)).padStart(4, '0')}`;
    case 'street':
      return `${intBetween(rng, 1, 9899)} ${pick(rng, STREET_NAMES)} ${pick(rng, STREET_SUFFIXES)}`;
    case 'city':
      return pick(rng, CITIES);
    case 'state':
      return pick(rng, STATES);
    case 'zip':
      return String(intBetween(rng, 0, 99999)).padStart(5, '0');
    case 'country':
      return pick(rng, COUNTRIES);
    case 'address':
      return `${intBetween(rng, 1, 9899)} ${pick(rng, STREET_NAMES)} ${pick(rng, STREET_SUFFIXES)}, ${pick(rng, CITIES)}, ${pick(rng, STATES)} ${String(intBetween(rng, 0, 99999)).padStart(5, '0')}`;
    case 'company':
      return `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`;
    case 'jobTitle':
      return pick(rng, JOB_TITLES);
    case 'lorem': {
      const n = Math.max(1, Math.min(500, Math.round(col.words ?? 25)));
      const w = words(rng, n);
      w[0] = w[0][0].toUpperCase() + w[0].slice(1);
      return w.join(' ') + '.';
    }
    case 'sentence':
      return sentence(rng);
    case 'paragraph': {
      const n = intBetween(rng, 3, 5);
      return Array.from({ length: n }, () => sentence(rng)).join(' ');
    }
    case 'integer':
      return intBetween(rng, col.intMin ?? 1, col.intMax ?? 100);
    case 'decimal': {
      const places = Math.max(0, Math.min(6, Math.round(col.decPlaces ?? 2)));
      const v = (col.decMin ?? 0) + rng() * ((col.decMax ?? 100) - (col.decMin ?? 0));
      return Number(v.toFixed(places));
    }
    case 'date': {
      const from = parseDay(col.dateFrom, '2020-01-01');
      const to = parseDay(col.dateTo, '2026-12-31');
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const day = lo + Math.floor(rng() * ((hi - lo) / 86400000 + 1)) * 86400000;
      return fmtDay(day);
    }
    case 'uuid':
      return genUuid(rng);
    case 'boolean':
      return rng() < 0.5;
  }
}

/** Generate the full dataset: rows outer, columns inner, one shared RNG stream. */
export function generateRows(seed: number | string, columns: ColumnDef[], rowCount: number): Cell[][] {
  const n = clampRowCount(rowCount);
  const rng = makeRng(seed);
  const rows: Cell[][] = [];
  for (let r = 0; r < n; r++) {
    rows.push(columns.map((c) => generateCell(rng, c)));
  }
  return rows;
}

// ---------- validation ----------

export function clampRowCount(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(n)));
}

/** Table/column identifiers for SQL: letters, digits, underscore; never empty. */
export function sanitizeIdentifier(name: string, fallback: string): string {
  const clean = name.trim().replace(/[^A-Za-z0-9_]/g, '_');
  const collapsed = clean.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (collapsed.length === 0) return fallback;
  const fixed = /^\d/.test(collapsed) ? `_${collapsed}` : collapsed;
  return fixed.slice(0, 64);
}

// ---------- output formats ----------

function csvCell(v: Cell): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV: header row + rows, CRLF line endings. */
export function toCSV(columns: ColumnDef[], rows: Cell[][]): string {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => r.map(csvCell).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

function jsonCell(v: Cell): string | number | boolean {
  return v;
}

/** Pretty-printed JSON array of objects keyed by column label. */
export function toJSON(columns: ColumnDef[], rows: Cell[][]): string {
  const objs = rows.map((r) => {
    const o: Record<string, string | number | boolean> = {};
    columns.forEach((c, i) => {
      o[c.label || `column_${i + 1}`] = jsonCell(r[i]);
    });
    return o;
  });
  return JSON.stringify(objs, null, 2) + '\n';
}

function sqlValue(v: Cell): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const SQL_BATCH = 500;

/** SQL INSERT statements, batched 500 rows per statement. */
export function toSQL(columns: ColumnDef[], rows: Cell[][], tableName: string): string {
  const table = sanitizeIdentifier(tableName, 'fake_data');
  const cols = columns.map((c, i) => `\`${sanitizeIdentifier(c.label, `column_${i + 1}`)}\``);
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += SQL_BATCH) {
    const batch = rows
      .slice(i, i + SQL_BATCH)
      .map((r) => `(${r.map(sqlValue).join(', ')})`)
      .join(',\n');
    chunks.push(`INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES\n${batch};`);
  }
  return chunks.join('\n\n') + '\n';
}

export type OutputFormat = 'csv' | 'json' | 'sql';

export function formatOutput(format: OutputFormat, columns: ColumnDef[], rows: Cell[][], tableName = 'fake_data'): string {
  if (format === 'json') return toJSON(columns, rows);
  if (format === 'sql') return toSQL(columns, rows, tableName);
  return toCSV(columns, rows);
}

export function outputFileName(format: OutputFormat): string {
  return `fake-data.${format}`;
}

export function outputMime(format: OutputFormat): string {
  return format === 'json' ? 'application/json' : format === 'sql' ? 'application/sql' : 'text/csv';
}

// ---------- column list ops (pure) ----------

export function addColumn(columns: ColumnDef[], type: ColumnType): ColumnDef[] {
  const label = columnTypeLabel(type).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return [...columns, { id: newColumnId(), type, label }];
}

export function removeColumn(columns: ColumnDef[], id: string): ColumnDef[] {
  return columns.filter((c) => c.id !== id);
}

export function moveColumn(columns: ColumnDef[], id: string, direction: -1 | 1): ColumnDef[] {
  const i = columns.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= columns.length) return columns;
  const next = [...columns];
  next[i] = columns[j];
  next[j] = columns[i];
  return next;
}

export function updateColumn(columns: ColumnDef[], id: string, patch: Partial<ColumnDef>): ColumnDef[] {
  return columns.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

// ---------- persistence ----------

export interface FakeDataSettings {
  version: 1;
  columns: ColumnDef[];
  rowCount: number;
  format: OutputFormat;
  tableName: string;
}

export function blankSettings(): FakeDataSettings {
  return { version: 1, columns: defaultColumns(), rowCount: 100, format: 'csv', tableName: 'fake_data' };
}

export function serializeSettings(s: FakeDataSettings): string {
  return JSON.stringify({ ...s, version: 1 });
}

function isColumnType(v: unknown): v is ColumnType {
  return typeof v === 'string' && COLUMN_TYPES.some((c) => c.type === v);
}

function sanitizeColumn(raw: unknown): ColumnDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isColumnType(o.type)) return null;
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 64) : columnTypeLabel(o.type);
  const num = (v: unknown, dflt: number | undefined): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newColumnId(),
    type: o.type,
    label,
    words: num(o.words, undefined),
    intMin: num(o.intMin, undefined),
    intMax: num(o.intMax, undefined),
    decMin: num(o.decMin, undefined),
    decMax: num(o.decMax, undefined),
    decPlaces: num(o.decPlaces, undefined),
    dateFrom: str(o.dateFrom),
    dateTo: str(o.dateTo),
  };
}

export function deserializeSettings(raw: string | null | undefined): FakeDataSettings {
  const blank = blankSettings();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) return blank;
  const p = parsed as Record<string, unknown>;
  const cols = Array.isArray(p.columns)
    ? (p.columns as unknown[]).map(sanitizeColumn).filter((c): c is ColumnDef => c !== null)
    : [];
  const format: OutputFormat = p.format === 'json' || p.format === 'sql' ? p.format : 'csv';
  return {
    version: 1,
    columns: cols.length > 0 ? cols : blank.columns,
    rowCount: clampRowCount(typeof p.rowCount === 'number' ? p.rowCount : 100),
    format,
    tableName: typeof p.tableName === 'string' && p.tableName.trim() ? p.tableName.trim().slice(0, 64) : 'fake_data',
  };
}
