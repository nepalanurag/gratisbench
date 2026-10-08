// Split PDF tool: DOM glue. Core logic lives in ../lib/pdf-core.ts (ranges)
// and ../lib/pdf-split-x.ts (bookmarks, text search).
import { splitPdf, splitEveryPage, splitEveryNPages, getPageCount, extractPages, type SplitPart } from '../lib/pdf-core.ts';
import {
  getFlatBookmarks,
  bookmarksToChapters,
  splitByBookmarks,
  findTextSplitPages,
  splitByText,
  type BookmarkChapter,
} from '../lib/pdf-split-x.ts';
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
  const zipBtn = el<HTMLButtonElement>('zip-btn');
  const everyPageBtn = el<HTMLButtonElement>('every-page-btn');
  const chunkBtn = el<HTMLButtonElement>('chunk-btn');
  const chunkSize = el<HTMLInputElement>('chunk-size');
  const pickerWrap = el('picker-wrap');
  const pageGrid = el('page-grid');
  const pickCount = el('pick-count');
  const pickAllBtn = el<HTMLButtonElement>('pick-all');
  const pickNoneBtn = el<HTMLButtonElement>('pick-none');
  const extractBtn = el<HTMLButtonElement>('extract-btn');
  const smartSplit = el('smart-split');
  const bookmarkStatus = el('bookmark-status');
  const chapterList = el('chapter-list');
  const bookmarksBtn = el<HTMLButtonElement>('bookmarks-btn');
  const textSplitInput = el<HTMLInputElement>('text-split-input');
  const textSplitBtn = el<HTMLButtonElement>('text-split-btn');

  /** Chapters from the PDF's own bookmarks, set after a file loads. */
  let smartChapters: BookmarkChapter[] = [];

  /**
   * Release a pdf.js document. destroy() exists at runtime but is missing
   * from this pdfjs-dist version's types, so go through unknown.
   */
  async function closeDoc(doc: unknown): Promise<void> {
    try {
      const d = doc as { destroy?: () => Promise<void> | void };
      if (typeof d.destroy === 'function') await d.destroy();
    } catch {
      /* ignore */
    }
  }

  /** The parts from the most recent split run, for the download-all ZIP. */
  let lastParts: { name: string; data: Uint8Array }[] = [];

  /** Friendly name: re-stem core names ("split-part-2.pdf") onto the source file. */
  function displayName(coreName: string): string {
    const stem = pdfName || 'split';
    return coreName.replace(/^split/, stem);
  }

  /** Add the file size to each part's description line. */
  function withSize(parts: { name: string; data: Uint8Array; meta: string }[]) {
    return parts.map((p) => ({ ...p, meta: `${p.meta} · ${formatBytes(p.data.length)}` }));
  }

  /** Read the PDF's bookmarks in the background and offer chapter splitting. */
  async function wireSmartSplit(bytes: Uint8Array): Promise<void> {
    smartChapters = [];
    bookmarksBtn.disabled = true;
    bookmarksBtn.textContent = 'Split by bookmarks';
    chapterList.hidden = true;
    chapterList.innerHTML = '';
    bookmarkStatus.textContent = 'Checking this PDF for bookmarks…';
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      let chapters: BookmarkChapter[] = [];
      try {
        const flat = await getFlatBookmarks(doc);
        chapters = bookmarksToChapters(flat, pageCount);
      } finally {
        await closeDoc(doc);
      }
      smartChapters = chapters;
      if (chapters.length >= 2) {
        bookmarkStatus.textContent = `Found ${chapters.length} chapters in this PDF's own table of contents:`;
        chapters.forEach((ch) => {
          const row = document.createElement('div');
          row.className = 'file-row';
          const title = document.createElement('span');
          title.className = 'file-name';
          title.textContent = ch.title;
          const meta = document.createElement('span');
          meta.className = 'file-meta';
          meta.textContent = ch.startPage === ch.endPage ? `page ${ch.startPage}` : `pages ${ch.startPage}-${ch.endPage}`;
          row.append(title, meta);
          chapterList.appendChild(row);
        });
        chapterList.hidden = false;
        bookmarksBtn.disabled = false;
        bookmarksBtn.textContent = `Split into ${chapters.length} chapters`;
      } else if (chapters.length === 1) {
        bookmarkStatus.textContent =
          'This PDF has only one bookmark, so splitting by bookmarks would give a single file. Use page ranges above instead.';
      } else {
        bookmarkStatus.textContent =
          'This PDF has no bookmarks (table of contents), so there is nothing to split by. Use page ranges above instead.';
      }
    } catch {
      bookmarkStatus.textContent = 'Could not read this PDF\u2019s bookmarks. Use page ranges above instead.';
    }
  }

  function resetSmartSplit(): void {
    smartChapters = [];
    smartSplit.hidden = true;
    textSplitInput.value = '';
    textSplitInput.disabled = true;
    textSplitBtn.disabled = true;
  }

  function refreshZip(): void {
    zipBtn.hidden = lastParts.length < 2;
    zipBtn.textContent =
      lastParts.length < 2 ? 'Download all as ZIP' : `Download all ${lastParts.length} as ZIP`;
  }

  function showParts(parts: { name: string; data: Uint8Array; meta?: string }[]): void {
    lastParts = parts.map((p) => ({ name: displayName(p.name), data: p.data }));
    resultList.innerHTML = '';
    lastParts.forEach((part, i) => {
      addResultRow(part.name, part.data, parts[i].meta ?? formatBytes(part.data.length));
    });
    refreshZip();
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  zipBtn.addEventListener('click', async () => {
    if (lastParts.length === 0) return;
    hideError('error-box');
    setBusy('zip-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const part of lastParts) zip.file(part.name, part.data);
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBytes(
        `${pdfName || 'split'}-parts.zip`,
        new Uint8Array(await blob.arrayBuffer()),
        'application/zip'
      );
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setBusy('zip-btn', false);
    }
  });

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
          ? `Showing first ${MAX_PICKER_PAGES} of ${total} pages. Use ranges below for the rest.`
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
    lastParts = [];
    refreshZip();
    pickerWrap.hidden = true;
    pageGrid.innerHTML = '';
    picked.clear();
    resetSmartSplit();
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
      everyPageBtn.disabled = false;
      chunkBtn.disabled = false;
      chunkSize.disabled = false;
      everyPageBtn.textContent = `Split every page (${pageCount} file${pageCount === 1 ? '' : 's'})`;
      // Smart split: reveal the section and read bookmarks in the background.
      smartSplit.hidden = false;
      textSplitInput.disabled = false;
      textSplitBtn.disabled = false;
      void wireSmartSplit(pdfBytes);
      void renderPicker(pdfBytes);
    } catch (err) {
      pdfBytes = null;
      fileInfo.hidden = true;
      pickerWrap.hidden = true;
      splitBtn.disabled = true;
      everyPageBtn.disabled = true;
      chunkBtn.disabled = true;
      chunkSize.disabled = true;
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
      showParts(parts);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('split-btn', false);
    }
  });

  everyPageBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('every-page-btn', true, 'Splitting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const parts = await splitEveryPage(pdfBytes);
      showParts(parts);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('every-page-btn', false);
    }
  });

  chunkBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;
    hideError('error-box');
    result.hidden = true;
    const n = Math.floor(Number(chunkSize.value));
    if (!Number.isInteger(n) || n < 1) {
      showError('error-box', 'Enter how many pages go in each file, for example 5.');
      return;
    }
    setBusy('chunk-btn', true, 'Splitting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const parts = await splitEveryNPages(pdfBytes, n);
      showParts(parts);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('chunk-btn', false);
    }
  });

  extractBtn.addEventListener('click', async () => {    if (!pdfBytes || picked.size === 0) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('extract-btn', true, 'Extracting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const pages = [...picked].sort((a, b) => a - b);
      const data = await extractPages(pdfBytes, pages);
      showParts([
        {
          name: `${pdfName || 'split'}-pages.pdf`,
          data,
          meta: `${formatBytes(data.length)} · ${pages.length} page${pages.length === 1 ? '' : 's'}`,
        },
      ]);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setBusy('extract-btn', false);
    }
  });

  bookmarksBtn.addEventListener('click', async () => {
    if (!pdfBytes || smartChapters.length < 2) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('bookmarks-btn', true, 'Splitting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const parts = await splitByBookmarks(pdfBytes, smartChapters, pdfName || 'split');
      showParts(withSize(parts));
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('bookmarks-btn', false);
    }
  });

  textSplitBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;
    const query = textSplitInput.value.trim();
    if (!query) {
      showError('error-box', 'Type the words to split on, for example "Invoice".');
      return;
    }
    hideError('error-box');
    result.hidden = true;
    setBusy('text-split-btn', true, 'Reading pages…');
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
      let hits: number[];
      try {
        hits = await findTextSplitPages(doc, query);
      } finally {
        await closeDoc(doc);
      }
      if (hits.length === 0) {
        showError('error-box', `Could not find "${query}" on any page of this PDF.`);
        return;
      }
      setBusy('text-split-btn', true, 'Splitting…');
      const parts = await splitByText(pdfBytes, pageCount, hits, query, pdfName || 'split');
      showParts(withSize(parts));
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Splitting failed.');
    } finally {
      setBusy('text-split-btn', false);
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
