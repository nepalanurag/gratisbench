// Repair PDF tool: DOM glue. Repair runs in three stages, plain to
// increasingly heroic: (1) rebuild the file's structure with pdf-lib,
// (2) a deeper read that skips damaged objects, (3) a last resort that
// re-renders readable pages as pictures into a fresh PDF. The first page of
// whatever comes out is shown as a preview so the user can see it worked.
import { PDFDocument } from 'pdf-lib';
import { repairPdf, repairedFileName, getPageCount, imagesToPdf } from '../lib/pdf-core.ts';
import { loadPdfjs, renderPageToCanvas, canvasToBytes } from './pdf-render.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

let sourceBytes: Uint8Array | null = null;
let fileStem = 'document';

type Diagnosis = 'empty' | 'not-pdf' | 'truncated' | 'damaged' | 'healthy';

/**
 * Inspect the file before attempting repair. A file that parses cleanly is
 * reported as healthy rather than "damaged": the sniff alone cannot tell a
 * healthy PDF from a structurally damaged one.
 */
async function diagnose(bytes: Uint8Array): Promise<Diagnosis> {
  if (bytes.length === 0) return 'empty';
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (head !== '%PDF-') return 'not-pdf';
  const tailStart = Math.max(0, bytes.length - 2048);
  const tail = new TextDecoder().decode(bytes.slice(tailStart));
  if (!tail.includes('%%EOF')) return 'truncated';
  try {
    await PDFDocument.load(bytes.slice(), { ignoreEncryption: false });
    return 'healthy';
  } catch {
    return 'damaged';
  }
}

const DIAGNOSIS_COPY: Record<Diagnosis, string> = {
  empty:
    'This file is empty (0 bytes). There is nothing in it to repair — check where it came from and get a fresh copy.',
  'not-pdf':
    'This does not look like a PDF at all: it is missing the PDF header. It may be a different file wearing a .pdf name. You can still try a repair, but the odds are long.',
  truncated:
    'The end of the file is missing — it looks cut off, as if the download did not finish. Repair can sometimes recover the intact pages.',
  damaged:
    'The file starts like a PDF but its internal structure is damaged. Repair will try to rebuild it from whatever survived.',
  healthy:
    'This file opened without errors, so it may not need repair at all. You can still run it to get a clean rebuilt copy.',
};

/** Append a line to the visible repair log; returns the line to update later. */
function logLine(text: string): HTMLElement {
  const log = el('repair-log');
  log.hidden = false;
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'log-dot log-working';
  dot.setAttribute('aria-hidden', 'true');
  li.append(dot, document.createTextNode(text));
  log.appendChild(li);
  return li;
}

function markLine(li: HTMLElement, ok: boolean): void {
  const dot = li.querySelector('.log-dot');
  if (dot) {
    dot.classList.remove('log-working');
    dot.classList.add(ok ? 'log-ok' : 'log-fail');
  }
}

/**
 * Last resort: render every readable page to a picture and pack the pictures
 * into a fresh PDF. Text is no longer selectable, but the pages can be read.
 */
async function rebuildAsImages(buffer: Uint8Array, progress: (done: number, total: number) => void): Promise<Uint8Array> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: buffer.slice() }).promise;
  const total = Math.min(doc.numPages, 100);
  const pages: { data: Uint8Array; mime: string }[] = [];
  for (let i = 1; i <= total; i++) {
    progress(i, total);
    const page = await doc.getPage(i);
    const canvas = await renderPageToCanvas(page, 150);
    page.cleanup();
    pages.push({ data: await canvasToBytes(canvas, 'image/jpeg', 0.85), mime: 'image/jpeg' });
  }
  return imagesToPdf(pages, 'fit');
}

/** Show the first page of the repaired file as proof it opens. */
async function showPreview(out: Uint8Array): Promise<void> {
  const wrap = el('repair-preview-wrap');
  const holder = el('repair-preview');
  holder.innerHTML = '';
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: out.slice() }).promise;
    const page = await doc.getPage(1);
    const canvas = await renderPageToCanvas(page, 72);
    page.cleanup();
    canvas.className = 'pdf-preview-canvas';
    holder.appendChild(canvas);
    wrap.hidden = false;
  } catch {
    wrap.hidden = true;
  }
}

export function initRepairPdf(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('repair-wrap').hidden = true;
    el('repair-log').hidden = true;
    el('repair-log').innerHTML = '';
    el('repair-preview-wrap').hidden = true;
    el('diagnosis').hidden = true;
    sourceBytes = null;
    const f = files[0];
    if (!f) return;
    const sizeNote = el('size-note');
    sizeNote.hidden = true;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
    fileStem = f.name.replace(/\.[^.]+$/, '') || 'document';
    sourceBytes = new Uint8Array(await f.arrayBuffer());
    const kind = await diagnose(sourceBytes);
    const diag = el('diagnosis');
    diag.textContent = DIAGNOSIS_COPY[kind];
    diag.hidden = false;
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el<HTMLButtonElement>('repair-btn').disabled = kind === 'empty';
    el('repair-wrap').hidden = false;
  });

  el('repair-btn').addEventListener('click', async () => {
    if (!sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    el('repair-preview-wrap').hidden = true;
    const log = el('repair-log');
    log.innerHTML = '';
    log.hidden = false;
    const btn = el<HTMLButtonElement>('repair-btn');
    setBusy('repair-btn', true, 'Repairing…');

    let out: Uint8Array | null = null;
    let method = '';

    // Stage 1: quick structural rebuild.
    let line = logLine('Quick fix: rebuilding the file\u2019s structure…');
    try {
      out = await repairPdf(sourceBytes.slice());
      markLine(line, true);
      method = 'quick rebuild';
    } catch {
      markLine(line, false);
    }

    // Stage 2: deeper read that skips damaged objects.
    if (!out) {
      line = logLine('Deeper fix: reading past the damaged parts…');
      try {
        const doc = await PDFDocument.load(sourceBytes.slice(), {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
        });
        out = await doc.save();
        markLine(line, true);
        method = 'deep read';
      } catch {
        markLine(line, false);
      }
    }

    // Stage 3: last resort — pages as pictures.
    if (!out) {
      line = logLine('Last resort: turning the readable pages into pictures…');
      try {
        out = await rebuildAsImages(sourceBytes.slice(), (done, total) => {
          line.lastChild!.textContent =
            `Last resort: turning the readable pages into pictures… (page ${done} of ${total})`;
        });
        markLine(line, true);
        method = 'page rebuild';
      } catch {
        markLine(line, false);
      }
    }

    try {
      if (!out) {
        showError(
          'error-box',
          'None of the repair attempts worked. The file is likely beyond repair — its content may be destroyed rather than just scrambled.'
        );
        return;
      }
      let pages = 0;
      try {
        pages = await getPageCount(out);
      } catch {
        pages = 0;
      }
      const outName = repairedFileName(fileStem);
      el('result-info').textContent =
        `${formatBytes(out.length)} · ` +
        (pages > 0 ? `${pages} page${pages === 1 ? '' : 's'} recovered` : 'recovered') +
        ` (${method}). ` +
        (method === 'page rebuild'
          ? 'The pages are pictures now, so text cannot be selected, but they can be read. '
          : '') +
        'Open it and check that the content looks right before relying on it.';
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out as Uint8Array, 'application/pdf');
      await showPreview(out);
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      setBusy('repair-btn', false);
      btn.disabled = false;
    }
  });
}
