// Resume import: DOM glue. Pure logic lives in ../lib/resume-import.ts.
// Dispatches a window CustomEvent('freekit:resume-import') with the parsed
// ResumeData; the builder listens for it and fills the editor.
import { el, showError, hideError, setupDropzone } from './common.ts';
import { renderPdfThumb } from './pdf-render.ts';
import {
  extractTextFromPdf,
  extractTextFromDocx,
  parseResumeText,
  parsedToResumeData,
} from '../lib/resume-import.ts';
import type { ParsedResume } from '../lib/resume-import.ts';
import type { ResumeData } from '../lib/resume-core.ts';

const MAX_BYTES = 8 * 1024 * 1024;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
}

export function initResumeImport(): void {
  const status = el('rb-import-status');
  const review = el('rb-import-review');
  const fields = el('rb-import-fields');
  const drop = el('rb-import-drop');
  let imported: ResumeData | null = null;
  let working = false;

  const ROWS: [string, (r: ParsedResume) => string][] = [
    ['Name', (r) => r.fullName],
    ['Headline', (r) => r.title],
    ['Email', (r) => r.email],
    ['Phone', (r) => r.phone],
    ['Location', (r) => r.location],
    ['Website', (r) => r.website],
    ['LinkedIn', (r) => r.linkedin],
    ['Summary', (r) => trunc(r.summary, 160)],
    ['Experience', (r) => (r.experience.length > 0 ? `${r.experience.length} position${r.experience.length === 1 ? '' : 's'}` : '')],
    ['Education', (r) => (r.education.length > 0 ? `${r.education.length} entr${r.education.length === 1 ? 'y' : 'ies'}` : '')],
    ['Skills', (r) => {
      const n = r.skills.reduce((acc, g) => acc + g.items.length, 0);
      return n > 0 ? `${n} skills` : '';
    }],
    ['Projects', (r) => (r.projects.length > 0 ? `${r.projects.length} project${r.projects.length === 1 ? '' : 's'}` : '')],
  ];

  function renderReview(parsed: ParsedResume): void {
    fields.innerHTML = ROWS.map(
      ([label, get]) => {
        const value = get(parsed).trim();
        const shown = value
          ? `<dd>${esc(value)}</dd>`
          : `<dd><span style="color:var(--muted)">Not found</span></dd>`;
        return `<div><dt>${esc(label)}</dt>${shown}</div>`;
      }
    ).join('');
  }

  function showStatus(msg: string): void {
    status.hidden = false;
    status.textContent = msg;
  }

  function fail(msg: string): void {
    showError('rb-error', msg);
    el('rb-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    drop.setAttribute('aria-disabled', 'true');
    showStatus('Reading your file…');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const asFile = new File([buf.buffer as ArrayBuffer], file.name, { type: file.type });
      const text = isPdf ? await extractTextFromPdf(asFile) : await extractTextFromDocx(asFile);
      if (!text.trim()) {
        fail('No readable text in that file. Scanned images do not work here; use a file with selectable text.');
        return;
      }
      const parsed = parseResumeText(text);
      imported = parsedToResumeData(parsed);
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

  el('rb-import-use').addEventListener('click', () => {
    if (!imported) return;
    window.dispatchEvent(new CustomEvent('freekit:resume-import', { detail: imported }));
    review.hidden = true;
    el('rb-import-panel').hidden = true;
    el('rb-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  el('rb-import-discard').addEventListener('click', () => {
    imported = null;
    review.hidden = true;
    status.hidden = true;
    el<HTMLImageElement>('rb-import-preview').hidden = true;
  });

  el('rb-start-blank').addEventListener('click', () => {
    el('rb-import-panel').hidden = true;
    el('rb-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
