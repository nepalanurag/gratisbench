// Image tracer tool: DOM glue. Pure logic lives in ../lib/trace-core.ts;
// imagetracerjs is lazy-loaded from ./trace-loader.ts only after the user
// picks an image. Tracing itself is synchronous pure-JS work on ImageData,
// so the heavy lifting needs no worker and no upload.
import {
  validateTraceOptions,
  resolveImageTracerOptions,
  scaleForTrace,
  traceOutputFileName,
  tracePreviewFileName,
  validateSvg,
  countSvgPaths,
  traceErrorMessage,
  TRACE_DETAIL_DEFAULT,
  type TraceOptions,
} from '../lib/trace-core.ts';
import { loadImageTracer, tracerLoadErrorMessage } from './trace-loader.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  downloadText,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  setupPasteHandler,
  loadImage,
} from './common.ts';

let file: File | null = null;
let objectUrl: string | null = null;
let svgText: string | null = null;
let svgUrl: string | null = null;
let busy = false;

function readOptions(): TraceOptions {
  const checked = document.querySelector('input[name="trace-mode"]:checked') as HTMLInputElement | null;
  return validateTraceOptions({
    mode: checked?.value,
    detail: el<HTMLInputElement>('detail-range').value,
  });
}

function refreshDetailLabel(): void {
  const v = Number(el<HTMLInputElement>('detail-range').value);
  el('detail-val').textContent = String(v);
  el('detail-hint').textContent =
    v <= 3
      ? 'Low: smooth, simple shapes. Best for icons and logos with flat colors.'
      : v <= 7
        ? 'Medium: a good balance of detail and clean paths.'
        : 'High: keeps fine detail, but produces more paths and a larger file.';
}

/** Render the traced SVG to a PNG blob at a preview width. */
async function svgToPng(svg: string, outWidth = 1024): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const scale = outWidth / img.naturalWidth;
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create a drawing surface.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not render the preview image.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function onFiles(files: File[]): Promise<void> {
  if (busy) return;
  const picked = files.find((f) => f.type.startsWith('image/'));
  if (!picked) {
    showError('error-box', 'That is not an image file. PNG or JPG only.');
    return;
  }
  hideError('error-box');
  file = picked;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  if (svgUrl) {
    URL.revokeObjectURL(svgUrl);
    svgUrl = null;
  }
  svgText = null;
  objectUrl = URL.createObjectURL(picked);
  el<HTMLImageElement>('preview-img').src = objectUrl;
  el('preview-block').hidden = false;
  el('result-block').hidden = true;
  el('file-meta').textContent = `${picked.name} · ${formatBytes(picked.size)}`;
  el<HTMLButtonElement>('trace-btn').disabled = false;
}

/**
 * Preprocess image data for photo tracing: apply a 3x3 box blur to reduce
 * noise, then boost contrast slightly. This gives cleaner vector shapes
 * for human subjects and real-world photos instead of speckled blobs.
 */
function preprocessForPhoto(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);

  // 3x3 box blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const i = (ny * width + nx) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2];
            count++;
          }
        }
      }
      const i = (y * width + x) * 4;
      out[i] = r / count;
      out[i + 1] = g / count;
      out[i + 2] = b / count;
      out[i + 3] = src[i + 3];
    }
  }

  // Contrast boost: stretch around midpoint
  const contrast = 1.15;
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, Math.max(0, (out[i] - 128) * contrast + 128));
    out[i + 1] = Math.min(255, Math.max(0, (out[i + 1] - 128) * contrast + 128));
    out[i + 2] = Math.min(255, Math.max(0, (out[i + 2] - 128) * contrast + 128));
  }

  return new ImageData(out, width, height);
}

async function onTrace(): Promise<void> {
  if (busy || !file || !objectUrl) return;
  busy = true;
  hideError('error-box');
  setBusy('trace-btn', true, 'Tracing…');
  const currentFile = file;
  try {
    const opts = readOptions();
    const tracer = await loadImageTracer();
    const img = await loadImage(objectUrl);
    const { width, height } = scaleForTrace(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Your browser could not create a drawing surface.');
    // White background so transparent PNG regions trace as white, not noise.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let imageData = ctx.getImageData(0, 0, width, height);

    // Photo mode preprocessing: reduce noise and boost contrast so human
    // subjects trace as clean shapes instead of speckled blobs.
    if (opts.mode === 'photo') {
      imageData = preprocessForPhoto(imageData);
      ctx.putImageData(imageData, 0, 0);
      imageData = ctx.getImageData(0, 0, width, height);
    }

    // Let the UI paint "Tracing…" before the synchronous trace blocks.
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Minification-proof marker for this tool's bundled chunk: the method
    // name `imagedataToSVG` survives esbuild minification.
    const svg: string = tracer.imagedataToSVG(imageData, resolveImageTracerOptions(opts));
    const check = validateSvg(svg);
    if (!check.ok) throw new Error(check.reason);
    svgText = svg;
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    el<HTMLImageElement>('trace-preview').src = svgUrl;
    el('result-block').hidden = false;
    const paths = countSvgPaths(svg);
    const svgBytes = new TextEncoder().encode(svg).length;
    el('result-info').textContent =
      `${paths} vector paths · SVG ${formatBytes(svgBytes)} (original ${formatBytes(currentFile.size)}) · ` +
      `${width}×${height} trace resolution`;
  } catch (err) {
    showError('error-box', traceErrorMessage(err));
  } finally {
    busy = false;
    setBusy('trace-btn', false);
  }
}

export function initImageTracer(): void {
  refreshDetailLabel();
  el('detail-range').addEventListener('input', refreshDetailLabel);
  setupDropzone('dropzone', 'file-input', (files) => void onFiles(files));
  setupPasteHandler((files) => void onFiles(files), (f) => f.type.startsWith('image/'));
  el('trace-btn').addEventListener('click', () => void onTrace());
  el('download-svg-btn').addEventListener('click', () => {
    if (svgText && file) downloadText(traceOutputFileName(file.name), svgText, 'image/svg+xml');
  });
  el('download-png-btn').addEventListener('click', () => {
    if (svgText && file) {
      const name = tracePreviewFileName(file.name);
      const svg = svgText;
      setBusy('download-png-btn', true, 'Rendering…');
      void svgToPng(svg)
        .then((blob) => blob.arrayBuffer())
        .then((buf) => downloadBytes(name, new Uint8Array(buf), 'image/png'))
        .catch((err: unknown) => showError('error-box', traceErrorMessage(err)))
        .finally(() => setBusy('download-png-btn', false));
    }
  });
}
