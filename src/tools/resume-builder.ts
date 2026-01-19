// Resume builder: DOM glue. Pure model logic lives in ../lib/resume-core.ts
import type { ResumeData, TemplateId } from '../lib/resume-core.ts';
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
  addEntry,
  removeEntry,
  moveEntry,
  validateResume,
  isTemplateId,
  RESUME_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  serialize,
  deserialize,
  renderResume,
} from '../lib/resume-core.ts';
import { el, showError, hideError, ICONS } from './common.ts';

type ListKey = 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'languages';

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

const SECTIONS: SectionDef[] = [
  {
    key: 'experience',
    title: 'Work experience',
    hint: 'Most recent first. One line per bullet; start bullets with strong verbs.',
    singular: 'position',
    blank: blankWorkEntry,
    titleOf: (e) => `${e.title || 'Untitled position'}${e.company ? ` · ${e.company}` : ''}`,
    fields: [
      { field: 'title', label: 'Job title', kind: 'text', placeholder: 'Senior Product Designer' },
      { field: 'company', label: 'Company', kind: 'text', placeholder: 'Northwind Mobile' },
      { field: 'location', label: 'Location', kind: 'text', placeholder: 'San Francisco, CA' },
      { field: 'start', label: 'Start', kind: 'text', placeholder: 'Mar 2021' },
      { field: 'end', label: 'End', kind: 'text', placeholder: 'Feb 2024' },
      { field: 'current', label: 'I currently work here', kind: 'checkbox' },
      { field: 'bullets', label: 'Bullets (one per line)', kind: 'textarea', span: true, placeholder: 'Led redesign of onboarding; activation rose from 31% to 47%.' },
    ],
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
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initResumeBuilder(): void {
  let resume: ResumeData = loadResume();
  let template: TemplateId = loadTemplate();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const editor = el('rb-editor');
  const preview = el('rb-preview');
  const workspace = el('rb-workspace');
  const originalTitle = document.title;

  function loadResume(): ResumeData {
    try {
      return deserialize(localStorage.getItem(RESUME_STORAGE_KEY));
    } catch {
      return blankResume(); // storage blocked or unavailable
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

  // ---------- preview ----------

  function renderPreview(): void {
    preview.className = `resume-doc resume-${template}`;
    preview.innerHTML = renderResume(resume, template);
  }

  // ---------- editor ----------

  function fieldHtml(sec: SectionDef, id: string, f: FieldDef, value: unknown): string {
    const val = typeof value === 'string' ? value : '';
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

  function renderEditor(): void {
    const contact = `<section class="rb-section" aria-label="Contact details">
      <div class="rb-section-head"><h3>Contact</h3></div>
      ${contactHtml()}
    </section>`;
    const summary = `<section class="rb-section" aria-label="Professional summary">
      <div class="rb-section-head"><h3>Summary</h3></div>
      <label class="rb-field"><span>Professional summary (2-4 sentences)</span><textarea data-sec="summary" rows="4" placeholder="Product designer with 8 years of experience shipping consumer mobile apps.">${escapeHtml(resume.summary)}</textarea></label>
    </section>`;
    const lists = SECTIONS.map((sec) => {
      const entries = (resume[sec.key] as ({ id: string } & Record<string, unknown>)[]);
      return `<section class="rb-section" aria-label="${sec.title}">
        <div class="rb-section-head"><h3>${sec.title}</h3><button type="button" class="btn btn-secondary btn-small" data-act="add" data-sec="${sec.key}">Add ${sec.singular}</button></div>
        <p class="rb-hint">${sec.hint}</p>
        ${entries.map((e, i) => entryHtml(sec, e, i, entries.length)).join('')}
      </section>`;
    }).join('');
    editor.innerHTML = contact + summary + lists;
  }

  // ---------- model updates ----------

  function setValue(sec: string, id: string, field: string, value: string | boolean): void {
    if (sec === 'contact') {
      (resume.contact as Record<string, string>)[field] = value as string;
      return;
    }
    if (sec === 'summary') {
      resume.summary = value as string;
      return;
    }
    const def = SECTIONS.find((s) => s.key === sec);
    if (!def) return;
    const list = resume[sec as ListKey] as Record<string, unknown>[];
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
    const sec = btn.getAttribute('data-sec') as ListKey;
    const id = btn.getAttribute('data-id') ?? '';
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

  el('rb-example').addEventListener('click', () => {
    if (!window.confirm('Replace your current resume with the example content?')) return;
    resume = exampleResume();
    save();
    renderEditor();
    renderPreview();
  });

  // Filled by the import panel (src/tools/resume-import-ui.ts): replace the
  // whole resume with the parsed data, then re-render editor and preview.
  window.addEventListener('freekit:resume-import', (e) => {
    const data = (e as CustomEvent).detail as ResumeData | null;
    if (!data || typeof data !== 'object' || !data.contact) return;
    resume = data;
    save();
    renderEditor();
    renderPreview();
  });

  el('rb-clear').addEventListener('click', () => {
    if (!window.confirm('Clear everything and start over? This cannot be undone.')) return;
    resume = blankResume();
    save();
    renderEditor();
    renderPreview();
  });

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

  // Template picker is static markup; keep it in sync with the canonical list.
  const known = new Set(TEMPLATES.map((t) => t.id));
  document.querySelectorAll<HTMLInputElement>('input[name="rb-template"]').forEach((radio) => {
    if (!known.has(radio.value as TemplateId)) radio.closest('label')?.setAttribute('hidden', '');
  });
}
