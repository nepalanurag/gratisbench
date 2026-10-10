// Pure resume-builder logic shared by the browser tool and the Node verification script.
// No DOM access here — everything is data in, data/HTML strings out.

// Schema v2 adds: awards, publications, volunteer, courses sections plus
// per-section visibility and a user-controlled section order.
export const RESUME_SCHEMA_VERSION = 2;
export const RESUME_STORAGE_KEY = 'freekit.resume-builder.v1';
// Key name is frozen on purpose: it is only ever read, never overwritten by
// the normal save path, so a user's pre-migration draft stays recoverable.
export const TEMPLATE_STORAGE_KEY = 'freekit.resume-builder.template';
/** Separate key that keeps a copy of any stored blob the loader had to discard. */
export const RESUME_BACKUP_KEY = 'freekit.resume-builder.v1.backup';

export type TemplateId = 'ats' | 'classic' | 'modern' | 'compact';

/** Every renderable block of the resume. Contact is the header; the rest are sections. */
export type SectionKey =
  | 'contact'
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'languages'
  | 'awards'
  | 'publications'
  | 'volunteer'
  | 'courses';

export const DEFAULT_SECTION_ORDER: SectionKey[] = [
  'contact',
  'summary',
  'experience',
  'education',
  'skills',
  'projects',
  'certifications',
  'languages',
  'awards',
  'publications',
  'volunteer',
  'courses',
];

export interface ContactInfo {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
}

export interface WorkEntry {
  id: string;
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface EducationEntry {
  id: string;
  degree: string;
  school: string;
  location: string;
  start: string;
  end: string;
  detail: string;
}

export interface SkillGroup {
  id: string;
  label: string;
  items: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  link: string;
  detail: string;
  bullets: string[];
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer: string;
  year: string;
}

export interface LanguageEntry {
  id: string;
  language: string;
  level: string;
}

export interface AwardEntry {
  id: string;
  title: string;
  issuer: string;
  year: string;
  description: string;
}

export interface PublicationEntry {
  id: string;
  title: string;
  publisher: string;
  year: string;
  link: string;
}

export interface CourseEntry {
  id: string;
  name: string;
  provider: string;
  year: string;
}

export interface ResumeData {
  version: number;
  contact: ContactInfo;
  summary: string;
  experience: WorkEntry[];
  education: EducationEntry[];
  skills: SkillGroup[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  awards: AwardEntry[];
  publications: PublicationEntry[];
  /** Volunteer experience reuses the WorkEntry shape (role, org, dates, bullets). */
  volunteer: WorkEntry[];
  courses: CourseEntry[];
  /** Per-section on/off toggles. */
  sectionVisibility: Record<SectionKey, boolean>;
  /** User-controlled render order for all sections (contact first = header). */
  sectionOrder: SectionKey[];
}

let idCounter = 0;
/** Unique-enough id for a new entry. Not a UUID; collisions across sessions don't matter here. */
export function newId(): string {
  idCounter += 1;
  return `e${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function blankContact(): ContactInfo {
  return { fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '' };
}

export function blankWorkEntry(): WorkEntry {
  return { id: newId(), title: '', company: '', location: '', start: '', end: '', current: false, bullets: [] };
}

export function blankEducationEntry(): EducationEntry {
  return { id: newId(), degree: '', school: '', location: '', start: '', end: '', detail: '' };
}

export function blankSkillGroup(): SkillGroup {
  return { id: newId(), label: '', items: '' };
}

export function blankProjectEntry(): ProjectEntry {
  return { id: newId(), name: '', link: '', detail: '', bullets: [] };
}

export function blankCertificationEntry(): CertificationEntry {
  return { id: newId(), name: '', issuer: '', year: '' };
}

export function blankLanguageEntry(): LanguageEntry {
  return { id: newId(), language: '', level: '' };
}

export function blankAwardEntry(): AwardEntry {
  return { id: newId(), title: '', issuer: '', year: '', description: '' };
}

export function blankPublicationEntry(): PublicationEntry {
  return { id: newId(), title: '', publisher: '', year: '', link: '' };
}

export function blankCourseEntry(): CourseEntry {
  return { id: newId(), name: '', provider: '', year: '' };
}

export function defaultSectionVisibility(): Record<SectionKey, boolean> {
  return Object.fromEntries(DEFAULT_SECTION_ORDER.map((k) => [k, true])) as Record<SectionKey, boolean>;
}

/** A fresh, empty resume. */
export function blankResume(): ResumeData {
  return {
    version: RESUME_SCHEMA_VERSION,
    contact: blankContact(),
    summary: '',
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    awards: [],
    publications: [],
    volunteer: [],
    courses: [],
    sectionVisibility: defaultSectionVisibility(),
    sectionOrder: [...DEFAULT_SECTION_ORDER],
  };
}

/** Sample content so people can see the templates working before typing a word. */
export function exampleResume(): ResumeData {
  return {
    version: RESUME_SCHEMA_VERSION,
    contact: {
      fullName: 'Sam Rivera',
      title: 'Senior Product Designer',
      email: 'sam.rivera@example.com',
      phone: '(415) 555-0132',
      location: 'San Francisco, CA',
      website: 'samrivera.design',
      linkedin: 'linkedin.com/in/samrivera',
    },
    summary:
      'Product designer with 8 years of experience shipping consumer mobile apps used by millions. ' +
      'I turn ambiguous problems into simple interfaces, run my own research, and measure what I ship. ' +
      'Looking for a senior IC role on a small, fast team.',
    experience: [
      {
        id: newId(),
        title: 'Senior Product Designer',
        company: 'Northwind Mobile',
        location: 'San Francisco, CA',
        start: 'Mar 2021',
        end: '',
        current: true,
        bullets: [
          'Led redesign of the onboarding flow; activation rose from 31% to 47% across 2M monthly users.',
          'Built the design system used by 4 product teams, cutting design-to-engineering handoff time by a third.',
          'Ran 30+ usability sessions a year; findings fed directly into the quarterly roadmap.',
        ],
      },
      {
        id: newId(),
        title: 'Product Designer',
        company: 'Brightline Health',
        location: 'Remote',
        start: 'Jun 2018',
        end: 'Feb 2021',
        current: false,
        bullets: [
          'Designed the patient scheduling app from zero to launch; 4.8-star rating with 120k reviews.',
          'Partnered with clinicians to simplify intake forms, reducing drop-off by 22%.',
        ],
      },
      {
        id: newId(),
        title: 'UI Designer',
        company: 'Pixelworks Studio',
        location: 'Austin, TX',
        start: 'Jan 2016',
        end: 'May 2018',
        current: false,
        bullets: [
          'Shipped websites and brand systems for 15+ startup clients.',
          'Won two studio awards for interaction design.',
        ],
      },
    ],
    education: [
      {
        id: newId(),
        degree: 'BFA, Communication Design',
        school: 'California College of the Arts',
        location: 'San Francisco, CA',
        start: '2012',
        end: '2016',
        detail: 'Graduated with distinction. Thesis on accessible interface design.',
      },
    ],
    skills: [
      { id: newId(), label: 'Design', items: 'Interaction design, prototyping, design systems, user research, usability testing' },
      { id: newId(), label: 'Tools', items: 'Figma, Principle, Framer, Miro' },
      { id: newId(), label: 'Code', items: 'HTML, CSS, enough JavaScript to prototype' },
    ],
    projects: [
      {
        id: newId(),
        name: 'Typecheck',
        link: 'typecheck.app',
        detail: 'A free browser tool that grades the readability of font pairings.',
        bullets: ['10k monthly users, featured in two design newsletters.'],
      },
    ],
    certifications: [
      { id: newId(), name: 'NN/g UX Certification', issuer: 'Nielsen Norman Group', year: '2022' },
    ],
    languages: [
      { id: newId(), language: 'English', level: 'Native' },
      { id: newId(), language: 'Spanish', level: 'Professional' },
    ],
    awards: [
      {
        id: newId(),
        title: 'Studio Interaction Design Award',
        issuer: 'Pixelworks Studio',
        year: '2017',
        description: 'Recognized for the onboarding flow that doubled trial-to-paid conversion.',
      },
    ],
    publications: [
      {
        id: newId(),
        title: 'Designing Onboarding People Actually Finish',
        publisher: 'UX Collective',
        year: '2023',
        link: 'uxcollective.example/onboarding',
      },
    ],
    volunteer: [
      {
        id: newId(),
        title: 'Design Mentor',
        company: 'CodePath',
        location: 'Remote',
        start: '2020',
        end: '',
        current: true,
        bullets: ['Mentor early-career designers from underrepresented backgrounds, one cohort a year.'],
      },
    ],
    courses: [
      { id: newId(), name: 'Design Systems Masterclass', provider: 'SuperHi', year: '2021' },
    ],
    sectionVisibility: defaultSectionVisibility(),
    sectionOrder: [...DEFAULT_SECTION_ORDER],
  };
}

// ---------- pure entry list operations (never mutate the input) ----------

export function addEntry<T extends { id: string }>(entries: T[], entry: T): T[] {
  return [...entries, entry];
}

export function removeEntry<T extends { id: string }>(entries: T[], id: string): T[] {
  return entries.filter((e) => e.id !== id);
}

/** Move the entry with the given id one step up (-1) or down (+1). Out-of-range moves are no-ops. */
export function moveEntry<T extends { id: string }>(entries: T[], id: string, direction: -1 | 1): T[] {
  const i = entries.findIndex((e) => e.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= entries.length) return entries;
  const next = [...entries];
  next[i] = entries[j];
  next[j] = entries[i];
  return next;
}

// ---------- validation: the minimum a resume needs before export ----------

/**
 * Check the fields an exported resume needs. Returns human-readable messages;
 * an empty array means the resume is ready to export.
 */
export function validateResume(r: ResumeData): string[] {
  const problems: string[] = [];
  if (!r.contact.fullName.trim()) {
    problems.push('Add your full name so the resume has a header.');
  }
  if (!r.contact.email.trim() && !r.contact.phone.trim()) {
    problems.push('Add an email address or a phone number so employers can reach you.');
  }
  const hasWork = r.experience.some((e) => e.title.trim() || e.company.trim());
  const hasEdu = r.education.some((e) => e.degree.trim() || e.school.trim());
  if (!hasWork && !hasEdu) {
    problems.push('Add at least one work experience or education entry.');
  }
  return problems;
}

// ---------- templates ----------

export interface ResumeTemplate {
  id: TemplateId;
  name: string;
  tagline: string;
  description: string;
  atsNote: string;
}

export const TEMPLATES: ResumeTemplate[] = [
  {
    id: 'ats',
    name: 'ATS Clean',
    tagline: 'Simple, readable, and parser-friendly',
    description: 'A single-column sans-serif layout with standard headings, plain text hierarchy, and no decorative graphics.',
    atsNote: 'Recommended for applicant tracking systems: a single column, familiar section names, and straightforward reading order.',
  },
  {
    id: 'classic',
    name: 'Classic',
    tagline: 'Traditional and familiar',
    description: 'A single-column serif layout with conventional section headings and a centered header.',
    atsNote: 'Single column with standard headings and no graphics; a straightforward choice for parsing.',
  },
  {
    id: 'modern',
    name: 'Modern',
    tagline: 'Clean single-column sans serif',
    description: 'A single-column sans-serif layout with clear hierarchy and conventional section headings.',
    atsNote: 'Single column with standard headings and no graphics; parsing can vary between systems.',
  },
  {
    id: 'compact',
    name: 'Compact',
    tagline: 'Space-efficient single column',
    description: 'A readable single-column layout with tighter spacing; content may still flow onto extra pages.',
    atsNote: 'Single column with standard headings; review the final page count and readability.',
  },
];

export function isTemplateId(v: unknown): v is TemplateId {
  return v === 'ats' || v === 'classic' || v === 'modern' || v === 'compact';
}

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === 'string' && (DEFAULT_SECTION_ORDER as string[]).includes(v);
}

// ---------- serialization with schema versioning ----------

export function serialize(resume: ResumeData): string {
  return JSON.stringify({ ...resume, version: RESUME_SCHEMA_VERSION });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asBullets(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b) => typeof b === 'string').map((b) => (b as string).trim()).filter((b) => b.length > 0);
}

function validId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : newId();
}

/** Sanitize stored visibility; unknown keys are dropped, missing ones default to on. */
function asVisibility(v: unknown): Record<SectionKey, boolean> {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as Record<SectionKey, boolean>;
  for (const k of DEFAULT_SECTION_ORDER) {
    out[k] = src[k] === undefined ? true : src[k] === true;
  }
  return out;
}

/**
 * Sanitize stored section order: keep valid keys in the stored order, drop
 * anything unknown, and append any missing sections in default order so the
 * render never loses a section.
 */
export function asSectionOrder(v: unknown): SectionKey[] {
  const out: SectionKey[] = [];
  if (Array.isArray(v)) {
    for (const k of v) {
      if (isSectionKey(k) && !out.includes(k)) out.push(k);
    }
  }
  for (const k of DEFAULT_SECTION_ORDER) {
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export interface DeserializeInfo {
  resume: ResumeData;
  /** True when an older (or version-less) blob was migrated forward field by field. */
  migrated: boolean;
  /**
   * True when a non-empty stored blob could not be used at all (corrupt JSON
   * or a newer schema version than this build understands). The caller should
   * copy the raw blob to RESUME_BACKUP_KEY before the next save overwrites it.
   */
  wiped: boolean;
}

/**
 * Parse saved JSON back into a ResumeData. Older schema versions are migrated
 * forward (fields copied, new sections defaulted) so upgrading never wipes a
 * draft. Anything corrupt or from a newer unknown schema falls back to a blank
 * resume — see DeserializeInfo.wiped for the backup contract.
 */
export function deserializeInfo(raw: string | null | undefined): DeserializeInfo {
  const blank = blankResume();
  if (!raw) return { resume: blank, migrated: false, wiped: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { resume: blank, migrated: false, wiped: true }; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object') {
    return { resume: blank, migrated: false, wiped: true }; // wrong shape
  }
  const version = (parsed as { version?: unknown }).version;
  const migrating = version === undefined || version === null || version === 1;
  if (!migrating && version !== RESUME_SCHEMA_VERSION) {
    // Newer schema than this build understands: do not guess, do not wipe
    // silently — the caller backs the blob up first.
    return { resume: blank, migrated: false, wiped: true };
  }
  const p = parsed as Record<string, unknown>;
  const contact = (p.contact ?? {}) as Record<string, unknown>;
  const arr = <T>(key: string, fill: (e: Record<string, unknown>) => T): T[] => {
    const v = p[key];
    if (!Array.isArray(v)) return [];
    return v
      .filter((e) => e && typeof e === 'object')
      .map((e) => fill(e as Record<string, unknown>));
  };
  return {
    resume: {
      version: RESUME_SCHEMA_VERSION,
      contact: {
        fullName: asString(contact.fullName),
        title: asString(contact.title),
        email: asString(contact.email),
        phone: asString(contact.phone),
        location: asString(contact.location),
        website: asString(contact.website),
        linkedin: asString(contact.linkedin),
      },
      summary: asString(p.summary),
      experience: arr('experience', (e) => ({
        id: validId(e.id),
        title: asString(e.title),
        company: asString(e.company),
        location: asString(e.location),
        start: asString(e.start),
        end: asString(e.end),
        current: asBool(e.current),
        bullets: asBullets(e.bullets),
      })),
      education: arr('education', (e) => ({
        id: validId(e.id),
        degree: asString(e.degree),
        school: asString(e.school),
        location: asString(e.location),
        start: asString(e.start),
        end: asString(e.end),
        detail: asString(e.detail),
      })),
      skills: arr('skills', (e) => ({ id: validId(e.id), label: asString(e.label), items: asString(e.items) })),
      projects: arr('projects', (e) => ({
        id: validId(e.id),
        name: asString(e.name),
        link: asString(e.link),
        detail: asString(e.detail),
        bullets: asBullets(e.bullets),
      })),
      certifications: arr('certifications', (e) => ({
        id: validId(e.id),
        name: asString(e.name),
        issuer: asString(e.issuer),
        year: asString(e.year),
      })),
      languages: arr('languages', (e) => ({
        id: validId(e.id),
        language: asString(e.language),
        level: asString(e.level),
      })),
      awards: arr('awards', (e) => ({
        id: validId(e.id),
        title: asString(e.title),
        issuer: asString(e.issuer),
        year: asString(e.year),
        description: asString(e.description),
      })),
      publications: arr('publications', (e) => ({
        id: validId(e.id),
        title: asString(e.title),
        publisher: asString(e.publisher),
        year: asString(e.year),
        link: asString(e.link),
      })),
      volunteer: arr('volunteer', (e) => ({
        id: validId(e.id),
        title: asString(e.title),
        company: asString(e.company),
        location: asString(e.location),
        start: asString(e.start),
        end: asString(e.end),
        current: asBool(e.current),
        bullets: asBullets(e.bullets),
      })),
      courses: arr('courses', (e) => ({
        id: validId(e.id),
        name: asString(e.name),
        provider: asString(e.provider),
        year: asString(e.year),
      })),
      sectionVisibility: asVisibility(p.sectionVisibility),
      sectionOrder: asSectionOrder(p.sectionOrder),
    },
    migrated: migrating,
    wiped: false,
  };
}

/** Thin wrapper for the common case; see deserializeInfo for the full contract. */
export function deserialize(raw: string | null | undefined): ResumeData {
  return deserializeInfo(raw).resume;
}

/**
 * True when loading this blob would produce a blank resume, i.e. the stored
 * data is unusable. The caller should back the raw blob up to RESUME_BACKUP_KEY
 * before any save() call replaces it.
 */
export function deserializeWipesStoredBlob(raw: string | null | undefined): boolean {
  return !!raw && deserializeInfo(raw).wiped;
}

// ---------- HTML rendering (pure string building; the page supplies the CSS) ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Click-to-edit hook: marks a preview element as editable, mapping back to a data field. */
function de(path: string): string {
  return ` data-edit="${path}"`;
}

function dateRange(start: string, end: string, current: boolean): string {
  const s = start.trim();
  const e = current ? 'Present' : end.trim();
  if (s && e) return `${esc(s)} – ${esc(e)}`;
  return esc(s || e);
}

function bulletsHtml(bullets: string[], editPrefix?: string): string {
  const items = bullets.map((b) => b.trim());
  const shown = items.map((b, i) => ({ b, i })).filter(({ b }) => b.length > 0);
  if (shown.length === 0) return '';
  return `<ul class="rs-bullets">${shown.map(({ b, i }) => `<li${editPrefix ? de(`${editPrefix}.bullets.${i}`) : ''}>${esc(b)}</li>`).join('')}</ul>`;
}

function contactBits(c: ContactInfo): Array<{ field: string; html: string }> {
  const pairs: Array<[string, string]> = [
    ['email', c.email],
    ['phone', c.phone],
    ['location', c.location],
    ['website', c.website],
    ['linkedin', c.linkedin],
  ];
  return pairs
    .filter(([, s]) => s.trim().length > 0)
    .map(([field, s]) => ({ field, html: esc(s.trim()) }));
}

function section(title: string, inner: string): string {
  if (!inner) return '';
  return `<div class="rs-sec"><div class="rs-sec-t">${esc(title)}</div>${inner}</div>`;
}

function workEntriesHtml(entries: WorkEntry[], sec: string): string {
  const items = entries.filter((e) => e.title.trim() || e.company.trim());
  if (items.length === 0) return '';
  return items
    .map((e) => {
      const p = `${sec}.${e.id}`;
      const co = e.company.trim();
      const loc = e.location.trim();
      const sub = [
        co ? `<span${de(`${p}.company`)}>${esc(co)}</span>` : '',
        loc ? `<span${de(`${p}.location`)}>${esc(loc)}</span>` : '',
      ].filter(Boolean).join(', ');
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title"${de(`${p}.title`)}>${esc(e.title.trim())}</span><span class="rs-item-dates">${dateRange(e.start, e.end, e.current)}</span></div>
        ${sub ? `<div class="rs-item-sub">${sub}</div>` : ''}
        ${bulletsHtml(e.bullets, p)}
      </div>`;
    })
    .join('');
}

function experienceHtml(r: ResumeData): string {
  return workEntriesHtml(r.experience, 'experience');
}

function volunteerHtml(r: ResumeData): string {
  return workEntriesHtml(r.volunteer, 'volunteer');
}

function educationHtml(r: ResumeData): string {
  const items = r.education.filter((e) => e.degree.trim() || e.school.trim());
  if (items.length === 0) return '';
  return items
    .map((e) => {
      const p = `education.${e.id}`;
      const sub = [e.school.trim(), e.location.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title"${de(`${p}.degree`)}>${esc(e.degree.trim() || e.school.trim())}</span><span class="rs-item-dates">${dateRange(e.start, e.end, false)}</span></div>
        ${e.degree.trim() && sub ? `<div class="rs-item-sub"${de(`${p}.school`)}>${sub}</div>` : ''}
        ${e.detail.trim() ? `<div class="rs-detail"${de(`${p}.detail`)}>${esc(e.detail.trim())}</div>` : ''}
      </div>`;
    })
    .join('');
}

function skillsHtml(r: ResumeData): string {
  const groups = r.skills.filter((g) => g.label.trim() || g.items.trim());
  if (groups.length === 0) return '';
  return `<div class="rs-skills">${groups
    .map((g) => {
      const p = `skills.${g.id}`;
      return g.label.trim()
        ? `<div class="rs-skill"><span class="rs-skill-label"${de(`${p}.label`)}>${esc(g.label.trim())}</span><span class="rs-skill-items"${de(`${p}.items`)}>${esc(g.items.trim())}</span></div>`
        : `<div class="rs-skill"><span class="rs-skill-items"${de(`${p}.items`)}>${esc(g.items.trim())}</span></div>`;
    })
    .join('')}</div>`;
}

function projectsHtml(r: ResumeData): string {
  const items = r.projects.filter((p) => p.name.trim());
  if (items.length === 0) return '';
  return items
    .map((p) => {
      const ep = `projects.${p.id}`;
      const link = p.link.trim() ? ` <span class="rs-proj-link"${de(`${ep}.link`)}>${esc(p.link.trim())}</span>` : '';
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title"${de(`${ep}.name`)}>${esc(p.name.trim())}${link}</span></div>
        ${p.detail.trim() ? `<div class="rs-detail"${de(`${ep}.detail`)}>${esc(p.detail.trim())}</div>` : ''}
        ${bulletsHtml(p.bullets, ep)}
      </div>`;
    })
    .join('');
}

function certificationsHtml(r: ResumeData): string {
  const items = r.certifications.filter((c) => c.name.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((c) => {
      const tail = [c.issuer.trim(), c.year.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-list-row"><span${de(`certifications.${c.id}.name`)}>${esc(c.name.trim())}</span>${tail ? `<span class="rs-list-tail">${tail}</span>` : ''}</div>`;
    })
    .join('')}</div>`;
}

function languagesHtml(r: ResumeData): string {
  const items = r.languages.filter((l) => l.language.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((l) => `<div class="rs-list-row"><span${de(`languages.${l.id}.language`)}>${esc(l.language.trim())}</span>${l.level.trim() ? `<span class="rs-list-tail">${esc(l.level.trim())}</span>` : ''}</div>`)
    .join('')}</div>`;
}

function awardsHtml(r: ResumeData): string {
  const items = r.awards.filter((a) => a.title.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((a) => {
      const tail = [a.issuer.trim(), a.year.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-list-row"><span${de(`awards.${a.id}.title`)}>${esc(a.title.trim())}${a.description.trim() ? `<div class="rs-detail">${esc(a.description.trim())}</div>` : ''}</span>${tail ? `<span class="rs-list-tail">${tail}</span>` : ''}</div>`;
    })
    .join('')}</div>`;
}

function publicationsHtml(r: ResumeData): string {
  const items = r.publications.filter((p) => p.title.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((p) => {
      const tail = [p.publisher.trim(), p.year.trim()].filter(Boolean).map(esc).join(', ');
      const link = p.link.trim() ? ` <span class="rs-proj-link">${esc(p.link.trim())}</span>` : '';
      return `<div class="rs-list-row"><span${de(`publications.${p.id}.title`)}>${esc(p.title.trim())}${link}</span>${tail ? `<span class="rs-list-tail">${tail}</span>` : ''}</div>`;
    })
    .join('')}</div>`;
}

function coursesHtml(r: ResumeData): string {
  const items = r.courses.filter((c) => c.name.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((c) => {
      const tail = [c.provider.trim(), c.year.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-list-row"><span${de(`courses.${c.id}.name`)}>${esc(c.name.trim())}</span>${tail ? `<span class="rs-list-tail">${tail}</span>` : ''}</div>`;
    })
    .join('')}</div>`;
}

/** Rendered HTML for each body section (contact is the header, handled separately). */
const BODY_SECTIONS: Record<Exclude<SectionKey, 'contact'>, { heading: string; html: (r: ResumeData) => string }> = {
  summary: {
    heading: 'Professional Summary',
    html: (r) => (r.summary.trim() ? `<p class="rs-summary"${de('summary.text')}>${esc(r.summary.trim())}</p>` : ''),
  },
  experience: { heading: 'Work Experience', html: experienceHtml },
  education: { heading: 'Education', html: educationHtml },
  skills: { heading: 'Skills', html: skillsHtml },
  projects: { heading: 'Projects', html: projectsHtml },
  certifications: { heading: 'Certifications', html: certificationsHtml },
  languages: { heading: 'Languages', html: languagesHtml },
  awards: { heading: 'Awards', html: awardsHtml },
  publications: { heading: 'Publications', html: publicationsHtml },
  volunteer: { heading: 'Volunteer Experience', html: volunteerHtml },
  courses: { heading: 'Courses', html: coursesHtml },
};

/**
 * Render the whole resume as an HTML string for the given template.
 * Empty sections are skipped; sections toggled off in sectionVisibility are
 * skipped; the rest follow sectionOrder. All user content is escaped.
 */
export function renderResume(r: ResumeData, template: TemplateId): string {
  const visibility = r.sectionVisibility ?? defaultSectionVisibility();
  const order = asSectionOrder(r.sectionOrder);
  const visible = (k: SectionKey) => visibility[k] !== false;

  const c = r.contact;
  const bits = contactBits(c);
  const bodyHtml = (skip: SectionKey[] = []) =>
    order
      .filter((k): k is Exclude<SectionKey, 'contact'> => k !== 'contact' && !skip.includes(k) && visible(k))
      .map((k) => {
        const def = BODY_SECTIONS[k];
        return def ? section(def.heading, def.html(r)) : '';
      })
      .join('');

  const name = c.fullName.trim() ? esc(c.fullName.trim()) : '<span class="rs-empty-name">Your Name</span>';
  const role = c.title.trim() ? `<div class="rs-role"${de('contact.title')}>${esc(c.title.trim())}</div>` : '';
  const contactLine = bits.length > 0 ? `<div class="rs-contact">${bits.map((b) => `<span${de(`contact.${b.field}`)}>${b.html}</span>`).join(' <span class="rs-sep">·</span> ')}</div>` : '';
  const headClass = template === 'classic' ? 'rs-head rs-head-center' : 'rs-head rs-head-left';
  const header = visible('contact')
    ? `<div class="${headClass}">
      <div class="rs-name"${de('contact.fullName')}>${name}</div>${role}${contactLine}
    </div>`
    : '';
  return `${header}${bodyHtml()}`;
}
