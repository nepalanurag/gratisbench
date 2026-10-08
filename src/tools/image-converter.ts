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
  validateResizeMode,
  computeResizeDims,
  type ResizeMode,
  type ResizeDims,
} from '../lib/image-resize.ts';
import {
  fileToImage,
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
  setupPasteHandler,
  bindSetting,
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
  /** MIME actually used when this item was converted (may differ from the
   *  currently selected format if the user changed it afterwards). */
  resultMime: string | null;
  /** Output dimensions of the converted result (may differ when resized). */
  resultWidth: number | null;
  resultHeight: number | null;
}

const items: Item[] = [];
let outputOptions: OutputOption[] = [];

const DOWNLOAD_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>';
const X_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';

/** Persist a radio group's checked value across visits (bindSetting only handles single inputs). */
function bindRadioSetting(tool: string, key: string, name: string): void {
  const storageKey = `truepdf:${tool}:${key}`;
  const radios = [...document.querySelectorAll(`input[name="${name}"]`)] as HTMLInputElement[];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && radios.some((r) => r.value === stored)) {
      radios.forEach((r) => {
        r.checked = r.value === stored;
      });
      radios.forEach((r) => r.dispatchEvent(new Event('change', { bubbles: true })));
    }
  } catch {
    /* localStorage unavailable — use defaults */
  }
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) {
        try {
          localStorage.setItem(storageKey, r.value);
        } catch {
          /* ignore quota errors */
        }
      }
    })
  );
}

/** Current resize choice from the UI. */
function readResize(): { mode: ResizeMode; customWidth: string } {
  const checked = document.querySelector('input[name="resize-mode"]:checked') as HTMLInputElement | null;
  const mode = validateResizeMode(checked?.value);
  const customWidth = el<HTMLInputElement>('custom-width').value;
  el('custom-width-row').hidden = mode !== 'custom';
  return { mode, customWidth };
}

/**
 * Draw an image onto a canvas at the resize target, optionally filling the
 * background first (for JPEG output). Large downscales go through halving
 * steps, which stay noticeably sharper than a single big jump.
 */
function drawResized(img: HTMLImageElement, dims: ResizeDims | null, fill: string | null): HTMLCanvasElement {
  const w = dims?.width ?? img.naturalWidth;
  const h = dims?.height ?? img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  let src: HTMLCanvasElement | HTMLImageElement = img;
  let cw = img.naturalWidth;
  let ch = img.naturalHeight;
  while (cw > w * 2 && ch > h * 2) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    const step = document.createElement('canvas');
    step.width = cw;
    step.height = ch;
    const sctx = step.getContext('2d');
    if (!sctx) break;
    sctx.drawImage(src, 0, 0, cw, ch);
    src = step;
  }
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/** Plain-language note about what the resize choice does to the first image. */
function refreshResizeHint(): void {
  const hint = document.getElementById('resize-hint');
  if (!hint || items.length === 0) return;
  const { mode, customWidth } = readResize();
  const first = items[0];
  try {
    const dims = computeResizeDims(first.img.naturalWidth, first.img.naturalHeight, mode, customWidth);
    hint.textContent = dims
      ? `Your ${first.img.naturalWidth}×${first.img.naturalHeight} image will become ${dims.width}×${dims.height}.`
      : 'Resizing happens before conversion. Resizing never enlarges.';
  } catch {
    /* Keep the generic hint. */
  }
}

/** Live before/after preview: convert the first image with current settings (debounced). */
let previewTimer: number | null = null;
let previewSplit = 50;

function setSplit(pct: number): void {
  previewSplit = Math.max(2, Math.min(98, pct));
  const after = document.getElementById('compare-after');
  const divider = document.getElementById('compare-divider');
  const handle = document.getElementById('compare-handle');
  if (!after || !divider || !handle) return;
  after.style.clipPath = `inset(0 ${100 - previewSplit}% 0 0)`;
  divider.style.left = `${previewSplit}%`;
  handle.style.left = `${previewSplit}%`;
  handle.setAttribute('aria-valuenow', String(Math.round(previewSplit)));
}

function setupCompareDrag(): void {
  const wrap = document.getElementById('compare-wrap');
  const handle = document.getElementById('compare-handle');
  if (!wrap || !handle) return;
  let dragging = false;
  const move = (clientX: number) => {
    const rect = wrap.getBoundingClientRect();
    setSplit(((clientX - rect.left) / rect.width) * 100);
  };
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (dragging) move(e.clientX);
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
  wrap.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('#compare-handle')) return;
    dragging = true;
    move(e.clientX);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (dragging && !(e.target as HTMLElement).closest('#compare-handle')) move(e.clientX);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { setSplit(previewSplit - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setSplit(previewSplit + 5); e.preventDefault(); }
  });
}

async function updateLivePreview(): Promise<void> {
  const preview = document.getElementById('live-preview');
  if (!preview || items.length === 0) {
    if (preview) preview.hidden = true;
    return;
  }
  const item = items[0];
  try {
    const fmt = selectedFormat();
    const mime = OUTPUT_MIMES[fmt];
    const q = qualityFromSlider(Number(el<HTMLInputElement>('quality-range').value));
    const fillWhite = (document.getElementById('fill-white') as HTMLInputElement | null)?.checked ?? true;
    const fill = mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
    const { mode, customWidth } = readResize();
    const dims = computeResizeDims(item.img.naturalWidth, item.img.naturalHeight, mode, customWidth);
    const canvas = drawResized(item.img, dims, fill);
    const data = await canvasToImageBytes(canvas, mime, q);

    const beforeImg = document.getElementById('compare-before') as HTMLImageElement;
    const afterImg = document.getElementById('compare-after-img') as HTMLImageElement;
    beforeImg.src = item.url;
    const blobUrl = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    const prev = afterImg.dataset.blobUrl;
    if (prev) URL.revokeObjectURL(prev);
    afterImg.dataset.blobUrl = blobUrl;
    afterImg.src = blobUrl;

    const sizes = document.getElementById('compare-sizes');
    if (sizes) {
      const dimNote = dims ? ` · ${dims.width}×${dims.height}` : '';
      sizes.innerHTML =
        `<strong>${formatBytes(item.file.size)}</strong> → <strong>${formatBytes(data.length)}</strong>` +
        ` · ${mimeLabel(mime)}${dimNote}`;
    }
    preview.hidden = false;
    setSplit(previewSplit);
  } catch {
    /* Live preview is best-effort; the main convert button still works. */
  }
}

function scheduleLivePreview(): void {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => { void updateLivePreview(); }, 350);
}

function selectedFormat(): ImageOutputFormat {
  return el<HTMLSelectElement>('output-select').value as ImageOutputFormat;
}

/** Human label for a conversion-time MIME, e.g. "image/webp" -> "WEBP". */
function mimeLabel(mime: string): string {
  const found = (Object.keys(OUTPUT_MIMES) as ImageOutputFormat[]).find((f) => OUTPUT_MIMES[f] === mime);
  return found ? found.toUpperCase() : mime.replace(/^image\//, '').toUpperCase();
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
    if (item.resultData) {
      const dimNote =
        item.resultWidth && item.resultHeight &&
        (item.resultWidth !== item.img.naturalWidth || item.resultHeight !== item.img.naturalHeight)
          ? ` · ${item.resultWidth}×${item.resultHeight}`
          : '';
      meta.textContent =
        `${item.img.naturalWidth}×${item.img.naturalHeight}${dimNote} · ` +
        `${formatBytes(item.file.size)} → ${formatBytes(item.resultData.length)}`;
    } else {
      meta.textContent = `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)}`;
    }

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
      // Use the MIME from conversion time, not the currently selected format:
      // the user may have switched formats after converting.
      const mime = item.resultMime ?? OUTPUT_MIMES[selectedFormat()];
      dl.addEventListener('click', () => downloadBytes(rname, data, mime));
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
  el<HTMLButtonElement>('convert-btn').disabled = items.length === 0;
  refreshJpegUi();
  refreshResizeHint();
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
  select.addEventListener('change', () => {
    refreshJpegUi();
    scheduleLivePreview();
  });

  const qualityRange = el<HTMLInputElement>('quality-range');
  bindSetting('image-converter', 'quality', qualityRange, '90');
  const syncQualityLabel = () => {
    el('quality-val').textContent = qualityRange.value;
  };
  qualityRange.addEventListener('input', () => {
    syncQualityLabel();
    scheduleLivePreview();
  });
  syncQualityLabel();

  document.querySelectorAll('input[name="resize-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      readResize();
      refreshResizeHint();
      scheduleLivePreview();
    });
  });
  el('custom-width').addEventListener('input', () => {
    refreshResizeHint();
    scheduleLivePreview();
  });
  bindRadioSetting('image-converter', 'resize-mode', 'resize-mode');
  bindSetting('image-converter', 'resize-width', el<HTMLInputElement>('custom-width'), '');
  document.getElementById('fill-white')?.addEventListener('change', scheduleLivePreview);

  setupCompareDrag();

  const handleFiles = async (files: File[]) => {
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
          resultWidth: null,
          resultHeight: null,
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
    scheduleLivePreview();
  };

  setupDropzone('dropzone', 'file-input', handleFiles);
  setupPasteHandler(handleFiles, (f) => f.type.startsWith('image/'));

  el('convert-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('download-all-btn').hidden = true;
    setBusy('convert-btn', true, 'Converting…');
    try {
      const fmt = selectedFormat();
      const mime = OUTPUT_MIMES[fmt];
      const q = qualityFromSlider(Number(qualityRange.value));
      const fillWhite = el<HTMLInputElement>('fill-white').checked;
      const resizeChoice = readResize();
      for (const item of items) {
        // Yield so the busy state paints and the tab stays responsive.
        await new Promise((r) => setTimeout(r, 0));
        const fill = mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
        const dims = computeResizeDims(item.img.naturalWidth, item.img.naturalHeight, resizeChoice.mode, resizeChoice.customWidth);
        const canvas = drawResized(item.img, dims, fill);
        const data = await canvasToImageBytes(canvas, mime, q);
        item.resultName = outputFileName(item.file.name, '-converted', fmt);
        item.resultData = data;
        item.resultMime = mime;
        item.resultWidth = canvas.width;
        item.resultHeight = canvas.height;
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
    const fmtLabel =
      done.length > 0 && done[0].resultMime
        ? mimeLabel(done[0].resultMime)
        : selectedFormat().toUpperCase();
    el('count-label').textContent =
      done.length > 0
        ? `${done.length} converted to ${fmtLabel}`
        : items.length === 0
          ? ''
          : `${items.length} image${items.length === 1 ? '' : 's'} ready`;
  }

  renderList();
  updateCount();
}
