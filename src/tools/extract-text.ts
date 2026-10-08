// Extract Text tool: DOM glue. pdf.js reads each page's text content; the
// tool joins it into plain text for copying or downloading as .txt.
// Two output styles: "simple" (one clean flow) and "layout" (rebuilt from
// each fragment's on-page position, so columns and spacing survive).
import { loadPdfjs, pdfJsLoadErrorMessage } from './pdf-render.ts';
import { basePath } from '../lib/site.ts';
import {
  el,
  formatBytes,
  downloadText,
  copyText,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
  pdfLoadErrorMessage,
} from './common.ts';

type TextMode = 'simple' | 'layout';

interface PlacedItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let pagesSimple: string[] = [];
let pagesLayout: string[] = [];
let textMode: TextMode = 'simple';
let pageMarkers = false;
let fileStem = 'document';

function setProgress(done: number, total: number): void {
  el('progress-wrap').hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = `Reading page ${done} of ${total}…`;
}

/**
 * Rebuild a page's text from the fragments' on-page positions: group
 * fragments into lines by their vertical position, order left to right, and
 * turn horizontal gaps into spaces so columns stay apart.
 */
function layoutPageText(items: PlacedItem[]): string {
  const kept = items.filter((it) => it.str.length > 0);
  if (kept.length === 0) return '';
  // Top of the page first, then left to right.
  kept.sort((a, b) => b.y - a.y || a.x - b.x);
  const totalW = kept.reduce((s, it) => s + it.w, 0);
  const totalChars = kept.reduce((s, it) => s + it.str.length, 0);
  const avgChar = totalChars > 0 ? totalW / totalChars : 6;
  const lines: PlacedItem[][] = [];
  for (const it of kept) {
    const line = lines.find(
      (l) => Math.abs(l[0].y - it.y) < Math.max(it.h, l[0].h) * 0.6
    );
    if (line) line.push(it);
    else lines.push([it]);
  }
  const out: string[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let s = '';
    let cursor = Number.NEGATIVE_INFINITY;
    for (const it of line) {
      if (cursor > Number.NEGATIVE_INFINITY) {
        const gap = it.x - cursor;
        if (gap > 0) {
          const n = Math.round(gap / avgChar);
          s += ' '.repeat(Math.min(Math.max(n, 1), 12));
        }
      }
      s += it.str;
      cursor = it.x + it.w;
    }
    out.push(s.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

/** The classic mode: fragments joined in reading order, one flow of text. */
function simplePageText(items: PlacedItem[], eol: boolean[]): string {
  const parts: string[] = [];
  let line = '';
  for (let k = 0; k < items.length; k++) {
    line += items[k].str;
    if (eol[k]) {
      parts.push(line);
      line = '';
    } else {
      line += ' ';
    }
  }
  if (line.trim()) parts.push(line);
  return parts.join('\n').replace(/[ \t]+\n/g, '\n');
}

function renderOutput(): void {
  const pages = textMode === 'layout' ? pagesLayout : pagesSimple;
  const n = pages.length;
  const joined = pages
    .map((p, i) => (pageMarkers && i > 0 ? `--- Page ${i + 1} of ${n} ---\n` : '') + p)
    .join('\n\n');
  const ta = el<HTMLTextAreaElement>('text-output');
  ta.value = joined.replace(/\n{3,}/g, '\n\n').trim();
}

export function initExtractText(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('text-options').hidden = true;
    const ta = el<HTMLTextAreaElement>('text-output');
    ta.value = '';
    ta.hidden = true;
    el('text-empty').hidden = false;
    el<HTMLButtonElement>('copy-btn').disabled = true;
    el<HTMLButtonElement>('txt-btn').disabled = true;
    pagesSimple = [];
    pagesLayout = [];
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showError('error-box', `"${f.name}" is not a PDF.`);
      return;
    }
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
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        setProgress(i, doc.numPages);
        await new Promise((r) => setTimeout(r, 0));
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const items: PlacedItem[] = [];
        const eol: boolean[] = [];
        for (const raw of content.items) {
          if (!('str' in raw)) continue;
          const it = raw as {
            str: string;
            hasEOL: boolean;
            transform: number[];
            width: number;
            height: number;
          };
          items.push({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            w: it.width,
            h: it.height,
          });
          eol.push(it.hasEOL);
        }
        pagesSimple.push(simplePageText(items, eol));
        pagesLayout.push(layoutPageText(items));
        page.cleanup();
      }
      el('progress-wrap').hidden = true;
      const totalChars = pagesSimple.join('').replace(/\s/g, '').length;
      el('text-empty').hidden = true;
      if (totalChars === 0) {
        el('text-empty').hidden = false;
        el('text-empty').innerHTML =
          `No text found in this PDF. It may be scanned pages (images with no text). The <a href="${basePath('/ocr-pdf')}">OCR PDF</a> tool can add a text layer to scans like this.`;
        return;
      }
      renderOutput();
      el('text-output').hidden = false;
      el('text-options').hidden = false;
      el('count-label').textContent = `${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · ${el<HTMLTextAreaElement>('text-output').value.length.toLocaleString()} characters · ${formatBytes(f.size)}`;
      el<HTMLButtonElement>('copy-btn').disabled = false;
      el<HTMLButtonElement>('txt-btn').disabled = false;
      el('result').hidden = false;
    } catch (err) {
      el('progress-wrap').hidden = true;
      showError('error-box', pdfJsLoadErrorMessage(err) || pdfLoadErrorMessage(err));
    }
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="text-mode"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        textMode = radio.value as TextMode;
        renderOutput();
      }
    });
  }

  el<HTMLInputElement>('page-markers').addEventListener('change', (e) => {
    pageMarkers = (e.target as HTMLInputElement).checked;
    renderOutput();
  });

  el('copy-btn').addEventListener('click', async () => {
    const btn = el<HTMLButtonElement>('copy-btn');
    const ok = await copyText(el<HTMLTextAreaElement>('text-output').value);
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 1500);
  });

  el('txt-btn').addEventListener('click', () => {
    downloadText(`${fileStem}.txt`, el<HTMLTextAreaElement>('text-output').value, 'text/plain');
  });
}
