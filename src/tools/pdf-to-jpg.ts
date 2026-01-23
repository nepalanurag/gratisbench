// PDF to JPG/PNG tool: DOM glue. Pure helpers live in ../lib/pdf-images.ts
import { pageFileName, validatePageImageOptions, type PageImageFormat } from '../lib/pdf-images.ts';
import { loadPdfjs, renderPageToCanvas, canvasToBytes, pdfJsLoadErrorMessage } from './pdf-render.ts';
import { getPageCount } from '../lib/pdf-core.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

interface PageImage {
  name: string;
  data: Uint8Array;
  mime: string;
  thumb: string;
}

let fileBytes: Uint8Array | null = null;
let fileStem = 'document';
const images: PageImage[] = [];

function setProgress(done: number, total: number): void {
  const wrap = el('progress-wrap');
  wrap.hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = `Rendering page ${done} of ${total}…`;
}

function renderList(): void {
  const list = el('page-list');
  list.innerHTML = '';
  images.forEach((img, i) => {
    const row = document.createElement('li');
    row.className = 'file-row';
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = img.thumb;
    thumb.alt = '';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = img.name;
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = formatBytes(img.data.length);
    const actions = document.createElement('span');
    actions.className = 'file-actions';
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'icon-btn';
    dl.setAttribute('aria-label', `Download ${img.name}`);
    dl.title = 'Download';
    dl.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>';
    dl.addEventListener('click', () => downloadBytes(img.name, img.data, img.mime));
    actions.appendChild(dl);
    row.append(thumb, name, meta, actions);
    list.appendChild(row);
  });
  el('empty-state').hidden = images.length > 0;
  el('download-all-btn').hidden = images.length < 2;
  el('count-label').textContent =
    images.length === 0 ? '' : `${images.length} image${images.length === 1 ? '' : 's'} ready`;
}

export function initPdfToJpg(): void {
  const convertBtn = el<HTMLButtonElement>('convert-btn');

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
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
      fileStem = file.name;
      el('file-info').textContent = `${file.name} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      convertBtn.disabled = false;
    } catch (err) {
      showError('error-box', `"${file.name}": ${pdfJsLoadErrorMessage(err)}`);
    }
  });

  convertBtn.addEventListener('click', async () => {
    if (!fileBytes) return;
    hideError('error-box');
    setBusy('convert-btn', true, 'Converting…');
    images.length = 0;
    try {
      const dpi = Number(el<HTMLSelectElement>('dpi-select').value);
      const format = el<HTMLSelectElement>('format-select').value as PageImageFormat;
      validatePageImageOptions({ dpi, format });
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
      for (let i = 0; i < doc.numPages; i++) {
        setProgress(i + 1, doc.numPages);
        await new Promise((r) => setTimeout(r, 0));
        const page = await doc.getPage(i + 1);
        const canvas = await renderPageToCanvas(page, dpi);
        const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const data = await canvasToBytes(canvas, mime, 0.92);
        const thumbCanvas = document.createElement('canvas');
        const scale = 104 / canvas.width;
        thumbCanvas.width = 104;
        thumbCanvas.height = Math.max(1, Math.round(canvas.height * scale));
        thumbCanvas.getContext('2d')?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        images.push({
          name: pageFileName(fileStem, i + 1, format),
          data,
          mime,
          thumb: thumbCanvas.toDataURL('image/jpeg', 0.7),
        });
        page.cleanup();
      }
      renderList();
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Conversion failed.');
    } finally {
      el('progress-wrap').hidden = true;
      setBusy('convert-btn', false);
    }
  });

  el('download-all-btn').addEventListener('click', async () => {
    if (images.length === 0) return;
    hideError('error-box');
    setBusy('download-all-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const img of images) zip.file(img.name, img.data);
      const blob = await zip.generateAsync({ type: 'blob' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      const stem = fileStem.replace(/\.[^.]+$/, '').trim() || 'document';
      downloadBytes(`${stem}-pages.zip`, buf, 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setBusy('download-all-btn', false);
    }
  });

  renderList();
}
