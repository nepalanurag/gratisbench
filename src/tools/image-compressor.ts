// Image compressor tool: DOM glue. Pure logic lives in ../lib/image-core.ts,
// canvas encode/decode in ./image-canvas.ts.
import {
  detectInputKind,
  resolveCompressorSettings,
  savings,
  totalSavings,
  outputFileName,
  batchZipName,
  alphaLossRisk,
  type ImageInputKind,
  type CompressorFormatChoice,
} from '../lib/image-core.ts';
import {
  fileToImage,
  drawToCanvas,
  canvasToImageBytes,
  thumbnailDataUrl,
  imageHasAlpha,
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
  resultMime: string | null;
}

const items: Item[] = [];

const DOWNLOAD_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>';
const X_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';

function selectedChoice(): CompressorFormatChoice {
  const checked = document.querySelector('input[name="out-format"]:checked') as HTMLInputElement | null;
  const v = checked?.value;
  return v === 'jpeg' || v === 'webp' ? v : 'keep';
}

function qualitySlider(): number {
  return Number(el<HTMLInputElement>('quality-range').value);
}

/** Show the white-fill option whenever JPEG is the chosen output; warn only if alpha is real. */
function refreshJpegUi(): void {
  const isJpeg = selectedChoice() === 'jpeg';
  el('jpeg-fill-block').hidden = !isJpeg;
  const warn = isJpeg && items.some((i) => i.hasAlpha && alphaLossRisk(i.kind, 'jpeg'));
  el('alpha-warning').hidden = !warn;
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
    if (item.resultData) {
      const s = savings(item.file.size, item.resultData.length);
      const pct = s.percent >= 0 ? `saved ${s.percent}%` : `grew ${Math.abs(s.percent)}%`;
      meta.textContent = `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)} → ${formatBytes(item.resultData.length)} · ${pct}`;
    } else {
      meta.textContent = `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)}`;
    }

    const actions = document.createElement('span');
    actions.className = 'file-actions';
    if (item.resultData && item.resultName && item.resultMime) {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'icon-btn';
      dl.title = 'Download compressed image';
      dl.setAttribute('aria-label', `Download ${item.resultName}`);
      dl.innerHTML = DOWNLOAD_SVG;
      const data = item.resultData;
      const rname = item.resultName;
      const rmime = item.resultMime;
      dl.addEventListener('click', () => downloadBytes(rname, data, rmime));
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
  el('compress-btn').disabled = items.length === 0;
  refreshJpegUi();
}

function updateTotals(): void {
  const done = items.filter((i) => i.resultData);
  el('download-all-btn').hidden = done.length < 2;
  if (done.length === 0) {
    el('count-label').textContent =
      items.length === 0 ? '' : `${items.length} image${items.length === 1 ? '' : 's'} ready`;
    return;
  }
  const t = totalSavings(done.map((i) => ({ original: i.file.size, result: i.resultData!.length })));
  const pct = t.percent >= 0 ? `saved ${t.percent}%` : `grew ${Math.abs(t.percent)}%`;
  el('count-label').textContent =
    `${done.length} compressed · ${formatBytes(t.totalOriginal)} → ${formatBytes(t.totalResult)} · ${pct}`;
}

export function initImageCompressor(): void {
  const qualityRange = el<HTMLInputElement>('quality-range');

  const syncQualityLabel = () => {
    el('quality-val').textContent = qualityRange.value;
  };
  qualityRange.addEventListener('input', syncQualityLabel);
  syncQualityLabel();

  document.querySelectorAll('input[name="out-format"]').forEach((radio) => {
    radio.addEventListener('change', refreshJpegUi);
  });

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
          resultMime: null,
        });
      } catch {
        showError(
          'error-box',
          `"${file.name}" could not be read as an image. TIFF files in particular depend on your browser.`
        );
      }
    }
    renderList();
    updateTotals();
  });

  el('compress-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('download-all-btn').hidden = true;
    setBusy('compress-btn', true, 'Compressing…');
    try {
      const choice = selectedChoice();
      const q = qualitySlider();
      const fillWhite = el<HTMLInputElement>('fill-white').checked;
      for (const item of items) {
        // Yield so the busy state paints and the tab stays responsive.
        await new Promise((r) => setTimeout(r, 0));
        const settings = resolveCompressorSettings(item.kind, choice, q);
        const fill = settings.mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
        const canvas = drawToCanvas(item.img, fill);
        const data = await canvasToImageBytes(canvas, settings.mime, settings.quality01);
        item.resultName = outputFileName(item.file.name, '-compressed', settings.outputFormat);
        item.resultData = data;
        item.resultMime = settings.mime;
        renderList();
      }
      updateTotals();
      el('count-label').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Compression failed.');
    } finally {
      setBusy('compress-btn', false);
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
      downloadBytes(batchZipName('compress'), new Uint8Array(await blob.arrayBuffer()), 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setBusy('download-all-btn', false);
    }
  });

  renderList();
  updateTotals();
}
