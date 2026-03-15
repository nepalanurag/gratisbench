// Compress PDF tool: DOM glue. Rebuild logic lives in ../lib/pdf-compress.ts
import { rebuildImagePdf, jpegQualityFromSlider, type RenderedPage } from '../lib/pdf-compress.ts';
import { getPageCount } from '../lib/pdf-core.ts';
import { loadPdfjs, renderPageToCanvas, canvasToBytes, pdfJsLoadErrorMessage, renderPdfThumb, showPdfPreview } from './pdf-render.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

let fileBytes: Uint8Array | null = null;
let fileName = '';
let originalSize = 0;
let pageCount = 0;

function qualityDpi(): number {
  const checked = document.querySelector<HTMLInputElement>('input[name="quality"]:checked');
  return checked ? Number(checked.value) : 110;
}

function setProgress(done: number, total: number): void {
  const wrap = el('progress-wrap');
  wrap.hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = `Rendering page ${done} of ${total}…`;
}

export function initPdfCompressor(): void {
  const compressBtn = el<HTMLButtonElement>('compress-btn');

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('error-box', `"${file.name}" is not a PDF.`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pages = await getPageCount(bytes);
      fileBytes = bytes;
      fileName = file.name;
      originalSize = file.size;
      pageCount = pages;
      el('file-info').textContent = `${file.name} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      const thumb = await renderPdfThumb(bytes);
      if (thumb) {
        const info = el('file-info');
        info.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = thumb;
        img.alt = `First page of ${file.name}`;
        const span = document.createElement('span');
        span.textContent = `${file.name} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
        info.append(img, span);
        info.style.display = 'flex';
        info.style.alignItems = 'center';
        info.style.gap = '10px';
      }
      compressBtn.disabled = false;
    } catch (err) {
      showError('error-box', `"${file.name}": ${pdfJsLoadErrorMessage(err)}`);
    }
  });

  el('quality-slider').addEventListener('input', (e) => {
    el('quality-value').textContent = `${(e.target as HTMLInputElement).value}%`;
  });

  compressBtn.addEventListener('click', async () => {
    if (!fileBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('compress-btn', true, 'Compressing…');
    try {
      const dpi = qualityDpi();
      const quality = jpegQualityFromSlider(Number(el<HTMLInputElement>('quality-slider').value));
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
      const pages: RenderedPage[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        setProgress(i + 1, doc.numPages);
        // Yield so the progress bar paints between pages.
        await new Promise((r) => setTimeout(r, 0));
        const page = await doc.getPage(i + 1);
        const canvas = await renderPageToCanvas(page, dpi);
        const data = await canvasToBytes(canvas, 'image/jpeg', quality);
        pages.push({ data, mime: 'image/jpeg', widthPx: canvas.width, heightPx: canvas.height });
        page.cleanup();
      }
      const out = await rebuildImagePdf(pages, dpi);

      const saved = originalSize - out.length;
      const pct = originalSize > 0 ? Math.round((saved / originalSize) * 100) : 0;
      el('result-info').textContent =
        saved >= 0
          ? `${formatBytes(originalSize)} → ${formatBytes(out.length)} · ${pct}% smaller`
          : `${formatBytes(originalSize)} → ${formatBytes(out.length)} · no saving this time (this PDF was already compact)`;
      el('result').hidden = false;
      const stem = fileName.replace(/\.[^.]+$/, '');
      el<HTMLButtonElement>('download-btn').onclick = () =>
        downloadBytes(`${stem}-compressed.pdf`, out, 'application/pdf');
      void showPdfPreview('preview-wrap', out);
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Compression failed.');
    } finally {
      el('progress-wrap').hidden = true;
      setBusy('compress-btn', false);
    }
  });
}
