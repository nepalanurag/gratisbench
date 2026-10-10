// Resume import: DOM glue. Pure logic lives in ../lib/resume-import.ts.
// Dispatches a window CustomEvent('freekit:resume-import') with the parsed
// ResumeData; the builder listens for it and fills the editor.
import { el, showError, hideError, setupDropzone } from './common.ts';
import { renderPdfThumb } from './pdf-render.ts';
import { ocrPdfPages } from './resume-pdf-ocr.ts';
import { tesseractLoadErrorMessage } from './tesseract-loader.ts';
import {
  extractTextFromPdf,
  extractTextFromDocx,
  parseResumeText,
  parsedToResumeData,
} from '../lib/resume-import.ts';
import type { ParsedResume } from '../lib/resume-import.ts';
import type { ResumeData } from '../lib/resume-core.ts';
import {
  getParseMode,
  setParseMode,
  smartParseResume,
  hasParsedContent,
} from '../lib/resume-ai-parse.ts';
import type { ParseMode } from '../lib/resume-ai-parse.ts';

const MAX_BYTES = 8 * 1024 * 1024;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initResumeImport(): void {
  const status = el('rb-import-status');
  const review = el('rb-import-review');
  const fields = el('rb-import-fields');
  const drop = el('rb-import-drop');
  let parsedDraft: ParsedResume | null = null;
  let working = false;

  const ROOT_FIELDS: [keyof ParsedResume, string][] = [
    ['fullName', 'Name'],
    ['title', 'Headline'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['location', 'Location'],
    ['website', 'Website'],
    ['linkedin', 'LinkedIn'],
    ['summary', 'Summary'],
  ];

  function renderReview(parsed: ParsedResume): void {
    const renderField = (label: string, path: (string | number)[], value: unknown): string => {
      const pathAttr = `data-review-path="${esc(JSON.stringify(path))}"`;
      const labelHtml = `<span>${esc(label)}</span>`;
      if (typeof value === 'boolean') {
        return `<label class="rb-review-field rb-review-check">${labelHtml}<input type="checkbox" ${pathAttr} ${value ? 'checked' : ''} /></label>`;
      }
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return `<label class="rb-review-field">${labelHtml}<textarea rows="3" data-review-array="true" ${pathAttr}>${esc(value.join('\n'))}</textarea></label>`;
      }
      if (typeof value === 'string') {
        const control = label === 'Summary' || label === 'Detail' || label === 'Bullets' || label === 'Description'
          ? `<textarea rows="3" ${pathAttr}>${esc(value)}</textarea>`
          : `<input type="text" ${pathAttr} value="${esc(value)}" />`;
        return `<label class="rb-review-field">${labelHtml}${control}</label>`;
      }
      return '';
    };

    const root = ROOT_FIELDS.map(([key, label]) =>
      renderField(label, [key], parsed[key])
    ).join('');
    const sections = [
      ['experience', 'Experience', parsed.experience],
      ['education', 'Education', parsed.education],
      ['skills', 'Skills', parsed.skills],
      ['projects', 'Projects', parsed.projects],
      ['certifications', 'Certifications', parsed.certifications],
      ['languages', 'Languages', parsed.languages],
      ['awards', 'Awards', parsed.awards],
      ['publications', 'Publications', parsed.publications],
      ['volunteer', 'Volunteer', parsed.volunteer],
      ['courses', 'Courses', parsed.courses],
    ] as const;
    const sectionHtml = sections
      .map(([key, title, entries]) => {
        if (entries.length === 0) return '';
        const entryHtml = entries
          .map((entry, index) => {
            const controls = Object.entries(entry)
              .map(([field, value]) => {
                const label = field === 'current' ? 'Currently in this role' : field.replace(/[A-Z]/g, (c) => ` ${c}`).replace(/^./, (c) => c.toUpperCase());
                return renderField(label, [key, index, field], value);
              })
              .join('');
            return `<fieldset class="rb-review-entry"><legend>${esc(title)} ${index + 1}</legend><div class="rb-review-grid">${controls}</div></fieldset>`;
          })
          .join('');
        return `<section class="rb-review-section"><h4>${esc(title)}</h4>${entryHtml}</section>`;
      })
      .join('');
    fields.innerHTML = `<section class="rb-review-section"><h4>Contact and summary</h4><div class="rb-review-grid">${root}</div></section>${sectionHtml}`;
  }

  function updateParsedValue(root: ParsedResume, path: (string | number)[], value: string | string[] | boolean): void {
    let current: unknown = root;
    for (const part of path.slice(0, -1)) {
      if (Array.isArray(current) && typeof part === 'number') current = current[part];
      else if (current && typeof current === 'object' && typeof part === 'string') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return;
      }
    }
    const last = path[path.length - 1];
    if (Array.isArray(current) && typeof last === 'number') current[last] = value;
    else if (current && typeof current === 'object' && typeof last === 'string') {
      (current as Record<string, unknown>)[last] = value;
    }
  }

  function showStatus(msg: string, busy = false): void {
    status.hidden = false;
    status.textContent = '';
    if (busy) {
      const spin = document.createElement('span');
      spin.className = 'spinner';
      spin.setAttribute('aria-hidden', 'true');
      status.append(spin, ' ');
    }
    status.append(msg);
  }

  function fail(msg: string): void {
    showError('rb-error', msg);
    el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Smart parsing when the user picked it, else the heuristic parser. */
  async function parseWithAiOrHeuristic(text: string): Promise<ParsedResume> {
    const mode = getParseMode();
    if (mode !== 'heuristic') {
      showStatus(mode === 'local' ? 'Reading your resume on this device…' : 'Reading your resume with AI…', true);
      const smart = await smartParseResume(text, (fraction, label) => {
        showStatus(`${label} — ${Math.round(fraction * 100)}%`, true);
      });
      if (smart && hasParsedContent(smart)) {
        return smart;
      }
      showStatus('Smarter reading did not work. Using standard reading instead…');
    }
    return parseResumeText(text);
  }

  async function handleFile(file: File | undefined): Promise<void> {
    hideError('rb-error');
    if (!file || working) return;
    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
    const isDocx =
      lower.endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isPdf && !isDocx) {
      fail('That file is not a PDF or Word document.');
      return;
    }
    if (file.size > MAX_BYTES) {
      fail('That file is over 8 MB. Keep it under 8 MB.');
      return;
    }
    working = true;
    parsedDraft = null;
    review.hidden = true;
    drop.setAttribute('aria-disabled', 'true');
    showStatus('Reading your file…', true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const asFile = new File([buf.buffer as ArrayBuffer], file.name, { type: file.type });
      let text = isPdf ? await extractTextFromPdf(asFile) : await extractTextFromDocx(asFile);
      if (!text.trim() && isPdf) {
        // A scan or photo of a resume: read the pages with on-device OCR.
        showStatus('No selectable text found. Reading the scanned pages on this device…', true);
        try {
          text = await ocrPdfPages(buf, (label) => showStatus(label));
        } catch (err) {
          fail(tesseractLoadErrorMessage(err));
          return;
        }
      }
      if (!text.trim()) {
        fail(
          isPdf
            ? 'Could not read any text in that file, even as a scan. If it is a photo of a resume, try a sharper, higher-contrast scan.'
            : 'No readable text in that Word file.'
        );
        return;
      }
      const parsed = await parseWithAiOrHeuristic(text);
      // If nothing recognizable was found, say so plainly instead of showing
      // an empty review that would wipe the resume on "Use these details".
      const foundCount =
        (parsed.fullName ? 1 : 0) +
        parsed.experience.length +
        parsed.education.length +
        parsed.skills.length +
        parsed.projects.length;
      if (foundCount === 0) {
        fail(
          'Could not find resume details in that file. If it is a scan or photo, try a sharper, higher-contrast image. You can also start from a blank resume below.'
        );
        return;
      }
      parsedDraft = parsed;
      renderReview(parsed);
      const preview = el<HTMLImageElement>('rb-import-preview');
      if (isPdf) {
        const thumb = await renderPdfThumb(buf);
        if (thumb) {
          preview.src = thumb;
          preview.hidden = false;
        } else {
          preview.hidden = true;
        }
      } else {
        preview.hidden = true;
      }
      review.hidden = false;
      review.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showStatus(`Read ${file.name}. Check the details below, then use them or discard and start blank.`);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      working = false;
      drop.removeAttribute('aria-disabled');
    }
  }

  setupDropzone('rb-import-drop', 'rb-import-file', (files) => {
    void handleFile(files[0]);
  });

  // The standard reader is the default; the larger on-device model is opt-in.
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="rb-parse-mode"]');
  const syncModeUi = (mode: ParseMode): void => {
    modeRadios.forEach((r) => {
      r.checked = r.value === mode;
    });
  };
  if (modeRadios.length > 0) {
    syncModeUi(getParseMode());
    modeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          setParseMode(r.value as ParseMode);
          syncModeUi(r.value as ParseMode);
        }
      });
    });
  }

  fields.addEventListener('input', (e) => {
    const control = (e.target as HTMLElement).closest('[data-review-path]') as HTMLInputElement | HTMLTextAreaElement | null;
    if (!control || !parsedDraft) return;
    const path = JSON.parse(control.dataset.reviewPath ?? '[]') as (string | number)[];
    const value =
      control instanceof HTMLInputElement && control.type === 'checkbox'
        ? control.checked
        : control.dataset.reviewArray === 'true'
          ? control.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
          : control.value;
    updateParsedValue(parsedDraft, path, value);
  });

  el('rb-import-use').addEventListener('click', () => {
    if (!parsedDraft) return;
    const imported: ResumeData = parsedToResumeData(parsedDraft);
    window.dispatchEvent(new CustomEvent('freekit:resume-import', { detail: imported }));
    parsedDraft = null;
    review.hidden = true;
    el('rb-import-panel').hidden = true;
    el('rb-import-again')?.removeAttribute('hidden');
    el('rb-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  el('rb-import-discard').addEventListener('click', () => {
    parsedDraft = null;
    review.hidden = true;
    status.hidden = true;
    el<HTMLImageElement>('rb-import-preview').hidden = true;
  });

  el('rb-start-blank').addEventListener('click', () => {
    el('rb-import-panel').hidden = true;
    el('rb-import-again')?.removeAttribute('hidden');
    el('rb-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Reopen the import panel after it was dismissed (the dropzone used to be
  // gone until reload).
  el('rb-import-again')?.addEventListener('click', () => {
    el('rb-import-panel').hidden = false;
    review.hidden = true;
    status.hidden = true;
    el('rb-import-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
