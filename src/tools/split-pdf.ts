// Split PDF tool: DOM glue. Core logic lives in ../lib/pdf-core.ts
import { splitPdf, getPageCount, extractPages } from '../lib/pdf-core.ts';
import { loadPdfjs, renderPageToCanvas, renderPdfThumb } from './pdf-render.ts';
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

const MAX_PICKER_PAGES = 100;

const CHECK_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';

export function initSplitPdf(): void {
  let pdfBytes: Uint8Array | null = null;
  let pdfName = '';
  let pageCount = 0;
  const picked = new Set<number>();

  const fileInfo = el('file-info');
  const splitBtn = el<HTMLButtonElement>('split-btn');
  const rangeInput = el<HTMLInputElement>('range-input');
  const result = el('result');
  const resultList = el('result-list');
  const pickerWrap = el('picker-wrap');
  const pageGrid = el('page-grid');
  const pickCount = el('pick-count');
  const pickAllBtn = el<HTMLButtonElement>('pick-all');
  const pickNoneBtn = el<HTMLButtonElement>('pick-none');
  const extractBtn = el<HTMLButtonElement>('extract-btn');

  function refreshExtract(): void {
    const n = picked.size;
    extractBtn.disabled = n === 0;
    extractBtn.textContent = n === 0 ? 'Extract selected pages' : `Extract ${n} page${n === 1 ? '' : 's'}`;
    pickCount.textContent = n === 0 ? '' : `${n} selected`;
  }

  function setAll(on: boolean): void {
    picked.clear();
    pageGrid.querySelectorAll<HTMLInputElement>('input[data-page]').forEach((box) => {
      box.checked = on;
      if (on) picked.add(Number(box.dataset.page));
    });
    refreshExtract();
  }

  pickAllBtn.addEventListener('click', () => setAll(true));
  pickNoneBtn.addEventListener('click', () => setAll(false));

  pageGrid.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest('input[data-page]') as HTMLInputElement | null;
    if (!box) return;
    const p = Number(box.dataset.page);
    if (box.checked) picked.add(p);
    else picked.delete(p);
    refreshExtract();
  });

  async function renderPicker(bytes: Uint8Array): Promise<void> {
    pageGrid.innerHTML = '';
    picked.clear();
    refreshExtract();
    pickerWrap.hidden = false;
    pickCount.textContent = 'Rendering previews…';
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const total = doc.numPages;
      const shown = Math.min(total, MAX_PICKER_PAGES);
      for (let p = 1; p <= shown; p++) {
        const page = await doc.getPage(p);
        const canvas = await renderPageToCanvas(page, 36);
        const tw = 132;
        const th = Math.max(1, Math.round((canvas.height * tw) / canvas.width));
        const thumb = document.createElement('canvas');
        thumb.width = tw;
        thumb.height = th;
        const ctx = thumb.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(canvas, 0, 0, tw, th);
        }
        const label = document.createElement('label');
        label.className = 'page-pick';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.page = String(p);
        box.setAttribute('aria-label', `Select page ${p}`);
        const img = document.createElement('img');
        img.src = thumb.toDataURL('image/jpeg', 0.72);
        img.alt = `Page ${p} preview`;
        img.loading = 'lazy';
        const num = document.createElement('span');
        num.className = 'pg-num';
        num.textContent = String(p);
        const check = document.createElement('span');
        check.className = 'pick-check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = CHECK_SVG;
        label.append(box, img, num, check);
        pageGrid.appendChild(label);
        // Let the browser paint between pages so the tab stays responsive.
        if (p % 6 === 0) await new Promise((r) => setTimeout(r, 0));
        pickCount.textContent = `Rendering previews… ${p}/${shown}`;
      }
      pickCount.textContent =
        total > MAX_PICKER_PAGES
          ? `Showing first ${MAX_PICKER_PAGES} of ${total} pages — use ranges below for the rest.`
          : '';
    } catch {
      pickerWrap.hidden = true;
      pickCount.textContent = '';
    }
  }

  function addResultRow(name: string, data: Uint8Array, meta: string): void {
    const li = document.createElement('li');
    li.className = 'file-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = name;
    const metaEl = document.createElement('span');
    metaEl.className = 'file-meta';
    metaEl.textContent = meta;
    const actions = document.createElement('span');
    actions.className = 'file-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Download';
    btn.addEventListener('click', () => downloadBytes(name, data, 'application/pdf'));
    actions.appendChild(btn);
    li.append(nameEl, metaEl, actions);
    resultList.appendChild(li);
    // First-page thumbnail, rendered in the background; the row works without it.
    renderPdfThumb(data, 96).then((url) => {
      if (!url) return;
      const img = document.createElement('img');
      img.className = 'file-thumb';
      img.src = url;
      img.alt = '';
      li.prepend(img);
    });
  }

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    result.hidden = true;
    resultList.innerHTML = '';
    pickerWrap.hidden = true;
    pageGrid.innerHTML = '';
    picked.clear();
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('error-box', 'Choose a PDF file first.');
      return;
    }
    try {
      pdfBytes = new Uint8Array(await file.arrayBuffer());
      pageCount = await getPageCount(pdfBytes);
      pdfName = file.name.replace(/\.pdf$/i, '');
      fileInfo.hidden = false;
      fileInfo.textContent = `${file.name} · ${pageCount} page${pageCount === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      rangeInput.placeholder = `e.g. 1-3, 5 (this PDF has ${pageCount} pages)`;
      splitBtn.disabled = false;
      void renderPicker(pdfBytes);
    } catch (err) {
      pdfBytes = null;
      fileInfo.hidden = true;
      pickerWrap.hidden = true;
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
        addResultRow(
          part.name.replace(/^split/, pdfName || 'split'),
          part.data,
          formatBytes(part.data.length)
        );
      }
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('split-btn', false);
    }
  });

  extractBtn.addEventListener('click', async () => {
    if (!pdfBytes || picked.size === 0) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('extract-btn', true, 'Extracting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const pages = [...picked].sort((a, b) => a - b);
      const data = await extractPages(pdfBytes, pages);
      resultList.innerHTML = '';
      addResultRow(
        `${pdfName || 'split'}-pages.pdf`,
        data,
        `${formatBytes(data.length)} · ${pages.length} page${pages.length === 1 ? '' : 's'}`
      );
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setBusy('extract-btn', false);
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
