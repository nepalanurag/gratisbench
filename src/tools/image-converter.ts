// Image converter tool: DOM glue. Pure logic lives in ../lib/image-core.ts,
// canvas encode/decode in ./image-canvas.ts.
import {
  detectInputKind,
  converterOutputOptions,
  converterInputNote,
  qualityFromSlider,
  outputFileName,
  batchZipName,
  alphaLossRisk,
  OUTPUT_MIMES,
  type ImageInputKind,
  type ImageOutputFormat,
  type OutputOption,
} from '../lib/image-core.ts';
import {
  fileToImage,
  drawToCanvas,
  canvasToImageBytes,
  thumbnailDataUrl,
  imageHasAlpha,
  canEncodeAvif,
} from './image-canvas.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

interface Item {
  file: File;
  kind: ImageInputKind;
  img: HTMLImageElement;
  url: string;
  hasAlpha: boolean;
  thumb: string;
  resultName: string | null;
  resultData: Uint8Array | null;
}

const items: Item[] = [];
let outputOptions: OutputOption[] = [];

const DOWNLOAD_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>';
const X_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';

function selectedFormat(): ImageOutputFormat {
  return el<HTMLSelectElement>('output-select').value as ImageOutputFormat;
}

/** White fill + transparency warning appear only for JPEG output; warn only if alpha is real. */
function refreshJpegUi(): void {
  const isJpeg = selectedFormat() === 'jpeg';
  el('jpeg-fill-block').hidden = !isJpeg;
  const warn = isJpeg && items.some((i) => i.hasAlpha && alphaLossRisk(i.kind, 'jpeg'));
  el('alpha-warning').hidden = !warn;
  const fmt = selectedFormat();
  el('format-note').textContent = outputOptions.find((o) => o.format === fmt)?.note ?? '';
  el('quality-field').hidden = fmt === 'png';
}

function renderList(): void {
  const list = el('file-list');
  list.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('li');
    row.className = 'file-row';

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = item.thumb;
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.file.name;
    name.title = item.file.name;

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = item.resultData
      ? `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)} → ${formatBytes(item.resultData.length)}`
      : `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)}`;

    const actions = document.createElement('span');
    actions.className = 'file-actions';
    if (item.resultData && item.resultName) {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'icon-btn';
      dl.title = 'Download converted image';
      dl.setAttribute('aria-label', `Download ${item.resultName}`);
      dl.innerHTML = DOWNLOAD_SVG;
      const data = item.resultData;
      const rname = item.resultName;
      dl.addEventListener('click', () => downloadBytes(rname, data, OUTPUT_MIMES[selectedFormat()]));
      actions.appendChild(dl);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn';
    rm.title = 'Remove';
    rm.setAttribute('aria-label', `Remove ${item.file.name}`);
    rm.innerHTML = X_SVG;
    rm.addEventListener('click', () => {
      URL.revokeObjectURL(item.url);
      items.splice(idx, 1);
      refreshJpegUi();
      renderList();
    });
    actions.appendChild(rm);

    row.append(thumb, name, meta, actions);
    list.appendChild(row);
  });
  el('empty-state').hidden = items.length > 0;
  el('convert-btn').disabled = items.length === 0;
  refreshJpegUi();
}

function refreshInputNote(): void {
  const notes = [...new Set(items.map((i) => converterInputNote(i.kind)).filter((n) => n !== null))];
  const box = el('input-note');
  box.hidden = notes.length === 0;
  box.textContent = notes.join(' ');
}

export function initImageConverter(): void {
  outputOptions = converterOutputOptions(canEncodeAvif());
  const select = el<HTMLSelectElement>('output-select');
  for (const opt of outputOptions) {
    const o = document.createElement('option');
    o.value = opt.format;
    o.textContent = `${opt.label} (.${opt.ext})`;
    select.appendChild(o);
  }
  select.value = 'webp';
  select.addEventListener('change', refreshJpegUi);

  const qualityRange = el<HTMLInputElement>('quality-range');
  const syncQualityLabel = () => {
    el('quality-val').textContent = qualityRange.value;
  };
  qualityRange.addEventListener('input', syncQualityLabel);
  syncQualityLabel();

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    for (const file of files) {
      const kind = detectInputKind(file.name, file.type);
      if (kind === 'unknown') {
        showError('error-box', `"${file.name}" is not a supported image. Use PNG, JPEG, WebP, GIF, BMP, or TIFF.`);
        continue;
      }
      try {
        const { img, url } = await fileToImage(file);
        items.push({
          file,
          kind,
          img,
          url,
          hasAlpha: imageHasAlpha(img),
          thumb: thumbnailDataUrl(img),
          resultName: null,
          resultData: null,
        });
      } catch {
        showError(
          'error-box',
          `"${file.name}" could not be read as an image. TIFF files in particular depend on your browser.`
        );
      }
    }
    refreshInputNote();
    renderList();
    updateCount();
  });

  el('convert-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('download-all-btn').hidden = true;
    setBusy('convert-btn', true, 'Converting…');
    try {
      const fmt = selectedFormat();
      const mime = OUTPUT_MIMES[fmt];
      const q = qualityFromSlider(Number(qualityRange.value));
      const fillWhite = el<HTMLInputElement>('fill-white').checked;
      for (const item of items) {
        // Yield so the busy state paints and the tab stays responsive.
        await new Promise((r) => setTimeout(r, 0));
        const fill = mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
        const canvas = drawToCanvas(item.img, fill);
        const data = await canvasToImageBytes(canvas, mime, q);
        item.resultName = outputFileName(item.file.name, '-converted', fmt);
        item.resultData = data;
        renderList();
      }
      updateCount();
      el('count-label').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Conversion failed.');
    } finally {
      setBusy('convert-btn', false);
    }
  });

  el('download-all-btn').addEventListener('click', async () => {
    const done = items.filter((i) => i.resultData && i.resultName);
    if (done.length === 0) return;
    hideError('error-box');
    setBusy('download-all-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const item of done) zip.file(item.resultName!, item.resultData!);
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBytes(batchZipName('convert'), new Uint8Array(await blob.arrayBuffer()), 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setBusy('download-all-btn', false);
    }
  });

  function updateCount(): void {
    const done = items.filter((i) => i.resultData);
    el('download-all-btn').hidden = done.length < 2;
    el('count-label').textContent =
      done.length > 0
        ? `${done.length} converted to ${selectedFormat().toUpperCase()}`
        : items.length === 0
          ? ''
          : `${items.length} image${items.length === 1 ? '' : 's'} ready`;
  }

  renderList();
  updateCount();
}
