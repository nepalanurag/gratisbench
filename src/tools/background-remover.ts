// Background remover tool: DOM glue. Pure logic lives in
// ../lib/bgremove-core.ts; the @imgly/background-removal engine is
// lazy-loaded from ./bgremove-loader.ts only after the user picks an image.
import {
  validateBgChoice,
  bgFillColor,
  bgOutputFileName,
  bgProgressLabel,
  bgStageFromProgressKey,
  bgRemoveErrorMessage,
  type BgChoice,
} from '../lib/bgremove-core.ts';
import { loadBackgroundRemoval, bgEngineLoadErrorMessage } from './bgremove-loader.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  setupPasteHandler,
  loadImage,
} from './common.ts';

/** Longest edge of the working mask canvas (px). Keeps brush/edge ops fast. */
const MASK_MAX = 1200;

let file: File | null = null;
let objectUrl: string | null = null;
/** Object URL for the loaded original image (revoked when a new file is picked). */
let originalUrl: string | null = null;
/** Raw transparent cut-out from the engine; kept so the background choice can be re-rendered. */
let cutoutBlob: Blob | null = null;
/** Cut-out after mask touch-ups; recomputed only when the mask settings change. */
let refinedBlob: Blob | null = null;
/** Currently displayed (possibly composited) result, for download. */
let resultBlob: Blob | null = null;
let resultUrl: string | null = null;
let busy = false;

/* ---- Mask touch-up state ---- */
/** Original image at natural resolution; the edited mask is applied to this,
 *  never to the AI cut-out, so "Restore" painting can genuinely bring back
 *  pixels the AI deleted (they are gone from the cut-out's alpha). */
let originalImg: HTMLImageElement | null = null;
/** Grayscale working mask (white = keep, black = remove): AI alpha + user strokes. */
let baseMask: HTMLCanvasElement | null = null;
/** Shrink (-5) / grow (+5) applied to the base mask, in mask pixels. */
let edgeDelta = 0;
type BrushMode = 'restore' | 'remove';
let brushMode: BrushMode = 'restore';
let brushSize = 48;
let editorOpen = false;
let painting = false;
let lastPt: { x: number; y: number } | null = null;
let rebuildTimer: number | null = null;

function selectedChoice(): BgChoice {
  const checked = document.querySelector('input[name="bg-choice"]:checked') as HTMLInputElement | null;
  return validateBgChoice(checked?.value);
}

/** Show one preview image at a time (before/after toggle). */
function showPreview(which: 'original' | 'result'): void {
  el('original-preview').hidden = which !== 'original';
  el('result-preview').hidden = which !== 'result';
  el<HTMLButtonElement>('view-original-btn').classList.toggle('active', which === 'original');
  el<HTMLButtonElement>('view-result-btn').classList.toggle('active', which === 'result');
}

function setProgress(percent: number, label: string): void {
  el('progress-wrap').hidden = false;
  el('progress-bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  el('progress-label').textContent = label;
}

function clearProgress(): void {
  el('progress-wrap').hidden = true;
  el('progress-bar').style.width = '0%';
  el('progress-label').textContent = '';
}

function revokeResult(): void {
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  resultBlob = null;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the result image.'))), 'image/png');
  });
}

/** Composite the transparent cut-out over a solid fill; returns PNG bytes. */
async function compositeOverFill(cutout: Blob, fill: string): Promise<Blob> {
  const url = URL.createObjectURL(cutout);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create a drawing surface.');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvasToPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render the cached (possibly refined) cut-out with the current background choice. */
async function renderResult(): Promise<void> {
  const cutout = refinedBlob ?? cutoutBlob;
  if (!cutout || !file) return;
  const choice = selectedChoice();
  const fill = bgFillColor(choice);
  revokeResult();
  resultBlob = fill ? await compositeOverFill(cutout, fill) : cutout;
  resultUrl = URL.createObjectURL(resultBlob);
  const resImg = el<HTMLImageElement>('result-preview');
  resImg.src = resultUrl;
  resImg.classList.toggle('checker', !fill);
  el('result-info').textContent =
    `${bgOutputFileName(file.name)} · ${formatBytes(resultBlob.size)} · ` +
    (fill ? `on ${choice} background` : 'transparent PNG');
}

/* ---------------- Mask helpers ---------------- */

/** Fit natural dimensions into MASK_MAX on the long edge. */
function maskDims(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MASK_MAX / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Extract the AI cut-out's alpha channel into a grayscale working mask. */
function maskHasTransparency(mask: HTMLCanvasElement): boolean {
  const ctx = mask.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
  // Sample every 16th pixel; if none are significantly transparent, the AI
  // did not remove anything.
  for (let i = 0; i < data.length; i += 64) {
    if (data[i] < 128) return true;
  }
  return false;
}

async function extractMask(cutout: Blob, imgW: number, imgH: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(cutout);
  try {
    const img = await loadImage(url);
    const { w, h } = maskDims(imgW, imgH);
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d');
    if (!sctx) throw new Error('Your browser could not create a drawing surface.');
    sctx.drawImage(img, 0, 0, w, h);
    const data = sctx.getImageData(0, 0, w, h);
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext('2d');
    if (!mctx) throw new Error('Your browser could not create a drawing surface.');
    const out = mctx.createImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      const a = data.data[i + 3];
      out.data[i] = a;
      out.data[i + 1] = a;
      out.data[i + 2] = a;
      out.data[i + 3] = 255;
    }
    mctx.putImageData(out, 0, 0);
    return mask;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Approximate a morphological shrink/grow on a grayscale mask by repeatedly
 * drawing it shifted 1px in the 8 neighbor directions: 'darken' takes the
 * local minimum (erode/shrink), 'lighten' the local maximum (dilate/grow).
 */
function adjustEdges(base: HTMLCanvasElement, delta: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d');
  if (!ctx) return base;
  ctx.drawImage(base, 0, 0);
  const mode = delta > 0 ? 'lighten' : 'darken';
  const steps = Math.min(5, Math.abs(Math.round(delta)));
  for (let s = 0; s < steps; s++) {
    ctx.globalCompositeOperation = mode;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        ctx.drawImage(out, dx, dy);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Rebuild the cut-out from the ORIGINAL image and the edited mask.
 * This is what makes "Restore" work: the AI cut-out has already lost the
 * wrongly-removed pixels, but the original still has them.
 */
async function rebuildFromMask(): Promise<void> {
  if (!originalImg || !baseMask || !file) return;
  const adjusted = edgeDelta !== 0 ? adjustEdges(baseMask, edgeDelta) : baseMask;
  const canvas = document.createElement('canvas');
  canvas.width = originalImg.naturalWidth;
  canvas.height = originalImg.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(originalImg, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(adjusted, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  refinedBlob = await canvasToPng(canvas);
  if (editorOpen) paintEditorPreview(canvas);
  await renderResult();
}

function scheduleRebuild(): void {
  if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = null;
    void rebuildFromMask().catch((err) => showError('error-box', bgRemoveErrorMessage(err)));
  }, 160);
}

/* ---------------- Touch-up editor ---------------- */

function maskCoords(e: PointerEvent): { x: number; y: number } | null {
  if (!baseMask) return null;
  const canvas = el<HTMLCanvasElement>('mask-editor');
  const rect = canvas.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width;
  const fy = (e.clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { x: fx * baseMask.width, y: fy * baseMask.height };
}

function paintStamp(x: number, y: number): void {
  if (!baseMask) return;
  const ctx = baseMask.getContext('2d');
  if (!ctx) return;
  const r = brushSize / 2;
  const c = brushMode === 'restore' ? '255,255,255' : '0,0,0';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${c},1)`);
  g.addColorStop(0.7, `rgba(${c},0.85)`);
  g.addColorStop(1, `rgba(${c},0)`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintStroke(to: { x: number; y: number }): void {
  const from = lastPt ?? to;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(brushSize / 4, 2);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    paintStamp(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  lastPt = to;
  scheduleRebuild();
}

/** Draw the rebuilt full-res canvas into the editor preview canvas. */
function paintEditorPreview(full: HTMLCanvasElement): void {
  const canvas = el<HTMLCanvasElement>('mask-editor');
  const { w, h } = maskDims(full.width, full.height);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Checkerboard underlay for transparency, then the current result.
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d8d2c4';
  const sq = Math.max(8, Math.round(w / 40));
  for (let y = 0; y < h; y += sq) {
    for (let x = 0; x < w; x += sq) {
      if (((x / sq) | 0) % 2 === ((y / sq) | 0) % 2) ctx.fillRect(x, y, sq, sq);
    }
  }
  ctx.drawImage(full, 0, 0, w, h);
}

function positionCursor(e: PointerEvent): void {
  const canvas = el<HTMLCanvasElement>('mask-editor');
  const cursor = el('brush-cursor');
  const rect = canvas.getBoundingClientRect();
  const wrapRect = el('mask-editor-wrap').getBoundingClientRect();
  const dia = (brushSize / (baseMask?.width ?? 1)) * rect.width;
  cursor.style.width = `${dia}px`;
  cursor.style.height = `${dia}px`;
  cursor.style.left = `${e.clientX - wrapRect.left - dia / 2}px`;
  cursor.style.top = `${e.clientY - wrapRect.top - dia / 2}px`;
  cursor.classList.toggle('remove', brushMode === 'remove');
}

async function openTouchup(): Promise<void> {
  if (!baseMask || !originalImg || editorOpen) return;
  editorOpen = true;
  el('touchup-panel').hidden = false;
  el<HTMLButtonElement>('touchup-btn').hidden = true;
  // Prime the preview from the current refined result.
  try {
    await rebuildFromMask();
  } catch (err) {
    showError('error-box', bgRemoveErrorMessage(err));
  }
  el('mask-editor-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeTouchup(): void {
  editorOpen = false;
  painting = false;
  lastPt = null;
  el('touchup-panel').hidden = true;
  el<HTMLButtonElement>('touchup-btn').hidden = false;
}

async function resetTouchups(): Promise<void> {
  if (!cutoutBlob || !originalImg || busy) return;
  try {
    baseMask = await extractMask(cutoutBlob, originalImg.naturalWidth, originalImg.naturalHeight);
    edgeDelta = 0;
    el<HTMLInputElement>('edge-delta').value = '0';
    el('edge-val').textContent = '0';
    await rebuildFromMask();
  } catch (err) {
    showError('error-box', bgRemoveErrorMessage(err));
  }
}

function setupTouchup(): void {
  const canvas = el<HTMLCanvasElement>('mask-editor');
  const cursor = el('brush-cursor');

  canvas.addEventListener('pointerdown', (e) => {
    if (!editorOpen || busy || !baseMask) return;
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    const pt = maskCoords(e);
    if (pt) paintStroke(pt);
    positionCursor(e);
    cursor.hidden = false;
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!editorOpen) return;
    // On touch devices there's no hover; only show the cursor while painting.
    if (e.pointerType === 'touch' && !painting) {
      cursor.hidden = true;
      return;
    }
    positionCursor(e);
    cursor.hidden = false;
    if (painting) {
      const pt = maskCoords(e);
      if (pt) paintStroke(pt);
    }
  });
  const stopPaint = () => {
    painting = false;
    lastPt = null;
    cursor.hidden = true;
  };
  canvas.addEventListener('pointerup', stopPaint);
  canvas.addEventListener('pointercancel', stopPaint);
  canvas.addEventListener('pointerleave', () => {
    if (!painting) cursor.hidden = true;
  });
  el('mask-editor-wrap').addEventListener('pointerleave', () => {
    if (!painting) cursor.hidden = true;
  });

  document.querySelectorAll('input[name="brush-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      brushMode = v === 'remove' ? 'remove' : 'restore';
    });
  });

  const sizeInput = el<HTMLInputElement>('brush-size');
  sizeInput.addEventListener('input', () => {
    brushSize = Math.max(8, Math.min(160, Number(sizeInput.value) || 48));
    el('brush-size-val').textContent = `${brushSize}px`;
  });

  const edgeInput = el<HTMLInputElement>('edge-delta');
  edgeInput.addEventListener('input', () => {
    edgeDelta = Math.max(-5, Math.min(5, Number(edgeInput.value) || 0));
    el('edge-val').textContent = `${edgeDelta > 0 ? '+' : ''}${edgeDelta}`;
    scheduleRebuild();
  });

  el('touchup-reset-btn').addEventListener('click', () => void resetTouchups());
  el('touchup-done-btn').addEventListener('click', closeTouchup);
  el('touchup-btn').addEventListener('click', () => void openTouchup());
}

function resetTouchupState(): void {
  closeTouchupSilent();
  originalImg = null;
  baseMask = null;
  refinedBlob = null;
  edgeDelta = 0;
  brushMode = 'restore';
  brushSize = 48;
  if (rebuildTimer !== null) {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
}

function closeTouchupSilent(): void {
  editorOpen = false;
  painting = false;
  lastPt = null;
  const panel = document.getElementById('touchup-panel');
  if (panel) panel.hidden = true;
  const btn = document.getElementById('touchup-btn') as HTMLButtonElement | null;
  if (btn) btn.hidden = true;
}

async function onFiles(files: File[]): Promise<void> {
  if (busy) return;
  const picked = files.find((f) => f.type.startsWith('image/'));
  if (!picked) {
    showError('error-box', 'That is not an image file. PNG, JPG, or WebP only.');
    return;
  }
  hideError('error-box');
  file = picked;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = null;
  revokeResult();
  cutoutBlob = null;
  resetTouchupState();
  objectUrl = URL.createObjectURL(picked);
  el<HTMLImageElement>('original-preview').src = objectUrl;
  el('preview-block').hidden = false;
  el('result-block').hidden = true;
  el('file-meta').textContent = `${picked.name} · ${formatBytes(picked.size)}`;
  el<HTMLButtonElement>('view-result-btn').disabled = true;
  el<HTMLButtonElement>('remove-btn').disabled = false;
  showPreview('original');
}

async function onRemove(): Promise<void> {
  if (busy || !file) return;
  busy = true;
  hideError('error-box');
  setBusy('remove-btn', true, 'Removing…');
  setProgress(2, 'Loading the background-removal engine…');
  const currentFile = file;
  try {
    const { removeBackground } = await loadBackgroundRemoval();
    // Minification-proof marker for this tool's bundled chunk: the property
    // name `removeBackground` survives esbuild minification.
    setProgress(5, 'Preparing the AI model…');
    cutoutBlob = await removeBackground(currentFile, {
      model: 'isnet', // Full-precision IS-Net: best quality for real photos.
      output: { format: 'image/png', quality: 1 },
      progress: (key: string, current: number, total: number) => {
        if (bgStageFromProgressKey(key) === 'loading-model') {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress(Math.round(5 + pct * 0.6), bgProgressLabel(key, current, total));
        } else {
          setProgress(70, bgProgressLabel(key, current, total));
        }
      },
    });
    setProgress(85, 'Preparing touch-up tools…');
    // Keep the original image so the edited mask can be applied to it later.
    originalUrl = URL.createObjectURL(currentFile);
    originalImg = await loadImage(originalUrl);
    baseMask = await extractMask(cutoutBlob, originalImg.naturalWidth, originalImg.naturalHeight);
    // Validate that the AI actually removed something. If the mask is all
    // opaque, the engine failed to detect a subject — fail clearly instead
    // of showing the original image with fake transparency padding.
    if (!maskHasTransparency(baseMask)) {
      throw new Error('The AI could not find a subject to keep in this image. Try a photo with a clearer foreground subject.');
    }
    edgeDelta = 0;
    setProgress(92, 'Preparing your download…');
    await rebuildFromMask();
    el('result-block').hidden = false;
    el<HTMLButtonElement>('view-result-btn').disabled = false;
    el<HTMLButtonElement>('touchup-btn').hidden = false;
    showPreview('result');
  } catch (err) {
    const msg = String(err).includes('Could not download the background-removal engine')
      ? bgEngineLoadErrorMessage(err)
      : bgRemoveErrorMessage(err);
    showError('error-box', msg);
  } finally {
    busy = false;
    clearProgress();
    setBusy('remove-btn', false);
  }
}

export function initBackgroundRemover(): void {
  setupDropzone('dropzone', 'file-input', (files) => void onFiles(files));
  setupPasteHandler((files) => void onFiles(files), (f) => f.type.startsWith('image/'));
  el('remove-btn').addEventListener('click', () => void onRemove());
  el('view-original-btn').addEventListener('click', () => showPreview('original'));
  el('view-result-btn').addEventListener('click', () => {
    if (resultUrl) showPreview('result');
  });
  document.querySelectorAll('input[name="bg-choice"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if ((refinedBlob ?? cutoutBlob) && !busy) {
        void renderResult().catch((err) => showError('error-box', bgRemoveErrorMessage(err)));
      }
    });
  });
  setupTouchup();
  el('download-btn').addEventListener('click', () => {
    if (resultBlob && file) {
      const blob = resultBlob;
      const name = bgOutputFileName(file.name);
      void blob.arrayBuffer().then((buf) => downloadBytes(name, new Uint8Array(buf), 'image/png'));
    }
  });
}
