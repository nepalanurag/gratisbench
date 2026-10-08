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

/** Extra finishing options read straight from the DOM (not part of TraceOptions). */
function readFinishing(): { colors: number; soften: boolean; dropWhite: boolean } {
  let colors = Math.round(Number(el<HTMLInputElement>('colors-range').value));
  if (!Number.isFinite(colors)) colors = 8;
  colors = Math.max(2, Math.min(16, colors));
  return {
    colors,
    soften: el<HTMLInputElement>('opt-soften').checked,
    dropWhite: el<HTMLInputElement>('opt-dropwhite').checked,
  };
}

function refreshDetailLabel(): void {
  const v = Number(el<HTMLInputElement>('detail-range').value);
  el('detail-val').textContent = String(v);
  el('detail-hint').textContent =
    v <= 3
      ? 'Low: ignores tiny specks and fine texture. Smoothest, simplest paths.'
      : v <= 7
        ? 'Medium: a good balance of detail and clean paths.'
        : 'High: keeps fine detail, but produces more paths and a larger file.';
}

function refreshColorsUi(): void {
  const checked = document.querySelector('input[name="trace-mode"]:checked') as HTMLInputElement | null;
  const isColor = checked?.value !== 'mono';
  el('colors-field').hidden = !isColor;
  const v = Number(el<HTMLInputElement>('colors-range').value);
  el('colors-val').textContent = String(v);
}

/**
 * Remove a solid white background shape from a traced SVG. The heuristic:
 * a path filled pure white whose bounding box covers ~the whole canvas is
 * the backdrop, not the art. Returns the SVG unchanged when no such path
 * exists, so art is never eaten by mistake.
 */
function removeWhiteBackground(svg: string, width: number, height: number): { svg: string; removed: boolean } {
  let removed = false;
  const out = svg.replace(/<path\b[^>]*>/g, (tag) => {
    if (removed) return tag;
    if (!/\bfill="(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))"/i.test(tag)) return tag;
    const d = /\bd="([^"]+)"/.exec(tag)?.[1];
    if (!d) return tag;
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 4) return tag;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if ((maxX - minX) / width > 0.95 && (maxY - minY) / height > 0.95) {
      removed = true;
      return '';
    }
    return tag;
  });
  return { svg: out, removed };
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

async function onTrace(): Promise<void> {
  if (busy || !file || !objectUrl) return;
  busy = true;
  hideError('error-box');
  setBusy('trace-btn', true, 'Tracing…');
  const currentFile = file;
  try {
    const opts = readOptions();
    const finishing = readFinishing();
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
    const imageData = ctx.getImageData(0, 0, width, height);
    // Let the UI paint "Tracing…" before the synchronous trace blocks.
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Minification-proof marker for this tool's bundled chunk: the method
    // name `imagedataToSVG` survives esbuild minification.
    const traceOpts = resolveImageTracerOptions(opts);
    if (opts.mode === 'color') traceOpts.numberofcolors = finishing.colors;
    if (finishing.soften) traceOpts.blurradius = 5;
    const rawSvg: string = tracer.imagedataToSVG(imageData, traceOpts);
    let svg = rawSvg;
    let bgNote = '';
    if (finishing.dropWhite) {
      const r = removeWhiteBackground(rawSvg, width, height);
      if (r.removed) {
        svg = r.svg;
        bgNote = ' · white background removed';
      } else {
        bgNote = ' · no solid white background found to remove';
      }
    }
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
      `${width}×${height} trace resolution${bgNote}`;
  } catch (err) {
    showError('error-box', traceErrorMessage(err));
  } finally {
    busy = false;
    setBusy('trace-btn', false);
  }
}

export function initImageTracer(): void {
  refreshDetailLabel();
  refreshColorsUi();
  el('detail-range').addEventListener('input', refreshDetailLabel);
  el('colors-range').addEventListener('input', refreshColorsUi);
  document.querySelectorAll('input[name="trace-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      refreshColorsUi();
      retraceSoon();
    });
  });

  // Once a trace exists, changing any setting re-traces automatically
  // (debounced), so the preview behaves like a live control.
  let retraceTimer: number | null = null;
  function retraceSoon(): void {
    if (!svgText || busy) return;
    if (retraceTimer) window.clearTimeout(retraceTimer);
    retraceTimer = window.setTimeout(() => void onTrace(), 700);
  }
  el('detail-range').addEventListener('input', retraceSoon);
  el('colors-range').addEventListener('input', retraceSoon);
  el('opt-soften').addEventListener('change', retraceSoon);
  el('opt-dropwhite').addEventListener('change', retraceSoon);
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
