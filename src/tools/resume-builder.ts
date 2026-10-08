// Resume builder: DOM glue. Pure model logic lives in ../lib/resume-core.ts
import type { ResumeData, SectionKey, TemplateId } from '../lib/resume-core.ts';
import {
  TEMPLATES,
  blankResume,
  exampleResume,
  blankWorkEntry,
  blankEducationEntry,
  blankSkillGroup,
  blankProjectEntry,
  blankCertificationEntry,
  blankLanguageEntry,
  blankAwardEntry,
  blankPublicationEntry,
  blankCourseEntry,
  addEntry,
  removeEntry,
  moveEntry,
  validateResume,
  isTemplateId,
  isSectionKey,
  RESUME_STORAGE_KEY,
  RESUME_BACKUP_KEY,
  TEMPLATE_STORAGE_KEY,
  serialize,
  deserializeInfo,
  asSectionOrder,
  renderResume,
} from '../lib/resume-core.ts';
import { el, showError, hideError, downloadText, ICONS, armConfirmButton } from './common.ts';

type ListKey = 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'languages' | 'awards' | 'publications' | 'volunteer' | 'courses';

interface FieldDef {
  field: string;
  label: string;
  kind: 'text' | 'textarea' | 'checkbox';
  span?: boolean;
  placeholder?: string;
}

interface SectionDef {
  key: ListKey;
  title: string;
  hint: string;
  singular: string;
  blank: () => { id: string };
  titleOf: (e: Record<string, unknown>) => string;
  fields: FieldDef[];
}

const WORK_FIELDS: FieldDef[] = [
  { field: 'title', label: 'Job title', kind: 'text', placeholder: 'Senior Product Designer' },
  { field: 'company', label: 'Company', kind: 'text', placeholder: 'Northwind Mobile' },
  { field: 'location', label: 'Location', kind: 'text', placeholder: 'San Francisco, CA' },
  { field: 'start', label: 'Start', kind: 'text', placeholder: 'Mar 2021' },
  { field: 'end', label: 'End', kind: 'text', placeholder: 'Feb 2024' },
  { field: 'current', label: 'I currently work here', kind: 'checkbox' },
  { field: 'bullets', label: 'Bullets (one per line)', kind: 'textarea', span: true, placeholder: 'Led redesign of onboarding; activation rose from 31% to 47%.' },
];

const VOLUNTEER_FIELDS: FieldDef[] = [
  { field: 'title', label: 'Role', kind: 'text', placeholder: 'Design Mentor' },
  { field: 'company', label: 'Organization', kind: 'text', placeholder: 'CodePath' },
  { field: 'location', label: 'Location', kind: 'text', placeholder: 'Remote' },
  { field: 'start', label: 'Start', kind: 'text', placeholder: '2020' },
  { field: 'end', label: 'End', kind: 'text', placeholder: '2024' },
  { field: 'current', label: 'I currently volunteer here', kind: 'checkbox' },
  { field: 'bullets', label: 'Bullets (one per line)', kind: 'textarea', span: true, placeholder: 'Mentor one cohort of early-career designers a year.' },
];

const SECTIONS: SectionDef[] = [
  {
    key: 'experience',
    title: 'Work experience',
    hint: 'Most recent first. One line per bullet; start bullets with strong verbs.',
    singular: 'position',
    blank: blankWorkEntry,
    titleOf: (e) => `${e.title || 'Untitled position'}${e.company ? ` · ${e.company}` : ''}`,
    fields: WORK_FIELDS,
  },
  {
    key: 'education',
    title: 'Education',
    hint: 'Degrees and relevant coursework.',
    singular: 'entry',
    blank: blankEducationEntry,
    titleOf: (e) => `${e.degree || 'Untitled degree'}${e.school ? ` · ${e.school}` : ''}`,
    fields: [
      { field: 'degree', label: 'Degree', kind: 'text', placeholder: 'BFA, Communication Design' },
      { field: 'school', label: 'School', kind: 'text', placeholder: 'California College of the Arts' },
      { field: 'location', label: 'Location', kind: 'text', placeholder: 'San Francisco, CA' },
      { field: 'start', label: 'Start', kind: 'text', placeholder: '2012' },
      { field: 'end', label: 'End', kind: 'text', placeholder: '2016' },
      { field: 'detail', label: 'Detail', kind: 'textarea', span: true, placeholder: 'Graduated with distinction.' },
    ],
  },
  {
    key: 'skills',
    title: 'Skills',
    hint: 'Group related skills so they scan quickly.',
    singular: 'skill group',
    blank: blankSkillGroup,
    titleOf: (e) => `${e.label || 'Ungrouped'}`,
    fields: [
      { field: 'label', label: 'Group name', kind: 'text', placeholder: 'Design' },
      { field: 'items', label: 'Skills', kind: 'text', span: true, placeholder: 'Interaction design, prototyping, Figma' },
    ],
  },
  {
    key: 'projects',
    title: 'Projects',
    hint: 'Side projects, open source, or freelance work worth showing.',
    singular: 'project',
    blank: blankProjectEntry,
    titleOf: (e) => `${e.name || 'Untitled project'}`,
    fields: [
      { field: 'name', label: 'Project name', kind: 'text', placeholder: 'Typecheck' },
      { field: 'link', label: 'Link', kind: 'text', placeholder: 'typecheck.app' },
      { field: 'detail', label: 'One-line description', kind: 'textarea', span: true, placeholder: 'A free browser tool that grades font pairings.' },
      { field: 'bullets', label: 'Bullets (one per line)', kind: 'textarea', span: true, placeholder: '10k monthly users.' },
    ],
  },
  {
    key: 'certifications',
    title: 'Certifications',
    hint: 'Optional. Keep it to credentials that matter for the role.',
    singular: 'certification',
    blank: blankCertificationEntry,
    titleOf: (e) => `${e.name || 'Untitled certification'}`,
    fields: [
      { field: 'name', label: 'Name', kind: 'text', placeholder: 'NN/g UX Certification' },
      { field: 'issuer', label: 'Issuer', kind: 'text', placeholder: 'Nielsen Norman Group' },
      { field: 'year', label: 'Year', kind: 'text', placeholder: '2022' },
    ],
  },
  {
    key: 'languages',
    title: 'Languages',
    hint: 'Optional. Include a level so it reads honestly.',
    singular: 'language',
    blank: blankLanguageEntry,
    titleOf: (e) => `${e.language || 'Untitled language'}`,
    fields: [
      { field: 'language', label: 'Language', kind: 'text', placeholder: 'Spanish' },
      { field: 'level', label: 'Level', kind: 'text', placeholder: 'Professional' },
    ],
  },
  {
    key: 'awards',
    title: 'Awards',
    hint: 'Optional. Honors and recognitions worth naming.',
    singular: 'award',
    blank: blankAwardEntry,
    titleOf: (e) => `${e.title || 'Untitled award'}${e.issuer ? ` · ${e.issuer}` : ''}`,
    fields: [
      { field: 'title', label: 'Title', kind: 'text', placeholder: 'Design Award of the Year' },
      { field: 'issuer', label: 'Issuer', kind: 'text', placeholder: 'Interaction Awards' },
      { field: 'year', label: 'Year', kind: 'text', placeholder: '2023' },
      { field: 'description', label: 'Description', kind: 'textarea', span: true, placeholder: 'What it was for, in one line.' },
    ],
  },
  {
    key: 'publications',
    title: 'Publications',
    hint: 'Optional. Articles, papers, or posts with your name on them.',
    singular: 'publication',
    blank: blankPublicationEntry,
    titleOf: (e) => `${e.title || 'Untitled publication'}`,
    fields: [
      { field: 'title', label: 'Title', kind: 'text', placeholder: 'Designing Onboarding People Actually Finish' },
      { field: 'publisher', label: 'Publisher', kind: 'text', placeholder: 'UX Collective' },
      { field: 'year', label: 'Year', kind: 'text', placeholder: '2023' },
      { field: 'link', label: 'Link', kind: 'text', placeholder: 'example.com/article' },
    ],
  },
  {
    key: 'volunteer',
    title: 'Volunteer experience',
    hint: 'Optional. Unpaid work that shows who you are. Most recent first.',
    singular: 'role',
    blank: blankWorkEntry,
    titleOf: (e) => `${e.title || 'Untitled role'}${e.company ? ` · ${e.company}` : ''}`,
    fields: VOLUNTEER_FIELDS,
  },
  {
    key: 'courses',
    title: 'Courses',
    hint: 'Optional. Training and coursework relevant to the roles you want.',
    singular: 'course',
    blank: blankCourseEntry,
    titleOf: (e) => `${e.name || 'Untitled course'}`,
    fields: [
      { field: 'name', label: 'Course name', kind: 'text', placeholder: 'Design Systems Masterclass' },
      { field: 'provider', label: 'Provider', kind: 'text', placeholder: 'SuperHi' },
      { field: 'year', label: 'Year', kind: 'text', placeholder: '2021' },
    ],
  },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initResumeBuilder(): void {
  const loaded = loadResume();
  let resume: ResumeData = loaded.resume;
  let template: TemplateId = loadTemplate();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const editor = el('rb-editor');
  const preview = el('rb-preview');
  const workspace = el('rb-workspace');
  const originalTitle = document.title;

  function loadResume(): { resume: ResumeData; backupRaw: string | null } {
    try {
      const raw = localStorage.getItem(RESUME_STORAGE_KEY);
      const info = deserializeInfo(raw);
      let backupRaw: string | null = null;
      if (info.wiped && raw) {
        // The stored blob was unusable (corrupt or a newer schema). Keep a
        // copy under a separate key before the next save overwrites it, so
        // the user's draft is never silently wiped.
        try {
          localStorage.setItem(RESUME_BACKUP_KEY, raw);
          backupRaw = raw;
        } catch {
          // Backup failing is not fatal; the tool still works for this session.
        }
      }
      return { resume: info.resume, backupRaw };
    } catch {
      return { resume: blankResume(), backupRaw: null }; // storage blocked or unavailable
    }
  }

  function loadTemplate(): TemplateId {
    try {
      const v = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      return isTemplateId(v) ? v : 'classic';
    } catch {
      return 'classic';
    }
  }

  function save(): void {
    try {
      localStorage.setItem(RESUME_STORAGE_KEY, serialize(resume));
      localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
    } catch {
      // Storage full or blocked: the tool still works for this session.
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  /** Write immediately, dropping any pending debounced save. */
  function flushSave(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    save();
  }

  // The 400 ms debounce can lose the tail of what was typed if the tab closes
  // inside the window. Flush on both events: pagehide covers tab close and
  // bfcache navigation, beforeunload covers the rest. save() is idempotent.
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);

  // ---------- corrupt-save backup banner ----------

  // If the stored resume was unreadable on load, a backup was written under
  // RESUME_BACKUP_KEY. Say so on screen, with a way to restore or download it.
  function showBackupBanner(backupRaw: string): void {
    const banner = document.createElement('div');
    banner.className = 'error-box no-print';
    banner.setAttribute('role', 'alert');
    banner.innerHTML =
      `<p><strong>Your saved resume couldn't be read. Starting blank — your previous data was preserved.</strong></p>` +
      `<div class="file-actions">` +
      `<button type="button" class="btn btn-secondary btn-small" id="rb-restore-backup">Try to restore</button>` +
      `<button type="button" class="btn btn-secondary btn-small" id="rb-download-backup">Download backup</button>` +
      `<button type="button" class="icon-btn" id="rb-dismiss-backup" aria-label="Dismiss warning">×</button>` +
      `</div>`;
    workspace.before(banner);

    el<HTMLButtonElement>('rb-restore-backup').addEventListener('click', () => {
      hideError('rb-error');
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(RESUME_BACKUP_KEY);
      } catch {
        // storage blocked: fall through to the error below
      }
      let info: ReturnType<typeof deserializeInfo> | null = null;
      try {
        info = deserializeInfo(raw);
      } catch {
        info = null;
      }
      if (!info || info.wiped || !raw) {
        showError('rb-error', 'The backup could not be read either. Your downloaded backup file still has the raw data.');
        el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      resume = info.resume;
      save();
      renderEditor();
      renderPreview();
      banner.remove();
    });

    el<HTMLButtonElement>('rb-download-backup').addEventListener('click', () => {
      downloadText('resume-backup.json', backupRaw, 'application/json');
    });

    el<HTMLButtonElement>('rb-dismiss-backup').addEventListener('click', () => {
      banner.remove();
    });
  }

  // ---------- preview ----------

  function renderPreview(): void {
    preview.className = `resume-doc resume-${template}`;
    preview.innerHTML = renderResume(resume, template);
  }

  // Click-to-edit: click text in the preview to edit it in place.
  function applyPreviewEdit(path: string, text: string): void {
    const parts = path.split('.');
    if (parts[0] === 'contact' && parts.length === 2) {
      const f = parts[1] as keyof typeof resume.contact;
      if (f in resume.contact) resume.contact[f] = text;
    } else if (parts[0] === 'summary' && parts[1] === 'text') {
      resume.summary = text;
    } else if (parts.length >= 3) {
      const [sec, id, field] = parts;
      const list = (resume as unknown as Record<string, Array<{ id: string } & Record<string, unknown>> | undefined>)[sec];
      const entry = Array.isArray(list) ? list.find((e) => e.id === id) : undefined;
      if (entry && field in entry) {
        if (field === 'bullets' && parts.length === 4) {
          const idx = Number(parts[3]);
          const bullets = entry.bullets as string[];
          if (Array.isArray(bullets) && idx >= 0 && idx < bullets.length) bullets[idx] = text;
        } else if (typeof entry[field] === 'string') {
          entry[field] = text;
        }
      }
    }
    save();
    renderEditor();
    renderPreview();
  }

  let editingEl: HTMLElement | null = null;
  preview.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest?.('[data-edit]') as HTMLElement | null;
    if (!t || t === editingEl) return;
    // Finish any open edit first.
    if (editingEl) editingEl.blur();
    editingEl = t;
    t.contentEditable = 'true';
    t.classList.add('rs-editing');
    t.focus();
    document.getSelection()?.selectAllChildren(t);
    t.title = 'Editing — press Enter to save, Esc to cancel';

    const done = (saveIt: boolean) => {
      if (editingEl !== t) return;
      editingEl = null;
      t.contentEditable = 'false';
      t.classList.remove('rs-editing');
      t.removeAttribute('title');
      const text = (t.textContent ?? '').trim();
      const path = t.getAttribute('data-edit') ?? '';
      if (saveIt && path) applyPreviewEdit(path, text);
      else renderPreview();
    };
    t.onblur = () => done(true);
    t.onkeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        done(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        done(false);
      }
      ev.stopPropagation();
    };
  });

  // ---------- editor ----------

  function fieldHtml(sec: SectionDef, id: string, f: FieldDef, value: unknown): string {
    const val = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
    const attrs = `data-sec="${sec.key}" data-id="${id}" data-field="${f.field}"`;
    const cls = f.span ? 'rb-field rb-span2' : 'rb-field';
    if (f.kind === 'checkbox') {
      return `<label class="checkline ${cls}"><input type="checkbox" ${attrs} ${value === true ? 'checked' : ''} /> ${escapeHtml(f.label)}</label>`;
    }
    const label = `<span>${escapeHtml(f.label)}</span>`;
    if (f.kind === 'textarea') {
      return `<label class="${cls}">${label}<textarea ${attrs} placeholder="${escapeHtml(f.placeholder ?? '')}" rows="3">${escapeHtml(val)}</textarea></label>`;
    }
    return `<label class="${cls}">${label}<input type="text" ${attrs} value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder ?? '')}" /></label>`;
  }

  function entryHtml(sec: SectionDef, entry: { id: string } & Record<string, unknown>, index: number, total: number): string {
    const fields = sec.fields.map((f) => fieldHtml(sec, entry.id, f, entry[f.field])).join('');
    return `<div class="rb-entry">
      <div class="rb-entry-bar">
        <span class="rb-entry-title">${escapeHtml(sec.titleOf(entry))}</span>
        <button type="button" class="icon-btn" data-act="up" data-sec="${sec.key}" data-id="${entry.id}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
        <button type="button" class="icon-btn" data-act="down" data-sec="${sec.key}" data-id="${entry.id}" ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
        <button type="button" class="icon-btn" data-act="remove" data-sec="${sec.key}" data-id="${entry.id}" aria-label="Remove">${ICONS.x}</button>
      </div>
      <div class="rb-grid">${fields}</div>
    </div>`;
  }

  function contactHtml(): string {
    const c = resume.contact;
    const defs: [string, string, string][] = [
      ['fullName', 'Full name', 'Sam Rivera'],
      ['title', 'Job title or headline', 'Senior Product Designer'],
      ['email', 'Email', 'sam.rivera@example.com'],
      ['phone', 'Phone', '(415) 555-0132'],
      ['location', 'Location', 'San Francisco, CA'],
      ['website', 'Website', 'samrivera.design'],
      ['linkedin', 'LinkedIn', 'linkedin.com/in/samrivera'],
    ];
    return `<div class="rb-grid">${defs
      .map(
        ([field, label, ph]) =>
          `<label class="rb-field"><span>${label}</span><input type="text" data-sec="contact" data-field="${field}" value="${escapeHtml(c[field as keyof typeof c])}" placeholder="${escapeHtml(ph)}" /></label>`
      )
      .join('')}</div>`;
  }

  function summaryFieldsHtml(): string {
    return `<label class="rb-field"><span>Professional summary (2-4 sentences)</span><textarea data-sec="summary" rows="4" placeholder="Product designer with 8 years of experience shipping consumer mobile apps.">${escapeHtml(resume.summary)}</textarea></label>`;
  }

  /** Section header with visibility toggle and up/down reorder arrows. */
  function sectionHead(key: SectionKey, title: string, index: number, total: number, extra: string): string {
    const visible = resume.sectionVisibility[key] !== false;
    return `<div class="rb-section-head"><h3>${title}</h3>
      <div class="rb-sec-tools">
        <label class="rb-sec-toggle"><input type="checkbox" data-sec-toggle="${key}" ${visible ? 'checked' : ''} /> Show</label>
        <button type="button" class="icon-btn" data-act="sec-up" data-sec="${key}" ${index === 0 ? 'disabled' : ''} aria-label="Move section up">${ICONS.up}</button>
        <button type="button" class="icon-btn" data-act="sec-down" data-sec="${key}" ${index === total - 1 ? 'disabled' : ''} aria-label="Move section down">${ICONS.down}</button>
        ${extra}
      </div></div>`;
  }

  function sectionShell(key: SectionKey, title: string, ariaLabel: string, index: number, total: number, body: string, extra = ''): string {
    const visible = resume.sectionVisibility[key] !== false;
    const hiddenCls = visible ? '' : ' rb-section-hidden';
    const note = visible
      ? ''
      : '<p class="hint rb-hidden-note">Hidden from the resume. Turn Show on to include it again.</p>';
    return `<section class="rb-section${hiddenCls}" aria-label="${ariaLabel}">
      ${sectionHead(key, title, index, total, extra)}
      ${note}
      ${body}
    </section>`;
  }

  function renderEditor(): void {
    const order = asSectionOrder(resume.sectionOrder);
    const ats = `<section class="rb-section" aria-label="ATS-friendliness check">
      <div class="rb-section-head"><h3>ATS-friendliness check</h3><button type="button" class="btn btn-secondary btn-small" data-act="ats-check">Check my resume</button></div>
      <p class="hint">Hiring software parses simple, standard resumes best. This checks yours against the common rules — nothing here changes your resume.</p>
      <div id="rb-ats-results"></div>
    </section>`;
    editor.innerHTML = ats + order
      .map((key, i) => {
        if (key === 'contact') {
          return sectionShell(key, 'Contact', 'Contact details', i, order.length, contactHtml());
        }
        if (key === 'summary') {
          return sectionShell(key, 'Summary', 'Professional summary', i, order.length, summaryFieldsHtml());
        }
        const sec = SECTIONS.find((s) => s.key === key);
        if (!sec) return '';
        const entries = (resume[sec.key] as unknown as ({ id: string } & Record<string, unknown>)[]);
        const add = `<button type="button" class="btn btn-secondary btn-small" data-act="add" data-sec="${sec.key}">Add ${sec.singular}</button>`;
        const body = `<p class="hint">${sec.hint}</p>${entries.map((e, j) => entryHtml(sec, e, j, entries.length)).join('')}`;
        return sectionShell(key, sec.title, sec.title, i, order.length, body, add);
      })
      .join('');
  }

  /** Move a whole section one step up (-1) or down (+1) in the render order. */
  function moveSection(key: SectionKey, direction: -1 | 1): void {
    const order = asSectionOrder(resume.sectionOrder);
    const i = order.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    next[i] = order[j];
    next[j] = order[i];
    resume.sectionOrder = next;
    save();
    renderEditor();
    renderPreview();
  }

  // ---------- ATS-friendliness check ----------

  interface AtsCheck {
    label: string;
    status: 'pass' | 'warn' | 'info';
    detail: string;
  }

  const ACTION_VERBS = new Set(
    'led built designed developed managed created launched improved increased reduced grew shipped owned drove delivered mentored spearheaded streamlined automated negotiated presented published researched analyzed optimized scaled founded pioneered transformed accelerated achieved coordinated directed established generated implemented initiated orchestrated produced revamped secured advised collaborated contributed crafted defined executed facilitated guided headed introduced partnered piloted shaped steered supervised tested trained wrote authored boosted cut doubled tripled saved won earned'.split(
      ' '
    )
  );

  function wordsOf(s: string): string[] {
    return s.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  }

  function runAtsChecklist(r: ResumeData): AtsCheck[] {
    const out: AtsCheck[] = [];
    const c = r.contact;

    const missing = [
      !c.fullName.trim() && 'name',
      !c.email.trim() && 'email',
      !c.phone.trim() && 'phone',
    ].filter(Boolean) as string[];
    out.push({
      label: 'Contact details',
      status: missing.length === 0 ? 'pass' : 'warn',
      detail:
        missing.length === 0
          ? 'Name, email, and phone are all present so recruiters can reach you.'
          : `Missing: ${missing.join(', ')}.`,
    });

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim());
    out.push({
      label: 'Email format',
      status: !c.email.trim() ? 'warn' : emailOk ? 'pass' : 'warn',
      detail: !c.email.trim()
        ? 'No email address entered yet.'
        : emailOk
          ? 'The email address looks valid.'
          : 'That email address does not look right — check for typos.',
    });

    const sentences = r.summary.trim() ? r.summary.trim().split(/[.!?]+/).filter((s) => s.trim()).length : 0;
    out.push({
      label: 'Professional summary',
      status: sentences >= 2 && sentences <= 4 ? 'pass' : sentences === 0 ? 'warn' : 'info',
      detail:
        sentences === 0
          ? 'No summary yet. Two to four sentences help both humans and parsers.'
          : sentences >= 2 && sentences <= 4
            ? `${sentences} sentences — a good length.`
            : `${sentences} sentences. Two to four reads best.`,
    });

    const jobs = r.experience.filter((e) => e.title.trim() || e.company.trim());
    const bullets = [
      ...r.experience.flatMap((e) => e.bullets),
      ...r.volunteer.flatMap((e) => e.bullets),
      ...r.projects.flatMap((e) => e.bullets),
    ]
      .map((b) => b.trim())
      .filter(Boolean);
    out.push({
      label: 'Experience bullets',
      status: bullets.length > 0 ? 'pass' : 'warn',
      detail:
        bullets.length > 0
          ? `${bullets.length} bullet${bullets.length === 1 ? '' : 's'} across experience, projects, and volunteering.`
          : 'No bullets yet. Bullets carry the measurable results parsers and recruiters look for.',
    });

    if (bullets.length > 0) {
      const withVerb = bullets.filter((b) => ACTION_VERBS.has(wordsOf(b)[0] ?? '')).length;
      const pct = Math.round((withVerb / bullets.length) * 100);
      out.push({
        label: 'Strong action verbs',
        status: pct >= 60 ? 'pass' : 'warn',
        detail:
          pct >= 60
            ? `${pct}% of bullets start with a strong verb (Led, Built, Improved…).`
            : `Only ${pct}% of bullets start with a strong verb. Start more with verbs like Led, Built, or Improved.`,
      });
    }

    const undated = jobs.filter((e) => !e.start.trim() && !e.end.trim()).length;
    out.push({
      label: 'Dates on positions',
      status: jobs.length === 0 ? 'warn' : undated === 0 ? 'pass' : 'warn',
      detail:
        jobs.length === 0
          ? 'No positions added yet.'
          : undated === 0
            ? 'Every position has dates, so timelines parse cleanly.'
            : `${undated} position${undated === 1 ? '' : 's'} ha${undated === 1 ? 's' : 've'} no dates.`,
    });

    out.push({
      label: 'Skills section',
      status: r.skills.some((g) => g.items.trim()) ? 'pass' : 'warn',
      detail: r.skills.some((g) => g.items.trim())
        ? 'Skills are listed, which is what keyword matching scans for.'
        : 'No skills listed yet. This is the section keyword matching leans on most.',
    });

    const allText = [
      r.summary,
      ...r.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
      ...r.education.flatMap((e) => [e.degree, e.school, e.detail]),
      ...r.skills.flatMap((g) => [g.label, g.items]),
      ...r.projects.flatMap((e) => [e.name, e.detail, ...e.bullets]),
    ].join(' ');
    const wordCount = wordsOf(allText).length;
    const pages = wordCount / 450;
    out.push({
      label: 'Length',
      status: wordCount === 0 ? 'warn' : pages <= 2 ? 'pass' : 'warn',
      detail:
        wordCount === 0
          ? 'Nothing written yet.'
          : `About ${wordCount} words — roughly ${pages < 1 ? 'under one' : pages.toFixed(1)} page${pages <= 1 ? '' : 's'}. ${
              pages <= 2 ? 'One to two pages is the safe range.' : 'Over two pages risks getting skimmed or cut off.'
            }`,
    });

    out.push({
      label: 'Clean layout',
      status: 'pass',
      detail: 'This template uses plain text and standard headings — no tables, text boxes, or graphics for parsers to choke on.',
    });

    const stop = new Set(
      'the and a to of in for with on as at by from or an is are was were be been have has had it its this that these those you your we our they their he she his her will would can could should may might do does did not no yes if then than so such very more most over under between through during each other into out up down about across after before'.split(' ')
    );
    const freq = new Map<string, number>();
    for (const b of bullets) {
      for (const w of wordsOf(b)) {
        if (w.length > 3 && !stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    out.push({
      label: 'Keyword repetition',
      status: 'info',
      detail:
        top.length === 0
          ? 'Add bullets to see which words repeat most — repetition signals your themes to keyword matching.'
          : `Most repeated words in your bullets: ${top.map(([w, n]) => `${w} (${n}x)`).join(', ')}.`,
    });

    return out;
  }

  function renderAtsResults(): void {
    const box = document.getElementById('rb-ats-results');
    if (!box) return;
    const checks = runAtsChecklist(resume);
    const passes = checks.filter((x) => x.status === 'pass').length;
    const dot = (s: AtsCheck['status']): string =>
      s === 'pass'
        ? '<span style="color:var(--ok);" aria-hidden="true">●</span>'
        : s === 'warn'
          ? '<span style="color:var(--danger);" aria-hidden="true">●</span>'
          : '<span style="color:var(--muted);" aria-hidden="true">●</span>';
    box.innerHTML =
      `<p><strong>${passes} of ${checks.length} checks pass.</strong></p>` +
      `<ul style="list-style:none;padding:0;margin:0.5rem 0;display:grid;gap:0.45rem;">` +
      checks
        .map(
          (x) =>
            `<li>${dot(x.status)} <strong>${escapeHtml(x.label)}</strong> <span style="color:var(--muted);">${escapeHtml(x.detail)}</span></li>`
        )
        .join('') +
      `</ul>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- model updates ----------

  function setValue(sec: string, id: string, field: string, value: string | boolean): void {
    if (sec === 'contact') {
      (resume.contact as unknown as Record<string, string>)[field] = value as string;
      return;
    }
    if (sec === 'summary') {
      resume.summary = value as string;
      return;
    }
    const def = SECTIONS.find((s) => s.key === sec);
    if (!def) return;
    const list = resume[sec as ListKey] as unknown as Record<string, unknown>[];
    const entry = list.find((e) => e.id === id);
    if (!entry) return;
    entry[field] = field === 'bullets' ? (value as string).split('\n') : value;
  }

  editor.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    const input = t.closest('[data-sec]') as HTMLElement | null;
    if (!input) return;
    const sec = input.getAttribute('data-sec')!;
    const id = input.getAttribute('data-id') ?? '';
    const field = input.getAttribute('data-field');
    if (!field) return;
    const value =
      input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : (input as HTMLInputElement | HTMLTextAreaElement).value;
    setValue(sec, id, field, value);
    scheduleSave();
    renderPreview();
  });

  editor.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLElement | null;
    if (!btn || btn.hasAttribute('disabled')) return;
    const act = btn.getAttribute('data-act')!;
    const sec = btn.getAttribute('data-sec') as SectionKey;
    const id = btn.getAttribute('data-id') ?? '';
    if (act === 'sec-up' || act === 'sec-down') {
      if (isSectionKey(sec)) moveSection(sec, act === 'sec-up' ? -1 : 1);
      return;
    }
    if (act === 'ats-check') {
      renderAtsResults();
      return;
    }
    const def = SECTIONS.find((s) => s.key === sec);
    if (!def) return;
    const list = resume[sec] as { id: string }[];
    if (act === 'add') {
      (resume[sec] as unknown[]) = addEntry(list, def.blank() as never);
    } else if (act === 'remove') {
      (resume[sec] as unknown[]) = removeEntry(list, id);
    } else if (act === 'up') {
      (resume[sec] as unknown[]) = moveEntry(list, id, -1);
    } else if (act === 'down') {
      (resume[sec] as unknown[]) = moveEntry(list, id, 1);
    }
    save();
    renderEditor();
    renderPreview();
  });

  // Section visibility toggles ("Show" checkboxes in each section header).
  editor.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest('[data-sec-toggle]') as HTMLInputElement | null;
    if (!box || box.type !== 'checkbox') return;
    const key = box.getAttribute('data-sec-toggle') as SectionKey;
    if (!isSectionKey(key)) return;
    resume.sectionVisibility[key] = box.checked;
    save();
    renderEditor();
    renderPreview();
  });

  // ---------- toolbar ----------

  document.querySelectorAll<HTMLInputElement>('input[name="rb-template"]').forEach((radio) => {
    radio.checked = radio.value === template;
    radio.addEventListener('change', () => {
      if (isTemplateId(radio.value)) {
        template = radio.value;
        save();
        renderPreview();
      }
    });
  });

  el('rb-download').addEventListener('click', () => {
    hideError('rb-error');
    const problems = validateResume(resume);
    if (problems.length > 0) {
      showError('rb-error', 'Before downloading: ' + problems.join(' '));
      el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    // Print only the resume: the print stylesheet hides everything else.
    const name = resume.contact.fullName.trim();
    document.title = name ? `${name} - Resume` : 'Resume';
    document.body.classList.add('resume-print');
    window.print();
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('resume-print');
    document.title = originalTitle;
  });

  /** True when the user has entered anything worth protecting from overwrite. */
  const resumeHasContent = (r: ResumeData): boolean =>
    !!(
      r.contact.fullName ||
      r.contact.email ||
      r.summary ||
      r.experience.length ||
      r.education.length ||
      r.skills.length ||
      r.projects.length
    );

  armConfirmButton(
    el<HTMLButtonElement>('rb-example'),
    () => {
      resume = exampleResume();
      save();
      renderEditor();
      renderPreview();
    },
    'Click again to replace',
    () => resumeHasContent(resume)
  );

  el('rb-export-json').addEventListener('click', () => {
    hideError('rb-error');
    const name = resume.contact.fullName.trim();
    downloadText(name ? `${name} - resume.json` : 'resume-data.json', serialize(resume), 'application/json');
  });

  el('rb-import-json').addEventListener('click', () => {
    hideError('rb-error');
    el<HTMLInputElement>('rb-import-json-file').click();
  });

  el<HTMLInputElement>('rb-import-json-file').addEventListener('change', async () => {
    hideError('rb-error');
    const input = el<HTMLInputElement>('rb-import-json-file');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      showError('rb-error', 'Could not read that file.');
      return;
    }
    const info = deserializeInfo(raw);
    if (info.wiped) {
      showError('rb-error', 'That file does not look like a resume backup from this tool.');
      el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (resumeHasContent(resume)) {
      // Importing over existing work: require an explicit second click.
      const importBtn = el<HTMLButtonElement>('rb-import-json');
      if (importBtn.dataset.armed !== '1') {
        importBtn.dataset.armed = '1';
        importBtn.dataset.origLabel = importBtn.textContent || '';
        importBtn.textContent = 'Click again to replace resume';
        importBtn.classList.add('btn-armed');
        window.setTimeout(() => {
          if (importBtn.dataset.armed === '1') {
            delete importBtn.dataset.armed;
            importBtn.textContent = importBtn.dataset.origLabel || '';
            importBtn.classList.remove('btn-armed');
          }
        }, 8000);
        showError('rb-error', 'This will replace your current resume. Click "Import JSON" again to confirm.');
        el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      delete importBtn.dataset.armed;
      importBtn.textContent = importBtn.dataset.origLabel || '';
      importBtn.classList.remove('btn-armed');
    }
    hideError('rb-error');
    resume = info.resume;
    save();
    renderEditor();
    renderPreview();
  });

  // Filled by the import panel (src/tools/resume-import-ui.ts): replace the
  // whole resume with the parsed data, then re-render editor and preview.
  // This is always a full replace: example data, a previous import, or manual
  // edits are all discarded (after confirm). No need to Clear first.
  window.addEventListener('freekit:resume-import', (e) => {
    const data = (e as CustomEvent).detail as ResumeData | null;
    if (!data || typeof data !== 'object' || !data.contact) return;
    // The import panel already asks for confirmation before dispatching;
    // this is a full replace by design (see comment above).
    try {
      resume = data;
      save();
      renderEditor();
      renderPreview();
    } catch (err) {
      showError('rb-error', 'The details were read but the editor could not display them. Try reloading the page.');
      el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  armConfirmButton(
    el<HTMLButtonElement>('rb-clear'),
    () => {
      resume = blankResume();
      save();
      renderEditor();
      renderPreview();
    },
    'Click again to clear',
    () => resumeHasContent(resume)
  );

  // ---------- mobile tabs ----------

  const tabEdit = el<HTMLButtonElement>('rb-tab-edit');
  const tabPreview = el<HTMLButtonElement>('rb-tab-preview');
  function showPreview(show: boolean): void {
    workspace.classList.toggle('show-preview', show);
    tabEdit.classList.toggle('tab-active', !show);
    tabPreview.classList.toggle('tab-active', show);
    tabEdit.setAttribute('aria-selected', String(!show));
    tabPreview.setAttribute('aria-selected', String(show));
    if (show) renderPreview();
  }
  tabEdit.addEventListener('click', () => showPreview(false));
  tabPreview.addEventListener('click', () => showPreview(true));

  // ---------- init ----------

  renderEditor();
  renderPreview();

  if (loaded.backupRaw) showBackupBanner(loaded.backupRaw);

  // Template picker is static markup; keep it in sync with the canonical list.
  const known = new Set(TEMPLATES.map((t) => t.id));
  document.querySelectorAll<HTMLInputElement>('input[name="rb-template"]').forEach((radio) => {
    if (!known.has(radio.value as TemplateId)) radio.closest('label')?.setAttribute('hidden', '');
  });
}
