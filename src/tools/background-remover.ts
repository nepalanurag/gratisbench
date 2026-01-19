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
  loadImage,
} from './common.ts';

let file: File | null = null;
let objectUrl: string | null = null;
/** Raw transparent cut-out from the engine; kept so the background choice can be re-rendered. */
let cutoutBlob: Blob | null = null;
/** Currently displayed (possibly composited) result, for download. */
let resultBlob: Blob | null = null;
let resultUrl: string | null = null;
let busy = false;

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

/** Render the cached cut-out with the current background choice. */
async function renderResult(): Promise<void> {
  if (!cutoutBlob || !file) return;
  const choice = selectedChoice();
  const fill = bgFillColor(choice);
  revokeResult();
  resultBlob = fill ? await compositeOverFill(cutoutBlob, fill) : cutoutBlob;
  resultUrl = URL.createObjectURL(resultBlob);
  const resImg = el<HTMLImageElement>('result-preview');
  resImg.src = resultUrl;
  resImg.classList.toggle('checker', !fill);
  el('result-info').textContent =
    `${bgOutputFileName(file.name)} · ${formatBytes(resultBlob.size)} · ` +
    (fill ? `on ${choice} background` : 'transparent PNG');
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
  revokeResult();
  cutoutBlob = null;
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
  el('remove-btn').addEventListener('click', () => void onRemove());
  el('view-original-btn').addEventListener('click', () => showPreview('original'));
  el('view-result-btn').addEventListener('click', () => {
    if (resultUrl) showPreview('result');
  });
  document.querySelectorAll('input[name="bg-choice"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (cutoutBlob && !busy) {
        void renderResult().catch((err) => showError('error-box', bgRemoveErrorMessage(err)));
      }
    });
  });
  el('download-btn').addEventListener('click', () => {
    if (resultBlob && file) {
      const blob = resultBlob;
      const name = bgOutputFileName(file.name);
      void blob.arrayBuffer().then((buf) => downloadBytes(name, new Uint8Array(buf), 'image/png'));
    }
  });
}
