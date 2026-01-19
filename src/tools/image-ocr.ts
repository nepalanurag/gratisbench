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
 * Preprocess the picked image for OCR: optionally upscale small images
 * (tesseract likes text at roughly 300 DPI) and stretch contrast on a
 * grayscale copy. Returns a canvas tesseract can read directly.
 */
async function preprocessImage(src: string, opts: OcrOptions): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
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
  ctx.drawImage(img, 0, 0, w, h);
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
    showError('error-box', 'Please choose an image file (PNG, JPG, or WebP).');
    return;
  }
  hideError('error-box');
  file = picked;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(picked);
  el<HTMLImageElement>('preview-img').src = objectUrl;
  el('preview-block').hidden = false;
  el('file-meta').textContent = `${picked.name} · ${formatBytes(picked.size)}`;
  el<HTMLButtonElement>('recognize-btn').disabled = false;
}

async function onRecognize(): Promise<void> {
  if (busy || !file || !objectUrl) return;
  busy = true;
  hideError('error-box');
  setBusy('recognize-btn', true, 'Reading…');
  setProgress(2, 'Loading the OCR engine…');
  const currentFile = file;
  const currentUrl = objectUrl;
  try {
    const opts = readOptions();
    const w = await getWorker(opts.lang, setProgress);
    setProgress(60, 'Preparing the image…');
    const canvas = await preprocessImage(currentUrl, opts);
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
        : `${words} words, ${chars} characters recognized.`;
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
  el('recognize-btn').addEventListener('click', () => void onRecognize());
  el('copy-btn').addEventListener('click', () => void onCopy());
  el('download-btn').addEventListener('click', () => {
    if (!file) return;
    downloadText(ocrOutputFileName(file.name), el<HTMLTextAreaElement>('ocr-output').value, 'text/plain');
  });
}
