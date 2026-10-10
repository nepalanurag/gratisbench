// Resume import: read an existing resume file (PDF or DOCX) on-device,
// then parse the text into structured fields with simple heuristics.
// Pure logic here (no DOM at module scope) so node can import this for tests.
// DOM glue lives in ../tools/resume-import-ui.ts.
import {
  RESUME_SCHEMA_VERSION,
  blankResume,
  blankWorkEntry,
  blankEducationEntry,
  blankSkillGroup,
  blankProjectEntry,
  blankCertificationEntry,
  blankLanguageEntry,
  blankAwardEntry,
  blankPublicationEntry,
  blankCourseEntry,
} from './resume-core.ts';
import type { ResumeData } from './resume-core.ts';
import { loadPdfjs } from './pdfjs-loader.ts';

export interface ParsedWorkEntry {
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface ParsedEducationEntry {
  degree: string;
  school: string;
  location: string;
  start: string;
  end: string;
  detail: string;
}

export interface ParsedSkillGroup {
  label: string;
  items: string[];
}

export interface ParsedProjectEntry {
  name: string;
  link: string;
  detail: string;
  bullets: string[];
}

export interface ParsedCertificationEntry {
  name: string;
  issuer: string;
  year: string;
}

export interface ParsedLanguageEntry {
  language: string;
  level: string;
}

export interface ParsedAwardEntry {
  title: string;
  issuer: string;
  year: string;
  description: string;
}

export interface ParsedPublicationEntry {
  title: string;
  publisher: string;
  year: string;
  link: string;
}

export interface ParsedCourseEntry {
  name: string;
  provider: string;
  year: string;
}

export interface ParsedResume {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  summary: string;
  experience: ParsedWorkEntry[];
  education: ParsedEducationEntry[];
  skills: ParsedSkillGroup[];
  projects: ParsedProjectEntry[];
  certifications: ParsedCertificationEntry[];
  languages: ParsedLanguageEntry[];
  awards: ParsedAwardEntry[];
  publications: ParsedPublicationEntry[];
  volunteer: ParsedWorkEntry[];
  courses: ParsedCourseEntry[];
}

function blankParsed(): ParsedResume {
  return {
    fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '',
    summary: '', experience: [], education: [], skills: [], projects: [], certifications: [], languages: [],
    awards: [], publications: [], volunteer: [], courses: [],
  };
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through to the fallback below
  }
  return `imp${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------- text extraction ----------

// pdf.js is lazy-loaded (dynamic import) only after the user picks a file,
// following the same pattern as ../tools/pdf-render.ts.
export async function preloadResumeFileReaders(): Promise<void> {
  await Promise.all([loadPdfjs(), import('jszip')]);
}

/** Extract plain text from a PDF file, preserving line breaks. */
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  let doc: import('pdfjs-dist').PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypted/i.test(msg)) {
      throw new Error('This PDF is password-protected. Remove the password first, then try again.');
    }
    throw new Error(msg || 'Could not read that file as a PDF.');
  }
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = pdfItemsToLines(content.items);
    const text = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0).join('\n');
    if (text) pages.push(text);
  }
  return pages.join('\n\n');
}

interface PdfTextItem {
  str?: unknown;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
}

/**
 * Rebuild text lines from pdf.js items. Positioned items are grouped by row,
 * with repeated whitespace gutters used to restore left-to-right columns in
 * reading order. Text-only items fall back to pdf.js' end-of-line markers.
 */
export function pdfItemsToLines(items: unknown[]): string[] {
  const typed = items as PdfTextItem[];
  const rows: { y: number; x: number; width: number; fontSize: number; order: number; str: string }[] = typed
    .map((it, order) => ({
      y: Array.isArray(it.transform) ? it.transform[5] : Number.NaN,
      x: Array.isArray(it.transform) ? it.transform[4] : Number.NaN,
      width: typeof it.width === 'number' ? it.width : 0,
      fontSize: Array.isArray(it.transform) ? Math.abs(it.transform[0] ?? 0) : 0,
      order,
      str: typeof it.str === 'string' ? it.str : '',
    }))
    .filter((item) => item.str.trim().length > 0);

  if (rows.length === 0) return [];
  if (!rows.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))) {
    const lines: string[] = [];
    let cur = '';
    typed.forEach((it) => {
      cur += typeof it.str === 'string' ? it.str : '';
      if (it.hasEOL) {
        lines.push(cur);
        cur = '';
      }
    });
    if (cur.trim()) lines.push(cur);
    return lines;
  }

  rows.sort((a, b) => b.y - a.y || a.x - b.x || a.order - b.order);
  const grouped: (typeof rows)[] = [];
  const TOL = 3;
  for (const row of rows) {
    const previous = grouped[grouped.length - 1];
    if (previous && Math.abs(row.y - previous[0].y) <= TOL) {
      previous.push(row);
    } else {
      grouped.push([row]);
    }
  }

  let pageLeft = Number.POSITIVE_INFINITY;
  let pageRight = Number.NEGATIVE_INFINITY;
  for (const item of rows) {
    pageLeft = Math.min(pageLeft, item.x);
    pageRight = Math.max(pageRight, item.x + Math.max(item.width, 0));
  }
  const pageWidth = pageRight - pageLeft;
  const gutters: { x: number; row: number }[] = [];
  grouped.forEach((row, rowIndex) => {
    row.sort((a, b) => a.x - b.x || a.order - b.order);
    for (let i = 1; i < row.length; i++) {
      const left = row[i - 1];
      const right = row[i];
      const gap = right.x - (left.x + left.width);
      const fontSize = Math.max(left.fontSize, right.fontSize);
      if (gap >= Math.max(20, fontSize * 1.4)) {
        gutters.push({ x: (left.x + left.width + right.x) / 2, row: rowIndex });
      }
    }
  });

  let splitX: number | null = null;
  if (pageWidth > 0) {
    const candidates = gutters
      .filter((g) => g.x > pageLeft + pageWidth * 0.3 && g.x < pageRight - pageWidth * 0.3)
      .sort((a, b) => a.x - b.x);
    const clusters: { xs: number[]; rowIds: Set<number> }[] = [];
    for (const gutter of candidates) {
      let cluster = clusters.find((c) => Math.abs(c.xs[c.xs.length - 1] - gutter.x) <= 18);
      if (!cluster) {
        cluster = { xs: [], rowIds: new Set<number>() };
        clusters.push(cluster);
      }
      cluster.xs.push(gutter.x);
      cluster.rowIds.add(gutter.row);
    }
    const repeated = clusters
      .filter((cluster) => cluster.rowIds.size >= 2)
      .sort((a, b) => b.rowIds.size - a.rowIds.size)[0];
    if (repeated) {
      const xs = [...repeated.xs].sort((a, b) => a - b);
      splitX = xs[Math.floor(xs.length / 2)];
    }
  }

  const renderRow = (row: typeof rows): string => {
    let text = '';
    let previous: (typeof rows)[number] | undefined;
    for (const item of row) {
      if (previous) {
        const gap = item.x - (previous.x + previous.width);
        if (gap > Math.max(1, Math.max(previous.fontSize, item.fontSize) * 0.15) && !/\s$/.test(text)) {
          text += ' ';
        }
      }
      text += item.str;
      previous = item;
    }
    return text.replace(/\s+/g, ' ').trim();
  };

  if (splitX === null) return grouped.map(renderRow).filter(Boolean);

  const leftColumn: string[] = [];
  const rightColumn: string[] = [];
  for (const row of grouped) {
    const left = row.filter((item) => item.x < splitX!);
    const right = row.filter((item) => item.x >= splitX!);
    if (left.length) leftColumn.push(renderRow(left));
    if (right.length) rightColumn.push(renderRow(right));
  }
  return [...leftColumn, ...rightColumn].filter(Boolean);
}

function docxXmlToText(xml: string): string {
  const paragraphs = extractDocxParagraphs(xml);
  return paragraphs
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .join('\n');
}

function extractDocxParagraphs(xml: string): string[] {
  try {
    if (typeof DOMParser === 'undefined') throw new Error('no DOMParser here');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('bad xml');
    const paras = doc.getElementsByTagName('w:p');
    const out: string[] = [];
    for (let i = 0; i < paras.length; i++) {
      const runs = paras[i].getElementsByTagName('w:t');
      let s = '';
      for (let j = 0; j < runs.length; j++) s += runs[j].textContent ?? '';
      out.push(s);
    }
    return out;
  } catch {
    // Fallback for non-DOM environments: w:p elements as line breaks, w:t text joined.
    return xml.split(/<\/w:p[^>]*>/).map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((m) =>
          m[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&')
        )
        .join('')
    );
  }
}

/** Extract plain text from a DOCX file (a zip containing word/document.xml). */
export async function extractTextFromDocx(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip');
  let zip: import('jszip');
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('That file does not look like a Word document. Please check the file and try again.');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('That file does not look like a Word document. Please check the file and try again.');
  }
  const xml = await docFile.async('string');
  return docxXmlToText(xml);
}

// ---------- parsing ----------

type SectionKey = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'languages' | 'awards' | 'publications' | 'volunteer' | 'courses' | 'certskills';

const SECTION_DEFS: { re: RegExp; section: SectionKey }[] = [
  { re: /^(work\s+)?experience$/, section: 'experience' },
  { re: /^(employment|work|career)(\s+history)?$/, section: 'experience' },
  { re: /^professional\s+experience$/, section: 'experience' },
  { re: /^selected\s+experience$/, section: 'experience' },
  { re: /^education$/, section: 'education' },
  { re: /^academic\s+background$/, section: 'education' },
  { re: /^(technical\s+)?(skills?|expertise)$/, section: 'skills' },
  { re: /^core\s+(skills?|competencies)$/, section: 'skills' },
  { re: /^(selected\s+)?projects?$/, section: 'projects' },
  { re: /^(professional\s+)?(summary|profile)$/, section: 'summary' },
  { re: /^career\s+highlights$/, section: 'summary' },
  { re: /^about\s+me$/, section: 'summary' },
  { re: /^objective$/, section: 'summary' },
  { re: /^profile$/, section: 'summary' },
  { re: /^certifications?$/, section: 'certifications' },
  // Combined header some templates use ("CERTIFICATIONS, LANGUAGES & SKILLS"):
  // lines are routed by their prefix below.
  { re: /^certifications?,?\s+languages?\s*(&|and)?\s*skills?$/, section: 'certskills' },
  { re: /^licenses(\s+(and|&)\s+certifications?)?$/, section: 'certifications' },
  { re: /^languages?$/, section: 'languages' },
  { re: /^awards?$/, section: 'awards' },
  { re: /^honou?rs$/, section: 'awards' },
  { re: /^awards?\s+(and|&)\s+honou?rs$/, section: 'awards' },
  { re: /^honou?rs\s+(and|&)\s+awards?$/, section: 'awards' },
  { re: /^recognitions?$/, section: 'awards' },
  { re: /^publications?$/, section: 'publications' },
  { re: /^(research\s+)?papers$/, section: 'publications' },
  { re: /^selected\s+publications$/, section: 'publications' },
  { re: /^volunteer(\s+(experience|work))?$/, section: 'volunteer' },
  { re: /^volunteering$/, section: 'volunteer' },
  { re: /^community\s+service$/, section: 'volunteer' },
  { re: /^courses?$/, section: 'courses' },
  { re: /^training$/, section: 'courses' },
  { re: /^coursework$/, section: 'courses' },
  { re: /^courses?\s+(and|&)\s+training$/, section: 'courses' },
  { re: /^professional\s+development$/, section: 'courses' },
];

function detectSection(line: string): SectionKey | null {
  let clean = line.replace(/[:\s]+$/, '').trim();
  // OCR and some PDFs space headers out: "P R O J E C T S" -> "PROJECTS".
  if (/^([A-Z]\s+){2,}[A-Z]$/.test(clean)) clean = clean.replace(/\s+/g, '');
  // Strip decorative rules some templates put around headers: "-- SKILLS --".
  clean = clean.replace(/^[─━═\-–—_*#\s]+|[─━═\-–—_*#\s]+$/g, '').trim();
  if (clean.length === 0 || clean.length > 45) return null;
  for (const def of SECTION_DEFS) {
    if (def.re.test(clean.toLowerCase())) return def.section;
  }
  return null;
}

const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DATE = `(?:${MONTH})\\.?\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4}[/.-]\\d{1,2}|\\d{4}`;
const DATE_RANGE_RE = new RegExp(`(${DATE})\\s*[\\u2013\\u2014-]\\s*(${DATE}|present|current|now)\\b`, 'i');

/**
 * Strip a leading bullet/list marker. Unicode bullets (• · ▪ …) often lose
 * their trailing space in PDF text extraction and OCR ("•Developed"), so the
 * space is optional for them; ASCII markers (- * + > 1.) still require one so
 * hyphenated words and minus signs are not eaten. Returns null when the line
 * is not a bullet.
 */
const UNICODE_BULLET_RE = /^[•·▪◦▸‣⁃]\s*/;
const ASCII_BULLET_RE = /^(?:[*+>]|\d+[.)]|[-–—])\s+/;
function stripBullet(line: string): string | null {
  const u = line.match(UNICODE_BULLET_RE);
  if (u) return line.slice(u[0].length);
  const a = line.match(ASCII_BULLET_RE);
  if (a) return line.slice(a[0].length);
  return null;
}
function isBulletLine(line: string): boolean {
  return stripBullet(line) !== null;
}

/** A bare year or year range on its own line: project/section metadata, not a title. */
function isYearLike(text: string): boolean {
  return /^(19|20)\d{2}$/.test(text) || /^\d{1,2}[/.-]\d{4}$/.test(text) || DATE_RANGE_RE.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;)]*/i;
const URL_RE = /https?:\/\/[^\s,;)]+/i;
const URL_RE_G = new RegExp(URL_RE.source, 'gi');
const DOMAIN_RE = /(?<![@\w])([\w-]+\.(?:com|io|dev|design|net|org|co|app|me|info)\b[^\s,;)]*)/i;
const LOCATION_RE = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2})\b/;
const LOCATION_RE2 = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})$/;
const NAME_RE = /^([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){1,3})$/;
const ALLCAPS_NAME_RE = /^([A-Z][A-Z'’.-]+(?:\s+[A-Z][A-Z'’.-]+){1,3})$/;

function hasEnoughDigits(s: string): boolean {
  return (s.match(/\d/g) ?? []).length >= 7;
}

function parseContact(lines: string[], out: ParsedResume): void {
  if (lines.length === 0) return;
  const used = new Set<number>();

  // Name: first 2-4 word title-case line without digits or @.
  for (let i = 0; i < Math.min(lines.length, 4); i++) {
    const line = lines[i];
    if (/\d|@|http|\.com|\.io\//i.test(line)) continue;
    const m = line.match(NAME_RE);
    if (m) {
      out.fullName = m[1].trim();
      used.add(i);
      break;
    }
  }
  // Fallback: an ALL-CAPS name line.
  if (!out.fullName) {
    for (let i = 0; i < Math.min(lines.length, 4); i++) {
      const m = lines[i].match(ALLCAPS_NAME_RE);
      if (m && !/[,@\d]/.test(lines[i])) {
        out.fullName = m[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        used.add(i);
        break;
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    const email = line.match(EMAIL_RE);
    if (email && !out.email) {
      out.email = email[0];
      used.add(i);
    }
    const phone = line.match(PHONE_RE);
    if (phone && hasEnoughDigits(phone[1]) && !out.phone) {
      out.phone = phone[1].replace(/\s+/g, ' ').trim();
      used.add(i);
    }
    const li = line.match(LINKEDIN_RE);
    if (li && !out.linkedin) {
      out.linkedin = li[0];
      used.add(i);
    }
    // A contact line can hold several URLs ("linkedin.com/in/x https://github.com/x"):
    // keep LinkedIn as linkedin and the first other URL as website.
    const urls = [...line.matchAll(URL_RE_G)].map((m) => m[0]);
    for (const u of urls) {
      if (/linkedin\.com/i.test(u)) {
        if (!out.linkedin) {
          out.linkedin = u;
          used.add(i);
        }
      } else if (!out.website) {
        out.website = u.replace(/\/$/, '');
        used.add(i);
      }
    }
    if (!out.website) {
      const dom = line.match(DOMAIN_RE);
      if (dom && !/linkedin\.com/i.test(dom[0])) {
        out.website = dom[1].replace(/\/$/, '');
        used.add(i);
      }
    }
    // Some resumes write "City / Country"; treat the slash as a comma.
    // Email/phone/URLs are stripped first so a location buried in a crowded
    // contact line ("Bangalore/ Nepal name@mail.com 1234567890") is found.
    const stripped = line
      .replace(EMAIL_RE, ' ')
      .replace(PHONE_RE, ' ')
      .replace(LINKEDIN_RE, ' ')
      .replace(URL_RE_G, ' ');
    const locSrc = (/[,]/.test(stripped) ? stripped : stripped.replace(/\s*\/\s*/g, ', ')).trim();
    const loc = locSrc.match(LOCATION_RE) ?? locSrc.match(LOCATION_RE2);
    if (loc && !out.location) {
      out.location = loc[1].trim();
      // Only mark the line used if nothing else useful remains on it.
      const rest = locSrc.replace(loc[0], '').replace(/[·|]/g, '').trim();
      if (!rest) used.add(i);
    }
  }

  // Headline: the first leftover line that is short and not a sentence.
  // The found location is stripped so "Bangalore / Nepal" never becomes a title.
  const locStrip = out.location
    ? new RegExp(out.location.split(/,\s*/).map(escapeRegExp).join('\\s*[,/]\\s*'), 'i')
    : null;
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    let line = lines[i].replace(/\s*\/\s*/g, ', ');
    if (locStrip) line = line.replace(locStrip, ' ');
    line = line
      .replace(EMAIL_RE, '')
      .replace(PHONE_RE, '')
      .replace(LINKEDIN_RE, '')
      .replace(URL_RE_G, '')
      .replace(DOMAIN_RE, '')
      .replace(LOCATION_RE, '')
      .replace(/[·|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line && line.length <= 60 && !line.endsWith('.')) {
      out.title = line;
      break;
    }
  }
}

interface EntryBlock {
  headerLines: string[];
  dateLine: string;
  bodyLines: string[];
  /** A "City, Country" line sitting right under the date line, if any. */
  trailingLocation: string;
}

/** A location-looking line right after a date line: "Lalitpur, Nepal". */
function looksLikeLocation(s: string): boolean {
  const t = s.trim();
  return (
    t.length > 0 &&
    t.length <= 60 &&
    /,/.test(t) &&
    /[A-Za-z]/.test(t) &&
    !/\d{4}/.test(t) &&
    !looksLikeEntryHeader(t)
  );
}

/** A line that reads as an entry header rather than a location: degree
 * words, company suffixes, or simply too many words for "City, Region". */
function looksLikeEntryHeader(s: string): boolean {
  const t = s.trim();
  return (
    DEGREE_RE.test(t) ||
    /\b(inc|llc|corp|ltd|pvt|gmbh|co)\b\.?/i.test(t) ||
    t.split(/\s+/).filter(Boolean).length > 4
  );
}

/**
 * Split a section into entries on date-range lines.
 *
 * Real resumes order the pieces loosely: the title and company usually come
 * first, but bullets can appear before the date line and the location after
 * it. So for each date line we walk back over up to two non-bullet header
 * lines, skipping bullet lines above the first header (they belong to this
 * entry's body), and we lift a location-looking line right under the date.
 */
function splitEntries(lines: string[]): EntryBlock[] {
  const dateIdx: number[] = [];
  lines.forEach((line, i) => {
    if (DATE_RANGE_RE.test(line)) dateIdx.push(i);
  });
  if (dateIdx.length === 0) {
    const headerIndexes = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) =>
        line.length <= 100 &&
        !isBulletLine(line) &&
        !/[.!?]$/.test(line) &&
        /\s(?:\||@|at|—|–|-)\s/i.test(line)
      )
      .map(({ i }) => i);
    if (headerIndexes.length > 1) {
      return headerIndexes.map((start, i) => ({
        headerLines: [lines[start]],
        dateLine: '',
        bodyLines: lines.slice(start + 1, headerIndexes[i + 1] ?? lines.length),
        trailingLocation: '',
      }));
    }
    return lines.length > 0
      ? [{ headerLines: [lines[0]], dateLine: '', bodyLines: lines.slice(1), trailingLocation: '' }]
      : [];
  }
  interface Walk {
    headers: string[];
    headerLineCount: number;
    skippedBullets: string[];
    start: number;
    dateLine: string;
    trailingLocation: string;
    consumed: number;
  }
  const walks: Walk[] = [];
  let floor = 0;
  for (const di of dateIdx) {
    const headers: string[] = [];
    const skippedBullets: string[] = [];
    const dateMatch = lines[di].match(DATE_RANGE_RE);
    const inlinePrefix = dateMatch
      ? lines[di]
          .slice(0, dateMatch.index)
          .replace(/[·|]\s*$/, '')
          .replace(/[\s(,–—-]+$/, '')
          .trim()
      : '';
    const hasInlineHeader = inlinePrefix.length > 0 && !looksLikeLocation(inlinePrefix) && !/^(remote|hybrid|on[- ]?site)$/i.test(inlinePrefix);
    let s = di;
    let guard = 0;
    while (s - 1 >= floor && guard++ < 8 && headers.length < (hasInlineHeader ? 1 : 2)) {
      const line = lines[s - 1];
      if (detectSection(line) || DATE_RANGE_RE.test(line)) break;
      if (isBulletLine(line)) {
        if (headers.length === 0 && !hasInlineHeader) {
          skippedBullets.unshift(stripBullet(line)!.trim());
          s -= 1;
          continue;
        }
        break;
      }
      headers.unshift(line);
      s -= 1;
    }
    const headerLineCount = headers.length;
    if (hasInlineHeader) headers.push(inlinePrefix);
    // A location line right under the date ("Lalitpur, Nepal"), possibly
    // wrapped across two lines ("Kavrepalanchowk," / "Nepal"). But if the line
    // after it is another date range and the line itself looks like an entry
    // header ("M.S. Physics, State Univ"), it starts the next entry — it is
    // not this entry's location.
    let trailingLocation = '';
    let consumed = 0;
    const after1 = lines[di + 1];
    const after2 = lines[di + 2];
    const after1IsNextHeader =
      after1 !== undefined &&
      after2 !== undefined &&
      DATE_RANGE_RE.test(after2) &&
      looksLikeEntryHeader(after1);
    if (
      after1 !== undefined &&
      !after1IsNextHeader &&
      !isBulletLine(after1) &&
      !detectSection(after1) &&
      !DATE_RANGE_RE.test(after1)
    ) {
      let loc = after1;
      if (
        /,\s*$/.test(after1) &&
        after2 !== undefined &&
        !isBulletLine(after2) &&
        !detectSection(after2) &&
        !DATE_RANGE_RE.test(after2) &&
        after2.length < 40
      ) {
        loc = `${after1} ${after2}`;
        consumed = 2;
      } else {
        consumed = 1;
      }
      if (looksLikeLocation(loc)) trailingLocation = loc.trim();
      else consumed = 0;
    }
    walks.push({
      headers,
      headerLineCount,
      skippedBullets,
      start: s,
      dateLine: hasInlineHeader && dateMatch ? dateMatch[0] : lines[di],
      trailingLocation,
      consumed,
    });
    floor = di + 1 + consumed;
  }
  return dateIdx.map((di, k) => {
    const w = walks[k];
    const preDateBody: string[] = [];
    for (let i = w.start + w.skippedBullets.length + w.headerLineCount; i < di; i++) {
      const b = stripBullet(lines[i]);
      const t = (b !== null ? b : lines[i]).trim();
      if (t) preDateBody.push(t);
    }
    const bodyEnd = k + 1 < dateIdx.length ? walks[k + 1].start : lines.length;
    const postDateBody: string[] = [];
    for (let i = di + 1 + w.consumed; i < bodyEnd; i++) {
      const b = stripBullet(lines[i]);
      const t = (b !== null ? b : lines[i]).trim();
      if (t) postDateBody.push(t);
    }
    return {
      headerLines: w.headers,
      dateLine: w.dateLine,
      bodyLines: [...w.skippedBullets, ...preDateBody, ...postDateBody],
      trailingLocation: w.trailingLocation,
    };
  });
}

function splitCompanyLocation(s: string): [string, string] {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) {
    return [parts.slice(0, -2).join(', '), parts.slice(-2).join(', ')];
  }
  if (parts.length === 2) return [parts[0], parts[1]];
  return [s.trim(), ''];
}

const HEADER_SEPS = [' — ', ' – ', ' | ', ' @ ', ' at ', ' - '];

function splitTitleCompany(line: string): [string, string, string] {
  for (const sep of HEADER_SEPS) {
    const i = line.indexOf(sep);
    if (i > 0) {
      const [company, location] = splitCompanyLocation(line.slice(i + sep.length).trim());
      return [line.slice(0, i).trim(), company, location];
    }
  }
  const comma = line.indexOf(',');
  if (comma > 0) {
    const [company, location] = splitCompanyLocation(line.slice(comma + 1).trim());
    return [line.slice(0, comma).trim(), company, location];
  }
  return [line.trim(), '', ''];
}

function parseDateLine(dateLine: string): { start: string; end: string; current: boolean; location: string } {
  const m = dateLine.match(DATE_RANGE_RE);
  if (!m) return { start: '', end: '', current: false, location: dateLine.trim() };
  const start = m[1].trim();
  const endRaw = m[2].trim();
  const current = /^(present|current|now)$/i.test(endRaw);
  const location = dateLine
    .slice(0, m.index)
    .replace(/[·|]\s*$/, '')
    .replace(/^\s*[·|]\s*/, '')
    .trim()
    .replace(/[,\s·|]+$/, '')
    .trim();
  return { start, end: current ? '' : endRaw, current, location };
}

function bodyToBullets(bodyLines: string[]): string[] {
  const bullets: string[] = [];
  for (const line of bodyLines) {
    const b = stripBullet(line);
    const t = (b !== null ? b : line).trim();
    if (t) bullets.push(t);
  }
  return bullets;
}

/**
 * Split inline bullet separators into separate lines. PDF extraction often
 * merges "Degree … Bengaluru, India • GPA: 9.34/10.0 • Ranked Top 5" into one
 * line; each "•"-separated chunk is really its own line. Only the bullet
 * character U+2022 splits — the middle dot "·" is a common field separator
 * ("San Francisco, CA · Mar 2021 – Present") and must not split.
 */
function splitInlineBullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (/[^\s] • /.test(line)) {
      const lead = line.match(/^[•·▪◦▸‣⁃]\s*/)?.[0] ?? '';
      const parts = line.split(/\s+•\s+/);
      parts.forEach((p, i) => {
        const t = ((i === 0 ? lead : '') + p).trim();
        if (t.replace(/^[•·▪◦▸‣⁃]\s*/, '').trim()) out.push(t);
      });
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Join wrapped bullet continuations at the line level (markers still intact).
 * A non-bullet line that follows a bullet is a continuation of that bullet
 * when: the bullet doesn't end with terminal punctuation, and the line looks
 * like mid-sentence text (starts lowercase, or the bullet ends with , or -),
 * and it isn't a date, year, location, or section header.
 */
function joinBulletContinuations(lines: string[]): string[] {
  // A line that is only a bullet marker ("•") belongs at the start of the
  // next line — some PDFs emit the marker as its own text item.
  const fixed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[•·▪◦▸‣⁃]\s*$/.test(line) && i + 1 < lines.length) {
      fixed.push(`${line.trim()} ${lines[i + 1].trim()}`);
      i++;
    } else {
      fixed.push(line);
    }
  }
  const out: string[] = [];
  for (const line of fixed) {
    const prev = out[out.length - 1];
    const prevBullet = prev !== undefined ? stripBullet(prev) : null;
    const curBullet = stripBullet(line);
    if (
      prevBullet !== null &&
      curBullet === null &&
      !/[.!?:]$/.test(prevBullet.trim()) &&
      !detectSection(line) &&
      !DATE_RANGE_RE.test(line) &&
      !isYearLike(line.trim()) &&
      !LOCATION_RE.test(line) &&
      !LOCATION_RE2.test(line) &&
      (/^[a-z]/.test(line.trim()) || /[,-]$/.test(prevBullet.trim()))
    ) {
      out[out.length - 1] = `${prev} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseExperience(lines: string[]): ParsedWorkEntry[] {
  return splitEntries(lines).map((block) => {
    const { start, end, current, location: dateLoc } = parseDateLine(block.dateLine);
    let title = '';
    let company = '';
    let location = dateLoc || block.trailingLocation;
    if (block.headerLines.length >= 2) {
      title = block.headerLines[0].trim();
      const [co, loc] = splitCompanyLocation(block.headerLines[1]);
      company = co;
      if (!location) location = loc;
    } else if (block.headerLines.length === 1) {
      const [t, co, loc] = splitTitleCompany(block.headerLines[0]);
      title = t;
      company = co;
      if (!location) location = loc;
    }
    return { title, company, location, start, end, current, bullets: bodyToBullets(block.bodyLines) };
  }).filter((e) => e.title || e.company || e.bullets.length > 0);
}

function parseEducation(lines: string[], schoolHint = '', sectionDate = ''): ParsedEducationEntry[] {
  // If the section's date range isn't on any remaining line (it was on a
  // pulled award line, right-aligned in the original layout), put it on its
  // own line after the degree line so splitEntries still finds it.
  let work = lines;
  if (sectionDate && !DATE_RANGE_RE.test(lines.join(' '))) {
    const di = lines.findIndex((l) => stripBullet(l) === null);
    work = di >= 0
      ? [...lines.slice(0, di + 1), sectionDate, ...lines.slice(di + 1)]
      : [...lines, sectionDate];
  }
  return splitEntries(work).map((block) => {
    const { start, end: dateEnd, location: dateLoc } = parseDateLine(block.dateLine);
    let degree = '';
    let school = schoolHint;
    let endYear = dateEnd;
    let location = dateLoc || block.trailingLocation;
    if (block.headerLines.length >= 2) {
      degree = block.headerLines[0].trim();
      const [sc, loc] = splitCompanyLocation(block.headerLines[1]);
      if (!school) school = sc;
      if (!location) location = loc;
    } else if (block.headerLines.length === 1) {
      const line = block.headerLines[0];
      // "Bachelors' in Computer Science & Engineering Bengaluru, India":
      // trailing "City, Country" is the location, not the degree.
      const cityCountry = line.match(/^(.*?)\s+([A-Z][a-zA-Z]+,\s*[A-Z][a-zA-Z]+)$/);
      if (cityCountry && !DEGREE_RE.test(cityCountry[2])) {
        degree = cityCountry[1].trim();
        if (!location) location = cityCountry[2].trim();
      } else {
        let splitAt = -1;
        let splitLen = 0;
        for (const sep of HEADER_SEPS) {
          const i = line.indexOf(sep);
          if (i > 0) { splitAt = i; splitLen = sep.length; break; }
        }
        if (splitAt > 0) {
          degree = line.slice(0, splitAt).trim();
          const [sc, loc] = splitCompanyLocation(line.slice(splitAt + splitLen).trim());
          if (!school) school = sc;
          if (!location) location = loc;
        } else {
          const lastComma = line.lastIndexOf(',');
          if (lastComma > 0) {
            degree = line.slice(0, lastComma).trim();
            const tail = line.slice(lastComma + 1).trim();
            // A trailing year ("B.S. Computer Science, State University, 2019")
            // is the graduation year, not the school.
            if (/^(19|20)\d{2}$/.test(tail)) {
              endYear = tail;
              const prevComma = degree.lastIndexOf(',');
              if (prevComma > 0) {
                if (!school) school = degree.slice(prevComma + 1).trim();
                degree = degree.slice(0, prevComma).trim();
              } else if (!school) {
                school = degree;
                degree = '';
              }
            } else if (!school) {
              school = tail;
            }
          } else if (!school) {
            school = line.trim();
          } else {
            degree = line.trim();
          }
        }
      }
    }
    // Detail: dedupe repeated lines and keep only the first GPA mention so
    // conflicting duplicates can't both show up.
    const seen = new Set<string>();
    let gpaSeen = false;
    const detail = block.bodyLines
      .map((l) => {
        const b = stripBullet(l);
        return (b !== null ? b : l).trim();
      })
      .filter((t) => {
        if (!t || seen.has(t.toLowerCase())) return false;
        seen.add(t.toLowerCase());
        if (/\bgpa\b/i.test(t)) {
          if (gpaSeen) return false;
          gpaSeen = true;
        }
        return true;
      })
      .join(' ');
    return { degree, school, location, start, end: endYear, detail };
  }).filter((e) => e.degree || e.school);
}

function parseSkills(lines: string[]): ParsedSkillGroup[] {
  const groups: ParsedSkillGroup[] = [];
  let current: ParsedSkillGroup | null = null;
  // "C/C++" splits into C and C++; single capital letters are kept so neither
  // half (nor single-letter skills like R) is dropped. "Python:PyTorch"
  // sub-categories split on the colon too (URLs are left alone).
  const splitItems = (s: string): string[] =>
    s
      .split(/[,;•·|/]/)
      .flatMap((x) => (/https?:\/\//i.test(x) ? [x] : x.split(':')))
      .map((x) => x.trim().replace(/[.]+$/, ''))
      .filter((x, i, arr) => (x.length > 1 || /^[A-Za-z]$/.test(x)) && arr.indexOf(x) === i);
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0 && colon <= 40) {
      current = { label: stripLineBullet(line.slice(0, colon).trim()), items: splitItems(line.slice(colon + 1)) };
      groups.push(current);
    } else {
      const items = splitItems(stripLineBullet(line));
      if (items.length === 0) continue;
      if (!current) {
        current = { label: '', items: [] };
        groups.push(current);
      }
      for (const it of items) {
        if (!current.items.includes(it)) current.items.push(it);
      }
    }
  }
  return groups.filter((g) => g.items.length > 0);
}

function parseProjects(lines: string[]): ParsedProjectEntry[] {
  const projects: ParsedProjectEntry[] = [];
  let current: ParsedProjectEntry | null = null;
  for (const line of lines) {
    const bullet = stripBullet(line);
    const isBullet = bullet !== null;
    const text = (isBullet ? bullet : line).trim();
    if (!text) continue;
    // A bare year under a project ("2021", "2021 – 2023") is metadata for the
    // current project, not a new project.
    if (!isBullet && isYearLike(text) && current) {
      current.detail = current.detail ? `${current.detail} · ${text}` : text;
      continue;
    }
    if (!isBullet && (!current || current.detail || current.bullets.length > 0)) {
      const url = line.match(URL_RE);
      current = {
        name: url ? line.replace(url[0], '').replace(/[·|()\s]+$/, '').trim() || line.trim() : line.trim(),
        link: url ? url[0].replace(/\/$/, '') : '',
        detail: '',
        bullets: [],
      };
      projects.push(current);
    } else if (current) {
      if (isBullet) current.bullets.push(text);
      else current.detail = current.detail ? `${current.detail} ${text}` : text;
    }
  }
  return projects.filter((p) => p.name);
}

/** Lines that are really awards, even when they appear under Education. */
const AWARD_LINE_RE = /\b(award|prize|honou?rs?|distinction|fellowship|scholarship|dean'?s list|cum laude)\b/i;
/** For bulleted lines the bar is higher: only a concrete award noun
 * ("Distinguished Graduate Award") is pulled. A bulleted "Graduated with
 * honors" reads as an education detail, so it stays. */
const BULLET_AWARD_RE = /\b(award|prize|fellowship|scholarship|dean'?s list)\b/i;
const DEGREE_RE = /\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|bachelor'?s?|master'?s?|doctorate|MBA)\b/i;

/**
 * Pull award-like lines out of a section's lines (they belong in Awards).
 * Handles both bare lines ("Distinguished Graduate Award, 2019") and short
 * bulleted award noun phrases ("• Distinguished Graduate Award"). GPA lines
 * are never pulled — the GPA belongs to the education detail.
 */
function pullAwardLines(lines: string[]): { kept: string[]; awards: string[] } {
  const kept: string[] = [];
  const awards: string[] = [];
  for (const line of lines) {
    const isBulleted = stripBullet(line) !== null;
    const stripped = (stripBullet(line) ?? line).trim();
    const words = stripped.split(/\s+/).filter(Boolean).length;
    const re = isBulleted ? BULLET_AWARD_RE : AWARD_LINE_RE;
    if (
      re.test(stripped) &&
      !DEGREE_RE.test(stripped) &&
      !/\bgpa\b/i.test(stripped) &&
      words <= 12
    ) {
      awards.push(stripped);
    } else {
      kept.push(line);
    }
  }
  return { kept, awards };
}

/** Role/position lines ("General Officer at Data Science Society") are not
 * education — they belong in volunteer/extracurricular. Also lifts a school
 * name out of the line when it names an institution ("…, Nitte Meenakshi
 * Institute of Technology"), since the degree line often omits it. */
const ROLE_RE = /\b(officer|president|vice[\s-]?president|chair|coordinator|lead|member|volunteer|mentor|tutor|ambassador|representative|secretary|treasurer|captain|founder|organizer|chairperson)\b/i;
const INSTITUTION_RE = /,\s*([^,()]*\b(?:institute|university|college|school|academy)[^,()]*)$/i;
function pullRoleLines(lines: string[]): { kept: string[]; roles: string[]; schoolHint: string } {
  const kept: string[] = [];
  const roles: string[] = [];
  let schoolHint = '';
  for (const line of lines) {
    const text = (stripBullet(line) ?? line).trim();
    if (ROLE_RE.test(text) && /\b(at|of|for)\b/i.test(text) && !DEGREE_RE.test(text)) {
      const m = text.match(INSTITUTION_RE);
      if (m && !schoolHint) schoolHint = m[1].trim();
      roles.push(text);
    } else {
      kept.push(line);
    }
  }
  return { kept, roles, schoolHint };
}
function stripLineBullet(l: string): string {
  const b = stripBullet(l);
  return (b !== null ? b : l).trim();
}

function parseCertifications(lines: string[]): ParsedCertificationEntry[] {
  const out: ParsedCertificationEntry[] = [];
  for (const line of lines) {
    const text = stripLineBullet(line);
    // "Data Analyst(Datacamp), Intermediate SQL(Datacamp)" — several
    // "Name(Issuer)" certifications on one line.
    const grouped = [...text.matchAll(/([^,()]+?)\s*\(([^()]*)\)/g)];
    if (grouped.length >= 2) {
      for (const m of grouped) {
        out.push({ name: m[1].trim(), issuer: m[2].trim(), year: '' });
      }
      continue;
    }
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) out.push({ name: parts[0], issuer: parts.slice(1, -1).join(', '), year: parts[parts.length - 1] });
    else if (parts.length === 2) {
      const yearLike = /^\d{4}$/.test(parts[1]);
      out.push({ name: parts[0], issuer: yearLike ? '' : parts[1], year: yearLike ? parts[1] : '' });
    }
    else if (text) out.push({ name: text, issuer: '', year: '' });
  }
  return out.filter((c) => c.name);
}

function parseLanguages(lines: string[]): ParsedLanguageEntry[] {
  return lines.map((line) => {
    const text = stripLineBullet(line);
    const m = text.match(/^(.*?)[\s:–——(\[-]+(native|fluent|professional|conversational|intermediate|advanced|basic|bilingual)\b.*$/i);
    if (m) return { language: m[1].trim(), level: m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() };
    return { language: text, level: '' };
  }).filter((l) => l.language);
}

/**
 * Awards: "Title, Issuer, Year" per line; a bullet under an award becomes its
 * one-line description.
 */
function parseAwards(lines: string[]): ParsedAwardEntry[] {
  const awards: ParsedAwardEntry[] = [];
  let current: ParsedAwardEntry | null = null;
  for (const line of lines) {
    const bullet = stripBullet(line);
    const text = (bullet !== null ? bullet : line).trim();
    if (!text) continue;
    if (bullet !== null && current) {
      current.description = current.description ? `${current.description} ${text}` : text;
      continue;
    }
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    let title = text;
    let issuer = '';
    let year = '';
    if (parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1])) {
      year = parts.pop()!;
      issuer = parts.slice(1).join(', ');
      title = parts[0];
    } else if (parts.length >= 2) {
      title = parts[0];
      issuer = parts.slice(1).join(', ');
    }
    current = { title, issuer, year, description: '' };
    awards.push(current);
  }
  return awards.filter((a) => a.title);
}

/**
 * Publications: the title leads; a URL on the line is lifted into the link
 * field; "Publisher, Year" after the last comma fills the tail fields.
 */
function parsePublications(lines: string[]): ParsedPublicationEntry[] {
  return lines
    .map((line) => {
      const text = stripLineBullet(line);
      const url = text.match(URL_RE);
      const link = url ? url[0].replace(/\/$/, '') : '';
      const noUrl = url ? text.replace(url[0], '').replace(/[·|()\s]+$/, '').trim() : text;
      const parts = noUrl.split(',').map((p) => p.trim()).filter(Boolean);
      let title = noUrl;
      let publisher = '';
      let year = '';
      if (parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1])) {
        year = parts.pop()!;
        publisher = parts.slice(1).join(', ');
        title = parts[0];
      } else if (parts.length >= 2) {
        title = parts[0];
        publisher = parts.slice(1).join(', ');
      }
      return { title, publisher, year, link };
    })
    .filter((p) => p.title);
}

/** Volunteer experience has the same shape as work experience (role, org, dates, bullets). */
function parseVolunteer(lines: string[]): ParsedWorkEntry[] {
  return parseExperience(lines);
}

/** Courses / training: "Name, Provider, Year" per line. */
function parseCourses(lines: string[]): ParsedCourseEntry[] {
  return lines.map((line) => {
    const text = stripLineBullet(line);
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) return { name: parts[0], provider: parts.slice(1, -1).join(', '), year: parts[parts.length - 1] };
    if (parts.length === 2) {
      const yearLike = /^\d{4}$/.test(parts[1]);
      return { name: parts[0], provider: yearLike ? '' : parts[1], year: yearLike ? parts[1] : '' };
    }
    return { name: text, provider: '', year: '' };
  }).filter((c) => c.name);
}

/** Parse plain resume text into structured fields using line-based heuristics. */
export function parseResumeText(text: string): ParsedResume {  const out = blankParsed();
  // Repair words split across lines by hyphenation ("visualiza-\ntion").
  const dehyphenated = text.replace(/([A-Za-z])-\r?\n([A-Za-z])/g, '$1$2');
  const lines = dehyphenated
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^[-_=*#]{4,}$/.test(l) && !/^pages?\s+\d+(\s+of\s+\d+)?$/i.test(l));
  if (lines.length === 0) return out;

  // Split "•"-joined chunks ("…Bengaluru, India • GPA: 9.34/10.0") into lines,
  // then join wrapped bullet continuations while the markers are intact.
  const joined = joinBulletContinuations(splitInlineBullets(lines));

  const sections = new Map<SectionKey, string[]>();
  const contactLines: string[] = [];
  let current: SectionKey | null = null;
  for (const line of joined) {
    const section = detectSection(line);
    if (section) {
      current = section;
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
    else contactLines.push(line);
  }

  parseContact(contactLines, out);

  // Drop repeated page header/footer lines ("Anurag Nepal nepalanurag72@gmail.com")
  // so they don't leak into the last section's details.
  if (out.fullName && out.email) {
    const footerRe = new RegExp(escapeRegExp(out.fullName), 'i');
    for (const [key, arr] of sections) {
      const kept = arr.filter((l) => !(footerRe.test(l) && l.includes(out.email)));
      if (kept.length !== arr.length) sections.set(key, kept);
    }
  }

  const summary = sections.get('summary');
  if (summary) out.summary = summary.join(' ');
  const experience = sections.get('experience');
  if (experience) out.experience = parseExperience(experience);
  const education = sections.get('education');
  if (education) {
    // Awards hide in the education section ("• Distinguished Graduate
    // Award"). Pull them out so they land in Awards, not Education. A date
    // range on a pulled award line is usually the degree's right-aligned
    // dates — recover it for the education entry.
    const { kept, awards: eduAwards } = pullAwardLines(education);
    let sectionDate = '';
    const cleanAwards = eduAwards
      .map((a) => {
        const m = a.match(DATE_RANGE_RE);
        if (m && !sectionDate) {
          sectionDate = m[0];
          return a.replace(m[0], '').replace(/[·|\-–—\s]+$/, '').trim();
        }
        return a;
      })
      .filter(Boolean);
    // Role lines ("General Officer at Data Science Society") are positions,
    // not education — they belong in volunteer.
    const { kept: kept2, roles, schoolHint } = pullRoleLines(kept);
    if (roles.length > 0) {
      sections.set('volunteer', [...(sections.get('volunteer') ?? []), ...roles]);
    }
    out.education = parseEducation(kept2, schoolHint, sectionDate);
    if (cleanAwards.length > 0) {
      const existing = sections.get('awards') ?? [];
      sections.set('awards', [...existing, ...cleanAwards]);
    }
  }
  const skills = sections.get('skills');
  if (skills) out.skills = parseSkills(skills);
  // A combined "CERTIFICATIONS, LANGUAGES & SKILLS" header: route each line
  // by its prefix ("Certifications: …" → certifications, rest → skills).
  const certskills = sections.get('certskills');
  if (certskills) {
    const certLines: string[] = [];
    const langLines: string[] = [];
    const skillLines: string[] = [];
    for (const l of certskills) {
      const t = (stripBullet(l) ?? l).trim();
      if (/^certifications?\s*:/i.test(t)) {
        certLines.push(t.replace(/^certifications?\s*:\s*/i, ''));
      } else if (/^languages?\s*:/i.test(t)) {
        langLines.push(t.replace(/^languages?\s*:\s*/i, ''));
      } else {
        skillLines.push(l);
      }
    }
    if (certLines.length > 0) {
      out.certifications = [...out.certifications, ...parseCertifications(certLines)];
    }
    if (langLines.length > 0) {
      out.languages = [...out.languages, ...parseLanguages(langLines)];
    }
    if (skillLines.length > 0) {
      out.skills = [...out.skills, ...parseSkills(skillLines)];
    }
  }
  const projects = sections.get('projects');
  if (projects) out.projects = parseProjects(projects);
  const certifications = sections.get('certifications');
  if (certifications) out.certifications = parseCertifications(certifications);
  const languages = sections.get('languages');
  if (languages) out.languages = parseLanguages(languages);
  const awards = sections.get('awards');
  if (awards) out.awards = parseAwards(awards);
  const publications = sections.get('publications');
  if (publications) out.publications = parsePublications(publications);
  const volunteer = sections.get('volunteer');
  if (volunteer) out.volunteer = parseVolunteer(volunteer);
  const courses = sections.get('courses');
  if (courses) out.courses = parseCourses(courses);
  return out;
}

export interface SplitResume {
  /** Every non-empty line in document order — the same lines parseResumeText sees. */
  lines: string[];
  /** Parallel to lines: 'contact', 'header', or a section key. */
  kinds: string[];
  contact: string[];
  sections: Map<string, string[]>;
}

/**
 * Split resume text into contact lines and section line groups, using the
 * same header detection and line cleanup as the heuristic parser. Exported so
 * the local-AI path can attach NER entities to the right document lines
 * without duplicating the header list.
 */
export function splitResumeSections(text: string): SplitResume {
  const dehyphenated = text.replace(/([A-Za-z])-\r?\n([A-Za-z])/g, '$1$2');
  const rawLines = dehyphenated
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^[-_=*#]{4,}$/.test(l) && !/^pages?\s+\d+(\s+of\s+\d+)?$/i.test(l));
  const lines = joinBulletContinuations(splitInlineBullets(rawLines));
  const kinds: string[] = [];
  const contact: string[] = [];
  const sections = new Map<string, string[]>();
  let current: SectionKey | null = null;
  for (const line of lines) {
    const section = detectSection(line);
    if (section) {
      kinds.push('header');
      current = section;
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (current) {
      kinds.push(current);
      sections.get(current)!.push(line);
    } else {
      kinds.push('contact');
      contact.push(line);
    }
  }
  return { lines, kinds, contact, sections };
}

/** Map parsed fields into the ResumeData shape the builder edits. */
export function parsedToResumeData(p: ParsedResume): ResumeData {  const r = blankResume();
  r.version = RESUME_SCHEMA_VERSION;
  r.contact = {
    fullName: p.fullName,
    title: p.title,
    email: p.email,
    phone: p.phone,
    location: p.location,
    website: p.website,
    linkedin: p.linkedin,
  };
  r.summary = p.summary;
  r.experience = p.experience.map((e) => ({
    ...blankWorkEntry(),
    id: genId(),
    title: e.title,
    company: e.company,
    location: e.location,
    start: e.start,
    end: e.end,
    current: e.current,
    bullets: [...e.bullets],
  }));
  r.education = p.education.map((e) => ({
    ...blankEducationEntry(),
    id: genId(),
    degree: e.degree,
    school: e.school,
    location: e.location,
    start: e.start,
    end: e.end,
    detail: e.detail,
  }));
  r.skills = p.skills.map((g) => ({
    ...blankSkillGroup(),
    id: genId(),
    label: g.label || 'Skills',
    items: g.items.join(', '),
  }));
  r.projects = p.projects.map((p2) => ({
    ...blankProjectEntry(),
    id: genId(),
    name: p2.name,
    link: p2.link,
    detail: p2.detail,
    bullets: [...p2.bullets],
  }));
  r.certifications = p.certifications.map((c) => ({
    ...blankCertificationEntry(),
    id: genId(),
    name: c.name,
    issuer: c.issuer,
    year: c.year,
  }));
  r.languages = p.languages.map((l) => ({
    ...blankLanguageEntry(),
    id: genId(),
    language: l.language,
    level: l.level,
  }));
  r.awards = p.awards.map((a) => ({
    ...blankAwardEntry(),
    id: genId(),
    title: a.title,
    issuer: a.issuer,
    year: a.year,
    description: a.description,
  }));
  r.publications = p.publications.map((pub) => ({
    ...blankPublicationEntry(),
    id: genId(),
    title: pub.title,
    publisher: pub.publisher,
    year: pub.year,
    link: pub.link,
  }));
  r.volunteer = p.volunteer.map((e) => ({
    ...blankWorkEntry(),
    id: genId(),
    title: e.title,
    company: e.company,
    location: e.location,
    start: e.start,
    end: e.end,
    current: e.current,
    bullets: [...e.bullets],
  }));
  r.courses = p.courses.map((c) => ({
    ...blankCourseEntry(),
    id: genId(),
    name: c.name,
    provider: c.provider,
    year: c.year,
  }));
  return r;
}
