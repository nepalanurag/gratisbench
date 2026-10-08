// Background remover tool: DOM glue. Pure logic lives in
// ../lib/bgremove-core.ts; the @imgly/background-removal engine is
// lazy-loaded from ./bgremove-loader.ts only after the user picks an image.
import {
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

/** Background choices incl. the two this tool adds on top of bgremove-core. */
type BgChoiceExt = BgChoice | 'custom' | 'blur';

function selectedChoiceExt(): BgChoiceExt {
  const v = (document.querySelector('input[name="bg-choice"]:checked') as HTMLInputElement | null)?.value;
  return v === 'white' || v === 'black' || v === 'custom' || v === 'blur' ? v : 'transparent';
}

let file: File | null = null;
let objectUrl: string | null = null;
/** Raw transparent cut-out from the engine; kept so the background choice can be re-rendered. */
let cutoutBlob: Blob | null = null;
/** Cut-out after edge touch-up; recomputed only when the touch-up settings change. */
let refinedBlob: Blob | null = null;
let refinedKey = '';
/** Currently displayed (possibly composited) result, for download. */
let resultBlob: Blob | null = null;
let resultUrl: string | null = null;
let busy = false;
/** Guards overlapping re-renders when the user drags a slider. */
let renderSeq = 0;

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
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!out) throw new Error('Could not encode the result image.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Composite the cut-out over the original photo, blurred. The background is
 * drawn tiny and upscaled, which blurs it for free without canvas filters.
 */
async function compositeOverBlur(originalUrl: string, cutout: Blob): Promise<Blob> {
  const cutoutUrl = URL.createObjectURL(cutout);
  try {
    const [bgImg, cutImg] = await Promise.all([loadImage(originalUrl), loadImage(cutoutUrl)]);
    const W = cutImg.naturalWidth;
    const H = cutImg.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create a drawing surface.');
    // Cover-fit the original into a tiny canvas, then upscale: smooth blur.
    const tiny = document.createElement('canvas');
    tiny.width = 48;
    tiny.height = Math.max(1, Math.round((48 * H) / W));
    const tctx = tiny.getContext('2d');
    if (!tctx) throw new Error('Your browser could not create a drawing surface.');
    const scale = Math.max(tiny.width / bgImg.naturalWidth, tiny.height / bgImg.naturalHeight);
    const dw = bgImg.naturalWidth * scale;
    const dh = bgImg.naturalHeight * scale;
    tctx.drawImage(bgImg, (tiny.width - dw) / 2, (tiny.height - dh) / 2, dw, dh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tiny, 0, 0, W, H);
    // Dim slightly so the subject stands out.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cutImg, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!out) throw new Error('Could not encode the result image.');
    return out;
  } finally {
    URL.revokeObjectURL(cutoutUrl);
  }
}

/** Separable box blur of a single-channel float plane, in place. */
function boxBlurPlane(a: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += a[row + Math.min(w - 1, Math.max(0, x + r + 1))] - a[row + Math.min(w - 1, Math.max(0, x - r))];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc / n;
      acc +=
        tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x] -
        tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
    }
  }
}

/**
 * Edge touch-up for the AI cut-out. Works on a downscaled alpha mask (cheap,
 * and the upscaled blur feathers the edge naturally), then applies it with
 * destination-in at full size.
 * - soften (0-3): feather the edge so the subject blends into the background.
 * - tighten: threshold the blurred mask to trim the faint glow AI cut-outs
 *   sometimes leave around hair and edges.
 */
async function refineEdges(cutout: Blob, soften: number, tighten: boolean): Promise<Blob> {
  if (soften <= 0 && !tighten) return cutout;
  const url = URL.createObjectURL(cutout);
  try {
    const img = await loadImage(url);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const k = Math.min(1, 320 / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * k));
    const sh = Math.max(1, Math.round(H * k));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) return cutout;
    sctx.drawImage(img, 0, 0, sw, sh);
    const id = sctx.getImageData(0, 0, sw, sh);
    const d = id.data;
    const alpha = new Float32Array(sw * sh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    const radius = soften > 0 ? soften + 1 : 1;
    boxBlurPlane(alpha, sw, sh, radius);
    for (let i = 0; i < alpha.length; i++) {
      let v = alpha[i];
      if (tighten) v = v >= 128 ? 255 : 0;
      d[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(v)));
    }
    sctx.putImageData(id, 0, 0);
    // Apply the touched-up mask at full size.
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    const fctx = full.getContext('2d');
    if (!fctx) return cutout;
    fctx.drawImage(img, 0, 0);
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d');
    if (!mctx) return cutout;
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(small, 0, 0, W, H);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(mask, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    const out = await new Promise<Blob | null>((resolve) => full.toBlob(resolve, 'image/png'));
    return out ?? cutout;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function edgeSettings(): { soften: number; tighten: boolean; key: string } {
  const soften = Math.max(0, Math.min(3, Number(el<HTMLInputElement>('edge-soften').value) || 0));
  const tighten = el<HTMLInputElement>('edge-tighten').checked;
  return { soften, tighten, key: `${soften}:${tighten ? 1 : 0}` };
}

/** Render the cached cut-out with the current background + edge choices. */
async function renderResult(): Promise<void> {
  if (!cutoutBlob || !file) return;
  const seq = ++renderSeq;
  const choice = selectedChoiceExt();
  const { soften, tighten, key } = edgeSettings();
  if (!refinedBlob || refinedKey !== key) {
    refinedBlob = await refineEdges(cutoutBlob, soften, tighten);
    refinedKey = key;
  }
  if (seq !== renderSeq) return; // a newer render started; drop this one.
  revokeResult();
  let bgLabel: string;
  let checker = false;
  if (choice === 'transparent') {
    resultBlob = refinedBlob;
    bgLabel = 'transparent PNG';
    checker = true;
  } else if (choice === 'blur') {
    if (!objectUrl) throw new Error('The original image is no longer available.');
    resultBlob = await compositeOverBlur(objectUrl, refinedBlob);
    bgLabel = 'blurred-photo background';
  } else {
    const fill = choice === 'custom' ? el<HTMLInputElement>('bg-color').value : bgFillColor(choice);
    if (!fill) throw new Error('Unknown background choice.');
    resultBlob = await compositeOverFill(refinedBlob, fill);
    bgLabel = choice === 'custom' ? `on ${fill} background` : `on ${choice} background`;
  }
  if (seq !== renderSeq) return;
  resultUrl = URL.createObjectURL(resultBlob);
  const resImg = el<HTMLImageElement>('result-preview');
  resImg.src = resultUrl;
  resImg.classList.toggle('checker', checker);
  el('result-info').textContent =
    `${bgOutputFileName(file.name)} · ${formatBytes(resultBlob.size)} · ${bgLabel}`;
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
  revokeResult();
  cutoutBlob = null;
  refinedBlob = null;
  refinedKey = '';
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
    setProgress(92, 'Preparing your download…');
    await renderResult();
    el('result-block').hidden = false;
    el<HTMLButtonElement>('view-result-btn').disabled = false;
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

  const syncColorRow = () => {
    el('custom-color-row').hidden = selectedChoiceExt() !== 'custom';
  };
  const rerender = () => {
    syncColorRow();
    if (cutoutBlob && !busy) {
      void renderResult().catch((err) => showError('error-box', bgRemoveErrorMessage(err)));
    }
  };
  document.querySelectorAll('input[name="bg-choice"]').forEach((radio) => {
    radio.addEventListener('change', rerender);
  });

  // Debounce slider/color drags so we don't re-render on every pixel moved.
  let rerenderTimer: number | null = null;
  const rerenderSoon = () => {
    if (rerenderTimer) window.clearTimeout(rerenderTimer);
    rerenderTimer = window.setTimeout(rerender, 250);
  };
  const softenRange = el<HTMLInputElement>('edge-soften');
  const syncSoftenLabel = () => {
    el('edge-soften-val').textContent = softenRange.value;
  };
  softenRange.addEventListener('input', () => {
    syncSoftenLabel();
    rerenderSoon();
  });
  syncSoftenLabel();
  el('edge-tighten').addEventListener('change', rerender);
  const bgColor = el<HTMLInputElement>('bg-color');
  const syncColorLabel = () => {
    el('bg-color-val').textContent = bgColor.value;
  };
  bgColor.addEventListener('input', () => {
    syncColorLabel();
    rerenderSoon();
  });
  syncColorLabel();

  el('download-btn').addEventListener('click', () => {
    if (resultBlob && file) {
      const blob = resultBlob;
      const name = bgOutputFileName(file.name);
      void blob.arrayBuffer().then((buf) => downloadBytes(name, new Uint8Array(buf), 'image/png'));
    }
  });
}
