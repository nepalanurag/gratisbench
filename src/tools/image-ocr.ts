// Image OCR tool: DOM glue. Pure logic lives in ../lib/ocr-core.ts;
// tesseract.js is lazy-loaded from ./tesseract-loader.ts only after the
// user picks an image. Preprocessing (upscale + grayscale/contrast) runs on
// a canvas before recognition; tesseract wants roughly 300-DPI text.
//
// Region selection: the user can draw as many boxes as they like on the
// preview. Each region is OCR'd separately and the results are grouped
// under "Region 1:", "Region 2:", etc. No boxes means the whole image.
// Sync: 2026-10-08 - ensuring multi-region code is deployed.
import {
  OCR_LANGUAGES,
  validateOcrOptions,
  cleanupOcrText,
  ocrOutputFileName,
  ocrProgressLabel,
  ocrErrorMessage,
  type OcrOptions,
} from '../lib/ocr-core.ts';
import { loadTesseract, tesseractLoadErrorMessage, tesseractWorkerOptions } from './tesseract-loader.ts';
import {
  el,
  formatBytes,
  downloadText,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  setupPasteHandler,
  loadImage,
} from './common.ts';

type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>;
  reinitialize: (langs: string) => Promise<void>;
  terminate: () => Promise<void>;
};

/** One user-drawn region, in natural (unscaled) image pixels. */
interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
}

let file: File | null = null;
let objectUrl: string | null = null;
let worker: OcrWorker | null = null;
let workerLang: string | null = null;
let busy = false;
/** Drawn regions; empty means "read the whole image". */
let zones: Zone[] = [];
let nextZoneId = 1;

/** Distinct box colors, cycled per region. */
const ZONE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];

function readOptions(): OcrOptions {
  return validateOcrOptions({
    lang: el<HTMLSelectElement>('lang-select').value,
    upscaleSmall: el<HTMLInputElement>('opt-upscale').checked,
    enhanceContrast: el<HTMLInputElement>('opt-contrast').checked,
    lightCleanup: el<HTMLInputElement>('opt-cleanup').checked,
  });
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

/**
 * Preprocess the picked image for OCR: optionally crop to a region,
 * optionally upscale small images (tesseract likes text at roughly 300 DPI)
 * and stretch contrast on a grayscale copy. Returns a canvas tesseract can
 * read directly. `crop` is in natural image pixels.
 */
async function preprocessImage(
  src: string,
  opts: OcrOptions,
  crop?: { x: number; y: number; w: number; h: number },
): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const sx = crop ? Math.max(0, Math.min(img.naturalWidth - 1, Math.round(crop.x))) : 0;
  const sy = crop ? Math.max(0, Math.min(img.naturalHeight - 1, Math.round(crop.y))) : 0;
  const sw = crop
    ? Math.max(1, Math.min(img.naturalWidth - sx, Math.round(crop.w)))
    : img.naturalWidth;
  const sh = crop
    ? Math.max(1, Math.min(img.naturalHeight - sy, Math.round(crop.h)))
    : img.naturalHeight;
  let w = sw;
  let h = sh;
  if (opts.upscaleSmall) {
    const longEdge = Math.max(w, h);
    if (longEdge < 2000) {
      const k = Math.min(3, 2000 / longEdge);
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  if (opts.enhanceContrast) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const lum = new Float32Array(w * h);
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < lum.length; i++) {
      const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      lum[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo;
    if (span > 1) {
      for (let i = 0; i < lum.length; i++) {
        const v = Math.round(((lum[i] - lo) / span) * 255);
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }
  return canvas;
}

/** Re-render all region boxes as numbered, color-coded overlays. */
function renderZones(): void {
  const boxes = document.getElementById('zone-boxes');
  if (!boxes) return;
  boxes.innerHTML = '';
  zones.forEach((z, i) => {
    const color = ZONE_COLORS[i % ZONE_COLORS.length];
    const img = document.getElementById('preview-img') as HTMLImageElement | null;
    const nw = img?.naturalWidth || 1;
    const nh = img?.naturalHeight || 1;
    const div = document.createElement('div');
    div.className = 'zone-box';
    div.dataset.zoneId = String(z.id);
    div.style.left = `${(z.x / nw) * 100}%`;
    div.style.top = `${(z.y / nh) * 100}%`;
    div.style.width = `${(z.w / nw) * 100}%`;
    div.style.height = `${(z.h / nh) * 100}%`;
    div.style.borderColor = color;
    div.style.backgroundColor = `${color}1a`;
    div.title = `Region ${i + 1} — click to remove`;
    const label = document.createElement('span');
    label.className = 'zone-label';
    label.style.backgroundColor = color;
    label.textContent = String(i + 1);
    div.appendChild(label);
    boxes.appendChild(div);
  });
  const clearBtn = document.getElementById('zone-clear');
  if (clearBtn) clearBtn.hidden = zones.length === 0;
  const hint = document.getElementById('zone-hint');
  if (hint) {
    hint.textContent =
      zones.length === 0
        ? 'Tip: drag boxes on the image to read only those parts — draw as many regions as you like; each is read separately. Click a box to remove it.'
        : `${zones.length} region${zones.length === 1 ? '' : 's'} selected — each will be read separately. Click a box to remove it, or clear all below.`;
  }
}

/** Remove every region. */
function clearZones(): void {
  zones = [];
  renderZones();
}

/**
 * Drag-to-select on the preview: every drag draws a NEW box (old boxes are
 * kept). Clicking an existing box removes it.
 */
function setupZoneSelect(): void {
  const wrap = document.getElementById('zone-wrap');
  const img = document.getElementById('preview-img') as HTMLImageElement | null;
  if (!wrap || !img) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let ghost: HTMLDivElement | null = null;

  const toFractions = (clientX: number, clientY: number) => {
    const rect = img.getBoundingClientRect();
    return {
      fx: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
      fy: rect.height > 0 ? (clientY - rect.top) / rect.height : 0,
    };
  };

  const paintGhost = (x0: number, clientX: number, y0: number, clientY: number) => {
    const { fx: fx0, fy: fy0 } = toFractions(x0, y0);
    const { fx: fx1, fy: fy1 } = toFractions(clientX, clientY);
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'zone-ghost';
      wrap.appendChild(ghost);
    }
    ghost.style.left = `${Math.min(fx0, fx1) * 100}%`;
    ghost.style.top = `${Math.min(fy0, fy1) * 100}%`;
    ghost.style.width = `${Math.abs(fx1 - fx0) * 100}%`;
    ghost.style.height = `${Math.abs(fy1 - fy0) * 100}%`;
  };

  const dropGhost = () => {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (busy || !file) return;
    const boxEl = (e.target as HTMLElement).closest?.('.zone-box') as HTMLElement | null;
    // Clicking an existing box removes it (handled on pointerup as a click).
    if (boxEl && !dragging) {
      (wrap as HTMLElement).dataset.clickTarget = boxEl.dataset.zoneId || '';
    }
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* not critical */
    }
    e.preventDefault();
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    paintGhost(startX, e.clientX, startY, e.clientY);
  });

  const finishDrag = (e: PointerEvent, cancelled: boolean) => {
    if (!dragging) return;
    dragging = false;
    dropGhost();
    if (cancelled) return;
    const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (moved < 8) {
      // A click, not a drag: remove the box that was clicked, if any.
      const zoneId = (wrap as HTMLElement).dataset.clickTarget;
      delete (wrap as HTMLElement).dataset.clickTarget;
      if (zoneId) {
        zones = zones.filter((z) => String(z.id) !== zoneId);
        renderZones();
      }
      return;
    }
    delete (wrap as HTMLElement).dataset.clickTarget;
    const { fx: fx0, fy: fy0 } = toFractions(startX, startY);
    const { fx: fx1, fy: fy1 } = toFractions(e.clientX, e.clientY);
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const x = Math.round(Math.min(fx0, fx1) * nw);
    const y = Math.round(Math.min(fy0, fy1) * nh);
    const w = Math.round(Math.abs(fx1 - fx0) * nw);
    const h = Math.round(Math.abs(fy1 - fy0) * nh);
    if (w < 12 || h < 12) return; // Too small to be deliberate.
    zones.push({ x, y, w, h, id: nextZoneId++ });
    renderZones();
  };

  wrap.addEventListener('pointerup', (e) => finishDrag(e, false));
  wrap.addEventListener('pointercancel', (e) => finishDrag(e, true));
}

async function getWorker(lang: string, onProgress: (percent: number, label: string) => void): Promise<OcrWorker> {
  if (worker && workerLang === lang) return worker;
  const { createWorker } = await loadTesseract();
  if (worker && workerLang !== lang) {
    // Switching languages reuses the same worker when possible.
    setProgress(30, 'Switching language…');
    await worker.reinitialize(lang);
    workerLang = lang;
    return worker;
  }
  // Minification-proof marker for this tool's bundled chunk: the property
  // name `createWorker` survives esbuild minification.
  const w = (await createWorker(lang, 1, {
    ...tesseractWorkerOptions(lang),
    logger: (m: { status: string; progress: number }) => {
      const { percent, label } = ocrProgressLabel(m);
      onProgress(percent, label);
    },
  })) as unknown as OcrWorker;
  worker = w;
  workerLang = lang;
  return w;
}

export async function preloadImageOcr(): Promise<void> {
  await getWorker('eng', () => {});
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
  // Clear any previous result so a stale transcription can't be confused with the new image.
  el('result-block').hidden = true;
  el<HTMLTextAreaElement>('ocr-output').value = '';
  clearZones();
  nextZoneId = 1;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(picked);
  el<HTMLImageElement>('preview-img').src = objectUrl;
  el('preview-block').hidden = false;
  el('file-meta').textContent = `${picked.name} · ${formatBytes(picked.size)}`;
  el<HTMLButtonElement>('recognize-btn').disabled = false;
}

/** Read one image canvas and return cleaned text. */
async function recognizeCanvas(w: OcrWorker, canvas: HTMLCanvasElement, opts: OcrOptions): Promise<string> {
  const { data } = await w.recognize(canvas);
  return opts.lightCleanup ? cleanupOcrText(data.text) : data.text.trim();
}

function showResult(text: string, bodyForCounts: string): void {
  el<HTMLTextAreaElement>('ocr-output').value = text;
  el('result-block').hidden = false;
  const chars = bodyForCounts.length;
  const words = bodyForCounts.split(/\s+/).filter(Boolean).length;
  el('result-info').textContent =
    chars === 0
      ? 'No text found. Try a sharper, higher-contrast image.'
      : `${words} words, ${chars} characters recognized.`;
  el<HTMLButtonElement>('copy-btn').disabled = chars === 0;
  el<HTMLButtonElement>('download-btn').disabled = chars === 0;
  setProgress(100, 'Done.');
}

async function onRecognize(): Promise<void> {
  if (busy || !file || !objectUrl) return;
  busy = true;
  hideError('error-box');
  setBusy('recognize-btn', true, 'Reading…');
  setProgress(2, 'Loading the OCR engine…');
  const currentUrl = objectUrl;
  const currentZones = zones.slice();
  try {
    const opts = readOptions();
    const w = await getWorker(opts.lang, setProgress);
    if (currentZones.length === 0) {
      // Whole image, as before.
      setProgress(60, 'Preparing the image…');
      const canvas = await preprocessImage(currentUrl, opts);
      setProgress(62, 'Reading the text…');
      const text = await recognizeCanvas(w, canvas, opts);
      showResult(text, text);
    } else {
      // One region at a time; results grouped under numbered headings.
      const bodies: string[] = [];
      for (let i = 0; i < currentZones.length; i++) {
        const z = currentZones[i];
        setProgress(
          60 + Math.round((i / currentZones.length) * 30),
          `Reading region ${i + 1} of ${currentZones.length}…`,
        );
        const canvas = await preprocessImage(currentUrl, opts, z);
        bodies.push(await recognizeCanvas(w, canvas, opts));
      }
      const display = bodies.map((b, i) => `Region ${i + 1}:\n${b}`).join('\n\n');
      showResult(display, bodies.join('\n\n'));
    }
  } catch (err) {
    showError('error-box', ocrErrorMessage(err));
  } finally {
    busy = false;
    clearProgress();
    setBusy('recognize-btn', false);
  }
}

async function onCopy(): Promise<void> {
  const area = el<HTMLTextAreaElement>('ocr-output');
  const text = area.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    area.select();
    document.execCommand('copy');
  }
  const btn = el<HTMLButtonElement>('copy-btn');
  const original = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

export function initImageOcr(): void {
  const select = el<HTMLSelectElement>('lang-select');
  for (const l of OCR_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.label;
    select.appendChild(opt);
  }
  setupDropzone('dropzone', 'file-input', (files) => void onFiles(files));
  setupPasteHandler((files) => void onFiles(files), (f) => f.type.startsWith('image/'));
  setupZoneSelect();
  const clearBtn = document.getElementById('zone-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (!busy) clearZones();
  });
  el('recognize-btn').addEventListener('click', () => void onRecognize());
  el('copy-btn').addEventListener('click', () => void onCopy());
  el('download-btn').addEventListener('click', () => {
    if (!file) return;
    downloadText(ocrOutputFileName(file.name), el<HTMLTextAreaElement>('ocr-output').value, 'text/plain');
  });
}
