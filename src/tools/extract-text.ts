// v2: rebuilt to fix stale bundle
// Extract Text tool: DOM glue. pdf.js reads each page's text content; the
// tool joins it into plain text for copying or downloading as .txt.
import { loadPdfjs, pdfJsLoadErrorMessage } from './pdf-render.ts';
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

let extracted = '';
let fileStem = 'document';

function setProgress(done: number, total: number): void {
  el('progress-wrap').hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = `Reading page ${done} of ${total}…`;
}

export function initExtractText(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    const ta = el<HTMLTextAreaElement>('text-output');
    ta.value = '';
    ta.hidden = true;
    el('text-empty').hidden = false;
    el<HTMLButtonElement>('copy-btn').disabled = true;
    el<HTMLButtonElement>('txt-btn').disabled = true;
    extracted = '';
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
      const parts: string[] = [];
      let totalChars = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        setProgress(i, doc.numPages);
        await new Promise((r) => setTimeout(r, 0));
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let line = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const it = item as { str: string; hasEOL: boolean };
          line += it.str;
          if (it.hasEOL) {
            parts.push(line);
            line = '';
          } else {
            line += ' ';
          }
        }
        if (line.trim()) parts.push(line);
        page.cleanup();
        if (i < doc.numPages) parts.push(''); // blank line between pages
      }
      extracted = parts.join('\n').replace(/[ \t]+\n/g, '\n').trim();
      totalChars = extracted.length;
      el('progress-wrap').hidden = true;
      el('text-empty').hidden = true;
      if (totalChars === 0) {
        el('text-empty').hidden = false;
        el('text-empty').textContent =
          'No text found in this PDF. It may be scanned pages (images with no text). The OCR PDF tool can add a text layer to scans like this.';
        return;
      }
      el<HTMLTextAreaElement>('text-output').value = extracted;
      el('text-output').hidden = false;
      el('count-label').textContent = `${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · ${totalChars.toLocaleString()} characters · ${formatBytes(f.size)}`;
      el<HTMLButtonElement>('copy-btn').disabled = false;
      el<HTMLButtonElement>('txt-btn').disabled = false;
      el('result').hidden = false;
    } catch (err) {
      el('progress-wrap').hidden = true;
      showError('error-box', pdfJsLoadErrorMessage(err) || pdfLoadErrorMessage(err));
    }
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
// v2: rebuilt
