// Split PDF tool: DOM glue. Core logic lives in ../lib/pdf-core.ts
import { splitPdf, getPageCount } from '../lib/pdf-core.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  pdfLoadErrorMessage,
} from './common.ts';

export function initSplitPdf(): void {
  let pdfBytes: Uint8Array | null = null;
  let pdfName = '';
  let pageCount = 0;

  const fileInfo = el('file-info');
  const splitBtn = el<HTMLButtonElement>('split-btn');
  const rangeInput = el<HTMLInputElement>('range-input');
  const result = el('result');
  const resultList = el('result-list');

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    result.hidden = true;
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('error-box', 'Please choose a PDF file.');
      return;
    }
    try {
      pdfBytes = new Uint8Array(await file.arrayBuffer());
      pageCount = await getPageCount(pdfBytes);
      pdfName = file.name.replace(/\.pdf$/i, '');
      fileInfo.hidden = false;
      fileInfo.innerHTML = `<strong>${escapeHtml(file.name)}</strong> · ${pageCount} page${pageCount === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      rangeInput.placeholder = `e.g. 1-3, 5 (this PDF has ${pageCount} pages)`;
      splitBtn.disabled = false;
    } catch (err) {
      pdfBytes = null;
      fileInfo.hidden = true;
      splitBtn.disabled = true;
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  splitBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('split-btn', true, 'Splitting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const parts = await splitPdf(pdfBytes, rangeInput.value);
      resultList.innerHTML = '';
      for (const part of parts) {
        const li = document.createElement('li');
        li.className = 'file-row';
        li.innerHTML = `<span class="file-name">${escapeHtml(part.name)}</span>
          <span class="file-meta">${formatBytes(part.data.length)}</span>
          <span class="file-actions"><button type="button">Download</button></span>`;
        li.querySelector('button')!.addEventListener('click', () =>
          downloadBytes(part.name.replace(/^split/, pdfName || 'split'), part.data, 'application/pdf')
        );
        resultList.appendChild(li);
      }
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('split-btn', false);
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
