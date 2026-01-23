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
} from './resume-core.ts';
import type { ResumeData } from './resume-core.ts';

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
}

function blankParsed(): ParsedResume {
  return {
    fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '',
    summary: '', experience: [], education: [], skills: [], projects: [], certifications: [], languages: [],
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
type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
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
}

/**
 * Rebuild text lines from pdf.js items. Prefers the hasEOL flag (pdf.js v4+);
 * falls back to grouping items by their Y position for older content.
 */
export function pdfItemsToLines(items: unknown[]): string[] {
  const typed = items as PdfTextItem[];
  const strs = typed.map((it) => (typeof it.str === 'string' ? it.str : ''));

  if (typed.some((it) => it.hasEOL)) {
    const lines: string[] = [];
    let cur = '';
    typed.forEach((it, i) => {
      cur += strs[i];
      if (it.hasEOL) {
        lines.push(cur);
        cur = '';
      }
    });
    if (cur.trim()) lines.push(cur);
    return lines;
  }

  // Fallback: group by Y coordinate (transform[5]), top line first.
  const rows: { y: number; x: number; order: number; str: string }[] = typed.map((it, order) => ({
    y: Array.isArray(it.transform) ? it.transform[5] : 0,
    x: Array.isArray(it.transform) ? it.transform[4] : 0,
    order,
    str: strs[order],
  }));
  rows.sort((a, b) => b.y - a.y || a.x - b.x || a.order - b.order);
  const lines: string[] = [];
  const lineYs: number[] = [];
  const TOL = 3;
  for (const row of rows) {
    const prevY = lineYs.length > 0 ? lineYs[lineYs.length - 1] : null;
    if (prevY !== null && Math.abs(row.y - prevY) <= TOL) {
      lines[lines.length - 1] += row.str;
    } else {
      lines.push(row.str);
      lineYs.push(row.y);
    }
  }
  return lines;
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

type SectionKey = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'languages';

const SECTION_DEFS: { re: RegExp; section: SectionKey }[] = [
  { re: /^(work\s+)?experience$/, section: 'experience' },
  { re: /^employment(\s+history)?$/, section: 'experience' },
  { re: /^professional\s+experience$/, section: 'experience' },
  { re: /^education$/, section: 'education' },
  { re: /^academic\s+background$/, section: 'education' },
  { re: /^(technical\s+)?skills?$/, section: 'skills' },
  { re: /^core\s+competencies$/, section: 'skills' },
  { re: /^projects?$/, section: 'projects' },
  { re: /^(professional\s+)?summary$/, section: 'summary' },
  { re: /^objective$/, section: 'summary' },
  { re: /^profile$/, section: 'summary' },
  { re: /^certifications?$/, section: 'certifications' },
  { re: /^licenses(\s+(and|&)\s+certifications?)?$/, section: 'certifications' },
  { re: /^languages?$/, section: 'languages' },
];

function detectSection(line: string): SectionKey | null {
  const clean = line.replace(/[:\s]+$/, '').trim();
  if (clean.length > 45) return null;
  for (const def of SECTION_DEFS) {
    if (def.re.test(clean.toLowerCase())) return def.section;
  }
  return null;
}

const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DATE = `(?:${MONTH})\\.?\\s+\\d{4}|\\d{4}`;
const DATE_RANGE_RE = new RegExp(`(${DATE})\\s*[\\u2013\\u2014-]\\s*(${DATE}|present|current|now)\\b`, 'i');
const BULLET_RE = /^[•·▪◦▸‣⁃*+>\\-–—]\s+/;

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;)]*/i;
const URL_RE = /https?:\/\/[^\s,;)]+/i;
const DOMAIN_RE = /(?<![@\w])([\w-]+\.(?:com|io|dev|design|net|org|co|app|me|info)\b[^\s,;)]*)/i;
const LOCATION_RE = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2})\b/;
const LOCATION_RE2 = /,\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})$/;
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
    const url = line.match(URL_RE);
    if (url && !/linkedin\.com/i.test(url[0]) && !out.website) {
      out.website = url[0].replace(/\/$/, '');
      used.add(i);
    } else if (!out.website) {
      const dom = line.match(DOMAIN_RE);
      if (dom && !/linkedin\.com/i.test(dom[0])) {
        out.website = dom[1].replace(/\/$/, '');
        used.add(i);
      }
    }
    const loc = line.match(LOCATION_RE) ?? line.match(LOCATION_RE2);
    if (loc && !out.location) {
      out.location = (loc[1].includes(',') ? loc[1] : loc[0].replace(/^,\s*/, '')).trim();
      // Only mark the line used if nothing else useful remains on it.
      const rest = line.replace(EMAIL_RE, '').replace(PHONE_RE, '').replace(LINKEDIN_RE, '').replace(URL_RE, '').replace(loc[0], '').replace(/[·|]/g, '').trim();
      if (!rest) used.add(i);
    }
  }

  // Headline: the first leftover line that is short and not a sentence.
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i]
      .replace(EMAIL_RE, '')
      .replace(PHONE_RE, '')
      .replace(LINKEDIN_RE, '')
      .replace(URL_RE, '')
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
}

/** Split a section into entries on date-range lines. */
function splitEntries(lines: string[]): EntryBlock[] {
  const dateIdx: number[] = [];
  lines.forEach((line, i) => {
    if (DATE_RANGE_RE.test(line)) dateIdx.push(i);
  });
  if (dateIdx.length === 0) {
    return lines.length > 0 ? [{ headerLines: [lines[0]], dateLine: '', bodyLines: lines.slice(1) }] : [];
  }
  // For each date line, the header is the up-to-2 non-bullet lines right above
  // it (stopping at the previous entry's date line). The body runs from the
  // date line to the next entry's header.
  const headerStart: number[] = dateIdx.map((di, k) => {
    const prevEnd = k === 0 ? 0 : dateIdx[k - 1] + 1;
    let s = di;
    let taken = 0;
    while (s - 1 >= prevEnd && taken < 2 && !BULLET_RE.test(lines[s - 1])) {
      s -= 1;
      taken += 1;
    }
    return s;
  });
  return dateIdx.map((di, k) => ({
    headerLines: lines.slice(headerStart[k], di),
    dateLine: lines[di],
    bodyLines: lines.slice(di + 1, k + 1 < dateIdx.length ? headerStart[k + 1] : lines.length),
  }));
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
    const b = line.replace(BULLET_RE, '').trim();
    if (b) bullets.push(b);
  }
  return bullets;
}

function parseExperience(lines: string[]): ParsedWorkEntry[] {
  return splitEntries(lines).map((block) => {
    const { start, end, current, location: dateLoc } = parseDateLine(block.dateLine);
    let title = '';
    let company = '';
    let location = dateLoc;
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

function parseEducation(lines: string[]): ParsedEducationEntry[] {
  return splitEntries(lines).map((block) => {
    const { start, end, location: dateLoc } = parseDateLine(block.dateLine);
    let degree = '';
    let school = '';
    let location = dateLoc;
    if (block.headerLines.length >= 2) {
      degree = block.headerLines[0].trim();
      const [sc, loc] = splitCompanyLocation(block.headerLines[1]);
      school = sc;
      if (!location) location = loc;
    } else if (block.headerLines.length === 1) {
      const line = block.headerLines[0];
      let splitAt = -1;
      let splitLen = 0;
      for (const sep of HEADER_SEPS) {
        const i = line.indexOf(sep);
        if (i > 0) { splitAt = i; splitLen = sep.length; break; }
      }
      if (splitAt > 0) {
        degree = line.slice(0, splitAt).trim();
        const [sc, loc] = splitCompanyLocation(line.slice(splitAt + splitLen).trim());
        school = sc;
        if (!location) location = loc;
      } else {
        const lastComma = line.lastIndexOf(',');
        if (lastComma > 0) {
          degree = line.slice(0, lastComma).trim();
          school = line.slice(lastComma + 1).trim();
        } else {
          school = line.trim();
        }
      }
    }
    const detail = block.bodyLines.map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean).join(' ');
    return { degree, school, location, start, end, detail };
  }).filter((e) => e.degree || e.school);
}

function parseSkills(lines: string[]): ParsedSkillGroup[] {
  const groups: ParsedSkillGroup[] = [];
  let current: ParsedSkillGroup | null = null;
  const splitItems = (s: string): string[] =>
    s.split(/[,;•·|/]/).map((x) => x.trim()).filter((x) => x.length > 1);
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0 && colon <= 40) {
      current = { label: line.slice(0, colon).trim(), items: splitItems(line.slice(colon + 1)) };
      groups.push(current);
    } else {
      const items = splitItems(line);
      if (items.length === 0) continue;
      if (!current) {
        current = { label: '', items: [] };
        groups.push(current);
      }
      current.items.push(...items);
    }
  }
  return groups.filter((g) => g.items.length > 0);
}

function parseProjects(lines: string[]): ParsedProjectEntry[] {
  const projects: ParsedProjectEntry[] = [];
  let current: ParsedProjectEntry | null = null;
  for (const line of lines) {
    const isBullet = BULLET_RE.test(line);
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
      const text = line.replace(BULLET_RE, '').trim();
      if (!text) continue;
      if (isBullet) current.bullets.push(text);
      else current.detail = current.detail ? `${current.detail} ${text}` : text;
    }
  }
  return projects.filter((p) => p.name);
}

function parseCertifications(lines: string[]): ParsedCertificationEntry[] {
  return lines.map((line) => {
    const text = line.replace(BULLET_RE, '').trim();
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) return { name: parts[0], issuer: parts.slice(1, -1).join(', '), year: parts[parts.length - 1] };
    if (parts.length === 2) {
      const yearLike = /^\d{4}$/.test(parts[1]);
      return { name: parts[0], issuer: yearLike ? '' : parts[1], year: yearLike ? parts[1] : '' };
    }
    return { name: text, issuer: '', year: '' };
  }).filter((c) => c.name);
}

function parseLanguages(lines: string[]): ParsedLanguageEntry[] {
  return lines.map((line) => {
    const text = line.replace(BULLET_RE, '').trim();
    const m = text.match(/^(.*?)[\s:–——(\[-]+(native|fluent|professional|conversational|intermediate|advanced|basic|bilingual)\b.*$/i);
    if (m) return { language: m[1].trim(), level: m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() };
    return { language: text, level: '' };
  }).filter((l) => l.language);
}

/** Parse plain resume text into structured fields using line-based heuristics. */
export function parseResumeText(text: string): ParsedResume {
  const out = blankParsed();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^[-_=*#]{4,}$/.test(l));
  if (lines.length === 0) return out;

  const sections = new Map<SectionKey, string[]>();
  const contactLines: string[] = [];
  let current: SectionKey | null = null;
  for (const line of lines) {
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
  const summary = sections.get('summary');
  if (summary) out.summary = summary.join(' ');
  const experience = sections.get('experience');
  if (experience) out.experience = parseExperience(experience);
  const education = sections.get('education');
  if (education) out.education = parseEducation(education);
  const skills = sections.get('skills');
  if (skills) out.skills = parseSkills(skills);
  const projects = sections.get('projects');
  if (projects) out.projects = parseProjects(projects);
  const certifications = sections.get('certifications');
  if (certifications) out.certifications = parseCertifications(certifications);
  const languages = sections.get('languages');
  if (languages) out.languages = parseLanguages(languages);
  return out;
}

/** Map parsed fields into the ResumeData shape the builder edits. */
export function parsedToResumeData(p: ParsedResume): ResumeData {
  const r = blankResume();
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
  return r;
}
