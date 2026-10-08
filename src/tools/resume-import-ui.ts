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
  getAiKey,
  setAiKey,
  setAiEnabled,
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
    ['Certifications', (r) => (r.certifications.length > 0 ? `${r.certifications.length} certification${r.certifications.length === 1 ? '' : 's'}` : '')],
    ['Languages', (r) => (r.languages.length > 0 ? `${r.languages.length} language${r.languages.length === 1 ? '' : 's'}` : '')],
    ['Awards', (r) => (r.awards.length > 0 ? `${r.awards.length} award${r.awards.length === 1 ? '' : 's'}` : '')],
    ['Publications', (r) => (r.publications.length > 0 ? `${r.publications.length} publication${r.publications.length === 1 ? '' : 's'}` : '')],
    ['Volunteer', (r) => (r.volunteer.length > 0 ? `${r.volunteer.length} role${r.volunteer.length === 1 ? '' : 's'}` : '')],
    ['Courses', (r) => (r.courses.length > 0 ? `${r.courses.length} course${r.courses.length === 1 ? '' : 's'}` : '')],
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

  // Reading mode: on-device AI (default), the user's own Gemini key, or the
  // standard reader. The key field only matters for the Gemini option.
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="rb-parse-mode"]');
  const keyField = document.getElementById('rb-gemini-key-field');
  const aiKey = document.getElementById('rb-ai-key') as HTMLInputElement | null;
  const syncModeUi = (mode: ParseMode): void => {
    modeRadios.forEach((r) => {
      r.checked = r.value === mode;
    });
    if (keyField) keyField.hidden = mode !== 'gemini';
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
  if (aiKey) {
    aiKey.value = getAiKey();
    aiKey.addEventListener('change', () => {
      setAiKey(aiKey.value.trim());
      // A key without the Gemini mode selected does nothing.
      if (aiKey.value.trim()) {
        setAiEnabled(true);
        setParseMode('gemini');
        syncModeUi('gemini');
      }
    });
  }

  el('rb-import-use').addEventListener('click', () => {
    if (!imported) return;
    window.dispatchEvent(new CustomEvent('freekit:resume-import', { detail: imported }));
    review.hidden = true;
    el('rb-import-panel').hidden = true;
    el('rb-import-again')?.removeAttribute('hidden');
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
