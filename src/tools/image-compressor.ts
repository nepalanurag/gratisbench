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
  resultMime: string | null;
  /** Output dimensions of the compressed result (may differ when resized). */
  resultWidth: number | null;
  resultHeight: number | null;
  /** Blob URL of the compressed bytes, for the before/after compare. */
  resultUrl: string | null;
  /** Whether the row thumbnail is currently showing the compressed result. */
  showingAfter: boolean;
  /** Note about how the result was reached (target-size mode), or null. */
  resultNote: string | null;
}

const items: Item[] = [];

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

function selectedChoice(): CompressorFormatChoice {
  const checked = document.querySelector('input[name="out-format"]:checked') as HTMLInputElement | null;
  const v = checked?.value;
  return v === 'jpeg' || v === 'webp' ? v : 'keep';
}

function qualitySlider(): number {
  return Number(el<HTMLInputElement>('quality-range').value);
}

function targetMode(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="cmode"]:checked')?.value === 'target';
}

function targetBytes(): number {
  const kb = Number(el<HTMLInputElement>('target-kb').value);
  return Math.max(10, Math.round((Number.isFinite(kb) && kb > 0 ? kb : 200) * 1024));
}

function refreshModeUi(): void {
  el('quality-slider-field').hidden = targetMode();
  el('target-size-field').hidden = !targetMode();
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
      ? `Your ${first.img.naturalWidth}×${first.img.naturalHeight} image will shrink to ${dims.width}×${dims.height} before compression.`
      : 'Shrinking happens before compression, so a smaller image compresses to a smaller file. Resizing never enlarges.';
  } catch {
    /* Keep the generic hint. */
  }
}

/** Binary-search the highest quality (5–100) whose output fits under the
 *  target size. Returns the encoded bytes and the quality used. If even
 *  quality 5 is too big, returns the quality-5 output and flags it. */
async function compressToTarget(
  canvas: HTMLCanvasElement,
  mime: string,
  target: number,
): Promise<{ data: Uint8Array; quality: number; hit: boolean }> {
  let lo = 5;
  let hi = 100;
  let best: Uint8Array | null = null;
  let bestQ = 5;
  // ~7 iterations: enough to pin the quality within a couple of points.
  for (let i = 0; i < 7; i++) {
    const q = Math.round((lo + hi) / 2);
    const data = await canvasToImageBytes(canvas, mime, q / 100);
    if (data.length <= target) {
      best = data;
      bestQ = q;
      lo = q + 1;
    } else {
      hi = q - 1;
    }
    if (lo > hi) break;
  }
  if (best) return { data: best, quality: bestQ, hit: true };
  const data = await canvasToImageBytes(canvas, mime, 0.05);
  return { data, quality: 5, hit: false };
}

/** Show the white-fill option whenever JPEG is the chosen output; warn only if alpha is real. */
function refreshJpegUi(): void {
  const isJpeg = selectedChoice() === 'jpeg';
  el('jpeg-fill-block').hidden = !isJpeg;
  const warn = isJpeg && items.some((i) => i.hasAlpha && alphaLossRisk(i.kind, 'jpeg'));
  el('alpha-warning').hidden = !warn;
}

/** Live preview: compress the first image with current settings (debounced). */
let previewTimer: number | null = null;
let previewSplit = 50;

function setSplit(pct: number): void {
  previewSplit = Math.max(2, Math.min(98, pct));
  const wrap = document.getElementById('compare-wrap');
  const after = document.getElementById('compare-after');
  const divider = document.getElementById('compare-divider');
  const handle = document.getElementById('compare-handle');
  if (!wrap || !after || !divider || !handle) return;
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
    const choice = selectedChoice();
    const q = qualitySlider();
    const fillWhite = (document.getElementById('fill-white') as HTMLInputElement | null)?.checked ?? true;
    const settings = resolveCompressorSettings(item.kind, choice, q);
    const fill = settings.mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
    const { mode, customWidth } = readResize();
    const dims = computeResizeDims(item.img.naturalWidth, item.img.naturalHeight, mode, customWidth);
    const canvas = drawResized(item.img, dims, fill);
    let data: Uint8Array;
    if (targetMode() && settings.qualityApplies) {
      data = (await compressToTarget(canvas, settings.mime, targetBytes())).data;
    } else {
      data = await canvasToImageBytes(canvas, settings.mime, settings.quality01);
    }

    const beforeImg = document.getElementById('compare-before') as HTMLImageElement;
    const afterImg = document.getElementById('compare-after-img') as HTMLImageElement;
    beforeImg.src = item.url;
    const blobUrl = URL.createObjectURL(new Blob([data as BlobPart], { type: settings.mime }));
    // Revoke previous preview URL to avoid leaks.
    const prev = afterImg.dataset.blobUrl;
    if (prev) URL.revokeObjectURL(prev);
    afterImg.dataset.blobUrl = blobUrl;
    afterImg.src = blobUrl;

    const s = savings(item.file.size, data.length);
    const pct = s.percent >= 0 ? `saved ${s.percent}%` : `grew ${Math.abs(s.percent)}%`;
    const dimNote = dims ? ` · ${dims.width}×${dims.height}` : '';
    const sizes = document.getElementById('compare-sizes');
    if (sizes) {
      sizes.innerHTML = `<strong>${formatBytes(item.file.size)}</strong> → <strong>${formatBytes(data.length)}</strong> · ${pct}${dimNote}`;
    }
    preview.hidden = false;
    setSplit(previewSplit);
  } catch {
    /* Live preview is best-effort; the main compress button still works. */
  }
}

function scheduleLivePreview(): void {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => { void updateLivePreview(); }, 350);
}

function renderList(): void {
  const list = el('file-list');
  list.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('li');
    row.className = 'file-row';

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = item.showingAfter && item.resultUrl ? item.resultUrl : item.thumb;
    thumb.alt = '';

    const thumbWrap = document.createElement('span');
    thumbWrap.className = 'thumb-wrap';
    thumbWrap.appendChild(thumb);
    if (item.resultUrl) {
      const badge = document.createElement('span');
      badge.className = 'compare-badge';
      badge.textContent = item.showingAfter ? 'After' : 'Before';
      thumbWrap.appendChild(badge);
    }

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.file.name;
    name.title = item.file.name;

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    if (item.resultData) {
      const s = savings(item.file.size, item.resultData.length);
      const pct = s.percent >= 0 ? `saved ${s.percent}%` : `grew ${Math.abs(s.percent)}%`;
      const dimNote =
        item.resultWidth && item.resultHeight &&
        (item.resultWidth !== item.img.naturalWidth || item.resultHeight !== item.img.naturalHeight)
          ? ` · ${item.resultWidth}×${item.resultHeight}`
          : '';
      meta.textContent = `${item.img.naturalWidth}×${item.img.naturalHeight}${dimNote} · ${formatBytes(item.file.size)} → ${formatBytes(item.resultData.length)} · ${pct}`;
      if (item.resultNote) {
        const note = document.createElement('span');
        note.className = 'hint';
        note.textContent = item.resultNote;
        meta.appendChild(document.createElement('br'));
        meta.appendChild(note);
      }
    } else {
      meta.textContent = `${item.img.naturalWidth}×${item.img.naturalHeight} · ${formatBytes(item.file.size)}`;
    }

    const actions = document.createElement('span');
    actions.className = 'file-actions';
    if (item.resultUrl) {
      const cmp = document.createElement('button');
      cmp.type = 'button';
      cmp.className = 'icon-btn compare-btn';
      cmp.title = 'Toggle before/after preview';
      cmp.setAttribute('aria-label', `Toggle before and after preview for ${item.file.name}`);
      cmp.setAttribute('aria-pressed', String(item.showingAfter));
      cmp.textContent = item.showingAfter ? 'After' : 'Before';
      cmp.addEventListener('click', () => {
        item.showingAfter = !item.showingAfter;
        renderList();
      });
      actions.appendChild(cmp);
    }
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
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      items.splice(idx, 1);
      refreshJpegUi();
      renderList();
    });
    actions.appendChild(rm);

    row.append(thumbWrap, name, meta, actions);
    list.appendChild(row);
  });
  el('empty-state').hidden = items.length > 0;
  el<HTMLButtonElement>('compress-btn').disabled = items.length === 0;
  refreshJpegUi();
  refreshResizeHint();
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
  qualityRange.addEventListener('input', () => {
    syncQualityLabel();
    scheduleLivePreview();
  });
  syncQualityLabel();
  bindSetting('image-compressor', 'quality', qualityRange, '80');

  document.querySelectorAll('input[name="out-format"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      refreshJpegUi();
      scheduleLivePreview();
    });
  });
  document.getElementById('fill-white')?.addEventListener('change', scheduleLivePreview);
  document.querySelectorAll('input[name="cmode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      refreshModeUi();
      scheduleLivePreview();
    });
  });
  refreshModeUi();

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
  bindRadioSetting('image-compressor', 'resize-mode', 'resize-mode');
  bindSetting('image-compressor', 'resize-width', el<HTMLInputElement>('custom-width'), '');

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
          resultUrl: null,
          showingAfter: false,
          resultNote: null,
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
    scheduleLivePreview();
  };

  setupDropzone('dropzone', 'file-input', handleFiles);

  // Paste screenshots directly (Squoosh-style).
  setupPasteHandler(handleFiles, (f) => f.type.startsWith('image/'));

  el('compress-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('download-all-btn').hidden = true;
    setBusy('compress-btn', true, 'Compressing…');
    try {
      const choice = selectedChoice();
      const useTarget = targetMode();
      const q = qualitySlider();
      const target = targetBytes();
      const fillWhite = el<HTMLInputElement>('fill-white').checked;
      const resizeChoice = readResize();
      for (const item of items) {
        // Yield so the busy state paints and the tab stays responsive.
        await new Promise((r) => setTimeout(r, 0));
        const settings = resolveCompressorSettings(item.kind, choice, q);
        const fill = settings.mime === 'image/jpeg' && fillWhite ? '#ffffff' : null;
        const dims = computeResizeDims(item.img.naturalWidth, item.img.naturalHeight, resizeChoice.mode, resizeChoice.customWidth);
        const canvas = drawResized(item.img, dims, fill);
        let data: Uint8Array;
        let noteQuality: number | null = null;
        let missed = false;
        if (useTarget && settings.qualityApplies) {
          const r = await compressToTarget(canvas, settings.mime, target);
          data = r.data;
          noteQuality = r.quality;
          missed = !r.hit;
        } else {
          data = await canvasToImageBytes(canvas, settings.mime, settings.quality01);
        }
        item.resultName = outputFileName(item.file.name, '-compressed', settings.outputFormat);
        item.resultData = data;
        item.resultMime = settings.mime;
        item.resultWidth = canvas.width;
        item.resultHeight = canvas.height;
        item.resultNote = missed
          ? `Could not reach ${formatBytes(target)} even at the lowest quality.`
          : noteQuality !== null
            ? `Quality ${noteQuality} hit the ${formatBytes(target)} target.`
            : null;
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.resultUrl = URL.createObjectURL(new Blob([data as BlobPart], { type: settings.mime }));
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
