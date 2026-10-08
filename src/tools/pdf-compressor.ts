// Compress PDF tool: DOM glue. Image-downsampling logic lives in ../lib/pdf-compress.ts
import {
  compressPdfImages,
  compressToTargetSize,
  COMPRESSION_LEVELS,
  type CompressionLevelName,
  type CompressImagesStats,
  type ImageCodec,
  type RawImage,
} from '../lib/pdf-compress.ts';
import { getPageCount } from '../lib/pdf-core.ts';
import { renderPdfThumb, showPdfPreview, pdfJsLoadErrorMessage } from './pdf-render.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

let fileBytes: Uint8Array | null = null;
let fileName = '';
let originalSize = 0;

/** Canvas-backed JPEG codec: decode with createImageBitmap, encode with toBlob. */
const browserCodec: ImageCodec = {
  async decodeJpeg(bytes: Uint8Array): Promise<RawImage> {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not get a 2D canvas context.');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height, data: data.data };
    } finally {
      bitmap.close();
    }
  },
  async encodeJpeg(img: RawImage, quality: number): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('JPEG encoding failed.');
    return new Uint8Array(await blob.arrayBuffer());
  },
};

function levelName(): CompressionLevelName {
  const checked = document.querySelector<HTMLInputElement>('input[name="level"]:checked');
  const value = checked ? checked.value : 'medium';
  return value in COMPRESSION_LEVELS ? (value as CompressionLevelName) : 'medium';
}

function targetMode(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="cmode"]:checked')?.value === 'target';
}

function wireModeToggle(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="cmode"]').forEach((r) =>
    r.addEventListener('change', () => {
      const target = targetMode();
      el('target-size-field').hidden = !target;
      el('quality-field').hidden = target;
    })
  );
}

/** Quick-pick buttons under the target size box ("Under 2 MB", …). */
function wirePresetChips(): void {
  document.querySelectorAll<HTMLButtonElement>('#target-chips button[data-mb]').forEach((b) =>
    b.addEventListener('click', () => {
      const radio = document.querySelector<HTMLInputElement>('input[name="cmode"][value="target"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      el<HTMLInputElement>('target-mb').value = b.dataset.mb ?? '2';
    })
  );
}

function setProgress(done: number, total: number): void {
  const wrap = el('progress-wrap');
  wrap.hidden = false;
  el('progress-bar').style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '100%';
  el('progress-label').textContent =
    total > 0 ? `Optimizing image ${done} of ${total}…` : 'Reading PDF…';
}

export function initPdfCompressor(): void {
  const compressBtn = el<HTMLButtonElement>('compress-btn');
  wireModeToggle();
  wirePresetChips();

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      fileBytes = null;
      compressBtn.disabled = true;
      showError('error-box', `"${file.name}" is not a PDF.`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pages = await getPageCount(bytes);
      fileBytes = bytes;
      fileName = file.name;
      originalSize = file.size;
      el('file-info').textContent = `${file.name} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      const thumb = await renderPdfThumb(bytes);
      if (thumb) {
        const info = el('file-info');
        info.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = thumb;
        img.alt = `First page of ${file.name}`;
        const span = document.createElement('span');
        span.textContent = `${file.name} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
        info.append(img, span);
        info.className = 'info-row';
      }
      compressBtn.disabled = false;
    } catch (err) {
      fileBytes = null;
      compressBtn.disabled = true;
      showError('error-box', `"${file.name}": ${pdfJsLoadErrorMessage(err)}`);
    }
  });

  compressBtn.addEventListener('click', async () => {
    if (!fileBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('compress-btn', true, 'Compressing…');
    setProgress(0, 0);
    try {
      let out: Uint8Array;
      let stats: CompressImagesStats;
      let resultNote = '';
      if (targetMode()) {
        const targetMb = Math.max(0.1, Number(el<HTMLInputElement>('target-mb').value) || 2);
        const targetBytes = Math.round(targetMb * 1024 * 1024);
        const res = await compressToTargetSize(fileBytes, targetBytes, browserCodec, (done, total) => {
          setProgress(done, total);
        });
        out = res.data;
        stats = res.stats;
        resultNote = res.hitTarget
          ? ` · under your ${formatBytes(targetBytes)} target`
          : ` · could not reach ${formatBytes(targetBytes)} — this is the smallest it goes (${formatBytes(res.smallestBytes)})`;
      } else {
        const level = levelName();
        const res = await compressPdfImages(fileBytes, level, browserCodec, (done, total) => {
          setProgress(done, total);
        });
        out = res.data;
        stats = res.stats;
      }

      const saved = originalSize - out.length;
      const pct = originalSize > 0 ? Math.round((saved / originalSize) * 100) : 0;
      const imageNote =
        stats.imagesReplaced > 0
          ? ` · ${stats.imagesReplaced} image${stats.imagesReplaced === 1 ? '' : 's'} downsampled`
          : stats.imagesFound > 0
            ? ' · images already compact'
            : ' · no images to shrink';
      el('result-info').textContent =
        saved > 0
          ? `${formatBytes(originalSize)} → ${formatBytes(out.length)} · ${pct}% smaller${imageNote}${resultNote}`
          : `${formatBytes(originalSize)} → ${formatBytes(out.length)} · no saving this time (this PDF was already compact)`;
      el('result').hidden = false;
      const stem = fileName.replace(/\.[^.]+$/, '');
      el<HTMLButtonElement>('download-btn').onclick = () =>
        downloadBytes(`${stem}-compressed.pdf`, out, 'application/pdf');
      void showPdfPreview('preview-wrap', out);
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Compression failed.');
    } finally {
      el('progress-wrap').hidden = true;
      setBusy('compress-btn', false);
    }
  });
}
