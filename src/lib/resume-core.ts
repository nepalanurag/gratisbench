// Pure resume-builder logic shared by the browser tool and the Node verification script.
// No DOM access here — everything is data in, data/HTML strings out.

export const RESUME_SCHEMA_VERSION = 1;
export const RESUME_STORAGE_KEY = 'freekit.resume-builder.v1';
export const TEMPLATE_STORAGE_KEY = 'freekit.resume-builder.template';

export type TemplateId = 'classic' | 'modern' | 'compact';

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
    id: 'classic',
    name: 'Classic',
    tagline: 'Traditional and familiar',
    description: 'Centered serif header, single column, ruled section headings. The resume shape hiring managers expect.',
    atsNote: 'Most ATS-safe: single column, standard headings, no graphics.',
  },
  {
    id: 'modern',
    name: 'Modern',
    tagline: 'Two-column with sidebar',
    description: 'Contact, skills, and languages in a tinted sidebar; experience and education in the main column.',
    atsNote: 'Sidebar layouts parse fine in most systems, but Classic is the safer pick.',
  },
  {
    id: 'compact',
    name: 'Compact',
    tagline: 'Dense one-pager',
    description: 'Tight spacing and small type built to fit a full career on a single page.',
    atsNote: 'Single column and ATS-friendly when it fits on one page.',
  },
];

export function isTemplateId(v: unknown): v is TemplateId {
  return v === 'classic' || v === 'modern' || v === 'compact';
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

/**
 * Parse saved JSON back into a ResumeData. Anything corrupt, foreign, or from a
 * different schema version falls back to a blank resume instead of throwing.
 */
export function deserialize(raw: string | null | undefined): ResumeData {
  const blank = blankResume();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== RESUME_SCHEMA_VERSION) {
    return blank; // wrong shape or schema version
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
  };
}

// ---------- HTML rendering (pure string building; the page supplies the CSS) ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function dateRange(start: string, end: string, current: boolean): string {
  const s = start.trim();
  const e = current ? 'Present' : end.trim();
  if (s && e) return `${esc(s)} – ${esc(e)}`;
  return esc(s || e);
}

function bulletsHtml(bullets: string[]): string {
  const items = bullets.map((b) => b.trim()).filter((b) => b.length > 0);
  if (items.length === 0) return '';
  return `<ul class="rs-bullets">${items.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
}

function contactBits(c: ContactInfo): string[] {
  return [c.email, c.phone, c.location, c.website, c.linkedin]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(esc);
}

function section(title: string, inner: string): string {
  if (!inner) return '';
  return `<div class="rs-sec"><div class="rs-sec-t">${esc(title)}</div>${inner}</div>`;
}

function experienceHtml(r: ResumeData): string {
  const items = r.experience.filter((e) => e.title.trim() || e.company.trim());
  if (items.length === 0) return '';
  return items
    .map((e) => {
      const sub = [e.company.trim(), e.location.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title">${esc(e.title.trim())}</span><span class="rs-item-dates">${dateRange(e.start, e.end, e.current)}</span></div>
        ${sub ? `<div class="rs-item-sub">${sub}</div>` : ''}
        ${bulletsHtml(e.bullets)}
      </div>`;
    })
    .join('');
}

function educationHtml(r: ResumeData): string {
  const items = r.education.filter((e) => e.degree.trim() || e.school.trim());
  if (items.length === 0) return '';
  return items
    .map((e) => {
      const sub = [e.school.trim(), e.location.trim()].filter(Boolean).map(esc).join(', ');
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title">${esc(e.degree.trim() || e.school.trim())}</span><span class="rs-item-dates">${dateRange(e.start, e.end, false)}</span></div>
        ${e.degree.trim() && sub ? `<div class="rs-item-sub">${sub}</div>` : ''}
        ${e.detail.trim() ? `<div class="rs-detail">${esc(e.detail.trim())}</div>` : ''}
      </div>`;
    })
    .join('');
}

function skillsHtml(r: ResumeData): string {
  const groups = r.skills.filter((g) => g.label.trim() || g.items.trim());
  if (groups.length === 0) return '';
  return `<div class="rs-skills">${groups
    .map((g) =>
      g.label.trim()
        ? `<div class="rs-skill"><span class="rs-skill-label">${esc(g.label.trim())}</span><span class="rs-skill-items">${esc(g.items.trim())}</span></div>`
        : `<div class="rs-skill"><span class="rs-skill-items">${esc(g.items.trim())}</span></div>`
    )
    .join('')}</div>`;
}

function projectsHtml(r: ResumeData): string {
  const items = r.projects.filter((p) => p.name.trim());
  if (items.length === 0) return '';
  return items
    .map((p) => {
      const link = p.link.trim() ? ` <span class="rs-proj-link">${esc(p.link.trim())}</span>` : '';
      return `<div class="rs-item">
        <div class="rs-item-head"><span class="rs-item-title">${esc(p.name.trim())}${link}</span></div>
        ${p.detail.trim() ? `<div class="rs-detail">${esc(p.detail.trim())}</div>` : ''}
        ${bulletsHtml(p.bullets)}
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
      return `<div class="rs-list-row"><span>${esc(c.name.trim())}</span>${tail ? `<span class="rs-list-tail">${tail}</span>` : ''}</div>`;
    })
    .join('')}</div>`;
}

function languagesHtml(r: ResumeData): string {
  const items = r.languages.filter((l) => l.language.trim());
  if (items.length === 0) return '';
  return `<div class="rs-list">${items
    .map((l) => `<div class="rs-list-row"><span>${esc(l.language.trim())}</span>${l.level.trim() ? `<span class="rs-list-tail">${esc(l.level.trim())}</span>` : ''}</div>`)
    .join('')}</div>`;
}

/**
 * Render the whole resume as an HTML string for the given template.
 * Empty sections are skipped. All user content is escaped.
 */
export function renderResume(r: ResumeData, template: TemplateId): string {
  const c = r.contact;
  const name = c.fullName.trim() ? esc(c.fullName.trim()) : '<span class="rs-empty-name">Your Name</span>';
  const role = c.title.trim() ? `<div class="rs-role">${esc(c.title.trim())}</div>` : '';
  const bits = contactBits(c);
  const contactLine = bits.length > 0 ? `<div class="rs-contact">${bits.join(' <span class="rs-sep">·</span> ')}</div>` : '';

  const summary = r.summary.trim()
    ? section('Professional Summary', `<p class="rs-summary">${esc(r.summary.trim())}</p>`)
    : '';
  const experience = section('Work Experience', experienceHtml(r));
  const education = section('Education', educationHtml(r));
  const skills = section('Skills', skillsHtml(r));
  const projects = section('Projects', projectsHtml(r));
  const certifications = section('Certifications', certificationsHtml(r));
  const languages = section('Languages', languagesHtml(r));

  if (template === 'modern') {
    const sideContact = bits.length > 0
      ? `<div class="rs-side-sec"><div class="rs-side-t">Contact</div>${bits.map((b) => `<div class="rs-side-line">${b}</div>`).join('')}</div>`
      : '';
    return `<div class="rs-mod">
      <aside class="rs-side">
        <div class="rs-side-name">${name}</div>${role.replace('rs-role', 'rs-side-role')}
        ${sideContact}
        ${skills ? `<div class="rs-side-sec"><div class="rs-side-t">Skills</div><div class="rs-side-body">${skillsHtml(r)}</div></div>` : ''}
        ${languages ? `<div class="rs-side-sec"><div class="rs-side-t">Languages</div><div class="rs-side-body">${languagesHtml(r)}</div></div>` : ''}
      </aside>
      <div class="rs-main">${summary}${experience}${education}${projects}${certifications}</div>
    </div>`;
  }

  const headClass = template === 'compact' ? 'rs-head rs-head-left' : 'rs-head rs-head-center';
  return `<div class="${headClass}">
      <div class="rs-name">${name}</div>${role}${contactLine}
    </div>
    ${summary}${experience}${education}${skills}${projects}${certifications}${languages}`;
}
