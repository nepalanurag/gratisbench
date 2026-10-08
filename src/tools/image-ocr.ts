// Image OCR tool: DOM glue. Pure logic lives in ../lib/ocr-core.ts;
// tesseract.js is lazy-loaded from ./tesseract-loader.ts only after the
// user picks an image. Preprocessing (upscale + grayscale/contrast) runs on
// a canvas before recognition; tesseract wants roughly 300-DPI text.
import {
  OCR_LANGUAGES,
  validateOcrOptions,
  cleanupOcrText,
  ocrOutputFileName,
  ocrProgressLabel,
  ocrErrorMessage,
  type OcrOptions,
} from '../lib/ocr-core.ts';
import { loadTesseract, tesseractLoadErrorMessage } from './tesseract-loader.ts';
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

let file: File | null = null;
let objectUrl: string | null = null;
let worker: OcrWorker | null = null;
let workerLang: string | null = null;
let busy = false;
/** Loaded source image (unrotated); the preview shows the rotated version. */
let sourceImg: HTMLImageElement | null = null;
/** Clockwise rotation in degrees: 0, 90, 180, or 270. */
let rotation = 0;
/** Selected region in oriented (rotated) image pixels, or null for the whole image. */
let zone: { x: number; y: number; w: number; h: number } | null = null;

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
 * Draw the source image with the current rotation applied. Used both for the
 * on-screen preview and as the base for preprocessing, so what you see is
 * what gets read.
 */
function drawOriented(img: HTMLImageElement, deg: number): HTMLCanvasElement {
  const swap = deg === 90 || deg === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}

/** Refresh the on-screen preview from the source image + rotation. */
function renderPreview(): void {
  if (!sourceImg) return;
  const canvas = drawOriented(sourceImg, rotation);
  el<HTMLImageElement>('preview-img').src = canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Preprocess for OCR: crop to the selected zone (if any), optionally upscale
 * small images (tesseract likes text at roughly 300 DPI) and stretch
 * contrast on a grayscale copy. Returns a canvas tesseract can read directly.
 */
async function preprocessImage(
  img: HTMLImageElement,
  opts: OcrOptions,
  sel: { x: number; y: number; w: number; h: number } | null
): Promise<HTMLCanvasElement> {
  const oriented = drawOriented(img, rotation);
  let sx = 0;
  let sy = 0;
  let sw = oriented.width;
  let sh = oriented.height;
  if (sel) {
    sx = Math.max(0, Math.min(oriented.width - 1, Math.round(sel.x)));
    sy = Math.max(0, Math.min(oriented.height - 1, Math.round(sel.y)));
    sw = Math.max(8, Math.min(oriented.width - sx, Math.round(sel.w)));
    sh = Math.max(8, Math.min(oriented.height - sy, Math.round(sel.h)));
  }
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
  ctx.drawImage(oriented, sx, sy, sw, sh, 0, 0, w, h);
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
    logger: (m: { status: string; progress: number }) => {
      const { percent, label } = ocrProgressLabel(m);
      onProgress(percent, label);
    },
  })) as unknown as OcrWorker;
  worker = w;
  workerLang = lang;
  return w;
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
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(picked);
  try {
    sourceImg = await loadImage(objectUrl);
  } catch {
    showError('error-box', `"${picked.name}" could not be read as an image.`);
    return;
  }
  rotation = 0;
  clearZone();
  renderPreview();
  el('preview-block').hidden = false;
  el('file-meta').textContent = `${picked.name} · ${formatBytes(picked.size)}`;
  el<HTMLButtonElement>('recognize-btn').disabled = false;
}

/** Clear the selected zone, if any. */
function clearZone(): void {
  zone = null;
  el('zone-box').hidden = true;
  el('zone-clear').hidden = true;
}

/** Set up drag-to-select on the preview: the user draws a box, we read only that part. */
function setupZoneSelect(): void {
  const wrap = document.getElementById('zone-wrap');
  const box = document.getElementById('zone-box');
  const img = document.getElementById('preview-img');
  if (!wrap || !box || !img) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  const toImageCoords = (clientX: number, clientY: number) => {
    const rect = (document.getElementById('preview-img') as HTMLImageElement).getBoundingClientRect();
    const oriented = sourceImg ? drawOriented(sourceImg, rotation) : null;
    return {
      fx: (clientX - rect.left) / rect.width,
      fy: (clientY - rect.top) / rect.height,
      ow: oriented?.width ?? 1,
      oh: oriented?.height ?? 1,
    };
  };

  const paintBox = (x0: number, y0: number, x1: number, y1: number) => {
    const rect = (document.getElementById('preview-img') as HTMLImageElement).getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    // The img fills the wrap; express the box in wrap pixels.
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    box.style.left = `${left - (rect.left - wrapRect.left)}px`;
    box.style.top = `${top - (rect.top - wrapRect.top)}px`;
    box.style.width = `${Math.abs(x1 - x0)}px`;
    box.style.height = `${Math.abs(y1 - y0)}px`;
    box.hidden = false;
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (busy || !sourceImg) return;
    dragging = true;
    wrap.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    paintBox(startX, startY, startX, startY);
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    paintBox(startX, startY, e.clientX, e.clientY);
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const { fx: fx0, fy: fy0, ow, oh } = toImageCoords(startX, startY);
    const { fx: fx1, fy: fy1 } = toImageCoords(e.clientX, e.clientY);
    const x = Math.round(Math.min(fx0, fx1) * ow);
    const y = Math.round(Math.min(fy0, fy1) * oh);
    const w = Math.round(Math.abs(fx1 - fx0) * ow);
    const h = Math.round(Math.abs(fy1 - fy0) * oh);
    if (w < 12 || h < 12) {
      // Too small to be deliberate — treat as a click, not a selection.
      clearZone();
      return;
    }
    zone = { x, y, w, h };
    el('zone-clear').hidden = false;
  });
  wrap.addEventListener('pointercancel', () => {
    dragging = false;
    if (!zone) box.hidden = true;
  });
}

async function onRecognize(): Promise<void> {
  if (busy || !file || !sourceImg) return;
  busy = true;
  hideError('error-box');
  setBusy('recognize-btn', true, 'Reading…');
  setProgress(2, 'Loading the OCR engine…');
  const currentImg = sourceImg;
  const currentZone = zone;
  try {
    const opts = readOptions();
    const w = await getWorker(opts.lang, setProgress);
    setProgress(60, 'Preparing the image…');
    const canvas = await preprocessImage(currentImg, opts, currentZone);
    setProgress(62, 'Reading the text…');
    const { data } = await w.recognize(canvas);
    const text = opts.lightCleanup ? cleanupOcrText(data.text) : data.text.trim();
    el<HTMLTextAreaElement>('ocr-output').value = text;
    el('result-block').hidden = false;
    const chars = text.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    el('result-info').textContent =
      chars === 0
        ? 'No text found. Try a sharper, higher-contrast image.'
        : `${words} words, ${chars} characters recognized${currentZone ? ' in the selected area' : ''}.`;
    el<HTMLButtonElement>('copy-btn').disabled = chars === 0;
    el<HTMLButtonElement>('download-btn').disabled = chars === 0;
    setProgress(100, 'Done.');
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
  el('recognize-btn').addEventListener('click', () => void onRecognize());
  el('rotate-btn').addEventListener('click', () => {
    if (busy || !sourceImg) return;
    rotation = (rotation + 90) % 360;
    clearZone();
    renderPreview();
  });
  el('zone-clear').addEventListener('click', clearZone);
  setupZoneSelect();
  el('copy-btn').addEventListener('click', () => void onCopy());
  el('download-btn').addEventListener('click', () => {
    if (!file) return;
    downloadText(ocrOutputFileName(file.name), el<HTMLTextAreaElement>('ocr-output').value, 'text/plain');
  });
}
